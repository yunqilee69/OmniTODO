import { Input, Typography } from "antd";
import { useState } from "react";
import type { SectionDto } from "../api/client";
import { sectionNameTaken } from "../lib/sections";

/** A mutable cell a dialog writes its answer into. antd renders `modal.confirm`'s
 *  content once and reads `onOk`'s return later, so a controlled value cannot
 *  live in the caller's state — the dialog hands it over through one of these. */
export interface Choice<T> {
  value: T;
}

/**
 * The body of the "new section" dialog.
 *
 * The name is checked as it is typed rather than on submit: names are unique per
 * project case-insensitively (the core enforces it), and finding that out by
 * having the dialog close and then fail is a worse way to learn it.
 */
export function SectionNameBody({
  choice,
  sections,
  exceptId,
}: {
  choice: Choice<string>;
  sections: readonly SectionDto[];
  /** Set when renaming, so a section does not clash with itself. */
  exceptId?: string;
}) {
  const [name, setName] = useState(choice.value);
  const taken = sectionNameTaken(name, sections, exceptId);
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={name}
        placeholder="板块名称"
        aria-label="板块名称"
        status={taken ? "error" : undefined}
        onChange={(e) => {
          choice.value = e.target.value;
          setName(e.target.value);
        }}
        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      />
      {taken && (
        <Typography.Text type="danger" className="text-meta">
          这个项目里已经有同名板块了
        </Typography.Text>
      )}
    </div>
  );
}

/**
 * The body of the delete-section dialog: which of the two deletes is meant.
 *
 * Both are real and they are not the same act, so the dialog spells the
 * consequence out rather than picking one silently. Defaults to the
 * non-destructive reading — releasing the tasks into "no section" — because the
 * other one throws work away in a single click.
 */
export function SectionDeleteBody({
  name,
  count,
  choice,
}: {
  name: string;
  count: number;
  choice: Choice<boolean>;
}) {
  const [deleteTasks, setDeleteTasks] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <span>
        {deleteTasks
          ? `「${name}」及其中的 ${count} 个任务都会被删除。`
          : `「${name}」会被删除，其中的 ${count} 个任务回到「无板块」。`}
      </span>
      <label
        className="flex items-center gap-2 text-meta"
        style={{ color: "var(--text-secondary)" }}
      >
        <input
          type="checkbox"
          checked={deleteTasks}
          onChange={(e) => {
            choice.value = e.target.checked;
            setDeleteTasks(e.target.checked);
          }}
          aria-label="同时删除板块中的任务"
        />
        同时删除其中的任务（Todoist 的行为）
      </label>
    </div>
  );
}
