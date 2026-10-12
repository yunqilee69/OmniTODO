import { describe, expect, it } from "vitest";
import { splitHighlight } from "./highlight";

describe("splitHighlight", () => {
  it("splits around a match and keeps the original casing", () => {
    expect(splitHighlight("Review Design doc", "design")).toEqual([
      { text: "Review ", match: false },
      { text: "Design", match: true },
      { text: " doc", match: false },
    ]);
  });

  it("finds every occurrence", () => {
    expect(splitHighlight("aXaXa", "x").filter((s) => s.match)).toHaveLength(2);
  });

  it("highlights Chinese substrings (no word boundaries)", () => {
    expect(splitHighlight("评审设计稿", "设计")).toEqual([
      { text: "评审", match: false },
      { text: "设计", match: true },
      { text: "稿", match: false },
    ]);
  });

  it("returns the whole text as one segment when the term is empty or absent", () => {
    expect(splitHighlight("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(splitHighlight("abc", "  ")).toEqual([{ text: "abc", match: false }]);
    expect(splitHighlight("abc", "zzz")).toEqual([{ text: "abc", match: false }]);
  });

  it("handles a match at the very start and end", () => {
    expect(splitHighlight("abc", "ab")).toEqual([
      { text: "ab", match: true },
      { text: "c", match: false },
    ]);
    expect(splitHighlight("abc", "bc")).toEqual([
      { text: "a", match: false },
      { text: "bc", match: true },
    ]);
  });
});
