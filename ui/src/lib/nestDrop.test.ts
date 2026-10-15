import { describe, expect, it } from "vitest";
import { nestMove, resolveDropIntent } from "./nestDrop";

const ROW = 40;
/** A depth-0 row: 12px of its own padding, so the child slot starts at 32. */
const INDENT = 12;

describe("resolveDropIntent", () => {
  it("treats the top of the row as insert-before, whatever the indent", () => {
    expect(resolveDropIntent(0, ROW, 0, INDENT)).toBe("before");
    expect(resolveDropIntent(10, ROW, 80, INDENT)).toBe("before");
  });

  it("treats the bottom, held at the row's own indent, as insert-after", () => {
    expect(resolveDropIntent(30, ROW, 0, INDENT)).toBe("after");
    // One pixel short of a full indent step is still a sibling.
    expect(resolveDropIntent(30, ROW, INDENT + 19, INDENT)).toBe("after");
  });

  it("treats the bottom, pushed one indent step right, as a child", () => {
    expect(resolveDropIntent(30, ROW, INDENT + 20, INDENT)).toBe("child");
    expect(resolveDropIntent(39, ROW, 64, INDENT)).toBe("child");
  });

  it("falls back to before for a row with no measurable height", () => {
    expect(resolveDropIntent(0, 0, 40, INDENT)).toBe("before");
  });
});

describe("nestMove", () => {
  const ids = ["a", "b", "c", "d"];

  it("inserts before the hovered row", () => {
    expect(nestMove(ids, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
  });

  it("inserts after the hovered row", () => {
    expect(nestMove(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("inserts after a row that itself slides up when the dragged row leaves", () => {
    // Dropping b after a: a stays put, b comes back to where it was.
    expect(nestMove(ids, "b", "a", "after")).toBeNull();
    // Dropping a after b lands it between b and c, not back at the front.
    expect(nestMove(ids, "a", "b", "after")).toEqual(["b", "a", "c", "d"]);
  });

  it("returns null when nothing moves", () => {
    expect(nestMove(ids, "b", "c", "before")).toBeNull();
    expect(nestMove(ids, "a", "a", "before")).toBeNull();
    expect(nestMove(ids, "a", "gone", "before")).toBeNull();
    // Reparenting is the caller's job, not a reorder of this group.
    expect(nestMove(ids, "a", "b", "child")).toBeNull();
  });
});
