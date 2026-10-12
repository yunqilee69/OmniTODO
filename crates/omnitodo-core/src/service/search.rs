use crate::domain::*;
use crate::error::Result;
use crate::service::Core;

impl Core {
    /// Full-text search over title/description/tags with an optional filter.
    /// Queries shorter than 3 characters fall back to `LIKE` (design §5.4).
    pub async fn search(&self, query: &str, filter: &TaskFilter) -> Result<Page<TaskDto>> {
        let mut f = filter.clone();
        f.search_text = Some(query.to_string());
        self.list_tasks(&f).await
    }

    /// Rebuild the FTS index from scratch.
    pub async fn rebuild_fts(&self) -> Result<()> {
        sqlx::query("DELETE FROM tasks_fts").execute(&self.pool).await?;
        sqlx::query(
            "INSERT INTO tasks_fts (task_id, title, description, tags_text) \
             SELECT id, title, COALESCE(description, ''), tags_text FROM tasks WHERE deleted_at IS NULL",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
