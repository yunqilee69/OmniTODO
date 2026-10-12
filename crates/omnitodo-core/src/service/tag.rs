use serde_json::json;

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::{Core, TAG_COLS};

impl Core {
    pub async fn list_tags(&self) -> Result<Vec<TagDto>> {
        let rows: Vec<(String, String, Option<String>, i64)> = sqlx::query_as(
            "SELECT t.id, t.name, t.color, \
               (SELECT COUNT(*) FROM task_tags tt JOIN tasks k ON k.id = tt.task_id \
                WHERE tt.tag_id = t.id AND k.deleted_at IS NULL) AS count \
             FROM tags t WHERE t.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, color, count)| TagDto {
                id,
                name,
                color,
                count,
            })
            .collect())
    }

    pub async fn get_tag(&self, id: &Id) -> Result<Tag> {
        let row: Option<Tag> = sqlx::query_as(&format!(
            "SELECT {TAG_COLS} FROM tags WHERE id = ? AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        row.ok_or_else(|| CoreError::NotFound(format!("tag {id}")))
    }

    pub async fn create_tag(&self, name: &str, color: Option<String>) -> Result<TagDto> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Validation("tag name is required".into()));
        }
        let created = self.ensure_tags(&[name.to_string()]).await?;
        let (id, canonical) = created.into_iter().next().unwrap();
        if let Some(c) = &color {
            sqlx::query("UPDATE tags SET color = ?, updated_at = ? WHERE id = ?")
                .bind(c)
                .bind(now_ms())
                .bind(&id)
                .execute(&self.pool)
                .await?;
        }
        Ok(TagDto {
            id,
            name: canonical,
            color,
            count: 0,
        })
    }

    pub async fn rename_tag(&self, id: &Id, new_name: &str) -> Result<()> {
        let new_name = new_name.trim();
        if new_name.is_empty() {
            return Err(CoreError::Validation("tag name is required".into()));
        }
        self.get_tag(id).await?;
        // Guard against colliding with a live tag of the same name.
        let clash: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?",
        )
        .bind(new_name)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        if clash.is_some() {
            return Err(CoreError::Validation(format!(
                "tag '{new_name}' already exists; merge instead"
            )));
        }
        sqlx::query("UPDATE tags SET name = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .bind(new_name)
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await?;
        self.refresh_tag_affected_tasks(id).await?;
        self.op_log("tag", id, "update", json!({ "name": new_name }))
            .await?;
        Ok(())
    }

    /// Merge `from` into `to`, then soft-delete `from`.
    pub async fn merge_tags(&self, from: &Id, to: &Id) -> Result<()> {
        if from == to {
            return Ok(());
        }
        self.get_tag(from).await?;
        self.get_tag(to).await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT task_id, ? FROM task_tags WHERE tag_id = ?")
            .bind(to)
            .bind(from)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM task_tags WHERE tag_id = ?")
            .bind(from)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE tags SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .bind(now_ms())
            .bind(now_ms())
            .bind(from)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        // Refresh FTS/tags_text for tasks that now reference the target tag.
        let affected: Vec<(String,)> =
            sqlx::query_as("SELECT task_id FROM task_tags WHERE tag_id = ?")
                .bind(to)
                .fetch_all(&self.pool)
                .await?;
        for (tid,) in affected {
            self.sync_tags_text(&tid).await?;
            self.fts_upsert(&tid).await?;
        }
        self.op_log("tag", from, "delete", json!({ "merged_into": to }))
            .await?;
        Ok(())
    }

    pub async fn delete_tag(&self, id: &Id) -> Result<()> {
        self.get_tag(id).await?;
        let affected: Vec<(String,)> = sqlx::query_as("SELECT task_id FROM task_tags WHERE tag_id = ?")
            .bind(id)
            .fetch_all(&self.pool)
            .await?;
        let ts = now_ms();
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM task_tags WHERE tag_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE tags SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .bind(ts)
            .bind(ts)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        for (tid,) in affected {
            self.sync_tags_text(&tid).await?;
            self.fts_upsert(&tid).await?;
        }
        self.op_log("tag", id, "delete", json!({})).await?;
        Ok(())
    }

    async fn refresh_tag_affected_tasks(&self, tag_id: &Id) -> Result<()> {
        let affected: Vec<(String,)> = sqlx::query_as("SELECT task_id FROM task_tags WHERE tag_id = ?")
            .bind(tag_id)
            .fetch_all(&self.pool)
            .await?;
        for (tid,) in affected {
            self.sync_tags_text(&tid).await?;
            self.fts_upsert(&tid).await?;
        }
        Ok(())
    }
}
