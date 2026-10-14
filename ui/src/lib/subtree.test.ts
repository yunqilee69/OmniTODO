import { describe, expect, it } from "vitest";
import type { TaskDto } from "../api/client";
import { subtreeChildren } from "./subtree";

/** Only the fields the walk reads matter here. */
const t = (id: string, parent_id: string | null) => ({ id, parent_id }) as TaskDto;

/**
 * Depth-first walk, the way `SubtaskRows` renders a branch: each node followed
 * immediately by its own children, so the rows come out in reading order.
 */
function flatten(rootId: string, items: TaskDto[], expanded?: ReadonlySet<string>) {
  const byParent = subtreeChildren(rootId, items);
  const placed: [string, number][] = [];
  const walk = (parentId: string, depth: number) => {
    for (const task of byParent.get(parentId) ?? []) {
      placed.push([task.id, depth]);
      if (!expanded || expanded.has(task.id)) walk(task.id, depth + 1);
    }
  };
  walk(rootId, 1);
  return placed;
}

describe("subtreeChildren", () => {
  it("nests children under their parent instead of the query order", () => {
    const placed = flatten("root", [t("grand", "child"), t("child", "root"), t("other", "root")]);
    expect(placed).toEqual([
      ["child", 1],
      ["grand", 2],
      ["other", 1],
    ]);
  });

  it("keeps sibling order stable", () => {
    const placed = flatten("root", [t("a", "root"), t("b", "root"), t("c", "root")]);
    expect(placed.map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("treats a null parent as the root", () => {
    expect(flatten("root", [t("a", null)])).toEqual([["a", 1]]);
  });

  it("drops nodes whose parent is not in the subtree", () => {
    const placed = flatten("root", [t("a", "root"), t("orphan", "elsewhere")]);
    expect(placed.map(([id]) => id)).toEqual(["a"]);
  });

  it("handles an empty subtree", () => {
    expect(flatten("root", [])).toEqual([]);
  });

  it("lists a nested branch only once its own row is expanded", () => {
    const items = [t("child", "root"), t("grand", "child")];
    // Collapsed: the child shows, its own subtree does not.
    expect(flatten("root", items, new Set()).map(([id]) => id)).toEqual(["child"]);
    expect(flatten("root", items, new Set(["child"])).map(([id]) => id)).toEqual(["child", "grand"]);
  });
});
