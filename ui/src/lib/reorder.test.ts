import { describe, expect, it } from "vitest";
import { applyOrder, moveItem, reorderByDrag } from "./reorder";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("moveItem", () => {
  it("moves an item down without mutating the input", () => {
    const out = moveItem(items, 0, 2);
    expect(out.map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("moves an item up", () => {
    expect(moveItem(items, 3, 1).map((i) => i.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op for equal or out-of-range indices", () => {
    expect(moveItem(items, 1, 1).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(items, -1, 2).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveItem(items, 0, 9).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("reorderByDrag", () => {
  it("reorders by ids", () => {
    expect(reorderByDrag(items, "d", "a")?.map((i) => i.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("returns null when nothing should change", () => {
    expect(reorderByDrag(items, "a", "a")).toBeNull();
    expect(reorderByDrag(items, "a", null)).toBeNull();
    // Dropped on a row from another list.
    expect(reorderByDrag(items, "a", "zzz")).toBeNull();
  });
});

describe("applyOrder", () => {
  it("applies a server order and parks unknown ids at the end", () => {
    expect(applyOrder(items, ["c", "a"]).map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores ids that are no longer present", () => {
    expect(applyOrder(items, ["d", "gone", "b"]).map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
  });
});
