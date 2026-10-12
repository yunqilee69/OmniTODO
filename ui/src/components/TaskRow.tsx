import { useState, type CSSProperties, type ReactNode } from "react";
import type { Priority, TaskDto, TaskPatch } from "../api/client";
import { formatDue, fromDateInput, fromDateTimeInput, toDateInput, toDateTimeInput } from "../lib/dates";
import { splitHighlight } from "../lib/highlight";

const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_STYLE: Record<Priority, string> = {
  none: "bg-neutral-100 text-neutral-500",
  low: "bg-sky-100 text-sky-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};
const PRIORITY_LABEL: Record<Priority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
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
  /** dnd-kit node ref / positioning, applied to the row element itself. */
  innerRef?: (el: HTMLLIElement | null) => void;
  style?: CSSProperties;
  className?: string;
}

/** One task line: quick-complete, inline priority/due editing (design §13.2). */
export default function TaskRow({
  task,
  onOpen,
  onToggle,
  onPatch,
  highlight,
  handle,
  depth = 0,
  innerRef,
  style,
  className = "",
}: TaskRowProps) {
  const [editing, setEditing] = useState<"priority" | "due" | null>(null);
  const done = task.status === "done" || task.status === "cancelled";
  const dueAt = task.due_at ?? task.start_at;

  const commitDue = (value: string) => {
    setEditing(null);
    if (!onPatch) return;
    if (!value) {
      onPatch(task.id, { clear_due_at: true });
      return;
    }
    const ms = task.all_day ? fromDateInput(value, true) : fromDateTimeInput(value);
    if (ms !== null) onPatch(task.id, { due_at: ms });
  };

  return (
    <li
      ref={innerRef}
      style={{ paddingLeft: `${12 + depth * 16}px`, ...style }}
      className={`group flex items-center gap-2 py-2 pr-3 ${className}`}
    >
      {handle}
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle?.(task)}
        aria-label={`完成 ${task.title}`}
      />

      <button
        type="button"
        className={`min-w-0 flex-1 truncate text-left ${
          done ? "text-neutral-400 line-through" : ""
        }`}
        onClick={() => onOpen?.(task.id)}
        title={task.title}
      >
        {highlight ? highlightNodes(task.title, highlight) : task.title}
      </button>

      {task.tags.map((tag) => (
        <span key={tag} className="hidden shrink-0 text-xs text-neutral-500 sm:inline">
          #{tag}
        </span>
      ))}

      {task.has_attachments && (
        <span className="shrink-0 text-xs text-neutral-400" title="有附件">
          📎
        </span>
      )}
      {task.recurrence_rule && (
        <span className="shrink-0 text-xs text-neutral-400" title={task.recurrence_rule}>
          ↻
        </span>
      )}

      {/* Inline priority (design §13.2). */}
      {editing === "priority" && onPatch ? (
        <select
          autoFocus
          className="shrink-0 rounded border border-neutral-300 text-xs"
          value={task.priority}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            onPatch(task.id, { priority: e.target.value as Priority });
            setEditing(null);
          }}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          disabled={!onPatch}
          onClick={() => onPatch && setEditing("priority")}
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${PRIORITY_STYLE[task.priority]} ${
            task.priority === "none" ? "opacity-0 group-hover:opacity-100" : ""
          }`}
          title="优先级"
        >
          {PRIORITY_LABEL[task.priority]}
        </button>
      )}

      {/* Inline due date (design §13.2). */}
      {editing === "due" && onPatch ? (
        <input
          autoFocus
          type={task.all_day ? "date" : "datetime-local"}
          className="shrink-0 rounded border border-neutral-300 text-xs"
          defaultValue={
            dueAt == null ? "" : task.all_day ? toDateInput(dueAt, true) : toDateTimeInput(dueAt)
          }
          onBlur={(e) => commitDue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDue((e.target as HTMLInputElement).value);
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!onPatch}
          onClick={() => onPatch && setEditing("due")}
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500 ${
            dueAt == null ? "opacity-0 group-hover:opacity-100" : "bg-neutral-100"
          }`}
          title="截止时间"
        >
          {dueAt == null ? "＋日期" : formatDue(dueAt, task.all_day)}
        </button>
      )}
    </li>
  );
}

function highlightNodes(text: string, term: string): ReactNode {
  return splitHighlight(text, term).map((seg, i) =>
    seg.match ? (
      <mark key={i} className="rounded bg-amber-200 px-0.5">
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}
