//! Embedded MCP HTTP server (design §4.2/§11.2), running inside the app process
//! so it can also emit UI-refresh events. stdio instances remain separate.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;
use tauri::Emitter;

use omnitodo_core::service::Core;
use omnitodo_mcp::protocol;
use omnitodo_mcp::tools::ToolContext;

use crate::state::HttpServerHandle;

#[derive(Clone)]
struct Ctx {
    tool: ToolContext,
    token: String,
    app: tauri::AppHandle,
}

pub async fn start(
    port: u16,
    token: String,
    core: Core,
    write_enabled: bool,
    app: tauri::AppHandle,
) -> std::io::Result<HttpServerHandle> {
    let shutdown = Arc::new(tokio::sync::Notify::new());
    let handle = HttpServerHandle {
        port,
        shutdown: shutdown.clone(),
    };

    let ctx = Ctx {
        tool: ToolContext::new(core, write_enabled, "http"),
        token,
        app,
    };
    let router = Router::new()
        .route("/mcp", post(handle_mcp))
        .with_state(ctx);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown.notified().await })
            .await;
    });
    Ok(handle)
}

async fn handle_mcp(State(ctx): State<Ctx>, headers: HeaderMap, body: String) -> impl IntoResponse {
    let ok = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .map(|v| v == format!("Bearer {}", ctx.token))
        .unwrap_or(false);
    if !ok {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let msg: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("bad json: {e}")).into_response(),
    };

    let is_write = msg.get("method").and_then(|m| m.as_str()) == Some("tools/call");
    let resp = protocol::handle_message(&ctx.tool, &msg).await;

    // Writes performed through the embedded server refresh the UI directly.
    if is_write && ctx.tool.write_enabled {
        let _ = ctx.app.emit("task:updated", serde_json::json!({ "source": "mcp-http" }));
    }

    match resp {
        Some(r) => Json(r).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}
