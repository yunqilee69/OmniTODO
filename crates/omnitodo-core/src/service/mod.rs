//! Service layer. Each service is an `impl Core` block in its own module.
//! `Core` owns the pool and knows nothing about Tauri / MCP / React.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::clock::now_ms;
use crate::config;
use crate::db;
use crate::domain::Id;
use crate::error::Result;

pub mod attachment;
pub mod calendar;
pub mod importexport;
pub mod maintenance;
pub mod project;
pub mod quickadd;
pub mod recurrence;
pub mod reminder;
pub mod report;
pub mod search;
pub mod tag;
pub mod task;

pub const TASK_COLS: &str = "id, project_id, parent_id, series_id, occurrence_at, title, description, \
     priority, status, completed_at, start_at, due_at, all_day, timezone, remind_enabled, \
     remind_at, remind_offset_min, recurrence_rule, recurrence_until, tags_text, sort_order, \
     created_at, updated_at, deleted_at, version, device_id";

pub const PROJECT_COLS: &str = "id, name, description, color, icon, sort_order, is_archived, \
     created_at, updated_at, deleted_at, version, device_id";

pub const TAG_COLS: &str = "id, name, color, created_at, updated_at, deleted_at, version, device_id";

pub const ATTACHMENT_COLS: &str =
    "id, task_id, file_name, storage_kind, rel_path, mime_type, size_bytes, sha256, \
     created_at, updated_at, deleted_at, version, device_id";

/// The core context: a database pool plus a few ambient values.
#[derive(Clone)]
pub struct Core {
    pub pool: SqlitePool,
    pub device_id: String,
    pub attachments_root: PathBuf,
}

impl Core {
    /// Open the app database at the default platform path.
    pub async fn open_default(read_only: bool) -> Result<Self> {
        let path = config::db_path();
        Self::open(&path, read_only).await
    }

    /// Open a database at an explicit path.
    pub async fn open(db_path: &Path, read_only: bool) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let pool = db::open_pool(db_path, read_only).await?;
        if !read_only {
            db::migrate(&pool).await?;
        }
        Ok(Self {
            pool,
            device_id: std::env::var("OMNITODO_DEVICE_ID").unwrap_or_else(|_| "local".to_string()),
            attachments_root: config::attachments_dir(),
        })
    }

    /// In-memory database for tests, with the managed attachment root redirected
    /// into a temp dir.
    pub async fn open_in_memory(attachments_root: PathBuf) -> Result<Self> {
        let pool = db::open_memory().await?;
        db::migrate(&pool).await?;
        std::fs::create_dir_all(&attachments_root)?;
        Ok(Self {
            pool,
            device_id: "test".to_string(),
            attachments_root,
        })
    }

    /// A fresh UUID v7 as TEXT (time-ordered primary key).
    pub fn new_id() -> Id {
        Uuid::now_v7().to_string()
    }

    // -- tag helpers --------------------------------------------------------

    /// Resolve tag names to ids, creating any that do not exist.
    pub async fn ensure_tags(&self, names: &[String]) -> Result<Vec<(Id, String)>> {
        let mut out = Vec::new();
        for raw in names {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            let existing: Option<(String, String)> =
                sqlx::query_as("SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL")
                    .bind(name)
                    .fetch_optional(&self.pool)
                    .await?;
            let (id, canonical) = match existing {
                Some(row) => row,
                None => {
                    let id = Self::new_id();
                    let ts = now_ms();
                    sqlx::query(
                        "INSERT INTO tags (id, name, created_at, updated_at, version, device_id) \
                         VALUES (?, ?, ?, ?, 1, ?)",
                    )
                    .bind(&id)
                    .bind(name)
                    .bind(ts)
                    .bind(ts)
                    .bind(&self.device_id)
                    .execute(&self.pool)
                    .await?;
                    (id, name.to_string())
                }
            };
            out.push((id, canonical));
        }
        Ok(out)
    }

    /// Replace the tag set of a task.
    pub async fn set_task_tags(&self, task_id: &Id, tag_ids: &[Id]) -> Result<()> {
        sqlx::query("DELETE FROM task_tags WHERE task_id = ?")
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        for tag_id in tag_ids {
            sqlx::query("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)")
                .bind(task_id)
                .bind(tag_id)
                .execute(&self.pool)
                .await?;
        }
        self.sync_tags_text(task_id).await?;
        self.fts_upsert(task_id).await?;
        Ok(())
    }

    pub async fn tags_of_task(&self, task_id: &Id) -> Result<(Vec<Id>, Vec<String>)> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT t.id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id \
             WHERE tt.task_id = ? AND t.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().unzip())
    }

    /// Batch-load tags for many tasks (avoids N+1 in list views).
    pub async fn tags_for_tasks(
        &self,
        task_ids: &[Id],
    ) -> Result<HashMap<Id, (Vec<Id>, Vec<String>)>> {
        let mut map: HashMap<Id, (Vec<Id>, Vec<String>)> = HashMap::new();
        if task_ids.is_empty() {
            return Ok(map);
        }
        // Chunk to stay well under SQLite's variable limit.
        for chunk in task_ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT tt.task_id, t.id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id \
                 WHERE tt.task_id IN ({placeholders}) AND t.deleted_at IS NULL \
                 ORDER BY t.name COLLATE NOCASE"
            );
            let mut q = sqlx::query_as::<_, (String, String, String)>(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            for (task_id, tag_id, name) in q.fetch_all(&self.pool).await? {
                let entry = map.entry(task_id).or_default();
                entry.0.push(tag_id);
                entry.1.push(name);
            }
        }
        Ok(map)
    }

    /// Recompute the denormalised `tags_text` used by FTS.
    pub async fn sync_tags_text(&self, task_id: &Id) -> Result<()> {
        let names: Vec<(String,)> = sqlx::query_as(
            "SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id \
             WHERE tt.task_id = ? AND t.deleted_at IS NULL",
        )
        .bind(task_id)
        .fetch_all(&self.pool)
        .await?;
        let joined = names
            .into_iter()
            .map(|(n,)| n)
            .collect::<Vec<_>>()
            .join(" ");
        sqlx::query("UPDATE tasks SET tags_text = ? WHERE id = ?")
            .bind(joined)
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // -- attachment flag ----------------------------------------------------

    pub async fn tasks_with_attachments(&self, task_ids: &[Id]) -> Result<HashSet<Id>> {
        let mut set = HashSet::new();
        if task_ids.is_empty() {
            return Ok(set);
        }
        for chunk in task_ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT DISTINCT task_id FROM attachments WHERE deleted_at IS NULL AND task_id IN ({placeholders})"
            );
            let mut q = sqlx::query_as::<_, (String,)>(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            for (id,) in q.fetch_all(&self.pool).await? {
                set.insert(id);
            }
        }
        Ok(set)
    }

    // -- full text search maintenance --------------------------------------

    /// Insert or refresh the FTS row for a task. Rows for soft-deleted tasks are
    /// removed (design §5.4).
    pub async fn fts_upsert(&self, task_id: &Id) -> Result<()> {
        sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?")
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "INSERT INTO tasks_fts (task_id, title, description, tags_text) \
             SELECT id, title, COALESCE(description, ''), tags_text FROM tasks \
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(task_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fts_delete(&self, task_id: &Id) -> Result<()> {
        sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?")
            .bind(task_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // -- change log ---------------------------------------------------------

    /// Append a change-log entry. Its retention window is 30 days (design §5.8).
    pub async fn op_log(&self, entity_type: &str, entity_id: &Id, op: &str, payload: serde_json::Value) -> Result<()> {
        sqlx::query(
            "INSERT INTO op_log (entity_type, entity_id, op, payload, ts, device_id) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(entity_type)
        .bind(entity_id)
        .bind(op)
        .bind(payload.to_string())
        .bind(now_ms())
        .bind(&self.device_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Settings KV access.
    pub async fn setting_get(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.and_then(|(v,)| serde_json::from_str(&v).ok()))
    }

    pub async fn setting_set(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value.to_string())
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Record an MCP write-tool invocation in the audit log (design §11.4).
    #[allow(clippy::too_many_arguments)]
    pub async fn mcp_audit(
        &self,
        transport: &str,
        tool: &str,
        args: &str,
        ok: i64,
        error: Option<String>,
        duration_ms: i64,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO mcp_audit (ts, transport, tool, args, ok, error, duration_ms) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(now_ms())
        .bind(transport)
        .bind(tool)
        .bind(args)
        .bind(ok)
        .bind(error)
        .bind(duration_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
