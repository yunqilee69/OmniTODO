//! Search-result highlighting (design §13.1: "Search：全文搜索 + 结果高亮").
//!
//! Pure splitting so the component only maps segments to elements and the
//! behaviour (case-insensitive, all occurrences, CJK-safe) is testable.

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Split `text` around every case-insensitive occurrence of `term`.
 * Returns a single non-matching segment when there is nothing to highlight.
 * Matches use simple substring search, so it works for Chinese as well as
 * for the trigram/LIKE fallback behaviour of the FTS layer.
 */
export function splitHighlight(text: string, term: string): Segment[] {
  const needle = term.trim();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const lower = needle.toLowerCase();
  const out: Segment[] = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(lower, cursor);
    if (at < 0) break;
    if (at > cursor) out.push({ text: text.slice(cursor, at), match: false });
    out.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}
