//! MCP tool registry: read tools (always) and write tools (only when enabled).
//! Every write call is recorded in `mcp_audit` (design §11.3 / §11.4).

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use omnitodo_core::clock::now_ms;
use omnitodo_core::domain::*;
use omnitodo_core::error::{CoreError, Result};
use omnitodo_core::service::importexport::ExportFormat;
use omnitodo_core::service::report;
use omnitodo_core::service::Core;

pub const READ_TOOLS: &[&str] = &[
    "list_projects",
    "get_project",
    "list_tasks",
    "get_task",
    "list_subtasks",
    "list_tags",
    "search_tasks",
    "list_upcoming",
    "list_due_reminders",
    "list_attachments",
    "summary_report",
    "list_calendar",
    "export_tasks",
];

pub const WRITE_TOOLS: &[&str] = &[
    "create_task",
    "update_task",
    "complete_task",
    "delete_task",
    "add_subtask",
    "add_tags",
    "move_task",
];

pub fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
}

#[derive(Clone)]
pub struct ToolContext {
    pub core: Core,
    pub write_enabled: bool,
    pub transport: &'static str,
}

impl ToolContext {
    pub fn new(core: Core, write_enabled: bool, transport: &'static str) -> Self {
        Self {
            core,
            write_enabled,
            transport,
        }
    }
}

/// `tools/list` payload. Write tools are omitted unless enabled.
pub fn tool_specs(write_enabled: bool) -> Vec<Value> {
    let mut specs: Vec<Value> = READ_TOOLS.iter().map(|n| spec(n, false)).collect();
    if write_enabled {
        specs.extend(WRITE_TOOLS.iter().map(|n| spec(n, true)));
    }
    specs
}

fn spec(name: &str, write: bool) -> Value {
    let (desc, schema) = describe(name);
    json!({
        "name": name,
        "description": format!("[{}] {}", if write { "write" } else { "read" }, desc),
        "inputSchema": schema,
    })
}

fn describe(name: &str) -> (&'static str, Value) {
    let empty = json!({ "type": "object", "properties": {} });
    match name {
        "list_projects" => ("List projects with open/completed/overdue counts", empty),
        "get_project" => (
            "Get one project with stats",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "list_tasks" => (
            "List tasks by filter, paginated",
            json!({"type":"object","properties":{"filter":{"type":"object"},"limit":{"type":"integer"},"offset":{"type":"integer"}}}),
        ),
        "get_task" => (
            "Get one task with tags and attachment metadata",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "list_subtasks" => (
            "List all (recursive) subtasks of a task",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "list_tags" => ("List tags with usage counts", empty),
        "search_tasks" => (
            "Full-text search with optional filter",
            json!({"type":"object","properties":{"query":{"type":"string"},"filter":{"type":"object"},"limit":{"type":"integer"}},"required":["query"]}),
        ),
        "list_upcoming" => (
            "Tasks due within the next N days (default 7)",
            json!({"type":"object","properties":{"days":{"type":"integer"}}}),
        ),
        "list_due_reminders" => (
            "Planned reminder times for the next N days",
            json!({"type":"object","properties":{"days":{"type":"integer"}}}),
        ),
        "list_attachments" => (
            "Attachment metadata for a task (never returns the binary)",
            json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]}),
        ),
        "summary_report" => (
            "Aggregated report (the core read tool)",
            json!({"type":"object","properties":{"days":{"type":"integer"},"from":{"type":"integer"},"to":{"type":"integer"}}}),
        ),
        "list_calendar" => (
            "Calendar items (materialised tasks + virtual occurrences) in a window",
            json!({"type":"object","properties":{"from":{"type":"integer"},"to":{"type":"integer"},"days":{"type":"integer"}}}),
        ),
        "export_tasks" => (
            "Serialize tasks (json|csv|markdown) without writing to disk",
            json!({"type":"object","properties":{"format":{"type":"string"},"filter":{"type":"object"}}}),
        ),
        "create_task" => (
            "Create a task using exact fields",
            json!({"type":"object","properties":{"title":{"type":"string"},"project_id":{"type":"string"},"parent_id":{"type":"string"},"description":{"type":"string"},"priority":{"type":"string"},"due_at":{"type":"integer"},"start_at":{"type":"integer"},"all_day":{"type":"boolean"},"remind_enabled":{"type":"boolean"},"remind_at":{"type":"integer"},"remind_offset_min":{"type":"integer"},"recurrence_rule":{"type":"string"},"tag_names":{"type":"array","items":{"type":"string"}}},"required":["title"]}),
        ),
        "update_task" => (
            "Patch a task; use clear_* flags to null a field",
            json!({"type":"object","properties":{"id":{"type":"string"},"patch":{"type":"object"}},"required":["id","patch"]}),
        ),
        "complete_task" => (
            "Mark a task done",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "delete_task" => (
            "Soft-delete a task and its subtree",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "add_subtask" => (
            "Create a child task",
            json!({"type":"object","properties":{"parent_id":{"type":"string"},"title":{"type":"string"}},"required":["parent_id","title"]}),
        ),
        "add_tags" => (
            "Append tags to a task",
            json!({"type":"object","properties":{"task_id":{"type":"string"},"tag_names":{"type":"array","items":{"type":"string"}}},"required":["task_id","tag_names"]}),
        ),
        "move_task" => (
            "Move a task to another project/parent",
            json!({"type":"object","properties":{"id":{"type":"string"},"project_id":{"type":"string"},"parent_id":{"type":"string"},"sort_order":{"type":"integer"}},"required":["id"]}),
        ),
        _ => ("Unknown tool", json!({ "type": "object", "properties": {} })),
    }
}

fn parse<T: DeserializeOwned>(v: &Value) -> Result<T> {
    serde_json::from_value(v.clone()).map_err(|e| CoreError::Validation(format!("bad arguments: {e}")))
}

/// Execute one tool call and return its JSON result.
pub async fn call_tool(ctx: &ToolContext, name: &str, args: &Value) -> Result<Value> {
    if is_write_tool(name) && !ctx.write_enabled {
        return Err(CoreError::Unsupported(format!(
            "tool '{name}' is disabled; enable writing in settings"
        )));
    }
    let started = std::time::Instant::now();
    let result = dispatch(ctx, name, args).await;
    if is_write_tool(name) {
        let (ok, err) = match &result {
            Ok(_) => (1, None),
            Err(e) => (0, Some(e.to_string())),
        };
        let _ = ctx
            .core
            .mcp_audit(
                ctx.transport,
                name,
                &args.to_string(),
                ok,
                err,
                started.elapsed().as_millis() as i64,
            )
            .await;
    }
    result
}

async fn dispatch(ctx: &ToolContext, name: &str, args: &Value) -> Result<Value> {
    let core = &ctx.core;
    match name {
        "list_projects" => to_value(&core.list_projects(false).await?),
        "get_project" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            to_value(&core.get_project(&a.id).await?)
        }
        "list_tasks" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                filter: TaskFilter,
                #[serde(default)]
                limit: Option<i64>,
                #[serde(default)]
                offset: Option<i64>,
            }
            let mut a: A = parse(args)?;
            a.filter.limit = a.limit.or(a.filter.limit);
            a.filter.offset = a.offset.or(a.filter.offset);
            to_value(&core.list_tasks(&a.filter).await?)
        }
        "get_task" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            to_value(&core.get_task(&a.id).await?)
        }
        "list_subtasks" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            to_value(&core.list_subtasks(&a.id).await?)
        }
        "list_tags" => to_value(&core.list_tags().await?),
        "search_tasks" => {
            #[derive(serde::Deserialize)]
            struct A {
                query: String,
                #[serde(default)]
                filter: TaskFilter,
                #[serde(default)]
                limit: Option<i64>,
            }
            let a: A = parse(args)?;
            let mut f = a.filter;
            f.limit = a.limit.or(f.limit);
            to_value(&core.search(&a.query, &f).await?)
        }
        "list_upcoming" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                days: Option<i64>,
            }
            let a: A = parse(args)?;
            let now = now_ms();
            let days = a.days.unwrap_or(7);
            let page = core
                .list_tasks(&TaskFilter {
                    due_after: Some(now),
                    due_before: Some(now + days * 86_400_000),
                    include_completed: false,
                    sort: Sort::DueAsc,
                    limit: Some(200),
                    ..Default::default()
                })
                .await?;
            to_value(&page.items)
        }
        "list_due_reminders" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                days: Option<i64>,
            }
            let a: A = parse(args)?;
            let now = now_ms();
            let hits = core
                .reminders_catch_up(now, now + a.days.unwrap_or(7) * 86_400_000)
                .await?;
            to_value(&hits)
        }
        "list_attachments" => {
            #[derive(serde::Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = parse(args)?;
            to_value(&core.list_attachments(&a.task_id).await?)
        }
        "summary_report" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                days: Option<i64>,
                #[serde(default)]
                from: Option<i64>,
                #[serde(default)]
                to: Option<i64>,
            }
            let a: A = parse(args)?;
            let now = now_ms();
            let to = a.to.unwrap_or(now);
            let from = a.from.unwrap_or(to - a.days.unwrap_or(30) * 86_400_000);
            to_value(&report::summary(core, from, to, None, true).await?)
        }
        "list_calendar" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                from: Option<i64>,
                #[serde(default)]
                to: Option<i64>,
                #[serde(default)]
                days: Option<i64>,
            }
            let a: A = parse(args)?;
            let now = now_ms();
            let from = a.from.unwrap_or(now);
            let to = a.to.unwrap_or(from + a.days.unwrap_or(30) * 86_400_000);
            to_value(&core.calendar(from, to).await?)
        }
        "export_tasks" => {
            #[derive(serde::Deserialize)]
            struct A {
                #[serde(default)]
                format: Option<String>,
                #[serde(default)]
                filter: TaskFilter,
            }
            let mut a: A = parse(args)?;
            if a.filter.limit.is_none() {
                a.filter.limit = Some(500);
            }
            let fmt = a
                .format
                .as_deref()
                .and_then(ExportFormat::parse)
                .unwrap_or(ExportFormat::Json);
            let text = core.export_tasks(&a.filter, fmt).await?;
            Ok(json!({ "format": a.format.unwrap_or_else(|| "json".into()), "data": text }))
        }
        "create_task" => {
            let input: CreateTaskInput = parse(args)?;
            to_value(&core.create_task(input).await?)
        }
        "update_task" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
                patch: TaskPatch,
            }
            let a: A = parse(args)?;
            to_value(&core.update_task(&a.id, a.patch).await?)
        }
        "complete_task" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            to_value(&core.complete_task(&a.id).await?)
        }
        "delete_task" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            let n = core.delete_task(&a.id).await?;
            Ok(json!({ "deleted": n }))
        }
        "add_subtask" => {
            #[derive(serde::Deserialize)]
            struct A {
                parent_id: String,
                title: String,
                #[serde(default)]
                due_at: Option<i64>,
                #[serde(default)]
                priority: Option<Priority>,
            }
            let a: A = parse(args)?;
            to_value(
                &core
                    .add_subtask(
                        &a.parent_id,
                        CreateTaskInput {
                            title: a.title,
                            due_at: a.due_at,
                            priority: a.priority,
                            ..Default::default()
                        },
                    )
                    .await?,
            )
        }
        "add_tags" => {
            #[derive(serde::Deserialize)]
            struct A {
                task_id: String,
                tag_names: Vec<String>,
            }
            let a: A = parse(args)?;
            let (mut ids, _names) = core.tags_of_task(&a.task_id).await?;
            let added = core.ensure_tags(&a.tag_names).await?;
            ids.extend(added.into_iter().map(|(id, _)| id));
            ids.sort();
            ids.dedup();
            core.set_task_tags(&a.task_id, &ids).await?;
            to_value(&core.get_task(&a.task_id).await?)
        }
        "move_task" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
                #[serde(default)]
                project_id: Option<String>,
                #[serde(default)]
                parent_id: Option<String>,
                #[serde(default)]
                sort_order: Option<i64>,
            }
            let a: A = parse(args)?;
            let project = a.project_id.map(Some);
            let parent = a.parent_id.map(Some);
            to_value(&core.move_task(&a.id, project, parent, a.sort_order).await?)
        }
        other => Err(CoreError::NotFound(format!("tool {other}"))),
    }
}

fn to_value<T: serde::Serialize>(v: &T) -> Result<Value> {
    serde_json::to_value(v).map_err(|e| CoreError::Validation(e.to_string()))
}
