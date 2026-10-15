//! MCP server tests: protocol-level tool gating, plus end-to-end runs over the
//! real binary (stdio) and over HTTP.

use serde_json::{json, Value};

use omnitodo_core::domain::*;
use omnitodo_core::service::Core;
use omnitodo_mcp::protocol;
use omnitodo_mcp::tools::ToolContext;

async fn ctx(write_enabled: bool) -> (ToolContext, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let core = Core::open_in_memory(dir.path().join("att")).await.unwrap();
    (ToolContext::new(core, write_enabled, "test"), dir)
}

#[tokio::test]
async fn initialize_and_tool_listing_gate_write_tools() {
    let (ro, _d) = ctx(false).await;
    let init = protocol::handle_message(
        &ro,
        &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
    )
    .await
    .unwrap();
    assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(init["result"]["serverInfo"]["name"], "omnitodo-mcp");

    let list = protocol::handle_message(
        &ro,
        &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    )
    .await
    .unwrap();
    let names: Vec<String> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.contains(&"summary_report".to_string()));
    assert!(!names.contains(&"create_task".to_string()), "write tool must be hidden");

    // Write enabled: write tools appear.
    let (rw, _d2) = ctx(true).await;
    let list = protocol::handle_message(
        &rw,
        &json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}),
    )
    .await
    .unwrap();
    let names: Vec<String> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect();
    assert!(names.contains(&"create_task".to_string()));
}

#[tokio::test]
async fn read_tool_call_returns_structured_content() {
    let (ro, _d) = ctx(true).await;
    let _ = ro
        .core
        .create_task(CreateTaskInput {
            title: "ship".into(),
            priority: Some(Priority::High),
            ..Default::default()
        })
        .await
        .unwrap();

    let resp = protocol::handle_message(
        &ro,
        &json!({"jsonrpc":"2.0","id":9,"method":"tools/call",
                "params":{"name":"summary_report","arguments":{"days":7}}}),
    )
    .await
    .unwrap();
    assert_eq!(resp["result"]["isError"], false);
    let structured = &resp["result"]["structuredContent"];
    assert_eq!(structured["total"], 1);
    assert_eq!(structured["open"], 1);
}

#[tokio::test]
async fn write_tool_disabled_is_error_and_not_audited() {
    let (ro, _d) = ctx(false).await;
    let resp = protocol::handle_message(
        &ro,
        &json!({"jsonrpc":"2.0","id":5,"method":"tools/call",
                "params":{"name":"create_task","arguments":{"title":"x"}}}),
    )
    .await
    .unwrap();
    assert_eq!(resp["result"]["isError"], true);
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM mcp_audit")
        .fetch_one(&ro.core.pool)
        .await
        .unwrap();
    assert_eq!(count.0, 0);
}

#[tokio::test]
async fn write_tool_audited_when_enabled() {
    let (rw, _d) = ctx(true).await;
    let resp = protocol::handle_message(
        &rw,
        &json!({"jsonrpc":"2.0","id":6,"method":"tools/call",
                "params":{"name":"create_task","arguments":{"title":"from agent","priority":"high"}}}),
    )
    .await
    .unwrap();
    assert_eq!(resp["result"]["isError"], false);
    assert_eq!(resp["result"]["structuredContent"]["title"], "from agent");

    let row: (String, i64, String) =
        sqlx::query_as("SELECT tool, ok, transport FROM mcp_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&rw.core.pool)
            .await
            .unwrap();
    assert_eq!(row.0, "create_task");
    assert_eq!(row.1, 1);
    assert_eq!(row.2, "test");
}

/// Tools that naturally return a list must still hand the client an object:
/// MCP rejects a `structuredContent` that is an array ("expected record").
#[tokio::test]
async fn list_tools_return_an_object_not_an_array() {
    let (rw, _d) = ctx(true).await;
    rw.core
        .create_project(CreateProjectInput { name: "智搭".into(), ..Default::default() })
        .await
        .unwrap();

    for (name, args) in [
        ("list_projects", json!({})),
        ("list_tags", json!({})),
        ("list_upcoming", json!({ "days": 30 })),
        ("list_calendar", json!({ "days": 7 })),
        ("list_subtasks", json!({ "id": "does-not-exist" })),
        ("list_attachments", json!({ "task_id": "does-not-exist" })),
        ("list_due_reminders", json!({ "days": 7 })),
    ] {
        let resp = protocol::handle_message(
            &rw,
            &json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
                    "params":{"name":name,"arguments":args}}),
        )
        .await
        .unwrap();
        assert_eq!(resp["result"]["isError"], false, "{name} errored: {resp}");
        let structured = &resp["result"]["structuredContent"];
        assert!(structured.is_object(), "{name} structuredContent must be an object, got {structured}");
        assert!(structured.get("items").unwrap().is_array(), "{name} must wrap its rows in items");
    }
}

/// `list_tasks` defaults to open tasks, and its own arguments select the rest:
/// completion scope, priority, a time window, and a project by name or id.
#[tokio::test]
async fn list_tasks_defaults_to_open_and_filters() {
    let (rw, _d) = ctx(true).await;
    let project = rw
        .core
        .create_project(CreateProjectInput { name: "智搭".into(), ..Default::default() })
        .await
        .unwrap();
    let open = rw
        .core
        .create_task(CreateTaskInput {
            title: "还没做".into(),
            project_id: Some(project.id.clone()),
            priority: Some(Priority::High),
            due_at: Some(1_700_000_000_000),
            ..Default::default()
        })
        .await
        .unwrap();
    let done = rw
        .core
        .create_task(CreateTaskInput {
            title: "做完了".into(),
            project_id: Some(project.id.clone()),
            priority: Some(Priority::Low),
            due_at: Some(1_800_000_000_000),
            ..Default::default()
        })
        .await
        .unwrap();
    rw.core.complete_task(&done.id).await.unwrap();

    let call = |args: Value| {
        let rw = rw.clone();
        async move {
            protocol::handle_message(
                &rw,
                &json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
                        "params":{"name":"list_tasks","arguments":args}}),
            )
            .await
            .unwrap()
        }
    };

    // No arguments: only the task that is still open.
    let resp = call(json!({})).await;
    assert_eq!(resp["result"]["isError"], false, "{resp}");
    assert_eq!(resp["result"]["structuredContent"]["total"], 1);
    assert_eq!(resp["result"]["structuredContent"]["items"][0]["id"], open.id);

    // Completed only, selected by the project name rather than its id.
    let resp = call(json!({ "scope": "completed", "project": "智搭" })).await;
    assert_eq!(resp["result"]["structuredContent"]["total"], 1, "{resp}");
    assert_eq!(resp["result"]["structuredContent"]["items"][0]["id"], done.id);

    // Everything in the project.
    let resp = call(json!({ "scope": "all", "project": "智搭" })).await;
    assert_eq!(resp["result"]["structuredContent"]["total"], 2, "{resp}");

    // Priority narrows the open set down to the high one.
    let resp = call(json!({ "priorities": ["high"] })).await;
    assert_eq!(resp["result"]["structuredContent"]["total"], 1, "{resp}");
    assert_eq!(resp["result"]["structuredContent"]["items"][0]["id"], open.id);

    // A due window that contains only the completed task, once completed are included.
    let resp = call(json!({
        "scope": "all",
        "due_after": 1_750_000_000_000i64,
        "due_before": 1_850_000_000_000i64
    }))
    .await;
    assert_eq!(resp["result"]["structuredContent"]["total"], 1, "{resp}");
    assert_eq!(resp["result"]["structuredContent"]["items"][0]["id"], done.id);

    // The same arguments drive search and export, which previously dropped them.
    let resp = call_tool(&rw, "search_tasks", json!({ "query": "做完", "scope": "completed" })).await;
    assert_eq!(resp["result"]["structuredContent"]["total"], 1, "{resp}");
    let resp = call_tool(&rw, "export_tasks", json!({ "scope": "completed", "project": "智搭" })).await;
    let data = resp["result"]["structuredContent"]["data"].as_str().unwrap();
    assert!(data.contains("做完了"), "export missed the completed task: {data}");
    assert!(!data.contains("还没做"), "export included an open task: {data}");
}

/// `get_project` is what a caller reaches for after `summary_report` names a
/// project, so the name has to work as well as the id.
#[tokio::test]
async fn get_project_accepts_a_name() {
    let (rw, _d) = ctx(true).await;
    let project = rw
        .core
        .create_project(CreateProjectInput { name: "智搭".into(), ..Default::default() })
        .await
        .unwrap();

    let resp = call_tool(&rw, "get_project", json!({ "id": "智搭" })).await;
    assert_eq!(resp["result"]["isError"], false, "{resp}");
    assert_eq!(resp["result"]["structuredContent"]["id"], project.id);

    let resp = call_tool(&rw, "get_project", json!({ "id": "没有这个项目" })).await;
    assert_eq!(resp["result"]["isError"], true, "{resp}");
}

async fn call_tool(ctx: &ToolContext, name: &str, args: Value) -> Value {
    protocol::handle_message(
        ctx,
        &json!({"jsonrpc":"2.0","id":1,"method":"tools/call",
                "params":{"name":name,"arguments":args}}),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn unknown_method_returns_jsonrpc_error() {
    let (ro, _d) = ctx(false).await;
    let resp = protocol::handle_message(&ro, &json!({"jsonrpc":"2.0","id":7,"method":"nope"}))
        .await
        .unwrap();
    assert_eq!(resp["error"]["code"], -32601);
}

// ---------------------------------------------------------------------------
// end-to-end over the real binary
// ---------------------------------------------------------------------------

#[test]
fn stdio_binary_end_to_end() {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};

    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("omnitodo.db");
    let bin = env!("CARGO_BIN_EXE_omnitodo-mcp");

    let mut child = Command::new(bin)
        .arg("--db")
        .arg(&db)
        .arg("--write")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn mcp");

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());

    let send = |stdin: &mut std::process::ChildStdin, v: Value| {
        writeln!(stdin, "{v}").unwrap();
        stdin.flush().unwrap();
    };
    let read = |r: &mut BufReader<std::process::ChildStdout>| -> Value {
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        serde_json::from_str(line.trim()).unwrap()
    };

    send(&mut stdin, json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));
    let init = read(&mut stdout);
    assert_eq!(init["result"]["serverInfo"]["name"], "omnitodo-mcp");

    send(&mut stdin, json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
    send(&mut stdin, json!({"jsonrpc":"2.0","id":2,"method":"tools/call",
        "params":{"name":"create_task","arguments":{"title":"e2e task","due_at": 1893456000000i64}}}));
    let created = read(&mut stdout);
    assert_eq!(created["result"]["isError"], false);
    assert_eq!(created["result"]["structuredContent"]["title"], "e2e task");

    send(&mut stdin, json!({"jsonrpc":"2.0","id":3,"method":"tools/call",
        "params":{"name":"list_tasks","arguments":{"filter":{}}}}));
    let listed = read(&mut stdout);
    assert_eq!(listed["result"]["structuredContent"]["total"], 1);

    drop(stdin);
    let _ = child.wait();
}

#[test]
fn http_transport_end_to_end() {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("omnitodo.db");
    // Pre-create + migrate so the read-only HTTP instance has a schema.
    {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let core = Core::open(&db, false).await.unwrap();
            core.create_task(CreateTaskInput { title: "http seed".into(), ..Default::default() })
                .await
                .unwrap();
        });
    }

    // Find a free port.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };

    let bin = env!("CARGO_BIN_EXE_omnitodo-mcp");
    let mut child = Command::new(bin)
        .args([
            "--db",
            db.to_str().unwrap(),
            "--http",
            "--port",
            &port.to_string(),
            "--token",
            "secret",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn http mcp");

    // Wait for the listener.
    let mut ready = false;
    for _ in 0..50 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(ready, "http server did not start");

    let call = |auth: Option<&str>, body: &str| -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let auth_hdr = auth
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        let req = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{auth_hdr}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        resp
    };

    // No token -> 401.
    let resp = call(None, r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    assert!(resp.contains("401"), "expected 401, got: {}", resp.lines().next().unwrap_or(""));

    // With token -> result.
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{}}}"#;
    let resp = call(Some("secret"), body);
    assert!(resp.contains("200"));
    assert!(resp.contains("http seed"), "response body missing task: {resp}");

    let _ = child.kill();
    let _ = child.wait();
}
