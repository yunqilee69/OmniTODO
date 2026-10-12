import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref, toPlainText } from "./markdown";

describe("markdown inline", () => {
  it("parses strong, emphasis, code and strike", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "strong", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c" },
    ]);
    expect(parseInline("`x=1`")).toEqual([{ type: "code", value: "x=1" }]);
    expect(parseInline("~~gone~~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
  });

  it("keeps a bare * literal when it has no closing marker", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", value: "2 * 3 = 6" }]);
  });

  it("turns http(s) and mailto links into anchors but drops javascript:", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();

    const [node] = parseInline("[x](javascript:alert(1))");
    expect(node).toEqual({ type: "text", value: "[x](javascript:alert(1))" });
  });

  it("autolinks bare urls", () => {
    expect(parseInline("see https://a.dev/x now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", href: "https://a.dev/x", children: [{ type: "text", value: "https://a.dev/x" }] },
      { type: "text", value: " now" },
    ]);
  });
});

describe("markdown blocks", () => {
  it("parses headings, lists, quotes, rules and paragraphs", () => {
    const blocks = parseMarkdown(
      ["# Title", "", "- one", "- two", "", "1. first", "", "> quoted", "", "---", "", "body"].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "list",
      "list",
      "quote",
      "hr",
      "paragraph",
    ]);
    const [h, ul, ol] = blocks;
    expect(h).toMatchObject({ type: "heading", level: 1 });
    expect(ul).toMatchObject({ type: "list", ordered: false });
    expect(ol).toMatchObject({ type: "list", ordered: true });
  });

  it("keeps fenced code verbatim, including markdown-looking lines", () => {
    const blocks = parseMarkdown("```rust\n# not a heading\nlet x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "code",
      value: "# not a heading\nlet x = 1;",
      lang: "rust",
    });
  });

  it("closes an unterminated fence at end of input", () => {
    expect(parseMarkdown("```\nabc")).toEqual([{ type: "code", value: "abc", lang: null }]);
  });

  it("joins wrapped paragraph lines with a space", () => {
    const blocks = parseMarkdown("one\ntwo");
    expect(blocks).toHaveLength(1);
    expect(toPlainText("one\ntwo")).toBe("one two");
  });

  it("never renders raw html as markup", () => {
    // The preview builds React nodes, so tags stay text — a task description
    // cannot inject elements.
    expect(toPlainText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("toPlainText", () => {
  it("flattens a document for row previews", () => {
    const md = "# 标题\n\n- a **b**\n- `c`\n\n> 引用";
    expect(toPlainText(md)).toBe("标题 a b c 引用");
  });
});
