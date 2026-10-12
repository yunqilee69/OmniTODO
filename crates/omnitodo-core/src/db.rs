use std::path::Path;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;

use crate::error::{CoreError, Result};

/// Open a connection pool against `db_path`.
///
/// Read-write pools use a single connection so that writes never contend with
/// each other inside the process (design §4.3 "short transactions, one writer").
/// Read-only pools (MCP) may use several connections; SQLite WAL allows one
/// writer plus many readers across processes.
pub async fn open_pool(db_path: &Path, read_only: bool) -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(!read_only)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_millis(5000))
        .foreign_keys(true)
        .read_only(read_only);

    let max_connections = if read_only { 4 } else { 1 };

    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(opts)
        .await?;

    Ok(pool)
}

/// Open an in-memory database (tests).
pub async fn open_memory() -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .in_memory(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    Ok(pool)
}

/// Run embedded migrations.
pub async fn migrate(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

/// Translate a raw sqlx error into a [`CoreError`], surfacing SQLITE_BUSY as
/// [`CoreError::Busy`] so callers can retry (design §4.3).
pub fn map_db_err(e: sqlx::Error) -> CoreError {
    if let sqlx::Error::Database(ref dbe) = e {
        if let Some(code) = dbe.code() {
            if code == "5" || code == "6" {
                // SQLITE_BUSY / SQLITE_LOCKED
                return CoreError::Busy;
            }
        }
    }
    CoreError::Db(e)
}
