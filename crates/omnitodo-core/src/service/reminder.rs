use serde::Serialize;

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::Result;
use crate::service::recurrence::RecurrenceRule;
use crate::service::{Core, TASK_COLS};

/// A reminder that is due (or was missed) for a task occurrence.
#[derive(Debug, Clone, Serialize)]
pub struct ReminderHit {
    pub task_id: Id,
    pub title: String,
    pub occurrence_at: i64,
    pub when: i64,
}

/// Default per-series cap when materialising missed occurrences (design §18).
pub const MATERIALIZE_CAP_PER_SERIES: usize = 200;

impl Core {
    /// The instant a task should remind at, or `None` if reminders are off
    /// (design §9.1: `remind_at` > `due_at - offset`).
    pub fn reminder_time(t: &Task) -> Option<i64> {
        if t.remind_enabled == 0 {
            return None;
        }
        if let Some(at) = t.remind_at {
            return Some(at);
        }
        if let Some(offset) = t.remind_offset_min {
            if let Some(due) = t.due_at {
                return Some(due - offset * 60_000);
            }
        }
        None
    }

    /// Reminders whose time falls in `[from, to]` and have not been fired yet.
    pub async fn reminders_between(&self, from: i64, to: i64) -> Result<Vec<ReminderHit>> {
        let rows: Vec<Task> = sqlx::query_as(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE remind_enabled = 1 AND deleted_at IS NULL \
             AND status NOT IN ('done','cancelled')"
        ))
        .fetch_all(&self.pool)
        .await?;

        let mut hits = Vec::new();
        for t in rows {
            let Some(when) = Self::reminder_time(&t) else { continue };
            if when < from || when > to {
                continue;
            }
            let occurrence_at = t.occurrence_at.unwrap_or(when);
            let fired: Option<(i64,)> = sqlx::query_as(
                "SELECT fired_at FROM reminder_fires WHERE task_id = ? AND occurrence_at = ?",
            )
            .bind(&t.id)
            .bind(occurrence_at)
            .fetch_optional(&self.pool)
            .await?;
            if fired.is_none() {
                hits.push(ReminderHit {
                    task_id: t.id.clone(),
                    title: t.title.clone(),
                    occurrence_at,
                    when,
                });
            }
        }
        Ok(hits)
    }

    /// Reminders due now (within the last minute).
    pub async fn reminders_due_now(&self, now: i64) -> Result<Vec<ReminderHit>> {
        self.reminders_between(now - 60_000, now).await
    }

    /// Reminders missed while the app was closed (design §9.2).
    pub async fn reminders_catch_up(&self, since: i64, now: i64) -> Result<Vec<ReminderHit>> {
        self.reminders_between(since, now).await
    }

    pub async fn mark_reminder_fired(&self, task_id: &Id, occurrence_at: i64) -> Result<()> {
        sqlx::query(
            "INSERT OR REPLACE INTO reminder_fires (task_id, occurrence_at, fired_at) VALUES (?, ?, ?)",
        )
        .bind(task_id)
        .bind(occurrence_at)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Push a reminder `minutes` into the future (design §8.1 `reminder_snooze`).
    ///
    /// Snoozing re-arms the task rather than scheduling a separate alarm: the
    /// absolute `remind_at` moves to `now + minutes`, and the `reminder_fires`
    /// row for that occurrence is dropped so the de-duplication doesn't suppress
    /// the second shot. For a materialised recurring occurrence `occurrence_at`
    /// identifies the row to clear — pass it from the `ReminderHit`.
    ///
    /// Note the reminder keeps its *new* time: snoozing twice moves it twice, and
    /// a later `due_at` change no longer recomputes it (that's what an absolute
    /// snooze means). Returns the new reminder instant.
    pub async fn snooze_reminder(
        &self,
        task_id: &Id,
        occurrence_at: Option<i64>,
        minutes: i64,
    ) -> Result<i64> {
        if !(1..=10_080).contains(&minutes) {
            return Err(crate::error::CoreError::Validation(
                "snooze must be between 1 and 10080 minutes".into(),
            ));
        }
        self.ensure_task_exists(task_id).await?;
        let remind_at = now_ms() + minutes * 60_000;
        sqlx::query(
            "UPDATE tasks SET remind_enabled = 1, remind_at = ?, updated_at = ?, \
             version = version + 1 WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(remind_at)
        .bind(now_ms())
        .bind(task_id)
        .execute(&self.pool)
        .await?;

        if let Some(at) = occurrence_at {
            sqlx::query("DELETE FROM reminder_fires WHERE task_id = ? AND occurrence_at = ?")
                .bind(task_id)
                .bind(at)
                .execute(&self.pool)
                .await?;
        }

        self.op_log(
            "task",
            task_id,
            "snooze",
            serde_json::json!({ "minutes": minutes, "remind_at": remind_at }),
        )
        .await?;
        Ok(remind_at)
    }

    /// Materialise recurring occurrences whose time has arrived (design §5.5).
    /// Idempotent via the `(series_id, occurrence_at)` unique index.
    pub async fn materialize_due(&self, now: i64) -> Result<usize> {
        let anchors: Vec<Task> = sqlx::query_as(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE series_id = id AND recurrence_rule IS NOT NULL \
             AND deleted_at IS NULL"
        ))
        .fetch_all(&self.pool)
        .await?;

        let mut created = 0;
        for anchor in anchors {
            let Some(anchor_ms) = anchor.occurrence_at else { continue };
            let rule = match RecurrenceRule::parse(anchor.recurrence_rule.as_deref().unwrap_or("")) {
                Ok(r) => r,
                Err(_) => continue,
            };

            // Existing occurrence instants for this series.
            let existing: Vec<(i64,)> = sqlx::query_as(
                "SELECT occurrence_at FROM tasks WHERE series_id = ? AND occurrence_at IS NOT NULL",
            )
            .bind(&anchor.series_id)
            .fetch_all(&self.pool)
            .await?;
            let seen: std::collections::HashSet<i64> =
                existing.into_iter().map(|(x,)| x).collect();

            let hits = rule.expand(
                anchor_ms,
                anchor_ms + 1,
                now,
                MATERIALIZE_CAP_PER_SERIES + seen.len(),
            );
            for when in hits {
                if seen.contains(&when) {
                    continue;
                }
                if created >= MATERIALIZE_CAP_PER_SERIES * 100 {
                    break;
                }
                self.clone_occurrence(&anchor, when).await?;
                created += 1;
            }
        }
        Ok(created)
    }

    async fn clone_occurrence(&self, anchor: &Task, occurrence_at: i64) -> Result<Id> {
        let id = Self::new_id();
        let ts = now_ms();
        sqlx::query(
            "INSERT OR IGNORE INTO tasks (id, project_id, parent_id, series_id, occurrence_at, \
             title, description, priority, status, start_at, due_at, all_day, timezone, \
             remind_enabled, remind_at, remind_offset_min, recurrence_rule, recurrence_until, \
             tags_text, sort_order, created_at, updated_at, version, device_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(&anchor.project_id)
        .bind(&anchor.parent_id)
        .bind(&anchor.series_id)
        .bind(occurrence_at)
        .bind(&anchor.title)
        .bind(&anchor.description)
        .bind(anchor.priority)
        .bind(shift(anchor.start_at, anchor.occurrence_at, occurrence_at))
        .bind(shift(anchor.due_at, anchor.occurrence_at, occurrence_at))
        .bind(anchor.all_day)
        .bind(&anchor.timezone)
        .bind(anchor.remind_enabled)
        .bind(anchor.remind_at)
        .bind(anchor.remind_offset_min)
        .bind(&anchor.recurrence_rule)
        .bind(anchor.recurrence_until)
        .bind(&anchor.tags_text)
        .bind(anchor.sort_order)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;

        // Copy tag assignments.
        sqlx::query(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT ?, tag_id FROM task_tags WHERE task_id = ?",
        )
        .bind(&id)
        .bind(&anchor.id)
        .execute(&self.pool)
        .await?;

        self.fts_upsert(&id).await?;
        self.op_log("task", &id, "insert", serde_json::json!({ "series": anchor.series_id, "occurrence_at": occurrence_at }))
            .await?;
        Ok(id)
    }
}

/// Keep the same offset from the anchor instant when shifting to a new occurrence.
fn shift(value: Option<i64>, anchor_at: Option<i64>, occurrence_at: i64) -> Option<i64> {
    match (value, anchor_at) {
        (Some(v), Some(a)) => Some(occurrence_at + (v - a)),
        _ => None,
    }
}
