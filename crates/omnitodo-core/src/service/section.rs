//! 板块（design §5.9）：项目内的一段，看板视图的一列。
//!
//! 三条不变量，都在这里守着：
//!
//! 1. **板块属于项目，且只有项目内的任务能落进来。** 每次挂载都校验
//!    `section.project_id == task.project_id`，所以一个跨项目的板块 id 不可能悄悄生效。
//! 2. **只有顶层任务带板块。** 子任务跟着父任务走，它的位置由父任务所在的那一行决定；
//!    挂到父任务下面时清空 `section_id`（见 `task.rs` 的 reparent 与 `reassign_project`）。
//! 3. **删板块不删任务。** 板块是"分区"，不是容器：删掉它，里面的任务回到「无板块」，
//!    和 Todoist 一样。任务被删是另一回事，得显式删任务。

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::{Core, SECTION_COLS};

impl Core {
    // ---------------------------------------------------------------- create

    pub async fn create_section(&self, input: CreateSectionInput) -> Result<SectionDto> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation("section name is required".into()));
        }
        self.ensure_project_exists(&input.project_id).await?;
        self.ensure_section_name_free(&input.project_id, name, None).await?;

        let id = Self::new_id();
        let ts = now_ms();
        let sort_order = match input.sort_order {
            Some(s) => s,
            None => self.next_section_sort_order(&input.project_id).await?,
        };
        sqlx::query(
            "INSERT INTO sections (id, project_id, name, sort_order, created_at, updated_at, \
             version, device_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(&input.project_id)
        .bind(name)
        .bind(sort_order)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;

        self.op_log(
            "section",
            &id,
            "insert",
            serde_json::json!({ "name": name, "project_id": input.project_id }),
        )
        .await?;
        self.get_section(&id).await
    }

    async fn next_section_sort_order(&self, project_id: &Id) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sections \
             WHERE project_id = ? AND deleted_at IS NULL",
        )
        .bind(project_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// A project's sections cannot share a name — the board's columns are
    /// identified by name, and two identical headers read as a bug.
    async fn ensure_section_name_free(
        &self,
        project_id: &Id,
        name: &str,
        except: Option<&Id>,
    ) -> Result<()> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM sections WHERE project_id = ? AND name = ? COLLATE NOCASE \
             AND deleted_at IS NULL AND id IS NOT ?",
        )
        .bind(project_id)
        .bind(name)
        .bind(except)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(_) => Err(CoreError::Validation(format!(
                "section {name:?} already exists in this project"
            ))),
            None => Ok(()),
        }
    }

    // ------------------------------------------------------------------- read

    /// A project's sections in display order, each with its live task count.
    pub async fn list_sections(&self, project_id: &Id) -> Result<Vec<SectionDto>> {
        self.ensure_project_exists(project_id).await?;
        let rows: Vec<Section> = sqlx::query_as(&format!(
            "SELECT {SECTION_COLS} FROM sections WHERE project_id = ? AND deleted_at IS NULL \
             ORDER BY sort_order, created_at"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for s in &rows {
            let count = self.section_task_count(&s.id).await?;
            out.push(SectionDto::from_section(s, count));
        }
        Ok(out)
    }

    pub async fn get_section(&self, id: &Id) -> Result<SectionDto> {
        let s = self.fetch_section_row(id).await?;
        let count = self.section_task_count(id).await?;
        Ok(SectionDto::from_section(&s, count))
    }

    async fn fetch_section_row(&self, id: &Id) -> Result<Section> {
        let row: Option<Section> = sqlx::query_as(&format!(
            "SELECT {SECTION_COLS} FROM sections WHERE id = ? AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.ok_or_else(|| CoreError::NotFound(format!("section {id}")))
    }

    /// Top-level tasks filed under a section. Subtasks are not counted: they
    /// belong to their parent's row, not to a column of their own.
    async fn section_task_count(&self, section_id: &Id) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM tasks WHERE section_id = ? AND parent_id IS NULL \
             AND deleted_at IS NULL",
        )
        .bind(section_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    // ---------------------------------------------------------------- update

    pub async fn update_section(&self, id: &Id, patch: SectionPatch) -> Result<SectionDto> {
        let current = self.fetch_section_row(id).await?;
        if let Some(expected) = patch.expected_version {
            if expected != current.version {
                return Err(CoreError::Conflict {
                    entity: "section".into(),
                    id: id.clone(),
                    expected,
                    found: current.version,
                });
            }
        }
        let name = patch
            .name
            .as_deref()
            .map(str::trim)
            .unwrap_or(&current.name);
        if name.is_empty() {
            return Err(CoreError::Validation("section name is required".into()));
        }
        if name != current.name {
            self.ensure_section_name_free(&current.project_id, name, Some(id))
                .await?;
        }
        let sort_order = patch.sort_order.unwrap_or(current.sort_order);

        sqlx::query(
            "UPDATE sections SET name = ?, sort_order = ?, updated_at = ?, version = version + 1 \
             WHERE id = ?",
        )
        .bind(name)
        .bind(sort_order)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.op_log("section", id, "update", serde_json::json!({ "name": name }))
            .await?;
        self.get_section(id).await
    }

    /// Persist a new column order (the board's horizontal drag).
    pub async fn reorder_sections(&self, ordered_ids: &[Id]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let ts = now_ms();
        let mut rank = 0i64;
        for id in ordered_ids {
            let done = sqlx::query(
                "UPDATE sections SET sort_order = ?, updated_at = ?, version = version + 1 \
                 WHERE id = ? AND deleted_at IS NULL",
            )
            .bind(rank)
            .bind(ts)
            .bind(id)
            .execute(&mut *tx)
            .await?;
            if done.rows_affected() > 0 {
                rank += 1;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    // ---------------------------------------------------------------- delete

    /// Soft-delete a section.
    ///
    /// `delete_tasks` picks between the two things a section can mean when it
    /// goes away, and the caller has to choose because they are not the same act:
    ///
    /// - `false` — the section is a *divider*, and removing a divider must not
    ///   remove what it divided. Its tasks are released into "no section".
    /// - `true` — Todoist's own behaviour, where deleting a section deletes the
    ///   tasks in it. Offered because it is what a user coming from Todoist
    ///   expects the verb to do, and kept off by default because it is the one
    ///   path here that can throw away work in a single click.
    ///
    /// Either way the return value is the number of tasks affected — released, or
    /// deleted along with their subtrees — so the UI can say which happened.
    pub async fn delete_section(&self, id: &Id, delete_tasks: bool) -> Result<usize> {
        self.fetch_section_row(id).await?;

        if delete_tasks {
            let roots: Vec<(String,)> = sqlx::query_as(
                "SELECT id FROM tasks WHERE section_id = ? AND parent_id IS NULL \
                 AND deleted_at IS NULL",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await?;
            let mut deleted = 0usize;
            for (tid,) in &roots {
                // `delete_task` takes the whole subtree, which is the only
                // correct reading of "delete this task": a child cannot outlive
                // its parent.
                deleted += self.delete_task(tid).await?;
            }
            self.soft_delete_section(id).await?;
            self.op_log(
                "section",
                id,
                "delete",
                serde_json::json!({ "deleted_tasks": deleted }),
            )
            .await?;
            return Ok(deleted);
        }

        let ts = now_ms();
        let mut tx = self.pool.begin().await?;
        let freed = sqlx::query(
            "UPDATE tasks SET section_id = NULL, updated_at = ?, version = version + 1 \
             WHERE section_id = ? AND deleted_at IS NULL",
        )
        .bind(ts)
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as usize;
        tx.commit().await?;

        self.soft_delete_section(id).await?;
        self.op_log(
            "section",
            id,
            "delete",
            serde_json::json!({ "released_tasks": freed }),
        )
        .await?;
        Ok(freed)
    }

    async fn soft_delete_section(&self, id: &Id) -> Result<()> {
        let ts = now_ms();
        sqlx::query(
            "UPDATE sections SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .bind(ts)
        .bind(ts)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ------------------------------------------------------------------- file

    /// Check a section reference before it is written: the section has to exist
    /// and live in the project the task is going into.
    ///
    /// A mismatch is an error rather than a silent clear — clearing would turn a
    /// stale client into data loss, and a caller that means "no section" says so
    /// explicitly with `clear_section_id`.
    pub(crate) async fn ensure_section_in_project(
        &self,
        section_id: &Id,
        project_id: Option<&str>,
    ) -> Result<()> {
        let section = self.fetch_section_row(section_id).await?;
        match project_id {
            Some(pid) if section.project_id == pid => Ok(()),
            Some(_) => Err(CoreError::Validation(
                "section and task must be in the same project".into(),
            )),
            None => Err(CoreError::Validation(
                "a task with no project cannot be filed into a section".into(),
            )),
        }
    }
}
