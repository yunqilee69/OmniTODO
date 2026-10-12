import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type Priority, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import { toDateInput, toDateTimeInput, fromDateInput, fromDateTimeInput } from "../lib/dates";
import { useTaskMutations } from "../hooks/useTaskMutations";
import AttachmentList from "./AttachmentList";
import MarkdownPreview from "./MarkdownPreview";
import RecurrenceEditor from "./RecurrenceEditor";
import TagPicker from "./TagPicker";
import TaskRow from "./TaskRow";

const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_LABEL: Record<Priority, string> = {
  none: "无",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

/** Task detail panel (design §13.2): description + preview, subtasks, tags,
 *  attachments and the recurrence rule — all editing the same core commands. */
export default function TaskDetail({
  taskId,
  onClose,
  onOpenTask,
}: {
  taskId: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { patch, toggle, remove, move } = useTaskMutations();
  const [desc, setDesc] = useState<string | null>(null);
  const [subtask, setSubtask] = useState("");
  const [previewDesc, setPreviewDesc] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.taskGet(taskId),
  });
  const { data: subtasks } = useQuery({
    queryKey: ["subtasks", taskId],
    queryFn: () => api.taskListSubtasks(taskId),
  });
  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });

  const addSubtask = useMutation({
    mutationFn: (title: string) => api.taskAddSubtask(taskId, { title }),
    onSuccess: () => {
      setSubtask("");
      qc.invalidateQueries({ queryKey: ["subtasks", taskId] });
      qc.invalidateQueries({ queryKey: qk.tasksAll });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });

  if (isLoading || !task) {
    return <Panel onClose={onClose}><p className="text-sm text-neutral-500">加载中…</p></Panel>;
  }

  const commit = (p: TaskPatch) => patch.mutate({ id: task.id, patch: p });
  const description = desc ?? task.description ?? "";
  const dirtyDesc = desc !== null && desc !== (task.description ?? "");

  const dateValue = (ms: number | null) =>
    ms == null ? "" : task.all_day ? toDateInput(ms, true) : toDateTimeInput(ms);

  const commitDate = (field: "due_at" | "start_at", value: string) => {
    const parsed = value === "" ? null : task.all_day ? fromDateInput(value, true) : fromDateTimeInput(value);
    if (parsed === null) {
      commit(field === "due_at" ? { clear_due_at: true } : { clear_start_at: true });
    } else {
      commit({ [field]: parsed } as TaskPatch);
    }
  };

  return (
    <Panel onClose={onClose}>
      <div className="space-y-4">
        <input
          className="w-full rounded border border-transparent px-1 py-0.5 text-lg font-semibold hover:border-neutral-200 focus:border-neutral-400 focus:outline-none"
          defaultValue={task.title}
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== task.title) commit({ title });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggle.mutate(task)}
            />
            已完成
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-600">
            优先级
            <select
              className="rounded border border-neutral-300 px-1 py-0.5"
              value={task.priority}
              onChange={(e) => commit({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ml-auto text-xs text-neutral-400 hover:text-red-600"
            onClick={() => {
              remove.mutate(task.id);
              onClose();
            }}
          >
            删除
          </button>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <Field label="开始">
            <input
              type={task.all_day ? "date" : "datetime-local"}
              className="w-full rounded border border-neutral-300 px-1 py-0.5"
              value={dateValue(task.start_at)}
              onChange={(e) => commitDate("start_at", e.target.value)}
            />
          </Field>
          <Field label="截止">
            <input
              type={task.all_day ? "date" : "datetime-local"}
              className="w-full rounded border border-neutral-300 px-1 py-0.5"
              value={dateValue(task.due_at)}
              onChange={(e) => commitDate("due_at", e.target.value)}
            />
          </Field>
          <Field label="全天">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={task.all_day}
                onChange={(e) => commit({ all_day: e.target.checked })}
              />
              <span className="text-neutral-500">按日期存储（无时区换算）</span>
            </label>
          </Field>
          <Field label="项目">
            <select
              className="w-full rounded border border-neutral-300 px-1 py-0.5"
              value={task.project_id ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "") move.mutate({ id: task.id, projectId: null });
                else move.mutate({ id: task.id, projectId: value });
              }}
            >
              <option value="">收件箱</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Description with preview */}
        <section>
          <header className="mb-1 flex items-center gap-2">
            <h3 className="text-sm font-medium">描述</h3>
            <button
              type="button"
              className="text-xs text-neutral-500 hover:underline"
              onClick={() => setPreviewDesc((v) => !v)}
            >
              {previewDesc ? "编辑" : "预览"}
            </button>
            {dirtyDesc && (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => {
                  commit({ description: desc ?? "" });
                  setDesc(null);
                }}
              >
                保存
              </button>
            )}
          </header>
          {previewDesc ? (
            <div className="rounded border border-neutral-200 p-2">
              <MarkdownPreview source={description} />
            </div>
          ) : (
            <textarea
              className="h-32 w-full rounded border border-neutral-300 p-2 text-sm"
              placeholder="支持 Markdown，可切换到预览"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => {
                if (dirtyDesc) {
                  commit({ description: desc ?? "" });
                  setDesc(null);
                }
              }}
            />
          )}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-medium">重复</h3>
          <RecurrenceEditor task={task} onPatch={commit} />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-medium">标签</h3>
          <TagPicker task={task} onPatch={commit} />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-medium">附件</h3>
          <AttachmentList task={task} />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-medium">
            子任务 {subtasks && subtasks.length > 0 ? `(${subtasks.length})` : ""}
          </h3>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200">
            {(subtasks ?? []).map((s) => (
              <SubtaskRow key={s.id} task={s} onOpen={onOpenTask} />
            ))}
            {(subtasks ?? []).length === 0 && (
              <li className="px-3 py-2 text-xs text-neutral-400">暂无子任务</li>
            )}
          </ul>
          <input
            className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="添加子任务，回车确认"
            value={subtask}
            onChange={(e) => setSubtask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && subtask.trim()) addSubtask.mutate(subtask.trim());
            }}
          />
        </section>

        <footer className="border-t border-neutral-100 pt-2 text-[11px] text-neutral-400">
          创建 {new Date(task.created_at).toLocaleString()} · 更新{" "}
          {new Date(task.updated_at).toLocaleString()} · v{task.version}
        </footer>
      </div>
    </Panel>
  );
}

function SubtaskRow({ task, onOpen }: { task: TaskDto; onOpen: (id: string) => void }) {
  const { toggle, patch } = useTaskMutations();
  return (
    <TaskRow
      task={task}
      onOpen={onOpen}
      onToggle={(t) => toggle.mutate(t)}
      onPatch={(id, p) => patch.mutate({ id, patch: p })}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function Panel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-auto border-l border-neutral-200 bg-white p-4">
      <button
        type="button"
        className="mb-2 self-end text-xs text-neutral-400 hover:text-neutral-700"
        onClick={onClose}
        aria-label="关闭详情"
      >
        关闭 ✕
      </button>
      {children}
    </aside>
  );
}
