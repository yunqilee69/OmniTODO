import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { api, type Page, type TaskDto, type TaskFilter, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { shouldVirtualize } from "../lib/list";
import SortableTaskRow from "./SortableTaskRow";
import TaskRow from "./TaskRow";

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

  const tasks = data?.items ?? [];
  const virtual = shouldVirtualize(tasks.length, sortable);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? tasks.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  if (!enabled) return null;
  if (isLoading) return <p className="text-sm text-neutral-500">加载中…</p>;
  if (error) return <p className="text-sm text-red-600">加载失败：{String(error)}</p>;
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-400">
        {emptyHint}
      </p>
    );
  }

  const rowProps = (task: TaskDto) => ({
    task,
    highlight,
    onOpen: onOpenTask,
    onToggle: (t: TaskDto) => toggle.mutate(t),
    onPatch: (id: string, p: TaskPatch) => patch.mutate({ id, patch: p }),
  });

  if (sortable) {
    return (
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskRow key={task.id} {...rowProps(task)} />
          ))}
        </SortableContext>
      </ul>
    );
  }

  if (virtual) {
    return (
      <div
        ref={scrollRef}
        className="max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border border-neutral-200 bg-white"
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
                transform: `translateY(${row.start}px)`,
              }}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
      {tasks.map((task) => (
        <TaskRow key={task.id} {...rowProps(task)} />
      ))}
    </ul>
  );
}
