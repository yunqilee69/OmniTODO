//! Project colours (design §3.6).
//!
//! A project carries one colour that travels with its tasks: the dot beside its
//! name in the rail, the block it draws on a calendar that spans projects, and
//! the chip on a row in Today / a tag view / search — the places where a task is
//! separated from the project that explains it.
//!
//! The palette is a fixed set rather than a free colour wheel. Two reasons: a
//! project colour has to stay legible as a 8px dot and as a 16% tint on both the
//! paper and the charcoal ground, and the app has exactly one signal colour
//! (verdigris) plus a priority scale — a free wheel lets a project colour land
//! where it reads as either of those.

/** Ten hues, all mid-dark so they read the same on light and dark grounds. */
export const PROJECT_COLORS = [
  "#0E6E63", // verdigris — the app accent, so the first project matches the brand
  "#3F7C4F", // forest
  "#7A8B2E", // olive
  "#C08A1E", // ochre
  "#B2552F", // terracotta
  "#A03A4E", // garnet
  "#B0446A", // mulberry
  "#7A6BA8", // violet
  "#4A6FA5", // slate blue
  "#4E7C8A", // steel teal
] as const;

/** The colour a new project gets: the first palette entry nothing else claims.
 *
 *  Picking the first *unused* one rather than cycling by count keeps a fresh
 *  project visually distinct for as long as the palette lasts — the point of the
 *  colour is telling projects apart, so two projects sharing one defeats it. */
export function nextProjectColor(used: Iterable<string | null | undefined>): string {
  const taken = new Set(
    [...used].filter((c): c is string => typeof c === "string" && c.length > 0).map(lower),
  );
  return PROJECT_COLORS.find((c) => !taken.has(lower(c))) ?? PROJECT_COLORS[taken.size % PROJECT_COLORS.length];
}

/** `#0E6E63` → `rgba(14,110,99,.16)`, for the tinted blocks and chips.
 *
 *  Done here rather than with `color-mix()`: the desktop app paints on WebKitGTK,
 *  whose support varies by distro, and a chip background is not worth a version
 *  floor. Anything unparseable is returned untouched — a colour we cannot read is
 *  still better than no colour. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  const n = Number.parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgba(${r},${g},${b},${alpha})`;
}

function lower(c: string): string {
  return c.toLowerCase();
}
