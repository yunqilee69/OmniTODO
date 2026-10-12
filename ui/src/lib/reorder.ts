//! Ordering helpers for drag-and-drop (design §13.2).
//!
//! Pure list math so the drag handlers stay thin and the behaviour is testable
//! without a DOM.

/** Move `from` to `to`, returning a new array. Out-of-range indices are no-ops. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Reorder `list` so it matches `orderedIds`; ids not present keep their order at the end. */
export function applyOrder<T extends { id: string }>(list: readonly T[], orderedIds: readonly string[]): T[] {
  const byId = new Map(list.map((t) => [t.id, t]));
  const out: T[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item) {
      out.push(item);
      byId.delete(id);
    }
  }
  for (const item of list) {
    if (byId.has(item.id)) out.push(item);
  }
  return out;
}

/**
 * dnd-kit gives the dragged and hovered **ids**; the store wants the whole new
 * order. Returns the reordered list (or `null` when nothing should change —
 * e.g. the drop target is outside the list).
 */
export function reorderByDrag<T extends { id: string }>(
  list: readonly T[],
  activeId: string,
  overId: string | null,
): T[] | null {
  if (!overId || activeId === overId) return null;
  const from = list.findIndex((t) => t.id === activeId);
  const to = list.findIndex((t) => t.id === overId);
  if (from < 0 || to < 0) return null;
  return moveItem(list, from, to);
}
