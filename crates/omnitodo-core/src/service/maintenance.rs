use crate::clock::now_ms;
use crate::error::Result;
use crate::service::Core;

/// Days of `op_log` to retain (design §5.8).
pub const OP_LOG_RETENTION_DAYS: i64 = 30;

impl Core {
    /// Trim change-log entries older than the retention window.
    pub async fn prune_op_log(&self) -> Result<u64> {
        let cutoff = now_ms() - OP_LOG_RETENTION_DAYS * 86_400_000;
        let res = sqlx::query("DELETE FROM op_log WHERE ts < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }

    /// Daily background maintenance: prune log, GC managed attachments, and
    /// rebuild the FTS index (design §5.8).
    pub async fn run_maintenance(&self) -> Result<MaintenanceReport> {
        let pruned = self.prune_op_log().await?;
        let gc = self.gc_attachments().await?;
        self.rebuild_fts().await?;
        Ok(MaintenanceReport {
            op_log_pruned: pruned,
            attachments_gc: gc,
        })
    }

    /// Remove soft-deleted rows older than `days` (default off in the app).
    pub async fn purge_soft_deleted(&self, days: i64) -> Result<u64> {
        let cutoff = now_ms() - days * 86_400_000;
        let mut total = 0;
        for table in ["attachments", "tasks", "projects", "tags"] {
            let res = sqlx::query(&format!(
                "DELETE FROM {table} WHERE deleted_at IS NOT NULL AND deleted_at < ?"
            ))
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
            total += res.rows_affected();
        }
        Ok(total)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MaintenanceReport {
    pub op_log_pruned: u64,
    pub attachments_gc: usize,
}
