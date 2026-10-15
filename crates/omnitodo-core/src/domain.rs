use serde::{Deserialize, Serialize};

pub type Id = String;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// 0=none, 1=low, 2=medium, 3=high, 4=urgent (design §5.2)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    None = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Urgent = 4,
}

impl Priority {
    pub fn from_i64(v: i64) -> Self {
        match v {
            1 => Priority::Low,
            2 => Priority::Medium,
            3 => Priority::High,
            4 => Priority::Urgent,
            _ => Priority::None,
        }
    }
    pub fn as_i64(self) -> i64 {
        self as i64
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "none" | "无" | "p0" | "0" => Priority::None,
            "low" | "低" | "p1" | "1" => Priority::Low,
            "medium" | "中" | "p2" | "2" => Priority::Medium,
            "high" | "高" | "重要" | "p3" | "3" => Priority::High,
            "urgent" | "紧急" | "p4" | "4" => Priority::Urgent,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Todo,
    InProgress,
    Done,
    Cancelled,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Todo => "todo",
            Status::InProgress => "in_progress",
            Status::Done => "done",
            Status::Cancelled => "cancelled",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "todo" => Status::Todo,
            "in_progress" => Status::InProgress,
            "done" => Status::Done,
            "cancelled" => Status::Cancelled,
            _ => return None,
        })
    }
    pub fn is_closed(self) -> bool {
        matches!(self, Status::Done | Status::Cancelled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageKind {
    Blob,
    Managed,
}

impl StorageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            StorageKind::Blob => "blob",
            StorageKind::Managed => "managed",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "blob" => Some(StorageKind::Blob),
            "managed" => Some(StorageKind::Managed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    DueAsc,
    #[default]
    CreatedDesc,
    PriorityDesc,
    Manual,
}

// ---------------------------------------------------------------------------
// Persisted rows (1:1 with tables, sqlx FromRow)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub is_archived: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub version: i64,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub series_id: Option<String>,
    pub occurrence_at: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub priority: i64,
    pub status: String,
    pub completed_at: Option<i64>,
    pub start_at: Option<i64>,
    pub due_at: Option<i64>,
    pub all_day: i64,
    pub timezone: Option<String>,
    pub remind_enabled: i64,
    pub remind_at: Option<i64>,
    pub remind_offset_min: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub recurrence_until: Option<i64>,
    pub tags_text: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub version: i64,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub version: i64,
    pub device_id: Option<String>,
}

/// Attachment metadata without the BLOB payload.
#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub file_name: String,
    pub storage_kind: String,
    pub rel_path: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub version: i64,
    pub device_id: Option<String>,
}

// ---------------------------------------------------------------------------
// DTOs (returned to UI / MCP; never raw rows)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDto {
    pub id: Id,
    pub project_id: Option<Id>,
    pub parent_id: Option<Id>,
    pub series_id: Option<Id>,
    pub occurrence_at: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub status: Status,
    pub completed_at: Option<i64>,
    pub start_at: Option<i64>,
    pub due_at: Option<i64>,
    pub all_day: bool,
    pub timezone: Option<String>,
    pub remind_enabled: bool,
    pub remind_at: Option<i64>,
    pub remind_offset_min: Option<i64>,
    pub recurrence_rule: Option<String>,
    pub recurrence_until: Option<i64>,
    pub tag_ids: Vec<Id>,
    pub tags: Vec<String>,
    pub has_attachments: bool,
    /// At least one task has this one as its `parent_id`. Drives the list's
    /// expand/collapse affordance; the drawer shows the whole subtree.
    /// Equivalent to `subtask_total > 0` — the bool is kept because the row only
    /// needs to know whether to draw a caret, not how big the branch is.
    pub has_subtasks: bool,
    /// Descendants already ticked, rolled up over the whole subtree at any
    /// depth — the branch that expanding the row reveals, so `done/total` on
    /// the row can never disagree with the children it shows. `done` and
    /// `cancelled` both count as ticked, matching the row's checkbox.
    pub subtask_done: i64,
    /// Every descendant in the subtree; soft-deleted ones are excluded.
    pub subtask_total: i64,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
}

/// Subtree roll-up for one task: how much of the branch is ticked.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SubtaskProgress {
    pub done: i64,
    pub total: i64,
}

impl TaskDto {
    pub fn from_task(
        t: &Task,
        tag_ids: Vec<Id>,
        tags: Vec<String>,
        has_attachments: bool,
        progress: SubtaskProgress,
    ) -> Self {
        TaskDto {
            id: t.id.clone(),
            project_id: t.project_id.clone(),
            parent_id: t.parent_id.clone(),
            series_id: t.series_id.clone(),
            occurrence_at: t.occurrence_at,
            title: t.title.clone(),
            description: t.description.clone(),
            priority: Priority::from_i64(t.priority),
            status: Status::parse(&t.status).unwrap_or(Status::Todo),
            completed_at: t.completed_at,
            start_at: t.start_at,
            due_at: t.due_at,
            all_day: t.all_day != 0,
            timezone: t.timezone.clone(),
            remind_enabled: t.remind_enabled != 0,
            remind_at: t.remind_at,
            remind_offset_min: t.remind_offset_min,
            recurrence_rule: t.recurrence_rule.clone(),
            recurrence_until: t.recurrence_until,
            tag_ids,
            tags,
            has_attachments,
            has_subtasks: progress.total > 0,
            subtask_done: progress.done,
            subtask_total: progress.total,
            sort_order: t.sort_order,
            created_at: t.created_at,
            updated_at: t.updated_at,
            version: t.version,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectStats {
    pub open: i64,
    pub completed: i64,
    pub overdue: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDto {
    pub id: Id,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub is_archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
    pub stats: Option<ProjectStats>,
}

impl ProjectDto {
    pub fn from_project(p: &Project, stats: Option<ProjectStats>) -> Self {
        ProjectDto {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            color: p.color.clone(),
            icon: p.icon.clone(),
            sort_order: p.sort_order,
            is_archived: p.is_archived != 0,
            created_at: p.created_at,
            updated_at: p.updated_at,
            version: p.version,
            stats,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDto {
    pub id: Id,
    pub name: String,
    pub color: Option<String>,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentDto {
    pub id: Id,
    pub task_id: Id,
    pub file_name: String,
    pub storage_kind: StorageKind,
    pub rel_path: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: Option<String>,
    pub created_at: i64,
}

impl AttachmentDto {
    pub fn from_attachment(a: &Attachment) -> Self {
        AttachmentDto {
            id: a.id.clone(),
            task_id: a.task_id.clone(),
            file_name: a.file_name.clone(),
            storage_kind: StorageKind::parse(&a.storage_kind).unwrap_or(StorageKind::Blob),
            rel_path: a.rel_path.clone(),
            mime_type: a.mime_type.clone(),
            size_bytes: a.size_bytes,
            sha256: a.sha256.clone(),
            created_at: a.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

// ---------------------------------------------------------------------------
// Inputs / patches
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub project_id: Option<Id>,
    /// Project by name, used when `project_id` is absent (imports and scripts
    /// carry names). Resolved by `create_task`; it must already exist.
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub parent_id: Option<Id>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub status: Option<Status>,
    #[serde(default)]
    pub start_at: Option<i64>,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub all_day: Option<bool>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub remind_enabled: Option<bool>,
    #[serde(default)]
    pub remind_at: Option<i64>,
    #[serde(default)]
    pub remind_offset_min: Option<i64>,
    #[serde(default)]
    pub recurrence_rule: Option<String>,
    #[serde(default)]
    pub recurrence_until: Option<i64>,
    #[serde(default)]
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

/// Partial update. `None` = leave unchanged; the `clear_*` flags null the field.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub status: Option<Status>,
    #[serde(default)]
    pub project_id: Option<Id>,
    #[serde(default)]
    pub parent_id: Option<Id>,
    #[serde(default)]
    pub start_at: Option<i64>,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub all_day: Option<bool>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub remind_enabled: Option<bool>,
    #[serde(default)]
    pub remind_at: Option<i64>,
    #[serde(default)]
    pub remind_offset_min: Option<i64>,
    #[serde(default)]
    pub recurrence_rule: Option<String>,
    #[serde(default)]
    pub recurrence_until: Option<i64>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub tag_names: Option<Vec<String>>,

    #[serde(default)]
    pub clear_project_id: bool,
    /// Move the task to the top level (no parent). Distinct from leaving
    /// `parent_id` unset, which means "don't touch the parent".
    #[serde(default)]
    pub clear_parent_id: bool,
    #[serde(default)]
    pub clear_start_at: bool,
    #[serde(default)]
    pub clear_due_at: bool,
    #[serde(default)]
    pub clear_remind_at: bool,
    #[serde(default)]
    pub clear_remind_offset: bool,
    #[serde(default)]
    pub clear_recurrence: bool,

    /// Optimistic concurrency: when set, the write fails with `Conflict` unless
    /// the stored version matches.
    #[serde(default)]
    pub expected_version: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub expected_version: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskFilter {
    #[serde(default)]
    pub project_ids: Option<Vec<Id>>,
    #[serde(default)]
    pub tag_ids: Option<Vec<Id>>,
    #[serde(default)]
    pub tag_match_all: bool,
    #[serde(default)]
    pub priorities: Option<Vec<Priority>>,
    #[serde(default)]
    pub statuses: Option<Vec<Status>>,
    #[serde(default)]
    pub due_before: Option<i64>,
    #[serde(default)]
    pub due_after: Option<i64>,
    #[serde(default)]
    pub start_before: Option<i64>,
    #[serde(default)]
    pub start_after: Option<i64>,
    /// Completion window, matched against `completed_at`. Unlike the due/start
    /// bounds this one only ever matches closed tasks, so it is a way to ask
    /// "what did I finish between X and Y".
    #[serde(default)]
    pub completed_after: Option<i64>,
    #[serde(default)]
    pub completed_before: Option<i64>,
    #[serde(default)]
    pub has_attachments: Option<bool>,
    #[serde(default)]
    pub parent_id: Option<Id>,
    #[serde(default)]
    pub root_only: bool,
    /// Only tasks that belong to no project — the Inbox (design §12.2: a
    /// cancelled `#project` picker files the task into the Inbox).
    #[serde(default)]
    pub unfiled: bool,
    #[serde(default)]
    pub include_completed: bool,
    #[serde(default)]
    pub search_text: Option<String>,
    #[serde(default = "default_sort")]
    pub sort: Sort,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

fn default_sort() -> Sort {
    Sort::CreatedDesc
}
