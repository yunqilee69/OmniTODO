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
//! That is the whole distinction the drop line has to draw: a line at the row's
//! indent is a sibling, a line one step shorter (further inset) is a child.

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
 * The new sibling order after dropping `activeId` relative to `overId`.
 *
 * `null` means the drop changes nothing (missing ids, or a no-op landing).
 * A `"child"` intent is not an order change of this group — the caller
 * reparents instead — so it comes back `null` here too.
 */
export function nestMove(
  ids: readonly string[],
  activeId: string,
  overId: string,
  intent: DropIntent,
): string[] | null {
  if (intent === "child" || activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const over = ids.indexOf(overId);
  if (from < 0 || over < 0) return null;
  const next = ids.filter((id) => id !== activeId);
  // After the removal, "after overId" is one past wherever `overId` ended up.
  let to = next.indexOf(overId);
  if (intent === "after") to += 1;
  next.splice(to, 0, activeId);
  return next.join() === ids.join() ? null : next;
}
