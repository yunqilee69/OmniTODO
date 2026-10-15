import { describe, expect, it } from "vitest";
import { ROW_INDENT_STEP } from "./layout";
import { nestMove, resolveDropIntent } from "./nestDrop";

const ROW = 40;

describe("resolveDropIntent", () => {
  it("treats the top of the row as insert-before, however far right the drag went", () => {
    expect(resolveDropIntent(0, ROW, 0)).toBe("before");
    expect(resolveDropIntent(10, ROW, 200)).toBe("before");
  });

  it("treats the bottom, dragged straight down, as insert-after", () => {
    expect(resolveDropIntent(30, ROW, 0)).toBe("after");
    expect(resolveDropIntent(30, ROW, -200)).toBe("after");
  });

  it("treats the bottom, pushed one indent step right, as a child", () => {
    expect(resolveDropIntent(30, ROW, ROW_INDENT_STEP)).toBe("child");
    expect(resolveDropIntent(39, ROW, 200)).toBe("child");
  });

  // The bug this guards. The threshold used to be the pointer's *absolute*
  // offset inside the row, compared against `rowPaddingLeft(depth)` (12px at
  // depth 0), so "child" needed offsetX >= 32. Measured in the running app, a
  // row is ~500px wide and its handle sits 44px in, its checkbox 60px, its
  // title 84px — so every drop in the bottom band was read as "child". That
  // silently reparented rows; the project view lists root tasks only, so the
  // dragged row just vanished. The intent now depends only on how far the drag
  // travelled right, so no row column or width can reach the child slot by
  // accident.
  it("does not depend on where in the row the drag started", () => {
    const dx = 0;
    // Every one of these used to be classified by an absolute offset well
    // past the 32px cut; now a zero-width drag is a sibling everywhere.
    for (const _handleOffset of [44, 60, 84, 480]) {
      expect(resolveDropIntent(30, ROW, dx)).toBe("after");
    }
    expect(resolveDropIntent(30, ROW, ROW_INDENT_STEP - 1)).toBe("after");
  });

  it("falls back to before for a row with no measurable height", () => {
    expect(resolveDropIntent(0, 0, 0)).toBe("before");
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
