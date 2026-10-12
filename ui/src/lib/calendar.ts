//! Calendar drag-to-reschedule (design §13.1/§13.2).
//!
//! Only **materialised** occurrences can be dragged (a virtual occurrence has no
//! row to update); dropping one on another day produces the patch that moves it,
//! keeping the time of day.

import { civilOfDay, DAY_MS } from "./dates";

export interface ReschedulableItem {
  start_at: number | null;
  due_at: number | null;
  all_day: boolean;
}

export interface ReschedulePatch {
  due_at?: number;
  start_at?: number;
  all_day?: boolean;
}

/**
 * Patch that moves `item` so it falls on `targetDay`.
 *
 * - all-day: the date becomes the target day's civil date (UTC midnight), with no
 *   timezone conversion (§5.1);
 * - timed: every set instant shifts by the whole-day delta between the original
 *   day and the target day, so `18:00` stays `18:00`.
 *
 * Returns `null` when the item has nothing to move or is already on that day.
 */
export function reschedulePatch(
  item: ReschedulableItem,
  targetDay: number,
): ReschedulePatch | null {
  const anchor = item.due_at ?? item.start_at;
  if (anchor == null) return null;
  const target = civilOfDay(targetDay);

  if (item.all_day) {
    const moved =
      item.due_at !== target || (item.start_at != null && item.start_at !== target);
    if (!moved) return null;
    const patch: ReschedulePatch = {};
    if (item.due_at != null) patch.due_at = target;
    if (item.start_at != null) patch.start_at = target;
    return patch;
  }

  const delta = target - civilOfDay(anchor);
  if (delta === 0) return null;
  const patch: ReschedulePatch = {};
  if (item.due_at != null) patch.due_at = item.due_at + delta;
  if (item.start_at != null) patch.start_at = item.start_at + delta;
  return patch;
}

/**
 * Group calendar items by day. Items without any date are dropped.
 * `keyOf` lets the caller decide the bucket (see `dayKey`).
 */
export function groupByDay<T>(
  items: readonly T[],
  keyOf: (item: T) => number | null,
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null) continue;
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/** Number of whole days covered by a `[from, to)` window, rounded up. */
export function daySpan(from: number, to: number): number {
  return Math.max(1, Math.ceil((to - from) / DAY_MS));
}
