import { describe, expect, it } from "vitest";
import { ROW_INDENT_STEP } from "./layout";
import { nestMove, planDrop, resolveDropIntent } from "./nestDrop";

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

  // Dropping a row beside a row of a group it is not in: the newcomer joins that
  // group, which is the other half of how a subtask comes back out.
  it("splices in a row that is not in the group yet", () => {
    const roots = ["a", "b", "c"];
    expect(nestMove(roots, "s1", "b", "before")).toEqual(["a", "s1", "b", "c"]);
    expect(nestMove(roots, "s1", "b", "after")).toEqual(["a", "b", "s1", "c"]);
    expect(nestMove(roots, "s1", "c", "after")).toEqual(["a", "b", "c", "s1"]);
  });
});

describe("planDrop", () => {
  const roots = ["a", "b", "c"];
  const plan = (over: Partial<Parameters<typeof planDrop>[0]> = {}) =>
    planDrop({
      activeId: "s1",
      activeParent: "p",
      overId: "b",
      overParent: null,
      groupIds: roots,
      intent: "after",
      ...over,
    });

  // The reported bug: a subtask could be dragged *into* another row but never
  // back out, because the handler only reordered within the dragged task's own
  // sibling group and quietly dropped every other target.
  it("lifts a subtask to the top level when dropped beside a top-level row", () => {
    expect(plan()).toEqual({ order: ["a", "b", "s1", "c"], parent: null });
  });

  it("lifts a subtask out from under a deep parent when dropped on its own parent row", () => {
    // s1 is a child of p, which is itself a child of g: landing beside p makes
    // s1 p's sibling, i.e. one level up, not all the way to the top.
    const order = planDrop({
      activeId: "s1",
      activeParent: "p",
      overId: "p",
      overParent: "g",
      groupIds: ["p", "q"],
      intent: "before",
    });
    expect(order).toEqual({ order: ["s1", "p", "q"], parent: "g" });
  });

  it("keeps the parent when the drop stays inside the group", () => {
    // No parent to write: the drop is a plain reorder of the hovered row's group.
    expect(
      planDrop({
        activeId: "s1",
        activeParent: "p",
        overId: "s2",
        overParent: "p",
        groupIds: ["s1", "s2"],
        intent: "after",
      }),
    ).toEqual({ order: ["s2", "s1"], parent: undefined });
  });

  it("files a top-level task under the hovered row's parent", () => {
    // Dropping a root task beside a subtask makes it a sibling of that subtask,
    // which is the same rule read the other way.
    expect(
      planDrop({
        activeId: "a",
        activeParent: null,
        overId: "s2",
        overParent: "p",
        groupIds: ["s1", "s2"],
        intent: "after",
      }),
    ).toEqual({ order: ["s1", "s2", "a"], parent: "p" });
  });

  it("refuses to make a task its own child, and ignores a no-op", () => {
    // Dropped on a row that is s1's own child: landing beside it would file s1
    // under s1. The core would refuse it too, but nothing should be written.
    expect(plan({ overId: "g1", overParent: "s1" })).toBeNull();
    // Dropping a row back onto itself, or right before the row it already
    // follows, changes nothing.
    expect(plan({ activeId: "s1", overId: "s1", overParent: "p", groupIds: ["s1", "s2"] })).toBeNull();
    expect(plan({ activeId: "b", activeParent: null, overId: "b", overParent: null })).toBeNull();
    expect(plan({ activeId: "a", activeParent: null, overId: "a", overParent: null })).toBeNull();
  });
});
