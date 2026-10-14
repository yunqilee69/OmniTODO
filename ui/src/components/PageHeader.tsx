import { Flex, Typography } from "antd";
import type { ReactNode } from "react";

/** View header (DESIGN §7.1): title and inline count/meta at the left edge, the
 *  view's tools flush right.
 *
 *  The header deliberately does *not* share the list's centred measure: it spans
 *  the pane so the title and the tools pin to its two ends, while the rows below
 *  stay in the narrower centred column. */
export default function PageHeader({
  title,
  meta,
  tools,
}: {
  title: ReactNode;
  meta?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-hairline)" }}>
      <Flex align="baseline" gap={12} className="w-full">
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {meta && (
          <Typography.Text type="secondary" className="text-xs">
            {meta}
          </Typography.Text>
        )}
        {tools && <div style={{ marginInlineStart: "auto" }}>{tools}</div>}
      </Flex>
    </div>
  );
}
