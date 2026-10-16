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
 * The detail panel's checklist is the same list one level down, so it opens the
 * same box: `parentId` files the new task under that task instead of at the end
 * of a project, and `noun` renames it ("子任务"). There the affordance is the
 * section header's `＋`, so that caller passes `showTrigger={false}`, mounts the
 * composer only while it is open, and gets its `onClose` when the box collapses
 * — one box, one place to keep the two in step.
 *
 * Tags, reminders and recurrence are deliberately not here: shorthand for those
 * lives in the floating quick-add panel (§8.12), and a third place to set the
 * same fields is a third place to keep in sync.
 */
export default function TaskComposer({
  projectId,
  projectName,
  projectColor,
  parentId,
  sectionId,
  noun = "任务",
  inset = true,
  showTrigger = true,
  onClose,
}: {
  projectId: string;
  projectName?: string;
  projectColor?: string | null;
  /** Adds a child of this task. The core inherits the parent's project, so the
   *  new subtask lands in the same place as the task it was typed under. */
  parentId?: string;
  /** Files the new task into this section — the board column's composer, and the
   *  `＋` on a list section header. Ignored for a subtask (§5.9). */
  sectionId?: string;
  /** What is being added, in the trigger, the field placeholder and the labels. */
  noun?: string;
  /** Inset the row to the list's checkbox column so it reads as one more line of
   *  the list. Off for the checklist inside the detail panel: the section is
   *  already titled 子任务, and the inset would leave the box narrower than every
   *  other field in that form. */
  inset?: boolean;
  /** Draw the `＋ 添加${noun}` row that opens the box. Off when the caller owns
   *  the affordance (the checklist's `＋` in the section header) and mounts the
   *  composer only while it should be open. */
  showTrigger?: boolean;
  /** Called whenever the box collapses — the caller's cue to unmount it. */
  onClose?: () => void;
}) {
  const [selfOpen, setSelfOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [due, setDue] = useState<number | null>(null);
  const titleRef = useRef<InputRef>(null);
  const { create, addSubtask } = useTaskMutations();

  /** Without a trigger row there is nothing to open it, so the box is open by
   *  construction: the caller mounted it because it should be. */
  const open = showTrigger ? selfOpen : true;

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("none");
    setDue(null);
  };

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    const desc = description.trim();
    const input = {
      title: text,
      description: desc || undefined,
      priority: priority === "none" ? undefined : priority,
      // The composer's chip sets a day, not an instant: file it all-day so
      // the date can't drift across timezones.
      due_at: due,
      all_day: due == null ? undefined : true,
    };
    const keepTyping = () => {
      reset();
      titleRef.current?.focus();
    };
    if (parentId) addSubtask.mutate({ parentId, input }, { onSuccess: keepTyping });
    else
      create.mutate(
        { ...input, project_id: projectId, section_id: sectionId ?? null },
        { onSuccess: keepTyping },
      );
  };

  const collapse = () => {
    setSelfOpen(false);
    reset();
    onClose?.();
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
      <li style={{ paddingInlineStart: inset ? LIST_LEFT_INSET : 0 }}>
        <button
          type="button"
          onClick={() => setSelfOpen(true)}
          className="composer-trigger flex w-full items-center gap-2 py-1.5 text-body"
          style={{ color: "var(--text-secondary)" }}
        >
          <PlusOutlined style={{ fontSize: 13, color: "var(--accent)" }} aria-hidden="true" />
          添加{noun}
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
    <li className="py-2" style={{ paddingInlineStart: inset ? LIST_LEFT_INSET : 0 }}>
      <div
        className="composer-box rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 pb-1.5 pt-2"
        onBlur={onBlur}
      >
        <Input
          ref={titleRef}
          autoFocus
          variant="borderless"
          placeholder={`${noun}名称`}
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
