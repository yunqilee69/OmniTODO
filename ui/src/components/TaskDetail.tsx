import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Priority, type TaskDto, type TaskPatch } from "../api/client";
import { qk } from "../api/queryKeys";
import {
  fromDateInput,
  fromDateTimeInput,
  toDateInput,
  toDateTimeInput,
} from "../lib/dates";
import { useTaskMutations } from "../hooks/useTaskMutations";
import { PRIORITY_OPTIONS } from "../lib/priority";
import AttachmentList from "./AttachmentList";
import MarkdownPreview from "./MarkdownPreview";
import RecurrenceEditor from "./RecurrenceEditor";
import TagPicker from "./TagPicker";
import TaskComposer from "./TaskComposer";
import TaskRow from "./TaskRow";

/** Task detail dialog (design §13.2): description + preview, subtasks, tags,
 *  attachments and the recurrence rule — all editing the same core commands.
 *
 *  A centred modal rather than a side drawer: the panel is a form read top to
 *  bottom, and centring it keeps it on the same axis as the list it was opened
 *  from instead of hanging off the window's right edge. */
export default function TaskDetail({
  taskId,
  onClose,
  onOpenTask,
}: {
  taskId: string | null;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const { patch, toggle, remove, move } = useTaskMutations();
  const [desc, setDesc] = useState<string | null>(null);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [previewDesc, setPreviewDesc] = useState(false);

  const { data: task, isLoading } = useQuery({
    queryKey: qk.task(taskId ?? ""),
    queryFn: () => api.taskGet(taskId!),
    enabled: Boolean(taskId),
  });
  const { data: subtasks } = useQuery({
    queryKey: qk.subtasks(taskId ?? ""),
    queryFn: () => api.taskListSubtasks(taskId!),
    enabled: Boolean(taskId),
  });
  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });
  // Sections belong to a project, so the picker only has anything to offer once
  // the task is filed in one — and a subtask has no column of its own (§5.9).
  const sectionProjectId = task?.project_id ?? "";
  const { data: sections } = useQuery({
    queryKey: qk.sections(sectionProjectId),
    queryFn: () => api.sectionList(sectionProjectId),
    enabled: Boolean(sectionProjectId),
  });
  const sectionOptions = useMemo(
    () => [
      { value: "", label: "无板块" },
      ...(sections ?? []).map((s) => ({ value: s.id, label: s.name })),
    ],
    [sections],
  );

  // New task selected → drop the stale description draft and close the add-subtask box.
  useEffect(() => {
    setDesc(null);
    setPreviewDesc(false);
    setAddingSubtask(false);
  }, [taskId]);

  const commit = (p: TaskPatch) => task && patch.mutate({ id: task.id, patch: p });

  const dateValue = (ms: number | null) =>
    ms == null ? null : dayjs(task!.all_day ? toDateInput(ms, true) : toDateTimeInput(ms));

  const commitDate = (field: "due_at" | "start_at", value: dayjs.Dayjs | null) => {
    if (!value) {
      commit(field === "due_at" ? { clear_due_at: true } : { clear_start_at: true });
      return;
    }
    const s = task!.all_day ? value.format("YYYY-MM-DD") : value.format("YYYY-MM-DDTHH:mm");
    const parsed = task!.all_day ? fromDateInput(s, true) : fromDateTimeInput(s);
    if (parsed !== null) commit({ [field]: parsed } as TaskPatch);
  };

  const description = desc ?? task?.description ?? "";
  const dirtyDesc = desc !== null && desc !== (task?.description ?? "");

  return (
    <Modal
      open={Boolean(taskId)}
      onCancel={onClose}
      title="任务详情"
      footer={null}
      centered
      width={560}
      destroyOnHidden
      // The form is longer than the window on a short screen; scroll the body
      // and keep the title bar put.
      styles={{ body: { maxHeight: "68vh", overflowY: "auto", paddingTop: 12 } }}
    >
      {isLoading || !task ? (
        <Skeleton active />
      ) : (
        <div className="flex flex-col gap-5">
          <Input
            key={task.id}
            size="large"
            variant="borderless"
            defaultValue={task.title}
            aria-label="任务标题"
            style={{ paddingInline: 0, fontWeight: 600 }}
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title && title !== task.title) commit({ title });
            }}
            onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              checked={task.status === "done"}
              onChange={() => toggle.mutate(task)}
              aria-label="标记已完成"
            >
              已完成
            </Checkbox>
            <span className="flex items-center gap-1.5 text-xs opacity-70">
              优先级
              <Select
                size="small"
                style={{ width: 84 }}
                value={task.priority}
                onChange={(v) => commit({ priority: v as Priority })}
                options={PRIORITY_OPTIONS}
              />
            </span>
            <Popconfirm
              title="删除该任务？"
              description="可在数据库中恢复（软删除）。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => {
                remove.mutate(task.id);
                onClose();
              }}
            >
              <Button danger type="text" size="small" className="ml-auto" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="开始">
              <DatePicker
                style={{ width: "100%" }}
                value={dateValue(task.start_at)}
                showTime={!task.all_day}
                onChange={(v) => commitDate("start_at", v)}
                format={task.all_day ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm"}
              />
            </Field>
            <Field label="截止">
              <DatePicker
                style={{ width: "100%" }}
                value={dateValue(task.due_at)}
                showTime={!task.all_day}
                onChange={(v) => commitDate("due_at", v)}
                format={task.all_day ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm"}
              />
            </Field>
            <Field label="项目">
              <Select
                style={{ width: "100%" }}
                value={task.project_id ?? ""}
                onChange={(v) => move.mutate({ id: task.id, projectId: v === "" ? null : v })}
                options={[
                  { value: "", label: "收件箱" },
                  ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            <Field label="板块">
              {/* Disabled rather than hidden for a subtask: the field exists and
                  the reason it is closed is worth seeing. The core clears the
                  section when a task gains a parent, so an empty box here is the
                  truth, not a missing value. */}
              <Select
                style={{ width: "100%" }}
                value={task.section_id ?? ""}
                disabled={!task.project_id || Boolean(task.parent_id)}
                placeholder={task.project_id ? "无板块" : "收件箱中的任务没有板块"}
                onChange={(v) =>
                  commit(v === "" ? { clear_section_id: true } : { section_id: v })
                }
                options={
                  task.parent_id
                    ? [{ value: "", label: "子任务跟随父任务" }]
                    : sectionOptions
                }
              />
            </Field>
            <Field label="全天">
              <Switch
                size="small"
                checked={task.all_day}
                onChange={(v) => commit({ all_day: v })}
              />
            </Field>
          </div>

          <Section
            title="描述"
            extra={
              <>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => setPreviewDesc((v) => !v)}
                >
                  {previewDesc ? "编辑" : "预览"}
                </Button>
                {dirtyDesc && (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      commit({ description: desc ?? "" });
                      setDesc(null);
                    }}
                  >
                    保存
                  </Button>
                )}
              </>
            }
          >
            {previewDesc ? (
              <div className="rounded-md border border-[var(--border-hairline)] p-3">
                <MarkdownPreview source={description} />
              </div>
            ) : (
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 12 }}
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
          </Section>

          <Section title="重复">
            <RecurrenceEditor task={task} onPatch={commit} />
          </Section>

          <Section title="标签">
            <TagPicker task={task} onPatch={commit} />
          </Section>

          <Section title="附件">
            <AttachmentList task={task} />
          </Section>

          <Section
            title={`子任务${subtasks && subtasks.length > 0 ? `（${subtasks.length}）` : ""}`}
            extra={
              !addingSubtask && (
                <Tooltip title="添加子任务">
                  <Button
                    type="text"
                    size="small"
                    aria-label="添加子任务"
                    icon={<PlusOutlined />}
                    onClick={() => setAddingSubtask(true)}
                  />
                </Tooltip>
              )
            }
          >
            {/* The box that opens is `TaskComposer` — the same one every view
                adds tasks with. The `＋` above is this section's own affordance,
                so the composer draws no add row of its own, and it is not inset
                to the list's checkbox column: the section title already says
                these are subtasks, and the inset would leave it narrower than
                every other field in this form. */}
            <ul className="divide-y divide-[var(--border-hairline)]">
              {(subtasks ?? []).map((s) => (
                <SubtaskRow key={s.id} task={s} onOpen={onOpenTask} />
              ))}
              {(subtasks ?? []).length === 0 && (
                <li className="py-2 text-xs opacity-60">暂无子任务</li>
              )}
              {addingSubtask && (
                <TaskComposer
                  projectId={task.project_id ?? ""}
                  projectName={(projects ?? []).find((p) => p.id === task.project_id)?.name}
                  projectColor={(projects ?? []).find((p) => p.id === task.project_id)?.color}
                  parentId={task.id}
                  noun="子任务"
                  inset={false}
                  showTrigger={false}
                  onClose={() => setAddingSubtask(false)}
                />
              )}
            </ul>
          </Section>

          <Typography.Text
            type="secondary"
            className="tabular font-mono-ui text-[11px]"
            style={{ borderTop: "1px solid var(--border-hairline)", paddingTop: 12 }}
          >
            创建 {new Date(task.created_at).toLocaleString()} · 更新{" "}
            {new Date(task.updated_at).toLocaleString()} · v{task.version}
          </Typography.Text>
        </div>
      )}
    </Modal>
  );
}

function SubtaskRow({ task, onOpen }: { task: TaskDto; onOpen: (id: string) => void }) {
  const { toggle, patch } = useTaskMutations();
  return (
    <TaskRow
      task={task}
      // No drag handle and no caret are offered in here, so the row drops the
      // two gutters that reserve room for them and starts at the section's left
      // edge, in line with the add box below and the rest of the form.
      gutters={false}
      onOpen={onOpen}
      onToggle={(t) => toggle.mutate(t)}
      onPatch={(id, p) => patch.mutate({ id, patch: p })}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] opacity-60">{label}</div>
      {children}
    </div>
  );
}

function Section({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <Typography.Text strong className="text-small">
          {title}
        </Typography.Text>
        {extra && <div className="ml-auto flex items-center gap-1">{extra}</div>}
      </div>
      {children}
    </section>
  );
}
