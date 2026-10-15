//! JSON-RPC 2.0 message handling for the MCP `initialize` / `tools/*` surface.
//!
//! Implemented directly rather than via the `rmcp` SDK so the transport layer
//! stays trivially testable in this headless environment; the wire shape follows
//! the MCP 2024-11-05 specification.

use serde_json::{json, Value};

use crate::tools::{self, ToolContext};

pub const PROTOCOL_VERSION: &str = "2024-11-05";
pub const SERVER_NAME: &str = "omnitodo-mcp";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Handle one incoming message. Returns `None` for notifications (no reply).
pub async fn handle_message(ctx: &ToolContext, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let is_notification = id.is_none();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

    let outcome: Result<Value, (i64, String)> = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false }, "resources": {} },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
        })),
        "notifications/initialized" | "notifications/cancelled" => return None,
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools::tool_specs(ctx.write_enabled) })),
        "tools/call" => {
            let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if name.is_empty() {
                Err((-32602, "missing tool name".to_string()))
            } else {
                match tools::call_tool(ctx, name, &args).await {
                    Ok(value) => {
                        // `structuredContent` must be a JSON object. A bare array
                        // is rejected by the client ("expected record, received
                        // array") and the content is discarded with it.
                        let value = match value {
                            Value::Array(rows) => {
                                json!({ "items": rows, "count": rows.len() })
                            }
                            other => other,
                        };
                        Ok(json!({
                            "content": [{
                                "type": "text",
                                "text": serde_json::to_string_pretty(&value).unwrap_or_default()
                            }],
                            "structuredContent": value,
                            "isError": false,
                        }))
                    }
                    Err(e) => Ok(json!({
                        "content": [{ "type": "text", "text": e.to_string() }],
                        "isError": true,
                    })),
                }
            }
        }
        "resources/list" => Ok(json!({
            "resources": [
                { "uri": "omnitodo://projects", "name": "Projects", "mimeType": "application/json" }
            ]
        })),
        "" => Err((-32600, "missing method".to_string())),
        other => Err((-32601, format!("method not found: {other}"))),
    };

    if is_notification {
        return None;
    }
    let id = id.unwrap_or(Value::Null);
    Some(match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    })
}
