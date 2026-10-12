import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <button
          type="button"
          className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
          onClick={() => void pick()}
        >
          添加附件
        </button>
        <span>或把文件拖到窗口里</span>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={kind === "managed"}
            onChange={(e) => setKind(e.target.checked ? "managed" : "blob")}
          />
          存为托管文件
        </label>
      </div>

      {notice && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{notice}</p>
      )}

      <ul className="space-y-1">
        {(attachments ?? []).length === 0 && (
          <li className="text-xs text-neutral-400">暂无附件</li>
        )}
        {(attachments ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-blue-600 underline"
              onClick={() => void api.attachmentOpen(a.id)}
              title={a.rel_path ?? a.file_name}
            >
              {a.file_name}
            </button>
            <span className="shrink-0 text-neutral-400">
              {formatSize(a.size_bytes)} · {a.storage_kind === "blob" ? "库内" : "托管"}
            </span>
            <button
              type="button"
              className="shrink-0 text-neutral-400 hover:text-red-600"
              onClick={() => remove.mutate(a.id)}
              aria-label={`删除 ${a.file_name}`}
            >
              ✕
            </button>
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
