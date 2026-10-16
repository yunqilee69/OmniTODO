# OmniTODO — 跨平台本地优先待办应用 · 详细设计说明

- 版本：v1.3（设计稿）
- 日期：2026-10-12
- 目标平台：Windows / macOS / Linux 桌面三端
- 代码仓库：`git@github.com:yunqilee69/OmniTODO.git`（先本地，暂不推送）

**变更记录**
- v1.3：**跨进程刷新改为主动回调**（MCP 写成功后调用桌面应用的内部控制端点，UI 被动失效 Query，**不轮询**，见 §4.5）；**重复任务改为"到达时间即物化、每期一行"**，未来期次仅虚拟展开、到点再落库，保证完成/漏做统计完整（§5.5 / §9.3）；**软删除级联在服务层显式实现**（删项目先查任务再批量删，见 §5.7）；**附件改为 `blob`（存库）/ `managed`（托管文件存 `.omnitodo/attachments/`）两种存储**，取消"引用本地原文件"模式（§5.6）。同版一次性定稿遗留项：**FTS 加 `task_id` 回表列**（§5.4）、**全天任务不存瞬时点**（§5.1）、**只读 WAL 需目录可写 + 数据目录须本地盘**（§4.3）、**连接表不独立同步**（§5.1）、**op_log 保留 30 天**（§5.8）、**完成 upsert 防重复计数**（§5.3 / §9.3）。
- v1.2：澄清 MCP 的 **stdio / HTTP 是两种传输模式且可同时启用**（无"模式切换"开关）；**移除全部 AI/LLM 集成**，应用只对外暴露一个 MCP Server；`#项目名` 遇不存在的项目改为**弹选择框**；MCP 不暴露简写解析工具，写工具使用精确字段。
- v1.1：定名 **OmniTODO**；附件默认**引用模式**；取消自动更新，改 GitHub Releases 手动下载覆盖；补充**简写快速添加语法**。
- v1.0：首版设计。

---

## 1. 目标与非目标

### 1.1 目标

1. 一个**本地优先**的桌面待办应用：数据落在本机 SQLite 单文件，无账号、无服务端即可完整使用。
2. 任务模型覆盖：标题、描述、优先级、标签、创建/更新时间、开始/截止时间、提醒开关、子任务、附件。
3. 用**项目（Project）**做任务分组的一级维度，标签做横切维度。
4. 对外提供一个**原生 MCP Server**，让外部 agent（Cursor / Claude Desktop / 自写脚本）直接读本地库生成报告，而不是去爬 UI 或调远程 API。
5. MCP 的 **stdio 与 HTTP 两种传输可同时启用**，互不冲突；界面各管各的，不做二选一。
6. 数据访问层预留同步接口，v1 不实现同步，但字段与仓储抽象为将来的同步留好位置。

### 1.2 非目标（v1 明确不做）

- 云同步、多用户、团队协作、权限体系。
- 移动端。
- 日历双向同步（Google / Outlook CalDAV）。
- 富文本协作编辑、评论、@提醒。
- **应用内 AI 助手 / LLM 集成**：OmniTODO 自身不调用任何大模型，只做数据与 MCP 暴露。
- 插件市场。
- **自动更新**（改为 GitHub Releases 手动下载覆盖，见 §15）。

---

## 2. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 应用名称 | **OmniTODO** |
| 仓库 | `git@github.com:yunqilee69/OmniTODO.git`（先本地） |
| 数据与同步 | 本地为主（SQLite 单文件，无服务端），仓储层抽象为可替换实现，字段预留同步元数据 |
| 附件策略 | **BLOB 存库为默认**（随 DB 单文件）；大文件走 **managed 托管文件** 存 `.omnitodo/attachments/`（内容寻址）；**取消引用外部文件模式** |
| MCP 权限 | **只读默认**；写工具需在设置中显式开启，且全部写入审计日志 |
| MCP 传输 | **stdio 与本地 HTTP 可同时启用**，互不冲突，无需二选一开关 |
| 跨进程刷新 | MCP 写成功后**主动回调**桌面应用的控制端点，UI 被动失效 Query；**不轮询**（§4.5） |
| 应用内 AI | **不做**。只暴露 MCP；报告由外部 agent 消费 |
| 更新方式 | 不做自动更新；提供 GitHub Releases 地址，用户手动下载覆盖 |
| v1 附加能力 | 系统托盘 + 全局快捷键快捷添加、简写语法、全文搜索、导入导出、重复任务 + 日历视图 |

> v1 范围偏大（含重复任务与日历）。第 16 节给出分期，建议按阶段交付，但每一阶段都是可运行、可验证的完整切片。

---

## 3. 技术栈总览

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | **Tauri 2** | 三端官方支持；安装包与内存远低于 Electron；托盘、系统通知、全局快捷键、自启动都是一等能力 |
| 核心逻辑 | **Rust**（`omnitodo-core` crate） | 与 Tauri 无耦合，可被桌面端、MCP 二进制、CLI 复用；附件校验、提醒调度、SQLite 都在这里 |
| 数据库 | **SQLite（WAL 模式）** + `sqlx` | 单文件、零运维、支持多进程并发读；`sqlx` 的迁移与异步集成契合 Tauri 命令 |
| MCP SDK | **`rmcp`**（官方 Rust MCP SDK） | 原生支持 stdio 与 streamable HTTP，两种传输一套实现 |
| 前端 | **React 19 + TypeScript + Vite** | 你指定 React；Vite 开发体验好，Tauri 官方模板支持 |
| 前端状态 | **TanStack Query**（服务端状态）+ **Zustand**（UI 状态） | Query 负责从 `invoke` 拉数据并按 Tauri 事件失效；Zustand 管筛选、选中项、主题，避免 Redux 样板 |
| 路由 | **React Router** | 视图切换（Inbox/Today/Upcoming/Calendar/Project/Tag/Search/Settings） |
| 样式 | **Tailwind CSS + shadcn/ui（Radix）** | 快速做出统一、可访问的桌面 UI |
| 拖拽 / 虚拟列表 | **dnd-kit** / **TanStack Virtual** | 任务排序与跨项目移动；长列表性能 |
| 日期 | `chrono` + `chrono-tz`（Rust）、`date-fns` + `date-fns-tz`（TS） | 时区感知的截止/提醒计算 |
| 重复规则 | `rrule`（Rust）+ `rrule.js`（TS，仅展示） | 两端用同一套 RFC 5545 语义，Rust 为准 |
| UUID | `uuid`（v7，时间有序） | 主键天然按创建时间排序，利于分页与将来同步 |
| i18n | `i18next` | 默认 `zh-CN`，回退 `en` |

> **实现期偏差（v1.3 落地时）**：`rmcp` 与 `rrule` 两个上游 crate 在本项目
> 构建环境中不便验证，改为**自实现**——MCP 走 JSON-RPC 2.0（`initialize` /
> `tools/list` / `tools/call` / `resources/list`），重复规则走 RFC 5545 子集引擎
> （含跨短月夹取与中文简写）。两者接口稳定、可离线构建、已被测试覆盖，将来可
> 无痛换回上游 crate（仅影响 `tools.rs` / `recurrence.rs`）。实现进度见
> [`docs/implementation-status.md`](./docs/implementation-status.md)。

---

## 4. 系统架构

### 4.1 进程与组件

```
┌──────────────────────────────────────────────────────────────┐
│  桌面应用进程 (omnitodo-desktop, Tauri 2)                      │
│                                                              │
│   ┌───────────── React UI (WebView) ─────────────┐           │
│   │  invoke()  ◄──── Tauri Commands ────►  events │           │
│   └───────────────────┬──────────────────────────┘           │
│                       │                                       │
│   Tauri 适配层: tray / global-shortcut / notification /       │
│                deep-link / 内嵌 MCP HTTP server               │
│                       │                                       │
│   ┌───────────────────▼──────────────────────────┐           │
│   │              omnitodo-core (Rust)             │           │
│   │  Service 层: Task/Project/Tag/Attachment/     │           │
│   │             Search/Reminder/Recurrence/       │           │
│   │             ImportExport/Report/QuickAdd      │           │
│   │  Repo 层 (trait + sqlite 实现)                │           │
│   │  sqlx SqlitePool ──►  omnitodo.db (WAL)       │           │
│   └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
        │ 同一份 omnitodo.db（WAL，多进程只读安全）
        │
        ├──────────────────────────────┬─────────────────────────┐
        ▼                              ▼                         ▼
┌──────────────────┐      ┌────────────────────┐    ┌────────────────────┐
│ omnitodo-mcp     │      │ omnitodo-mcp       │    │ omnitodo-mcp       │
│ (stdio, 客户端A)  │      │ (stdio, 客户端B)    │    │ (--http 常驻服务)   │
│ 每个客户端一个实例 │      │ 各自独立             │    │ 127.0.0.1:8787     │
└──────────────────┘      └────────────────────┘    └────────────────────┘
        stdio 与 HTTP 可同时存在，互不干扰
```

### 4.2 为什么 MCP 必须是独立二进制

MCP 的 stdio 传输要求**客户端自己拉起子进程**（Cursor / Claude Desktop 在配置里写 `command` + `args`）。所以接口形态决定 `omnitodo-mcp` 必须是一个可独立执行的程序，而不是 Tauri 进程里的一个模块。

- stdio：`omnitodo-mcp` 独立进程，DB 默认以**只读**打开。多个客户端 = 多个独立实例。
- 本地 HTTP：两种运行方式并存——(a) 桌面应用内嵌（应用运行期间可用，便于查看端口与 token）；(b) `omnitodo-mcp --http --port 8787` 独立运行（应用没开也能给脚本供数）。

### 4.3 多进程访问 SQLite 的规则（关键约束）

桌面应用与多个 MCP 进程会同时打开同一个 `omnitodo.db`，必须显式约束：

- 应用侧连接串统一设置：`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;`
- MCP 只读模式用 `SQLITE_OPEN_READONLY`（sqlx `?mode=ro`），**不写任何数据**，杜绝与应用的写锁冲突。注意：WAL 的只读连接仍可能创建/更新 `-shm` 共享内存文件，因此 **MCP 进程需要对数据目录有写权限**（"只读"指不写数据，不是不碰目录）；目录不可写或存在热日志时打开失败，MCP 需给出明确错误。
- **数据目录必须在本地文件系统**：检测到位于网络挂载或同步盘（Dropbox / OneDrive / 网盘客户端目录）时，启动即警告并建议迁到本地——这类文件系统上 WAL 会损坏数据库。
- 只有开启写工具的 MCP 实例才以读写方式打开，且仍然依赖 `busy_timeout` 串行化。
- **写路径串行化**：所有写操作都走 `omnitodo-core` 的事务封装，不做长事务。桌面应用与开启写权限的 MCP 实例**都可能写**，靠 WAL 单写者 + `busy_timeout` 串行化；对 `SQLITE_BUSY` 做有限重试退避，重试用尽后返回可读错误（UI 提示"数据库忙，请重试"，MCP 返回结构化错误）。
- **软删除级联在代码层实现**：外键上的 `ON DELETE CASCADE/SET NULL` 只在**物理删除**时生效，正常路径全部走 `deleted_at` 软删除，因此**不依赖数据库级联**；删除项目/任务时由服务层按依赖顺序显式级联（见 §5.7）。DDL 上的外键仅作物理删除/迁移兜底。
- WAL 天然支持**一写多读**，这正是"stdio 多实例 + HTTP 常驻"能并存的基础。

### 4.4 目录与文件布局

数据目录统一放在用户主目录下的隐藏目录 `~/.omnitodo/`（**不区分平台**）：

| 平台 | DB 目录 |
|---|---|
| Windows | `%USERPROFILE%\.omnitodo\`（即 `C:\Users\<你>\.omnitodo\`） |
| macOS | `~/.omnitodo/` |
| Linux | `~/.omnitodo/` |

> `OMNITODO_DATA_DIR` 可覆盖整目录（测试与 headless CLI/MCP 用），`--db` 可单独覆盖 DB 路径。

```
.omnitodo/                    # 应用数据目录（见上表）
├── omnitodo.db             # SQLite（WAL 伴生 omnitodo.db-wal / -shm）；blob 模式附件的二进制在库内
├── attachments/            # managed 模式附件的托管目录：ab/cd/<sha256> 内容寻址
└── logs/
```

> 应用设置统一存 SQLite `settings` 表，保证单一数据源：主题、默认项目、MCP 写开关，
> 以及两个回环端点的 token（`mcp.control_token` 内部控制端点、`mcp.http_token` 内嵌
> MCP HTTP 服务）。两个 token 首次启动时生成一次并落库，之后保持不变，可在设置页修改，
> 修改后立即生效（见 §4.5）。
>
> 早期草案曾把端口/token 放进 `config.json`，理由是「进程启动前就要读到」。实际上这两个
> 端点都在 `Core::open_default()` 之后才启动，库早已打开，该理由不成立，故不再引入第二个
> 存储。`config.json` 保留给未来真正需要早于数据库读取的项。

### 4.5 跨进程刷新：MCP 主动回调（取代轮询）

stdio 与独立 HTTP 的 MCP 是**独立进程**，无法直接向桌面应用 emit Tauri 事件。约定如下：

- 桌面应用在 `127.0.0.1:<control_port>` 暴露一个**内部控制端点**（token 保护，token 存 `settings.mcp.control_token`，可在设置页修改并立即生效——端点每个请求现读 token，不需要重启应用）：`POST /internal/notify`，body 形如 `{ "source": "mcp", "events": [{ "type": "task:updated", "id": "…" }] }`。已拉起的 MCP 客户端进程手里仍是旧 token，需要重连才恢复回调。
- MCP **写工具提交事务成功后**调用该端点，把受影响实体与事件类型报给应用；应用收到后转发为前端可订阅的 Tauri 事件（§8.2），前端据此 invalidate 对应 Query key。
- 应用未运行 / 端点不可达时，MCP **忽略回调失败**（连接被拒即跳过），**不影响写事务本身**；此时也没有 UI 需要刷新。
- 兜底：前端在**窗口重新获得焦点**时对当前视图做一次轻量重新校验（**非轮询**），覆盖回调丢失的极端情况。
- 该端点只承载"通知"，不承载数据；不引入长连接、不做定时轮询。

---

## 5. 数据模型

### 5.1 时间与 ID 约定

- 时间统一存 **Unix 毫秒（UTC，INTEGER）**，展示时按任务 `timezone` 或系统时区渲染。
- **全天任务（`all_day=1`）不存"瞬时点"**：`start_at`/`due_at` 存该**民用日期在 UTC 的零点毫秒**，展示与重复计算一律直接取日期部分、**不做时区换算**。这样换时区或跨夏令时不会偏移一天；只有带具体时刻的任务才存真实瞬时点。
- 主键统一 **UUID v7**（TEXT），时间有序。
- **同步元数据范围**：`projects`/`tasks`/`tags`/`attachments` 带 `updated_at`、`deleted_at`（软删除）、`version`（乐观并发）、`device_id`；**连接表/卫星表（`task_tags`、`reminder_fires`、`task_completions`）不独立同步**——标签集合与提醒/完成状态作为所属任务 `op_log` payload 的一部分随任务版本走，不为它们另造一套同步语义。

### 5.2 枚举

- `priority`：`0=none, 1=low, 2=medium, 3=high, 4=urgent`
- `status`：`todo | in_progress | done | cancelled`
- `attachment.storage_kind`：`blob`（二进制存 SQLite 库内）| `managed`（托管文件存 `<数据目录>/.omnitodo/attachments/`，内容寻址）
- `op`（op_log）：`insert | update | delete`

### 5.3 DDL

```sql
-- 项目
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,                      -- #RRGGBB
  icon        TEXT,                      -- emoji 或图标名
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  version     INTEGER NOT NULL DEFAULT 1,
  device_id   TEXT
);
CREATE INDEX idx_projects_active ON projects(is_archived, deleted_at);

-- 任务（含子任务与重复系列）
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id         TEXT REFERENCES tasks(id)   ON DELETE CASCADE,  -- 子任务
  section_id        TEXT REFERENCES sections(id) ON DELETE SET NULL, -- 板块（§5.9），仅顶层任务
  series_id         TEXT,                        -- 重复系列锚点（系列内共享）
  occurrence_at     INTEGER,                     -- 物化期次标识：该期应有的到期时刻；非重复任务为 NULL
  title             TEXT NOT NULL,
  description       TEXT,                        -- Markdown
  priority          INTEGER NOT NULL DEFAULT 0,  -- 0..4
  status            TEXT    NOT NULL DEFAULT 'todo',
  completed_at      INTEGER,
  start_at          INTEGER,
  due_at            INTEGER,
  all_day           INTEGER NOT NULL DEFAULT 0,  -- 1=日期粒度，无具体时刻
  timezone          TEXT,                        -- IANA，参与重复与提醒计算
  remind_enabled    INTEGER NOT NULL DEFAULT 0,
  remind_at         INTEGER,                     -- 绝对提醒时刻（优先）
  remind_offset_min INTEGER,                     -- 相对 due_at 的偏移（分钟）
  recurrence_rule   TEXT,                        -- RFC 5545 子集
  recurrence_until  INTEGER,
  tags_text         TEXT NOT NULL DEFAULT '',    -- 标签反规范化，供 FTS
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  version           INTEGER NOT NULL DEFAULT 1,
  device_id         TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id, status, deleted_at);
CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
CREATE INDEX idx_tasks_series  ON tasks(series_id);
-- 同一系列的同一期只能物化一次（幂等，见 §5.5）
CREATE UNIQUE INDEX uq_tasks_series_occ ON tasks(series_id, occurrence_at)
  WHERE series_id IS NOT NULL AND occurrence_at IS NOT NULL;
CREATE INDEX idx_tasks_due     ON tasks(due_at)  WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_start   ON tasks(start_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_section ON tasks(section_id);

-- 板块（§5.9）：项目内部的分栏，是看板的列、列表的分组标题
CREATE TABLE sections (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1,
  device_id  TEXT
);
CREATE INDEX idx_sections_project ON sections(project_id, sort_order);
-- 同一项目内板块名唯一（忽略大小写），软删除的行不参与
CREATE UNIQUE INDEX uq_sections_name ON sections(project_id, name COLLATE NOCASE)
  WHERE deleted_at IS NULL;

-- 标签
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE,
  color      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  version    INTEGER NOT NULL DEFAULT 1,
  device_id  TEXT
);
CREATE UNIQUE INDEX uq_tags_name ON tags(name COLLATE NOCASE) WHERE deleted_at IS NULL;

-- 任务-标签
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);

-- 附件（blob=二进制存库内；managed=托管文件存 .omnitodo/attachments/）
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,                 -- 原始文件名（展示用）
  storage_kind TEXT NOT NULL DEFAULT 'blob',  -- blob=存库内 | managed=托管文件
  rel_path     TEXT,                          -- managed: 相对 .omnitodo/attachments/ 的路径；blob: NULL
  data         BLOB,                          -- blob: 文件二进制；managed: NULL
  mime_type    TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT,                          -- 内容寻址与去重键（写入时计算）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1,
  device_id    TEXT
);
CREATE INDEX idx_attachments_task ON attachments(task_id);
CREATE INDEX idx_attachments_sha  ON attachments(sha256);

-- 提醒触发记录（幂等去重）
CREATE TABLE reminder_fires (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_at INTEGER NOT NULL,   -- 该次提醒应有的触发时刻
  fired_at      INTEGER NOT NULL,
  PRIMARY KEY (task_id, occurrence_at)
);

-- 完成历史（报告用，独立于任务是否被删除）
CREATE TABLE task_completions (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  series_id    TEXT,
  completed_at INTEGER NOT NULL,
  due_at       INTEGER,
  was_on_time  INTEGER
);
CREATE INDEX idx_completions_time ON task_completions(completed_at);
-- task_id 唯一：完成=upsert、取消完成=删除该行，避免"取消后再完成"重复计入吞吐/on-time
CREATE UNIQUE INDEX uq_completions_task ON task_completions(task_id);

-- MCP 审计
CREATE TABLE mcp_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  transport   TEXT NOT NULL,        -- stdio | http
  tool        TEXT NOT NULL,
  args        TEXT,
  ok          INTEGER NOT NULL,
  error       TEXT,
  duration_ms INTEGER
);

-- 应用设置（KV）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,         -- JSON 编码
  updated_at INTEGER NOT NULL
);

-- 变更日志：为将来同步预留，v1 写入但暂不消费；保留窗口 30 天，由维护任务裁剪（§5.8）
CREATE TABLE op_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT,
  ts          INTEGER NOT NULL,
  device_id   TEXT
);

-- 业务 schema 版本冗余（sqlx migrations 自带 _sqlx_migrations）
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

### 5.4 全文搜索（FTS5）

```sql
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  task_id UNINDEXED,          -- 回表用：FTS rowid 是整数而 tasks.id 是 TEXT UUID，必须显式带出
  title, description, tags_text,
  tokenize='trigram'          -- 对中文子串友好；代价是索引更大、最小匹配 3 字符
);
```

- `trigram` 分词器支持 CJK 子串匹配，比 `unicode61` 更适合中文。**查询长度 < 3 字符时**回退到 `LIKE '%q%'`。
- **回表方式**：命中只返回 `task_id`，再 JOIN 回 `tasks`：`SELECT t.* FROM tasks_fts f JOIN tasks t ON t.id = f.task_id WHERE tasks_fts MATCH ? AND t.deleted_at IS NULL`。因为 `task_id` 是 `UNINDEXED` 列，FTS 的整数 rowid 不参与业务映射。
- 索引由**仓储层在写入事务内同步维护**（而非触发器），因为 `tags_text` 依赖标签变更，集中在一处更好推理：新增/更新时先删旧行再插新行，**软删除时删除对应 FTS 行**；另提供 `rebuild_fts` 维护命令。
- **前置条件**：`trigram` 需要 SQLite ≥ 3.34 且 FTS5 已编译进 sqlite 构建。P0 迁移里加一条断言（`SELECT fts5(...)` 试建/查询）锁定版本，避免 P4 才发现不可用。
- 若后续以英文为主，可切 `unicode61 remove_diacritics 2`；分词器选择记录在 `settings.search.tokenizer`。

### 5.5 子任务与重复的建模取舍

- **子任务**：`tasks.parent_id` 自引用。支持任意深度，但 UI 默认只展开两层，并在服务层对深度做上限保护（建议 ≤ 5），避免病态嵌套。子任务的级联软删除由服务层完成（§5.7），**不依赖 DDL 上的 `ON DELETE CASCADE`**。
- **重复任务：系列 + 每期一行，按"到达时间"物化**。
  - 系列锚点任务持有 `recurrence_rule`；**每一期都是一行真实的 `tasks` 记录**，共享 `series_id`，并以 `occurrence_at` 标识。**锚点定义：`occurrence_at = due_at ?? start_at`**；若二者皆空则不允许设置重复规则（校验直接报错）。
  - **未来期次不提前落库**：Calendar / Upcoming / 提醒计划里的未来期次由 `RecurrenceService.expand` **虚拟展开**，只读展示、没有 `task_id`、不可单独编辑。
  - **到期即物化**：某期次的 `occurrence_at <= now` 时，由提醒定时任务（§9.1）或应用启动补偿 `materialize_due(now)` 把它落成真实行。即便该期从未被完成，也会留下一条（逾期）记录——**这正是完成率 / 漏做率统计需要的数据**（"每期都物化"的目的）。
  - **幂等**：`(series_id, occurrence_at)` 唯一索引（§5.3）保证多次 tick 不会重复物化；`expand` 展开时跳过已物化的 `occurrence_at`，避免虚拟与真实重复。
  - **编辑范围**：因每期是真实行，"仅此期"直接改该行；"此期及以后"改写系列规则（等价于拆分系列）。语义比"完成才派生"模型清晰。
  - **逾期不滚动**：已物化的期次若一直未完成就保持为逾期行，**不自动滚到下一期**——保留历史、统计真实。
  - **上限与停机补偿**：`recurrence_until` / `COUNT` 到点后停止物化（`COUNT` 按已物化期数计）。应用长期未运行（如关闭 60 天、每天重复）时，启动补偿会一次性补齐；默认补齐，设单系列补齐上限（§18），超出时保留锚点并提示。
  - 代价：行数随期数增长（含从未完成的逾期行），用 `UNTIL`/`COUNT`、补齐上限与归档控制。
  - 备选（原地推进：只改 `due_at`、不建新行）实现更省，但丢历史、报告能力弱，故不采用。

### 5.6 附件存储策略（BLOB 存库 / 托管文件）

上传附件时二选一，默认值可在设置中指定、也可在添加时覆盖：

- **`storage_kind='blob'`（默认）**：二进制直接写入 `attachments.data`（BLOB），与 DB 同生共死，备份/还原/迁移只搬一个 `omnitodo.db`。适合中小文件（默认单文件上限 8 MB、库内附件总量给软告警，见 §18）。
- **`storage_kind='managed'`**：文件复制到 `<数据目录>/.omnitodo/attachments/ab/cd/<sha256>`（内容寻址、天然去重），`rel_path` 记相对路径。适合大文件或希望控制库体积。

共同规则：

1. **两种模式下文件都归应用托管**，因此删除任务 / GC 可以连带删除副本——这与旧"引用外部文件、绝不删原文件"相反（**引用模式已取消**）。
2. `sha256` 在写入时计算，用于去重与一致性校验；`managed` 下同一内容只存一份，引用计数归零后才 GC 删文件。
3. `open(id)`：blob 模式先落临时文件再交系统默认程序打开；managed 模式直接打开托管路径。
4. **导出**：JSON/CSV **不内联二进制**（避免 base64 膨胀），导出为附件清单，另提供"打包附件目录"选项。
5. **不再有"文件缺失 / 重新定位"**（两种模式都不存在外部文件失效），§7.2 的附件服务接口相应精简。

### 5.7 软删除级联规则（服务层显式实现）

正常路径一律 `deleted_at` 软删除，**不依赖数据库外键级联**（DDL 上的 `ON DELETE …` 仅供物理删除/迁移兜底）。级联在**一个事务**内按依赖顺序执行：

**删除项目 `project_delete(id)`**
1. 用递归 CTE 收集该项目下全部未删除任务及其后代：`SELECT id FROM tasks WHERE project_id=? AND deleted_at IS NULL`，再沿 `parent_id` 展开子树。
2. 批量软删这些任务：置 `deleted_at`、`version+1`；子任务随父一并删除。
3. 连带处理这些任务的 `task_tags`、`reminder_fires`（主键表，硬删）、`attachments`（软删，`managed` 文件进入待 GC）。
4. 最后软删 `projects` 行。
5. 全过程逐实体写 `op_log`，并发 `task:deleted` / `project:changed` 事件（§8.2）。

**删除任务 `task_delete(id)`**：同第 2–3 步，作用于该任务及其子树。

**恢复**：v1 **不提供** UI 恢复入口；`deleted_at` 主要服务于将来的同步（墓碑）。若将来支持恢复，需连同子树与关联的删除标记一起保留，才能整体还原。

### 5.8 维护任务（后台，低频）

`omnitodo-core` 提供一个维护例程（应用启动 + 每日一次，或由 `omnitodo-cli` 触发）：

- **op_log 裁剪**：删除 `ts < now - 30d` 的记录（v1 只写不消费，避免无界增长）。
- **附件 GC**：`managed` 模式下，删除 `attachments` 中已软删除、且其 `sha256` 无任何未删除行引用的托管文件；`blob` 模式随软删行的物理清理（`VACUUM`）回收。
- **FTS 重建**：`rebuild_fts` 全量重建 `tasks_fts`（仅在没有写入时执行），用于修复索引漂移。
- **软删除实体物理清理**：可选，将 `deleted_at` 早于阈值（如 90 天）的行连同附件一起物理删除，控制库体积；默认关闭，避免误删。

### 5.9 板块（Sections）

板块是**项目内部的分栏**：它既是看板的一列，也是列表视图里的分组标题。它不是项目（不能有自己的标签、提醒、归档状态），也不是子任务（不嵌套）。Todoist 的 "section" 就是这个东西，本设计沿用其语义与交互，只有一处刻意分歧（见下）。

**三条不变量**（都在服务层一处实现，不在各调用点重复判断）：

1. **板块属于项目，只能收纳本项目的任务。** `create_section` / `update_section` 写入 `project_id` 时校验项目存在；`tasks.section_id` 指向的板块必须与任务的 `project_id` 相同（`ensure_section_in_project`）。任务的 `project_id` 变更（`task_move` 换项目、`reassign_project`）一律把 `section_id` 清空——旧板块不再适用，静默保留会让任务出现在别的项目的分栏里。
2. **只有顶层任务带板块。** 子任务跟随父任务，行内没有自己的分栏位置：`parent_id` 一旦非空，`section_id` 被丢弃（创建、更新、移动三条路径都如此）。看板因此只渲染顶层任务，子任务的进度以 `子任务完成 n/m` 显示在卡片上。
3. **删除板块默认不删任务。** 板块是分隔符，拆掉分隔符不该拆掉它分隔的内容。`section_delete(id, delete_tasks)` 有两种语义，UI 明确询问而不是默默选一个：
   - `delete_tasks = false`（默认）：板块内任务的 `section_id` 置空，回到「无板块」，返回释放的任务数；
   - `delete_tasks = true`（Todoist 的行为）：逐个删除板块内的顶层任务（各自级联删除子树），再软删板块。

**排序**：`sections.sort_order` 是项目内独立的一列，板块拖动换位（`section_reorder`）只写这一列。

**与 Todoist 的一处刻意分歧：任务序号的作用域。** Todoist 按 `(project_id, section_id, parent_id)` 给任务编号，`child_order` 在每个板块内从 0 重新开始。本项目**不这么做**：`tasks.sort_order` 仍是 `(project_id, parent_id)` 下的单一序号，板块只是一个过滤维度。理由是排序模式 `Sort::Manual` 与既有的拖拽排序都直接读这一列，改成按板块分段会让「同一项目内跨板块的全局手工顺序」这一概念消失，并让排序/拖拽两条路径各自需要一套解释。代价是：同一板块内的任务序号不连续（可能 3、4、5），这不影响显示顺序，也不影响拖拽（拖拽按可见行重排后整体重写序号）。

**「无板块」列固定在最前**：列表渲染 `[null, ...sections]`，看板渲染 `[无板块, ...sections, 添加板块]`，与 Todoist 一致。无板块列没有拖动手柄、没有 `⋯` 菜单——它不是实体，不能被重命名、删除或换位。

**折叠状态**：板块折叠与否是**客户端偏好**，存在 `settings` 的 `ui.sections.collapsed`（`{ [projectId]: sectionId[] }`），不落在 `sections` 行上。Todoist 把它作为 `is_collapsed` 存在服务端；本项目是单机本地库，没有跨端同步需求，放进 KV 可以避免为一个纯显示状态引入一个 DTO 字段和一次写库。

**板块出现在哪里**：只有项目视图（含收件箱——它也是一个项目）。今天 / 即将到来 / 标签 / 搜索是跨项目的切片，没有分栏概念，因此不分组。

---

## 6. Rust 工作区结构

```
omnitodo/
├─ Cargo.toml                     # workspace
├─ crates/
│  ├─ omnitodo-core/              # 纯逻辑库，不依赖 Tauri
│  │  ├─ src/domain/              # Task, Project, Tag, Attachment, Filter, DTO
│  │  ├─ src/db/                  # pool 构造、PRAGMA、migrations、FTS 维护
│  │  ├─ src/repo/                # trait TaskRepo/ProjectRepo/... + sqlite 实现
│  │  ├─ src/service/             # TaskService, ProjectService, TagService,
│  │  │                           # AttachmentService, SearchService, ReminderService,
│  │  │                           # RecurrenceService, ImportExportService,
│  │  │                           # ReportService, QuickAddParser
│  │  ├─ src/error.rs             # thiserror 定义 CoreError
│  │  └─ src/config.rs            # 数据目录/DB 路径解析
│  ├─ omnitodo-desktop/           # Tauri 应用
│  │  ├─ src/main.rs              # 启动、状态注入、事件桥接
│  │  ├─ src/commands/            # 每个 service 对应一组 #[tauri::command]
│  │  ├─ src/tray.rs              # 系统托盘 + 菜单
│  │  ├─ src/shortcut.rs          # 全局快捷键 → 快捷添加窗
│  │  ├─ src/notify.rs            # 系统通知
│  │  ├─ src/mcp_http.rs          # 内嵌 MCP HTTP 服务（与 stdio 并存）
│  │  └─ tauri.conf.json
│  ├─ omnitodo-mcp/               # 独立 MCP server（stdio + http）
│  │  ├─ src/main.rs              # 参数：--db / --http --port / --read-only
│  │  ├─ src/tools/read.rs        # 只读工具实现
│  │  ├─ src/tools/write.rs       # 写工具（受开关控制）
│  │  └─ src/transport.rs
│  └─ omnitodo-cli/               # 可选：headless 导入导出 / 冒烟测试 / 维护命令
└─ ui/                            # React 前端（Vite 工程）
   ├─ src/routes/                 # Inbox/Today/Upcoming/Calendar/Project/Tag/Search/Settings
   ├─ src/components/             # TaskList, TaskRow, TaskDetail, ProjectSidebar...
   ├─ src/api/                    # invoke 封装 + Tauri 事件订阅 + Query key 约定
   ├─ src/stores/                 # Zustand：筛选、选中、主题、快捷键
   └─ src/i18n/
```

**分层规则**：`omnitodo-core` 不知道 Tauri、不知道 React、不知道 MCP。它只暴露 service 与 DTO。`omnitodo-desktop` 与 `omnitodo-mcp` 都是它的消费者。这条边界保证核心可单测、可 headless 运行。

---

## 7. 核心服务 API（Rust）

所有时间参数为 Unix 毫秒；所有返回为 DTO（非裸实体），避免前端依赖内部字段。

### 7.1 TaskService

```
create(input: CreateTaskInput) -> TaskDto
update(id, patch: TaskPatch) -> TaskDto
get(id, {with_children, with_tags, with_attachments}) -> TaskDetailDto
list(filter: TaskFilter) -> Page<TaskDto>
complete(id) -> TaskDto            # 触发完成历史 + 重复下一期派生
uncomplete(id) -> TaskDto
move(id, {project_id?, parent_id?, sort_order}) -> TaskDto
bulk_update(ids, patch) -> u32
delete(id) -> ()                   # 软删除；服务层按依赖顺序级联子任务/标签关联/提醒/附件（§5.7），managed 附件进入待 GC
add_subtask(parent_id, input) -> TaskDto
```

`TaskFilter`（read 侧核心契约，UI 与 MCP 共用）：

```
project_ids: Option<Vec<Id>>, tag_ids: Option<Vec<Id>>, tag_match: Any|All,
section_ids: Option<Vec<Id>>, unfiled_section: bool,        -- §5.9
priorities: Option<Vec<u8>>, statuses: Option<Vec<Status>>,
due_before/due_after: Option<i64>, start_before/start_after: Option<i64>,
has_attachments: Option<bool>, parent_id: Option<Id>,
root_only: bool, include_completed: bool, search_text: Option<String>,
sort: enum(due_asc|created_desc|priority_desc|manual),
limit: u32, offset: u32
```

### 7.2 其他服务

- **ProjectService**：`create/list(include_archived)/get(with_stats)/update/archive/reorder/delete`。`delete` 先按项目查出全部任务（含子树），再在**同一事务**内批量软删除任务及其标签关联/提醒/附件，最后软删项目（§5.7）。另提供 `find_similar(name)` 供快捷添加的选择框使用。
- **TagService**：`list/create/rename/merge(from,to)/delete`；改名后触发受影响任务的 `tags_text` 与 FTS 刷新。
- **SectionService**（§5.9）：`create/list(project_id)/get/update(name, sort_order)/reorder(ids)/delete(id, delete_tasks)`。`create`/`update` 校验项目内名称唯一（忽略大小写，`Conflict`）；`delete` 的两种语义见 §5.9；`ensure_section_in_project(section_id, project_id)` 是任务写路径共用的守卫。
- **AttachmentService**：`add_blob(task_id, path)`（默认）、`add_managed(task_id, path)`、`list(task_id)`、`get_data(id)`、`open(id)`、`remove(id)`、`gc()`。两种模式文件均由应用托管，**无"引用失效 / 重新定位"语义**。
- **SearchService**：`search(q, filter)`，内部走 FTS5 或 `LIKE` 回退，返回带高亮的 `TaskDto`。
- **ReminderService**：`due_now(now) -> Vec<ReminderHit>`、`mark_fired(task_id, occurrence_at)`、`next_for(task) -> Option<i64>`、`catch_up(since) -> Vec<ReminderHit>`。
- **RecurrenceService**：`expand(task, from, to) -> Vec<Occurrence>`；`next_after(task, after) -> Option<Occurrence>`。
- **ImportExportService**：`import_markdown/import_todotxt/import_todoist_json`、`export_json/export_csv/export_markdown`。
- **QuickAddParser**：`parse(text, now, tz, ctx) -> QuickAddDraft`，见 §12。纯规则实现，无网络调用。
- **ReportService**：见 §10。

### 7.3 错误模型

`omnitodo-core` 用 `thiserror` 定义 `CoreError`（`NotFound / Validation / Conflict(version) / Io / Db / Busy / Unsupported / AttachmentMissing / AmbiguousProject`）。Tauri 命令统一返回 `Result<T, ApiError>`，`ApiError { code, message }` 可被前端按 `code` 分支处理（例如版本冲突提示刷新、项目名歧义弹出选择框、`Busy` 提示重试、`AttachmentMissing` 指 managed 托管文件丢失）。

---

## 8. Tauri 命令与前端数据流

### 8.1 命令分组

命令一一映射 service（薄封装，不做业务）：

```
task_create / task_update / task_get / task_list / task_complete /
task_uncomplete / task_move / task_bulk_update / task_delete / task_add_subtask
project_* / project_find_similar
section_create / section_list / section_get / section_update / section_reorder
  / section_delete
tag_* / attachment_add_blob / attachment_add_managed / attachment_list
  / attachment_open / attachment_remove
search_query / quickadd_parse / quickadd_commit
calendar(from, to, project_id?)
settings_get / settings_set
mcp_status / mcp_http_start / mcp_http_stop / mcp_copy_client_config
reminder_snooze / reminder_mark_fired
import_run / export_run / report_summary
app_version / app_releases_url
```

### 8.2 事件（Rust → React）

`task:created`、`task:updated`、`task:deleted`、`project:changed`、`tag:changed`、`reminder:fired`、`settings:changed`、`mcp:http_state`（启动/停止/端口占用）、`mcp:write_toggled`。

前端在 `api/events.ts` 里集中订阅，收到事件后按约定 **invalidate 对应 Query key**（如 `['tasks', filter]`、`['task', id]`），实现跨窗口/托盘/agent 改动后的自动刷新。

### 8.3 数据流

```
React 组件 → invoke('task_list', {filter})
           → Tauri command → Core TaskService → Repo → sqlx → SQLite
           ← TaskDto[]
写入：invoke('task_update', {...}) → 事务写入(+FTS/op_log) → emit task:updated
      → 前端 Query 失效 → 重新拉取（勾选/快速改名走乐观更新，失败回滚）
外部写入（MCP 写工具）→ 独立进程写同一 core 事务 → 写成功后回调桌面应用控制端点（§4.5）
                    → 桌面应用 emit task:updated → 前端 Query 失效 → 重新拉取
```

---

## 9. 提醒与重复

### 9.1 调度

- 桌面应用内一个 tokio 定时任务，**每 30 秒** tick 一次：先 `materialize_due(now)` 把到期的重复期次落库（§5.5），再 `ReminderService.due_now` 处理提醒。
- 下一次触发时刻的计算优先级：`remind_at`（绝对）> `due_at - remind_offset_min`（相对）> 无。
- 触发前查 `reminder_fires` 去重（`PRIMARY KEY(task_id, occurrence_at)`），保证重启不重复通知。
- 触发动作：系统通知（`tauri-plugin-notification`）+ 未读徽标；点击通知经 deep-link `omnitodo://task/<id>` 聚焦到该任务。

### 9.2 应用未运行时的限制（必须写清）

桌面端**没有** OS 级定时唤醒能力（不像移动端可预排通知）。因此：

- 若应用未运行，任何提醒都不会触发。
- 缓解：默认开启**自启动**（`tauri-plugin-autostart`）；应用启动时调用 `catch_up(since=now-24h)`，把过去 24h 内漏掉的提醒聚合成**一条汇总通知**并展示"漏掉的提醒"面板。
- 这是明确的取舍，需在设置页向用户说明，避免"以为会提醒但没提醒"。

### 9.3 重复规则

- 采用 RFC 5545 子集：`FREQ`(DAILY/WEEKLY/MONTHLY/YEARLY)、`INTERVAL`、`BYDAY`、`BYMONTHDAY`、`BYMONTH`、`COUNT`、`UNTIL`。
- 计算以任务 `timezone` 为准（跨夏令时正确）。
- **物化**：期次的 `occurrence_at <= now` 时落成真实行（§5.5）；应用启动先 `materialize_due(now)` 补齐停机期间到期的期次（受单系列补齐上限约束）。
- 完成一期：**upsert** `task_completions`（`task_id` 唯一）并标记该行完成；`uncomplete` 则删除该 completion 行，避免"取消完成→再完成"重复计入吞吐 / on-time。**不再靠"完成"派生下一期**——下一期何时物化只由时间决定。
- 编辑系列：因每期是真实行，"仅此期"改该行、"此期及以后"改写规则（拆分系列）。

---

## 10. 报告能力

`ReportService.summary(query) -> ReportSummary`，参数：`from`、`to`、`group_by`(project/tag/priority/day/week)、`project_ids`、`include_completed`。

输出结构（同时被 MCP `summary_report` 工具与 UI 仪表盘复用）：

```
total, open, completed, overdue, due_soon(7d),
completed_in_window,                       # from/to 内、且任务仍在的完成数
by_project[{project, open, completed, overdue}],
by_priority[{priority, count}],
by_status[{status, count}],
by_tag[{tag, count}],
throughput[{period, completed}],          # 按 day/week 分桶
avg_time_to_complete_ms, on_time_rate,
overdue_list[TaskDto],                     # 截断到 N 条
upcoming_list[TaskDto]
```

设计要点：聚合在 **Rust 侧用 SQL 完成**（`GROUP BY` + 时间分桶），不把全量任务吐出去让别人算——既省 token 又保证数字一致。应用本身不做任何 LLM 润色；需要"人话周报"时由外部 agent 消费这份结构化结果自行生成（见 §11）。

**两套数据集，字段名要自己说清楚**：`total`/`open`/`completed`/`overdue`/`due_soon` 与 `by_*` 是**当前存活任务**（`deleted_at IS NULL`）的快照，不受 `from`/`to` 影响；`completed_in_window`/`throughput`/`avg_time_to_complete_ms`/`on_time_rate` 只看 `from`/`to` 窗口内的**完成事件**，且只统计任务仍存在的记录。`completed` 与 `completed_in_window` 因此可以不等——前者是"现在有多少件处于完成态"，后者是"这段时间完成了多少件"，软删除的任务会从后者中扣除。`throughput` 各项之和恒等于 `completed_in_window`。

---

## 11. MCP Server 设计

### 11.1 启动与配置

```
# stdio（给 Cursor / Claude Desktop；每个客户端各起一个实例）
omnitodo-mcp --db "~/.omnitodo/omnitodo.db"              # 默认只读

# HTTP（常驻服务，供脚本/多工具共用）
omnitodo-mcp --http --port 8787 --token <token>          # 仅监听 127.0.0.1
```

客户端配置示例（设置页按客户端分页给出，自动填入侧车的**绝对路径**与当前 token）：

```json
{ "mcp": { "servers": { "OmniTODO": { "type": "stdio",
  "command": "C:\\Program Files\\OmniTODO\\omnitodo-mcp.exe",
  "args": ["--db", "C:\\Users\\me\\.omnitodo\\omnitodo.db",
           "--notify", "http://127.0.0.1:8788/internal/notify",
           "--notify-token", "<token>"] } } } }
```

> 两处容易配错：`command` 必须是绝对路径（侧车随安装包放在应用目录下，不在 `PATH` 上，
> 且客户端配置文件不做 `${}` 展开）；`--notify-token` 的值**不要加引号**——`args` 是数组、
> 直接交给进程，引号会成为 token 的一部分，回调会被 401 拒绝。ZCode 的主配置文件用上面的
> 嵌套 `mcp.servers` 形状（`~/.zcode/cli/config.json`）；`.agents/mcp.json` 与多数其他
> 客户端用顶层 `mcpServers`，设置页的「通用 JSON」页签给的是那一份。

### 11.2 stdio 与 HTTP 可同时启用（不存在"模式切换"）

两种传输语义不同，**互不冲突，可并行运行**：

- **stdio 是"客户端拉起的进程"模型**：每个 MCP 客户端各自 spawn 一个 `omnitodo-mcp` 实例，彼此独立。应用侧不需要"开启"，只需 (a) 随包分发该二进制，(b) 在设置页生成并展示客户端配置片段。因此 stdio **始终可用**，有多少客户端就有多少实例。
- **HTTP 是一个监听 `127.0.0.1:<port>` 的常驻服务**：需要显式开关（要占端口），可与任意数量的 stdio 实例同时运行。

因此界面上**没有**"stdio / HTTP 二选一"的开关，只有两个独立区块：

| 区块 | 内容 | 开关 |
|---|---|---|
| stdio | 二进制绝对路径、"复制客户端配置"、已配置客户端列表 | 无需开关（随包可用） |
| HTTP | 启用开关、端口、token、状态指示灯（运行中 / 已停止 / 端口被占用） | 独立开关 |

并存的可行性来自 §4.3：WAL 支持"一写多读"，所有 MCP 实例默认只读打开，因此多进程并发安全。端口冲突时 HTTP 区块报错并允许改端口，不影响 stdio。

### 11.3 工具清单

**只读（默认启用）**

| 工具 | 说明 |
|---|---|
| `list_projects` | 项目列表 + 各项目 open/completed/overdue 计数。返回 `{items, count}` |
| `get_project` | 单个项目详情与统计。`id` 可以是项目 id，也可以是项目名 |
| `list_tasks` | 任务列表，分页。**默认只返回未完成**（`todo`/`in_progress`），见下方过滤参数 |
| `get_task` | 单任务详情：子任务、标签、附件元数据、重复规则 |
| `list_subtasks` | 指定任务的全部（递归）子任务。返回 `{items, count}` |
| `list_tags` | 标签 + 使用计数。返回 `{items, count}` |
| `list_sections` | 指定项目的板块 + 各自任务数。返回 `{items, count}` |
| `search_tasks` | 全文检索（FTS5 / LIKE 回退）。过滤参数与 `list_tasks` 相同，默认同样只搜未完成 |
| `list_upcoming` | 未来 N 天内未完成的开始/截止任务。返回 `{items, count}` |
| `list_due_reminders` | 未来提醒计划（含重复展开）。返回 `{items, count}` |
| `list_attachments` | 附件元数据（文件名、大小、sha256、blob/managed、托管路径；**不返回二进制**）。返回 `{items, count}` |
| `summary_report` | §10 的聚合报告（**核心**） |
| `list_calendar` | 窗口内的日历项（已物化任务 + 虚拟重复实例）。返回 `{items, count}`；可选 `project_id` 收窄到单个项目 |
| `export_tasks` | 按过滤条件导出 JSON/CSV/Markdown（仅序列化，不落盘）。过滤与默认范围同 `list_tasks` |

**过滤参数**（`list_tasks`/`search_tasks`/`export_tasks` 共用，扁平传入，不需要包进 `filter` 对象）：

| 参数 | 取值 | 作用 |
|---|---|---|
| `scope` | `open`（默认）/ `completed` / `all` | 未完成、已完成（`done`）、全部（含 `cancelled`） |
| `project` | 项目 id 或名称 | 精确 id 优先，否则按名称大小写不敏感匹配；子串只在唯一命中时接受 |
| `priorities` | `none`/`low`/`medium`/`high`/`urgent` 数组 | 按优先级过滤 |
| `statuses` | `todo`/`in_progress`/`done`/`cancelled` 数组 | 精确状态，会覆盖 `scope` |
| `due_after`/`due_before` | unix 毫秒 | 截止时间范围 |
| `start_after`/`start_before` | unix 毫秒 | 开始时间范围 |
| `completed_after`/`completed_before` | unix 毫秒 | 完成时间范围 |
| `limit`/`offset` | 整数 | 分页，默认每页 100，上限 1000 |

取值非法直接返回 validation 错误，**不静默丢弃**。此前 `status`、`project_name` 这类不存在的字段名会被 serde 忽略，调用方看到的是"成功但空结果"，比报错更难排查。

**返回值一律是 JSON 对象**。MCP 客户端要求 `structuredContent` 为 record，数组会被以 `expected record, received array` 拒绝，连文本内容一起丢弃。列表类工具因此统一包成 `{items, count}`，分页类返回 `{items, total, limit, offset}`。

**写（`settings.mcp.write_enabled=true` 才注册；每次调用写 `mcp_audit`）**

`create_task`、`update_task`、`complete_task`、`delete_task`(软删)、`add_subtask`、`add_tags`、`move_task`、`create_section`、`update_section`、`delete_section`。

> 写工具一律使用**精确字段**（`title`、`priority`、`due_at`、`project_id`、`parent_id`、`tag_ids`…），不接受简写语法字符串——简写解析（§12）只服务于本应用 UI，**不通过 MCP 暴露**。见 §12.5。
>
> 写工具提交事务成功后调用桌面应用控制端点做刷新回调（§4.5）；回调失败不影响写结果。写开关在**会话初始化时**决定工具是否注册，运行中改开关需客户端重连才生效（§18）。

**Resources / Prompts（可选增强）**：`omnitodo://projects`、`omnitodo://task/{id}`；`weekly_review`、`daily_plan` 提示模板。

### 11.4 安全边界

- HTTP 仅绑定 `127.0.0.1`，需 `Authorization: Bearer <token>`；token 存 `settings.mcp.http_token`，首次启动生成一次，设置页可见可重置，修改后立即生效。
- stdio 默认以 `SQLITE_OPEN_READONLY` 打开 DB（不写数据；仍需数据目录可写以维护 `-shm`，§4.3）。
- 写工具默认不注册；开启后仍受 `mcp_audit` 审计。
- 内部控制端点（§4.5）同样只绑定 `127.0.0.1` 且需 token，仅接受本机 MCP 的"刷新通知"，不返回任何数据。
- 无遥测、无外联。应用自身不发起任何外部网络请求。

---

## 12. 简写快速添加语法

全局快捷键唤起快捷添加窗，输入一行文本即可建任务。解析放在 `omnitodo-core` 的 `QuickAddParser`（Rust），**UI 与 CLI 共用同一实现**。纯规则解析，不联网、不调模型。

### 12.1 Token 规则

所有 token 可选；剥离 token 后剩下的文本即任务**标题**。

| Token | 含义 | 示例 |
|---|---|---|
| `!p0`..`!p4` 或 `!紧急/!高/!中/!低/!无` | 优先级 | `!高`、`!p3` |
| `@标签名` | 添加标签（不存在则创建） | `@工作`、`@deep-work` |
| `#项目名` | 归入项目（**不存在则弹选择框**） | `#OmniTODO` |
| `^日期` | **截止时间** | `^明天`、`^2026-10-20`、`^10/20` |
| `>日期` | **开始时间** | `>下周一` |
| `~时长` | 提醒偏移（相对截止） | `~30m`、`~2h`、`~1d` |
| `*规则` | 重复规则 | `*daily`、`*weekly`、`*每周一,三,五` |
| `::描述` | 冒号后为描述（Markdown） | `::记得附上上周数据` |

### 12.2 `#项目名` 的解析策略（弹选择框）

用户输入往往很快，项目名容易打错或记不全，因此**不做静默创建**：

1. 精确匹配（忽略大小写）→ 直接归入。
2. 无精确匹配但有模糊命中（前缀/子串/编辑距离阈值）→ **弹选择框**，列出候选项，用户点选。
3. 完全无命中 → 选择框里提供"**新建项目「xxx」**"作为首项，以及最近使用的项目列表。
4. 若用户直接关掉选择框 → 该 token 回退为普通文本，任务归入 Inbox（不静默建项目、不丢字）。

解析只产出 `QuickAddDraft`（含 `project_name` 与 `project_candidates`），**落库在 `quickadd_commit` 时才发生**，且必须以用户确认的项目 id 为准。

### 12.3 自然语言片段

日期/时间/重复既接受中文关键词，也接受数字与相对写法：

- 日期：`今天 / 明天 / 后天 / 大后天 / 下周一..下周日 / 周三 / 10/20 / 2026-10-20 / +3d`
- 时刻：跟在日期后 `09:00`、`18:30`、`下午3点`；无日期单独给时刻则默认今天
- 重复：`每天 / 每周 / 每月 / 每周一,三,五 / every-mon`
- 优先级词：`紧急 / 重要 / 高 / 中 / 低`
- 时区：取应用设置默认时区

### 12.4 示例

```
写周报 !高 @工作 #OmniTODO ^明天 ~30m
买菜 #生活 ^今天
健身 *每周一,三,五 ^明天 09:00
评审设计稿 !紧急 @设计 ^周五 18:00 ::重点看交互流程
```

### 12.5 实现与边界

- 纯规则解析（`chrono` + 手写 tokenizer），覆盖绝大多数输入，**零网络、零延迟**。
- 规则未命中的模糊短语（如"下周五之前搞定"）**不做智能兜底**，原样留在标题里，由用户手动改。这是"不做 AI"的必然结果，也是可接受的：快捷添加追求确定性，不追求聪明。
- 快捷添加窗实时显示解析结果 chips（项目/标签/优先级/日期/提醒/重复），**用户确认后**才落库。
- `quickadd_parse` 命令供 UI 实时预览；`quickadd_commit` 才写库。
- **不通过 MCP 暴露简写解析工具**：外部 agent 应直接传结构化字段（§11.3），语义更明确、无需猜测简写约定。

---

## 13. 前端设计

### 13.1 视图

- **Inbox / Today / Upcoming**：默认筛选的三条快捷入口。
- **Calendar**：月/周视图，展示 `start_at`/`due_at`；未来重复期次为**虚拟展开（只读）**，已物化期次可拖拽改期。项目视图内的日历带上 `project_id`（§8.1），只显示该项目的期次。
- **Project 视图**：左侧项目列表（含计数），右侧在**列表 / 看板 / 日历**三种模式间切换（选择存在 `ui.project.view_mode`）：
  - **列表**：按板块分组的任务列表——`[无板块, ...板块]`，每组一个可折叠标题（名称 + 计数 + 悬停「＋」直接在该板块新建任务 + `⋯` 菜单：重命名 / 上移 / 下移 / 删除），末尾一行「添加板块」。
  - **看板**：一列一个板块，列宽 286px，顺序为 `[无板块, ...板块, 添加板块]`；卡片只渲染顶层任务，显示日期、`#标签` 与子任务进度；列头为「名称 + 计数 + 拖动手柄 + `⋯`」，列脚为「添加任务」。
  - **日历**：`CalendarBoard` 的嵌入式实例，按项目过滤。
- **Tag 视图**：按标签横切（跨项目切片，不分组）。
- **Search**：全文搜索 + 结果高亮。
- **Settings**：
  - 通用：主题、默认项目、周起始日。
  - 提醒与自启动。
  - **MCP 面板**：stdio 区块（二进制路径 + 复制客户端配置）、HTTP 区块（独立开关 + 端口 + token + 状态灯 + 复制配置）、写权限开关（附风险说明与审计入口）。
  - **关于**：版本号 + Releases 地址（手动更新，§15）。

### 13.2 关键交互

- 任务行内快速完成（乐观更新）、优先级/日期就地编辑。
- 任务详情面板：Markdown 描述（textarea + 预览，v1 不引富文本编辑器）、子任务清单、标签选择、**板块选择**（顶层任务可选「无板块」或本项目任一板块；子任务该项禁用并显示「子任务跟随父任务」）、附件（**拖入即上传**，默认存库为 BLOB，可切托管文件；超限时提示）、重复规则编辑器。
- `dnd-kit` 支持同列表排序与跨项目/跨父级拖拽。
- **看板拖拽**（§5.9）：卡片可拖到同列的其他位置、拖到别的列的卡片之间、或拖到列体空白处（追加到该列末尾）。跨列落点写成两条命令，与 Todoist 一致——先 `task_update` 写 `section_id`，再 `task_reorder` 写新序号；列与列的换位走 `section_reorder`。看板自带一个嵌套的 `DndContext`：这里的落点同时决定「哪一列」和「哪个位置」，而应用级的落点解析是按任务行算的，在看板上这些行散落在各列里。碰撞检测按拖拽类型过滤候选，再取面积最小者——卡片因此胜过它所在的列体，列拖动也不会落进卡片列表。
- **日历点选建任务**：点日期格的空白处打开快捷添加，并预填该日的**全天**截止日期；在项目日历里同时预填该项目（落库进该项目，而非收件箱），面板用 `#项目名` chip 把它显示出来。日期取自该格自己的分组键，所以任务必然落在被点的那一格。
- 快捷添加：侧栏「添加任务」按钮或全局快捷键唤起一个**悬浮输入框**（左「＋」字段菜单 / 中任务名称 / 右「×」关闭，不含 AI 区）；「＋」菜单逐条列出简写字段并在右侧给出该字段的简写示例，点选即在光标处插入 token。使用 §12 简写语法并实时解析预览；`#项目` 歧义时弹选择框。回车落库，Esc / 点击面板外关闭。

### 13.3 Query key 约定（示例）

```
['projects']  ['project', id]  ['tasks', filter]  ['task', id]
['tags']      ['search', q, filter]              ['report', query]
['mcp','httpState']  ['mcp','clients']
```

---

## 14. 测试策略

| 层 | 手段 |
|---|---|
| `omnitodo-core` | 每个 service 用临时文件 SQLite 做单测；重复规则与筛选器用属性测试（proptest）；迁移测试（空库 → 最新 → 回滚校验） |
| 快速添加 | 词法/规则解析的表格驱动用例，覆盖全部 token 与中文关键词、边界日期（跨月/闰年/时区）、`#项目` 歧义分支（精确/模糊/无命中/取消） |
| 附件存储 | blob 写入/读取/去重、managed 内容寻址与 GC、删除任务后附件清理的用例 |
| 数据一致性 | 级联删除、FTS 同步、托管模式下附件 GC 的针对性用例 |
| `omnitodo-mcp` | 集成测试：spawn 进程走 stdio，逐个调用工具断言 JSON；工具 schema 快照测试；只读实例写入必须失败；HTTP 与 stdio **同时**运行时并发读写一致性；写工具回调控制端点（应用在/不在两种情形） |
| 前端 | Vitest + React Testing Library（hooks / 组件）；`tauri-driver` + WebdriverIO 跑关键 E2E（新建任务→提醒→MCP 读到→HTTP 模式同步可见） |
| 跨端 | 三端手工冒烟清单：托盘、通知、全局快捷键、附件上传/打开、打包产物可启动 |

---

## 15. 构建、分发与更新

- **打包**：Tauri 2 bundler 产出 Windows（MSI/NSIS）、macOS（`.dmg`/`.app`）、Linux（`.deb`/`.rpm`/AppImage）。
- **MCP 二进制随包分发**：安装包内附带 `omnitodo-mcp`；设置页 MCP 面板显示其绝对路径，并提供"复制客户端配置"按钮生成 §11.1 的 JSON 片段。
- **不做自动更新**：不引入 `tauri-plugin-updater`，不内置更新检查与静默下载。
- **更新方式**：应用在设置页（及"关于"）展示 Releases 地址，用户手动下载对应平台安装包覆盖安装，数据目录与 DB 不受影响。
  - `https://github.com/yunqilee69/OmniTODO/releases`
  - 设置项 `app.releases_url` 可配置，便于将来换组织/镜像。
- **版本可见性**：关于页显示当前版本号与 Releases 链接；启动不做联网检查（符合本地优先与无遥测原则）。
- **仓库**：`git@github.com:yunqilee69/OmniTODO.git`，先本地开发，暂不推送。

---

## 16. 交付分期

| 阶段 | 内容 | 产出验证 |
|---|---|---|
| P0 | workspace 骨架、DB schema + 迁移、`omnitodo-core` CRUD、`omnitodo-cli` 冒烟 | CLI 能建项目/任务并查回 |
| P1 | Tauri 壳 + React 列表/详情/CRUD（项目、任务） | 三端能跑起、能增删改查 |
| P2 | 子任务、标签、**附件（BLOB / 托管文件）**、系统托盘 + 快捷添加 | 附件可上传/打开/删除；托管文件可 GC |
| P3 | **简写快速添加语法**（含 `#项目` 选择框）、提醒调度、重复规则、日历视图 | 简写解析正确；到点弹通知；重复按期派生 |
| P4 | 全文搜索（FTS5）、导入导出 | 中文子串可搜；Markdown/Todoist 可导入 |
| P5 | **MCP Server**：stdio + HTTP **同时可用**、只读工具 + `summary_report` | Cursor 与本地脚本可同时读到一致数据 |
| P6 | MCP 写工具（受开关）+ 审计、打包分发、Releases 手动更新 | 三端安装包；写工具默认关闭 |
| P7 | **追加（原计划外）**：板块（§5.9）、看板视图、项目视图的列表/看板/日历切换、项目内日历、任务详情弹窗的板块字段 | 板块可建/改名/换位/删除且两种删除语义都对；看板可换列与列内排序、列可换位；项目日历点选即在该日建任务并归入该项目 |

---

## 17. 风险与取舍

1. **应用未运行时提醒不触发** —— 桌面端固有限制，靠自启动 + 启动补偿缓解（§9.2）。
2. **附件存储的代价** —— blob 模式会让 `omnitodo.db` 及其 WAL 变大（大文件写入产生大 WAL 段），managed 模式的托管文件可能被用户误删；靠大小阈值、写入即算 `sha256`/校验、`AttachmentMissing` 检测缓解（§5.6）。
3. **重复任务物化行数增长** —— "到期即物化"会积累历史行（含从未完成的逾期行），停机久了启动会一次性补齐；靠 `UNTIL`/`COUNT`、单系列补齐上限（§18）与归档控制，报告只扫时间窗。
4. **中文全文搜索质量** —— `trigram` 最小 3 字符，短词回退 `LIKE`；必要时后续接 ICU 分词。
5. **多进程 SQLite** —— 依赖 WAL + 只读打开 + 短事务；stdio 多实例与 HTTP 并存正是建立在此之上。注意只读 MCP 仍需**数据目录可写**（`-shm`），且数据目录**不能放同步盘/网络盘**，否则 WAL 有损坏风险（§4.3）。
6. **HTTP 端口冲突** —— 端口被占用时 HTTP 区块报错，可改端口；不影响 stdio（§11.2）。
7. **简写解析不做智能兜底** —— 模糊短语不猜，原样留标题；这是"不做 AI"的取舍（§12.5）。
8. **v1 范围大** —— 含重复、日历、双传输 MCP，务必按 §16 分期交付。
9. **macOS 分发** —— 需开发者证书与公证（notarization），否则用户侧被 Gatekeeper 拦。
10. **Tauri WebView 差异** —— 三端 WebView 内核不同（WebView2 / WebKit / WebKitGTK），CSS 与日期控件需实测。

---

## 18. 已定的实现默认值（如需调整请指出）

以下几处是我自行定的默认值，未单独提问，列出来供你否决：

1. HTTP 端口默认 `8787`，token 自动生成、可在设置页重置。
2. MCP 写工具命名与粒度按 §11.3；`delete_task` 为软删除。
3. 周起始日默认**周一**；时区默认取系统时区。
4. 附件默认 `blob`（存库），单文件默认上限 8 MB；超限或用户选择时走 `managed`（托管文件）。
5. `#项目名` 选择框在用户取消时，该片段回退为标题文本，任务进 Inbox。
6. 简写解析的模糊匹配阈值（编辑距离/前缀）在实现时标定，默认偏保守（宁可不匹配也不误匹配）。
7. 重复期次默认全量补齐物化；单系列一次补齐上限默认 200 行，超出时保留系列锚点并在 UI 提示。
8. 内部控制端点（MCP 写回调，§4.5）默认端口 `8788`，与 MCP HTTP 的 `8787` 区分；token 首次启动生成一次，存 `settings.mcp.control_token`，设置页可修改并立即生效。
9. 附件托管目录取 `<数据目录>/.omnitodo/attachments/`（**已定**：随应用数据目录，不放工作区/项目目录）。
10. v1 不提供软删除恢复入口（`deleted_at` 主要服务于将来的同步墓碑）。
11. 全天任务按"民用日期在 UTC 的零点"存储，展示与重复计算不做时区换算（§5.1）。
12. FTS 命中经 `task_id UNINDEXED` 回表；`trigram` 需 SQLite ≥ 3.34，P0 迁移加断言锁定。
13. 完成任务 = upsert `task_completions`（`task_id` 唯一），取消完成 = 删行，杜绝重复计数。
14. `op_log` 保留 30 天、由维护任务裁剪；软删除实体的物理清理**默认关闭**（§5.8）。
15. 重复期次逾期**不自动滚动**（保留历史与真实统计）。
16. 删除板块**默认只释放任务**（回到「无板块」），不删任务；Todoist 那种"连任务一起删"作为对话框里的显式勾选项（§5.9）。
17. 板块折叠状态存 `settings` 的 `ui.sections.collapsed`，不落到 `sections` 行上（§5.9）。
18. 项目视图的列表/看板/日历选择存 `ui.project.view_mode`，默认 `list`。
19. 项目内看板与列表共用同一条手工序号（`(project_id, parent_id)` 下的 `sort_order`），不按板块分段编号（§5.9 的分歧说明）。
