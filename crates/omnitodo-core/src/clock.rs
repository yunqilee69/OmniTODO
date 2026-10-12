use chrono::{DateTime, Local, Utc};

/// Current time as Unix milliseconds (UTC). All persisted instants use this unit.
pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// Render an instant as an RFC3339 local timestamp (for CLI / logging only).
pub fn to_rfc3339_local(ms: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&Local).to_rfc3339())
        .unwrap_or_else(|| ms.to_string())
}
