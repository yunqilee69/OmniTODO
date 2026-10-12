//! Minimal Markdown parser for the task detail preview (design §13.2: "textarea
//! + 预览，v1 不引富文本编辑器").
//!
//! Deliberately small and pure: it turns text into blocks/inlines that the
//! `MarkdownPreview` component renders as React elements (never
//! `dangerouslySetInnerHTML`, so raw HTML in a task description stays inert).
//! Supported: ATX headings, unordered/ordered lists, fenced code, blockquotes,
//! horizontal rules, paragraphs; inline `code`, **strong**, *em*, ~~strike~~,
//! [text](url) and bare autolinks.

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; value: string; lang: string | null }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "hr" };

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Only http(s)/mailto links become anchors; anything else stays literal text. */
export function safeHref(href: string): string | null {
  return SAFE_HREF.test(href.trim()) ? href.trim() : null;
}

const INLINE_RULES: {
  re: RegExp;
  build: (m: RegExpExecArray, parse: (s: string) => Inline[]) => Inline | null;
}[] = [
  {
    re: /`([^`]+)`/,
    build: (m) => ({ type: "code", value: m[1] }),
  },
  {
    re: /\*\*([^*]+)\*\*/,
    build: (m, parse) => ({ type: "strong", children: parse(m[1]) }),
  },
  {
    re: /~~([^~]+)~~/,
    build: (m, parse) => ({ type: "strike", children: parse(m[1]) }),
  },
  {
    re: /\*([^*]+)\*/,
    build: (m, parse) => ({ type: "em", children: parse(m[1]) }),
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m, parse) => {
      const href = safeHref(m[2]);
      return href ? { type: "link", href, children: parse(m[1]) } : null;
    },
  },
  {
    re: /\bhttps?:\/\/[^\s<>()]+/,
    build: (m) => {
      const href = safeHref(m[0]);
      return href ? { type: "link", href, children: [{ type: "text", value: m[0] }] } : null;
    },
  },
];

/** Parse one line of inline markup. Never throws; malformed input stays text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { index: number; len: number; node: Inline } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (!m || m.index === undefined) continue;
      const node = rule.build(m, parseInline);
      if (!node) continue;
      if (!best || m.index < best.index) {
        best = { index: m.index, len: m[0].length, node };
      }
    }
    if (!best) {
      out.push({ type: "text", value: rest });
      break;
    }
    if (best.index > 0) out.push({ type: "text", value: rest.slice(0, best.index) });
    out.push(best.node);
    rest = rest.slice(best.index + best.len);
  }
  return out.length > 0 ? out : [{ type: "text", value: "" }];
}

/** Parse a full document into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(buf.join(" ").trim()) });
      buf.length = 0;
    }
  };

  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(para);
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ type: "code", value: body.join("\n"), lang: fence[1] || null });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(para);
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(para);
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ").trim()) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph(para);
      const isOrdered = Boolean(ordered);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = isOrdered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1].trim()));
        i++;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return blocks;
}

/** Plain-text projection, used for one-line previews in list rows. */
export function toPlainText(src: string): string {
  return parseMarkdown(src)
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "paragraph":
        case "quote":
          return inlineText(b.children);
        case "code":
          return b.value;
        case "list":
          return b.items.map(inlineText).join(" ");
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}
