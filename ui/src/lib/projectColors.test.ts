import { describe, expect, it } from "vitest";
import { nextProjectColor, PROJECT_COLORS, withAlpha } from "./projectColors";

describe("nextProjectColor", () => {
  it("takes the first colour no other project claims", () => {
    expect(nextProjectColor([])).toBe(PROJECT_COLORS[0]);
    expect(nextProjectColor([PROJECT_COLORS[0]])).toBe(PROJECT_COLORS[1]);
    expect(nextProjectColor([PROJECT_COLORS[1], PROJECT_COLORS[0]])).toBe(PROJECT_COLORS[2]);
  });

  it("ignores colourless projects and case differences", () => {
    expect(nextProjectColor([null, undefined, ""])).toBe(PROJECT_COLORS[0]);
    expect(nextProjectColor([PROJECT_COLORS[0].toUpperCase()])).toBe(PROJECT_COLORS[1]);
  });

  it("still returns a palette colour once every one is taken", () => {
    const used = [...PROJECT_COLORS];
    expect(PROJECT_COLORS).toContain(nextProjectColor(used));
    // Colours from outside the palette count as used, and must not push the
    // index past the end.
    expect(PROJECT_COLORS).toContain(nextProjectColor([...used, "#123456"]));
  });
});

describe("withAlpha", () => {
  it("turns a hex colour into an rgba tint", () => {
    expect(withAlpha("#0E6E63", 0.16)).toBe("rgba(14,110,99,0.16)");
    expect(withAlpha("#fff", 1)).toBe("rgba(255,255,255,1)");
  });

  it("passes anything it cannot parse through untouched", () => {
    expect(withAlpha("rebeccapurple", 0.2)).toBe("rebeccapurple");
    expect(withAlpha("rgb(1,2,3)", 0.2)).toBe("rgb(1,2,3)");
  });
});
