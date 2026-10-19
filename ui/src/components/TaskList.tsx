import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Alert, App as AntApp, Empty, Skeleton } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { Fragment, useCallback, useId, useRef, useState, type ReactNode } from "react";
import {
  api,
  type Page,
  type SectionDto,
  type TaskDto,
  type TaskFilter,
  type TaskPatch,
} from "../api/client";
import { qk } from "../api/queryKeys";
import { useProjectIndex } from "../hooks/useProjectIndex";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { shouldVirtualize } from "../lib/list";
import { groupBySection, NO_SECTION, type SectionGroup } from "../lib/sections";
import { TaskListScope } from "../lib/visibleRows";
import SectionHeader, { AddSectionRow } from "./SectionHeader";
import SortableTaskRow from "./SortableTaskRow";
import SubtaskRows from "./SubtaskRows";
import TaskComposer from "./TaskComposer";
import TaskRow, { type TaskRowProps } from "./TaskRow";

/** First-paint guess for a row; the windowed path measures the real height. */
const ROW_HEIGHT = 44;

/** Shared row chrome: rows are separated by hairlines, nothing else — per
 *  DESIGN §8.3 the list reads as a run of rules, not a stack of cards, so there
 *  is deliberately no panel border, background or radius around the group.
 *  The rule is inset to the checkbox column (see `index.css`) so it never runs
 *  under the floating handle/caret gutter. */
const PANEL = "task-panel";

/**
 * Everything the list needs to render a project as sections rather than as one
 * run of tasks. Owned by the view (which holds the section queries and the
 * collapse setting) and handed down as one object, so the list stays a renderer
 * and the section writes stay in one place.
 */
export interface SectionGrouping {
  projectId: string;
  projectName?: string;
  projectColor?: string | null;
  /** In display order, the way the core returns them. */
  sections: SectionDto[];
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (sectionId: string) => void;
  onRename: (section: SectionDto, name: string) => void;
  onDelete: (section: SectionDto) => void;
  /** `-1` up, `+1` down — the list's stand-in for dragging a column. */
  onMove: (section: SectionDto, delta: -1 | 1) => void;
  onAddSection: () => void;
}

export interface TaskListProps {
  filter: TaskFilter;
  /** Rows become drag-sortable (needs the app-level DndContext). */
  sortable?: boolean;
  highlight?: string;
  onOpenTask?: (id: string) => void;
  emptyHint?: string;
  /** Rendered as a final row inside the panel, e.g. an inline "add task" field. */
  footer?: ReactNode;
  /** Fetch override, e.g. full-text search instead of `task_list`. */
  query?: { key: readonly unknown[]; fn: () => Promise<Page<TaskDto>> };
  /** Skip the query entirely (e.g. an empty search box). */
  enabled?: boolean;
  /** Group the rows by section (§5.9). Off for every view that is not a project:
   *  sections are structural to a project, and Today / Upcoming / search cut
   *  across projects, where a section heading would say nothing. */
  grouping?: SectionGrouping;
  /** Name each row's project (design §13.1) — the project's colour dot plus its
   *  name under the title. On for the views that mix projects in one list
   *  (Inbox / Today / Upcoming / a tag / search); off inside a project view,
   *  where the header already answers the question for every row. */
  showProject?: boolean;
}

/**
 * The task list used by every view.
 *
 * Long lists are windowed with `@tanstack/react-virtual`; drag-sorted lists are
 * never windowed (see `lib/list.ts` for why), so `sortable` wins over size.
 * The container stays a semantic `<ul>` (dnd-kit and the virtualizer both need
 * real row elements); antd supplies the loading/empty/error states.
 *
 * Rows are measured rather than assumed: a row with a description is two lines
 * tall, so the windowed path re-measures each rendered row instead of trusting
 * the estimate.
 *
 * Expanding a row inserts its subtree as extra sibling `<li>`s, which changes
 * the row count the window is sized against — so an expanded list falls back to
 * plain rendering. Windowed lists are 60+ rows and expanding is a deliberate
 * act, so the trade is correctness now over a rare scroll cost.
 *
 * A sectioned list is never windowed either: collapsing a section removes rows
 * from the window's count the same way expanding a task adds them.
 */
export default function TaskList({
  filter,
  sortable = false,
  highlight,
  onOpenTask,
  emptyHint = "没有任务",
  footer,
  query,
  enabled = true,
  grouping,
  showProject = false,
}: TaskListProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: query?.key ?? qk.tasks(filter),
    queryFn: query?.fn ?? (() => api.taskList(filter)),
    enabled,
  });
  const { modal } = AntApp.useApp();
  const { toggle, patch, remove } = useTaskMutations();
  const projects = useProjectIndex();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** Which group's inline composer is open; `NO_SECTION` for the unfiled one. */
  const [composing, setComposing] = useState<string | null>(null);
  // The drag layer reads the rows of the list a drop lands in off the DOM, so a
  // draggable list has to be findable by id (`lib/visibleRows.ts`).
  const listDomId = `omnitodo-list-${useId()}`;

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const confirmDelete = useCallback(
    (task: TaskDto) => {
      modal.confirm({
        title: `删除任务「${task.title}」？`,
        content: "此操作不可撤销。",
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => remove.mutateAsync(task.id),
      });
    },
    [modal, remove],
  );

  const rowProps = (task: TaskDto): TaskRowProps => {
    const owner = showProject && task.project_id ? projects.get(task.project_id) : undefined;
    return {
      task,
      highlight,
      onOpen: onOpenTask,
      onToggle: (t: TaskDto) => toggle.mutate(t),
      onPatch: (id: string, p: TaskPatch) => patch.mutate({ id, patch: p }),
      onDelete: confirmDelete,
      expanded: expanded.has(task.id),
      onToggleExpand: toggleExpand,
      project: owner ? { name: owner.name, color: owner.color } : null,
    };
  };

  const branch = (task: TaskDto): ReactNode =>
    expanded.has(task.id) ? (
      <SubtaskRows
        key={`${task.id}:subtasks`}
        parentId={task.id}
        sortable={sortable}
        highlight={highlight}
        onOpenTask={onOpenTask}
        onDelete={confirmDelete}
      />
    ) : null;

  const tasks = data?.items ?? [];
  // An expanded *branch* is what breaks the window's row count, not the
  // expanded set: an id left over from a row whose last subtask was deleted has
  // no branch to render, so it must not keep the list un-windowed.
  const virtual =
    !grouping &&
    shouldVirtualize(tasks.length, sortable) &&
    !tasks.some((t) => expanded.has(t.id) && t.has_subtasks);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? tasks.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="px-1 py-2">
        <Skeleton active title={false} paragraph={{ rows: 4, width: ["72%", "58%", "66%", "40%"] }} />
      </div>
    );
  }
  if (error) {
    return <Alert type="error" showIcon message="加载失败" description={String(error)} />;
  }

  if (grouping) {
    return (
      <TaskListScope.Provider value={listDomId}>
        <ul id={listDomId} className={PANEL}>
          {tasks.length === 0 && (
            <li className="px-3 py-4 text-center text-meta" style={{ color: "var(--text-tertiary)" }}>
              {emptyHint}
            </li>
          )}
          {groupBySection(tasks, grouping.sections, { keepEmpty: true }).map((group) => (
            <SectionBlock
              key={group.section?.id ?? NO_SECTION}
              group={group}
              grouping={grouping}
              sortable={sortable}
              rowProps={rowProps}
              branch={branch}
              composing={composing}
              setComposing={setComposing}
            />
          ))}
          <AddSectionRow onAdd={grouping.onAddSection} />
          {footer}
        </ul>
      </TaskListScope.Provider>
    );
  }

  if (tasks.length === 0) {
    // With a footer (the inline composer) the panel stays, so the empty hint
    // sits inside it above the "add task" row instead of replacing the panel.
    if (footer) {
      return (
        <ul className={PANEL}>
          <li
            className="px-3 py-4 text-center text-meta"
            style={{ color: "var(--text-tertiary)" }}
          >
            {emptyHint}
          </li>
          {footer}
        </ul>
      );
    }
    return (
      <Empty
        image={<InboxOutlined style={{ fontSize: 40, opacity: 0.4 }} />}
        description={emptyHint}
        style={{ padding: "40px 0" }}
      />
    );
  }

  if (sortable) {
    return (
      <TaskListScope.Provider value={listDomId}>
        <ul id={listDomId} className={PANEL}>
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task, i) => (
              <Fragment key={task.id}>
                <SortableTaskRow {...rowProps(task)} animateIn index={i} />
                {branch(task)}
              </Fragment>
            ))}
          </SortableContext>
          {footer}
        </ul>
      </TaskListScope.Provider>
    );
  }

  if (virtual) {
    return (
      <div ref={scrollRef} className="max-h-[calc(100vh-12rem)] overflow-auto">
        {/* Windowed rows are absolutely positioned, so the row carries its own
            inset hairline (`.task-panel`) to keep the same rhythm. */}
        <ul
          className="task-panel"
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((row) => (
            <TaskRow
              key={tasks[row.index].id}
              {...rowProps(tasks[row.index])}
              dataIndex={row.index}
              innerRef={(el) => {
                // Rows are 1-2 lines tall, so the window measures instead of
                // trusting the estimate. React also calls this with null on
                // unmount, which the measurer must not receive.
                if (el) virtualizer.measureElement(el);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className={PANEL}>
      {tasks.map((task) => (
        <Fragment key={task.id}>
          <TaskRow {...rowProps(task)} />
          {branch(task)}
        </Fragment>
      ))}
      {footer}
    </ul>
  );
}

/**
 * One section: its header, then its rows, then the composer that files a task
 * into it.
 *
 * The "no section" group's header is drawn only once the project actually has a
 * section, and only while it holds something. Todoist hides it on the same two
 * conditions (its guard is the task count; the section count is what makes a
 * heading over the whole list meaningful here).
 */
function SectionBlock({
  group,
  grouping,
  sortable,
  rowProps,
  branch,
  composing,
  setComposing,
}: {
  group: SectionGroup;
  grouping: SectionGrouping;
  sortable: boolean;
  rowProps: (task: TaskDto) => TaskRowProps;
  branch: (task: TaskDto) => ReactNode;
  composing: string | null;
  setComposing: (key: string | null) => void;
}) {
  const key = group.section?.id ?? NO_SECTION;
  const collapsed = grouping.collapsed.has(key);
  const showHeader =
    group.section !== null || (grouping.sections.length > 0 && group.tasks.length > 0);

  return (
    <>
      {showHeader && (
        <SectionHeader
          section={group.section}
          count={group.tasks.length}
          collapsed={collapsed}
          onToggleCollapse={() => grouping.onToggleCollapse(key)}
          onRename={(name) => group.section && grouping.onRename(group.section, name)}
          onDelete={() => group.section && grouping.onDelete(group.section)}
          onMove={(delta) => group.section && grouping.onMove(group.section, delta)}
          onAddTask={() => setComposing(composing === key ? null : key)}
        />
      )}
      {!collapsed &&
        group.tasks.map((task, i) => (
          <Fragment key={task.id}>
            {sortable ? (
              <SortableTaskRow {...rowProps(task)} animateIn index={i} />
            ) : (
              <TaskRow {...rowProps(task)} />
            )}
            {branch(task)}
          </Fragment>
        ))}
      {!collapsed && composing === key && (
        <TaskComposer
          projectId={grouping.projectId}
          projectName={grouping.projectName}
          projectColor={grouping.projectColor}
          sectionId={group.section?.id}
          onClose={() => setComposing(null)}
        />
      )}
    </>
  );
}
