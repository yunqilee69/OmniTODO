//! Shared application state for the Tauri commands.

use std::sync::Arc;

use omnitodo_core::error::CoreError;
use omnitodo_core::service::endpoint;
use omnitodo_core::service::reminder::ReminderHit;
use omnitodo_core::service::Core;
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    pub core: Core,
    /// Handle to the embedded MCP HTTP server, if running (design §11.2).
    pub http_server: Mutex<Option<HttpServerHandle>>,
    /// Port/token the embedded HTTP MCP server would bind.
    pub http_port: u16,
    /// Behind a lock so a token edited in Settings takes effect on the next
    /// request, without restarting the embedded server (design §11.2).
    pub http_token: Arc<RwLock<String>>,
    /// Control endpoint port/token used by external MCP instances to notify
    /// the UI of writes (design §4.5).
    pub control_port: u16,
    /// Same reason as [`Self::http_token`]: the control endpoint must honour a
    /// token change without a restart.
    pub control_token: Arc<RwLock<String>>,
    /// What happened when the control endpoint tried to bind (design §4.5).
    /// The settings panel reads this so a taken port is visible instead of
    /// failing silently in a log line.
    pub control_state: Arc<RwLock<ControlState>>,
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
        // Persisted, not generated per launch: a token pasted into a client
        // config has to outlive the process (design §4.4, amended 2026-10-15).
        let control_token = core.endpoint_token(endpoint::CONTROL_TOKEN_KEY).await?;
        let http_token = core.endpoint_token(endpoint::HTTP_TOKEN_KEY).await?;
        Ok(Self {
            core,
            http_server: Mutex::new(None),
            http_port: 8787,
            http_token: Arc::new(RwLock::new(http_token)),
            control_port: 8788,
            control_token: Arc::new(RwLock::new(control_token)),
            control_state: Arc::new(RwLock::new(ControlState::Starting)),
            missed_reminders: Mutex::new(Vec::new()),
        })
    }
}

/// Outcome of binding the loopback control endpoint.
#[derive(Clone, Debug)]
pub enum ControlState {
    Starting,
    Listening,
    Failed(String),
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
