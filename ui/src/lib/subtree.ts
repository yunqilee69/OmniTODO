//! Ordering for the inline subtask branch (design §13.2).
//!
//! `task_list_subtasks` returns a whole subtree as a flat, sort-ordered list.
//! Rendering it needs what the flat order doesn't carry: which node hangs off
//! which, so children follow their parent instead of being interleaved.

import type { TaskDto } from "../api/client";

/**
 * Direct children of every node in `items`, keyed by parent id, each group in
 * the order the query returned it (i.e. the user's manual order).
 *
 * `items` must all be descendants of `rootId`; a node whose parent is absent
 * from `items` is dropped, because the subtree query is scoped to one root and
 * an unreachable parent means the row was reparented out from under us and no
 * longer belongs under this root. A null parent counts as the root itself.
 */
export function subtreeChildren(rootId: string, items: TaskDto[]): Map<string, TaskDto[]> {
  const byParent = new Map<string, TaskDto[]>();
  for (const task of items) {
    const parent = task.parent_id ?? rootId;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(task);
    else byParent.set(parent, [task]);
  }
  return byParent;
}
