import { useQuery } from "@tanstack/react-query";
import { Alert, Input, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { api, type TaskDto, type TaskPatch } from "../api/client";
import { formatDue } from "../lib/dates";

const DAY = 86_400_000;
const PRESETS: [string, string][] = [
  ["每天", "daily"],
  ["每周", "weekly"],
  ["每月", "monthly"],
  ["每年", "yearly"],
  ["工作日", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
];

/**
 * Recurrence rule editor (design §13.2 / §5.5).
 *
 * Accepts both the canonical form and the quick-add shorthand: the backend
 * normalises it and the resulting instants are previewed, so the user sees what
 * the rule actually means before saving. The series anchor is `due_at ?? start_at`.
 */
export default function RecurrenceEditor({
  task,
  onPatch,
}: {
  task: TaskDto;
  onPatch: (patch: TaskPatch) => void;
}) {
  const [text, setText] = useState(task.recurrence_rule ?? "");
  useEffect(() => setText(task.recurrence_rule ?? ""), [task.recurrence_rule]);

  const anchor = task.due_at ?? task.start_at;
  const trimmed = text.trim();

  // Canonicalise (also acts as validation: invalid rules error out).
  const canonical = useQuery({
    queryKey: ["recurrence", "canonical", trimmed],
    queryFn: () => api.recurrenceCanonical(trimmed),
    enabled: trimmed.length > 0,
    retry: false,
  });

  const rule = canonical.data ?? null;
  const preview = useQuery({
    queryKey: ["recurrence", "preview", rule, anchor],
    queryFn: () => api.recurrencePreview(rule!, anchor!, anchor!, anchor! + 90 * DAY),
    enabled: Boolean(rule) && anchor != null,
    retry: false,
  });

  const save = () => {
    if (!trimmed) {
      if (task.recurrence_rule) onPatch({ clear_recurrence: true });
      return;
    }
    if (!rule) return; // invalid: keep the text so the user can fix it
    if (rule !== task.recurrence_rule) onPatch({ recurrence_rule: rule });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([label, value]) => (
          <Tag key={value} className="cursor-pointer select-none" onClick={() => setText(value)}>
            {label}
          </Tag>
        ))}
        {task.recurrence_rule && (
          <Tag
            className="cursor-pointer select-none"
            onClick={() => {
              setText("");
              onPatch({ clear_recurrence: true });
            }}
          >
            清除
          </Tag>
        )}
      </div>

      <Input
        size="small"
        placeholder="例如 每周一,三,五 或 FREQ=WEEKLY;BYDAY=MO,WE"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onPressEnter={save}
      />

      {trimmed && canonical.isError && (
        <Alert type="error" showIcon message={`规则无法识别：${String(canonical.error)}`} />
      )}
      {rule && (
        <Typography.Text type="secondary" className="font-mono-ui text-[11px]">
          {rule}
        </Typography.Text>
      )}
      {anchor == null && rule && (
        <Alert type="warning" showIcon message="先设置截止或开始时间，才能计算期次。" />
      )}

      {preview.data && preview.data.length > 0 && (
        <Typography.Text type="secondary" className="text-[11px]">
          接下来 {preview.data.length} 期：
          {preview.data
            .slice(0, 5)
            .map((ms) => formatDue(ms, task.all_day))
            .join("、")}
          {preview.data.length > 5 ? " …" : ""}
        </Typography.Text>
      )}
    </div>
  );
}
