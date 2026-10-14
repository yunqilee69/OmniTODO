//! Dev-only Tauri IPC stub.
//!
//! The UI's whole data layer is `invoke()` from `@tauri-apps/api`, which only
//! exists inside the Tauri webview. This module installs a `__TAURI_INTERNALS__`
//! shim backed by fixtures and a small in-memory store, so `vite` can serve the
//! real components in a plain browser for layout review — no Rust side needed.
//!
//! It is reached only through `dev-preview.html`; the production `index.html`
//! entry never imports it, so nothing here ships.

import type { Page, Priority, ProjectDto, ProjectStats, TaskDto, TagDto } from "../api/client";

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

const WORK = "t-work";

let projects: Omit<ProjectDto, "stats">[] = [
  {
    id: "p-zhi",
    name: "智搭",
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
    name: "中保投",
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
    title: "排查知识库弹窗加载缓慢和工作台第一次进入加载缓慢的问题",
    priority: "high",
    due_at: civil(-1),
    all_day: true,
    sort_order: 0,
    tag_ids: [WORK],
    tags: ["工作"],
  }),
  makeTask({
    id: "t2",
    project_id: "p-zhi",
    title: "知行开启多租户，智搭这边应该会出现问题，需要补充多租户能力",
    priority: "medium",
    sort_order: 1,
  }),
  makeTask({
    id: "t3",
    project_id: "p-zhi",
    title: "工作流中的工具调用节点，调整为agent。并支持挂载skills。",
    description: "还有现在的添加添加tab，共享应用，共享工具。调整为工作流，工具，外加一个技能",
    priority: "medium",
    sort_order: 2,
  }),
  makeTask({
    id: "t4",
    project_id: "p-zhi",
    title: "新增对话接口，实现断线重连的效果。需要在对话列表支持显示输出状态。就是多任务切换的效果",
    priority: "low",
    sort_order: 3,
  }),
  makeTask({
    id: "t5",
    project_id: "p-zhi",
    title: "目前发版还是无法发版，原因是有重复类，需要继续修改",
    priority: "urgent",
    due_at: civil(1),
    all_day: true,
    sort_order: 4,
    tag_ids: [WORK],
    tags: ["工作"],
  }),
  makeTask({ id: "t6", project_id: "p-zhi", title: "v5文档使用智搭知识库和悬浮球", sort_order: 5 }),
  makeTask({
    id: "t7",
    project_id: "p-zhi",
    title: "sinitek-excel组件升级，注意vue3版本。ppt预览调整为新增的sinitek-office-slides",
    priority: "high",
    sort_order: 6,
  }),
  makeTask({
    id: "t7a",
    parent_id: "t7",
    project_id: "p-zhi",
    title: "确认 vue3 版本兼容性",
    sort_order: 0,
  }),
  makeTask({
    id: "t7b",
    parent_id: "t7",
    project_id: "p-zhi",
    title: "评估 ppt 预览替换成 sinitek-office-slides 的成本",
    sort_order: 1,
  }),
  // A grandchild, so the preview exercises a nested branch (caret at depth 2).
  makeTask({
    id: "t7a1",
    parent_id: "t7a",
    project_id: "p-zhi",
    title: "补齐升级后的回归用例",
    sort_order: 0,
  }),
  makeTask({
    id: "t8",
    project_id: "p-zhi",
    title: "补充灰度发布回滚脚本",
    status: "done",
    completed_at: SEEDED_AT + DAY,
    sort_order: 7,
  }),
  makeTask({ id: "t9", project_id: "p-zhong", title: "整理中保投数据接入清单", sort_order: 0 }),
  makeTask({ id: "t10", title: "把设计稿里的空状态补上" }),
];

let tags: TagDto[] = [{ id: WORK, name: "工作", color: null, count: 2 }];

const settings = new Map<string, unknown>([
  ["ui.theme", "dark"],
  ["ui.project.show_completed", true],
  ["ui.project.sort", "manual"],
]);

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
  const needle = (text ?? (f.search_text as string | undefined))?.toLowerCase();

  let items = tasks.filter((t) => {
    if (!f.include_completed && isDone(t)) return false;
    if (projectIds?.length && !(t.project_id && projectIds.includes(t.project_id))) return false;
    if (f.unfiled === true && t.project_id) return false;
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
    task_create: ({ input }) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const projectId = (raw.project_id as string | null) ?? null;
      const siblings = tasks.filter((t) => t.project_id === projectId && !t.parent_id);
      const task = makeTask({
        id: newId("dev"),
        title: String(raw.title ?? "未命名任务"),
        description: (raw.description as string | null) ?? null,
        project_id: projectId,
        parent_id: (raw.parent_id as string | null) ?? null,
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
      if (projectId !== undefined) task.project_id = projectId as string | null;
      if (parentId !== undefined) task.parent_id = parentId as string | null;
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
      settings.set(String(key), value);
      return null;
    },

    // ---- reminders / misc ----
    reminder_due_now: () => [],
    reminder_missed: () => [],
    reminder_mark_fired: () => null,
    reminder_snooze: () => Date.now() + 600_000,
    materialize_due: () => 0,
    calendar: () => [],
    report_summary: () => ({
      total: 0,
      open: 0,
      completed: 0,
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
      stdio: { bin_path: "/dev/omnitodo-mcp", always_available: true },
      http: { running: false, port: 0, token: "" },
      control: { port: 0, token: "" },
      write_enabled: false,
    }),
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
