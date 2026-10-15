/**
 * MCP panel data and validation (design §11.3/§11.4).
 *
 * The tool lists mirror `crates/omnitodo-mcp/src/tools.rs`. They are duplicated
 * rather than fetched so the panel renders the capability table without a round
 * trip; `mcpConfig.test.ts` pins the counts, so a tool added on the Rust side
 * that is not reflected here fails the test suite instead of silently drifting.
 */

/** Read tools, always registered (design §11.3). */
export const READ_TOOLS = [
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
] as const;

/** Write tools, registered only when `mcp.write_enabled` is on (design §11.3). */
export const WRITE_TOOLS = [
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "add_subtask",
  "add_tags",
  "move_task",
] as const;

/** A row of the capability table: which tools, and in which modes they exist. */
export interface CapabilityGroup {
  label: string;
  tools: string[];
  /** `read` = available on a read-only instance, `write` = needs the write switch. */
  mode: "read" | "write";
}

/**
 * Grouped by what a user would ask for, not by tool name. Read-only groups list
 * read tools; write groups list write tools, so the "只读" column reads as a
 * straight yes/no per row.
 */
export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    label: "浏览项目、任务、标签与附件元数据",
    tools: [
      "list_projects",
      "get_project",
      "list_tasks",
      "get_task",
      "list_subtasks",
      "list_tags",
      "list_attachments",
    ],
    mode: "read",
  },
  {
    label: "搜索、日历、临近任务与提醒计划",
    tools: ["search_tasks", "list_calendar", "list_upcoming", "list_due_reminders"],
    mode: "read",
  },
  {
    label: "统计报告与导出",
    tools: ["summary_report", "export_tasks"],
    mode: "read",
  },
  { label: "新建任务与子任务", tools: ["create_task", "add_subtask"], mode: "write" },
  {
    label: "修改、完成、移动任务与加标签",
    tools: ["update_task", "complete_task", "add_tags", "move_task"],
    mode: "write",
  },
  { label: "删除任务（软删除，并写审计日志）", tools: ["delete_task"], mode: "write" },
];

/** Token rules, mirrored from `omnitodo-core/src/service/endpoint.rs`. */
export const TOKEN_MIN_LEN = 16;
export const TOKEN_MAX_LEN = 128;
const TOKEN_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Returns an error message, or `null` when the token is usable.
 *
 * The rules exist because the token travels in an `Authorization: Bearer <t>`
 * header: a quote or a space there produces a request that cannot authenticate,
 * and the failure shows up far from the input that caused it.
 */
export function validateToken(token: string): string | null {
  if (token.length < TOKEN_MIN_LEN || token.length > TOKEN_MAX_LEN) {
    return `长度需在 ${TOKEN_MIN_LEN}–${TOKEN_MAX_LEN} 字符之间（当前 ${token.length}）`;
  }
  if (!TOKEN_CHARS.test(token)) {
    return "只能包含 A–Z a–z 0–9 - _，引号与空格会破坏 Authorization 头";
  }
  return null;
}
