import { describe, expect, it } from "vitest";
import type { SectionDto, TaskDto } from "../api/client";
import {
  flattenGroups,
  groupBySection,
  groupKey,
  groupLabel,
  NO_SECTION,
  planCardDrop,
  planColumnReorder,
  sectionForSlot,
  sectionNameTaken,
} from "./sections";

const section = (id: string, name: string, sort_order = 0): SectionDto => ({
  id,
  project_id: "p",
  name,
  sort_order,
  task_count: 0,
  created_at: 0,
  updated_at: 0,
  version: 1,
});

/** Only the fields the grouping reads. */
const task = (id: string, section_id: string | null = null): TaskDto =>
  ({ id, section_id, parent_id: null }) as TaskDto;

const A = section("s-a", "待办", 0);
const B = section("s-b", "进行中", 1);

describe("groupBySection", () => {
  it("puts the no-section group first, then the sections in their own order", () => {
    const groups = groupBySection(
      [task("t1", B.id), task("t2"), task("t3", A.id)],
      [A, B],
      { keepEmpty: true },
    );
    expect(groups.map(groupKey)).toEqual([NO_SECTION, A.id, B.id]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([["t2"], ["t3"], ["t1"]]);
  });

  it("drops empty groups unless they are asked for", () => {
    expect(groupBySection([task("t1", A.id)], [A, B]).map(groupKey)).toEqual([A.id]);
    expect(groupBySection([], [A, B], { keepEmpty: true }).map(groupKey)).toEqual([
      NO_SECTION,
      A.id,
      B.id,
    ]);
  });

  it("reads a task whose section is gone as unfiled rather than inventing a column", () => {
    // The section went down with its project, or has not synced here yet.
    const groups = groupBySection([task("t1", "s-deleted")], [A], { keepEmpty: true });
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(groups[0].section).toBeNull();
  });

  it("labels the unfiled group and names the others", () => {
    const groups = groupBySection([], [A], { keepEmpty: true });
    expect(groups.map(groupLabel)).toEqual(["无板块", "待办"]);
  });
});

describe("flattenGroups", () => {
  it("is the order the board draws: group by group, each in its own order", () => {
    const groups = groupBySection(
      [task("t1", B.id), task("t2"), task("t3", B.id), task("t4", A.id)],
      [A, B],
      { keepEmpty: true },
    );
    expect(flattenGroups(groups)).toEqual(["t2", "t4", "t1", "t3"]);
  });
});

describe("planCardDrop", () => {
  const groups = () =>
    groupBySection([task("a"), task("b"), task("c", A.id), task("d", A.id)], [A], {
      keepEmpty: true,
    });
  // Columns: [no section: a, b] [A: c, d]

  it("moves a card into another column at an index", () => {
    // `a` into A, before `d`.
    expect(planCardDrop({ groups: groups(), activeId: "a", toSectionId: A.id, toIndex: 1 })).toEqual(
      { order: ["b", "c", "a", "d"] },
    );
  });

  it("appends when no index is given (a drop on the column body)", () => {
    expect(planCardDrop({ groups: groups(), activeId: "a", toSectionId: A.id })).toEqual({
      order: ["b", "c", "d", "a"],
    });
  });

  it("reorders inside one column", () => {
    // `c` is first in A; dropping past `d` puts it last in that column, and the
    // other column is untouched.
    expect(planCardDrop({ groups: groups(), activeId: "c", toSectionId: A.id, toIndex: 2 })).toEqual(
      { order: ["a", "b", "d", "c"] },
    );
  });

  it("reads a drop in the card's own gap as a no-op", () => {
    // `a` is at index 0 in its column, so both gaps beside it are where it
    // already is — a drag that wobbles without leaving the slot writes nothing.
    expect(planCardDrop({ groups: groups(), activeId: "a", toSectionId: null, toIndex: 0 })).toBeNull();
    expect(planCardDrop({ groups: groups(), activeId: "a", toSectionId: null, toIndex: 1 })).toBeNull();
  });

  it("moves a card out to the unfiled column", () => {
    expect(planCardDrop({ groups: groups(), activeId: "d", toSectionId: null })).toEqual({
      order: ["a", "b", "d", "c"],
    });
  });

  it("clamps an index past the end of the destination column", () => {
    expect(planCardDrop({ groups: groups(), activeId: "a", toSectionId: A.id, toIndex: 99 })).toEqual(
      { order: ["b", "c", "d", "a"] },
    );
  });

  it("refuses a card that is not on the board", () => {
    expect(planCardDrop({ groups: groups(), activeId: "zzz", toSectionId: A.id })).toBeNull();
  });
});

describe("planColumnReorder", () => {
  const ids = ["s-a", "s-b", "s-c"];

  it("moves a column before or after the one it was dropped on", () => {
    expect(
      planColumnReorder({ sectionIds: ids, activeId: "s-c", overId: "s-a", band: "before" }),
    ).toEqual(["s-c", "s-a", "s-b"]);
    expect(
      planColumnReorder({ sectionIds: ids, activeId: "s-a", overId: "s-c", band: "after" }),
    ).toEqual(["s-b", "s-c", "s-a"]);
  });

  it("is a no-op when the column lands where it already was", () => {
    expect(
      planColumnReorder({ sectionIds: ids, activeId: "s-b", overId: "s-a", band: "after" }),
    ).toBeNull();
    expect(
      planColumnReorder({ sectionIds: ids, activeId: "s-b", overId: "s-b", band: "before" }),
    ).toBeNull();
  });

  it("ignores a target that is not a column", () => {
    expect(
      planColumnReorder({ sectionIds: ids, activeId: "s-a", overId: "nope", band: "before" }),
    ).toBeNull();
  });
});

describe("sectionForSlot", () => {
  const rows = [
    { id: "t1", parentId: null, depth: 0, sectionId: null },
    { id: "t2", parentId: null, depth: 0, sectionId: "s-a" },
    { id: "t2a", parentId: "t2", depth: 1, sectionId: null },
    { id: "t3", parentId: null, depth: 0, sectionId: "s-b" },
  ];

  it("takes the section of the row the drop line is attached to", () => {
    expect(sectionForSlot(rows, "t1")).toBeNull();
    expect(sectionForSlot(rows, "t2")).toBe("s-a");
    expect(sectionForSlot(rows, "t3")).toBe("s-b");
  });

  it("walks up to the branch for a nested row", () => {
    // A subtask has no column of its own; its parent's is the honest answer.
    expect(sectionForSlot(rows, "t2a")).toBe("s-a");
  });

  it("returns nothing for a row it cannot see", () => {
    expect(sectionForSlot(rows, "zzz")).toBeNull();
  });
});

describe("sectionNameTaken", () => {
  const list = [section("s-1", "待办"), section("s-2", "Done")];

  it("compares case-insensitively and ignores surrounding space", () => {
    expect(sectionNameTaken(" 待办 ", list)).toBe(true);
    expect(sectionNameTaken("done", list)).toBe(true);
    expect(sectionNameTaken("DONE", list)).toBe(true);
    expect(sectionNameTaken("待办中", list)).toBe(false);
  });

  it("does not clash a section with itself when renaming", () => {
    expect(sectionNameTaken("待办", list, "s-1")).toBe(false);
    expect(sectionNameTaken("done", list, "s-1")).toBe(true);
  });
});
