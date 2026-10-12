import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, Checkbox, DatePicker, Dropdown, Tag, Tooltip, Typography } from "antd";
import {
  AlertOutlined,
  CaretRightOutlined,
  PaperClipOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { Priority, TaskDto, TaskPatch } from "../api/client";
import {
  fromDateInput,
  fromDateTimeInput,
  isOverdue,
  toDateInput,
  toDateTimeInput,
} from "../lib/dates";
import { splitHighlight } from "../lib/highlight";

const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_LABEL: Record<Priority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};
/** Left-edge stripe colour per priority (DESIGN §3.3). */
const PRIORITY_COLOR: Record<Priority, string> = {
  none: "transparent",
  low: "var(--prio-low)",
  medium: "var(--prio-medium)",
  high: "var(--prio-high)",
  urgent: "var(--prio-urgent)",
};

export interface TaskRowProps {
  task: TaskDto;
  onOpen?: (id: string) => void;
  onToggle?: (task: TaskDto) => void;
  /** Inline edits commit through the same patch path as the detail panel. */
  onPatch?: (id: string, patch: TaskPatch) => void;
  /** Search term to highlight in the title. */
  highlight?: string;
  /** Drag handle slot, filled by the sortable wrapper. */
  handle?: ReactNode;
  /** Depth in a subtask tree, for indentation. */
  depth?: number;
  /** Subtask branch is showing (passed only when the list wires up expansion). */
  expanded?: boolean;
  /** Toggling is only offered when the list provides this. */
  onToggleExpand?: (id: string) => void;
  /** dnd-kit node ref / positioning, applied to the row element itself. */
  innerRef?: (el: HTMLLIElement | null) => void;
  style?: CSSProperties;
  className?: string;
  /** Staggered reveal on first paint (skipped for virtualized rows). */
  animateIn?: boolean;
  /** Render index, used only for the reveal delay. */
  index?: number;
}

/** One task line: priority stripe, quick-complete, inline priority/due editing
 *  (design §13.2). Full antd component set. */
export default function TaskRow({
  task,
  onOpen,
  onToggle,
  onPatch,
  highlight,
  handle,
  depth = 0,
  expanded = false,
  onToggleExpand,
  innerRef,
  style,
  className = "",
  animateIn = false,
  index = 0,
}: TaskRowProps) {
  const [dueOpen, setDueOpen] = useState(false);
  const done = task.status === "done" || task.status === "cancelled";
  const dueAt = task.due_at ?? task.start_at;
  const overdue = isOverdue(dueAt, task.status, task.all_day);

  const dpValue = dueAt == null ? null : dayjs(task.all_day ? toDateInput(dueAt, true) : toDateTimeInput(dueAt));

  const commitDue = (value: dayjs.Dayjs | null) => {
    setDueOpen(false);
    if (!onPatch) return;
    if (!value) {
      onPatch(task.id, { clear_due_at: true });
      return;
    }
    const s = task.all_day ? value.format("YYYY-MM-DD") : value.format("YYYY-MM-DDTHH:mm");
    const ms = task.all_day ? fromDateInput(s, true) : fromDateTimeInput(s);
    if (ms !== null) onPatch(task.id, { due_at: ms });
  };

  const priorityMenu = {
    items: PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p] })),
    onClick: (info: { key: string }) => onPatch?.(task.id, { priority: info.key as Priority }),
  };

  return (
    <li
      ref={innerRef}
      style={{
        paddingLeft: `${12 + depth * 16}px`,
        animationDelay: animateIn ? `${Math.min(index, 8) * 24}ms` : undefined,
        ...style,
      }}
      className={`group relative flex items-center gap-2 py-1 pr-3 hover:bg-black/[0.03] ${className}`}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: PRIORITY_COLOR[task.priority] }}
        aria-hidden="true"
      />
      {handle}

      {/* Expand handle (design §13.2). The slot is always reserved so titles
          stay aligned whether or not a row has subtasks. */}
      <span className="flex w-4 shrink-0 items-center justify-center">
        {task.has_subtasks && onToggleExpand && (
          <Button
            type="text"
            size="small"
            style={{ padding: 0, width: 16, height: 16, minWidth: 16 }}
            aria-label={expanded ? `收起 ${task.title} 的子任务` : `展开 ${task.title} 的子任务`}
            aria-expanded={expanded}
            onClick={() => onToggleExpand(task.id)}
            icon={
              <CaretRightOutlined
                style={{
                  fontSize: 10,
                  transform: expanded ? "rotate(90deg)" : undefined,
                }}
              />
            }
          />
        )}
      </span>

      <Checkbox
        checked={done}
        onChange={() => onToggle?.(task)}
        aria-label={`完成 ${task.title}`}
      />

      <Typography.Text
        delete={done}
        ellipsis
        title={task.title}
        onClick={() => onOpen?.(task.id)}
        style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
      >
        {highlight ? highlightNodes(task.title, highlight) : task.title}
      </Typography.Text>

      {task.tags.map((tag) => (
        <Tag
          key={tag}
          className="hidden md:inline-flex"
          style={{
            marginInlineEnd: 0,
            background: "var(--accent-soft)",
            color: "var(--accent-ink)",
            border: "none",
          }}
        >
          {tag}
        </Tag>
      ))}

      <span className="flex shrink-0 items-center gap-1.5 text-xs opacity-55">
        {task.has_attachments && (
          <Tooltip title="有附件">
            <PaperClipOutlined />
          </Tooltip>
        )}
        {task.recurrence_rule && (
          <Tooltip title={task.recurrence_rule}>
            <SyncOutlined />
          </Tooltip>
        )}
      </span>

      {/* Inline priority (DESIGN §8.5) */}
      <Dropdown menu={priorityMenu} trigger={["click"]} disabled={!onPatch}>
        <Button
          type="text"
          size="small"
          aria-label={`优先级：${PRIORITY_LABEL[task.priority]}`}
          className={task.priority === "none" ? "opacity-0 group-hover:opacity-100" : ""}
          icon={
            <span
              className="inline-block size-2 rounded-full"
              style={
                task.priority === "none"
                  ? { boxShadow: "inset 0 0 0 1.5px var(--border-hairline)" }
                  : { background: PRIORITY_COLOR[task.priority] }
              }
            />
          }
        />
      </Dropdown>

      {/* Inline due date (DESIGN §8.6) */}
      <span
        className="flex shrink-0 items-center gap-1"
        style={overdue ? { color: "var(--prio-urgent)" } : undefined}
      >
        {overdue && (
          <Tooltip title="已逾期">
            <AlertOutlined />
          </Tooltip>
        )}
        <DatePicker
          size="small"
          variant="borderless"
          className={dueAt == null ? "opacity-0 group-hover:opacity-100" : ""}
          style={{ width: task.all_day ? 104 : 152 }}
          placeholder="＋日期"
          value={dpValue}
          showTime={!task.all_day}
          open={dueOpen}
          onOpenChange={(o) => setDueOpen(o)}
          onChange={(v) => commitDue(v)}
          disabled={!onPatch}
          format={task.all_day ? "M月D日" : "M月D日 HH:mm"}
        />
      </span>
    </li>
  );
}

function highlightNodes(text: string, term: string): ReactNode {
  return splitHighlight(text, term).map((seg, i) =>
    seg.match ? (
      <mark
        key={i}
        style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", padding: "0 2px" }}
      >
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}
