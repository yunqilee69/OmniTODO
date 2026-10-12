//! List rendering decisions.

/**
 * Threshold above which a **non-draggable** list is windowed with
 * `@tanstack/react-virtual`.
 *
 * Drag-sorted lists are deliberately never virtualized: dnd-kit measures every
 * sibling to compute drop positions and an autoscroll drag, so rows outside the
 * window would have no rect and the drop target would be wrong. Views that need
 * both (a project with hundreds of tasks) keep drag-sort and lose windowing.
 */
export const VIRTUALIZE_THRESHOLD = 60;

export function shouldVirtualize(count: number, sortable: boolean): boolean {
  return !sortable && count > VIRTUALIZE_THRESHOLD;
}
