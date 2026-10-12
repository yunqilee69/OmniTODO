use serde::Serialize;
use thiserror::Error;

/// Errors raised by the core layer. Mapped to [`ApiError`] at the boundary
/// (Tauri commands / MCP tools) so callers can branch on a stable `code`.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("version conflict on {entity}/{id}: expected {expected}, found {found}")]
    Conflict {
        entity: String,
        id: String,
        expected: i64,
        found: i64,
    },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    /// SQLITE_BUSY after the busy timeout was exhausted; caller should retry.
    #[error("database is busy, please retry")]
    Busy,

    #[error("unsupported: {0}")]
    Unsupported(String),

    #[error("attachment file missing: {0}")]
    AttachmentMissing(String),

    #[error("ambiguous project name: {0}")]
    AmbiguousProject(String),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::NotFound(_) => "NOT_FOUND",
            CoreError::Validation(_) => "VALIDATION",
            CoreError::Conflict { .. } => "CONFLICT",
            CoreError::Io(_) => "IO",
            CoreError::Db(_) => "DB",
            CoreError::Migrate(_) => "DB",
            CoreError::Busy => "BUSY",
            CoreError::Unsupported(_) => "UNSUPPORTED",
            CoreError::AttachmentMissing(_) => "ATTACHMENT_MISSING",
            CoreError::AmbiguousProject(_) => "AMBIGUOUS_PROJECT",
        }
    }
}

/// Serializable error shape crossing the Tauri/MCP boundary.
#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl From<CoreError> for ApiError {
    fn from(e: CoreError) -> Self {
        ApiError {
            code: e.code().to_string(),
            message: e.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
