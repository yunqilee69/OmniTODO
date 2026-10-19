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
    "list_sections",
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
    "create_section",
    "update_section",
    "delete_section",
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
        "list_projects" => (
            "List projects with open/completed/overdue counts. Returns {items}",
            empty,
        ),
        "get_project" => (
            "Get one project with stats. `id` may be the project id or its name",
            json!({"type":"object","properties":{"id":{"type":"string","description":"Project id, or its name"}},"required":["id"]}),
        ),
        "list_sections" => (
            "A project's sections (the board view's columns) in display order, each with its live top-level task count. Returns {items}",
            json!({"type":"object","properties":{"project_id":{"type":"string","description":"Project id, or its name"}},"required":["project_id"]}),
        ),
        "list_tasks" => (
            "List tasks, paginated. Defaults to open tasks (todo and in_progress); pass scope to include completed or everything. Returns {items,total,limit,offset}",
            task_query_schema(false),
        ),
        "get_task" => (
            "Get one task with tags and attachment metadata",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "list_subtasks" => (
            "List all (recursive) subtasks of a task. Returns {items}",
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}),
        ),
        "list_tags" => ("List tags with usage counts. Returns {items}", empty),
        "search_tasks" => (
            "Full-text search. Same filters as list_tasks, and the same default of open tasks only. Queries shorter than 3 characters use substring match. Returns {items,total,limit,offset}",
            task_query_schema(true),
        ),
        "list_upcoming" => (
            "Open tasks due within the next N days (default 7). Returns {items}",
            json!({"type":"object","properties":{"days":{"type":"integer"}}}),
        ),
        "list_due_reminders" => (
            "Planned reminder times for the next N days. Returns {items}",
            json!({"type":"object","properties":{"days":{"type":"integer"}}}),
        ),
        "list_attachments" => (
            "Attachment metadata for a task (never returns the binary). Returns {items}",
            json!({"type":"object","properties":{"task_id":{"type":"string"}},"required":["task_id"]}),
        ),
        "summary_report" => (
            "Aggregated report. completed/by_* count live tasks and ignore the window; completed_in_window and throughput count completions of live tasks inside from/to (days selects the window when from is omitted, default 30)",
            json!({"type":"object","properties":{"days":{"type":"integer"},"from":{"type":"integer","description":"Window start, unix ms"},"to":{"type":"integer","description":"Window end, unix ms"}}}),
        ),
        "list_calendar" => (
            "Calendar items (materialised tasks + virtual occurrences) in a window. Finished work is not listed: only open tasks appear. Returns {items}",
            json!({"type":"object","properties":{"from":{"type":"integer"},"to":{"type":"integer"},"days":{"type":"integer"},"project_id":{"type":"string","description":"Narrow the window to one project"}}}),
        ),
        "export_tasks" => (
            "Serialize tasks (json|csv|markdown) without writing to disk. Same filters and default (open tasks only) as list_tasks. Returns {format,data}",
            {
                let mut schema = task_query_schema(false);
                schema["properties"]["format"] =
                    json!({"type":"string","enum":["json","csv","markdown"],"description":"Defaults to json"});
                schema
            }
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
        "create_section" => (
            "Create a section in a project. Names are unique per project, case-insensitively. Returns the section",
            json!({"type":"object","properties":{"project_id":{"type":"string","description":"Project id, or its name"},"name":{"type":"string"},"sort_order":{"type":"integer","description":"Defaults to the end"}},"required":["project_id","name"]}),
        ),
        "update_section" => (
            "Rename or reorder a section. Returns the section",
            json!({"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"sort_order":{"type":"integer"},"expected_version":{"type":"integer"}},"required":["id"]}),
        ),
        "delete_section" => (
            "Delete a section. By default its tasks are kept and released into \"no section\"; pass delete_tasks to delete them with the section. Returns {affected_tasks}",
            json!({"type":"object","properties":{"id":{"type":"string"},"delete_tasks":{"type":"boolean","description":"Also delete the section's tasks (and their subtrees). Defaults to false"}},"required":["id"]}),
        ),
        "move_task" => (
            "Move a task to another project/parent",
            json!({"type":"object","properties":{"id":{"type":"string"},"project_id":{"type":"string"},"parent_id":{"type":"string"},"sort_order":{"type":"integer"}},"required":["id"]}),
        ),
        _ => ("Unknown tool", json!({ "type": "object", "properties": {} })),
    }
}

/// Arguments shared by `list_tasks`, `search_tasks` and `export_tasks`.
///
/// Flat on purpose: a caller passes `scope` and `project` directly instead of
/// nesting them under `filter`, whose field names (`statuses`, `project_ids`)
/// are easy to guess wrong. A nested `filter` is still accepted.
fn task_query_schema(search: bool) -> Value {
    let mut properties = serde_json::Map::new();
    if search {
        properties.insert("query".into(), json!({"type":"string"}));
    }
    properties.insert(
        "scope".into(),
        json!({"type":"string","enum":["open","completed","all"],"description":"Which tasks by completion. open (default) is todo and in_progress; completed is done; all is everything including cancelled"}),
    );
    properties.insert(
        "project".into(),
        json!({"type":"string","description":"Project id or name. Name match is case-insensitive; a substring is accepted only when exactly one project matches"}),
    );
    properties.insert(
        "priorities".into(),
        json!({"type":"array","items":{"type":"string","enum":["none","low","medium","high","urgent"]}}),
    );
    properties.insert(
        "statuses".into(),
        json!({"type":"array","items":{"type":"string","enum":["todo","in_progress","done","cancelled"]},"description":"Exact statuses. Overrides scope"}),
    );
    for (field, desc) in [
        ("due_before", "Due at or before, unix ms"),
        ("due_after", "Due at or after, unix ms"),
        ("start_before", "Starts at or before, unix ms"),
        ("start_after", "Starts at or after, unix ms"),
        ("completed_before", "Completed at or before, unix ms"),
        ("completed_after", "Completed at or after, unix ms"),
    ] {
        properties.insert(field.into(), json!({"type":"integer","description":desc}));
    }
    properties.insert("limit".into(), json!({"type":"integer"}));
    properties.insert("offset".into(), json!({"type":"integer"}));
    properties.insert(
        "filter".into(),
        json!({"type":"object","description":"Advanced filter (project_ids, tag_ids, priorities, statuses, include_completed, …). Explicit arguments above override it"}),
    );
    if search {
        return json!({"type":"object","properties":properties,"required":["query"]});
    }
    json!({"type":"object","properties":properties})
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
        "list_projects" => items(&core.list_projects(false).await?),
        "get_project" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
            }
            let a: A = parse(args)?;
            let id = core.resolve_project_id(&a.id).await?;
            to_value(&core.get_project(&id).await?)
        }
        "list_sections" => {
            #[derive(serde::Deserialize)]
            struct A {
                project_id: String,
            }
            let a: A = parse(args)?;
            let pid = core.resolve_project_id(&a.project_id).await?;
            items(&core.list_sections(&pid).await?)
        }
        "list_tasks" => {
            let filter = task_filter_from_args(core, args).await?;
            to_value(&core.list_tasks(&filter).await?)
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
            items(&core.list_subtasks(&a.id).await?)
        }
        "list_tags" => items(&core.list_tags().await?),
        "search_tasks" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CoreError::Validation("search_tasks requires query".into()))?
                .to_string();
            let filter = task_filter_from_args(core, args).await?;
            to_value(&core.search(&query, &filter).await?)
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
            items(&page.items)
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
            items(&hits)
        }
        "list_attachments" => {
            #[derive(serde::Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = parse(args)?;
            items(&core.list_attachments(&a.task_id).await?)
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
                #[serde(default)]
                project_id: Option<String>,
            }
            let a: A = parse(args)?;
            let now = now_ms();
            let from = a.from.unwrap_or(now);
            let to = a.to.unwrap_or(from + a.days.unwrap_or(30) * 86_400_000);
            items(&core.calendar(from, to, a.project_id.as_deref()).await?)
        }
        "export_tasks" => {
            let mut filter = task_filter_from_args(core, args).await?;
            if filter.limit.is_none() {
                filter.limit = Some(500);
            }
            let format = args.get("format").and_then(|v| v.as_str());
            let fmt = format.and_then(ExportFormat::parse).unwrap_or(ExportFormat::Json);
            let text = core.export_tasks(&filter, fmt).await?;
            Ok(json!({ "format": format.unwrap_or("json"), "data": text }))
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
        "create_section" => {
            #[derive(serde::Deserialize)]
            struct A {
                project_id: String,
                name: String,
                #[serde(default)]
                sort_order: Option<i64>,
            }
            let a: A = parse(args)?;
            let project_id = core.resolve_project_id(&a.project_id).await?;
            to_value(
                &core
                    .create_section(CreateSectionInput {
                        project_id,
                        name: a.name,
                        sort_order: a.sort_order,
                    })
                    .await?,
            )
        }
        "update_section" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
                #[serde(default)]
                name: Option<String>,
                #[serde(default)]
                sort_order: Option<i64>,
                #[serde(default)]
                expected_version: Option<i64>,
            }
            let a: A = parse(args)?;
            to_value(
                &core
                    .update_section(
                        &a.id,
                        SectionPatch {
                            name: a.name,
                            sort_order: a.sort_order,
                            expected_version: a.expected_version,
                        },
                    )
                    .await?,
            )
        }
        "delete_section" => {
            #[derive(serde::Deserialize)]
            struct A {
                id: String,
                #[serde(default)]
                delete_tasks: Option<bool>,
            }
            let a: A = parse(args)?;
            let affected = core.delete_section(&a.id, a.delete_tasks.unwrap_or(false)).await?;
            Ok(json!({ "affected_tasks": affected }))
        }
        other => Err(CoreError::NotFound(format!("tool {other}"))),
    }
}

fn to_value<T: serde::Serialize>(v: &T) -> Result<Value> {
    serde_json::to_value(v).map_err(|e| CoreError::Validation(e.to_string()))
}

/// Wrap a list in an object. MCP requires `structuredContent` to be a record,
/// so a bare array makes the client reject the whole result.
fn items<T: serde::Serialize>(rows: &[T]) -> Result<Value> {
    let rows = to_value(&rows)?;
    let count = rows.as_array().map(|a| a.len()).unwrap_or(0);
    Ok(json!({ "items": rows, "count": count }))
}

/// Build a `TaskFilter` from the flat tool arguments, mapping `scope` and a
/// project name onto the core filter. Unknown enum values are an error rather
/// than a silently dropped argument.
async fn task_filter_from_args(core: &Core, args: &Value) -> Result<TaskFilter> {
    #[derive(serde::Deserialize, Default)]
    struct A {
        #[serde(default)]
        filter: Option<TaskFilter>,
        #[serde(default)]
        scope: Option<String>,
        #[serde(default)]
        statuses: Option<Vec<String>>,
        #[serde(default)]
        priorities: Option<Vec<String>>,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        project_ids: Option<Vec<String>>,
        #[serde(default)]
        due_after: Option<i64>,
        #[serde(default)]
        due_before: Option<i64>,
        #[serde(default)]
        start_after: Option<i64>,
        #[serde(default)]
        start_before: Option<i64>,
        #[serde(default)]
        completed_after: Option<i64>,
        #[serde(default)]
        completed_before: Option<i64>,
        #[serde(default)]
        include_completed: Option<bool>,
        #[serde(default)]
        limit: Option<i64>,
        #[serde(default)]
        offset: Option<i64>,
    }
    let a: A = parse(args)?;
    let mut f = a.filter.unwrap_or_default();

    if let Some(scope) = a.scope.as_deref() {
        match scope.trim().to_ascii_lowercase().as_str() {
            "open" | "unfinished" | "incomplete" => {
                f.statuses = None;
                f.include_completed = false;
            }
            "completed" | "done" => {
                f.statuses = Some(vec![Status::Done]);
                f.include_completed = true;
            }
            "all" | "everything" => {
                f.statuses = None;
                f.include_completed = true;
            }
            other => {
                return Err(CoreError::Validation(format!(
                    "scope must be open, completed or all, got {other:?}"
                )))
            }
        }
    }
    if let Some(raw) = &a.statuses {
        let mut out = Vec::with_capacity(raw.len());
        for s in raw {
            out.push(Status::parse(s).ok_or_else(|| {
                CoreError::Validation(format!(
                    "unknown status {s:?}; expected todo, in_progress, done or cancelled"
                ))
            })?);
        }
        f.statuses = Some(out);
        f.include_completed = true; // an explicit status list is authoritative
    }
    if let Some(raw) = &a.priorities {
        let mut out = Vec::with_capacity(raw.len());
        for p in raw {
            out.push(Priority::parse(p).ok_or_else(|| {
                CoreError::Validation(format!(
                    "unknown priority {p:?}; expected none, low, medium, high or urgent"
                ))
            })?);
        }
        f.priorities = Some(out);
    }
    if let Some(ids) = a.project_ids {
        if !ids.is_empty() {
            f.project_ids = Some(ids);
        }
    }
    if let Some(name) = a.project.as_deref() {
        let id = core.resolve_project_id(name).await?;
        let mut ids = f.project_ids.take().unwrap_or_default();
        ids.push(id);
        f.project_ids = Some(ids);
    }
    if let Some(v) = a.include_completed {
        f.include_completed = v;
    }
    f.due_after = a.due_after.or(f.due_after);
    f.due_before = a.due_before.or(f.due_before);
    f.start_after = a.start_after.or(f.start_after);
    f.start_before = a.start_before.or(f.start_before);
    f.completed_after = a.completed_after.or(f.completed_after);
    f.completed_before = a.completed_before.or(f.completed_before);
    f.limit = a.limit.or(f.limit);
    f.offset = a.offset.or(f.offset);
    Ok(f)
}
