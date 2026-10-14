import {
  BellOutlined,
  CalendarOutlined,
  CloseOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  FlagOutlined,
  FolderOutlined,
  PlusOutlined,
  SyncOutlined,
  TagOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select, Tag, Tooltip, type InputRef } from "antd";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import { useUiStore } from "../stores/ui";

const NEW_PROJECT = "__new__";

/**
 * The shorthand fields the `+` menu teaches (design §12.1). Each row inserts its
 * token at the caret, so the menu doubles as the syntax reference — the token
 * (e.g. `!高`) is shown on the right, per the design brief.
 */
const FIELDS: { key: string; label: string; token: string; example: string; icon: ReactNode }[] = [
  { key: "desc", label: "描述", token: "::", example: "::说明", icon: <FileTextOutlined /> },
  { key: "project", label: "项目", token: "#", example: "#项目", icon: <FolderOutlined /> },
  { key: "due", label: "截止时间", token: "^", example: "^明天", icon: <CalendarOutlined /> },
  { key: "start", label: "开始时间", token: ">", example: ">下周一", icon: <FieldTimeOutlined /> },
  { key: "tag", label: "标签", token: "@", example: "@工作", icon: <TagOutlined /> },
  { key: "priority", label: "优先级", token: "!", example: "!高", icon: <FlagOutlined /> },
  { key: "remind", label: "提醒", token: "~", example: "~30m", icon: <BellOutlined /> },
  { key: "recurrence", label: "重复", token: "*", example: "*每周", icon: <SyncOutlined /> },
];

/** Where the floating panel sits: centred on the window and biased towards the
 *  top, so it stays clear of the list beneath it. Centring uses `left/right: 0`
 *  + `marginInline: auto` instead of a `translateX(-50%)` transform, because the
 *  entry animation animates `transform` and would cancel the offset for its
 *  140ms, making the panel jump sideways on every open. */
const PANEL_STYLE: CSSProperties = {
  position: "fixed",
  top: 90,
  left: 0,
  right: 0,
  marginInline: "auto",
  width: "min(648px, calc(100vw - 32px))",
  zIndex: 1000,
};

/**
 * Floating quick-add panel (design §12 / §13.2). One line of shorthand; `+`
 * opens the field menu, `×` closes, Enter files the task. Replaces the old
 * full-page `/quickadd` route.
 */
export default function QuickAddPanel() {
  const open = useUiStore((s) => s.quickAddOpen);
  const closeQuickAdd = useUiStore((s) => s.closeQuickAdd);
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputRef>(null);
  const qc = useQueryClient();

  const { data: draft } = useQuery({
    queryKey: ["quickadd", text],
    queryFn: () => api.quickaddParse(text),
    enabled: open && text.trim().length > 0,
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
      qc.invalidateQueries({ queryKey: qk.tasksAll });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: qk.reportAll });
      reset();
    },
  });

  const reset = () => {
    setText("");
    setProjectId("");
    setMenuOpen(false);
    commit.reset();
    closeQuickAdd();
  };

  useEffect(() => {
    if (!open) return;
    // Fresh panel each time it opens, caret ready in the field.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Click anywhere outside dismisses (no scrim — the reference keeps the page
  // visible behind the panel). All values `reset` closes over are stable, so the
  // single `open` dependency keeps the listener from churning every keystroke.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) reset();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const insertToken = useCallback(
    (token: string) => {
      const el = inputRef.current?.input;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? start;
      setText(text.slice(0, start) + token + text.slice(end));
      setMenuOpen(false);
      const caret = start + token.length;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.input?.setSelectionRange(caret, caret);
      });
    },
    [text],
  );

  const submit = () => {
    if (draft && draft.title && !draft.needs_project_choice) commit.mutate();
  };

  if (!open) return null;

  const chips: string[] = [];
  if (draft?.priority && draft.priority !== "none") chips.push(`!${draft.priority}`);
  if (draft?.project_name) chips.push(`#${draft.project_name}`);
  for (const t of draft?.tag_names ?? []) chips.push(`@${t}`);
  if (draft?.start_at) chips.push(`>${new Date(draft.start_at).toLocaleString()}`);
  if (draft?.due_at) chips.push(`^${new Date(draft.due_at).toLocaleString()}`);
  if (draft?.remind_offset_min) chips.push(`~${draft.remind_offset_min}m`);
  if (draft?.recurrence_rule) chips.push(`*${draft.recurrence_rule}`);

  return (
    <div
      ref={panelRef}
      style={PANEL_STYLE}
      className="quick-add-pop rounded-[14px] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-e3"
      role="dialog"
      aria-label="快速添加任务"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Tooltip title="更多字段">
          <Button
            type="text"
            size="small"
            aria-label="更多字段"
            aria-expanded={menuOpen}
            icon={<PlusOutlined />}
            onClick={() => setMenuOpen((v) => !v)}
          />
        </Tooltip>
        <Input
          ref={inputRef}
          variant="borderless"
          placeholder="任务名称"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={submit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (menuOpen) setMenuOpen(false);
              else reset();
            }
          }}
        />
        <Tooltip title="关闭">
          <Button
            type="text"
            size="small"
            aria-label="关闭"
            icon={<CloseOutlined />}
            onClick={reset}
          />
        </Tooltip>
      </div>

      {menuOpen && (
        <div className="absolute left-2 top-[52px] w-[300px] overflow-hidden rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1 shadow-e2">
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-tertiary)]">
            简写字段
          </div>
          {FIELDS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => insertToken(f.token)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <span className="text-[var(--text-tertiary)]">{f.icon}</span>
              <span>{f.label}</span>
              <span className="font-mono-ui tabular ml-auto text-[12px] text-[var(--text-tertiary)]">
                {f.example}
              </span>
            </button>
          ))}
        </div>
      )}

      {(chips.length > 0 || draft?.needs_project_choice || commit.isError) && (
        <div className="flex flex-col gap-2 border-t border-[var(--border-hairline)] px-3 py-2">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Tag key={c} className="font-mono-ui" style={{ marginInlineEnd: 0 }}>
                  {c}
                </Tag>
              ))}
              {draft?.title && (
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
          )}

          {draft?.needs_project_choice && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[12px] text-[var(--text-secondary)]">
                项目「{draft.project_name}」没有精确匹配
              </span>
              <Select
                size="small"
                className="min-w-0 flex-1"
                value={projectId}
                onChange={setProjectId}
                placeholder="选择项目"
                options={[
                  { value: "", label: "不归入项目（进收件箱）" },
                  ...draft.project_candidates.map((p) => ({ value: p.id, label: p.name })),
                  { value: NEW_PROJECT, label: `新建项目「${draft.project_name}」` },
                ]}
              />
            </div>
          )}

          {commit.isError && (
            <span className="text-[12px] text-[var(--state-danger)]">{String(commit.error)}</span>
          )}
        </div>
      )}

      {chips.length === 0 && !draft?.needs_project_choice && (
        <div className="border-t border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-tertiary)]">
          简写：<span className="font-mono-ui">!优先级</span>{" "}
          <span className="font-mono-ui">@标签</span> <span className="font-mono-ui">#项目</span>{" "}
          <span className="font-mono-ui">^截止</span> · 回车添加 · Esc 关闭
        </div>
      )}
    </div>
  );
}
