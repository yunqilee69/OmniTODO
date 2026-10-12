import { describe, expect, it } from "vitest";
import { shouldVirtualize, VIRTUALIZE_THRESHOLD } from "./list";

describe("shouldVirtualize", () => {
  it("windows long, non-draggable lists", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 1, false)).toBe(true);
  });

  it("leaves short lists alone", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD, false)).toBe(false);
    expect(shouldVirtualize(0, false)).toBe(false);
  });

  it("never windows a drag-sorted list, however long", () => {
    expect(shouldVirtualize(VIRTUALIZE_THRESHOLD + 500, true)).toBe(false);
  });
});
