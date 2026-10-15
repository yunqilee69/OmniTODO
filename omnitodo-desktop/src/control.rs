//! Control endpoint (design §4.5).
//!
//! External MCP instances (stdio / standalone HTTP) cannot emit Tauri events
//! into this process, so after a successful write they POST to
//! `http://127.0.0.1:<control_port>/internal/notify`, and we forward the change
//! to the webview as Tauri events that invalidate the relevant Query keys.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::state::ControlState;

#[derive(Clone)]
struct Ctx {
    /// Held behind a lock and read per request, so a token changed in Settings
    /// applies to the next callback instead of the next app launch.
    token: Arc<RwLock<String>>,
    app: AppHandle,
}

/// Bind `127.0.0.1:<port>` and serve for the rest of the process' life.
///
/// `status` is how a taken port becomes visible: the caller previously only saw
/// an `Err` it logged to stderr, while the settings panel showed a healthy
/// endpoint that could never receive a callback.
pub async fn serve(
    port: u16,
    token: Arc<RwLock<String>>,
    status: Arc<RwLock<ControlState>>,
    app: AppHandle,
) -> std::io::Result<()> {
    let ctx = Ctx { token, app };
    let router = Router::new()
        .route("/internal/notify", post(notify))
        .with_state(ctx);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            *status.write().await = ControlState::Failed(e.to_string());
            return Err(e);
        }
    };
    *status.write().await = ControlState::Listening;
    axum::serve(listener, router).await?;
    Ok(())
}

async fn notify(State(ctx): State<Ctx>, headers: HeaderMap, body: String) -> impl IntoResponse {
    // Clone before awaiting anything else: holding the guard across the event
    // emits below would keep the token lock while the webview is notified.
    let expected = ctx.token.read().await.clone();
    let authorized = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .map(|v| v == format!("Bearer {expected}"))
        .unwrap_or(false);
    if !authorized {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let payload: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("bad json: {e}")).into_response(),
    };

    // Forward each event; the frontend maps these to Query invalidations (§8.2).
    if let Some(events) = payload.get("events").and_then(|e| e.as_array()) {
        for ev in events {
            let name = ev.get("type").and_then(|t| t.as_str()).unwrap_or("task:updated");
            let _ = ctx.app.emit(name, ev.clone());
        }
    }
    StatusCode::ACCEPTED.into_response()
}

#[derive(Clone, serde::Serialize)]
pub struct ControlConfig {
    pub port: u16,
    pub token: String,
}
