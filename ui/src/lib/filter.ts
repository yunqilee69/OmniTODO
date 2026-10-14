//! Filter construction for the sidebar views (design §13.1).
//!
//! Kept apart from the components so each view's query shape is testable and the
//! query keys stay stable.

import type { Sort, TaskFilter } from "../api/client";
import { addDays, endOfLocalDay } from "./dates";

export const DEFAULT_LIMIT = 200;

/** Inbox: tasks filed under no project (design §12.2 — cancelling the `#project`
 *  picker drops the task here), newest first. */
export function inboxFilter(limit = DEFAULT_LIMIT): TaskFilter {
  return { sort: "createddesc", limit, root_only: true, unfiled: true, include_completed: true };
}

/**
 * Today: anything due (or overdue) by the end of today, earliest first.
 * Overdue items stay visible here on purpose — they are the ones that need
 * attention, and a lower bound would hide them.
 */
export function todayFilter(now = Date.now(), limit = DEFAULT_LIMIT): TaskFilter {
  return {
    sort: "dueasc",
    due_before: endOfLocalDay(now),
    limit,
    root_only: true,
    include_completed: true,
  };
}

/** Upcoming: the next seven days, starting tomorrow. */
export function upcomingFilter(now = Date.now(), limit = DEFAULT_LIMIT): TaskFilter {
  const from = endOfLocalDay(now);
  return {
    sort: "dueasc",
    due_after: from,
    due_before: addDays(from, 7),
    limit,
    root_only: true,
    include_completed: true,
  };
}

/**
 * A project's tasks. Defaults to the user's manual order (drag-sort friendly);
 * the project's display settings can swap in a computed order instead, which
 * also turns dragging off.
 */
export function projectFilter(
  projectId: string,
  opts: { includeCompleted?: boolean; sort?: Sort; limit?: number } = {},
): TaskFilter {
  return {
    project_ids: [projectId],
    sort: opts.sort ?? "manual",
    limit: opts.limit ?? DEFAULT_LIMIT,
    root_only: true,
    include_completed: opts.includeCompleted ?? true,
  };
}

/**
 * Tasks carrying a tag, earliest due first.
 *
 * Deliberately not `manual`: `sort_order` is a single global column, so applying
 * the project order to a cross-project cut would look arbitrary.
 */
export function tagFilter(
  tagId: string,
  opts: { includeCompleted?: boolean; limit?: number } = {},
): TaskFilter {
  return {
    tag_ids: [tagId],
    sort: "dueasc",
    limit: opts.limit ?? DEFAULT_LIMIT,
    root_only: true,
    include_completed: opts.includeCompleted ?? true,
  };
}

/** Base filter for full-text search (the query itself goes to `search_query`). */
export function searchFilter(limit = DEFAULT_LIMIT): TaskFilter {
  return { sort: "createddesc", limit, include_completed: true };
}
