import { describe, expect, it, vi } from "vitest";
import { invalidateForEvent, keysForEvent, type Invalidator } from "./events";
import { qk } from "./queryKeys";

describe("keysForEvent", () => {
  it("invalidates task-derived keys on task events", () => {
    const keys = keysForEvent("task:updated");
    expect(keys).toContainEqual(qk.taskAll);
    expect(keys).toContainEqual(qk.tasksAll);
    expect(keys).toContainEqual(qk.reportAll);
    expect(keys).toContainEqual(qk.searchAll);
  });

  it("maps project and tag events to their own keys", () => {
    expect(keysForEvent("project:changed")).toContainEqual(qk.projects);
    expect(keysForEvent("tag:changed")).toContainEqual(qk.tags);
  });

  it("maps mcp state events", () => {
    expect(keysForEvent("mcp:http_state")).toContainEqual(qk.mcp("httpState"));
  });

  it("returns nothing for unknown events", () => {
    expect(keysForEvent("nope")).toEqual([]);
  });
});

describe("invalidateForEvent", () => {
  it("calls invalidateQueries for every mapped key", () => {
    const spy = vi.fn();
    const inv: Invalidator = { invalidateQueries: spy };
    invalidateForEvent(inv, "task:deleted");
    expect(spy).toHaveBeenCalledTimes(keysForEvent("task:deleted").length);
  });
});
