//! Ordering for the inline subtask branch (design §13.2).
//!
//! `task_list_subtasks` returns a whole subtree as a flat, sort-ordered list.
//! Rendering it needs two things the flat order doesn't carry: which node hangs
//! off which (so children follow their parent instead of being interleaved) and
//! how deep each node sits (for indentation).

import type { TaskDto } from "../api/client";

export interface PlacedSubtask {
  task: TaskDto;
  /** 1 for a direct child of the root, 2 for a grandchild, … */
  depth: number;
}

/**
 * Depth-first walk of `items`, which must all be descendants of `rootId`.
 *
 * Nodes whose parent is absent from `items` are dropped: the subtree query is
 * scoped to one root, so an unreachable parent means the row was reparented out
 * from under us and no longer belongs under this root.
 */
export function placeSubtree(rootId: string, items: TaskDto[]): PlacedSubtask[] {
  const byParent = new Map<string, TaskDto[]>();
  for (const task of items) {
    const parent = task.parent_id ?? rootId;
    const siblings = byParent.get(parent);
    if (siblings) siblings.push(task);
    else byParent.set(parent, [task]);
  }

  const placed: PlacedSubtask[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const task of byParent.get(parentId) ?? []) {
      placed.push({ task, depth });
      walk(task.id, depth + 1);
    }
  };
  walk(rootId, 1);
  return placed;
}
