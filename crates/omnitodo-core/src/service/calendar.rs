//! Calendar view support (design §13.1): merge materialised task rows with
//! virtually-expanded future recurrence occurrences. Virtual occurrences are
//! read-only and have no task id (design §5.5).

use serde::{Deserialize, Serialize};

use crate::domain::*;
use crate::error::Result;
use crate::service::recurrence::RecurrenceRule;
use crate::service::{Core, TASK_COLS};

/// One occurrence of a recurring series within a window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OccurrenceDto {
    /// Concretely materialised task row id, or `None` for a virtual occurrence.
    pub task_id: Option<Id>,
    pub series_id: Id,
    pub title: String,
    pub occurrence_at: i64,
    pub materialized: bool,
    pub status: Option<Status>,
}

/// An item to place on the calendar (materialised task or virtual occurrence).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarItemDto {
    pub task_id: Option<Id>,
    pub series_id: Option<Id>,
    pub title: String,
    pub start_at: Option<i64>,
    pub due_at: Option<i64>,
    pub all_day: bool,
    pub status: Status,
    pub virtual_occurrence: bool,
}

impl Core {
    /// Materialised + virtual occurrences of one series inside `[from, to]`.
    pub async fn expand_series(
        &self,
        series_id: &Id,
        from: i64,
        to: i64,
    ) -> Result<Vec<OccurrenceDto>> {
        let anchor: Option<Task> = sqlx::query_as(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE id = ? AND series_id = id AND deleted_at IS NULL"
        ))
        .bind(series_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(anchor) = anchor else {
            return Ok(vec![]);
        };

        // Already-materialised rows for this series inside the window.
        let rows: Vec<Task> = sqlx::query_as(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE series_id = ? AND deleted_at IS NULL \
             AND occurrence_at IS NOT NULL AND occurrence_at BETWEEN ? AND ? \
             ORDER BY occurrence_at"
        ))
        .bind(series_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;

        let mut out: Vec<OccurrenceDto> = rows
            .iter()
            .map(|t| OccurrenceDto {
                task_id: Some(t.id.clone()),
                series_id: series_id.clone(),
                title: t.title.clone(),
                occurrence_at: t.occurrence_at.unwrap_or(0),
                materialized: true,
                status: Status::parse(&t.status),
            })
            .collect();
        let seen: std::collections::HashSet<i64> =
            out.iter().map(|o| o.occurrence_at).collect();

        // Virtual occurrences from the rule for times not yet materialised.
        if let (Some(rule_str), Some(anchor_ms)) =
            (anchor.recurrence_rule.as_deref(), anchor.occurrence_at)
        {
            if let Ok(rule) = RecurrenceRule::parse(rule_str) {
                for when in rule.expand(anchor_ms, from, to, 1000) {
                    if seen.contains(&when) {
                        continue;
                    }
                    out.push(OccurrenceDto {
                        task_id: None,
                        series_id: series_id.clone(),
                        title: anchor.title.clone(),
                        occurrence_at: when,
                        materialized: false,
                        status: None,
                    });
                }
            }
        }
        out.sort_by_key(|o| o.occurrence_at);
        Ok(out)
    }

    /// Everything the calendar shows in `[from, to]`: tasks whose start/due falls
    /// in the window, plus virtual occurrences of recurring series.
    ///
    /// `project_id` narrows the window to one project — what the project view's
    /// calendar mode asks for. The narrowing happens in SQL rather than in the
    /// caller because the task read is capped: filtering a capped page afterwards
    /// would silently drop everything past the cap.
    pub async fn calendar(
        &self,
        from: i64,
        to: i64,
        project_id: Option<&str>,
    ) -> Result<Vec<CalendarItemDto>> {
        // Materialised tasks with a start or due in the window.
        let page = self
            .list_tasks(&TaskFilter {
                sort: Sort::DueAsc,
                include_completed: true,
                limit: Some(1000),
                project_ids: project_id.map(|p| vec![p.to_string()]),
                ..Default::default()
            })
            .await?;

        let mut items: Vec<CalendarItemDto> = page
            .items
            .into_iter()
            .filter(|t| {
                let s = t.start_at.unwrap_or(i64::MAX);
                let d = t.due_at.unwrap_or(i64::MIN);
                (t.start_at.is_some() && s >= from && s <= to)
                    || (t.due_at.is_some() && d >= from && d <= to)
            })
            .map(|t| CalendarItemDto {
                task_id: Some(t.id),
                series_id: t.series_id,
                title: t.title,
                start_at: t.start_at,
                due_at: t.due_at,
                all_day: t.all_day,
                status: t.status,
                virtual_occurrence: false,
            })
            .collect();

        // Virtual occurrences for every series anchor in scope. The project clause
        // is a separate statement rather than a bound `IS ?`: an unfiled task has a
        // NULL project, so `project_id IS NULL` would drop every real project's
        // series out of the global calendar.
        let anchors: Vec<(String,)> = match project_id {
            Some(pid) => {
                sqlx::query_as(
                    "SELECT id FROM tasks WHERE series_id = id AND recurrence_rule IS NOT NULL \
                     AND deleted_at IS NULL AND project_id = ?",
                )
                .bind(pid)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query_as(
                    "SELECT id FROM tasks WHERE series_id = id AND recurrence_rule IS NOT NULL \
                     AND deleted_at IS NULL",
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        for (series_id,) in anchors {
            for occ in self.expand_series(&series_id, from, to).await? {
                if occ.materialized {
                    continue;
                }
                items.push(CalendarItemDto {
                    task_id: None,
                    series_id: Some(occ.series_id.clone()),
                    title: occ.title,
                    start_at: Some(occ.occurrence_at),
                    due_at: Some(occ.occurrence_at),
                    all_day: true,
                    status: Status::Todo,
                    virtual_occurrence: true,
                });
            }
        }

        items.sort_by_key(|i| i.due_at.or(i.start_at).unwrap_or(i64::MAX));
        Ok(items)
    }
}
