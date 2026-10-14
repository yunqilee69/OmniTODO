//! App-wide drag-and-drop context (design §13.2: same-list sorting *and*
//! cross-project dragging need one shared `DndContext`, because the task list
//! and the project sidebar are siblings in the tree).
//!
//! The handlers stay thin: they read the current list out of the Query cache,
//! apply the pure helpers from `lib/reorder`, and delegate the write to the
//! core (`task_reorder` / `task_move`).

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "antd";
import { useState, type ReactNode } from "react";
import { api, type Page, type TaskDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { moveItem, reorderSubsequence } from "../lib/reorder";

/** Droppable id for a sidebar project row. */
export const projectDropId = (projectId: string) => `project:${projectId}`;
export const isProjectDropId = (id: string | number) => String(id).startsWith("project:");

/** A cached task list is a page; a cached branch is the bare array the
 *  `task_list_subtasks` command returns. Both are read here. */
type CachedTasks = Page<TaskDto> | TaskDto[];

const cachedItems = (data: CachedTasks | undefined): TaskDto[] =>
  Array.isArray(data) ? data : (data?.items ?? []);

/** Read the dragged/over task from any cached task list, including an expanded
 *  branch — a subtask is only ever in a subtask cache. */
export function findCachedTask(qc: ReturnType<typeof useQueryClient>, id: string): TaskDto | null {
  for (const key of [qk.tasksAll, qk.subtasksAll]) {
    for (const [, data] of qc.getQueriesData<CachedTasks>({ queryKey: key })) {
      const hit = cachedItems(data).find((t) => t.id === id);
      if (hit) return hit;
    }
  }
  return qc.getQueryData<TaskDto>(qk.task(id)) ?? null;
}

/** Which cache a sibling group came out of, i.e. which query to write back. */
export type ListScope = "tasks" | "subtasks";

/**
 * The group of siblings that holds `id`, with the ids in display order.
 *
 * For a top-level task that is the whole list. For a subtask it is only the rows
 * sharing its parent: a branch cache is one flat depth-first subtree, so the
 * group has to be filtered out of it — reordering the whole cache would drag a
 * child's descendants along with the child.
 */
export function findCachedSiblings(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
): { scope: ListScope; ids: string[] } | null {
  for (const [, data] of qc.getQueriesData<CachedTasks>({ queryKey: qk.tasksAll })) {
    const items = cachedItems(data);
    if (items.some((t) => t.id === id)) {
      return { scope: "tasks", ids: items.map((t) => t.id) };
    }
  }
  for (const [, data] of qc.getQueriesData<CachedTasks>({ queryKey: qk.subtasksAll })) {
    const items = cachedItems(data);
    const hit = items.find((t) => t.id === id);
    if (!hit) continue;
    const parent = hit.parent_id ?? null;
    return {
      scope: "subtasks",
      ids: items.filter((t) => (t.parent_id ?? null) === parent).map((t) => t.id),
    };
  }
  return null;
}


export function TaskDndProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [draggingTask, setDraggingTask] = useState<TaskDto | null>(null);

  const sensors = useSensors(
    // A small distance threshold keeps plain clicks (open / complete) working.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) => {
    setDraggingTask(findCachedTask(qc, String(event.active.id)));
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDraggingTask(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === activeId) return;

    // Dropped on a project in the sidebar: move it there, appending to the end.
    if (isProjectDropId(overId)) {
      const projectId = overId.slice("project:".length);
      await api.taskMove(activeId, projectId, undefined, APPEND_SORT_ORDER);
      qc.invalidateQueries({ queryKey: qk.tasksAll });
      qc.invalidateQueries({ queryKey: qk.taskAll });
      qc.invalidateQueries({ queryKey: qk.projects });
      return;
    }

    // Dropped on a sibling: persist the new manual order of that group.
    const group = findCachedSiblings(qc, activeId);
    if (!group || !group.ids.includes(overId)) return;
    const from = group.ids.indexOf(activeId);
    const to = group.ids.indexOf(overId);
    const next = moveItem(group.ids, from, to);
    if (next.join() === group.ids.join()) return;

    // Show the new order straight away; the refetch below confirms it. A
    // subtask group is a subsequence of its branch cache, so only the group's
    // own slots move.
    const scope = group.scope === "tasks" ? qk.tasksAll : qk.subtasksAll;
    qc.setQueriesData<CachedTasks>({ queryKey: scope }, (data) => {
      const items = cachedItems(data);
      if (!items.some((t) => t.id === activeId)) return data;
      const nextItems = reorderSubsequence(items, next);
      return Array.isArray(data) ? nextItems : data ? { ...data, items: nextItems } : data;
    });
    await api.taskReorder(next);
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.subtasksAll });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggingTask(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {draggingTask ? (
          <Card size="small" className="cursor-grabbing shadow-lg">
            {draggingTask.title}
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Appended to the end of a manual list when dropping onto a project. */
export const APPEND_SORT_ORDER = 1_000_000;
