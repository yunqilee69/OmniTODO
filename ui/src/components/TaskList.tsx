import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Alert, Empty, Skeleton } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { Fragment, useCallback, useRef, useState } from "react";
import { api, type Page, type TaskDto, type TaskFilter, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { shouldVirtualize } from "../lib/list";
import SortableTaskRow from "./SortableTaskRow";
import SubtaskRows from "./SubtaskRows";
import TaskRow from "./TaskRow";

const ROW_HEIGHT = 36;

export interface TaskListProps {
  filter: TaskFilter;
  /** Rows become drag-sortable (needs the app-level DndContext). */
  sortable?: boolean;
  highlight?: string;
  onOpenTask?: (id: string) => void;
  emptyHint?: string;
  /** Fetch override, e.g. full-text search instead of `task_list`. */
  query?: { key: readonly unknown[]; fn: () => Promise<Page<TaskDto>> };
  /** Skip the query entirely (e.g. an empty search box). */
  enabled?: boolean;
}

/**
 * The task list used by every view.
 *
 * Long lists are windowed with `@tanstack/react-virtual`; drag-sorted lists are
 * never windowed (see `lib/list.ts` for why), so `sortable` wins over size.
 * The container stays a semantic `<ul>` (dnd-kit and the virtualizer both need
 * real row elements); antd supplies the loading/empty/error states.
 *
 * Expanding a row inserts its subtree as extra sibling `<li>`s, which changes
 * the row count the window is sized against — so an expanded list falls back to
 * plain rendering. Windowed lists are 60+ rows and expanding is a deliberate
 * act, so the trade is correctness now over a rare scroll cost.
 */
export default function TaskList({
  filter,
  sortable = false,
  highlight,
  onOpenTask,
  emptyHint = "没有任务",
  query,
  enabled = true,
}: TaskListProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: query?.key ?? qk.tasks(filter),
    queryFn: query?.fn ?? (() => api.taskList(filter)),
    enabled,
  });
  const { toggle, patch } = useTaskMutations();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const tasks = data?.items ?? [];
  const virtual = shouldVirtualize(tasks.length, sortable) && expanded.size === 0;
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

  if (tasks.length === 0) {
    return (
      <Empty
        image={<InboxOutlined style={{ fontSize: 40, opacity: 0.4 }} />}
        description={emptyHint}
        style={{ padding: "40px 0" }}
      />
    );
  }

  const rowProps = (task: TaskDto) => ({
    task,
    highlight,
    onOpen: onOpenTask,
    onToggle: (t: TaskDto) => toggle.mutate(t),
    onPatch: (id: string, p: TaskPatch) => patch.mutate({ id, patch: p }),
    expanded: expanded.has(task.id),
    onToggleExpand: toggleExpand,
  });

  const branch = (task: TaskDto) =>
    expanded.has(task.id) ? (
      <SubtaskRows
        key={`${task.id}:subtasks`}
        parentId={task.id}
        highlight={highlight}
        onOpenTask={onOpenTask}
      />
    ) : null;

  if (sortable) {
    return (
      <ul className="divide-y divide-[var(--border-hairline)] overflow-hidden rounded-md border border-[var(--border-hairline)]">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task, i) => (
            <Fragment key={task.id}>
              <SortableTaskRow {...rowProps(task)} animateIn index={i} />
              {branch(task)}
            </Fragment>
          ))}
        </SortableContext>
      </ul>
    );
  }

  if (virtual) {
    return (
      <div
        ref={scrollRef}
        className="max-h-[calc(100vh-12rem)] overflow-auto rounded-md border border-[var(--border-hairline)]"
      >
        <ul style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((row) => (
            <TaskRow
              key={tasks[row.index].id}
              {...rowProps(tasks[row.index])}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translateY(${row.start}px)`,
              }}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--border-hairline)]">
      {tasks.map((task) => (
        <Fragment key={task.id}>
          <TaskRow {...rowProps(task)} />
          {branch(task)}
        </Fragment>
      ))}
    </ul>
  );
}
