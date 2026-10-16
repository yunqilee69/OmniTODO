//! Where a dragged task lands (Todoist-style nesting).
//!
//! A drop is not "onto this row". The pointer splits the hovered row into bands,
//! and the horizontal offset picks the depth of the slot:
//!
//! - the top band inserts *before* the row, as its sibling;
//! - the bottom band, held near the row's own indent, inserts *after* it;
//! - the bottom band, pushed one indent step further right, files the dragged
//!   task as the row's first child.
//!
//! "Sibling" is relative to the row under the pointer, not to the dragged task's
//! current parent: the dragged task ends up sharing the hovered row's parent. So
//! landing beside a shallower row lifts it a level, and dropping a subtask on a
//! top-level row — or on its own parent row — brings it back out as a top-level
//! task. The same rule reorders within a group, where the parent is unchanged.
//!
//! That is the whole distinction the drop line has to draw: a line at the row's
//! indent is a sibling, a line one step further inset is a child.

import { ROW_INDENT_STEP } from "./layout";

/** Top fraction of a hovered row that means "insert before". */
export const BEFORE_BAND = 0.28;

export type DropIntent = "before" | "after" | "child";
export interface DropTarget {
  /** The row the pointer is over. */
  overId: string;
  intent: DropIntent;
}

/**
 * Resolve a pointer position against one hovered row.
 *
 * `offsetY` is the pointer's position inside the hovered row (0 = its top
 * edge), and `dragDx` is how far the pointer has travelled *rightwards* since
 * the drag began.
 *
 * The child slot is measured from the drag's own movement rather than from
 * where the pointer sits inside the row: a row is ~500px wide and its handle,
 * checkbox and title all sit well past any fixed offset, so an absolute
 * threshold would read as "child" for nearly every drop and plain reordering
 * would never happen. Pushing the task one indent step to the right is the
 * gesture, and it means the same thing on every row whatever the row's width,
 * its depth, or which column the drag started from.
 *
 * Anything short of a full indent step stays a sibling — a small wobble must
 * not reparent a task. The child slot is the bottom band only, because the top
 * band is unambiguously "before", and a child always lands first under its new
 * parent rather than between that parent's existing children.
 */
export function resolveDropIntent(offsetY: number, height: number, dragDx: number): DropIntent {
  if (height <= 0 || offsetY < height * BEFORE_BAND) return "before";
  if (dragDx >= ROW_INDENT_STEP) return "child";
  return "after";
}

/**
 * The new order of `ids` after dropping `activeId` relative to `overId`.
 *
 * `activeId` need not be in `ids`: a task dropped beside a row of another group
 * joins that group, taking its parent. That is how a subtask comes back out —
 * dropped on a shallower row it lands beside it instead of staying filed under
 * its old parent — so the newcomer is spliced in rather than moved within.
 *
 * `null` means the drop changes nothing (unknown `overId`, a no-op landing, or
 * an unchanged order). A `"child"` intent is not an order change of this group
 * — the caller reparents instead — so it comes back `null` here too.
 */
export function nestMove(
  ids: readonly string[],
  activeId: string,
  overId: string,
  intent: DropIntent,
): string[] | null {
  if (intent === "child" || activeId === overId) return null;
  if (!ids.includes(overId)) return null;
  const rest = ids.includes(activeId) ? ids.filter((id) => id !== activeId) : [...ids];
  // After the removal, "after overId" is one past wherever `overId` ended up.
  let to = rest.indexOf(overId);
  if (intent === "after") to += 1;
  rest.splice(to, 0, activeId);
  return rest.join() === ids.join() ? null : rest;
}

/** What a sibling drop writes: the group's new order, and the parent that order
 *  implies. */
export interface DropPlan {
  /** The hovered row's group, with the dragged task spliced in. */
  order: string[];
  /** The new parent: an id to file under it, `null` for the top level, or
   *  `undefined` when the drop does not change the task's parent. */
  parent: string | null | undefined;
}

/**
 * Plan a sibling drop.
 *
 * The dragged task lands beside the row under the pointer and takes that row's
 * parent — so a subtask dropped beside a top-level row (or beside its own parent
 * row) plans `parent: null`, which is the write that lifts it back out to the
 * top level. Within one group the parent is unchanged and `parent` is
 * `undefined`, leaving the drop a plain reorder.
 *
 * `null` means there is nothing to do: the drop would make the task its own
 * child, or it changes nothing. Cycles deeper than that — into the task's own
 * subtree, or past the depth cap — are the core's to refuse, because only it
 * knows the full tree.
 */
export function planDrop(args: {
  activeId: string;
  activeParent: string | null;
  overId: string;
  overParent: string | null;
  /** The hovered row's sibling group, in display order. */
  groupIds: readonly string[];
  intent: DropIntent;
}): DropPlan | null {
  const { activeId, activeParent, overId, overParent, groupIds, intent } = args;
  if (overParent === activeId) return null;
  const order = nestMove(groupIds, activeId, overId, intent);
  if (!order) return null;
  return { order, parent: overParent === activeParent ? undefined : overParent };
}
