//! Control endpoint (design §4.5).
//!
//! External MCP instances (stdio / standalone HTTP) cannot emit Tauri events
//! into this process, so after a successful write they POST to
//! `http://127.0.0.1:<control_port>/internal/notify`, and we forward the change
//! to the webview as Tauri events that invalidate the relevant Query keys.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::Router;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
struct Ctx {
    token: String,
    app: AppHandle,
}

pub async fn serve(port: u16, token: String, app: AppHandle) -> std::io::Result<()> {
    let ctx = Ctx { token, app };
    let router = Router::new()
        .route("/internal/notify", post(notify))
        .with_state(ctx);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

async fn notify(State(ctx): State<Ctx>, headers: HeaderMap, body: String) -> impl IntoResponse {
    let authorized = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .map(|v| v == format!("Bearer {}", ctx.token))
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
