use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::Result;
use crate::service::Core;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    pub key: String,
    pub open: i64,
    pub completed: i64,
    pub overdue: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSummary {
    pub total: i64,
    pub open: i64,
    /// Live tasks currently `done`. Not bounded by `from`/`to`.
    pub completed: i64,
    /// Rows in `task_completions` inside `from`/`to`. Soft-deleted tasks are
    /// excluded, so this is the sum of `throughput` rather than a second count
    /// of `completed`.
    pub completed_in_window: i64,
    pub overdue: i64,
    pub due_soon: i64,
    pub by_project: Vec<Bucket>,
    pub by_priority: Vec<Bucket>,
    pub by_status: Vec<(String, i64)>,
    pub by_tag: Vec<Bucket>,
    pub throughput: Vec<(String, i64)>,
    pub avg_time_to_complete_ms: Option<i64>,
    pub on_time_rate: Option<f64>,
    pub overdue_list: Vec<TaskDto>,
    pub upcoming_list: Vec<TaskDto>,
}

/// `from`/`to` bound the completion window; `group_by` selects throughput buckets.
pub async fn summary(
    core: &Core,
    from_ms: i64,
    to_ms: i64,
    project_ids: Option<Vec<Id>>,
    group_by_day: bool,
) -> Result<ReportSummary> {
    let now = now_ms();
    let scope = project_ids.unwrap_or_default();

    // Totals for the live task set (open/overdue are "as of now").
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT \
           COUNT(*) AS total, \
           SUM(CASE WHEN status IN ('todo','in_progress') THEN 1 ELSE 0 END) AS open, \
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed, \
           SUM(CASE WHEN due_at IS NOT NULL AND due_at < ",
    );
    qb.push_bind(now);
    qb.push(" AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS overdue, \
             SUM(CASE WHEN due_at IS NOT NULL AND due_at BETWEEN ");
    qb.push_bind(now);
    qb.push(" AND ");
    qb.push_bind(now + 7 * 86_400_000);
    qb.push(" AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS due_soon \
             FROM tasks WHERE deleted_at IS NULL");
    if !scope.is_empty() {
        qb.push(" AND project_id IN (");
        for (i, p) in scope.iter().enumerate() {
            if i > 0 {
                qb.push(",");
            }
            qb.push_bind(p.clone());
        }
        qb.push(")");
    }
    let row = qb.build().fetch_one(&core.pool).await?;
    let total: i64 = row.try_get::<Option<i64>, _>("total")?.unwrap_or(0);
    let open: i64 = row.try_get::<Option<i64>, _>("open")?.unwrap_or(0);
    let completed: i64 = row.try_get::<Option<i64>, _>("completed")?.unwrap_or(0);
    let overdue: i64 = row.try_get::<Option<i64>, _>("overdue")?.unwrap_or(0);
    let due_soon: i64 = row.try_get::<Option<i64>, _>("due_soon")?.unwrap_or(0);

    let by_project = group_counts(
        core,
        &scope,
        "COALESCE(p.name, '(Inbox)')",
        "LEFT JOIN projects p ON p.id = t.project_id",
    )
    .await?;
    let by_priority = group_counts(core, &scope, "CAST(t.priority AS TEXT)", "").await?;
    let by_tag = group_counts(
        core,
        &scope,
        "g.name",
        "LEFT JOIN task_tags tt ON tt.task_id = t.id LEFT JOIN tags g ON g.id = tt.tag_id",
    )
    .await?;

    let by_status: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*) FROM tasks WHERE deleted_at IS NULL GROUP BY status",
    )
    .fetch_all(&core.pool)
    .await?;

    // Throughput from completion history, bucketed by day or month.
    // Only completions whose task is still live: a soft-deleted task stays in
    // `task_completions`, and counting it makes the window disagree with the
    // snapshot above.
    let fmt = if group_by_day { "%Y-%m-%d" } else { "%Y-%m" };
    let throughput: Vec<(String, i64)> = sqlx::query_as(
        "SELECT strftime(?, c.completed_at / 1000, 'unixepoch') AS period, COUNT(*) \
         FROM task_completions c \
         JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL \
         WHERE c.completed_at BETWEEN ? AND ? GROUP BY period ORDER BY period",
    )
    .bind(fmt)
    .bind(from_ms)
    .bind(to_ms)
    .fetch_all(&core.pool)
    .await?;
    let completed_in_window: i64 = throughput.iter().map(|(_, n)| n).sum();

    let avg_row = sqlx::query(
        "SELECT AVG(c.completed_at - t.created_at) AS avg_ms \
         FROM task_completions c \
         JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL \
         WHERE c.completed_at BETWEEN ? AND ?",
    )
    .bind(from_ms)
    .bind(to_ms)
    .fetch_one(&core.pool)
    .await?;
    let avg_time_to_complete_ms: Option<i64> = avg_row
        .try_get::<Option<f64>, _>("avg_ms")?
        .map(|v| v as i64);

    let on_time_row = sqlx::query(
        "SELECT SUM(CASE WHEN c.was_on_time = 1 THEN 1 ELSE 0 END) AS ok, \
                SUM(CASE WHEN c.was_on_time IS NOT NULL THEN 1 ELSE 0 END) AS total \
         FROM task_completions c \
         JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL \
         WHERE c.completed_at BETWEEN ? AND ?",
    )
    .bind(from_ms)
    .bind(to_ms)
    .fetch_one(&core.pool)
    .await?;
    let ok: i64 = on_time_row.try_get::<Option<i64>, _>("ok")?.unwrap_or(0);
    let tot: i64 = on_time_row.try_get::<Option<i64>, _>("total")?.unwrap_or(0);
    let on_time_rate = if tot > 0 {
        Some(ok as f64 / tot as f64)
    } else {
        None
    };

    let overdue_list = core
        .list_tasks(&TaskFilter {
            due_before: Some(now),
            include_completed: false,
            sort: Sort::DueAsc,
            limit: Some(20),
            ..Default::default()
        })
        .await?
        .items;

    let upcoming_list = core
        .list_tasks(&TaskFilter {
            due_after: Some(now),
            due_before: Some(now + 7 * 86_400_000),
            include_completed: false,
            sort: Sort::DueAsc,
            limit: Some(20),
            ..Default::default()
        })
        .await?
        .items;

    Ok(ReportSummary {
        total,
        open,
        completed,
        completed_in_window,
        overdue,
        due_soon,
        by_project,
        by_priority,
        by_tag,
        by_status,
        throughput,
        avg_time_to_complete_ms,
        on_time_rate,
        overdue_list,
        upcoming_list,
    })
}

async fn group_counts(
    core: &Core,
    scope: &[Id],
    key_expr: &str,
    join: &str,
) -> Result<Vec<Bucket>> {
    let now = now_ms();
    let mut sql = format!(
        "SELECT {key_expr} AS k, \
           SUM(CASE WHEN t.status IN ('todo','in_progress') THEN 1 ELSE 0 END) AS open, \
           SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed, \
           SUM(CASE WHEN t.due_at IS NOT NULL AND t.due_at < ? AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS overdue \
         FROM tasks t {join} WHERE t.deleted_at IS NULL"
    );
    if !scope.is_empty() {
        let ph = vec!["?"; scope.len()].join(",");
        sql.push_str(&format!(" AND t.project_id IN ({ph})"));
    }
    sql.push_str(" GROUP BY k ORDER BY open DESC");

    let mut q = sqlx::query(&sql).bind(now);
    for p in scope {
        q = q.bind(p);
    }
    let rows = q.fetch_all(&core.pool).await?;
    let mut out = Vec::new();
    for r in rows {
        let key: Option<String> = r.try_get("k")?;
        out.push(Bucket {
            key: key.unwrap_or_else(|| "(none)".to_string()),
            open: r.try_get::<Option<i64>, _>("open")?.unwrap_or(0),
            completed: r.try_get::<Option<i64>, _>("completed")?.unwrap_or(0),
            overdue: r.try_get::<Option<i64>, _>("overdue")?.unwrap_or(0),
        });
    }
    Ok(out)
}

/// Convenience for MCP/CLI: default 30-day window ending now.
pub async fn summary_default(core: &Core) -> Result<ReportSummary> {
    let now = now_ms();
    summary(core, now - 30 * 86_400_000, now, None, true).await
}
