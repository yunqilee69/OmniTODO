import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Tag } from "antd";
import { CheckOutlined, PlusOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import { api, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";

/**
 * Tag selector for the detail panel (design §13.2).
 *
 * `task_update` replaces the whole tag set, so this always sends the complete
 * selection; the backend creates any missing tag by name. New tags are added
 * inline: the "+" sits after the existing tags and opens a narrow input that
 * commits on Enter or on leaving the field.
 */
export default function TagPicker({
  task,
  onPatch,
}: {
  task: TaskDto;
  onPatch: (patch: TaskPatch) => void;
}) {
  const qc = useQueryClient();
  const { data: tags } = useQuery({ queryKey: qk.tags, queryFn: () => api.tagList() });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // Guards against onPressEnter and the following blur both committing.
  const doneRef = useRef(false);

  const selected = new Set(task.tags);
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onPatch({ tag_names: [...next] });
  };

  const openInput = () => {
    doneRef.current = false;
    setAdding(true);
  };

  const closeInput = () => {
    doneRef.current = true;
    setAdding(false);
    setDraft("");
  };

  const commitDraft = () => {
    if (doneRef.current) return;
    const name = draft.trim().replace(/^#/, "");
    closeInput();
    if (!name || selected.has(name)) return;
    onPatch({ tag_names: [...selected, name] });
    qc.invalidateQueries({ queryKey: qk.tags });
  };

  // Known tags first; unknown ones that appear only on this task are kept.
  const known = new Set((tags ?? []).map((t) => t.name));
  const extra = task.tags.filter((t) => !known.has(t));
  const all = [...(tags ?? []).map((t) => t.name), ...extra];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {all.length === 0 && !adding && <span className="text-xs opacity-60">还没有标签</span>}
      {all.map((name) => {
        const on = selected.has(name);
        return (
          <Tag
            key={name}
            onClick={() => toggle(name)}
            className="cursor-pointer select-none"
            style={
              on
                ? { background: "var(--accent-soft)", color: "var(--accent-ink)", border: "none" }
                : { opacity: 0.85 }
            }
          >
            {on && <CheckOutlined className="mr-1" />}
            {name}
          </Tag>
        );
      })}
      {adding ? (
        <Input
          size="small"
          autoFocus
          className="w-[110px]"
          placeholder="新标签"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={commitDraft}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeInput();
          }}
        />
      ) : (
        <Button
          type="text"
          size="small"
          aria-label="新建标签"
          className="!h-6 !px-1.5 opacity-70"
          icon={<PlusOutlined />}
          onClick={openInput}
        />
      )}
    </div>
  );
}
