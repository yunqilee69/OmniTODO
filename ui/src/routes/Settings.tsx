import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  CopyOutlined,
  DownloadOutlined,
  ExportOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useEffect, useState, type ReactNode } from "react";
import { api, type ExportFormat, type ImportFormat, type TaskFilter } from "../api/client";
import { qk } from "../api/queryKeys";
import PageContent from "../components/PageContent";
import PageHeader from "../components/PageHeader";
import { useSetting } from "../hooks/useSetting";
import { persistTheme } from "../lib/theme";
import { useUiStore, type Theme } from "../stores/ui";

/** Settings (design §13.1): general, reminders/autostart, the MCP panel, data
 *  import/export, and about. Everything reads/writes the same settings rows the
 *  Rust side uses, so MCP and the CLI see identical state. */
export default function Settings() {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title="设置" />
      <PageContent>
        <Flex vertical gap={16}>
          <General />
          <Reminders />
          <McpPanel />
          <DataPanel />
          <About />
        </Flex>
      </PageContent>
    </section>
  );
}

/** Small typed wrapper around `settings_get` / `settings_set`. */
function General() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { value: defaultProject, set: setDefaultProject } = useSetting<string>("ui.default_project_id", "");
  const { value: weekStart, set: setWeekStart } = useSetting<number>("ui.week_start", 1);
  const { data: projects } = useQuery({ queryKey: qk.projects, queryFn: () => api.projectList() });

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    void persistTheme(next);
  };

  return (
    <Card title="通用">
      <Flex vertical gap={16}>
        <Row label="主题">
          <Segmented
            value={theme}
            onChange={(v) => chooseTheme(v as Theme)}
            options={[
              { label: "跟随系统", value: "system" },
              { label: "浅色", value: "light" },
              { label: "深色", value: "dark" },
            ]}
          />
        </Row>
        <Row label="默认项目" hint="快捷添加未写 `#项目` 时的归属。">
          <Select
            style={{ maxWidth: 280 }}
            value={defaultProject}
            onChange={(v) => setDefaultProject(v)}
            options={[
              { value: "", label: "收件箱（不指定）" },
              ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Row>
        <Row label="周起始日">
          <Select
            style={{ maxWidth: 280 }}
            value={weekStart}
            onChange={(v) => setWeekStart(v)}
            options={[
              { value: 1, label: "周一" },
              { value: 0, label: "周日" },
              { value: 6, label: "周六" },
            ]}
          />
        </Row>
      </Flex>
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

  const toggleAutostart = async (next: boolean) => {
    try {
      const m = await import("@tauri-apps/plugin-autostart");
      if (next) await m.enable();
      else await m.disable();
      setAutostart(next);
    } catch {
      setNote("当前环境不支持自启动设置");
    }
  };

  const permissionLabel =
    permission === "granted"
      ? "已授权"
      : permission === "denied"
        ? "未授权"
        : permission === "unavailable"
          ? "当前环境不可用（浏览器预览）"
          : "检测中…";

  return (
    <Card title="提醒与自启动">
      <Flex vertical gap={16}>
        <Row label="启用提醒">
          <Space direction="vertical" size={2}>
            <Switch checked={enabled} onChange={(v) => setEnabled(v)} />
            <Typography.Text type="secondary" className="text-[11px]">
              到点后弹出系统通知；重启后补发过去 24 小时的漏提醒为一条汇总。关闭只停通知与提醒卡片，重复任务仍会按期落库用于统计。
            </Typography.Text>
          </Space>
        </Row>
        <Row label="通知权限">
          <Space>
            <Typography.Text>{permissionLabel}</Typography.Text>
            {permission !== "granted" && permission !== "unavailable" && (
              <Button size="small" onClick={requestPermission}>
                请求授权
              </Button>
            )}
          </Space>
        </Row>
        <Row label="开机自启动">
          <Space direction="vertical" size={2}>
            <Switch
              checked={autostart ?? false}
              disabled={autostart === null}
              onChange={(v) => void toggleAutostart(v)}
            />
            <Typography.Text type="secondary" className="text-[11px]">
              {autostart === null ? "当前环境不可用" : "登录后后台常驻，保证提醒不丢"}
            </Typography.Text>
          </Space>
        </Row>
        {note && <Alert type="warning" showIcon message={note} />}
      </Flex>
    </Card>
  );
}

function McpPanel() {
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const { data } = useQuery({
    queryKey: qk.mcp("httpState"),
    queryFn: () => api.mcpStatus(),
  });
  const [port, setPort] = useState("");

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
    message.success(`已复制：${label}`);
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
      <Flex vertical gap={12}>
        <div className="rounded-md border border-[var(--border-hairline)] p-3">
          <Space align="center" className="mb-1">
            <Typography.Text strong>stdio</Typography.Text>
            <Tag color="success" style={{ marginInlineEnd: 0 }}>
              始终可用
            </Tag>
          </Space>
          <Typography.Paragraph type="secondary" className="text-xs">
            每个客户端各自拉起一个实例，无需开关；无需端口与 token。
          </Typography.Paragraph>
          <Typography.Text code className="break-all text-[11px]">
            {data?.stdio.bin_path ?? "…"}
          </Typography.Text>
          <div className="mt-2">
            <Button size="small" icon={<CopyOutlined />} onClick={copyClientConfig}>
              复制客户端配置
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-[var(--border-hairline)] p-3">
          <Space align="center" className="mb-1">
            <Typography.Text strong>HTTP</Typography.Text>
            <Tag color={running ? "success" : "default"} style={{ marginInlineEnd: 0 }}>
              {running ? `运行中 · 127.0.0.1:${data?.http.port}` : "已停止"}
            </Tag>
          </Space>
          <Space wrap>
            <Input
              size="small"
              style={{ width: 120 }}
              placeholder="端口（可选）"
              value={port}
              disabled={running}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="primary" size="small" disabled={running} onClick={() => start.mutate()}>
              启用
            </Button>
            <Button size="small" disabled={!running} onClick={() => stop.mutate()}>
              停止
            </Button>
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyControl}>
              复制控制端点
            </Button>
          </Space>
          <Typography.Text code className="mt-2 block break-all text-[11px]">
            token: {data?.http.token || "（未启动）"}
          </Typography.Text>
        </div>

        <Space direction="vertical" size={2}>
          <Space>
            <Switch
              checked={data?.write_enabled ?? false}
              onChange={(v) => toggleWrite.mutate(v)}
            />
            <Typography.Text strong>允许 MCP 写入</Typography.Text>
          </Space>
          <Typography.Text type="secondary" className="text-[11px]">
            开启后 AI 客户端可创建/修改/删除任务与项目；所有写入都会记录到 `op_log`，可在数据库
            `~/.omnitodo/omnitodo.db` 审计。关闭时 MCP 为只读。
          </Typography.Text>
        </Space>
      </Flex>
    </Card>
  );
}

function DataPanel() {
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const [format, setFormat] = useState<ExportFormat>("json");
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
    message.success(`已导出并复制到剪贴板：${name}`);
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
    message.success(`已导入 ${n} 条任务（来源格式：${fmt}）`);
  };

  return (
    <Card title="数据">
      <Flex vertical gap={16}>
        <Row label="导出">
          <Space wrap>
            <Select
              style={{ width: 240 }}
              value={format}
              onChange={(v) => setFormat(v as ExportFormat)}
              options={[
                { value: "json", label: "JSON（可再导入语义完整）" },
                { value: "csv", label: "CSV" },
                { value: "md", label: "Markdown" },
              ]}
            />
            <Button icon={<DownloadOutlined />} onClick={doExport}>
              导出并下载
            </Button>
          </Space>
        </Row>
        <Row
          label="导入"
          hint="`.md` 走 Markdown 语法（`- [ ] 标题 #标签`）；`.txt` 走 todo.txt（`(A) 任务 @情境 +项目`）；`.json` 走 Todoist 导出（含项目、标签、优先级、日期与子任务）。"
        >
          <Upload
            accept=".md,.markdown,.txt,.json"
            showUploadList={false}
            beforeUpload={(file) => {
              void doImport(file as unknown as File);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </Upload>
        </Row>
      </Flex>
    </Card>
  );
}

function About() {
  const version = useQuery({ queryKey: ["app", "version"], queryFn: () => api.appVersion() });
  const releases = useQuery({ queryKey: ["app", "releases"], queryFn: () => api.appReleasesUrl() });

  return (
    <Card title="关于">
      <Flex vertical gap={16}>
        <Row label="版本">
          <Typography.Text code>{version.data ?? "…"}</Typography.Text>
        </Row>
        <Row label="更新">
          <Typography.Text type="secondary">
            v1 为手动更新：从{" "}
            <Typography.Link href={releases.data ?? "#"} target="_blank" rel="noreferrer">
              GitHub Releases <ExportOutlined />
            </Typography.Link>{" "}
            下载对应平台的安装包覆盖安装。
          </Typography.Text>
        </Row>
      </Flex>
    </Card>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[112px_1fr] sm:items-start sm:gap-4">
      <Typography.Text type="secondary" className="pt-1 text-xs">
        {label}
      </Typography.Text>
      <div className="min-w-0">
        {children}
        {hint && (
          <Typography.Text type="secondary" className="mt-1 block text-[11px]">
            {hint}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}
