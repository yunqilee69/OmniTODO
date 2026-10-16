//! App-wide drag-and-drop context (design §13.2: same-list sorting *and*
//! cross-project dragging need one shared `DndContext`, because the task list
//! and the project sidebar are siblings in the tree).
//!
//! The handlers stay thin: they read the current list out of the Query cache and
//! the visible rows off the DOM, apply the pure helpers from `lib/nestDrop`, and
//! delegate the write to the core (`task_reorder` / `task_update`).

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "antd";
import { useState, type ReactNode } from "react";
import { api, type Page, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { rowRuleInset } from "../lib/layout";
import {
  indentDeltaFromDrag,
  planPlacement,
  resolveDropBand,
  type Placement,
} from "../lib/nestDrop";
import { reorderSubsequence } from "../lib/reorder";
import { sectionForSlot } from "../lib/sections";
import { readVisibleRows } from "../lib/visibleRows";

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

/** Where the drop line is drawn, in viewport coordinates. */
interface DropLine {
  top: number;
  left: number;
  width: number;
}

/**
 * Pointer's vertical position inside the hovered row, from the translated rect
 * dnd-kit reports. `activatorEvent` is where the drag *started*, so the live
 * position is that plus `delta`.
 */
function pointerInRow(event: DragMoveEvent | DragEndEvent): number | null {
  const over = event.over?.rect;
  const start = event.activatorEvent;
  if (!over || !(start instanceof MouseEvent)) return null;
  return start.clientY + event.delta.y - over.top;
}

/** Resolved drop: the write to make, and the line that previews it. */
interface DropResolution {
  placement: Placement;
  line: DropLine;
  /** The section the task lands in, or `null` for "no section". Only meaningful
   *  at the top level: a nested row belongs to its parent's column. */
  sectionId: string | null;
}

export function TaskDndProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [draggingTask, setDraggingTask] = useState<TaskDto | null>(null);
  const [dropLine, setDropLine] = useState<DropLine | null>(null);

  const sensors = useSensors(
    // A small distance threshold keeps plain clicks (open / complete) working.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const invalidate = (reparented: boolean) => {
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.subtasksAll });
    // The section headers' counts follow whatever moved in or out of a column.
    qc.invalidateQueries({ queryKey: qk.sectionsAll });
    if (reparented) {
      qc.invalidateQueries({ queryKey: qk.taskAll });
      qc.invalidateQueries({ queryKey: qk.projects });
    }
  };

  const clearDrag = () => {
    setDraggingTask(null);
    setDropLine(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    setDraggingTask(findCachedTask(qc, String(event.active.id)));
  };

  /**
   * Resolve the drop from the live pointer: which gap, how many levels, and the
   * line that previews it.
   *
   * The two readings of the pointer are independent — vertical picks the gap,
   * horizontal picks the depth — which is what lets one drag land a task at any
   * level instead of one level per drag. See `lib/nestDrop.ts` for the maths.
   */
  const resolve = (event: DragMoveEvent | DragEndEvent): DropResolution | null => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const rect = event.over?.rect;
    if (!overId || isProjectDropId(overId) || overId === activeId || !rect) return null;
    const pointerY = pointerInRow(event);
    if (pointerY === null) return null;

    // A drop lands in the list the pointer is over, so that is the list whose
    // levels clamp it — read back off the DOM, since only the rendered list
    // knows which branches are expanded (`lib/visibleRows.ts`).
    const listId = event.over?.data.current?.listId;
    const rows = readVisibleRows(typeof listId === "string" ? document.getElementById(listId) : null);
    const band = resolveDropBand(pointerY, rect.height);
    const placement = planPlacement({
      rows,
      activeId,
      overId,
      band,
      indentDelta: indentDeltaFromDrag(event.delta.x),
    });
    if (!placement) return null;

    // The line is drawn where the row will land: in the gap the band picked, and
    // inset to the depth the drag has travelled to — so the level is visible
    // before the drop, not only after it.
    const left = rect.left + rowRuleInset(placement.depth);
    return {
      placement,
      // A section only holds top-level rows (§5.9), so a nested landing has no
      // column of its own — the core clears the field on the same write.
      sectionId: placement.depth === 0 ? sectionForSlot(rows, overId) : null,
      line: {
        top: rect.top + (band === "before" ? 0 : rect.height),
        left,
        width: Math.max(0, rect.right - left),
      },
    };
  };

  /** Track the landing slot while the pointer moves, and draw its line. */
  const trackDrop = (event: DragMoveEvent | DragOverEvent) => {
    setDropLine(resolve(event)?.line ?? null);
  };

  const onDragOver = (event: DragOverEvent) => trackDrop(event);

  const onDragEnd = async (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    // Recompute at release: the last move may have landed between events.
    const resolved = resolve(event);
    const plan = resolved?.placement ?? null;
    clearDrag();
    if (!overId) return;

    // Dropped on a project in the sidebar: move it there, appending to the end.
    if (isProjectDropId(overId)) {
      await api.taskMove(activeId, overId.slice("project:".length), undefined, APPEND_SORT_ORDER);
      invalidate(true);
      return;
    }
    if (!plan) return;

    const active = findCachedTask(qc, activeId);
    // A row dragged in from a list the cache doesn't hold is reparented too, so
    // the refetch places it rather than leaving it where it was.
    const reparented = !active || (active.parent_id ?? null) !== plan.parent;

    // Show the new order straight away; the refetch below confirms it. Only a
    // group already whole in a cache can be rewritten in place — a row arriving
    // from another group has no slot here yet, so the refetch places it.
    const rewrite = (data: CachedTasks | undefined) => {
      if (!data) return data;
      const items = cachedItems(data);
      const present = new Set(items.map((t) => t.id));
      if (!plan.order.every((id) => present.has(id))) return data;
      const nextItems = reorderSubsequence(items, plan.order);
      return Array.isArray(data) ? nextItems : { ...data, items: nextItems };
    };
    qc.setQueriesData<CachedTasks>({ queryKey: qk.tasksAll }, rewrite);
    qc.setQueriesData<CachedTasks>({ queryKey: qk.subtasksAll }, rewrite);

    // The section is part of the same placement: the drop line sits in a column
    // as much as in a gap, so what it previews is what gets written.
    const patch: TaskPatch = {};
    if (reparented) {
      patch.parent_id = plan.parent ?? undefined;
      if (!plan.parent) patch.clear_parent_id = true;
    }
    // An unknown row — dragged in from a list this cache does not hold — is only
    // ever *given* a section, never stripped of one, because the cache cannot say
    // it had one. A row already known to be unfiled needs no write either.
    const filed = active ? (active.section_id ?? null) : undefined;
    if (plan.depth === 0 && filed !== resolved?.sectionId) {
      if (resolved?.sectionId) patch.section_id = resolved.sectionId;
      else if (filed === null) patch.clear_section_id = true;
    }

    try {
      // The parent and the section go first, so `task_reorder` ranks the row
      // among its new siblings. `task_move` cannot change the parent — it only
      // relocates between projects — so reparenting goes through the patch, and
      // the core then pulls the subtree into the parent's project.
      if (Object.keys(patch).length > 0) await api.taskUpdate(activeId, patch);
      await api.taskReorder(plan.order);
    } catch {
      // The core refused the move — into the task's own subtree, or past the
      // depth cap. The refetch below puts the row back where it came from.
    }
    invalidate(reparented);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={trackDrop}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={clearDrag}
    >
      {children}
      {dropLine ? (
        <div
          className="drop-line"
          style={{ top: dropLine.top, left: dropLine.left, width: dropLine.width }}
        />
      ) : null}
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
