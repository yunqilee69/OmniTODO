//! Shared application state for the Tauri commands.

use std::sync::Arc;

use omnitodo_core::error::CoreError;
use omnitodo_core::service::reminder::ReminderHit;
use omnitodo_core::service::Core;
use tokio::sync::Mutex;

pub struct AppState {
    pub core: Core,
    /// Handle to the embedded MCP HTTP server, if running (design §11.2).
    pub http_server: Mutex<Option<HttpServerHandle>>,
    /// Port/token the embedded HTTP MCP server would bind.
    pub http_port: u16,
    pub http_token: String,
    /// Control endpoint port/token used by external MCP instances to notify
    /// the UI of writes (design §4.5).
    pub control_port: u16,
    pub control_token: String,
    /// Reminders missed while the app was closed (design §9.2), parked here at
    /// startup and drained by `reminder_missed`.
    ///
    /// The tick's startup emit races the webview's event listener — setup runs
    /// before the frontend has registered — so the event alone would silently
    /// drop the catch-up panel. The UI reads this list on mount instead, which
    /// makes delivery independent of that race; the event stays for windows
    /// that happen to be listening already.
    pub missed_reminders: Mutex<Vec<ReminderHit>>,
}

#[derive(Clone)]
pub struct HttpServerHandle {
    pub port: u16,
    pub shutdown: Arc<tokio::sync::Notify>,
}

impl AppState {
    pub async fn new() -> Result<Self, CoreError> {
        let core = Core::open_default(false).await?;
        Ok(Self {
            core,
            http_server: Mutex::new(None),
            http_port: 8787,
            http_token: random_token(),
            control_port: 8788,
            control_token: random_token(),
            missed_reminders: Mutex::new(Vec::new()),
        })
    }
}

/// Random bearer token for the loopback HTTP / control endpoints.
///
/// Both bind to 127.0.0.1 only, but any local process can reach them, so the
/// token keeps them from being an unauthenticated write path (design §11.2/§4.5).
fn random_token() -> String {
    let mut s = Core::new_id();
    s.push_str(&Core::new_id());
    s.replace('-', "")
}

impl AppState {
    /// Whether the MCP write tools are enabled (design §11.4; default off).
    pub async fn mcp_write_enabled(&self) -> Result<bool, CoreError> {
        Ok(matches!(
            self.core.setting_get("mcp.write_enabled").await?,
            Some(serde_json::Value::Bool(true))
        ))
    }
}
