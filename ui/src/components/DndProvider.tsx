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
import { useState, type ReactNode } from "react";
import { api, type Page, type TaskDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { moveItem } from "../lib/reorder";

/** Droppable id for a sidebar project row. */
export const projectDropId = (projectId: string) => `project:${projectId}`;
export const isProjectDropId = (id: string | number) => String(id).startsWith("project:");

/** Read the dragged/over task from any cached task list. */
export function findCachedTask(qc: ReturnType<typeof useQueryClient>, id: string): TaskDto | null {
  for (const [, page] of qc.getQueriesData<Page<TaskDto>>({ queryKey: qk.tasksAll })) {
    const hit = page?.items.find((t) => t.id === id);
    if (hit) return hit;
  }
  return qc.getQueryData<TaskDto>(qk.task(id)) ?? null;
}

/** The cached list that currently holds `id`, with the ids in display order. */
export function findCachedList(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
): { key: readonly unknown[]; ids: string[] } | null {
  for (const [key, page] of qc.getQueriesData<Page<TaskDto>>({ queryKey: qk.tasksAll })) {
    if (page?.items.some((t) => t.id === id)) {
      return { key, ids: page.items.map((t) => t.id) };
    }
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

    // Dropped on a sibling: persist the new manual order of that list.
    const list = findCachedList(qc, activeId);
    if (!list || !list.ids.includes(overId)) return;
    const from = list.ids.indexOf(activeId);
    const to = list.ids.indexOf(overId);
    const next = moveItem(list.ids, from, to);
    if (next.join() === list.ids.join()) return;

    qc.setQueriesData<Page<TaskDto>>({ queryKey: qk.tasksAll }, (page) =>
      page && page.items.some((t) => t.id === activeId)
        ? {
            ...page,
            items: next
              .map((id) => page.items.find((t) => t.id === id))
              .filter((t): t is TaskDto => Boolean(t)),
          }
        : page,
    );
    await api.taskReorder(next);
    qc.invalidateQueries({ queryKey: qk.tasksAll });
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
          <div className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow">
            {draggingTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Appended to the end of a manual list when dropping onto a project. */
export const APPEND_SORT_ORDER = 1_000_000;
