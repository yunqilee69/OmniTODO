use std::collections::HashMap;

use crate::domain::*;
use crate::error::{CoreError, Result};
use crate::service::Core;

/// Supported serialization targets for export (design §7.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Json,
    Csv,
    Markdown,
}

impl ExportFormat {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "json" => Some(ExportFormat::Json),
            "csv" => Some(ExportFormat::Csv),
            "md" | "markdown" => Some(ExportFormat::Markdown),
            _ => None,
        }
    }
}

/// Supported import sources (design §9: `import_markdown` / `import_todotxt` /
/// `import_todoist_json`). Parsing is pure; `Core::import_run` does the writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportFormat {
    Markdown,
    TodoTxt,
    TodoistJson,
}

impl ImportFormat {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "md" | "markdown" => Some(ImportFormat::Markdown),
            "txt" | "todotxt" | "todo" => Some(ImportFormat::TodoTxt),
            "json" | "todoist" | "todoist_json" => Some(ImportFormat::TodoistJson),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ImportFormat::Markdown => "markdown",
            ImportFormat::TodoTxt => "todotxt",
            ImportFormat::TodoistJson => "todoist_json",
        }
    }
}

/// One parsed row, before it is written.
///
/// Import sources reference projects and parents by *their own* ids/names, which
/// mean nothing to us yet, so the parser only records them: `input.project_name`
/// is resolved (creating the project if needed) and `source_parent` is remapped
/// to the created task's id by [`Core::import_run`].
#[derive(Debug, Clone)]
pub struct ImportedTask {
    pub input: CreateTaskInput,
    /// Id in the source system, so children can point back at this row.
    pub source_id: Option<String>,
    /// Parent's id in the source system, remapped on import.
    pub source_parent: Option<String>,
}

impl ImportedTask {
    fn plain(input: CreateTaskInput) -> Self {
        ImportedTask {
            input,
            source_id: None,
            source_parent: None,
        }
    }
}

impl Core {
    /// Parse `content` in `format` and create the tasks (design §11.3).
    ///
    /// This is the single entry point the CLI and the desktop command share, so
    /// the two can't drift apart. Projects named by the source are created on
    /// demand; source parent ids are remapped so subtask trees survive the trip.
    pub async fn import_run(&self, content: &str, format: ImportFormat) -> Result<usize> {
        let rows = match format {
            ImportFormat::Markdown => import_markdown(content),
            ImportFormat::TodoTxt => import_todotxt(content),
            ImportFormat::TodoistJson => import_todoist_json(content)?,
        };

        // Resolve project names once each, creating missing ones: an import that
        // silently dropped "工作" because the project didn't exist yet would be
        // worse than creating an empty project.
        let mut projects: HashMap<String, String> = HashMap::new();
        for row in &rows {
            if let Some(name) = row.input.project_name.as_deref() {
                let key = name.trim().to_lowercase();
                if key.is_empty() || projects.contains_key(&key) {
                    continue;
                }
                let id = match self.resolve_project_id(name).await {
                    Ok(id) => id,
                    Err(CoreError::NotFound(_)) => self
                        .create_project(CreateProjectInput {
                            name: name.trim().to_string(),
                            ..Default::default()
                        })
                        .await?
                        .id,
                    Err(e) => return Err(e),
                };
                projects.insert(key, id);
            }
        }

        let mut created: HashMap<String, String> = HashMap::new();
        let mut n = 0;
        for row in rows {
            if row.input.title.trim().is_empty() {
                continue;
            }
            let mut input = row.input;
            if input.project_id.is_none() {
                if let Some(name) = input.project_name.as_deref() {
                    input.project_id = projects.get(&name.trim().to_lowercase()).cloned();
                }
            }
            // A child is only reachable if its parent was created already; the
            // parser keeps source order, which is parents-first for both sources.
            if input.parent_id.is_none() {
                input.parent_id = row
                    .source_parent
                    .as_deref()
                    .and_then(|p| created.get(p).cloned());
            }
            let task = self.create_task(input).await?;
            if let Some(src) = row.source_id {
                created.insert(src, task.id);
            }
            n += 1;
        }
        Ok(n)
    }
}

impl Core {
    /// Serialize tasks matching `filter` without touching disk (design §11.3).
    pub async fn export_tasks(&self, filter: &TaskFilter, format: ExportFormat) -> Result<String> {
        let page = self.list_tasks(filter).await?;
        Ok(match format {
            ExportFormat::Json => serde_json::to_string_pretty(&page.items).unwrap_or_default(),
            ExportFormat::Csv => to_csv(&page.items),
            ExportFormat::Markdown => to_markdown(&page.items),
        })
    }
}

fn to_csv(tasks: &[TaskDto]) -> String {
    let mut out = String::from("id,title,status,priority,project_id,due_at,created_at,tags\n");
    for t in tasks {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{}\n",
            t.id,
            csv_escape(&t.title),
            t.status.as_str(),
            t.priority.as_i64(),
            t.project_id.clone().unwrap_or_default(),
            t.due_at.map(|v| v.to_string()).unwrap_or_default(),
            t.created_at,
            csv_escape(&t.tags.join(" "))
        ));
    }
    out
}

fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn to_markdown(tasks: &[TaskDto]) -> String {
    let mut out = String::new();
    for t in tasks {
        let check = if t.status == Status::Done { "x" } else { " " };
        out.push_str(&format!("- [{check}] {}", t.title));
        for tag in &t.tags {
            out.push_str(&format!(" #{tag}"));
        }
        if let Some(due) = t.due_at {
            out.push_str(&format!(" ^due:{due}"));
        }
        out.push('\n');
    }
    out
}

/// Parse a Markdown task list: `- [ ] title #tag` / `- [x] done`.
pub fn import_markdown(text: &str) -> Vec<ImportedTask> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let (done, rest) = if let Some(r) = line.strip_prefix("- [ ]") {
            (false, r)
        } else if let Some(r) = line.strip_prefix("- [x]") {
            (true, r)
        } else if let Some(r) = line.strip_prefix("* [ ]") {
            (false, r)
        } else {
            continue;
        };
        let mut title_words = Vec::new();
        let mut tags = Vec::new();
        for tok in rest.split_whitespace() {
            if let Some(tag) = tok.strip_prefix('#') {
                tags.push(tag.to_string());
            } else {
                title_words.push(tok.to_string());
            }
        }
        let title = title_words.join(" ");
        if title.is_empty() {
            continue;
        }
        out.push(ImportedTask::plain(CreateTaskInput {
            title,
            status: if done { Some(Status::Done) } else { None },
            tag_names: tags,
            ..Default::default()
        }));
    }
    out
}

/// Parse todo.txt lines: `(A) 2026-10-20 task @context +project`.
///
/// `@context` becomes a tag (our closest equivalent) and `+project` names the
/// project — both conventions are dropped from the title.
pub fn import_todotxt(text: &str) -> Vec<ImportedTask> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut rest = line.to_string();
        let mut priority = None;
        if rest.starts_with('(') {
            if let Some(end) = rest.find(')') {
                let p = &rest[1..end];
                priority = match p {
                    "A" => Some(Priority::Urgent),
                    "B" => Some(Priority::High),
                    "C" => Some(Priority::Medium),
                    "D" => Some(Priority::Low),
                    _ => None,
                };
                rest = rest[end + 1..].trim().to_string();
            }
        }
        let mut tags = Vec::new();
        let mut project_name = None;
        let mut words = Vec::new();
        for tok in rest.split_whitespace() {
            if let Some(t) = tok.strip_prefix('@') {
                tags.push(t.to_string());
            } else if let Some(p) = tok.strip_prefix('+') {
                project_name = Some(p.to_string());
            } else {
                words.push(tok.to_string());
            }
        }
        let title = words.join(" ");
        if title.is_empty() {
            continue;
        }
        out.push(ImportedTask::plain(CreateTaskInput {
            title,
            priority,
            tag_names: tags,
            project_name,
            ..Default::default()
        }));
    }
    out
}

/// Todoist priority (4 = urgent) mapped onto ours.
fn todoist_priority(v: Option<i64>) -> Option<Priority> {
    match v {
        Some(4) => Some(Priority::Urgent),
        Some(3) => Some(Priority::High),
        Some(2) => Some(Priority::Medium),
        Some(_) => Some(Priority::None),
        None => None,
    }
}

/// Parse a Todoist JSON export/backup.
///
/// Accepts either a bare array of items or the usual object with `items` (and an
/// optional `projects` table, whose `id` → `name` map we use to file each task).
/// Task fields follow the Todoist API: `content`, `description`, `priority` (1–4,
/// 4 = urgent), `labels`, `checked`, `due.date` / `due.datetime`, `project_id`
/// and `parent_id`. `datetime` is honoured as an instant, a bare `date` becomes
/// an all-day task (design §5.1).
pub fn import_todoist_json(text: &str) -> Result<Vec<ImportedTask>> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| CoreError::Validation(format!("invalid Todoist JSON: {e}")))?;
    let items = match &value {
        serde_json::Value::Array(items) => items.clone(),
        serde_json::Value::Object(map) => match map.get("items") {
            Some(serde_json::Value::Array(items)) => items.clone(),
            _ => {
                return Err(CoreError::Validation(
                    "Todoist JSON must be an array of items or an object with \"items\"".into(),
                ))
            }
        },
        _ => {
            return Err(CoreError::Validation(
                "Todoist JSON must be an array of items or an object with \"items\"".into(),
            ))
        }
    };

    // id -> name, so `project_id` becomes a project name we can resolve.
    let mut projects: HashMap<String, String> = HashMap::new();
    if let Some(serde_json::Value::Array(ps)) = value.get("projects") {
        for p in ps {
            if let (Some(id), Some(name)) = (p.get("id").and_then(|v| v.as_str()), p.get("name"))
            {
                if let Some(name) = name.as_str() {
                    projects.insert(id.to_string(), name.to_string());
                }
            }
        }
    }

    let mut out = Vec::new();
    for item in &items {
        let Some(title) = item.get("content").and_then(|v| v.as_str()) else {
            continue;
        };
        if title.trim().is_empty() {
            continue;
        }

        let mut all_day = false;
        let mut due_at = None;
        if let Some(due) = item.get("due") {
            if let Some(dt) = due.get("datetime").and_then(|v| v.as_str()) {
                due_at = chrono::DateTime::parse_from_rfc3339(dt)
                    .ok()
                    .map(|d| d.timestamp_millis());
            }
            if due_at.is_none() {
                if let Some(date) = due.get("date").and_then(|v| v.as_str()) {
                    // `due.date` may be a full timestamp for timed tasks.
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date) {
                        due_at = Some(dt.timestamp_millis());
                    } else if let Ok(d) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
                        due_at = Some(d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis());
                        all_day = true;
                    }
                }
            }
        }

        let tags = item
            .get("labels")
            .and_then(|v| v.as_array())
            .map(|labels| {
                labels
                    .iter()
                    .filter_map(|l| l.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let status = match item.get("checked").and_then(|v| v.as_bool()) {
            Some(true) => Some(Status::Done),
            _ => None,
        };

        let project_name = item
            .get("project_id")
            .and_then(|v| v.as_str())
            .and_then(|id| projects.get(id).cloned());

        out.push(ImportedTask {
            input: CreateTaskInput {
                title: title.trim().to_string(),
                description: item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string()),
                priority: todoist_priority(item.get("priority").and_then(|v| v.as_i64())),
                status,
                due_at,
                all_day: all_day.then_some(true),
                tag_names: tags,
                project_name,
                ..Default::default()
            },
            source_id: item.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
            source_parent: item
                .get("parent_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }
    Ok(out)
}
