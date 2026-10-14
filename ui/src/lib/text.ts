/** Text metrics for the hand-sized borderless controls (DESIGN §8.6).
 *
 *  antd's pickers want an explicit width; measuring the label lets a date chip
 *  hug its text instead of reserving a fixed box. Full-width CJK glyphs advance
 *  ~1em at the meta size, Latin letters and digits roughly half. */

const WIDE_GLYPH = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

export function labelWidth(label: string): number {
  let w = 0;
  for (const ch of label) w += WIDE_GLYPH.test(ch) ? 12 : 6.8;
  return Math.ceil(w) + 4;
}
