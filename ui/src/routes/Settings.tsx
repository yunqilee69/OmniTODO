import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, type ExportFormat, type ImportFormat, type TaskFilter } from "../api/client";
import { qk } from "../api/queryKeys";
import { useUiStore, type Theme } from "../stores/ui";

/** Settings (design §13.1): general, reminders/autostart, the MCP panel, data
 *  import/export, and about. Everything reads/writes the same settings rows the
 *  Rust side uses, so MCP and the CLI see identical state. */
export default function Settings() {
  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>
      <General />
      <Reminders />
      <McpPanel />
      <DataPanel />
      <About />
    </section>
  );
}

/** Small typed wrapper around `settings_get` / `settings_set`. */
function useSetting<T>(key: string, fallback: T) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", key],
    queryFn: async () => {
      const value = await api.settingsGet(key);
      return value == null ? fallback : (value as T);
    },
  });
  const set = useMutation({
    mutationFn: (value: T) => api.settingsSet(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", key] });
      qc.invalidateQueries({ queryKey: qk.mcp("httpState") });
    },
  });
  return { value: query.data ?? fallback, loaded: query.isSuccess, set: set.mutate };
}

function General() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { value: defaultProject, set: setDefaultProject } = useSetting<string>("ui.default_project_id", "");
  const { value: weekStart, set: setWeekStart } = useSetting<number>("ui.week_start", 1);
  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });

  // Paint the chosen theme on <html> so Tailwind's dark variants can react.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
  }, [theme]);

  return (
    <Card title="通用">
      <Row label="主题">
        <select
          className={selectClass}
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </Row>
      <Row label="默认项目">
        <select
          className={selectClass}
          value={defaultProject}
          onChange={(e) => setDefaultProject(e.target.value)}
        >
          <option value="">收件箱（不指定）</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">快捷添加未写 `#项目` 时的归属。</p>
      </Row>
      <Row label="周起始日">
        <select
          className={selectClass}
          value={weekStart}
          onChange={(e) => setWeekStart(Number(e.target.value))}
        >
          <option value={1}>周一</option>
          <option value={0}>周日</option>
          <option value={6}>周六</option>
        </select>
      </Row>
    </Card>
  );
}

function Reminders() {
  const [permission, setPermission] = useState<string>("unknown");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { value: enabled, set: setEnabled } = useSetting<boolean>("reminder.enabled", true);

  useEffect(() => {
    // Plugin APIs only exist inside the Tauri webview; guard for the browser.
    import("@tauri-apps/plugin-notification")
      .then(async (m) => setPermission((await m.isPermissionGranted()) ? "granted" : "denied"))
      .catch(() => setPermission("unavailable"));
    import("@tauri-apps/plugin-autostart")
      .then(async (m) => setAutostart(await m.isEnabled()))
      .catch(() => setAutostart(null));
  }, []);

  const requestPermission = async () => {
    try {
      const m = await import("@tauri-apps/plugin-notification");
      setPermission((await m.requestPermission()) === "granted" ? "granted" : "denied");
    } catch {
      setNote("当前环境不支持系统通知");
    }
  };

  const toggleAutostart = async () => {
    try {
      const m = await import("@tauri-apps/plugin-autostart");
      if (autostart) {
        await m.disable();
        setAutostart(false);
      } else {
        await m.enable();
        setAutostart(true);
      }
    } catch {
      setNote("当前环境不支持自启动设置");
    }
  };

  return (
    <Card title="提醒与自启动">
      <Row label="启用提醒">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-neutral-500">
            到点后弹出系统通知；重启后补发过去 24 小时的漏提醒为一条汇总。
            关闭只停通知与提醒卡片，重复任务仍会按期落库用于统计。
          </span>
        </label>
      </Row>
      <Row label="通知权限">
        <span className="text-sm text-neutral-600">
          {permission === "granted"
            ? "已授权"
            : permission === "denied"
              ? "未授权"
              : permission === "unavailable"
                ? "当前环境不可用（浏览器预览）"
                : "检测中…"}
        </span>
        {permission !== "granted" && permission !== "unavailable" && (
          <button className={btnClass} onClick={requestPermission}>
            请求授权
          </button>
        )}
      </Row>
      <Row label="开机自启动">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autostart ?? false}
            disabled={autostart === null}
            onChange={toggleAutostart}
          />
          <span className="text-neutral-500">
            {autostart === null ? "当前环境不可用" : "登录后后台常驻，保证提醒不丢"}
          </span>
        </label>
      </Row>
      {note && <p className="text-xs text-amber-600">{note}</p>}
    </Card>
  );
}

function McpPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.mcp("httpState"),
    queryFn: () => api.mcpStatus(),
  });
  const [port, setPort] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.mcp("httpState") });
    qc.invalidateQueries({ queryKey: qk.mcp("clients") });
  };
  const start = useMutation({
    mutationFn: () => api.mcpHttpStart(port ? Number(port) : undefined),
    onSettled: refresh,
  });
  const stop = useMutation({ mutationFn: () => api.mcpHttpStop(), onSettled: refresh });
  const toggleWrite = useMutation({
    mutationFn: (next: boolean) => api.settingsSet("mcp.write_enabled", next),
    onSettled: refresh,
  });

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };
  const copyClientConfig = async () => copy("客户端配置", await api.mcpCopyClientConfig());
  const copyControl = async () => {
    const c = await api.controlConfig();
    await copy(
      "控制端点",
      `POST http://127.0.0.1:${c.port}/internal/notify\nAuthorization: Bearer ${c.token}`,
    );
  };

  const running = data?.http.running ?? false;

  return (
    <Card title="MCP 集成">
      <div className="rounded border border-neutral-200 p-3">
        <header className="mb-1 flex items-center gap-2">
          <h3 className="text-sm font-medium">stdio</h3>
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] text-green-700">
            始终可用
          </span>
        </header>
        <p className="text-xs text-neutral-600">
          每个客户端各自拉起一个实例，无需开关；无需端口与 token。
        </p>
        <p className="mt-1 break-all font-mono text-xs text-neutral-500">
          {data?.stdio.bin_path ?? "…"}
        </p>
        <button className={btnClass} onClick={copyClientConfig}>
          复制客户端配置
        </button>
      </div>

      <div className="mt-3 rounded border border-neutral-200 p-3">
        <header className="mb-1 flex items-center gap-2">
          <h3 className="text-sm font-medium">HTTP</h3>
          <span
            className={`size-2.5 rounded-full ${running ? "bg-green-500" : "bg-neutral-300"}`}
            title={running ? "运行中" : "已停止"}
          />
          <span className="text-xs text-neutral-600">
            {running ? `运行中 · 127.0.0.1:${data?.http.port}` : "已停止"}
          </span>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder="端口（可选）"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            disabled={running}
          />
          <button className={btnClass} disabled={running} onClick={() => start.mutate()}>
            启用
          </button>
          <button
            className="rounded border border-neutral-300 px-3 py-1 text-sm"
            disabled={!running}
            onClick={() => stop.mutate()}
          >
            停止
          </button>
          <button className={btnClass} onClick={copyControl}>
            复制控制端点
          </button>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-neutral-500">
          token: {data?.http.token || "（未启动）"}
        </p>
      </div>

      <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={data?.write_enabled ?? false}
            onChange={(e) => toggleWrite.mutate(e.target.checked)}
          />
          <span>
            <span className="font-medium">允许 MCP 写入</span>
            <span className="block text-xs text-neutral-600">
              开启后 AI 客户端可创建/修改/删除任务与项目；所有写入都会记录到 `op_log`，
              可在数据库 `.omnitodo/omnitodo.db` 审计。关闭时 MCP 为只读。
            </span>
          </span>
        </label>
      </div>

      {copied && <p className="text-xs text-green-700">已复制：{copied}</p>}
    </Card>
  );
}

function DataPanel() {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ExportFormat>("json");
  const [status, setStatus] = useState<string | null>(null);
  const filter: TaskFilter = { sort: "createddesc", limit: 100000 };

  const doExport = async () => {
    const text = await api.exportRun(filter, format);
    await navigator.clipboard.writeText(text);
    const name = `omnitodo-export.${format}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`已导出并复制到剪贴板：${name}`);
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    const name = file.name.toLowerCase();
    const fmt: ImportFormat = name.endsWith(".json")
      ? "todoist"
      : name.endsWith(".txt")
        ? "todotxt"
        : "markdown";
    const n = await api.importRun(text, fmt);
    qc.invalidateQueries({ queryKey: qk.tasksAll });
    qc.invalidateQueries({ queryKey: qk.projects });
    setStatus(`已导入 ${n} 条任务（来源格式：${fmt}）`);
  };

  return (
    <Card title="数据">
      <Row label="导出">
        <select
          className={selectClass}
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
        >
          <option value="json">JSON（可再导入语义完整）</option>
          <option value="csv">CSV</option>
          <option value="md">Markdown</option>
        </select>
        <button className={btnClass} onClick={doExport}>
          导出并下载
        </button>
      </Row>
      <Row label="导入">
        <input
          type="file"
          accept=".md,.markdown,.txt,.json"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }}
        />
        <p className="mt-1 text-xs text-neutral-500">
          `.md` 走 Markdown 语法（`- [ ] 标题 #标签`）；`.txt` 走 todo.txt
          （`(A) 任务 @情境 +项目`）；`.json` 走 Todoist 导出（含项目、标签、优先级、日期与子任务）。
        </p>
      </Row>
      {status && <p className="text-xs text-green-700">{status}</p>}
    </Card>
  );
}

function About() {
  const version = useQuery({ queryKey: ["app", "version"], queryFn: () => api.appVersion() });
  const releases = useQuery({ queryKey: ["app", "releases"], queryFn: () => api.appReleasesUrl() });

  return (
    <Card title="关于">
      <Row label="版本">
        <span className="font-mono text-sm">{version.data ?? "…"}</span>
      </Row>
      <Row label="更新">
        <span className="text-sm text-neutral-600">
          v1 为手动更新：从{" "}
          <a className="text-blue-600 underline" href={releases.data ?? "#"} target="_blank" rel="noreferrer">
            GitHub Releases
          </a>{" "}
          下载对应平台的安装包覆盖安装。
        </span>
      </Row>
    </Card>
  );
}

const selectClass = "rounded border border-neutral-300 px-2 py-1 text-sm";
const btnClass = "ml-2 rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-40";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 font-medium">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="flex flex-wrap items-center">{children}</div>
    </div>
  );
}
