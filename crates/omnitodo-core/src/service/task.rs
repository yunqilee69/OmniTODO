use serde_json::json;
use sqlx::{QueryBuilder, Sqlite};

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::{Core, TASK_COLS};

const DAY_MS: i64 = 86_400_000;

impl Core {
    // ---------------------------------------------------------------- create

    pub async fn create_task(&self, input: CreateTaskInput) -> Result<TaskDto> {
        let mut input = input;
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err(CoreError::Validation("task title is required".into()));
        }
        // Names come from imports/scripts; ids come from the UI. Resolve the
        // name here rather than silently creating a project on a typo.
        if input.project_id.is_none() {
            if let Some(name) = input.project_name.as_deref().map(str::trim) {
                if !name.is_empty() {
                    input.project_id = Some(self.resolve_project_id(name).await?);
                }
            }
        }
        if let Some(pid) = &input.project_id {
            self.ensure_project_exists(pid).await?;
        }
        if let Some(parent) = &input.parent_id {
            self.ensure_task_exists(parent).await?;
        }

        let due_at = input.due_at;
        let start_at = input.start_at;
        // Recurrence needs an anchor (design §5.5).
        let occurrence_at = due_at.or(start_at);
        if input.recurrence_rule.is_some() && occurrence_at.is_none() {
            return Err(CoreError::Validation(
                "recurrence requires due_at or start_at".into(),
            ));
        }

        let id = Self::new_id();
        let ts = now_ms();
        let series_id = if input.recurrence_rule.is_some() {
            Some(id.clone())
        } else {
            None
        };
        let sort_order = match input.sort_order {
            Some(s) => s,
            None => self.next_task_sort_order(input.project_id.as_deref(), input.parent_id.as_deref()).await?,
        };
        let priority = input.priority.unwrap_or(Priority::None).as_i64();
        let status = input.status.unwrap_or(Status::Todo);

        sqlx::query(
            "INSERT INTO tasks (id, project_id, parent_id, series_id, occurrence_at, title, \
             description, priority, status, start_at, due_at, all_day, timezone, remind_enabled, \
             remind_at, remind_offset_min, recurrence_rule, recurrence_until, tags_text, \
             sort_order, created_at, updated_at, version, device_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(&input.project_id)
        .bind(&input.parent_id)
        .bind(&series_id)
        .bind(occurrence_at)
        .bind(&title)
        .bind(&input.description)
        .bind(priority)
        .bind(status.as_str())
        .bind(start_at)
        .bind(due_at)
        .bind(input.all_day.unwrap_or(false) as i64)
        .bind(&input.timezone)
        .bind(input.remind_enabled.unwrap_or(false) as i64)
        .bind(input.remind_at)
        .bind(input.remind_offset_min)
        .bind(&input.recurrence_rule)
        .bind(input.recurrence_until)
        .bind(sort_order)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;

        if !input.tag_names.is_empty() {
            let tags = self.ensure_tags(&input.tag_names).await?;
            let ids: Vec<Id> = tags.into_iter().map(|(id, _)| id).collect();
            self.set_task_tags(&id, &ids).await?;
        } else {
            self.fts_upsert(&id).await?;
        }

        self.op_log("task", &id, "insert", json!({ "title": title }))
            .await?;
        self.get_task(&id).await
    }

    async fn next_task_sort_order(&self, project_id: Option<&str>, parent_id: Option<&str>) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks \
             WHERE deleted_at IS NULL AND project_id IS ? AND parent_id IS ?",
        )
        .bind(project_id)
        .bind(parent_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    async fn ensure_project_exists(&self, id: &Id) -> Result<()> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|_| ())
            .ok_or_else(|| CoreError::NotFound(format!("project {id}")))
    }

    pub(crate) async fn ensure_task_exists(&self, id: &Id) -> Result<()> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|_| ()).ok_or_else(|| CoreError::NotFound(format!("task {id}")))
    }

    // ------------------------------------------------------------------- get

    pub async fn get_task(&self, id: &Id) -> Result<TaskDto> {
        let row = self.fetch_task_row(id).await?;
        self.task_to_dto(&row).await
    }

    async fn fetch_task_row(&self, id: &Id) -> Result<Task> {
        let row: Option<Task> = sqlx::query_as(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE id = ? AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.ok_or_else(|| CoreError::NotFound(format!("task {id}")))
    }

    async fn task_to_dto(&self, t: &Task) -> Result<TaskDto> {
        let (tag_ids, tags) = self.tags_of_task(&t.id).await?;
        let has_att: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM attachments WHERE task_id = ? AND deleted_at IS NULL",
        )
        .bind(&t.id)
        .fetch_one(&self.pool)
        .await?;
        let progress = self.subtask_progress(std::slice::from_ref(&t.id)).await?;
        Ok(TaskDto::from_task(
            t,
            tag_ids,
            tags,
            has_att.0 > 0,
            progress.get(&t.id).copied().unwrap_or_default(),
        ))
    }

    // ------------------------------------------------------------------ list

    pub async fn list_tasks(&self, filter: &TaskFilter) -> Result<Page<TaskDto>> {
        let limit = filter.limit.unwrap_or(100).clamp(1, 1000);
        let offset = filter.offset.unwrap_or(0).max(0);

        let mut qb: QueryBuilder<Sqlite> =
            QueryBuilder::new(format!("SELECT {TASK_COLS} FROM tasks WHERE deleted_at IS NULL"));
        push_task_filter(&mut qb, filter);
        qb.push(match filter.sort {
            Sort::DueAsc => " ORDER BY (due_at IS NULL), due_at ASC, created_at DESC",
            Sort::CreatedDesc => " ORDER BY created_at DESC",
            Sort::PriorityDesc => " ORDER BY priority DESC, created_at DESC",
            Sort::Manual => " ORDER BY sort_order ASC, created_at DESC",
        });
        qb.push(" LIMIT ").push_bind(limit).push(" OFFSET ").push_bind(offset);
        let rows: Vec<Task> = qb.build_query_as().fetch_all(&self.pool).await?;

        let mut cb: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL");
        push_task_filter(&mut cb, filter);
        let total: (i64,) = cb.build_query_as().fetch_one(&self.pool).await?;

        let ids: Vec<Id> = rows.iter().map(|t| t.id.clone()).collect();
        let tag_map = self.tags_for_tasks(&ids).await?;
        let with_att = self.tasks_with_attachments(&ids).await?;
        let with_sub = self.subtask_progress(&ids).await?;

        let items = rows
            .iter()
            .map(|t| {
                let (tag_ids, tags) = tag_map.get(&t.id).cloned().unwrap_or_default();
                let has = with_att.contains(&t.id);
                TaskDto::from_task(
                    t,
                    tag_ids,
                    tags,
                    has,
                    with_sub.get(&t.id).copied().unwrap_or_default(),
                )
            })
            .collect();

        Ok(Page {
            items,
            total: total.0,
            limit,
            offset,
        })
    }

    // ---------------------------------------------------------------- update

    pub async fn update_task(&self, id: &Id, patch: TaskPatch) -> Result<TaskDto> {
        let current = self.fetch_task_row(id).await?;
        if let Some(expected) = patch.expected_version {
            if expected != current.version {
                return Err(CoreError::Conflict {
                    entity: "task".into(),
                    id: id.clone(),
                    expected,
                    found: current.version,
                });
            }
        }

        let title = patch
            .title
            .as_deref()
            .map(str::trim)
            .map(str::to_string)
            .unwrap_or_else(|| current.title.clone());
        if title.is_empty() {
            return Err(CoreError::Validation("task title is required".into()));
        }

        let description = pick(patch.description, &current.description);
        let priority = patch
            .priority
            .map(|p| p.as_i64())
            .unwrap_or(current.priority);
        let status = patch
            .status
            .unwrap_or_else(|| Status::parse(&current.status).unwrap_or(Status::Todo));
        let project_id = if patch.clear_project_id {
            None
        } else {
            pick(patch.project_id, &current.project_id)
        };
        let parent_id = patch.parent_id.or_else(|| current.parent_id.clone());
        let start_at = if patch.clear_start_at {
            None
        } else {
            pick(patch.start_at, &current.start_at)
        };
        let due_at = if patch.clear_due_at {
            None
        } else {
            pick(patch.due_at, &current.due_at)
        };
        let all_day = patch.all_day.unwrap_or(current.all_day != 0);
        let timezone = pick(patch.timezone, &current.timezone);
        let remind_enabled = patch
            .remind_enabled
            .unwrap_or(current.remind_enabled != 0);
        let remind_at = if patch.clear_remind_at {
            None
        } else {
            pick(patch.remind_at, &current.remind_at)
        };
        let remind_offset_min = if patch.clear_remind_offset {
            None
        } else {
            patch.remind_offset_min.or(current.remind_offset_min)
        };
        let recurrence_rule = if patch.clear_recurrence {
            None
        } else {
            pick(patch.recurrence_rule, &current.recurrence_rule)
        };
        let recurrence_until = if patch.clear_recurrence {
            None
        } else {
            pick(patch.recurrence_until, &current.recurrence_until)
        };
        let sort_order = patch.sort_order.unwrap_or(current.sort_order);

        // completed_at is driven by status transitions, not the patch directly.
        let completed_at = match status {
            Status::Done => current.completed_at.or_else(|| Some(now_ms())),
            _ => None,
        };

        // Occurrence anchor follows due/start when the task is recurring.
        let series_id = if recurrence_rule.is_some() {
            Some(current.series_id.clone().unwrap_or_else(|| id.clone()))
        } else {
            None
        };
        let occurrence_at = if recurrence_rule.is_some() {
            due_at.or(start_at)
        } else {
            None
        };
        if recurrence_rule.is_some() && occurrence_at.is_none() {
            return Err(CoreError::Validation(
                "recurrence requires due_at or start_at".into(),
            ));
        }

        sqlx::query(
            "UPDATE tasks SET project_id = ?, parent_id = ?, series_id = ?, occurrence_at = ?, \
             title = ?, description = ?, priority = ?, status = ?, completed_at = ?, start_at = ?, \
             due_at = ?, all_day = ?, timezone = ?, remind_enabled = ?, remind_at = ?, \
             remind_offset_min = ?, recurrence_rule = ?, recurrence_until = ?, sort_order = ?, \
             updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .bind(&project_id)
        .bind(&parent_id)
        .bind(&series_id)
        .bind(occurrence_at)
        .bind(&title)
        .bind(&description)
        .bind(priority)
        .bind(status.as_str())
        .bind(completed_at)
        .bind(start_at)
        .bind(due_at)
        .bind(all_day as i64)
        .bind(&timezone)
        .bind(remind_enabled as i64)
        .bind(remind_at)
        .bind(remind_offset_min)
        .bind(&recurrence_rule)
        .bind(recurrence_until)
        .bind(sort_order)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;

        if let Some(names) = patch.tag_names {
            let tags = self.ensure_tags(&names).await?;
            let ids: Vec<Id> = tags.into_iter().map(|(id, _)| id).collect();
            self.set_task_tags(id, &ids).await?;
        } else {
            self.sync_tags_text(id).await?;
            self.fts_upsert(id).await?;
        }

        self.sync_completion_row(id).await?;
        self.op_log("task", id, "update", json!({ "title": title }))
            .await?;
        self.get_task(id).await
    }

    // ----------------------------------------------------- complete/uncomplete

    pub async fn complete_task(&self, id: &Id) -> Result<TaskDto> {
        let t = self.fetch_task_row(id).await?;
        let ts = now_ms();
        sqlx::query(
            "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?, version = version + 1 \
             WHERE id = ?",
        )
        .bind(ts)
        .bind(ts)
        .bind(id)
        .execute(&self.pool)
        .await?;
        self.sync_completion_row(id).await?;
        self.op_log("task", id, "update", json!({ "status": "done", "from_status": t.status }))
            .await?;
        self.get_task(id).await
    }

    pub async fn uncomplete_task(&self, id: &Id) -> Result<TaskDto> {
        self.fetch_task_row(id).await?;
        let ts = now_ms();
        sqlx::query(
            "UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = ?, version = version + 1 \
             WHERE id = ?",
        )
        .bind(ts)
        .bind(id)
        .execute(&self.pool)
        .await?;
        // Remove the completion record so throughput/on-time are not double counted.
        sqlx::query("DELETE FROM task_completions WHERE task_id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        self.op_log("task", id, "update", json!({ "status": "todo" }))
            .await?;
        self.get_task(id).await
    }

    /// Keep `task_completions` in sync: upsert on done, delete otherwise.
    async fn sync_completion_row(&self, id: &Id) -> Result<()> {
        let t = self.fetch_task_row(id).await?;
        if Status::parse(&t.status) != Some(Status::Done) {
            sqlx::query("DELETE FROM task_completions WHERE task_id = ?")
                .bind(id)
                .execute(&self.pool)
                .await?;
            return Ok(());
        }
        let completed_at = t.completed_at.unwrap_or_else(now_ms);
        let was_on_time = t.due_at.map(|due| {
            if t.all_day != 0 {
                completed_at < due + DAY_MS
            } else {
                completed_at <= due
            }
        });
        sqlx::query(
            "INSERT INTO task_completions (id, task_id, series_id, completed_at, due_at, was_on_time) \
             VALUES (?, ?, ?, ?, ?, ?) \
             ON CONFLICT(task_id) DO UPDATE SET completed_at = excluded.completed_at, \
             due_at = excluded.due_at, was_on_time = excluded.was_on_time",
        )
        .bind(Self::new_id())
        .bind(id)
        .bind(&t.series_id)
        .bind(completed_at)
        .bind(t.due_at)
        .bind(was_on_time)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ------------------------------------------------------------------ move

    pub async fn move_task(
        &self,
        id: &Id,
        project_id: Option<Option<Id>>,
        parent_id: Option<Option<Id>>,
        sort_order: Option<i64>,
    ) -> Result<TaskDto> {
        let current = self.fetch_task_row(id).await?;
        let new_project = match project_id {
            Some(p) => {
                if let Some(pid) = &p {
                    self.ensure_project_exists(pid).await?;
                }
                p
            }
            None => current.project_id.clone(),
        };
        let new_parent = match parent_id {
            Some(p) => {
                if let Some(pid) = &p {
                    self.ensure_task_exists(pid).await?;
                    if pid == id {
                        return Err(CoreError::Validation("task cannot be its own parent".into()));
                    }
                    if self.is_descendant(id, pid).await? {
                        return Err(CoreError::Validation("cannot move task under its descendant".into()));
                    }
                }
                p
            }
            None => current.parent_id.clone(),
        };
        let order = sort_order.unwrap_or(current.sort_order);
        sqlx::query(
            "UPDATE tasks SET project_id = ?, parent_id = ?, sort_order = ?, updated_at = ?, \
             version = version + 1 WHERE id = ?",
        )
        .bind(&new_project)
        .bind(&new_parent)
        .bind(order)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;
        self.op_log("task", id, "update", json!({ "moved": true }))
            .await?;
        self.get_task(id).await
    }

    /// Persist a new manual order for one list of tasks (design §13.2:
    /// drag-to-sort within a list). Each id is written with its rank as
    /// `sort_order`, so the list reads back in this order under
    /// [`Sort::Manual`](crate::domain::Sort::Manual).
    ///
    /// Only `sort_order` changes — membership (project / parent) is untouched.
    /// Ids that are missing or soft-deleted are skipped *without* consuming a
    /// rank, so a stale client list cannot leave gaps behind.
    pub async fn reorder_tasks(&self, ordered_ids: &[Id]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let ts = now_ms();
        let mut rank = 0i64;
        for id in ordered_ids {
            let done = sqlx::query(
                "UPDATE tasks SET sort_order = ?, updated_at = ?, version = version + 1 \
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

    /// True when `candidate` is inside the subtree rooted at `root`.
    async fn is_descendant(&self, root: &Id, candidate: &Id) -> Result<bool> {
        let row: (i64,) = sqlx::query_as(
            "WITH RECURSIVE sub(id) AS ( \
               SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL \
               UNION \
               SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL \
             ) SELECT COUNT(*) FROM sub WHERE id = ?",
        )
        .bind(root)
        .bind(candidate)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0 > 0)
    }

    // ------------------------------------------------------------ bulk update

    pub async fn bulk_update(&self, ids: &[Id], patch: &TaskPatch) -> Result<u32> {
        let mut n = 0u32;
        for id in ids {
            self.update_task(id, patch.clone()).await?;
            n += 1;
        }
        Ok(n)
    }

    // ---------------------------------------------------------------- delete

    /// Soft-delete a task and its subtree (design §5.7).
    pub async fn delete_task(&self, id: &Id) -> Result<usize> {
        self.fetch_task_row(id).await?;
        let ts = now_ms();
        let mut tx = self.pool.begin().await?;
        let ids: Vec<(String,)> = sqlx::query_as(
            "WITH RECURSIVE sub(id) AS ( \
               SELECT id FROM tasks WHERE id = ? \
               UNION \
               SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id \
             ) SELECT id FROM sub WHERE id IN (SELECT id FROM tasks WHERE deleted_at IS NULL)",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        let task_ids: Vec<String> = ids.into_iter().map(|(i,)| i).collect();

        for chunk in task_ids.chunks(400) {
            let ph = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "UPDATE tasks SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id IN ({ph})"
            );
            let mut q = sqlx::query(&sql).bind(ts).bind(ts);
            for tid in chunk {
                q = q.bind(tid);
            }
            q.execute(&mut *tx).await?;

            let sql = format!(
                "UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE task_id IN ({ph})"
            );
            let mut q = sqlx::query(&sql).bind(ts).bind(ts);
            for tid in chunk {
                q = q.bind(tid);
            }
            q.execute(&mut *tx).await?;

            for table in ["task_tags", "reminder_fires", "tasks_fts"] {
                let sql = format!("DELETE FROM {table} WHERE task_id IN ({ph})");
                let mut q = sqlx::query(&sql);
                for tid in chunk {
                    q = q.bind(tid);
                }
                q.execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;

        self.op_log("task", id, "delete", json!({ "cascaded": task_ids.len() }))
            .await?;
        Ok(task_ids.len())
    }

    // ------------------------------------------------------------- subtasks

    pub async fn add_subtask(&self, parent_id: &Id, mut input: CreateTaskInput) -> Result<TaskDto> {
        let parent = self.fetch_task_row(parent_id).await?;
        // Depth guard (design §5.5, max 5).
        let depth = self.subtree_depth(parent_id).await?;
        if depth >= 5 {
            return Err(CoreError::Validation("subtask depth limit (5) reached".into()));
        }
        input.parent_id = Some(parent_id.clone());
        if input.project_id.is_none() {
            input.project_id = parent.project_id;
        }
        self.create_task(input).await
    }

    async fn subtree_depth(&self, id: &Id) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "WITH RECURSIVE up(id, parent_id, d) AS ( \
               SELECT id, parent_id, 0 FROM tasks WHERE id = ? \
               UNION ALL \
               SELECT t.id, t.parent_id, up.d + 1 FROM tasks t JOIN up ON t.id = up.parent_id \
             ) SELECT COALESCE(MAX(d), 0) FROM up",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// All descendants of a task (recursive).
    pub async fn list_subtasks(&self, root_id: &Id) -> Result<Vec<TaskDto>> {
        let rows: Vec<Task> = sqlx::query_as(&format!(
            "WITH RECURSIVE sub(id) AS ( \
               SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL \
               UNION \
               SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL \
             ) SELECT {TASK_COLS} FROM tasks WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL \
             ORDER BY sort_order, created_at"
        ))
        .bind(root_id)
        .fetch_all(&self.pool)
        .await?;
        let ids: Vec<Id> = rows.iter().map(|t| t.id.clone()).collect();
        let tag_map = self.tags_for_tasks(&ids).await?;
        let with_att = self.tasks_with_attachments(&ids).await?;
        let with_sub = self.subtask_progress(&ids).await?;
        Ok(rows
            .iter()
            .map(|t| {
                let (tag_ids, tags) = tag_map.get(&t.id).cloned().unwrap_or_default();
                TaskDto::from_task(
                    t,
                    tag_ids,
                    tags,
                    with_att.contains(&t.id),
                    with_sub.get(&t.id).copied().unwrap_or_default(),
                )
            })
            .collect())
    }
}

/// `Some(v)` overrides; `None` keeps the current value.
fn pick<T: Clone>(patch: Option<T>, current: &Option<T>) -> Option<T> {
    patch.or_else(|| current.clone())
}

/// Append WHERE conditions for a task filter onto a query builder.
fn push_task_filter(qb: &mut QueryBuilder<Sqlite>, f: &TaskFilter) {
    if f.unfiled {
        qb.push(" AND project_id IS NULL");
    }
    if let Some(pids) = &f.project_ids {
        if !pids.is_empty() {
            qb.push(" AND project_id IN (");
            for (i, p) in pids.iter().enumerate() {
                if i > 0 {
                    qb.push(",");
                }
                qb.push_bind(p.clone());
            }
            qb.push(")");
        }
    }
    if let Some(tids) = &f.tag_ids {
        if !tids.is_empty() {
            if f.tag_match_all {
                qb.push(" AND (SELECT COUNT(DISTINCT tag_id) FROM task_tags WHERE task_id = tasks.id AND tag_id IN (");
                for (i, t) in tids.iter().enumerate() {
                    if i > 0 {
                        qb.push(",");
                    }
                    qb.push_bind(t.clone());
                }
                qb.push(")) = ").push_bind(tids.len() as i64);
            } else {
                qb.push(" AND EXISTS (SELECT 1 FROM task_tags WHERE task_id = tasks.id AND tag_id IN (");
                for (i, t) in tids.iter().enumerate() {
                    if i > 0 {
                        qb.push(",");
                    }
                    qb.push_bind(t.clone());
                }
                qb.push("))");
            }
        }
    }
    if let Some(prios) = &f.priorities {
        if !prios.is_empty() {
            qb.push(" AND priority IN (");
            for (i, p) in prios.iter().enumerate() {
                if i > 0 {
                    qb.push(",");
                }
                qb.push_bind(p.as_i64());
            }
            qb.push(")");
        }
    }
    if let Some(sts) = &f.statuses {
        if !sts.is_empty() {
            qb.push(" AND status IN (");
            for (i, s) in sts.iter().enumerate() {
                if i > 0 {
                    qb.push(",");
                }
                qb.push_bind(s.as_str().to_string());
            }
            qb.push(")");
        }
    } else if !f.include_completed {
        qb.push(" AND status NOT IN ('done','cancelled')");
    }
    if let Some(v) = f.due_before {
        qb.push(" AND due_at IS NOT NULL AND due_at <= ").push_bind(v);
    }
    if let Some(v) = f.due_after {
        qb.push(" AND due_at IS NOT NULL AND due_at >= ").push_bind(v);
    }
    if let Some(v) = f.start_before {
        qb.push(" AND start_at IS NOT NULL AND start_at <= ").push_bind(v);
    }
    if let Some(v) = f.start_after {
        qb.push(" AND start_at IS NOT NULL AND start_at >= ").push_bind(v);
    }
    if let Some(v) = f.completed_after {
        qb.push(" AND completed_at IS NOT NULL AND completed_at >= ").push_bind(v);
    }
    if let Some(v) = f.completed_before {
        qb.push(" AND completed_at IS NOT NULL AND completed_at <= ").push_bind(v);
    }
    match f.has_attachments {
        Some(true) => {
            qb.push(" AND EXISTS (SELECT 1 FROM attachments a WHERE a.task_id = tasks.id AND a.deleted_at IS NULL)");
        }
        Some(false) => {
            qb.push(" AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.task_id = tasks.id AND a.deleted_at IS NULL)");
        }
        None => {}
    }
    if let Some(pid) = &f.parent_id {
        qb.push(" AND parent_id = ").push_bind(pid.clone());
    }
    if f.root_only {
        qb.push(" AND parent_id IS NULL");
    }
    if let Some(text) = &f.search_text {
        let text = text.trim();
        if !text.is_empty() {
            if text.chars().count() >= 3 {
                qb.push(" AND id IN (SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ")
                    .push_bind(text.to_string())
                    .push(")");
            } else {
                qb.push(" AND (title LIKE ").push_bind(format!("%{text}%"));
                qb.push(" OR description LIKE ").push_bind(format!("%{text}%"));
                qb.push(" OR tags_text LIKE ").push_bind(format!("%{text}%")).push(")");
            }
        }
    }
}
