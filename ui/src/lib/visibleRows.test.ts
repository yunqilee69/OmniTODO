import { describe, expect, it } from "vitest";
import {
  readVisibleRows,
  rowDomAttrs,
  TASK_DEPTH_ATTR,
  TASK_ID_ATTR,
  TASK_PARENT_ATTR,
  TASK_SECTION_ATTR,
} from "./visibleRows";

/** A `<ul>` holding rows built from `rowDomAttrs`. */
const list = (rows: Array<[string, number, string | null, string?]>) => {
  const ul = document.createElement("ul");
  for (const [id, depth, parentId, sectionId] of rows) {
    const li = document.createElement("li");
    for (const [k, v] of Object.entries(rowDomAttrs(id, depth, parentId, sectionId ?? null))) {
      li.setAttribute(k, v);
    }
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  return ul;
};

describe("rowDomAttrs", () => {
  it("publishes the id and depth, and the parent only when there is one", () => {
    expect(rowDomAttrs("t1", 0, null)).toEqual({
      [TASK_ID_ATTR]: "t1",
      [TASK_DEPTH_ATTR]: "0",
    });
    expect(rowDomAttrs("t2", 3, "t1")).toEqual({
      [TASK_ID_ATTR]: "t2",
      [TASK_DEPTH_ATTR]: "3",
      [TASK_PARENT_ATTR]: "t1",
    });
  });

  it("publishes the section only for a top-level row that has one", () => {
    expect(rowDomAttrs("t1", 0, null, "s1")).toEqual({
      [TASK_ID_ATTR]: "t1",
      [TASK_DEPTH_ATTR]: "0",
      [TASK_SECTION_ATTR]: "s1",
    });
    // A subtask has no column of its own, and neither has an unfiled task.
    expect(rowDomAttrs("t2", 1, "t1", null)).toEqual({
      [TASK_ID_ATTR]: "t2",
      [TASK_DEPTH_ATTR]: "1",
      [TASK_PARENT_ATTR]: "t1",
    });
  });
});

describe("readVisibleRows", () => {
  it("reads the rendered rows back in display order", () => {
    const ul = list([
      ["a", 0, null],
      ["b", 1, "a"],
      ["c", 2, "b"],
      ["d", 0, null],
    ]);
    expect(readVisibleRows(ul)).toEqual([
      { id: "a", depth: 0, parentId: null, sectionId: null },
      { id: "b", depth: 1, parentId: "a", sectionId: null },
      { id: "c", depth: 2, parentId: "b", sectionId: null },
      { id: "d", depth: 0, parentId: null, sectionId: null },
    ]);
  });

  // Only the rows actually rendered count: a collapsed branch is not on screen,
  // and the drop maths clamps against the rows above and below the slot — so a
  // hidden row must not be able to clamp anything.
  it("sees only what is rendered", () => {
    const ul = list([
      ["a", 0, null],
      ["d", 0, null],
    ]);
    expect(readVisibleRows(ul).map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("finds the rows of a nested list too, not just its own children", () => {
    const ul = list([["a", 0, null]]);
    const nested = document.createElement("ul");
    const li = document.createElement("li");
    for (const [k, v] of Object.entries(rowDomAttrs("b", 1, "a"))) li.setAttribute(k, v);
    nested.appendChild(li);
    ul.appendChild(nested);
    expect(readVisibleRows(ul).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("reads back the section each top-level row is filed under", () => {
    const ul = list([
      ["a", 0, null, "s1"],
      ["b", 1, "a"],
      ["c", 0, null, "s2"],
    ]);
    expect(readVisibleRows(ul).map((r) => r.sectionId)).toEqual(["s1", null, "s2"]);
  });

  it("returns nothing for a missing list", () => {
    expect(readVisibleRows(null)).toEqual([]);
    expect(readVisibleRows(undefined)).toEqual([]);
  });
});
