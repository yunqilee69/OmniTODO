//! `omnitodo-mcp`: standalone MCP server.
//!
//! Two transports, one per process invocation (design §11.2 — stdio and HTTP
//! may run at the same time as separate instances):
//!   omnitodo-mcp --db <path>                      # stdio, read-only
//!   omnitodo-mcp --db <path> --write              # stdio, write tools enabled
//!   omnitodo-mcp --db <path> --http --port 8787 --token <t>
//! Callback: after a successful write the server pokes the desktop app's
//! control endpoint when `--notify <url> --notify-token <t>` is given (§4.5).

use std::path::PathBuf;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use omnitodo_core::config;
use omnitodo_core::error::Result as CoreResult;
use omnitodo_core::service::Core;
use omnitodo_mcp::protocol;
use omnitodo_mcp::tools::ToolContext;

#[derive(Parser)]
#[command(name = "omnitodo-mcp", version, about = "OmniTODO MCP server")]
struct Args {
    /// Database path (default: platform data dir).
    #[arg(long)]
    db: Option<PathBuf>,
    /// Open the database read-write and register write tools.
    #[arg(long)]
    write: bool,
    /// Serve streamable HTTP instead of stdio.
    #[arg(long)]
    http: bool,
    /// HTTP port (127.0.0.1 only).
    #[arg(long, default_value_t = 8787)]
    port: u16,
    /// Bearer token required by the HTTP transport.
    #[arg(long)]
    token: Option<String>,
    /// Desktop app control endpoint for change callbacks, e.g. http://127.0.0.1:8788/internal/notify
    #[arg(long)]
    notify: Option<String>,
    /// Bearer token for the control endpoint.
    #[arg(long)]
    notify_token: Option<String>,
}

#[derive(Clone)]
struct AppState {
    ctx: ToolContext,
    token: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("omnitodo-mcp: {e}");
        std::process::exit(1);
    }
}

async fn run() -> CoreResult<()> {
    let args = Args::parse();
    let db_path = args.db.clone().unwrap_or_else(config::db_path);
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let core = Core::open(&db_path, !args.write).await?;
    let transport: &'static str = if args.http { "http" } else { "stdio" };
    let ctx = ToolContext::new(core, args.write, transport);

    // Effective write gating: honour an explicit `mcp.write_enabled=false`.
    if args.write {
        if let Some(Value::Bool(false)) = ctx.core.setting_get("mcp.write_enabled").await? {
            eprintln!("note: mcp.write_enabled=false in settings; write tools remain off");
        }
    }

    if args.http {
        serve_http(ctx, args.port, args.token).await
    } else {
        serve_stdio(ctx, args.notify, args.notify_token).await
    }
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

async fn serve_stdio(
    ctx: ToolContext,
    notify: Option<String>,
    notify_token: Option<String>,
) -> CoreResult<()> {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();

    while let Some(line) = reader.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                let err = serde_json::json!({
                    "jsonrpc": "2.0", "id": Value::Null,
                    "error": { "code": -32700, "message": format!("parse error: {e}") }
                });
                stdout.write_all(format!("{err}\n").as_bytes()).await?;
                stdout.flush().await?;
                continue;
            }
        };

        let is_write_call = msg.get("method").and_then(|m| m.as_str()) == Some("tools/call");
        if let Some(resp) = protocol::handle_message(&ctx, &msg).await {
            stdout.write_all(format!("{resp}\n").as_bytes()).await?;
            stdout.flush().await?;
        }
        if is_write_call && ctx.write_enabled {
            if let Some(url) = &notify {
                notify_control(url, notify_token.as_deref(), &msg).await;
            }
        }
    }
    Ok(())
}

/// Fire-and-forget change callback to the desktop app (design §4.5).
async fn notify_control(url: &str, token: Option<&str>, msg: &Value) {
    let mut payload = serde_json::json!({ "source": "mcp", "events": [] });
    if let Some(name) = msg
        .get("params")
        .and_then(|p| p.get("name"))
        .and_then(|n| n.as_str())
    {
        payload["events"] = serde_json::json!([{ "type": map_event(name), "tool": name }]);
    }
    let _ = try_notify(url, token, &payload).await;
}

fn map_event(tool: &str) -> &'static str {
    match tool {
        "delete_task" => "task:deleted",
        "create_task" | "add_subtask" => "task:created",
        _ => "task:updated",
    }
}

async fn try_notify(url: &str, token: Option<&str>, payload: &Value) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt as _;
    // Strip scheme; only http over 127.0.0.1 is supported.
    let rest = url.trim_start_matches("http://");
    let (host_port, path) = match rest.split_once('/') {
        Some((h, p)) => (h, format!("/{p}")),
        None => (rest, "/".to_string()),
    };
    let mut stream = tokio::net::TcpStream::connect(host_port).await?;
    let body = payload.to_string();
    let mut req = format!(
        "POST {path} HTTP/1.1\r\nHost: {host_port}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(t) = token {
        req.push_str(&format!("Authorization: Bearer {t}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(&body);
    stream.write_all(req.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

async fn serve_http(ctx: ToolContext, port: u16, token: Option<String>) -> CoreResult<()> {
    let state = AppState { ctx, token };
    let app = Router::new()
        .route("/mcp", post(mcp_handler))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(omnitodo_core::error::CoreError::Io)?;
    eprintln!("omnitodo-mcp: listening on http://127.0.0.1:{port}/mcp");
    axum::serve(listener, app)
        .await
        .map_err(|e| omnitodo_core::error::CoreError::Io(std::io::Error::other(e)))?;
    Ok(())
}

async fn mcp_handler(State(state): State<AppState>, headers: HeaderMap, body: String) -> Response {
    if let Some(expected) = &state.token {
        let ok = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .map(|v| v == format!("Bearer {expected}"))
            .unwrap_or(false);
        if !ok {
            return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
        }
    }
    let msg: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("bad json: {e}")).into_response(),
    };
    match protocol::handle_message(&state.ctx, &msg).await {
        Some(resp) => Json(resp).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}
