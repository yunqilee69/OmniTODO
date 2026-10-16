//! Reading the rows the user can actually see, for the drag layer.
//!
//! The drop maths in `lib/nestDrop` works on the *visible* list — top-level rows
//! plus whichever branches happen to be expanded — because that is the list the
//! user is pointing at, and because the row above and below the slot are what
//! clamp the depth. Which branches are expanded is local state inside the list
//! components, and the caches hold whole branches whether or not they are on
//! screen, so the rendered `<ul>` is the only place that order exists.
//!
//! So each sortable row publishes itself as DOM attributes and the provider
//! reads them back at drop time. Todoist's web app resolves its drop target the
//! same way (off the DOM, by hit-testing `data-*` attributes); the alternative —
//! plumbing every list's expanded set up into the provider — would put the same
//! fact in two places and let them drift.
//!
//! The attributes are also how the provider finds the list a drop will land in:
//! every `<ul>` a sortable row is rendered into carries an id from
//! {@link TaskListScope}, and the row reports that id to dnd-kit with the rest of
//! its drag data.

import { createContext, useContext } from "react";
import type { VisibleRow } from "./nestDrop";

/** The task's id — dnd-kit's sortable id, restated for the DOM. */
export const TASK_ID_ATTR = "data-task-id";
/** The row's depth; 0 = top level. */
export const TASK_DEPTH_ATTR = "data-task-depth";
/** The row's parent id, omitted at the top level. */
export const TASK_PARENT_ATTR = "data-task-parent";
/** The section a top-level row is filed under, omitted for "no section" and for
 *  a subtask (which reads its branch's section instead, §5.9). */
export const TASK_SECTION_ATTR = "data-task-section";

/**
 * The `<ul>` a row is rendered into.
 *
 * Provided by the list that owns the `<ul>` and read by the rows inside it, so
 * the drag layer can walk the visible rows of the list a drop lands in. One id
 * per rendered list: expanded branches render into their parent list's `<ul>`,
 * so they are covered by the same id.
 */
export const TaskListScope = createContext<string | null>(null);

/** The id of the `<ul>` this row is rendered into, or `null` outside a list. */
export const useTaskListScope = () => useContext(TaskListScope);

/** The attributes a sortable row publishes for the drag layer. */
export function rowDomAttrs(
  id: string,
  depth: number,
  parentId: string | null,
  sectionId: string | null = null,
): Record<string, string> {
  return {
    [TASK_ID_ATTR]: id,
    [TASK_DEPTH_ATTR]: String(depth),
    ...(parentId ? { [TASK_PARENT_ATTR]: parentId } : {}),
    ...(sectionId ? { [TASK_SECTION_ATTR]: sectionId } : {}),
  };
}

/** The visible rows of `listEl`, in display order. */
export function readVisibleRows(listEl: HTMLElement | null | undefined): VisibleRow[] {
  if (!listEl) return [];
  const rows: VisibleRow[] = [];
  for (const el of listEl.querySelectorAll<HTMLElement>(`[${TASK_ID_ATTR}]`)) {
    const id = el.getAttribute(TASK_ID_ATTR);
    if (!id) continue;
    rows.push({
      id,
      depth: Number(el.getAttribute(TASK_DEPTH_ATTR) ?? 0) || 0,
      parentId: el.getAttribute(TASK_PARENT_ATTR) || null,
      sectionId: el.getAttribute(TASK_SECTION_ATTR) || null,
    });
  }
  return rows;
}
