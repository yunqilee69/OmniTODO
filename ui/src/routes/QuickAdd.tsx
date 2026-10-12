import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Select, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { api } from "../api/client";
import PageHeader from "../components/PageHeader";

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
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title="快速添加" />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto w-full max-w-2xl">
          <Input
            autoFocus
            size="large"
            placeholder="写周报 !高 @工作 #OmniTODO ^明天 ~30m"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={() => {
              if (draft && !draft.needs_project_choice) commit.mutate();
            }}
          />

          {draft ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <Tag key={c} className="font-mono-ui" style={{ marginInlineEnd: 0 }}>
                    {c}
                  </Tag>
                ))}
                {draft.title && (
                  <Tag
                    style={{
                      marginInlineEnd: 0,
                      background: "var(--accent-soft)",
                      color: "var(--accent-ink)",
                      border: "none",
                    }}
                  >
                    标题：{draft.title}
                  </Tag>
                )}
              </div>

              {draft.needs_project_choice && (
                <Alert
                  type="warning"
                  showIcon
                  message={`项目「${draft.project_name}」没有精确匹配，请选择`}
                  description={
                    <Select
                      style={{ width: "100%", marginTop: 8 }}
                      value={projectId}
                      onChange={setProjectId}
                      options={[
                        { value: "", label: "不归入项目（进收件箱）" },
                        ...draft.project_candidates.map((p) => ({ value: p.id, label: p.name })),
                        { value: NEW_PROJECT, label: `新建项目「${draft.project_name}」` },
                      ]}
                    />
                  }
                />
              )}

              <Space>
                <Button
                  type="primary"
                  disabled={commit.isPending || !draft.title}
                  onClick={() => commit.mutate()}
                >
                  添加
                </Button>
                {commit.isError && (
                  <Typography.Text type="danger">{String(commit.error)}</Typography.Text>
                )}
              </Space>
            </div>
          ) : (
            <Typography.Text type="secondary" className="mt-4 block text-xs">
              支持简写：<code>!优先级</code> · <code>@标签</code> · <code>#项目</code> ·{" "}
              <code>^时间</code> · <code>~提醒</code> · <code>::描述</code>
            </Typography.Text>
          )}
        </div>
      </div>
    </section>
  );
}
