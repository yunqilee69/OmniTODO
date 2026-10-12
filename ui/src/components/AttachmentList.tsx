import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Alert, Button, Popconfirm, Switch, Typography } from "antd";
import { FileOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { api, type StorageKind, type TaskDto } from "../api/client";
import { qk } from "../api/queryKeys";

const attachmentKey = (taskId: string) => ["attachments", taskId] as const;

/**
 * Attachments for a task (design §5.6 / §13.2).
 *
 * Default storage is a BLOB inside the DB; switching to "managed" keeps the file
 * under `<data_dir>/.omnitodo/attachments` content-addressed by sha256. Files can
 * be picked or dropped onto the panel.
 */
export default function AttachmentList({ task }: { task: TaskDto }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<StorageKind>("blob");
  const [notice, setNotice] = useState<string | null>(null);

  const { data: attachments } = useQuery({
    queryKey: attachmentKey(task.id),
    queryFn: () => api.attachmentList(task.id),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: attachmentKey(task.id) });
    qc.invalidateQueries({ queryKey: qk.taskAll });
    qc.invalidateQueries({ queryKey: qk.tasksAll });
  };

  const add = useMutation({
    mutationFn: (path: string) =>
      kind === "blob"
        ? api.attachmentAddBlob(task.id, path)
        : api.attachmentAddManaged(task.id, path),
    onSuccess: refresh,
    // Oversized files (8 MB default for BLOBs) surface the backend's message.
    onError: (e) => setNotice(String(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.attachmentRemove(id),
    onSettled: refresh,
  });

  // Tauri delivers OS file drops at the webview level, not per element.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    // `getCurrentWebview()` reads `__TAURI_INTERNALS__` synchronously and throws
    // outside Tauri, so the guard has to wrap the setup rather than chain a
    // `.catch` onto it.
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          for (const path of event.payload.paths) add.mutate(path);
        })
        .then((un) => {
          if (cancelled) un();
          else dispose = un;
        })
        .catch(() => {
          /* not running inside Tauri (e.g. browser dev) */
        });
    } catch {
      /* not running inside Tauri (e.g. browser dev) */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [add, kind, task.id]);

  const pick = async () => {
    setNotice(null);
    const picked = await open({ multiple: false, title: "选择附件" });
    if (typeof picked === "string") add.mutate(picked);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" icon={<UploadOutlined />} onClick={() => void pick()}>
          添加附件
        </Button>
        <Typography.Text type="secondary" className="text-[11px]">
          或把文件拖到窗口里
        </Typography.Text>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] opacity-70">
          <Switch
            size="small"
            checked={kind === "managed"}
            onChange={(v) => setKind(v ? "managed" : "blob")}
          />
          存为托管文件
        </span>
      </div>

      {notice && <Alert type="warning" showIcon message={notice} />}

      <ul className="flex flex-col gap-1">
        {(attachments ?? []).length === 0 && (
          <li className="text-xs opacity-60">暂无附件</li>
        )}
        {(attachments ?? []).map((a) => (
          <li key={a.id} className="group flex items-center gap-2 text-small">
            <FileOutlined className="opacity-60" />
            <Typography.Link
              className="min-w-0 flex-1 truncate text-left"
              title={a.rel_path ?? a.file_name}
              onClick={() => void api.attachmentOpen(a.id)}
            >
              {a.file_name}
            </Typography.Link>
            <span className="tabular font-mono-ui text-[11px] opacity-60">
              {formatSize(a.size_bytes)} · {a.storage_kind === "blob" ? "库内" : "托管"}
            </span>
            <Popconfirm
              title="删除该附件？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => remove.mutate(a.id)}
            >
              <Button
                type="text"
                size="small"
                danger
                className="opacity-0 group-hover:opacity-100"
                aria-label={`删除 ${a.file_name}`}
                icon={<span aria-hidden>×</span>}
              />
            </Popconfirm>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
