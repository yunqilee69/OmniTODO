import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";

/**
 * Tag selector for the detail panel (design §13.2).
 *
 * `task_update` replaces the whole tag set, so this always sends the complete
 * selection; the backend creates any missing tag by name.
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
  const [draft, setDraft] = useState("");

  const selected = new Set(task.tags);
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onPatch({ tag_names: [...next] });
  };

  const addByName = async () => {
    const name = draft.trim().replace(/^#/, "");
    if (!name) return;
    await api.tagCreate(name);
    onPatch({ tag_names: [...selected, name] });
    setDraft("");
    qc.invalidateQueries({ queryKey: qk.tags });
  };

  // Known tags first; unknown ones that appear only on this task are kept.
  const known = new Set((tags ?? []).map((t) => t.name));
  const extra = task.tags.filter((t) => !known.has(t));
  const all = [...(tags ?? []).map((t) => t.name), ...extra];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {all.length === 0 && <span className="text-xs text-neutral-400">还没有标签</span>}
        {all.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={`rounded px-2 py-0.5 text-xs ${
              selected.has(name)
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
            aria-pressed={selected.has(name)}
          >
            #{name}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
          placeholder="新建标签…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addByName();
            }
          }}
        />
        <button
          type="button"
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
          onClick={() => void addByName()}
        >
          添加
        </button>
      </div>
    </div>
  );
}
