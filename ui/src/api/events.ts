// Event bridge: Rust -> React (design §8.2). Tauri events invalidate the
// relevant Query keys so writes from the tray, the MCP server, or another
// window refresh the UI. A window-focus refetch is the non-polling fallback
// for callbacks that were lost (design §4.5).

import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./queryKeys";

/** Minimal surface we need from a query client (keeps this unit-testable). */
export interface Invalidator {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => void;
}

/** Pure mapping from a Tauri event name to the Query keys it invalidates. */
export function keysForEvent(name: string): ReadonlyArray<readonly unknown[]> {
  switch (name) {
    case "task:created":
    case "task:updated":
    case "task:deleted":
      return [qk.taskAll, qk.tasksAll, qk.searchAll, qk.reportAll, qk.projects];
    case "project:changed":
      return [qk.projects, qk.tasksAll, qk.reportAll];
    case "tag:changed":
      return [qk.tags, qk.tasksAll, qk.taskAll];
    case "reminder:fired":
    case "reminder:catch_up":
      return [qk.tasksAll];
    case "mcp:http_state":
    case "mcp:write_toggled":
      return [qk.mcp("httpState"), qk.mcp("clients")];
    case "settings:changed":
      return [qk.mcp("httpState")];
    default:
      return [];
  }
}

export function invalidateForEvent(inv: Invalidator, name: string): void {
  for (const key of keysForEvent(name)) {
    inv.invalidateQueries({ queryKey: key });
  }
}

const WATCHED = [
  "task:created",
  "task:updated",
  "task:deleted",
  "project:changed",
  "tag:changed",
  "reminder:fired",
  "reminder:catch_up",
  "mcp:http_state",
  "mcp:write_toggled",
  "settings:changed",
];

/** Wire the bridge into a live QueryClient. Returns an unsubscribe function. */
export function registerEventBridge(qc: QueryClient): () => void {
  const unlisteners: Array<() => void> = [];
  let disposed = false;

  for (const name of WATCHED) {
    listen(name, () => invalidateForEvent(qc, name)).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });
  }

  const onFocus = () => {
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.taskAll });
  };
  window.addEventListener("focus", onFocus);

  return () => {
    disposed = true;
    unlisteners.forEach((un) => un());
    window.removeEventListener("focus", onFocus);
  };
}
