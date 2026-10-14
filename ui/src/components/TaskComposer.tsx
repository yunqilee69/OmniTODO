import { CalendarOutlined, CloseOutlined, FlagOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, DatePicker, Dropdown, Input, type InputRef } from "antd";
import dayjs from "dayjs";
import { useRef, useState, type FocusEvent } from "react";
import type { Priority } from "../api/client";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { formatDue, fromDateInput, toDateInput } from "../lib/dates";
import { LIST_LEFT_INSET } from "../lib/layout";
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL } from "../lib/priority";
import { labelWidth } from "../lib/text";

/**
 * Inline "add a task" composer (design §13.1), the last row of a list panel so
 * the new task appears exactly where it will land.
 *
 * Closed it is the quiet `＋ 添加任务` line; opening it reveals the real box —
 * title, description and a footer of what the composer itself can set: priority,
 * the project the task lands in, and the due date. Enter files the task and the
 * box stays open and cleared, so a run of tasks can be typed without reopening
 * it; leaving it empty collapses it again.
 *
 * Tags, reminders and recurrence are deliberately not here: shorthand for those
 * lives in the floating quick-add panel (§8.12), and a third place to set the
 * same fields is a third place to keep in sync.
 */
export default function TaskComposer({
  projectId,
  projectName,
  projectColor,
}: {
  projectId: string;
  projectName?: string;
  projectColor?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [due, setDue] = useState<number | null>(null);
  const titleRef = useRef<InputRef>(null);
  const { create } = useTaskMutations();

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    const desc = description.trim();
    create.mutate(
      {
        title: text,
        description: desc || undefined,
        project_id: projectId,
        priority: priority === "none" ? undefined : priority,
        // The composer's chip sets a day, not an instant: file it all-day so
        // the date can't drift across timezones.
        due_at: due,
        all_day: due == null ? undefined : true,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setPriority("none");
          setDue(null);
          titleRef.current?.focus();
        },
      },
    );
  };

  const collapse = () => {
    setOpen(false);
    setTitle("");
    setDescription("");
    setPriority("none");
    setDue(null);
  };

  /** Leaving the box entirely with nothing typed closes it again; moving
   *  between the fields inside it must not. */
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!title.trim() && !description.trim()) collapse();
  };

  const onKeyDown = (e: { key: string }) => {
    if (e.key === "Escape") collapse();
  };

  if (!open) {
    return (
      // The "+" sits in the checkbox column, so the row lines up with the
      // titles above it — and the row spans the list's rule, from the checkbox
      // column to the panel's right edge, like every task row's hairline.
      <li style={{ paddingInlineStart: LIST_LEFT_INSET }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="composer-trigger flex w-full items-center gap-2 py-1.5 text-body"
          style={{ color: "var(--text-secondary)" }}
        >
          <PlusOutlined style={{ fontSize: 13, color: "var(--accent)" }} aria-hidden="true" />
          添加任务
        </button>
      </li>
    );
  }

  const dueLabel = due == null ? "日期" : formatDue(due, true);
  const flagged = priority !== "none";

  return (
    // The open box keeps the same measure as the rows above it — inset to the
    // checkbox column on the left, out to the panel's right edge — so adding a
    // task reads as one more line of the list rather than a floating form.
    <li className="py-2" style={{ paddingInlineStart: LIST_LEFT_INSET }}>
      <div
        className="composer-box rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 pb-1.5 pt-2"
        onBlur={onBlur}
      >
        <Input
          ref={titleRef}
          autoFocus
          variant="borderless"
          placeholder="任务名称"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={submit}
          onKeyDown={onKeyDown}
          style={{ paddingInline: 0, fontSize: 14 }}
        />
        <Input
          variant="borderless"
          placeholder="描述"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onPressEnter={submit}
          onKeyDown={onKeyDown}
          style={{ paddingInline: 0, fontSize: 12 }}
        />

        <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--border-hairline)] pt-1.5">
          <Dropdown
            trigger={["click"]}
            menu={{
              items: PRIORITIES.map((p) => ({
                key: p,
                label: PRIORITY_LABEL[p],
                icon:
                  p === "none" ? undefined : (
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ background: PRIORITY_COLOR[p] }}
                    />
                  ),
              })),
              selectable: true,
              selectedKeys: [priority],
              onClick: ({ key }) => setPriority(key as Priority),
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label={flagged ? `优先级：${PRIORITY_LABEL[priority]}` : "设置优先级"}
              style={{ padding: 0, width: 22, height: 22, minWidth: 22 }}
              icon={
                flagged ? (
                  <FlagOutlined style={{ color: PRIORITY_COLOR[priority] }} />
                ) : (
                  <PlusOutlined />
                )
              }
            />
          </Dropdown>

          {projectName && (
            <span
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-meta"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
            >
              <span style={{ color: projectColor ?? "var(--text-tertiary)" }} aria-hidden="true">
                #
              </span>
              {projectName}
            </span>
          )}

          <span
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-meta"
            style={{
              background: "var(--bg-hover)",
              color: due == null ? "var(--text-secondary)" : "var(--accent)",
            }}
          >
            <CalendarOutlined style={{ fontSize: 12 }} />
            <DatePicker
              size="small"
              variant="borderless"
              className="task-date"
              style={{ width: labelWidth(dueLabel) }}
              suffixIcon={null}
              placeholder="日期"
              value={due == null ? null : dayjs(toDateInput(due, true))}
              onChange={(d) => setDue(d ? (fromDateInput(d.format("YYYY-MM-DD"), true) ?? null) : null)}
              format={() => dueLabel}
            />
          </span>

          <Button
            type="text"
            size="small"
            aria-label="收起添加框"
            style={{ marginInlineStart: "auto" }}
            icon={<CloseOutlined />}
            onClick={collapse}
          />
        </div>
      </div>
    </li>
  );
}
