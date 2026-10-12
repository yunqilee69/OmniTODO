import { useMemo, type ReactNode } from "react";
import { Divider, Typography } from "antd";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown";

const { Title, Paragraph, Text, Link } = Typography;

/** Renders the parsed description as React nodes (never raw HTML), so a task
 *  description cannot inject markup (design §13.2: preview only, no editor).
 *  Uses antd `Typography` so styles follow the active theme tokens. */
export default function MarkdownPreview({
  source,
  className = "",
}: {
  source: string | null | undefined;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(source ?? ""), [source]);
  if (!source || !source.trim()) {
    return <Text type="secondary">暂无描述</Text>;
  }
  return <div className={className}>{blocks.map(renderBlock)}</div>;
}

function renderBlock(block: Block, i: number) {
  switch (block.type) {
    case "heading":
      return (
        <Title key={i} level={Math.min(block.level + 3, 5) as 3 | 4 | 5} style={{ marginTop: 8 }}>
          {renderInline(block.children)}
        </Title>
      );
    case "paragraph":
      return <Paragraph key={i}>{renderInline(block.children)}</Paragraph>;
    case "code":
      return (
        <pre
          key={i}
          data-lang={block.lang ?? undefined}
          style={{
            overflowX: "auto",
            padding: 8,
            borderRadius: 6,
            border: "1px solid var(--border-hairline)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <code>{block.value}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, k) => <li key={k}>{renderInline(item)}</li>);
      return block.ordered ? (
        <ol key={i} style={{ paddingInlineStart: 20 }}>
          {items}
        </ol>
      ) : (
        <ul key={i} style={{ paddingInlineStart: 20, listStyle: "disc" }}>
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <Paragraph
          key={i}
          style={{ borderInlineStart: "2px solid var(--border-hairline)", paddingInlineStart: 12 }}
        >
          {renderInline(block.children)}
        </Paragraph>
      );
    case "hr":
      return <Divider key={i} style={{ margin: "12px 0" }} />;
  }
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return <Text key={i} code>{node.value}</Text>;
      case "strong":
        return <Text key={i} strong>{renderInline(node.children)}</Text>;
      case "em":
        return <Text key={i} italic>{renderInline(node.children)}</Text>;
      case "strike":
        return <Text key={i} delete>{renderInline(node.children)}</Text>;
      case "link":
        return (
          <Link key={i} href={node.href} target="_blank" rel="noreferrer">
            {renderInline(node.children)}
          </Link>
        );
    }
  });
}
