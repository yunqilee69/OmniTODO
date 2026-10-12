import { describe, expect, it } from "vitest";
import type { TaskDto } from "../api/client";
import { placeSubtree } from "./subtree";

/** Only the fields `placeSubtree` reads matter here. */
const t = (id: string, parent_id: string | null) => ({ id, parent_id }) as TaskDto;

describe("placeSubtree", () => {
  it("nests children under their parent instead of the query order", () => {
    const placed = placeSubtree("root", [
      t("grand", "child"),
      t("child", "root"),
      t("other", "root"),
    ]);
    expect(placed.map((p) => [p.task.id, p.depth])).toEqual([
      ["child", 1],
      ["grand", 2],
      ["other", 1],
    ]);
  });

  it("keeps sibling order stable", () => {
    const placed = placeSubtree("root", [t("a", "root"), t("b", "root"), t("c", "root")]);
    expect(placed.map((p) => p.task.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a null parent as the root", () => {
    const placed = placeSubtree("root", [t("a", null)]);
    expect(placed.map((p) => [p.task.id, p.depth])).toEqual([["a", 1]]);
  });

  it("drops nodes whose parent is not in the subtree", () => {
    const placed = placeSubtree("root", [t("a", "root"), t("orphan", "elsewhere")]);
    expect(placed.map((p) => p.task.id)).toEqual(["a"]);
  });

  it("handles an empty subtree", () => {
    expect(placeSubtree("root", [])).toEqual([]);
  });
});
