use std::path::{Path, PathBuf};

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::clock::now_ms;
use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::{Core, ATTACHMENT_COLS};

/// Default maximum size for `blob`-stored attachments (design §5.6 / §18).
pub const BLOB_MAX_BYTES: usize = 8 * 1024 * 1024;

impl Core {
    /// Store raw bytes in the database (`storage_kind='blob'`).
    pub async fn add_blob(
        &self,
        task_id: &Id,
        file_name: &str,
        bytes: &[u8],
        mime_type: Option<String>,
    ) -> Result<AttachmentDto> {
        self.ensure_live_task(task_id).await?;
        if bytes.len() > BLOB_MAX_BYTES {
            return Err(CoreError::Validation(format!(
                "file exceeds blob limit of {BLOB_MAX_BYTES} bytes; use managed storage"
            )));
        }
        let id = Self::new_id();
        let ts = now_ms();
        let sha = hex::encode(Sha256::digest(bytes));
        sqlx::query(
            "INSERT INTO attachments (id, task_id, file_name, storage_kind, rel_path, data, \
             mime_type, size_bytes, sha256, created_at, updated_at, version, device_id) \
             VALUES (?, ?, ?, 'blob', NULL, ?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(task_id)
        .bind(file_name)
        .bind(bytes)
        .bind(&mime_type)
        .bind(bytes.len() as i64)
        .bind(&sha)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;
        self.op_log("attachment", &id, "insert", json!({ "task": task_id, "kind": "blob" }))
            .await?;
        self.get_attachment(&id).await
    }

    /// Add a `blob` attachment from a file on disk.
    pub async fn add_blob_from_path(
        &self,
        task_id: &Id,
        path: &Path,
        mime_type: Option<String>,
    ) -> Result<AttachmentDto> {
        let bytes = std::fs::read(path)?;
        let name = file_name_of(path);
        self.add_blob(task_id, &name, &bytes, mime_type).await
    }

    /// Copy a file into the content-addressed managed store (`storage_kind='managed'`).
    pub async fn add_managed(&self, task_id: &Id, src: &Path) -> Result<AttachmentDto> {
        self.ensure_live_task(task_id).await?;
        if !src.is_file() {
            return Err(CoreError::AttachmentMissing(src.display().to_string()));
        }
        let bytes = std::fs::read(src)?;
        let sha = hex::encode(Sha256::digest(&bytes));
        let rel = content_path(&sha);
        let dest = self.attachments_root.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if !dest.exists() {
            std::fs::write(&dest, &bytes)?;
        }
        let id = Self::new_id();
        let ts = now_ms();
        sqlx::query(
            "INSERT INTO attachments (id, task_id, file_name, storage_kind, rel_path, data, \
             mime_type, size_bytes, sha256, created_at, updated_at, version, device_id) \
             VALUES (?, ?, ?, 'managed', ?, NULL, NULL, ?, ?, ?, ?, 1, ?)",
        )
        .bind(&id)
        .bind(task_id)
        .bind(file_name_of(src))
        .bind(&rel)
        .bind(bytes.len() as i64)
        .bind(&sha)
        .bind(ts)
        .bind(ts)
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;
        self.op_log("attachment", &id, "insert", json!({ "task": task_id, "kind": "managed" }))
            .await?;
        self.get_attachment(&id).await
    }

    pub async fn get_attachment(&self, id: &Id) -> Result<AttachmentDto> {
        let row: Option<Attachment> = sqlx::query_as(&format!(
            "SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = ? AND deleted_at IS NULL"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let a = row.ok_or_else(|| CoreError::NotFound(format!("attachment {id}")))?;
        Ok(AttachmentDto::from_attachment(&a))
    }

    pub async fn list_attachments(&self, task_id: &Id) -> Result<Vec<AttachmentDto>> {
        let rows: Vec<Attachment> = sqlx::query_as(&format!(
            "SELECT {ATTACHMENT_COLS} FROM attachments WHERE task_id = ? AND deleted_at IS NULL \
             ORDER BY created_at"
        ))
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(AttachmentDto::from_attachment).collect())
    }

    /// Read the bytes of an attachment (blob from DB, managed from disk).
    pub async fn attachment_data(&self, id: &Id) -> Result<Vec<u8>> {
        let row: Option<(String, Option<String>, Option<Vec<u8>>)> =
            sqlx::query_as("SELECT storage_kind, rel_path, data FROM attachments WHERE id = ? AND deleted_at IS NULL")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        let (kind, rel, data) = row.ok_or_else(|| CoreError::NotFound(format!("attachment {id}")))?;
        match StorageKind::parse(&kind) {
            Some(StorageKind::Blob) => data.ok_or_else(|| CoreError::NotFound("blob data".into())),
            Some(StorageKind::Managed) => {
                let rel = rel.ok_or_else(|| CoreError::AttachmentMissing(id.clone()))?;
                let path = self.attachments_root.join(rel);
                if !path.is_file() {
                    return Err(CoreError::AttachmentMissing(path.display().to_string()));
                }
                Ok(std::fs::read(path)?)
            }
            None => Err(CoreError::Unsupported(format!("storage_kind {kind}"))),
        }
    }

    /// Absolute path a caller can hand to the OS to open (materialises blobs to temp).
    pub async fn attachment_open_path(&self, id: &Id) -> Result<PathBuf> {
        let dto = self.get_attachment(id).await?;
        match dto.storage_kind {
            StorageKind::Managed => {
                let rel = dto.rel_path.ok_or_else(|| CoreError::AttachmentMissing(id.clone()))?;
                let path = self.attachments_root.join(rel);
                if !path.is_file() {
                    return Err(CoreError::AttachmentMissing(path.display().to_string()));
                }
                Ok(path)
            }
            StorageKind::Blob => {
                let bytes = self.attachment_data(id).await?;
                let tmp = std::env::temp_dir().join(format!("omnitodo-{}-{}", id, dto.file_name));
                std::fs::write(&tmp, bytes)?;
                Ok(tmp)
            }
        }
    }

    pub async fn remove_attachment(&self, id: &Id) -> Result<()> {
        self.get_attachment(id).await?;
        let ts = now_ms();
        sqlx::query("UPDATE attachments SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .bind(ts)
            .bind(ts)
            .bind(id)
            .execute(&self.pool)
            .await?;
        self.op_log("attachment", id, "delete", json!({})).await?;
        Ok(())
    }

    /// Managed files whose backing file has disappeared from disk.
    pub async fn check_missing(&self, task_id: &Id) -> Result<Vec<Id>> {
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT id, rel_path FROM attachments WHERE task_id = ? AND deleted_at IS NULL AND storage_kind = 'managed'",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        let mut missing = Vec::new();
        for (id, rel) in rows {
            let ok = rel
                .map(|r| self.attachments_root.join(r).is_file())
                .unwrap_or(false);
            if !ok {
                missing.push(id);
            }
        }
        Ok(missing)
    }

    /// Delete managed files that no live attachment row references.
    pub async fn gc_attachments(&self) -> Result<usize> {
        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT id, rel_path FROM attachments WHERE storage_kind = 'managed' AND rel_path IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut removed = 0;
        for (id, rel) in rows {
            let Some(rel) = rel else { continue };
            let live: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM attachments WHERE rel_path = ? AND deleted_at IS NULL",
            )
            .bind(&rel)
            .fetch_one(&self.pool)
            .await?;
            if live.0 == 0 {
                let path = self.attachments_root.join(&rel);
                if path.is_file() {
                    std::fs::remove_file(&path)?;
                    removed += 1;
                }
                let _ = id;
            }
        }
        Ok(removed)
    }

    async fn ensure_live_task(&self, task_id: &Id) -> Result<()> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL")
                .bind(task_id)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|_| ())
            .ok_or_else(|| CoreError::NotFound(format!("task {task_id}")))
    }
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string())
}

/// `ab/cd/<sha256>` content-addressed relative path (design §5.6).
fn content_path(sha: &str) -> String {
    let a = &sha[0..2];
    let b = &sha[2..4];
    format!("{a}/{b}/{sha}")
}
