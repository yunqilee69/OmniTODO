import { useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "../lib/markdown";

/** Renders the parsed description as React nodes (never raw HTML), so a task
 *  description cannot inject markup (design §13.2: preview only, no editor). */
export default function MarkdownPreview({
  source,
  className = "",
}: {
  source: string | null | undefined;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(source ?? ""), [source]);
  if (!source || !source.trim()) {
    return <p className="text-sm text-neutral-400">暂无描述</p>;
  }
  return <div className={`space-y-2 text-sm ${className}`}>{blocks.map(renderBlock)}</div>;
}

function renderBlock(block: Block, i: number) {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${Math.min(block.level + 2, 6)}`) as "h3";
      return (
        <Tag key={i} className="font-semibold">
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={i}>{renderInline(block.children)}</p>;
    case "code":
      return (
        <pre
          key={i}
          className="overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-xs"
          data-lang={block.lang ?? undefined}
        >
          <code>{block.value}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, k) => <li key={k}>{renderInline(item)}</li>);
      return block.ordered ? (
        <ol key={i} className="list-decimal pl-5">
          {items}
        </ol>
      ) : (
        <ul key={i} className="list-disc pl-5">
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote key={i} className="border-l-2 border-neutral-300 pl-3 text-neutral-600">
          {renderInline(block.children)}
        </blockquote>
      );
    case "hr":
      return <hr key={i} className="border-neutral-200" />;
  }
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return (
          <code key={i} className="rounded bg-neutral-100 px-1 font-mono text-xs">
            {node.value}
          </code>
        );
      case "strong":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "strike":
        return <s key={i}>{renderInline(node.children)}</s>;
      case "link":
        return (
          <a key={i} className="text-blue-600 underline" href={node.href} target="_blank" rel="noreferrer">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}
