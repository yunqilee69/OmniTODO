//! Headless CLI: smoke tests, maintenance and scripting (design §6).
//! Shares `omnitodo-core` with the desktop app and the MCP server.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use omnitodo_core::config;
use omnitodo_core::domain::*;
use omnitodo_core::service::importexport::{ExportFormat, ImportFormat};
use omnitodo_core::service::report;
use omnitodo_core::service::Core;

#[derive(Parser)]
#[command(name = "omnitodo", version, about = "OmniTODO headless CLI")]
struct Cli {
    /// Override the database path (default: platform data dir).
    #[arg(long, global = true)]
    db: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create the data directory and run migrations.
    Init,
    /// Show the resolved database path and basic counts.
    Status,
    /// Project operations.
    #[command(subcommand)]
    Project(ProjectCmd),
    /// Tag operations.
    #[command(subcommand)]
    Tag(TagCmd),
    /// Task operations.
    #[command(subcommand)]
    Task(TaskCmd),
    /// Full-text search.
    Search {
        query: String,
        #[arg(long, default_value_t = 50)]
        limit: i64,
    },
    /// Aggregate report (JSON).
    Report {
        #[arg(long, default_value_t = 30)]
        days: i64,
    },
    /// Maintenance: prune op_log, GC attachments, rebuild FTS.
    Maintain,
    /// Materialise due recurring occurrences.
    Materialize,
    /// Reminders due within the last N minutes.
    Reminders {
        #[arg(long, default_value_t = 60)]
        minutes: i64,
    },
    /// Calendar items (materialised + virtual occurrences) for the next N days.
    Calendar {
        #[arg(long, default_value_t = 30)]
        days: i64,
    },
    /// Parse a quick-add line and print the draft (no write).
    Parse { text: String },
    /// Parse a quick-add line and create the task.
    Quickadd {
        text: String,
        #[arg(long)]
        project_id: Option<String>,
    },
    /// Import tasks from Markdown or todo.txt.
    Import {
        file: PathBuf,
        #[arg(long, default_value = "markdown")]
        format: String,
    },
    /// Export tasks (json|csv|markdown) to stdout.
    Export {
        #[arg(long, default_value = "json")]
        format: String,
        #[arg(long)]
        include_completed: bool,
    },
}

#[derive(Subcommand)]
enum ProjectCmd {
    Add {
        name: String,
        #[arg(long)]
        color: Option<String>,
    },
    List {
        #[arg(long)]
        archived: bool,
    },
    Show {
        id: String,
    },
    Delete {
        id: String,
    },
}

#[derive(Subcommand)]
enum TagCmd {
    List,
    Add { name: String },
    Delete { id: String },
}

#[derive(Subcommand)]
enum TaskCmd {
    Add {
        title: String,
        /// Project id or name (exact match wins; a substring must be unique).
        #[arg(long)]
        project: Option<String>,
        /// `2026-10-12`, `2026-10-12 18:00`, `明天 下午3点`, `+3d`, or epoch ms.
        #[arg(long)]
        due: Option<String>,
        /// Same forms as `--due`.
        #[arg(long)]
        start: Option<String>,
        #[arg(long)]
        priority: Option<u8>,
        /// RFC 5545 rule or shorthand, e.g. "FREQ=DAILY" / "每周一,三,五".
        #[arg(long)]
        recurrence: Option<String>,
        #[arg(long = "tag")]
        tags: Vec<String>,
    },
    List {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        all: bool,
        #[arg(long, default_value_t = 50)]
        limit: i64,
    },
    Show {
        id: String,
    },
    Complete {
        id: String,
    },
    Uncomplete {
        id: String,
    },
    Delete {
        id: String,
    },
    Subtasks {
        id: String,
    },
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let core = match &cli.db {
        Some(path) => {
            config::ensure_dirs()?;
            Core::open(path, false).await?
        }
        None => {
            config::ensure_dirs()?;
            Core::open_default(false).await?
        }
    };

    match cli.command {
        Command::Init => {
            config::ensure_dirs()?;
            println!("data dir: {}", config::data_dir().display());
            println!("db:       {}", config::db_path().display());
        }
        Command::Status => {
            let page = core.list_tasks(&TaskFilter { limit: Some(1), ..Default::default() }).await?;
            let projects = core.list_projects(true).await?;
            println!("data dir: {}", config::data_dir().display());
            println!("projects: {}", projects.len());
            println!("tasks:    {}", page.total);
        }
        Command::Project(cmd) => match cmd {
            ProjectCmd::Add { name, color } => {
                let p = core
                    .create_project(CreateProjectInput {
                        name,
                        color,
                        ..Default::default()
                    })
                    .await?;
                print_json(&p)?;
            }
            ProjectCmd::List { archived } => print_json(&core.list_projects(archived).await?)?,
            ProjectCmd::Show { id } => print_json(&core.get_project(&id).await?)?,
            ProjectCmd::Delete { id } => {
                let n = core.delete_project(&id).await?;
                println!("deleted project and {n} task(s)");
            }
        },
        Command::Tag(cmd) => match cmd {
            TagCmd::List => print_json(&core.list_tags().await?)?,
            TagCmd::Add { name } => print_json(&core.create_tag(&name, None).await?)?,
            TagCmd::Delete { id } => {
                core.delete_tag(&id).await?;
                println!("deleted tag {id}");
            }
        },
        Command::Task(cmd) => match cmd {
            TaskCmd::Add {
                title,
                project,
                due,
                start,
                priority,
                recurrence,
                tags,
            } => {
                let rule = match recurrence.as_deref() {
                    Some(s) => Some(
                        omnitodo_core::service::recurrence::RecurrenceRule::parse(s)
                            .map_err(|e| format!("bad recurrence: {e}"))?
                            .to_canonical(),
                    ),
                    None => None,
                };
                let now = omnitodo_core::clock::now_ms();
                let due = parse_when_arg("--due", due.as_deref(), now)?;
                let start = parse_when_arg("--start", start.as_deref(), now)?;
                // A date-only value means an all-day task; mixing in a time makes
                // the whole task timed (design §5.1).
                let all_day = match (due, start) {
                    (Some((_, d)), Some((_, s))) => d && s,
                    (Some((_, d)), None) | (None, Some((_, d))) => d,
                    (None, None) => false,
                };
                let project_id = match project.as_deref() {
                    Some(key) => Some(core.resolve_project_id(key).await?),
                    None => None,
                };
                let p = core
                    .create_task(CreateTaskInput {
                        title,
                        project_id,
                        due_at: due.map(|(ms, _)| ms),
                        start_at: start.map(|(ms, _)| ms),
                        all_day: all_day.then_some(true),
                        priority: priority.map(|v| Priority::from_i64(v as i64)),
                        recurrence_rule: rule,
                        tag_names: tags,
                        ..Default::default()
                    })
                    .await?;
                print_json(&p)?;
            }
            TaskCmd::List {
                project,
                all,
                limit,
            } => {
                let project_id = match project.as_deref() {
                    Some(key) => Some(core.resolve_project_id(key).await?),
                    None => None,
                };
                let page = core
                    .list_tasks(&TaskFilter {
                        project_ids: project_id.map(|p| vec![p]),
                        include_completed: all,
                        limit: Some(limit),
                        ..Default::default()
                    })
                    .await?;
                print_json(&page)?;
            }
            TaskCmd::Show { id } => print_json(&core.get_task(&id).await?)?,
            TaskCmd::Complete { id } => print_json(&core.complete_task(&id).await?)?,
            TaskCmd::Uncomplete { id } => print_json(&core.uncomplete_task(&id).await?)?,
            TaskCmd::Delete { id } => {
                let n = core.delete_task(&id).await?;
                println!("soft-deleted {n} task(s)");
            }
            TaskCmd::Subtasks { id } => print_json(&core.list_subtasks(&id).await?)?,
        },
        Command::Search { query, limit } => {
            let page = core
                .search(&query, &TaskFilter { limit: Some(limit), ..Default::default() })
                .await?;
            print_json(&page)?;
        }
        Command::Report { days } => {
            let now = omnitodo_core::clock::now_ms();
            let s = report::summary(&core, now - days * 86_400_000, now, None, true).await?;
            print_json(&s)?;
        }
        Command::Maintain => {
            let r = core.run_maintenance().await?;
            print_json(&r)?;
        }
        Command::Materialize => {
            let n = core.materialize_due(omnitodo_core::clock::now_ms()).await?;
            println!("materialised {n} occurrence(s)");
        }
        Command::Reminders { minutes } => {
            let now = omnitodo_core::clock::now_ms();
            let hits = core.reminders_catch_up(now - minutes * 60_000, now).await?;
            print_json(&hits)?;
        }
        Command::Calendar { days } => {
            let now = omnitodo_core::clock::now_ms();
            let items = core.calendar(now, now + days * 86_400_000).await?;
            print_json(&items)?;
        }
        Command::Parse { text } => {
            let now = omnitodo_core::clock::now_ms();
            let draft = core.quickadd_preview(&text, now).await?;
            print_json(&draft)?;
        }
        Command::Quickadd { text, project_id } => {
            let now = omnitodo_core::clock::now_ms();
            let draft = core.quickadd_preview(&text, now).await?;
            let dto = core.quickadd_commit(&draft, project_id).await?;
            print_json(&dto)?;
        }
        Command::Import { file, format } => {
            let text = std::fs::read_to_string(&file)?;
            let fmt = ImportFormat::parse(&format)
                .ok_or_else(|| format!("unknown import format: {format}"))?;
            let n = core.import_run(&text, fmt).await?;
            println!("imported {n} task(s) ({})", fmt.as_str());
        }
        Command::Export {
            format,
            include_completed,
        } => {
            let fmt = ExportFormat::parse(&format)
                .ok_or_else(|| format!("unknown format: {format}"))?;
            let out = core
                .export_tasks(
                    &TaskFilter {
                        include_completed,
                        limit: Some(1000),
                        ..Default::default()
                    },
                    fmt,
                )
                .await?;
            println!("{out}");
        }
    }
    Ok(())
}

fn print_json<T: serde::Serialize>(v: &T) -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
}

/// Parse a `--due` / `--start` flag into `(ms, all_day)`.
fn parse_when_arg(
    flag: &str,
    value: Option<&str>,
    now: i64,
) -> Result<Option<(i64, bool)>, Box<dyn std::error::Error>> {
    static USAGE: &str = "expected epoch milliseconds or a date such as 2026-10-12 / 明天 18:00 / +3d";
    match value {
        None => Ok(None),
        Some(v) => omnitodo_core::service::quickadd::parse_when(v, now)
            .map(Some)
            .ok_or_else(|| format!("invalid value {v:?} for {flag}: {USAGE}").into()),
    }
}
