# MCP 控制端点 token 持久化 与 设置页 MCP 面板重构

日期：2026-10-15
状态：已确认，待实现

## 1. 背景

在 ZCode 里配置 OmniTODO 的 MCP 服务器时暴露三个问题：

1. **`command` 不可解析**。侧车二进制随安装包分发、与主程序同目录，不在 `PATH` 上；
   而设置页「复制客户端配置」生成的片段里 `command` 写的是裸文件名 `omnitodo-mcp.exe`。
   ZCode 的 MCP schema 不做 `${}` 模板展开（模板只对插件提供的 server 生效），
   于是 `spawn omnitodo-mcp.exe ENOENT`。
2. **`--notify-token` 带引号**。实际落盘的值形如 `--notify-token="01a1…922a"`——首尾各一个
   双引号。MCP 客户端的 `args` 是数组、直接交给进程，不经过 shell，引号成为 token 的
   一部分，桌面端比对 `Bearer <token>` 永不相等，回调一律 401。
3. **token 每次启动都变**。`AppState::new()` 里 `control_token: random_token()`，
   写进客户端配置的值在下次启动应用后失效。这让「把 token 填进客户端」这件事本身
   只有一次会话的有效期。

同时，设置页的 MCP 面板只有三段短说明，用户看不出「MCP 能干什么、命令该填什么、
token 用在哪」，需要按客户端给出可直接复制的配置。

## 2. 目标

- 控制端点 token（以及同病的 HTTP token）**持久化、可配置、改完立即生效**。
- 设置页 MCP 面板给出**可直接复制**的 ZCode 配置，并解释每个字段怎么填。
- 修掉裸文件名与引号这两个真 bug。

### 非目标

- 端口不做成可配置（控制端点固定 8788，MCP HTTP 固定 8787，仅在面板显示状态）。
- 不做多客户端分页（本轮只做 ZCode + 通用 JSON 两个页签，结构留好以便后续加）。
- 不改 `mcp.write_enabled` 的存储位置与语义。
- 不引入 token 轮换（grace period 同时接受新旧 token）。

## 3. 决议

### 3.1 token 存 SQLite `settings` 表

设计文档 §4.4 自相矛盾：一句说「HTTP 端口/token 等应用设置统一存 SQLite `settings` 表」，
下一句说「`config.json` 放 MCP HTTP 端口/token、内部控制端点端口/token」。

**取前者**，因为 §4.4 给 `config.json` 的理由是「进程启动前就要读到」，而控制端点是
在 `Core::open_default()` 之后才起的，库早已打开——该理由不成立。落地方式：

| 键 | 内容 |
|---|---|
| `mcp.control_token` | 内部控制端点 token |
| `mcp.http_token` | 内嵌 MCP HTTP 服务器 token |

`mcp.write_enabled` 留在原处不动。§4.4 中那句关于 `config.json` 的描述改为
「保留给未来真正需要早于数据库读取的项」。

### 3.2 token 的生成、校验与生效

- **首次启动**：读键；缺失或为空则生成一次、落库、使用。此后每次启动读到同一个值。
- **校验**：长度 16–128，字符集 `[A-Za-z0-9_-]`。理由是它要作为
  `Authorization: Bearer <t>` 头部值，含空格、引号、非 ASCII 会让请求成为非法头。
  不通过则拒绝落库并返回 `VALIDATION` 错误。
- **立即生效**：内存里由 `String` 改为 `Arc<RwLock<String>>`，每个请求现读，
  因此改完不需要重启应用。
- **已知限制（需在 UI 写明）**：已经拉起的 MCP 客户端进程手里仍是旧 token，
  改完要重启客户端才恢复回调。回调失败不影响写本身（§4.5），坏处只是界面不即时刷新。

## 4. 后端改动

### 4.1 `crates/omnitodo-core/src/service/endpoint.rs`（新增）

```rust
pub const CONTROL_TOKEN_KEY: &str = "mcp.control_token";
pub const HTTP_TOKEN_KEY: &str = "mcp.http_token";

pub fn generate_token() -> String;                    // 两次 UUIDv7 去连字符
pub fn validate_token(t: &str) -> Result<()>;          // 16–128 / [A-Za-z0-9_-]
impl Core {
    pub async fn endpoint_token(&self, key: &str) -> Result<String>;      // get-or-create+落库
    pub async fn set_endpoint_token(&self, key: &str, token: &str) -> Result<()>;
    pub async fn regenerate_endpoint_token(&self, key: &str) -> Result<String>;
}
```

放在 core 而不是桌面壳里，是为了不依赖 Tauri 就能单测（幂等、持久化、校验规则）。

### 4.2 `omnitodo-desktop/src/state.rs`

- `control_token` / `http_token` 类型改为 `Arc<RwLock<String>>`。
- `AppState::new()` 里用 `endpoint_token()` 取（首次生成并落库）。
- 新增 `control_listening: Arc<RwLock<ControlState>>`，取值 `Starting | Listening | Failed(String)`，
  供面板显示控制端点状态（端口被占用时能看出来）。

### 4.3 `omnitodo-desktop/src/control.rs` 与 `mcp_http.rs`

- 校验改为 `ctx.token.read().await` 现读，实现热更新。
- `control::serve` 在 `bind` 成功后把 `control_listening` 置为 `Listening`，
  失败置 `Failed(e)`（原来只写日志，界面无从得知）。

### 4.4 `omnitodo-desktop/src/mcp_cmds.rs`

`mcp_status` 扩充为：

```json
{
  "version": "0.1.0",
  "stdio": { "bin_path": "<绝对路径>", "exists": true, "always_available": true },
  "http": { "running": false, "port": 8787, "token": "…" },
  "control": { "port": 8788, "token": "…", "state": "listening" },
  "write_enabled": false,
  "db_path": "…",
  "data_dir": "…"
}
```

- `bin_path` 用现成的绝对路径算法（`current_exe().parent()/omnitodo-mcp[.exe]`），
  新增 `exists` 判断（`is_file()`）。
- `version` 取 `env!("CARGO_PKG_VERSION")`；二进制缺失时前端显示「未检测到」。
- 新增命令：
  - `mcp_set_token(kind, token)` — `kind ∈ {"control","http"}`，校验→落库→热更新。
  - `mcp_regenerate_token(kind) -> String` — 重新生成并返回新值。

### 4.5 客户端配置片段

新增 `omnitodo-desktop/src/mcp_config.rs`，**纯函数 + 单测**（不依赖 Tauri 运行时）：

```rust
pub fn zcode_snippet(bin: &str, db: &str, notify: &str, token: &str, write: bool) -> String;
pub fn generic_snippet(bin: &str, db: &str, notify: &str, token: &str, write: bool) -> String;
pub fn args_line(bin: &str, db: &str, notify: &str, token: &str, write: bool) -> String;
```

- `zcode_snippet` 输出 `~/.zcode/cli/config.json` 的 `mcp.servers.OmniTODO` 位置，
  即**嵌套 `mcp` → `servers`**，不是顶层 `mcpServers`。
- `command` 用绝对路径；token 不带引号；`--db` 与 `--notify-token` 用「键 值」两个数组元素
  （不用 `=`），避免用户误加引号。
- `args_line` 给「参数（空格分隔）」表单字段用，输出一行空格分隔的参数。
- 三个纯函数通过三个命令暴露给前端：`mcp_zcode_config`、`mcp_args_line`，
  以及原有 `mcp_copy_client_config`（返回 `generic`，顺带修掉裸文件名）。都只是
  这一份纯函数的薄封装，因此不可能互相漂移。
- `mcp_status.control` 除 `state` 外还带一个 `error`，端口被占用时把原因带到界面上。

> 摘要：片段既要在 ZCode 的 JSON 编辑器里能直接粘，也要在表单里能逐项照抄，
> 两条路都不能带引号。

## 5. 前端改动

### 5.1 新增 `ui/src/components/McpPanel.tsx`

从 `ui/src/routes/Settings.tsx`（422 行）里搬出并重构，按信息密度分六段：

1. **状态信息网格**（2×2）：侧车版本 / 二进制绝对路径 + `已检测到`|`未找到` 标签 /
   数据目录 / 控制端点状态（监听中 | 端口被占用 | 启动失败）。仿 DBX 面板的四宫格。
2. **能力对照表**：行是工具，列是「只读 / 读写」两档，数据取自
   `tools.rs` 的 `READ_TOOLS`（13 个）与 `WRITE_TOOLS`（7 个），在
   `ui/src/lib/mcpConfig.ts` 里按组硬编码并注明「与 `crates/omnitodo-mcp/src/tools.rs` 同步」。
3. **stdio 配置区**，`Tabs` 两个页签：
   - **ZCode**：配置文件位置、表单逐字段填法（名称 / 作用域 用户 / 类型 stdio /
     超时 30000 / 协议版本 自动 / 命令=绝对路径 / 参数=`args_line` /
     环境变量留空）、三句提示（命令必须绝对路径、参数按空格分隔、**不要给 token 加引号**）、
     完整 JSON。
   - **通用 JSON**：`generic_snippet`，并注明 ZCode 用嵌套 `mcp.servers`、
     `.agents/mcp.json` 才用顶层 `mcpServers`。
4. **控制端点 token 区**：可编辑 `Input` + 保存 / 重新生成 / 复制。
   保存前本地校验（与 Rust 同规则），给出错误提示；重新生成要 `Popconfirm` 二次确认
   （会让现有客户端配置失效）；下方一行说明用途
   （写工具成功后 `POST http://127.0.0.1:8788/internal/notify`，带 `Authorization: Bearer`）。
5. **HTTP 区**：保留启用/停止/端口，token 与 4 同构（保存 / 重新生成 / 复制）。
6. **写入开关**：保留，文案与能力表对齐。

### 5.2 `ui/src/routes/Settings.tsx`

删除本地 `McpPanel`，改为引入组件；文件回到只负责组装各区块。

### 5.3 `ui/src/api/client.ts` / `queryKeys.ts`

- `McpStatus` 类型按 4.4 的新结构补齐。
- 新增 `mcpSetToken(kind, token)`、`mcpRegenerateToken(kind)`；`mcpCopyClientConfig` 保留。

## 6. 测试与验收

### 单测

| 层 | 用例 |
|---|---|
| core `endpoint.rs` | 取用幂等（重复调用值不变）；重新打开库仍是同一值；校验拒绝空/短于 16/含空格/含引号/非 ASCII；生成的 token 自身通过校验 |
| desktop `mcp_config.rs` | ZCode 片段是 `mcp.servers` 嵌套形状；`command` 是绝对路径；token 前后无引号；`--write` 只在开启时出现；能被 `serde_json` 解析 |
| 前端 `mcpConfig.test.ts` | 能力表行数与 `READ_TOOLS`/`WRITE_TOOLS` 数量一致；本地 token 校验与 Rust 规则同结论 |

### 命令

```bash
cargo test --workspace
cargo clippy --workspace --all-targets
cd omnitodo-desktop && cargo test && cargo clippy --all-targets
cd ui && npm test && npm run build
```

### 手工验收

1. 改 token → `curl -H "Authorization: Bearer <旧>"` 打 `127.0.0.1:8788/internal/notify` 应 401，
   带新 token 应 202，**全程不重启应用**。
2. 不碰 token，重启应用后再 `curl`，仍应 202 —— 这正是当前坏掉的一条。
3. 面板显示的 `bin_path` 指向真实存在的文件，且把 ZCode 片段的 `command` 换成该路径后
   ZCode 能起来（`omnitodo-mcp` 工具出现在工具列表里）。

## 7. 文档同步

- 设计文档 §4.4：修掉 `config.json` 那处自相矛盾。
- 设计文档 §11.1：客户端配置示例补绝对路径与 token 说明。
- `DESIGN.md` 第 602 行组件清单补 `Tabs`/`Table`。
- `docs/implementation-status.md`：记一条本轮改动与验证结果。

## 8. 风险

- 端口 8788 被占用时控制端点起不来，本轮只做到「面板能显示失败」，不做自动换端口。
- 已启动的 MCP 客户端在 token 变更后需重启客户端，属已知限制，UI 必须写明。
- `scripts/smoke-gui-xvfb.sh` 的硬编码坐标本就已因 antd 改版失准，本轮面板重构会再动一次
  设置页布局，该脚本需要在有 X11 的机器上重新标定（本轮不做）。
