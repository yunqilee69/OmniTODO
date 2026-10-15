// Typed wrappers over the Tauri commands (design §8.1). The Rust side is the
// source of truth for these shapes.

import { invoke } from "@tauri-apps/api/core";

export type Id = string;

export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type Status = "todo" | "in_progress" | "done" | "cancelled";
export type StorageKind = "blob" | "managed";

export interface TaskDto {
  id: Id;
  project_id: Id | null;
  parent_id: Id | null;
  series_id: Id | null;
  occurrence_at: number | null;
  title: string;
  description: string | null;
  priority: Priority;
  status: Status;
  completed_at: number | null;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
  timezone: string | null;
  remind_enabled: boolean;
  remind_at: number | null;
  remind_offset_min: number | null;
  recurrence_rule: string | null;
  recurrence_until: number | null;
  tag_ids: Id[];
  tags: string[];
  has_attachments: boolean;
  /** At least one task has this one as `parent_id` (drives list expansion). */
  has_subtasks: boolean;
  /** Subtree roll-up behind the row's progress chip: ticked / total
   *  descendants, counted over every level so it matches the branch that
   *  expanding the row reveals. */
  subtask_done: number;
  subtask_total: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  version: number;
}

export interface ProjectStats {
  open: number;
  completed: number;
  overdue: number;
}

export interface ProjectDto {
  id: Id;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_archived: boolean;
  created_at: number;
  updated_at: number;
  version: number;
  stats: ProjectStats | null;
}

export interface TagDto {
  id: Id;
  name: string;
  color: string | null;
  count: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type Sort = "dueasc" | "createddesc" | "prioritydesc" | "manual";

export interface TaskFilter {
  project_ids?: Id[] | null;
  tag_ids?: Id[] | null;
  tag_match_all?: boolean;
  priorities?: Priority[] | null;
  statuses?: Status[] | null;
  due_before?: number | null;
  due_after?: number | null;
  start_before?: number | null;
  start_after?: number | null;
  has_attachments?: boolean | null;
  parent_id?: Id | null;
  root_only?: boolean;
  /** Only tasks with no project (the Inbox). */
  unfiled?: boolean;
  include_completed?: boolean;
  search_text?: string | null;
  sort?: Sort;
  limit?: number | null;
  offset?: number | null;
}

export interface CreateTaskInput {
  title: string;
  project_id?: Id | null;
  parent_id?: Id | null;
  description?: string | null;
  priority?: Priority | null;
  status?: Status | null;
  due_at?: number | null;
  start_at?: number | null;
  all_day?: boolean | null;
  timezone?: string | null;
  remind_enabled?: boolean | null;
  remind_at?: number | null;
  remind_offset_min?: number | null;
  recurrence_rule?: string | null;
  recurrence_until?: number | null;
  tag_names?: string[];
  sort_order?: number | null;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  priority?: Priority;
  status?: Status;
  project_id?: Id;
  parent_id?: Id;
  due_at?: number;
  start_at?: number;
  all_day?: boolean;
  timezone?: string;
  remind_enabled?: boolean;
  remind_at?: number;
  remind_offset_min?: number;
  recurrence_rule?: string;
  recurrence_until?: number;
  sort_order?: number;
  tag_names?: string[];
  clear_project_id?: boolean;
  clear_start_at?: boolean;
  clear_due_at?: boolean;
  clear_remind_at?: boolean;
  clear_remind_offset?: boolean;
  clear_recurrence?: boolean;
  expected_version?: number;
}

export interface QuickAddDraft {
  title: string;
  priority: Priority | null;
  tag_names: string[];
  project_name: string | null;
  project_candidates: ProjectDto[];
  needs_project_choice: boolean;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
  remind_offset_min: number | null;
  recurrence_rule: string | null;
  description: string | null;
}

export interface ReportSummary {
  total: number;
  open: number;
  /** Live tasks currently done. Not bounded by the report window. */
  completed: number;
  /** Completions of live tasks inside the window; the sum of `throughput`. */
  completed_in_window: number;
  overdue: number;
  due_soon: number;
  by_project: { key: string; open: number; completed: number; overdue: number }[];
  by_priority: { key: string; open: number; completed: number; overdue: number }[];
  by_status: [string, number][];
  throughput: [string, number][];
  avg_time_to_complete_ms: number | null;
  on_time_rate: number | null;
}

/** Which loopback token a settings action targets (design §4.5/§11.2). */
export type McpTokenKind = "control" | "http";

/** Lifecycle of the loopback control endpoint. */
export type McpControlState = "starting" | "listening" | "failed";

export interface McpStatus {
  /** Version of the bundled sidecar (same workspace version as the app). */
  version: string;
  stdio: { bin_path: string; exists: boolean; always_available: boolean };
  http: { running: boolean; port: number; token: string };
  /** Loopback endpoint external MCP instances call after a write (design §4.5). */
  control: {
    port: number;
    token: string;
    state: McpControlState;
    /** Why the bind failed, when `state` is `failed`. */
    error: string | null;
  };
  write_enabled: boolean;
  db_path: string;
  data_dir: string;
}

export interface CalendarItemDto {
  task_id: Id | null;
  series_id: Id | null;
  title: string;
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
  status: Status;
  virtual_occurrence: boolean;
}

export interface AttachmentDto {
  id: Id;
  task_id: Id;
  file_name: string;
  storage_kind: StorageKind;
  rel_path: string | null;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  created_at: number;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  sort_order?: number;
  is_archived?: boolean;
  expected_version?: number;
}

/** A reminder that is due (or was missed) for a task occurrence. */
export interface ReminderHit {
  task_id: Id;
  title: string;
  occurrence_at: number;
  when: number;
}

export type ExportFormat = "json" | "csv" | "md";
export type ImportFormat = "markdown" | "todotxt" | "todoist";

export const api = {
  // tasks
  taskCreate: (input: CreateTaskInput) => invoke<TaskDto>("task_create", { input }),
  taskGet: (id: Id) => invoke<TaskDto>("task_get", { id }),
  taskList: (filter: TaskFilter) => invoke<Page<TaskDto>>("task_list", { filter }),
  taskUpdate: (id: Id, patch: TaskPatch) => invoke<TaskDto>("task_update", { id, patch }),
  taskComplete: (id: Id) => invoke<TaskDto>("task_complete", { id }),
  taskUncomplete: (id: Id) => invoke<TaskDto>("task_uncomplete", { id }),
  taskDelete: (id: Id) => invoke<number>("task_delete", { id }),
  taskListSubtasks: (id: Id) => invoke<TaskDto[]>("task_list_subtasks", { id }),
  taskAddSubtask: (parentId: Id, input: CreateTaskInput) =>
    invoke<TaskDto>("task_add_subtask", { parentId, input }),
  taskBulkUpdate: (ids: Id[], patch: TaskPatch) =>
    invoke<number>("task_bulk_update", { ids, patch }),
  /** Move across projects / parents, or set an explicit sort position. */
  taskMove: (id: Id, projectId?: Id | null, parentId?: Id | null, sortOrder?: number) =>
    invoke<TaskDto>("task_move", { id, projectId, parentId, sortOrder }),
  /** Persist the order of a dragged list (pairs with `sort: "manual"`). */
  taskReorder: (ids: Id[]) => invoke<void>("task_reorder", { ids }),

  // projects
  projectList: (includeArchived = false) =>
    invoke<ProjectDto[]>("project_list", { includeArchived }),
  projectGet: (id: Id) => invoke<ProjectDto>("project_get", { id }),
  projectCreate: (name: string, color?: string) =>
    invoke<ProjectDto>("project_create", { input: { name, color } }),
  projectUpdate: (id: Id, patch: ProjectPatch) =>
    invoke<ProjectDto>("project_update", { id, patch }),
  projectReorder: (ids: Id[]) => invoke<void>("project_reorder", { ids }),
  projectDelete: (id: Id) => invoke<number>("project_delete", { id }),
  projectFindSimilar: (name: string) => invoke<ProjectDto[]>("project_find_similar", { name }),

  // tags
  tagList: () => invoke<TagDto[]>("tag_list"),
  tagCreate: (name: string, color?: string) =>
    invoke<TagDto>("tag_create", { name, color }),
  tagRename: (id: Id, name: string) => invoke<void>("tag_rename", { id, name }),
  tagMerge: (from: Id, to: Id) => invoke<void>("tag_merge", { from, to }),
  tagDelete: (id: Id) => invoke<void>("tag_delete", { id }),

  // attachments
  attachmentAddBlob: (taskId: Id, path: string) =>
    invoke<AttachmentDto>("attachment_add_blob", { taskId, path }),
  attachmentAddManaged: (taskId: Id, path: string) =>
    invoke<AttachmentDto>("attachment_add_managed", { taskId, path }),
  attachmentList: (taskId: Id) => invoke<AttachmentDto[]>("attachment_list", { taskId }),
  attachmentOpen: (id: Id) => invoke<string>("attachment_open", { id }),
  attachmentRemove: (id: Id) => invoke<void>("attachment_remove", { id }),

  // search & quick add
  search: (query: string, filter: TaskFilter) =>
    invoke<Page<TaskDto>>("search_query", { query, filter }),
  quickaddParse: (text: string) => invoke<QuickAddDraft>("quickadd_parse", { text }),
  quickaddCommit: (draft: QuickAddDraft, projectId?: Id) =>
    invoke<TaskDto>("quickadd_commit", { draft, projectId }),

  // recurrence
  recurrenceCanonical: (rule: string) => invoke<string>("recurrence_canonical", { rule }),
  recurrencePreview: (rule: string, anchor: number, from: number, to: number) =>
    invoke<number[]>("recurrence_preview", { rule, anchor, from, to }),

  // reminders
  reminderDueNow: () => invoke<ReminderHit[]>("reminder_due_now"),
  /** Reminders missed while the app was closed; drained on read (design §9.2). */
  reminderMissed: () => invoke<ReminderHit[]>("reminder_missed"),
  reminderMarkFired: (taskId: Id, occurrenceAt: number) =>
    invoke<void>("reminder_mark_fired", { taskId, occurrenceAt }),
  /** Push a reminder `minutes` into the future; resolves to the new instant. */
  reminderSnooze: (taskId: Id, occurrenceAt: number | null, minutes = 10) =>
    invoke<number>("reminder_snooze", { taskId, occurrenceAt, minutes }),
  materializeDue: () => invoke<number>("materialize_due"),

  // report / settings / io / mcp
  reportSummary: (days = 30) => invoke<ReportSummary>("report_summary", { days }),
  calendar: (from: number, to: number) => invoke<CalendarItemDto[]>("calendar", { from, to }),
  settingsGet: (key: string) => invoke<unknown>("settings_get", { key }),
  settingsSet: (key: string, value: unknown) => invoke<void>("settings_set", { key, value }),
  importRun: (content: string, format: ImportFormat) =>
    invoke<number>("import_run", { content, format }),
  exportRun: (filter: TaskFilter, format: ExportFormat) =>
    invoke<string>("export_run", { filter, format }),
  mcpStatus: () => invoke<McpStatus>("mcp_status"),
  mcpHttpStart: (port?: number) => invoke<void>("mcp_http_start", { port }),
  mcpHttpStop: () => invoke<void>("mcp_http_stop"),
  /** The `mcpServers` shape most clients read (absolute `command`). */
  mcpCopyClientConfig: () => invoke<string>("mcp_copy_client_config"),
  /** ZCode's own shape: `~/.zcode/cli/config.json` → `mcp.servers`. */
  mcpZcodeConfig: () => invoke<string>("mcp_zcode_config"),
  /** One line for ZCode's "参数（空格分隔）" form field. */
  mcpArgsLine: () => invoke<string>("mcp_args_line"),
  mcpSetToken: (kind: McpTokenKind, token: string) =>
    invoke<void>("mcp_set_token", { kind, token }),
  mcpRegenerateToken: (kind: McpTokenKind) =>
    invoke<string>("mcp_regenerate_token", { kind }),
  controlConfig: () => invoke<{ port: number; token: string }>("control_config"),
  appVersion: () => invoke<string>("app_version"),
  appReleasesUrl: () => invoke<string>("app_releases_url"),
};
