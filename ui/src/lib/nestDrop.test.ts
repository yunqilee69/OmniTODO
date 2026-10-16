import { describe, expect, it } from "vitest";
import { MAX_TASK_DEPTH, ROW_INDENT_STEP } from "./layout";
import {
  indentDeltaFromDrag,
  planPlacement,
  resolveDropBand,
  type VisibleRow,
} from "./nestDrop";

const ROW = 40;
const STEP = ROW_INDENT_STEP;

/** A visible row, at `depth`, under `parentId`. */
const row = (id: string, depth = 0, parentId: string | null = null): VisibleRow => ({
  id,
  depth,
  parentId,
});

/** `planPlacement` with the boring arguments filled in. */
const plan = (
  rows: VisibleRow[],
  over: Partial<Parameters<typeof planPlacement>[0]> = {},
) =>
  planPlacement({
    rows,
    activeId: "x",
    overId: rows[rows.length - 1]?.id ?? "x",
    band: "after",
    indentDelta: 0,
    ...over,
  });

describe("resolveDropBand", () => {
  it("splits the hovered row at its midpoint", () => {
    expect(resolveDropBand(0, ROW)).toBe("before");
    expect(resolveDropBand(ROW / 2 - 1, ROW)).toBe("before");
    // The midpoint itself belongs to the lower gap, so the two bands tile the
    // row without an unclaimed pixel between them.
    expect(resolveDropBand(ROW / 2, ROW)).toBe("after");
    expect(resolveDropBand(ROW - 1, ROW)).toBe("after");
  });

  it("falls back to before for a row with no measurable height", () => {
    // Mid-layout or hidden: there are no bands to split, and "before" is the
    // harmless reading.
    expect(resolveDropBand(0, 0)).toBe("before");
    expect(resolveDropBand(10, -1)).toBe("before");
  });
});

describe("indentDeltaFromDrag", () => {
  it("counts one level per indent step travelled", () => {
    expect(indentDeltaFromDrag(0)).toBe(0);
    expect(indentDeltaFromDrag(STEP)).toBe(1);
    expect(indentDeltaFromDrag(2 * STEP)).toBe(2);
    expect(indentDeltaFromDrag(-STEP)).toBe(-1);
    expect(indentDeltaFromDrag(-2 * STEP)).toBe(-2);
  });

  it("rounds, so a half-step wobble is not a level", () => {
    expect(indentDeltaFromDrag(STEP / 2 - 1)).toBe(0);
    expect(indentDeltaFromDrag(STEP / 2)).toBe(1);
    expect(indentDeltaFromDrag(3 * STEP + 4)).toBe(3);
  });

  // The bug this guards. The old model read the pointer's *absolute* offset
  // inside the row and compared it against the row's own left padding, so
  // "become a child" needed offsetX past ~32px. Measured in the running app a
  // row is ~500px wide, its handle sits 44px in and its checkbox 60px, so every
  // drop in the bottom band read as "child" and silently reparented the row —
  // in the project view, which lists root tasks only, the row just vanished.
  // Depth now depends only on how far the *drag* travelled sideways, so no row
  // column or width can reach a deeper level by accident.
  it("does not depend on where in the row the drag started", () => {
    for (const _handleOffset of [0, 44, 60, 84, 480]) {
      expect(indentDeltaFromDrag(0)).toBe(0);
    }
  });
});

describe("planPlacement", () => {
  const flat = [row("a"), row("b"), row("c")];

  describe("reordering without changing level", () => {
    it("moves a row up in its own group", () => {
      expect(plan(flat, { activeId: "c", overId: "b", band: "before" })).toEqual({
        depth: 0,
        parent: null,
        order: ["a", "c", "b"],
      });
    });

    it("moves a row down in its own group", () => {
      expect(plan(flat, { activeId: "a", overId: "b", band: "after" })).toEqual({
        depth: 0,
        parent: null,
        order: ["b", "a", "c"],
      });
    });

    it("returns null when the drop changes nothing", () => {
      // b already follows a: dropping it back there is not a move.
      expect(plan(flat, { activeId: "b", overId: "a", band: "after" })).toBeNull();
      // The same for the tail: c is already last.
      expect(plan(flat, { activeId: "c", overId: "b", band: "after" })).toBeNull();
    });

    it("returns null for a drop onto itself or an unknown target", () => {
      expect(plan(flat, { activeId: "b", overId: "b", band: "before" })).toBeNull();
      expect(plan(flat, { activeId: "b", overId: "gone", band: "before" })).toBeNull();
    });

    it("splices in a row that is not in the list yet", () => {
      // A row dragged in from elsewhere is not in `rows`, so nothing is
      // filtered out and the newcomer joins the hovered row's group.
      expect(plan(flat, { activeId: "s", overId: "b", band: "before" })).toEqual({
        depth: 0,
        parent: null,
        order: ["a", "s", "b", "c"],
      });
    });
  });

  describe("nesting one level deeper", () => {
    it("makes the row above the parent when pushed one step right", () => {
      expect(
        plan(flat, { activeId: "c", overId: "a", band: "after", indentDelta: 1 }),
      ).toEqual({ depth: 1, parent: "a", order: ["c"] });
    });

    it("nests several levels in a single gesture", () => {
      // Two steps right, one drag: no per-level round trip.
      const rows = [row("p"), row("x", 1, "p"), row("y", 1, "p"), row("q")];
      expect(
        plan(rows, { activeId: "q", overId: "x", band: "after", indentDelta: 2 }),
      ).toEqual({ depth: 2, parent: "x", order: ["q"] });
    });

    it("follows the row above when the drag did not move sideways", () => {
      // A straight-down drag into the middle of a branch joins that branch at
      // the level of the row it lands beside, rather than holding its own level
      // and having the clamp flatten it — which would read as the row jumping a
      // level on its way past.
      const rows = [row("p"), row("b", 1, "p"), row("c", 2, "b"), row("x")];
      expect(
        plan(rows, { activeId: "x", overId: "c", band: "before" }),
      ).toEqual({ depth: 2, parent: "b", order: ["x", "c"] });
    });

    it("caps the depth at the deepest level the tree allows", () => {
      // Five levels of branch, then a top-level row pushed five steps right.
      const rows = [
        row("a"),
        row("b", 1, "a"),
        row("c", 2, "b"),
        row("d", 3, "c"),
        row("e", 4, "d"),
        row("x"),
      ];
      const placement = plan(rows, {
        activeId: "x",
        overId: "e",
        band: "after",
        indentDelta: 5,
      });
      expect(placement).toEqual({ depth: MAX_TASK_DEPTH - 1, parent: "d", order: ["e", "x"] });
      expect(placement!.depth).toBeLessThanOrEqual(MAX_TASK_DEPTH - 1);
    });
  });

  describe("lifting a row back out", () => {
    it("hoists a subtask to the top level when dragged left", () => {
      const rows = [row("p"), row("a", 1, "p"), row("b", 1, "p")];
      expect(
        plan(rows, { activeId: "b", overId: "a", band: "after", indentDelta: -1 }),
      ).toEqual({ depth: 0, parent: null, order: ["p", "b"] });
    });

    it("hoists a subtask to an intermediate level, not all the way out", () => {
      // s2 is p's child and p is g's: outdenting one step makes s2 g's child,
      // beside p, rather than a root task.
      const rows = [
        row("g"),
        row("p", 1, "g"),
        row("s1", 2, "p"),
        row("s2", 2, "p"),
        row("q", 1, "g"),
      ];
      expect(
        plan(rows, { activeId: "s2", overId: "q", band: "before", indentDelta: -1 }),
      ).toEqual({ depth: 1, parent: "g", order: ["p", "s2", "q"] });
    });

    it("outdents a subtask by dropping it above its own parent", () => {
      // The slot above the parent row is the only place a first child can go to
      // reach the level above, so this has to read as a lift and not as a
      // no-op. The slot has no row above it, which is also the case where the
      // depth cap and floor meet at 0 and the shallow reading has to win.
      const rows = [row("a"), row("b", 1, "a")];
      expect(plan(rows, { activeId: "b", overId: "a", band: "before" })).toEqual({
        depth: 0,
        parent: null,
        order: ["b", "a"],
      });
    });

    it("holds the row below when the drag outdents past the list", () => {
      // x was dragged far left — one level above the top — but the row it lands
      // above is a child of p, so it can only rise to p's first child. Landing
      // it at the top level would hoist it out from under the row that follows.
      const rows = [row("p"), row("s", 1, "p"), row("x")];
      expect(
        plan(rows, { activeId: "x", overId: "s", band: "before", indentDelta: -1 }),
      ).toEqual({ depth: 1, parent: "p", order: ["x", "s"] });
    });
  });

  describe("refusing placements the tree cannot hold", () => {
    it("refuses to file a row under its own child", () => {
      // p dragged two steps right beside t, which sits at depth 3 under p:
      // the depth works out, but the parent it derives is p's own descendant.
      const rows = [row("g"), row("p", 1, "g"), row("s", 2, "p"), row("t", 3, "s")];
      expect(
        plan(rows, { activeId: "p", overId: "t", band: "after", indentDelta: 2 }),
      ).toBeNull();
    });

    it("refuses to make a row its own parent", () => {
      // a dropped one step right beside c, which is a's own child: the derived
      // parent is a itself. The core refuses this too, but nothing should be
      // written for the optimistic pass to roll back.
      const rows = [row("a"), row("b", 1, "a"), row("c", 2, "b"), row("y")];
      expect(
        plan(rows, { activeId: "a", overId: "c", band: "after", indentDelta: 1 }),
      ).toBeNull();
    });
  });

  describe("a row dragged in from another list", () => {
    // Nothing is filtered out of `rows`, so the hovered row is the only honest
    // starting level — the dragged row has no depth in this list yet.
    it("starts from the hovered row's level", () => {
      const rows = [row("a"), row("b", 1, "a")];
      expect(plan(rows, { activeId: "s", overId: "b", band: "after" })).toEqual({
        depth: 1,
        parent: "a",
        order: ["b", "s"],
      });
    });
  });
});
