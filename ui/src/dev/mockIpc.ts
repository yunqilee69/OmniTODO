//! Dev-only Tauri IPC stub.
//!
//! The UI's whole data layer is `invoke()` from `@tauri-apps/api`, which only
//! exists inside the Tauri webview. This module installs a `__TAURI_INTERNALS__`
//! shim backed by fixtures and a small in-memory store, so `vite` can serve the
//! real components in a plain browser for layout review — no Rust side needed.
//!
//! It is reached only through `dev-preview.html`; the production `index.html`
//! entry never imports it, so nothing here ships.

import type {
  Page,
  Priority,
  ProjectDto,
  ProjectStats,
  SectionDto,
  TaskDto,
  TagDto,
} from "../api/client";

const DAY = 86_400_000;
/** All-day dates are civil dates (UTC midnight) — see `lib/dates.ts`. */
const civil = (offset: number) => Math.floor(Date.now() / DAY) * DAY + offset * DAY;
const SEEDED_AT = Date.now() - 30 * DAY;

const PRIORITY_RANK: Record<Priority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

let seq = 0;
const newId = (prefix: string) => `${prefix}-${++seq}`;

const isDone = (t: TaskDto) => t.status === "done" || t.status === "cancelled";

function makeTask(over: Partial<TaskDto> & Pick<TaskDto, "id" | "title">): TaskDto {
  return {
    project_id: null,
    parent_id: null,
    section_id: null,
    series_id: null,
    occurrence_at: null,
    description: null,
    priority: "none",
    status: "todo",
    completed_at: null,
    start_at: null,
    due_at: null,
    all_day: false,
    timezone: null,
    remind_enabled: false,
    remind_at: null,
    remind_offset_min: null,
    recurrence_rule: null,
    recurrence_until: null,
    tag_ids: [],
    tags: [],
    has_attachments: false,
    has_subtasks: false,
    subtask_done: 0,
    subtask_total: 0,
    sort_order: 0,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
    version: 1,
    ...over,
  };
}

const HOME = "t-home";

let projects: Omit<ProjectDto, "stats">[] = [
  {
    id: "p-zhi",
    name: "装修新家",
    description: null,
    color: "#d8493c",
    icon: null,
    sort_order: 0,
    is_archived: false,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
    version: 1,
  },
  {
    id: "p-zhong",
    name: "周末露营",
    description: null,
    color: "#3f7c4f",
    icon: null,
    sort_order: 1,
    is_archived: false,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
    version: 1,
  },
];

let tasks: TaskDto[] = [
  makeTask({
    id: "t1",
    project_id: "p-zhi",
    title: "确认水电改造的报价单，对比两家施工队",
    priority: "high",
    due_at: civil(-1),
    all_day: true,
    sort_order: 0,
    tag_ids: [HOME],
    tags: ["家庭"],
  }),
  makeTask({
    id: "t2",
    project_id: "p-zhi",
    title: "挑厨房瓷砖的样品，贴上墙看自然光下的色差",
    priority: "medium",
    section_id: "s-now",
    sort_order: 1,
  }),
  makeTask({
    id: "t3",
    project_id: "p-zhi",
    title: "规划阳台的收纳布局",
    description: "先量好尺寸再选置物架，绿植区要留出浇水的动线",
    priority: "medium",
    sort_order: 2,
  }),
  makeTask({
    id: "t4",
    project_id: "p-zhi",
    title: "约物业确认封窗施工需要的手续和进场时间",
    priority: "low",
    section_id: "s-now",
    sort_order: 3,
  }),
  makeTask({
    id: "t5",
    project_id: "p-zhi",
    title: "家具进场前先铺好地面保护膜",
    priority: "urgent",
    due_at: civil(1),
    all_day: true,
    sort_order: 4,
    tag_ids: [HOME],
    tags: ["家庭"],
  }),
  makeTask({
    id: "t6",
    project_id: "p-zhi",
    title: "客厅主灯换成可以调色温的款式",
    section_id: "s-next",
    sort_order: 5,
  }),
  makeTask({
    id: "t7",
    project_id: "p-zhi",
    title: "整理全屋开关插座的点位清单",
    priority: "high",
    sort_order: 6,
  }),
  makeTask({
    id: "t7a",
    parent_id: "t7",
    project_id: "p-zhi",
    title: "逐个房间核对插座的数量和安装高度",
    sort_order: 0,
  }),
  makeTask({
    id: "t7b",
    parent_id: "t7",
    project_id: "p-zhi",
    title: "给厨房的小家电单独留一路电",
    sort_order: 1,
  }),
  // A grandchild, so the preview exercises a nested branch (caret at depth 2).
  makeTask({
    id: "t7a1",
    parent_id: "t7a",
    project_id: "p-zhi",
    title: "把弱电箱的走线图一并更新",
    sort_order: 0,
  }),
  makeTask({
    id: "t8",
    project_id: "p-zhi",
    title: "定好各工种的进场顺序",
    status: "done",
    completed_at: SEEDED_AT + DAY,
    section_id: "s-next",
    sort_order: 7,
  }),
  makeTask({ id: "t9", project_id: "p-zhong", title: "列出露营装备清单，检查气罐和头灯", sort_order: 0 }),
  makeTask({ id: "t10", title: "清理订阅邮件和下载文件夹" }),
];

let sections: SectionDto[] = [
  {
    id: "s-now",
    project_id: "p-zhi",
    name: "进行中",
    sort_order: 0,
    task_count: 0,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
    version: 1,
  },
  {
    id: "s-next",
    project_id: "p-zhi",
    name: "待排期",
    sort_order: 1,
    task_count: 0,
    created_at: SEEDED_AT,
    updated_at: SEEDED_AT,
    version: 1,
  },
];

let tags: TagDto[] = [{ id: HOME, name: "家庭", color: null, count: 2 }];

const settings = new Map<string, unknown>([
  ["ui.theme", "dark"],
  ["ui.project.show_completed", true],
  ["ui.project.sort", "manual"],
  ["ui.project.view_mode", "board"],
]);

/** Recompute each section's live top-level count, the way the core's
 *  `section_task_count` does (subtasks belong to their parent's row). */
function countSections(): void {
  for (const section of sections) {
    section.task_count = tasks.filter(
      (t) => t.section_id === section.id && !t.parent_id,
    ).length;
  }
}

/** Recompute every row's branch fields from the parent links. */
function rollUp(): void {
  const children = new Map<string, TaskDto[]>();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    const list = children.get(t.parent_id) ?? [];
    list.push(t);
    children.set(t.parent_id, list);
  }
  const subtree = (t: TaskDto): { done: number; total: number } => {
    const kids = children.get(t.id) ?? [];
    let done = 0;
    let total = 0;
    for (const kid of kids) {
      const sub = subtree(kid);
      total += 1 + sub.total;
      done += (isDone(kid) ? 1 : 0) + sub.done;
    }
    return { done, total };
  };
  for (const t of tasks) {
    const kids = children.get(t.id) ?? [];
    const { done, total } = subtree(t);
    t.has_subtasks = kids.length > 0;
    t.subtask_done = done;
    t.subtask_total = total;
  }
  countSections();
}

function subtreeIds(parentId: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const t of tasks) {
      if (t.parent_id === pid) {
        out.push(t.id);
        walk(t.id);
      }
    }
  };
  walk(parentId);
  return out;
}

/** Live top-level tasks filed in a section (the core's `section_task_count`). */
function countOf(sectionId: string): number {
  return tasks.filter((t) => t.section_id === sectionId && !t.parent_id).length;
}

function statsFor(projectId: string): ProjectStats {
  const now = Date.now();
  const mine = tasks.filter((t) => t.project_id === projectId);
  return {
    open: mine.filter((t) => t.status === "todo" || t.status === "in_progress").length,
    completed: mine.filter((t) => t.status === "done").length,
    overdue: mine.filter((t) => t.due_at != null && t.due_at < now && !isDone(t)).length,
  };
}

const withStats = (p: Omit<ProjectDto, "stats">): ProjectDto => ({ ...p, stats: statsFor(p.id) });

/** Fields a `TaskPatch` may set directly (the mock has no validation layer). */
const PATCHABLE = [
  "title",
  "description",
  "priority",
  "status",
  "project_id",
  "parent_id",
  "section_id",
  "due_at",
  "start_at",
  "all_day",
  "timezone",
  "remind_enabled",
  "remind_at",
  "remind_offset_min",
  "recurrence_rule",
  "recurrence_until",
  "sort_order",
] as const;

function applyPatch(task: TaskDto, patch: Record<string, unknown>): void {
  const row = task as unknown as Record<string, unknown>;
  const clears: [string, string][] = [
    ["clear_project_id", "project_id"],
    ["clear_parent_id", "parent_id"],
    ["clear_section_id", "section_id"],
    ["clear_start_at", "start_at"],
    ["clear_due_at", "due_at"],
    ["clear_remind_at", "remind_at"],
    ["clear_remind_offset", "remind_offset_min"],
    ["clear_recurrence", "recurrence_rule"],
  ];
  for (const [flag, field] of clears) {
    if (patch[flag] === true) row[field] = null;
  }
  for (const key of PATCHABLE) {
    const value = patch[key];
    if (value !== undefined) row[key] = value;
  }
  if (Array.isArray(patch.tag_names)) {
    task.tags = patch.tag_names as string[];
    task.tag_ids = task.tags.map((name) => tags.find((t) => t.name === name)?.id ?? name);
  }
  if (patch.status === "done" && !task.completed_at) task.completed_at = Date.now();
  if (patch.status === "todo" || patch.status === "in_progress") task.completed_at = null;
  task.updated_at = Date.now();
  task.version += 1;
}

function filterTasks(raw: Record<string, unknown> | undefined, text?: string): TaskDto[] {
  const f = (raw ?? {}) as Record<string, unknown>;
  const projectIds = f.project_ids as string[] | undefined;
  const statuses = f.statuses as string[] | undefined;
  const tagIds = f.tag_ids as string[] | undefined;
  const sectionIds = f.section_ids as string[] | undefined;
  const needle = (text ?? (f.search_text as string | undefined))?.toLowerCase();

  let items = tasks.filter((t) => {
    if (!f.include_completed && isDone(t)) return false;
    if (projectIds?.length && !(t.project_id && projectIds.includes(t.project_id))) return false;
    if (f.unfiled === true && t.project_id) return false;
    if (f.unfiled_section === true && t.section_id) return false;
    if (sectionIds?.length && !(t.section_id && sectionIds.includes(t.section_id))) return false;
    if (f.root_only === true && t.parent_id) return false;
    if (f.parent_id != null && t.parent_id !== f.parent_id) return false;
    if (statuses?.length && !statuses.includes(t.status)) return false;
    if (tagIds?.length && !tagIds.some((id) => t.tag_ids.includes(id))) return false;
    if (needle) {
      const hay = `${t.title} ${t.description ?? ""} ${t.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const due = (t: TaskDto) => t.due_at ?? Number.MAX_SAFE_INTEGER;
  const comparators: Record<string, (a: TaskDto, b: TaskDto) => number> = {
    manual: (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title),
    dueasc: (a, b) => due(a) - due(b) || a.sort_order - b.sort_order,
    createddesc: (a, b) => b.created_at - a.created_at || a.sort_order - b.sort_order,
    prioritydesc: (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.sort_order - b.sort_order,
  };
  items = [...items].sort(comparators[(f.sort as string) ?? "createddesc"] ?? comparators.manual);
  return items;
}

function page(items: TaskDto[], raw: Record<string, unknown> | undefined): Page<TaskDto> {
  const f = (raw ?? {}) as Record<string, unknown>;
  const limit = (f.limit as number | null) ?? 200;
  const offset = (f.offset as number | null) ?? 0;
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

const findTask = (id: string) => tasks.find((t) => t.id === id);

/** Handlers keyed by Tauri command; anything unhandled resolves to null. */
function buildHandlers(): Record<string, (args: Record<string, unknown>) => unknown> {
  // MCP panel state. Mutable so the token controls, the HTTP switch and the
  // write switch can actually be exercised in the preview rather than only
  // rendered once in their initial state.
  const mockMcp = {
    write: false,
    http: false,
    controlToken: "01a13d2b4c6b73d59d4d1d5df84e0c7d01a13d2b4c6b73d59d4d1d5eec1f922a",
    httpToken: "01a13d5190387057af79b84822083c8301a13d5190387057af79b84b785cb914",
  };
  const MOCK_BIN = "C:\\Program Files\\OmniTODO\\omnitodo-mcp.exe";
  const setMockToken = (kind: string, token: string) => {
    if (kind === "control") mockMcp.controlToken = token;
    else mockMcp.httpToken = token;
  };
  // Mirrors what `omnitodo-desktop/src/mcp_config.rs` produces, so the panel's
  // layout is reviewed against realistic long paths and a real 64-char token.
  const mockArgs = () => [
    "--db",
    "C:\\Users\\dev\\.omnitodo\\omnitodo.db",
    "--notify",
    "http://127.0.0.1:8788/internal/notify",
    "--notify-token",
    mockMcp.controlToken,
    ...(mockMcp.write ? ["--write"] : []),
  ];
  const mockZcodeConfig = () =>
    JSON.stringify(
      { mcp: { servers: { OmniTODO: { type: "stdio", command: MOCK_BIN, args: mockArgs() } } } },
      null,
      2,
    );
  const mockGenericConfig = () =>
    JSON.stringify({ mcpServers: { omnitodo: { command: MOCK_BIN, args: mockArgs() } } }, null, 2);
  const mockArgsLine = () => [MOCK_BIN, ...mockArgs()].join(" ");

  /** One new task from a create input. `task_create` and `task_add_subtask`
   *  share it — the two differ only in which parent and project they carry.
   *  New siblings land after the last one, like the core's `sort_order`. */
  const makeFromInput = (input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const projectId = (raw.project_id as string | null) ?? null;
    const parentId = (raw.parent_id as string | null) ?? null;
    const siblings = tasks.filter((t) => t.project_id === projectId && t.parent_id === parentId);
    const task = makeTask({
      id: newId("dev"),
      title: String(raw.title ?? "未命名任务"),
      description: (raw.description as string | null) ?? null,
      project_id: projectId,
      parent_id: parentId,
      // Mirrors the core: a subtask has no column of its own (§5.9).
      section_id: parentId ? null : ((raw.section_id as string | null) ?? null),
      priority: (raw.priority as Priority) ?? "none",
      status: (raw.status as TaskDto["status"]) ?? "todo",
      due_at: (raw.due_at as number | null) ?? null,
      start_at: (raw.start_at as number | null) ?? null,
      all_day: Boolean(raw.all_day),
      created_at: Date.now(),
      updated_at: Date.now(),
      sort_order: raw.sort_order != null ? Number(raw.sort_order) : siblings.length,
    });
    if (Array.isArray(raw.tag_names)) {
      task.tags = raw.tag_names as string[];
      task.tag_ids = task.tags.map((n) => tags.find((t) => t.name === n)?.id ?? n);
    }
    tasks = [...tasks, task];
    rollUp();
    return task;
  };

  return {
    // ---- events (registerEventBridge / App.tsx listeners) ----
    "plugin:event|listen": () => 1,
    "plugin:event|unlisten": () => null,

    // ---- tasks ----
    task_list: ({ filter }) => {
      rollUp();
      return page(filterTasks(filter as Record<string, unknown>), undefined);
    },
    search_query: ({ query, filter }) =>
      page(filterTasks(filter as Record<string, unknown>, String(query ?? "")), filter as Record<string, unknown>),
    task_get: ({ id }) => {
      const task = findTask(String(id));
      if (!task) throw new Error(`task ${id} not found`);
      return task;
    },
    task_list_subtasks: ({ id }) => {
      rollUp();
      const ids = subtreeIds(String(id));
      // Mirrors the core's `ORDER BY sort_order, created_at`, so a drag within a
      // branch reads back in its new order like it does against the real store.
      return tasks
        .filter((t) => ids.includes(t.id))
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
    },
    task_update: ({ id, patch }) => {
      const task = findTask(String(id));
      if (!task) throw new Error(`task ${id} not found`);
      applyPatch(task, (patch ?? {}) as Record<string, unknown>);
      rollUp();
      return task;
    },
    task_complete: ({ id }) => {
      const task = findTask(String(id));
      if (task) applyPatch(task, { status: "done" });
      rollUp();
      return task;
    },
    task_uncomplete: ({ id }) => {
      const task = findTask(String(id));
      if (task) applyPatch(task, { status: "todo" });
      rollUp();
      return task;
    },
    task_create: ({ input }) => makeFromInput(input),

    // Mirrors the core: the child files under its parent and inherits the
    // parent's project when the input names none.
    task_add_subtask: ({ parentId, input }) => {
      const parent = findTask(String(parentId));
      if (!parent) throw new Error(`task ${parentId} not found`);
      const raw = (input ?? {}) as Record<string, unknown>;
      return makeFromInput({ ...raw, parent_id: parent.id, project_id: raw.project_id ?? parent.project_id });
    },
    task_delete: ({ id }) => {
      const ids = [String(id), ...subtreeIds(String(id))];
      tasks = tasks.filter((t) => !ids.includes(t.id));
      rollUp();
      return ids.length;
    },
    task_move: ({ id, projectId, parentId, sortOrder }) => {
      const task = findTask(String(id));
      if (!task) throw new Error(`task ${id} not found`);
      // A move that changes the project or gives the task a parent leaves the
      // old section behind — it describes a column of the project being left.
      if (projectId !== undefined) {
        if (projectId !== task.project_id) task.section_id = null;
        task.project_id = projectId as string | null;
      }
      if (parentId !== undefined) {
        if (parentId) task.section_id = null;
        task.parent_id = parentId as string | null;
      }
      if (sortOrder !== undefined) task.sort_order = Number(sortOrder);
      task.updated_at = Date.now();
      task.version += 1;
      rollUp();
      return task;
    },
    task_reorder: ({ ids }) => {
      (ids as string[]).forEach((id, index) => {
        const task = findTask(id);
        if (task) task.sort_order = index;
      });
      return null;
    },
    task_bulk_update: ({ ids, patch }) => {
      for (const id of ids as string[]) {
        const task = findTask(id);
        if (task) applyPatch(task, (patch ?? {}) as Record<string, unknown>);
      }
      rollUp();
      return (ids as string[]).length;
    },

    // ---- projects ----
    project_list: ({ includeArchived }) =>
      projects
        .filter((p) => includeArchived === true || !p.is_archived)
        .map(withStats),
    project_get: ({ id }) => {
      const project = projects.find((p) => p.id === id);
      if (!project) throw new Error(`project ${id} not found`);
      return withStats(project);
    },
    project_create: ({ input }) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const project = {
        id: newId("p-dev"),
        name: String(raw.name ?? "新项目"),
        description: null,
        color: (raw.color as string | null) ?? null,
        icon: null,
        sort_order: projects.length,
        is_archived: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        version: 1,
      };
      projects = [...projects, project];
      return withStats(project);
    },
    project_update: ({ id, patch }) => {
      const project = projects.find((p) => p.id === id);
      if (!project) throw new Error(`project ${id} not found`);
      Object.assign(project, patch as Record<string, unknown>, { updated_at: Date.now() });
      project.version += 1;
      return withStats(project);
    },
    project_delete: ({ id }) => {
      projects = projects.filter((p) => p.id !== id);
      sections = sections.filter((s) => s.project_id !== id);
      const doomed = tasks.filter((t) => t.project_id === id).map((t) => t.id);
      tasks = tasks.filter((t) => t.project_id !== id);
      return doomed.length;
    },
    project_reorder: ({ ids }) => {
      (ids as string[]).forEach((id, index) => {
        const project = projects.find((p) => p.id === id);
        if (project) project.sort_order = index;
      });
      return null;
    },
    project_find_similar: () => [],

    // ---- sections ----
    section_list: ({ projectId }) =>
      sections
        .filter((s) => s.project_id === projectId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ ...s, task_count: countOf(s.id) })),
    section_create: ({ input }) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const projectId = String(raw.project_id ?? "");
      const section: SectionDto = {
        id: newId("s-dev"),
        project_id: projectId,
        name: String(raw.name ?? "新板块"),
        sort_order: sections.filter((s) => s.project_id === projectId).length,
        task_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
        version: 1,
      };
      sections = [...sections, section];
      return section;
    },
    section_update: ({ id, patch }) => {
      const section = sections.find((s) => s.id === id);
      if (!section) throw new Error(`section ${id} not found`);
      const raw = (patch ?? {}) as Record<string, unknown>;
      if (raw.name !== undefined) section.name = String(raw.name);
      if (raw.sort_order !== undefined) section.sort_order = Number(raw.sort_order);
      section.updated_at = Date.now();
      section.version += 1;
      return section;
    },
    section_reorder: ({ ids }) => {
      (ids as string[]).forEach((id, index) => {
        const section = sections.find((s) => s.id === id);
        if (section) section.sort_order = index;
      });
      return null;
    },
    section_delete: ({ id, deleteTasks }) => {
      const doomed = tasks.filter((t) => t.section_id === id && !t.parent_id);
      if (deleteTasks === true) {
        const ids = new Set<string>();
        for (const t of doomed) {
          ids.add(t.id);
          for (const child of subtreeIds(t.id)) ids.add(child);
        }
        tasks = tasks.filter((t) => !ids.has(t.id));
        sections = sections.filter((s) => s.id !== id);
        rollUp();
        return ids.size;
      }
      for (const t of tasks) if (t.section_id === id) t.section_id = null;
      sections = sections.filter((s) => s.id !== id);
      rollUp();
      return doomed.length;
    },

    // ---- tags ----
    tag_list: () => tags,
    tag_create: ({ name, color }) => {
      const tag: TagDto = { id: newId("t-dev"), name: String(name), color: (color as string) ?? null, count: 0 };
      tags = [...tags, tag];
      return tag;
    },
    tag_rename: () => null,
    tag_merge: () => null,
    tag_delete: () => null,

    // ---- settings ----
    settings_get: ({ key }) => settings.get(String(key)) ?? null,
    settings_set: ({ key, value }) => {
      if (key === "mcp.write_enabled") mockMcp.write = value === true;
      settings.set(String(key), value);
      return null;
    },

    // ---- reminders / misc ----
    reminder_due_now: () => [],
    reminder_missed: () => [],
    reminder_mark_fired: () => null,
    reminder_snooze: () => Date.now() + 600_000,
    materialize_due: () => 0,
    // Materialised occurrences only — the mock has no recurrence engine, so the
    // virtual-occurrence half of the calendar is exercised against the core.
    calendar: ({ from, to, projectId }) =>
      tasks
        .filter((t) => (projectId == null ? true : t.project_id === projectId))
        .filter((t) => {
          const at = t.due_at ?? t.start_at;
          return at != null && at >= Number(from) && at <= Number(to);
        })
        .map((t) => ({
          task_id: t.id,
          series_id: t.series_id,
          title: t.title,
          start_at: t.start_at,
          due_at: t.due_at,
          all_day: t.all_day,
          status: t.status,
          virtual_occurrence: false,
        })),
    report_summary: () => ({
      total: 0,
      open: 0,
      completed: 0,
      completed_in_window: 0,
      overdue: 0,
      due_soon: 0,
      by_project: [],
      by_priority: [],
      by_status: [],
      throughput: [],
      avg_time_to_complete_ms: null,
      on_time_rate: null,
    }),
    mcp_status: () => ({
      version: "0.1.0-dev-preview",
      stdio: {
        bin_path: "C:\\Program Files\\OmniTODO\\omnitodo-mcp.exe",
        exists: true,
        always_available: true,
      },
      http: { running: mockMcp.http, port: mockMcp.http ? 8787 : 0, token: mockMcp.httpToken },
      control: {
        port: 8788,
        token: mockMcp.controlToken,
        state: "listening" as const,
        error: null,
      },
      write_enabled: mockMcp.write,
      db_path: "C:\\Users\\dev\\.omnitodo\\omnitodo.db",
      data_dir: "C:\\Users\\dev\\.omnitodo",
    }),
    mcp_copy_client_config: () => mockGenericConfig(),
    mcp_zcode_config: () => mockZcodeConfig(),
    mcp_args_line: () => mockArgsLine(),
    mcp_set_token: ({ kind, token }) => {
      setMockToken(String(kind), String(token));
      return null;
    },
    mcp_regenerate_token: ({ kind }) => {
      const next = `${Date.now().toString(16).padStart(24, "0")}${"a".repeat(40)}`;
      setMockToken(String(kind), next);
      return next;
    },
    mcp_http_start: () => {
      mockMcp.http = true;
      return null;
    },
    mcp_http_stop: () => {
      mockMcp.http = false;
      return null;
    },
    control_config: () => ({ port: 8788, token: mockMcp.controlToken }),
    app_version: () => "0.1.0-dev-preview",
    app_releases_url: () => "https://github.com/",
    quickadd_parse: ({ text }) => ({
      title: String(text ?? ""),
      priority: null,
      tag_names: [],
      project_name: null,
      project_candidates: [],
      needs_project_choice: false,
      start_at: null,
      due_at: null,
      all_day: false,
      remind_offset_min: null,
      recurrence_rule: null,
      description: null,
    }),
    // The panel hands over an already-parsed draft, so this only has to file it:
    // the project the panel was opened for, or the draft's own `#project` by
    // name. Without this the preview's quick-add silently did nothing, which
    // also hid the calendar's click-to-create seed.
    quickadd_commit: ({ draft, projectId }) => {
      const raw = (draft ?? {}) as Record<string, unknown>;
      const named = raw.project_name
        ? projects.find(
            (p) => p.name.toLowerCase() === String(raw.project_name).toLowerCase(),
          )?.id
        : undefined;
      return makeFromInput({
        title: raw.title,
        description: raw.description ?? null,
        project_id: (projectId as string | null) || named || null,
        priority: raw.priority ?? "none",
        due_at: raw.due_at ?? null,
        start_at: raw.start_at ?? null,
        all_day: Boolean(raw.all_day),
        tag_names: raw.tag_names ?? [],
      });
    },
  };
}

/**
 * Install the shim on `window`. Must run before the app's first `invoke` — the
 * preview entry calls it before importing `main.tsx`.
 */
export function installMockIpc(): void {
  const handlers = buildHandlers();
  let callbackSeq = 0;
  const callbacks = new Map<number, (payload: unknown) => void>();

  const internals = {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      const handler = handlers[cmd];
      if (!handler) {
        console.warn(`[dev mock] unhandled command: ${cmd}`);
        return null;
      }
      return handler(args);
    },
    transformCallback: (cb: (payload: unknown) => void) => {
      const id = ++callbackSeq;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    convertFileSrc: (path: string) => path,
  };

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = internals;
  rollUp();
}
