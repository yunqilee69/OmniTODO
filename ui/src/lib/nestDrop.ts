//! Where a dragged task lands (Todoist-style nesting).
//!
//! One drag reads the pointer twice, independently, which is what makes a single
//! gesture enough to move a task anywhere in the tree:
//!
//! - **Vertically** the pointer picks the *slot* — the position inside the
//!   hovered row decides whether the task goes into the gap above it or the gap
//!   below it ({@link resolveDropBand}).
//! - **Horizontally** the pointer picks the *depth* — every
//!   {@link ROW_INDENT_STEP} the drag travels right adds a level, every step left
//!   removes one ({@link indentDeltaFromDrag}). The depth is therefore
//!   continuous: a task can be dropped at any level in one gesture, rather than
//!   one level per drag.
//!
//! The depth is then clamped to what the slot can hold. A row may only be one
//! level deeper than the row above it (`maxDepth`), and never shallower than the
//! row below it (`minDepth`) — otherwise the list stops being a tree, or a row
//! silently hoists out from under the row that follows it. In a well-formed tree
//! `minDepth <= maxDepth` always holds, because adjacent visible rows differ by
//! at most one level: a deeper row must be the previous row's child.
//!
//! Last the parent is *derived* from the depth and the row above the slot. Same
//! level means the same parent, one level deeper means that row becomes the
//! parent, and anything else walks back to the last row sitting at that level.
//! The parent is never chosen directly, which is why "drag in" and "drag out"
//! come out as the same rule read in two directions.
//!
//! Ported from the algorithm Todoist's web app runs on drop (its
//! `getTaskPlacement`): the same bands, the same one-level-per-indent-step
//! displacement, and the same `min(previous + 1, cap)` clamp.

import { MAX_TASK_DEPTH, ROW_INDENT_STEP } from "./layout";

/**
 * Fraction of a hovered row's height, measured from its top, that still means
 * "insert before". Below it the task goes into the gap under the row.
 *
 * The band only picks the gap: the depth comes from the horizontal travel, so
 * the split is free to sit at the row's midpoint.
 */
export const BEFORE_BAND = 0.5;

export type DropBand = "before" | "after";

/** A row the user can see, in display order. */
export interface VisibleRow {
  id: string;
  parentId: string | null;
  /** 0 = top level. */
  depth: number;
  /** The section a top-level row is filed under, or `null`/absent. Only ever set
   *  at depth 0 (§5.9); a subtask reads its branch's section instead. */
  sectionId?: string | null;
}

export interface Placement {
  /** The depth the task lands at; 0 = top level. */
  depth: number;
  /** The parent it lands under, or `null` for the top level. */
  parent: string | null;
  /** The destination sibling group, in its new order. */
  order: string[];
}

/** Which gap of the hovered row the pointer is in. */
export function resolveDropBand(offsetY: number, height: number): DropBand {
  // A row with no measurable height (mid-layout, or hidden) has no bands to
  // split, and "before" is the harmless reading.
  if (height <= 0) return "before";
  return offsetY < height * BEFORE_BAND ? "before" : "after";
}

/**
 * How many levels the drag has travelled sideways: one per indent step,
 * rounded, so a half-step wobble is not a level.
 */
export function indentDeltaFromDrag(dx: number): number {
  return Math.round(dx / ROW_INDENT_STEP);
}

/**
 * The depth to keep when the drag has not moved sideways at all.
 *
 * Holding `activeDepth` on its own is not enough. The row may have landed in a
 * slot where its old level is illegal, and the clamp would then flatten it to
 * the slot's own level — a straight-down drag that visibly jumps a level, which
 * reads as a bug. The rule adopted here (Todoist's) is that a drag with no
 * horizontal travel follows the row *above the slot* instead of holding its own
 * level, except when that row is the dragged row's parent: there, staying put is
 * exactly what the user meant.
 *
 * `null` means "no opinion" — fall back to `activeDepth + indentDelta`.
 */
function depthWithNoSideways(args: {
  activeDepth: number;
  activeParent: string | null;
  prev: VisibleRow | null;
  next: VisibleRow | null;
}): number | null {
  const { activeDepth, activeParent, prev, next } = args;
  if (!prev) return null;
  // Already filed under the row above: the drag was a reorder within the group.
  if (prev.id === activeParent) return activeDepth;
  // The slot sits between two rows of one level: take that level.
  if (next && next.depth === prev.depth) return prev.depth;
  // The row below is deeper, so it is the row above's child and the slot is
  // inside that branch — the newcomer joins it.
  if (next && next.depth > prev.depth) return next.depth;
  // Sinking to the level of the row above is either a deliberate outdent or the
  // same group read one level up; either way the row above's level is right.
  if (activeDepth > prev.depth) return prev.depth;
  if (activeDepth < prev.depth && prev.parentId === activeParent) return prev.depth;
  return null;
}

/**
 * The parent a row at `depth` in `rest`'s `slot` belongs under.
 *
 * `rest` is the visible list with the dragged row already taken out, so every
 * index here is a position in the list the task is joining.
 */
function parentFor(args: {
  rest: readonly VisibleRow[];
  slot: number;
  depth: number;
  prev: VisibleRow | null;
}): string | null {
  const { rest, slot, depth, prev } = args;
  if (depth === 0) return null;
  // Level with the row above: same parent as that row.
  if (prev && depth === prev.depth) return prev.parentId;
  // One level deeper (or more, before clamping): that row is the parent.
  if (prev && depth > prev.depth) return prev.id;
  // Shallower than the row above: walk back to the nearest row at this level and
  // take its parent. The row itself is a sibling of the newcomer, so the parent
  // is one step further up.
  for (let i = slot - 1; i >= 0; i--) {
    if (rest[i].depth === depth) return rest[i].parentId;
  }
  return null;
}

/** True when `candidate` sits anywhere under `ancestor` in the visible rows. */
function isUnder(rows: readonly VisibleRow[], candidate: string, ancestor: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  let cursor = byId.get(candidate);
  while (cursor && cursor.parentId) {
    if (cursor.parentId === ancestor) return true;
    if (seen.has(cursor.parentId)) return false;
    seen.add(cursor.parentId);
    cursor = byId.get(cursor.parentId);
  }
  return false;
}

/**
 * Plan a drop: where the row lands in the visible list, and which write it takes.
 *
 * `rows` is the destination list as rendered — the top-level rows plus whatever
 * branches are expanded — in display order. `null` means there is nothing to do:
 * an unknown target, a drop onto itself, a landing that would file the task
 * under its own descendant, or one that changes neither parent nor order.
 *
 * A cycle deeper than the visible rows (a collapse can hide one) is left for the
 * core to refuse, because only it sees the whole tree.
 */
export function planPlacement(args: {
  rows: readonly VisibleRow[];
  activeId: string;
  overId: string;
  band: DropBand;
  indentDelta: number;
}): Placement | null {
  const { rows, activeId, overId, band, indentDelta } = args;
  if (activeId === overId) return null;
  const over = rows.find((r) => r.id === overId);
  if (!over) return null;

  const active = rows.find((r) => r.id === activeId) ?? null;
  // The dragged row leaves the list first, so every index below is measured in
  // the list the task is joining.
  const rest = rows.filter((r) => r.id !== activeId);
  const overIndex = rest.findIndex((r) => r.id === overId);
  if (overIndex < 0) return null;
  const slot = band === "before" ? overIndex : overIndex + 1;
  const prev = slot > 0 ? rest[slot - 1] : null;
  const next = slot < rest.length ? rest[slot] : null;

  // A row dragged in from another list has no depth here yet; the row under the
  // pointer is the only honest starting level.
  const activeDepth = active ? active.depth : over.depth;
  const activeParent = active ? active.parentId : over.parentId;

  const maxDepth = Math.min(prev ? prev.depth + 1 : 0, MAX_TASK_DEPTH - 1);
  const minDepth = next ? next.depth : 0;
  const wanted =
    (indentDelta === 0
      ? depthWithNoSideways({ activeDepth, activeParent, prev, next })
      : null) ?? activeDepth + indentDelta;
  // The cap wins on a tie (`>=`, not `>`). A slot directly under the first row
  // has `maxDepth === minDepth === 0`, and the tie has to resolve to the top
  // level — the shallow reading is the only one that matches the parent this
  // depth is about to derive, which is `null` when there is no row above.
  const depth =
    wanted >= maxDepth ? maxDepth : wanted < minDepth ? minDepth : wanted;

  const parent = parentFor({ rest, slot, depth, prev });
  // The core refuses this too; not writing it keeps the optimistic pass honest.
  if (parent === activeId) return null;
  if (parent && isUnder(rows, parent, activeId)) return null;

  // Splice the newcomer into its new sibling group. The neighbour that shares
  // the new parent fixes the position; when neither does (the group is empty or
  // entirely hidden) it lands last.
  const group = rest.filter((r) => r.parentId === parent).map((r) => r.id);
  let insertAt = group.length;
  if (next && next.parentId === parent) insertAt = group.indexOf(next.id);
  else if (prev && prev.parentId === parent) insertAt = group.indexOf(prev.id) + 1;
  const order = [...group.slice(0, insertAt), activeId, ...group.slice(insertAt)];

  if (active && parent === active.parentId) {
    const was = rows.filter((r) => r.parentId === active.parentId).map((r) => r.id);
    if (was.join() === order.join()) return null;
  }

  return { depth, parent, order };
}
