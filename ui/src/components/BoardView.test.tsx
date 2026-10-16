//! The board's two drop-id namespaces, pinned.
//!
//! A column is registered as a droppable twice — the sortable node
//! (`section:<id>`, `kind: "column"`) and the card body inside it
//! (`column:<key>`, `kind: "card"`). A card is registered under its own task id,
//! with no prefix. Reading the wrong shape is silent: the collision still
//! resolves, `onDragEnd` still runs, and the drop just does nothing — which is
//! exactly the bug these tests exist to catch.

import { describe, expect, it } from "vitest";
import { columnDragId, columnDropId, sectionOfColumnId } from "./BoardView";
import { NO_SECTION } from "../lib/sections";

describe("board drop ids", () => {
  it("names the section behind a column's sortable id", () => {
    expect(sectionOfColumnId(columnDragId("s-now"))).toBe("s-now");
  });

  it("does not read a card body as a column", () => {
    // The body's id is a *key*, not a section id: `NO_SECTION` for the unfiled
    // column has no section at all, and `column:s-now` must not be mistaken for
    // the sortable node of the same section.
    expect(sectionOfColumnId(columnDropId("s-now"))).toBeNull();
    expect(sectionOfColumnId(columnDropId(NO_SECTION))).toBeNull();
  });

  it("does not read a card as a column", () => {
    expect(sectionOfColumnId("t1")).toBeNull();
  });

  it("keeps the unfiled column's key in its drop id", () => {
    expect(columnDropId(NO_SECTION)).toBe(`column:${NO_SECTION}`);
    expect(columnDropId(NO_SECTION).slice("column:".length)).toBe(NO_SECTION);
  });
});
