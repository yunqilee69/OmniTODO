import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { CheckOutlined, CloseOutlined, CopyOutlined } from "@ant-design/icons";
import { useState, type ReactNode } from "react";
import { api, type McpStatus, type McpTokenKind } from "../api/client";
import { qk } from "../api/queryKeys";
import {
  CAPABILITY_GROUPS,
  validateToken,
  type CapabilityGroup,
} from "../lib/mcpConfig";

/**
 * MCP integration panel (design §11).
 *
 * Six sections, top to bottom: the sidecar's state, the capability matrix,
 * a per-client stdio config, the control-endpoint token, the embedded HTTP
 * server, and the write switch. The tokens are persisted server-side and take
 * effect immediately; the snippets are generated there too, so the path and
 * the token cannot drift between what is shown and what the server accepts.
 */
export default function McpPanel() {
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const { data } = useQuery({
    queryKey: qk.mcp("httpState"),
    queryFn: () => api.mcpStatus(),
  });

  // Prefix invalidation: the snippets embed the control token, so changing it
  // has to move the status, both config shapes and the args line together.
  const refresh = () => qc.invalidateQueries({ queryKey: qk.mcpAll });

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    message.success(`已复制：${label}`);
  };

  return (
    <Card title="MCP 集成">
      <Flex vertical gap={16}>
        <StatusGrid data={data} />
        <CapabilityTable writeEnabled={data?.write_enabled ?? false} />
        <StdioSection onCopy={copy} />
        <TokenField
          kind="control"
          label="控制端点 token"
          value={data?.control.token ?? ""}
          hint={
            <>
              写工具提交成功后，MCP 会向{" "}
              <Typography.Text code className="text-[11px]">
                POST http://127.0.0.1:{data?.control.port ?? 8788}/internal/notify
              </Typography.Text>{" "}
              发一条回调，带上{" "}
              <Typography.Text code className="text-[11px]">
                Authorization: Bearer &lt;token&gt;
              </Typography.Text>
              ，应用据此刷新界面。应用没开时回调会被忽略，写入本身不受影响。
            </>
          }
          onSaved={refresh}
          onCopy={copy}
        />
        <HttpSection data={data} onCopy={copy} onChanged={refresh} />
        <WriteSwitch writeEnabled={data?.write_enabled ?? false} onChanged={refresh} />
      </Flex>
    </Card>
  );
}

function StatusGrid({ data }: { data: McpStatus | undefined }) {
  const exists = data?.stdio.exists ?? false;
  const controlLabel =
    data?.control.state === "listening"
      ? "监听中"
      : data?.control.state === "failed"
        ? "启动失败"
        : "启动中";
  const controlColor =
    data?.control.state === "listening" ? "success" : data?.control.state === "failed" ? "error" : "default";

  const cells: { label: string; body: ReactNode }[] = [
    {
      label: "侧车版本",
      body: <Typography.Text code>{data?.version ?? "…"}</Typography.Text>,
    },
    {
      label: "二进制",
      body: (
        <Space direction="vertical" size={2}>
          <Tag color={exists ? "success" : "error"} style={{ marginInlineEnd: 0 }}>
            {exists ? "已检测到" : "未找到"}
          </Tag>
          <Typography.Text code className="break-all text-[11px]">
            {data?.stdio.bin_path ?? "…"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      label: "数据目录",
      body: (
        <Typography.Text code className="break-all text-[11px]">
          {data?.data_dir ?? "…"}
        </Typography.Text>
      ),
    },
    {
      label: "控制端点",
      body: (
        <Space direction="vertical" size={2}>
          <Tag color={controlColor} style={{ marginInlineEnd: 0 }}>
            {controlLabel}
          </Tag>
          <Typography.Text code className="text-[11px]">
            127.0.0.1:{data?.control.port ?? "…"}
          </Typography.Text>
          {data?.control.error && (
            <Typography.Text type="danger" className="text-[11px]">
              {data.control.error}
            </Typography.Text>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-md border border-[var(--border-hairline)] p-3">
          <Typography.Text type="secondary" className="mb-1 block text-[11px]">
            {c.label}
          </Typography.Text>
          {c.body}
        </div>
      ))}
    </div>
  );
}

function CapabilityTable({ writeEnabled }: { writeEnabled: boolean }) {
  return (
    <div>
      <Typography.Text strong>能力对照</Typography.Text>
      <Typography.Paragraph type="secondary" className="mb-2 text-[11px]">
        只读是默认状态；「允许 MCP 写入」打开后才注册写工具，且每次写入都会记入 `op_log`。
        开关在会话初始化时生效，改完需要客户端重连。
      </Typography.Paragraph>
      <Table<CapabilityGroup>
        size="small"
        pagination={false}
        rowKey="label"
        dataSource={CAPABILITY_GROUPS}
        columns={[
          { title: "能力", dataIndex: "label" },
          {
            title: "只读",
            width: 72,
            align: "center",
            render: (_, row) => <Mark on={row.mode === "read"} />,
          },
          {
            title: "读写",
            width: 72,
            align: "center",
            // Every capability exists once the write switch is on; the dimming
            // is what tells the user it is currently off.
            render: () => <Mark on dim={!writeEnabled} />,
          },
        ]}
      />
    </div>
  );
}

function Mark({ on, dim = false }: { on?: boolean; dim?: boolean }) {
  const off = "var(--text-tertiary)";
  return on ? (
    <CheckOutlined style={{ color: dim ? off : "var(--state-success)" }} />
  ) : (
    <CloseOutlined style={{ color: off }} />
  );
}

function StdioSection({ onCopy }: { onCopy: (label: string, text: string) => Promise<void> }) {
  const zcode = useQuery({ queryKey: qk.mcp("zcode"), queryFn: () => api.mcpZcodeConfig() });
  const generic = useQuery({ queryKey: qk.mcp("generic"), queryFn: () => api.mcpCopyClientConfig() });
  const args = useQuery({ queryKey: qk.mcp("args"), queryFn: () => api.mcpArgsLine() });

  return (
    <div>
      <Space align="center" className="mb-1">
        <Typography.Text strong>stdio 配置</Typography.Text>
        <Tag color="success" style={{ marginInlineEnd: 0 }}>
          始终可用
        </Tag>
      </Space>
      <Typography.Paragraph type="secondary" className="text-[11px]">
        每个客户端各自拉起一个实例，无需开关、端口或 token。`omnitodo-mcp` 随安装包放在应用目录下，
        不在系统 `PATH` 上，所以命令必须填绝对路径。
      </Typography.Paragraph>
      <Tabs
        size="small"
        items={[
          {
            key: "zcode",
            label: "ZCode",
            children: (
              <Flex vertical gap={8}>
                <Typography.Text type="secondary" className="text-[11px]">
                  配置文件：<Typography.Text code>~/.zcode/cli/config.json</Typography.Text>
                  ，服务器写在嵌套的 <Typography.Text code>mcp.servers</Typography.Text> 下。
                  也可以在「设置 → MCP」的表单里逐项填：类型 <Typography.Text code>stdio</Typography.Text>
                  、超时 <Typography.Text code>30000</Typography.Text>、协议版本「自动」、
                  环境变量留空，命令与参数见下方。
                </Typography.Text>
                <Alert
                  type="info"
                  showIcon
                  message="参数按空格分隔逐个填，不要给 token 加引号"
                  description="客户端把参数数组直接交给进程，不经过 shell。引号会成为 token 的一部分，回调会被 401 拒绝。"
                />
                <CopyBlock
                  label="参数"
                  text={args.data ?? "…"}
                  onCopy={() => void onCopy("参数", args.data ?? "")}
                />
                <CopyBlock
                  label="完整配置"
                  text={zcode.data ?? "…"}
                  onCopy={() => void onCopy("ZCode 配置", zcode.data ?? "")}
                />
              </Flex>
            ),
          },
          {
            key: "generic",
            label: "通用 JSON",
            children: (
              <Flex vertical gap={8}>
                <Typography.Text type="secondary" className="text-[11px]">
                  顶层 <Typography.Text code>mcpServers</Typography.Text> 是多数客户端的形状
                  （Cursor、Claude Desktop、Windsurf，以及 ZCode 的兼容回退文件{" "}
                  <Typography.Text code>.agents/mcp.json</Typography.Text>）。
                  ZCode 的主配置文件不用这个形状，用「ZCode」页签的那份。
                </Typography.Text>
                <CopyBlock
                  label="通用配置"
                  text={generic.data ?? "…"}
                  onCopy={() => void onCopy("通用配置", generic.data ?? "")}
                />
              </Flex>
            ),
          },
        ]}
      />
    </div>
  );
}

function CopyBlock({ label, text, onCopy }: { label: string; text: string; onCopy: () => void }) {
  return (
    <div>
      <Flex justify="space-between" align="center" className="mb-1">
        <Typography.Text type="secondary" className="text-[11px]">
          {label}
        </Typography.Text>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopy}>
          复制
        </Button>
      </Flex>
      <pre className="bg-[var(--bg-sunken)] overflow-x-auto rounded-md border border-[var(--border-hairline)] p-2 text-[11px]">
        {text}
      </pre>
    </div>
  );
}

function TokenField({
  kind,
  label,
  value,
  hint,
  onSaved,
  onCopy,
}: {
  kind: McpTokenKind;
  label: string;
  value: string;
  hint: ReactNode;
  onSaved: () => void;
  onCopy: (label: string, text: string) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const error = draft === null ? null : validateToken(draft);

  const save = useMutation({
    mutationFn: () => api.mcpSetToken(kind, shown),
    onSuccess: () => {
      setDraft(null);
      onSaved();
      message.success("已保存，立即生效。已连接的客户端需要重连才会带上新 token。");
    },
    onError: (e) => message.error(String(e)),
  });

  const regenerate = useMutation({
    mutationFn: () => api.mcpRegenerateToken(kind),
    onSuccess: () => {
      setDraft(null);
      onSaved();
      message.success("已重新生成。旧 token 立即失效，客户端需要更新配置并重连。");
    },
    onError: (e) => message.error(String(e)),
  });

  return (
    <div>
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Paragraph type="secondary" className="mb-2 text-[11px]">
        {hint}
      </Typography.Paragraph>
      <Input
        aria-label={label}
        value={shown}
        status={error ? "error" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      <Space wrap className="mt-2">
        <Button disabled={!!error || shown === value} loading={save.isPending} onClick={() => save.mutate()}>
          保存
        </Button>
        <Popconfirm
          title="重新生成 token？"
          description="旧 token 会立即失效，已填进客户端的配置需要一并更新。"
          onConfirm={() => regenerate.mutate()}
        >
          <Button loading={regenerate.isPending}>重新生成</Button>
        </Popconfirm>
        <Button icon={<CopyOutlined />} onClick={() => void onCopy(label, shown)}>
          复制
        </Button>
      </Space>
      {error && (
        <Typography.Text type="danger" className="mt-1 block text-[11px]">
          {error}
        </Typography.Text>
      )}
    </div>
  );
}

function HttpSection({
  data,
  onCopy,
  onChanged,
}: {
  data: McpStatus | undefined;
  onCopy: (label: string, text: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [port, setPort] = useState("");
  const running = data?.http.running ?? false;

  const start = useMutation({
    mutationFn: () => api.mcpHttpStart(port ? Number(port) : undefined),
    onSettled: onChanged,
  });
  const stop = useMutation({ mutationFn: () => api.mcpHttpStop(), onSettled: onChanged });

  return (
    <div className="rounded-md border border-[var(--border-hairline)] p-3">
      <Space align="center" className="mb-1">
        <Typography.Text strong>HTTP</Typography.Text>
        <Tag color={running ? "success" : "default"} style={{ marginInlineEnd: 0 }}>
          {running ? `运行中 · 127.0.0.1:${data?.http.port}` : "已停止"}
        </Tag>
      </Space>
      <Typography.Paragraph type="secondary" className="text-[11px]">
        常驻在本机的服务，供脚本或多工具共用；只监听 127.0.0.1，需要 Bearer token。
        与 stdio 互不冲突，可以同时开。
      </Typography.Paragraph>
      <Space wrap className="mb-2">
        <Input
          size="small"
          style={{ width: 120 }}
          aria-label="HTTP 端口"
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
      </Space>
      <TokenField
        kind="http"
        label="HTTP token"
        value={data?.http.token ?? ""}
        hint="请求头 Authorization: Bearer <token>。改完立即生效，已建立的连接不受影响。"
        onSaved={onChanged}
        onCopy={onCopy}
      />
    </div>
  );
}

function WriteSwitch({ writeEnabled, onChanged }: { writeEnabled: boolean; onChanged: () => void }) {
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.settingsSet("mcp.write_enabled", next),
    onSettled: onChanged,
  });

  return (
    <Space direction="vertical" size={2}>
      <Space>
        <Switch checked={writeEnabled} onChange={(v) => toggle.mutate(v)} />
        <Typography.Text strong>允许 MCP 写入</Typography.Text>
      </Space>
      <Typography.Text type="secondary" className="text-[11px]">
        开启后 AI 客户端可创建、修改、删除任务与项目；所有写入都记录到 `op_log`，
        可在 `~/.omnitodo/omnitodo.db` 审计。关闭时 MCP 为只读。
      </Typography.Text>
    </Space>
  );
}
