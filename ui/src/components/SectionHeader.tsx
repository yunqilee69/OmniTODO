import { Button, Dropdown, Input, Tooltip, Typography, type InputRef, type MenuProps } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SectionDto } from "../api/client";
import { rowRuleInset } from "../lib/layout";

/**
 * A section's header line in the list view (design §5.9).
 *
 * Laid out to the same rhythm as a task row — same left edge, same hairline —
 * because a section is a row of this list that happens to name a group rather
 * than carry a task. What it adds over a task row is the caret (sections
 * collapse; tasks expand); what it drops is everything a task has that a divider
 * cannot: no checkbox, no due date, no priority.
 *
 * The "no section" group has no entity behind it, so it arrives as
 * `section === null` and gets a name and a count only — no rename, no delete, no
 * collapse, no move. Todoist renders the same bare header for its uncategorised
 * group.
 *
 * Reordering is a pair of menu items rather than a drag handle. Todoist drags
 * its list headers, but its drag layer is section-aware throughout; here the
 * app-level drag context is task-shaped, and a half-wired handle that silently
 * dropped a section somewhere would be worse than a control that says what it
 * does. The board is where sections are dragged.
 */
export default function SectionHeader({
  section,
  count,
  collapsed,
  onToggleCollapse,
  onRename,
  onDelete,
  onMove,
  onAddTask,
  innerRef,
  style,
  className = "",
  domAttrs,
}: {
  /** The section, or `null` for the leading "no section" group. */
  section: SectionDto | null;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Rename / delete / move are only offered for a real section. */
  onRename?: (name: string) => void;
  onDelete?: () => void;
  /** `-1` moves the section up, `+1` down. */
  onMove?: (delta: -1 | 1) => void;
  /** Opens the composer that files a new task into this group. */
  onAddTask: () => void;
  innerRef?: (el: HTMLLIElement | null) => void;
  style?: CSSProperties;
  className?: string;
  domAttrs?: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section?.name ?? "");
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const name = section?.name ?? "无板块";
  const named = section !== null;

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== section?.name) onRename?.(next);
    else setDraft(section?.name ?? "");
  };

  const menu: MenuProps = {
    items: [
      { key: "rename", icon: <EditOutlined />, label: "重命名板块" },
      { key: "up", icon: <ArrowUpOutlined />, label: "上移" },
      { key: "down", icon: <ArrowDownOutlined />, label: "下移" },
      { key: "delete", icon: <DeleteOutlined />, label: "删除板块", danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "rename") {
        setDraft(section?.name ?? "");
        setEditing(true);
      } else if (key === "up") onMove?.(-1);
      else if (key === "down") onMove?.(1);
      else if (key === "delete") onDelete?.();
    },
  };

  return (
    <li
      ref={innerRef}
      {...domAttrs}
      style={{ "--rule-inset": `${rowRuleInset(0)}px`, ...style } as CSSProperties}
      className={`task-row group relative flex items-center gap-2 py-1.5 pr-3 pl-3 ${className}`}
    >
      {/* Both lead gutters are reserved exactly as a task row reserves them, so
          the section name sits on the same left edge as the titles beneath it —
          and the caret lands in the slot a task row uses for its own caret. */}
      <span className="flex h-[1.5em] w-4 shrink-0 items-center justify-center" />
      <span className="flex h-[1.5em] w-4 shrink-0 items-center justify-center">
        {named && (
          <Button
            type="text"
            size="small"
            style={{ padding: 0, width: 16, height: 16, minWidth: 16 }}
            aria-label={collapsed ? `展开板块 ${name}` : `收起板块 ${name}`}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
            icon={
              <CaretRightOutlined
                style={{
                  fontSize: 10,
                  color: "var(--text-secondary)",
                  transform: collapsed ? undefined : "rotate(90deg)",
                }}
              />
            }
          />
        )}
      </span>

      {editing ? (
        <Input
          ref={inputRef}
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onPressEnter={commitRename}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label="板块名称"
          style={{ maxWidth: 260 }}
        />
      ) : (
        <Typography.Text
          strong
          className="text-small"
          style={{ cursor: named ? "text" : "default" }}
          onDoubleClick={() => named && setEditing(true)}
          title={named ? "双击重命名" : undefined}
        >
          {name}
        </Typography.Text>
      )}

      <span className="tabular text-meta" style={{ color: "var(--text-tertiary)" }}>
        {count}
      </span>

      <span className="ml-auto flex items-center gap-1">
        <Tooltip title={`在「${name}」中添加任务`}>
          <Button
            type="text"
            size="small"
            aria-label={`在板块 ${name} 中添加任务`}
            className="row-action"
            style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
            icon={<PlusOutlined />}
            onClick={onAddTask}
          />
        </Tooltip>
        {named && (
          <Dropdown menu={menu} trigger={["click"]}>
            <Button
              type="text"
              size="small"
              aria-label={`板块操作：${name}`}
              className="row-action"
              style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
              icon={<MoreOutlined />}
            />
          </Dropdown>
        )}
      </span>
    </li>
  );
}

/** The "add a section" row that closes a sectioned list. */
export function AddSectionRow({ onAdd }: { onAdd: () => void }) {
  return (
    <li
      style={{ "--rule-inset": `${rowRuleInset(0)}px` } as CSSProperties}
      className="relative"
    >
      <button
        type="button"
        onClick={onAdd}
        className="composer-trigger flex w-full items-center gap-2 py-1.5 text-body"
        style={{ color: "var(--text-secondary)", paddingInlineStart: rowRuleInset(0) }}
      >
        <PlusOutlined style={{ fontSize: 13, color: "var(--accent)" }} aria-hidden="true" />
        添加板块
      </button>
    </li>
  );
}
