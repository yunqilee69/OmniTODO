import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

const NEW_PROJECT = "__new__";

/** Quick-add window: type one line of shorthand, preview chips, confirm
 *  (design §12). `#project` ambiguity opens a picker instead of silently
 *  creating a project. */
export default function QuickAdd() {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const qc = useQueryClient();

  const { data: draft } = useQuery({
    queryKey: ["quickadd", text],
    queryFn: () => api.quickaddParse(text),
    enabled: text.trim().length > 0,
  });

  const commit = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("nothing to add");
      let project = projectId || undefined;
      if (projectId === NEW_PROJECT && draft.project_name) {
        const created = await api.projectCreate(draft.project_name);
        project = created.id;
      }
      return api.quickaddCommit(draft, project);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setText("");
      setProjectId("");
    },
  });

  const chips: string[] = [];
  if (draft?.priority && draft.priority !== "none") chips.push(`!${draft.priority}`);
  if (draft?.project_name) chips.push(`#${draft.project_name}`);
  for (const t of draft?.tag_names ?? []) chips.push(`@${t}`);
  if (draft?.due_at) chips.push(`^${new Date(draft.due_at).toLocaleString()}`);
  if (draft?.remind_offset_min) chips.push(`~${draft.remind_offset_min}m`);
  if (draft?.recurrence_rule) chips.push(`*${draft.recurrence_rule}`);

  return (
    <section className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">快速添加</h1>
      <input
        autoFocus
        className="w-full rounded border border-neutral-300 px-3 py-2"
        placeholder="写周报 !高 @工作 #OmniTODO ^明天 ~30m"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft && !draft.needs_project_choice) commit.mutate();
        }}
      />

      {draft && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {chips.map((c) => (
              <span key={c} className="rounded bg-neutral-100 px-2 py-0.5">
                {c}
              </span>
            ))}
            {draft.title && (
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
                标题：{draft.title}
              </span>
            )}
          </div>

          {draft.needs_project_choice && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="mb-2">项目「{draft.project_name}」没有精确匹配，请选择：</p>
              <select
                className="w-full rounded border border-neutral-300 px-2 py-1"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">不归入项目（进收件箱）</option>
                {draft.project_candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={NEW_PROJECT}>新建项目「{draft.project_name}」</option>
              </select>
            </div>
          )}

          <button
            className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={commit.isPending || !draft.title}
            onClick={() => commit.mutate()}
          >
            添加
          </button>
          {commit.isError && (
            <p className="text-sm text-red-600">{String(commit.error)}</p>
          )}
        </div>
      )}
    </section>
  );
}
