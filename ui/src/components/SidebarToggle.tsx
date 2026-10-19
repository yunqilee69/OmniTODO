import { Button, Tooltip } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useUiStore } from "../stores/ui";

/**
 * One half of the rail's collapse toggle (design §7.1).
 *
 * The two halves never coexist: `collapse` sits at the right end of the sidebar's
 * wordmark row, `expand` at the left edge of the current view's header. Whichever
 * one is unreachable is unmounted rather than merely hidden — a button inside a
 * zero-width rail is still focusable, and a focus ring the user cannot see is
 * worse than no button at all.
 */
export default function SidebarToggle({ variant }: { variant: "collapse" | "expand" }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  // Only the direction that leads somewhere is rendered.
  const available = variant === "collapse" ? !collapsed : collapsed;
  if (!available) return null;

  const label = variant === "collapse" ? "收起侧边栏" : "展开侧边栏";

  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="small"
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        icon={variant === "collapse" ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
        onClick={() => toggleSidebar()}
      />
    </Tooltip>
  );
}
