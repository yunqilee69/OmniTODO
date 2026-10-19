import { useState, type CSSProperties, type ReactNode } from "react";
import { Button, Checkbox, DatePicker, Dropdown, Tag, Tooltip, Typography, type MenuProps } from "antd";
import {
  AlertOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CaretRightOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  MoreOutlined,
  PaperClipOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import type { Priority, TaskDto, TaskPatch } from "../api/client";
import {
  formatDue,
  fromDateInput,
  fromDateTimeInput,
  isOverdue,
  isToday,
  toDateInput,
  toDateTimeInput,
} from "../lib/dates";
import { splitHighlight } from "../lib/highlight";
import { rowPaddingLeft, rowRuleInset } from "../lib/layout";
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_RING } from "../lib/priority";
import { labelWidth } from "../lib/text";

/** Menu keys for the "优先级" submenu; the value follows the colon. */
const PRIORITY_KEY = "priority:";

export interface TaskRowProps {
  task: TaskDto;
  onOpen?: (id: string) => void;
  onToggle?: (task: TaskDto) => void;
  /** Inline edits commit through the same patch path as the detail panel. */
  onPatch?: (id: string, patch: TaskPatch) => void;
  /** Removes the task (the row's "⋯" menu confirms first). */
  onDelete?: (task: TaskDto) => void;
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
  /** Reserve the two lead gutters — the drag handle slot and the subtask caret
   *  slot — and the left inset they sit in. Off for the detail panel's
   *  checklist: neither is ever offered there, and with the gutters gone the
   *  rows line up with the section's other fields instead of hanging off a
   *  checkbox column of their own. */
  gutters?: boolean;
  /** dnd-kit node ref / positioning, applied to the row element itself. */
  innerRef?: (el: HTMLLIElement | null) => void;
  style?: CSSProperties;
  className?: string;
  /** Staggered reveal on first paint (skipped for virtualized rows). */
  animateIn?: boolean;
  /** Render index, used only for the reveal delay. */
  index?: number;
  /** Set by the windowed list so the virtualizer can measure the real height. */
  dataIndex?: number;
  /** Extra `data-*` attributes for the row element, published by the sortable
   *  wrapper so the drag layer can read the visible list back off the DOM
   *  (`lib/visibleRows.ts`). */
  domAttrs?: Record<string, string>;
  /** Which project the task came from, for a list that spans projects (§13.1).
   *  Drawn as the project's colour dot plus its name in the row's meta line —
   *  the same dot the rail shows beside the project. Left off inside a project
   *  view, where every row answers the same question, and on subtasks: a branch
   *  belongs to its parent's project, so it is stated once at the root. */
  project?: { name: string; color: string | null } | null;
}

/**
 * One task line (DESIGN §8.3) — the view's core component.
 *
 * Layout is `[handle?] [caret | handle] [checkbox] [title / description /
 * date · subtask progress] [tags · badges · ⋯]`. The handle floats in on hover
 * and sits against the checkbox; a row with subtasks moves it one slot left and
 * puts the always-visible caret beside the checkbox instead. Priority reads off
 * the checkbox ring (§8.4) rather than a stripe, so the row's left edge stays a
 * single clean rule; the trailing controls are quiet meta that fades in on
 * hover, so a row reads as a title first and a drawer of actions second. Both
 * gutters are reserved whether or not they hold anything, which keeps every
 * title on the same left edge.
 */
export default function TaskRow({
  task,
  onOpen,
  onToggle,
  onPatch,
  onDelete,
  highlight,
  handle,
  depth = 0,
  expanded = false,
  onToggleExpand,
  gutters = true,
  innerRef,
  style,
  className = "",
  animateIn = false,
  index = 0,
  dataIndex,
  domAttrs,
  project,
}: TaskRowProps) {
  const [dueOpen, setDueOpen] = useState(false);
  const done = task.status === "done" || task.status === "cancelled";
  const dueAt = task.due_at ?? task.start_at;
  const overdue = isOverdue(dueAt, task.status, task.all_day);

  const dpValue = dueAt == null ? null : dayjs(task.all_day ? toDateInput(dueAt, true) : toDateTimeInput(dueAt));
  const dueLabel = dueAt == null ? "＋日期" : formatDue(dueAt, task.all_day);

  /** Only two dates earn colour (DESIGN §6.3): late is red, today is the accent
   *  that marks "now" everywhere else. Everything else stays quiet meta. */
  const dueInk = overdue
    ? "var(--state-overdue)"
    : dueAt != null && isToday(dueAt, task.all_day)
      ? "var(--accent)"
      : "var(--text-tertiary)";

  const priorityItem = (p: Priority) => ({
    key: `${PRIORITY_KEY}${p}`,
    label: PRIORITY_LABEL[p],
    disabled: !onPatch,
    icon:
      p === task.priority ? (
        <CheckOutlined />
      ) : p === "none" ? undefined : (
        <span
          className="inline-block size-2 rounded-full"
          style={{ background: PRIORITY_COLOR[p] }}
        />
      ),
  });

  const moreMenu: MenuProps = {
    items: [
      { key: "open", icon: <EditOutlined />, label: "打开详情" },
      {
        key: "priority",
        icon: <FlagOutlined />,
        label: "优先级",
        children: PRIORITIES.map(priorityItem),
      },
      ...(onDelete
        ? [{ key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true }]
        : []),
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "open") onOpen?.(task.id);
      else if (key.startsWith(PRIORITY_KEY)) {
        onPatch?.(task.id, { priority: key.slice(PRIORITY_KEY.length) as Priority });
      } else if (key === "delete") onDelete?.(task);
    },
  };

  /** The picker's input shows a relative label. An all-day task stores a civil
   *  date (UTC midnight), so re-anchor it before formatting — reading the local
   *  dayjs value directly would shift the day in timezones east of UTC. */
  const formatLabel = (d: dayjs.Dayjs): string =>
    task.all_day
      ? formatDue(fromDateInput(d.format("YYYY-MM-DD"), true) ?? d.valueOf(), true)
      : formatDue(d.valueOf(), false);

  const commitDue = (value: dayjs.Dayjs | null) => {
    if (!onPatch) return;
    if (!value) {
      onPatch(task.id, { clear_due_at: true });
      return;
    }
    const s = task.all_day ? value.format("YYYY-MM-DD") : value.format("YYYY-MM-DDTHH:mm");
    const ms = task.all_day ? fromDateInput(s, true) : fromDateTimeInput(s);
    if (ms !== null) onPatch(task.id, { due_at: ms });
  };

  const dueChip = (
    <span
      className={`flex shrink-0 items-center gap-1 ${dueAt == null ? "row-action" : ""}`}
      style={{ color: dueInk }}
    >
      {overdue ? (
        <Tooltip title="已逾期">
          <AlertOutlined style={{ fontSize: 12 }} />
        </Tooltip>
      ) : (
        <CalendarOutlined style={{ fontSize: 12 }} />
      )}
      <DatePicker
        size="small"
        variant="borderless"
        className="task-date"
        style={{ width: labelWidth(dueLabel) }}
        suffixIcon={null}
        placeholder="＋日期"
        value={dpValue}
        showTime={!task.all_day}
        open={dueOpen}
        onOpenChange={(o) => setDueOpen(o)}
        onChange={(v) => commitDue(v)}
        disabled={!onPatch}
        format={formatLabel}
      />
    </span>
  );

  return (
    <li
      ref={innerRef}
      data-index={dataIndex}
      {...domAttrs}
      style={{
        paddingLeft: gutters ? `${rowPaddingLeft(depth)}px` : 0,
        // Read by the shared `.task-panel` rule that draws the hairline above
        // this row (see index.css).
        "--rule-inset": gutters ? `${rowRuleInset(depth)}px` : "0px",
        animationDelay: animateIn ? `${Math.min(index, 8) * 24}ms` : undefined,
        // The checkbox ring is the row's only priority channel (§8.4); the
        // custom property lets the shared CSS rule read the per-row hue.
        "--checkbox-ring": PRIORITY_RING[task.priority],
        ...style,
      } as CSSProperties}
      className={`task-row group relative flex items-start gap-2 py-1.5 pr-3 ${className}`}
    >
      {/* Two gutters sit left of the checkbox, and both are always reserved so
          the checkbox (and every title) keeps one left edge across rows. The
          slot next to the checkbox holds the caret when the row has a branch
          (always visible — §8.3: the arrow is a hint, not hover chrome);
          otherwise it holds the drag handle, which is hover-revealed. A row
          with a caret pushes the handle one slot further left. */}
      {gutters && (
        <>
          <span className="flex h-[1.5em] w-4 shrink-0 items-center justify-center">
            {task.has_subtasks && onToggleExpand ? handle : null}
          </span>
          <span className="flex h-[1.5em] w-4 shrink-0 items-center justify-center">
            {task.has_subtasks && onToggleExpand ? (
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
                      color: "var(--text-tertiary)",
                      transform: expanded ? "rotate(90deg)" : undefined,
                    }}
                  />
                }
              />
            ) : (
              handle
            )}
          </span>
        </>
      )}

      <span className="flex h-[1.5em] shrink-0 items-center">
        <Checkbox
          checked={done}
          onChange={() => onToggle?.(task)}
          aria-label={`完成 ${task.title}`}
        />
      </span>

      <div className="min-w-0 flex-1">
        <Typography.Text
          delete={done}
          ellipsis={{ tooltip: task.title }}
          onClick={() => onOpen?.(task.id)}
          className="task-title block"
          style={{
            cursor: "pointer",
            color: done ? "var(--text-disabled)" : undefined,
          }}
        >
          {highlight ? highlightNodes(task.title, highlight) : task.title}
        </Typography.Text>
        {/* Priority is carried by the checkbox ring's colour, which a screen
            reader cannot see — the same fact is repeated as text here. */}
        <span className="sr-only">优先级：{PRIORITY_LABEL[task.priority]}</span>

        {task.description && (
          <div
            className="mt-0.5 truncate text-meta"
            style={{ color: "var(--text-tertiary)" }}
            title={task.description}
          >
            {task.description}
          </div>
        )}

        {(project || dueAt != null || task.subtask_total > 0) && (
          <div className="mt-0.5 flex items-center gap-3 text-meta leading-none">
            {project && <ProjectChip project={project} />}
            {dueAt != null && dueChip}
            {task.subtask_total > 0 && (
              <SubtaskProgress done={task.subtask_done} total={task.subtask_total} />
            )}
          </div>
        )}
      </div>

      {task.tags.map((tag) => (
        <Tag
          key={tag}
          className="hidden shrink-0 md:inline-flex"
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

      <span className="flex h-[1.5em] shrink-0 items-center gap-1.5 text-xs opacity-55">
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

      {/* Trailing actions. The row's own meta — date, subtask roll-up — lives
          under the title (§8.6), so all that is left here is the hover-revealed
          "＋日期" for a task that has none, and the "⋯" menu. */}
      <span className="flex h-[1.5em] shrink-0 items-center gap-1">
        {dueAt == null && dueChip}

        <Dropdown menu={moreMenu} trigger={["click"]}>
          <Button
            type="text"
            size="small"
            aria-label={`更多操作：${task.title}（优先级：${PRIORITY_LABEL[task.priority]}）`}
            className="row-action"
            style={{ padding: 0, width: 18, height: 18, minWidth: 18 }}
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </span>
    </li>
  );
}

/**
 * Which project a row belongs to (DESIGN §13.1), for the views that cut across
 * projects — Inbox, Today, a tag, search.
 *
 * The dot carries the project's colour, the same one the rail shows and the
 * calendar block is drawn in, so a list of mixed projects reads by colour first
 * and by name second. Quiet: tertiary ink, no chip background, sits in the meta
 * line beside the date. A project with no colour yet keeps the neutral hairline
 * dot rather than inventing one.
 */
function ProjectChip({ project }: { project: { name: string; color: string | null } }) {
  return (
    <span className="flex min-w-0 items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: project.color ?? "var(--border-hairline)" }}
        aria-hidden="true"
      />
      <span className="truncate" style={{ maxWidth: "12em" }} title={project.name}>
        {project.name}
      </span>
    </span>
  );
}

/**
 * Branch roll-up for a row that has children (DESIGN §8.3): how much of the
 * subtree behind the caret is ticked. Quiet by design — a branch glyph plus
 * `done/total`, sitting under the title like the description line, so a parent
 * row still reads as a title first. It only takes the done colour once the
 * whole branch is finished.
 */
function SubtaskProgress({ done, total }: { done: number; total: number }) {
  const complete = done >= total;
  return (
    <span
      className="flex items-center gap-1 text-meta leading-none"
      style={{ color: complete ? "var(--state-done)" : "var(--text-tertiary)" }}
      aria-label={`子任务完成 ${done} / ${total}`}
    >
      <BranchesOutlined style={{ fontSize: 12 }} aria-hidden="true" />
      <span className="tabular">
        {done}/{total}
      </span>
    </span>
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
