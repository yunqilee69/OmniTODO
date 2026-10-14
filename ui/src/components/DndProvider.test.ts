import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Page, TaskDto } from "../api/client";
import { qk } from "../api/queryKeys";
import { findCachedSiblings, findCachedTask } from "./DndProvider";

const t = (id: string, parent_id: string | null = null) => ({ id, parent_id }) as TaskDto;

/**
 * The two caches have different shapes — `task_list` is a page, an expanded
 * branch is the bare array `task_list_subtasks` returns — so the drag handlers
 * have to read both, and these are the tests that hold them to it.
 */
function client() {
  const qc = new QueryClient();
  const page: Page<TaskDto> = { items: [t("a"), t("b"), t("c")], total: 3, limit: 200, offset: 0 };
  qc.setQueryData(qk.tasks({ sort: "manual" }), page);
  // t7a is a child of t7 and t7a1 hangs off t7a, so the cache is depth-first.
  qc.setQueryData(qk.subtasks("t7"), [t("t7a", "t7"), t("t7a1", "t7a"), t("t7b", "t7")]);
  return qc;
}

describe("findCachedSiblings", () => {
  it("returns the whole list for a top-level task", () => {
    expect(findCachedSiblings(client(), "b")).toEqual({ scope: "tasks", ids: ["a", "b", "c"] });
  });

  it("returns only the same-parent rows for a subtask", () => {
    // Not ["t7a", "t7a1", "t7b"]: the grandchild is not a sibling, and moving it
    // along with its parent would hoist it out of the parent.
    expect(findCachedSiblings(client(), "t7b")).toEqual({ scope: "subtasks", ids: ["t7a", "t7b"] });
  });

  it("returns null for an id that is in no cache", () => {
    expect(findCachedSiblings(client(), "gone")).toBeNull();
  });
});

describe("findCachedTask", () => {
  it("finds a subtask in the bare-array branch cache", () => {
    expect(findCachedTask(client(), "t7a1")?.parent_id).toBe("t7a");
  });

  it("finds a top-level task in the paged list cache", () => {
    expect(findCachedTask(client(), "c")?.id).toBe("c");
  });
});
