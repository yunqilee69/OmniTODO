use sqlx::Row;

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::{Core, PROJECT_COLS};

impl Core {
    pub async fn create_project(&self, input: CreateProjectInput) -> Result<ProjectDto> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation("project name is required".into()));
        }
        let id = Self::new_id();
        let ts = now_ms();
        let sort_order = match input.sort_order {
            Some(s) => s,
            None => self.next_project_sort_order().await?,
        };
        sqlx::query(
            "INSERT INTO projects (id, name, description, color, icon, sort_order, is_archived, \
             created_at, updated_at, version, device_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(&input.description)
        .bind(&input.color)
        .bind(&input.icon)
        .bind(sort_order)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;

        self.op_log("project", &id, "insert", serde_json::json!({ "name": name }))
            .await?;
        self.get_project(&id).await
    }

    async fn next_project_sort_order(&self) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects WHERE deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    pub async fn list_projects(&self, include_archived: bool) -> Result<Vec<ProjectDto>> {
        let sql = format!(
            "SELECT {PROJECT_COLS} FROM projects WHERE deleted_at IS NULL \
             AND (? OR is_archived = 0) ORDER BY sort_order, created_at"
        );
        let rows: Vec<Project> = sqlx::query_as(&sql)
            .bind(include_archived)
            .fetch_all(&self.pool)
            .await?;

        let mut out = Vec::with_capacity(rows.len());
        for p in &rows {
            out.push(ProjectDto::from_project(p, Some(self.project_stats(&p.id).await?)));
        }
        Ok(out)
    }

    pub async fn get_project(&self, id: &Id) -> Result<ProjectDto> {
        let row: Option<Project> = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLS} FROM projects WHERE id = ? AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let p = row.ok_or_else(|| CoreError::NotFound(format!("project {id}")))?;
        let stats = self.project_stats(id).await?;
        Ok(ProjectDto::from_project(&p, Some(stats)))
    }

    pub async fn project_stats(&self, id: &Id) -> Result<ProjectStats> {
        let now = now_ms();
        let row = sqlx::query(
            "SELECT \
               SUM(CASE WHEN status IN ('todo','in_progress') THEN 1 ELSE 0 END) AS open, \
               SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed, \
               SUM(CASE WHEN due_at IS NOT NULL AND due_at < ? AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS overdue \
             FROM tasks WHERE project_id = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(ProjectStats {
            open: row.try_get::<Option<i64>, _>("open")?.unwrap_or(0),
            completed: row.try_get::<Option<i64>, _>("completed")?.unwrap_or(0),
            overdue: row.try_get::<Option<i64>, _>("overdue")?.unwrap_or(0),
        })
    }

    pub async fn update_project(&self, id: &Id, patch: ProjectPatch) -> Result<ProjectDto> {
        let current = self.get_project(id).await?;
        if let Some(expected) = patch.expected_version {
            if expected != current.version {
                return Err(CoreError::Conflict {
                    entity: "project".into(),
                    id: id.clone(),
                    expected,
                    found: current.version,
                });
            }
        }
        let name = patch.name.as_deref().map(str::trim).unwrap_or(&current.name);
        if name.is_empty() {
            return Err(CoreError::Validation("project name is required".into()));
        }
        let description = patch.description.or(current.description);
        let color = patch.color.or(current.color);
        let icon = patch.icon.or(current.icon);
        let sort_order = patch.sort_order.unwrap_or(current.sort_order);
        let is_archived = patch.is_archived.unwrap_or(current.is_archived);

        sqlx::query(
            "UPDATE projects SET name = ?, description = ?, color = ?, icon = ?, sort_order = ?, \
             is_archived = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .bind(name)
        .bind(&description)
        .bind(&color)
        .bind(&icon)
        .bind(sort_order)
        .bind(is_archived as i64)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.op_log("project", id, "update", serde_json::json!({ "name": name }))
            .await?;
        self.get_project(id).await
    }

    pub async fn archive_project(&self, id: &Id, archived: bool) -> Result<ProjectDto> {
        self.update_project(
            id,
            ProjectPatch {
                is_archived: Some(archived),
                ..Default::default()
            },
        )
        .await
    }

    pub async fn reorder_projects(&self, ordered_ids: &[Id]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        for (i, id) in ordered_ids.iter().enumerate() {
            sqlx::query("UPDATE projects SET sort_order = ?, updated_at = ? WHERE id = ?")
                .bind(i as i64)
                .bind(now_ms())
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Soft-delete a project and cascade to its tasks (design §5.7).
    pub async fn delete_project(&self, id: &Id) -> Result<usize> {
        self.get_project(id).await?; // ensure it exists / is live
        let ts = now_ms();
        let mut tx = self.pool.begin().await?;

        // Collect the project's task subtree (project tasks + all descendants).
        let ids: Vec<(String,)> = sqlx::query_as(
            "WITH RECURSIVE sub(id) AS ( \
               SELECT id FROM tasks WHERE project_id = ? AND deleted_at IS NULL \
               UNION \
               SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL \
             ) SELECT id FROM sub",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        let task_ids: Vec<String> = ids.into_iter().map(|(i,)| i).collect();

        for chunk in task_ids.chunks(400) {
            let ph = vec!["?"; chunk.len()].join(",");

            // Soft-delete tasks.
            let sql = format!(
                "UPDATE tasks SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id IN ({ph})"
            );
            let mut q = sqlx::query(&sql).bind(ts).bind(ts);
            for tid in chunk {
                q = q.bind(tid);
            }
            q.execute(&mut *tx).await?;

            // Soft-delete their attachments.
            let sql = format!(
                "UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE task_id IN ({ph})"
            );
            let mut q = sqlx::query(&sql).bind(ts).bind(ts);
            for tid in chunk {
                q = q.bind(tid);
            }
            q.execute(&mut *tx).await?;

            // Junction / satellite rows are hard-deleted.
            for table in ["task_tags", "reminder_fires", "tasks_fts"] {
                let sql = format!("DELETE FROM {table} WHERE task_id IN ({ph})");
                let mut q = sqlx::query(&sql);
                for tid in chunk {
                    q = q.bind(tid);
                }
                q.execute(&mut *tx).await?;
            }
        }

        sqlx::query(
            "UPDATE projects SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .bind(ts)
        .bind(ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        // The project's sections go with it (§5.9). The tasks above keep their
        // `section_id` pointing at a row that is now deleted, which is harmless:
        // every read filters `deleted_at IS NULL` on both sides, and a task whose
        // section is missing from the live list reads as "no section".
        sqlx::query(
            "UPDATE sections SET deleted_at = ?, updated_at = ?, version = version + 1 \
             WHERE project_id = ? AND deleted_at IS NULL",
        )
        .bind(ts)
        .bind(ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        self.op_log(
            "project",
            id,
            "delete",
            serde_json::json!({ "cascaded_tasks": task_ids.len() }),
        )
        .await?;
        Ok(task_ids.len())
    }

    /// Candidate projects for the quick-add "#name" picker (design §12.2):
    /// exact (case-insensitive) first, then prefix, then substring.
    pub async fn find_similar_projects(&self, name: &str) -> Result<Vec<ProjectDto>> {
        let needle = name.trim();
        if needle.is_empty() {
            return Ok(vec![]);
        }
        let rows: Vec<Project> = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLS} FROM projects WHERE deleted_at IS NULL AND is_archived = 0 \
             AND name LIKE ? COLLATE NOCASE \
             ORDER BY CASE \
               WHEN name = ? COLLATE NOCASE THEN 0 \
               WHEN name LIKE ? COLLATE NOCASE THEN 1 \
               ELSE 2 END, sort_order, name LIMIT 10"
        ))
        .bind(format!("%{needle}%"))
        .bind(needle)
        .bind(format!("{needle}%"))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|p| ProjectDto::from_project(p, None))
            .collect())
    }

    /// Resolve a project reference that may be either an id or a name.
    ///
    /// The CLI takes names (`task add --project 工作`) while the desktop and the
    /// MCP tools pass ids; both routes land here so the failure mode is the same,
    /// and a guess is never silent: an exact case-insensitive name match wins,
    /// and a substring is only accepted when exactly one project matches.
    pub async fn resolve_project_id(&self, key: &str) -> Result<String> {
        let key = key.trim();
        if key.is_empty() {
            return Err(CoreError::Validation("project reference is empty".into()));
        }
        if self.get_project(&key.to_string()).await.is_ok() {
            return Ok(key.to_string());
        }

        let exact: Vec<Project> = sqlx::query_as(&format!(
            "SELECT {PROJECT_COLS} FROM projects WHERE deleted_at IS NULL \
             AND name = ? COLLATE NOCASE ORDER BY sort_order, name"
        ))
        .bind(key)
        .fetch_all(&self.pool)
        .await?;
        match exact.len() {
            0 => {}
            1 => return Ok(exact[0].id.clone()),
            n => {
                return Err(CoreError::AmbiguousProject(format!(
                    "{key:?} matches {n} projects"
                )))
            }
        }

        let candidates = self.find_similar_projects(key).await?;
        match candidates.len() {
            1 => Ok(candidates[0].id.clone()),
            0 => Err(CoreError::NotFound(format!("project {key}"))),
            _ => Err(CoreError::AmbiguousProject(format!(
                "{key:?} matches: {}",
                candidates
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }
}
