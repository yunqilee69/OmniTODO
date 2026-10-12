import { Flex, Typography } from "antd";
import type { ReactNode } from "react";

/** View header (DESIGN §7.1): title, inline count/meta, right-aligned tools. */
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
    <Flex
      align="baseline"
      gap={12}
      style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-hairline)" }}
    >
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
  );
}
