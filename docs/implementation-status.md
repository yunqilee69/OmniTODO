# 实现进度（对照设计 §16 交付分期）

本机无 GUI 环境，但**页面级冒烟已用虚拟显示（Xvfb）真实跑通**：启动打包好的应用、
用合成点击/按键走完各页面，并核对点击确实写进了数据库（见「页面级冒烟」一节）。
后续在一台有 Aqua 会话的 macOS 上又补做了**真实桌面冒烟**与 **macOS 打包**（见
「真实桌面冒烟（macOS）」与 [`docs/packaging.md`](./packaging.md)）。剩下未闭环的
只剩 Windows（MSI、真机运行）与签名、公证这类需要证书和对应平台的部分。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `cargo test --workspace` | **38 passed / 0 failed**（core 31 + mcp 7） |
| `cargo clippy --workspace --all-targets` | 0 warning |
| `cargo clippy -p omnitodo-desktop --all-targets` | 0 warning（在 `rust:1-trixie` 容器内，见 `scripts/package-linux-docker.sh`） |
| `cd ui && npm test` | **64 passed / 10 文件**（vitest） |
| `cd ui && npm run build` | `tsc --noEmit`（strict + `noUnusedLocals`）+ `vite build` 成功 |
| `scripts/smoke-gui-xvfb.sh` | **15 张页面截图 + 5 项数据库/像素断言通过**（见下） |
| `scripts/smoke-notification-xvfb.sh` | **系统通知真弹出**：dunst 收到带任务标题的通知、恰好一条、气泡区域像素变化（见下） |
| `scripts/smoke-shortcut-xvfb.sh` | **全局快捷键真能用**：`Ctrl+Shift+Space` 打开快速添加（见下） |
| `scripts/smoke-deeplink-xvfb.sh` | **deep-link 真能用**：`omnitodo://task/<id>` 聚焦到指定任务（见下） |
| `scripts/package-linux-docker.sh deb,appimage` | deb 11.1 MiB + AppImage 111.1 MiB 产出成功 |
| `scripts/package-windows-cross.sh nsis` | NSIS 安装包 6.2 MiB 交叉构建成功（载荷已核对，未签名、未在 Windows 跑过） |
| `scripts/package.sh dmg,app`（macOS 14 / arm64，Xcode 26.6） | `.app` 23.5 MiB + `.dmg` 9.0 MiB，**挂载后核对内容**（见下） |
| 真实桌面冒烟（macOS Aqua 会话） | 应用真起窗口、页面渲染、灌库后刷新、`omnitodo://task/<id>` 聚焦任务（均真实截图确认，见下） |

Linux/Windows 三个产物都重新构建过（不是复用上一轮的旧包）：改动后重跑 `tauri build`，
再把新包装进容器、核对内容，最后跑一遍页面级冒烟。macOS 的 `.app`/`.dmg` 也是本轮从零
构建（先删旧产物，再跑 `scripts/package.sh dmg,app`）。

打包产物的验证（在容器内实测，非仅构建成功）：

| 检查 | 结果 |
|---|---|
| `apt-get install ./OmniTODO_0.1.0_amd64.deb` | 安装成功，依赖全部解析 |
| `dpkg -L omni-todo` | `/usr/bin/omnitodo-desktop`、`/usr/bin/omnitodo-mcp`、`.desktop`、三档 hicolor 图标 |
| `/usr/bin/omnitodo-mcp --version` | `omnitodo-mcp 0.1.0` |
| `ldd /usr/bin/omnitodo-desktop` | 无 `not found` |
| `AppImage --appimage-extract` | `AppRun`、`.desktop`、图标、`usr/bin/{omnitodo-desktop,omnitodo-mcp}` 齐全 |
| 从 AppImage 解包目录运行侧车 | `omnitodo-mcp 0.1.0` |
| 前端确实打进去了 | 安装后的 `/usr/bin/omnitodo-desktop` 内含 `assets/index-<hash>.js` 键，与 `ui/dist/assets/` 的哈希逐一对得上（资源体压缩存储，故按资源名核对） |

## 页面级冒烟（虚拟显示）

本机没有 GUI 会话，但页面级验收不是靠"相信它能跑"：`scripts/smoke-gui-xvfb.sh`
把**安装好的产物**跑在 Xvfb 虚拟屏上，用 `xdotool` 合成点击/按键走完各个页面，
每步截图，并断言点击真的落到了 SQLite。

```bash
# 容器/CI 里（需要 xvfb xauth dbus-x11 xdotool imagemagick fonts-noto-cjk）
scripts/smoke-gui-xvfb.sh --bin /usr/bin/omnitodo-desktop \
                          --cli /build-target/release/omnitodo
```

跑完输出 `artifacts/smoke/NN-*.png`，逐张肉眼可见：

| 截图 | 覆盖内容 |
|---|---|
| `01-inbox` | 侧栏（搜索框 / 六条入口 / 项目计数 / 标签计数）、任务行（优先级色块、标签、截止文案、重复 ↻ 标记） |
| `02-task-detail` | 详情面板：标题、已完成、优先级、开始/截止、全天开关、项目下拉、描述、重复编辑器、标签、附件 |
| `03-today` / `10-inbox-final` | Today 筛选；Inbox 只列**未归档**任务 |
| `04-calendar` | 月视图：今天高亮、已物化期次（实心、可拖）与重复规则的未来期次（虚线虚拟） |
| `05`/`06-quickadd` | 简写输入与实时解析预览（`!urgent` / `@review` / `^tomorrow 09:30` → 标题 + 各字段 chips） |
| `07-project` | 项目视图：未完成/已完成/逾期统计、⠿ 拖拽手柄、侧栏悬停出现删除按钮 |
| `08-settings` | 通用（主题/默认项目/周起始日）、提醒与自启动、MCP 面板 |
| `09-search` | 端到端全文搜索（真实 FTS5）：命中项高亮 |
| `11-completed` | 详情面板勾选「已完成」→ 列表行即时划掉 |
| `12`/`13-reminder`（卡片 → 稍后） | 错过的提醒卡片（标题、提醒时间、三个「稍后」按钮）；点「稍后 10 分钟」后卡片消失 |
| `14-attachments` / `15-attachment-deleted` | 附件区块：`shopping-list.txt`（库内存储，大小 + `×` 删除控件）；删除后回到「暂无附件」 |

五项程序化断言（失败即 `SMOKE FAILED`，退出码非 0）：

1. **点击确实写库**：UI 勾选完成后，用 CLI 独立读库确认 `status == done` 的任务数为 1；
2. **Inbox 语义**：库中 `project_id IS NULL` 的任务数为 3，与截图里 Inbox 的行数一致；
3. **稍后提醒真的改了库**：点过「稍后 10 分钟」后，该任务 `remind_at` 已被推到未来，
   且旧期次的 `reminder_fires` 行被清掉（否则第二次会被去重压掉，设计 §9.1）；
4. **附件确实删掉了**：在详情面板点附件行的 `×` 之后，库中该附件 `deleted_at IS NOT NULL`，
   即软删除真的落到了 SQLite（不是只在界面上消失）；
5. **卡片确实被点掉了**：`12`/`13` 两张图右下角区域的灰度均值必须变化，
   证明那次点击落在了卡片按钮上而不是打在空处（避免"断言过了但界面没动"）。

## 真实桌面冒烟（macOS）

「真实桌面会话里的人工过一遍」一直记在待办里（原开发机是 Linux、无 GUI）。
这次在一台有 Aqua 会话的 macOS（arm64，Xcode 26.6）上，用 `tauri build` 出的 `.app`
直接跑真机验收，每步用 `screencapture` 抓**真实显示器**画面（不是 Xvfb）：

| 项 | 怎么验的 | 结果 |
|---|---|---|
| 窗口真能起、页面不白 | `open OmniTODO.app`，抓窗口 | 侧栏（搜索框 / 六条入口 / 项目 / 标签计数）与 Inbox 空态正常渲染，中文无豆腐块 |
| 数据真能显示 | 先用 CLI 往默认库（`~/Library/Application Support/OmniTODO/omnitodo.db`）灌 1 项目 + 3 任务（含重复规则与标签），再启动应用 | 侧栏出现「工作 2」「#汇报 1」「#设计 1」，Inbox 只列未归档的 `评审设计稿`（项目内任务不出现），优先级色块与截止文案正确 |
| 详情面板 | 由 deep-link 打开指定任务 | 标题 / 已完成 / 优先级 / 开始 / 截止 / 全天 / 项目 / 描述(Markdown) / 重复 / 标签 / 附件 各控件齐全 |
| deep-link 真能聚焦 | `open "omnitodo://task/<id>"` | 详情面板打开并聚焦到该任务；**进程数仍为 1**（`single-instance` 把第二个进程的 URL 转交给既有窗口） |

macOS 上 `omnitodo://` 由 `Info.plist` 的 `CFBundleURLSchemes` 注册（与 Linux 的
`.desktop` `x-scheme-handler` 方式不同），本次在真机确认可用 —— 即设计 §9/§11 要求的
「点通知经 deep-link 聚焦任务」在第二个平台上的落地验证。仍建议在 Windows 真机再确认一次。

## 分期对照

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| P0 | workspace 骨架、DB schema + 迁移、core CRUD、CLI 冒烟 | ✅ | `crates/omnitodo-core/migrations/0001_init.sql`；`tests/core_tests.rs`；CLI `init/project/task/status` 实跑通过 |
| P1 | Tauri 壳 + React 列表/详情/CRUD | ✅ 代码 + 页面级冒烟 + 真机 | `omnitodo-desktop/`（52 个 command）release 编译 + clippy 0 warning；Xvfb 冒烟实测窗口能起、各页面渲染正确、点击写库（见上节）；**已在 macOS 真实桌面会话补验**窗口渲染与数据刷新（见「真实桌面冒烟（macOS）」）；只剩托盘右键菜单、拖拽手势需真实桌面人工点击 |
| P2 | 子任务、标签、附件（BLOB / 托管文件）、托盘 + 快捷添加 | ✅ 逻辑层 + 页面级 | 子任务深度/递归、标签合并改名、附件 blob/managed/GC 均有测试；**附件已通过真实 UI 走完列表→删除并断言软删除落库**（`14-attachments` / `15-attachment-deleted`，见上节断言 4）；**全局快捷键已用合成按键实测**（`scripts/smoke-shortcut-xvfb.sh`）；托盘右键菜单需真实桌面会话 |
| P3 | 简写快速添加、提醒调度、重复规则、日历视图 | ✅ 逻辑层 + 页面级冒烟 | `quickadd` 表格用例、`recurrence` 展开/物化幂等、`reminder` 去重与稍后提醒、`calendar` 物化+虚拟期次合并均有测试；**到点弹系统通知已在虚拟显示下真实验证**（`scripts/smoke-notification-xvfb.sh`：dunst 收到带标题的通知、气泡像素比对、恰好一条），失败时降级为应用内提醒卡片；`04-calendar` 实测月视图与虚拟期次、`05/06-quickadd` 实测实时解析 |
| P4 | 全文搜索（FTS5 trigram）、导入导出 | ✅ | FTS 中文子串 + <3 字符 LIKE 回退测试；三种导入源（Markdown / todo.txt / Todoist JSON）与 JSON/CSV/MD 导出均有测试，Todoist 导入还会按需建项目、还原子任务层级；`09-search` 实测端到端搜索与高亮，`Settings` 内一键导入导出 |
| P5 | MCP：stdio + HTTP 同时可用、只读工具 + `summary_report` | ✅ | `tests/mcp_tests.rs` 含真实二进制 stdio 与 HTTP 端到端；只读实例写库被拒测试 |
| P6 | MCP 写工具（受开关）+ 审计、打包分发 | ✅ Linux + Windows(NSIS) + macOS(.app/.dmg) / ⚠️ MSI·签名公证 | 写工具开关 + `mcp_audit` 测试通过；Linux `deb`/`AppImage` 已构建、装包后跑通页面级冒烟；Windows NSIS 安装包在 Linux 上交叉构建产出并核对载荷（未签名、未在 Windows 运行）；**macOS `.app`(23.5 MiB)/`.dmg`(9.0 MiB) 已在 macOS 构建机产出、挂载核对并真机运行**（见打包文档）；MSI（需 WiX/Windows）、macOS 签名/公证、Releases 上传需对应环境与证书 |

## 与设计的两处实现偏差

1. **MCP 协议自实现，未用 `rmcp` crate**。设计 §3 指定 `rmcp`，但其 3.x API
   在本环境下不可验证。MCP 的 `initialize` / `tools/list` / `tools/call` /
   `resources/list` 与 JSON-RPC 2.0 编解码较小且规范明确，故直接实现，并用
   真实二进制跑通了 stdio 与 HTTP 端到端测试（`mcp_tests.rs`）。
2. **重复规则自实现，未用 `rrule` crate**。设计 §3 指定 `rrule`，但为保证
   可离线构建与可测试性，实现了文档限定的 RFC 5545 子集
   （DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/BYDAY/BYMONTHDAY/BYMONTH/COUNT/UNTIL），
   含跨短月夹取与中文简写，表格用例覆盖。

两处均为**可替换**：接口稳定后如需换回上游 crate，只影响 `tools.rs` /
`recurrence.rs` 两个文件。

## 验收过程中发现并修掉的缺陷

页面级冒烟与真实交互暴露了 4 个代码层测试没覆盖到的问题（1–4），
随后对照设计接口清单又补了 3 处漏做的交付物（5–7）；均已修复并补测试：

1. **CLI `--project` 只认 id**：`task add --project 工作` 报 `not found: project 工作`，
   而 `--tag` 却能按名字传。现在 `TaskCore::resolve_project_id` 同时接受 id 与名字
   （精确名优先、大小写不敏感；只有唯一子串候选才接受，否则报
   `AMBIGUOUS_PROJECT` 并列出候选），`task add` / `task list` 都走它。
2. **CLI `--due` / `--start` 只认 epoch 毫秒**：`--due 2026-10-12` 报
   `invalid digit found in string`。新增 `parse_when`，复用简写语法的日期解析器，
   接受 `2026-10-12`、`2026-10-12 18:30`、`明天 下午3点`、`+3d` 与原始毫秒；
   纯日期视为全天（civil date，UTC 零点），带时间则为时刻。
3. **Inbox 把项目内任务也列了出来**。设计 §12.2 写明「取消 `#project` 选择框 → 任务进
   Inbox」，即 Inbox 应只含未归档任务；实现里 `inboxFilter()` 却没有项目条件。
   新增 `TaskFilter.unfiled`（SQL `project_id IS NULL`），Inbox 用它过滤。
4. **空 `datetime-local` 在 WebKit 里显示灰色示例日期**（如 `10/12/2026, 12:30 PM`），
   看着像已填值。确认只是占位样式（该字段灰度均值 0.964 vs 真实值的 0.906，且库里
   `start_at` 为 NULL），未改代码，记录备查。

另外在做完页面级验收后对照设计 §9 逐条核对接口清单，发现**漏了一个交付物**：

5. **`import_todoist_json` 没实现**。设计 §9 明确写 `import_markdown /
   import_todotxt / import_todoist_json`，§16 P4 的验收也写「Markdown/Todoist 可导入」，
   而代码里只有前两个（Todoist 的入口被当成了 todo.txt）。现已补上：
   接受 Todoist 的 items 数组或带 `items`/`projects` 的对象，映射
   `content`/`description`/`priority`(1–4)/`labels`/`checked`/`due.date|datetime`/
   `project_id`/`parent_id`，按需创建项目、并重映射源 id 让子任务层级得以还原。
   顺手把 CLI 与桌面命令里各自复制的一份格式分发收进 `Core::import_run`，
   并修掉 todo.txt 解析中注释与代码不符的地方（注释说 `+project` 折进标签，
   代码却把它留在标题里；现在它正确地作为项目名处理）。

同一轮对照 §8.1 的接口清单又发现两处「声明了但没做」的提醒能力（6–7），
以及一处「做了开关但没人读」的死设置（8）；补齐后重跑冒烟又暴露三个只在真窗口里
才出现的问题（9–11）。再加上装上通知守护进程 / 接上全局快捷键后抓到的两个（12–13）。
5–6 有新增单元测试；7、10–14 只有真正把应用跑起来才会暴露（事件早于监听、缺 emoji
字体、通知重复、快捷键无人接收这类问题单测测不出来），已由冒烟覆盖：

6. **`reminder_snooze` 完全没实现**。设计 §8.1 声明了
   `reminder_snooze / reminder_mark_fired` 两个命令，代码里只有后者。现已补上
   `Core::snooze_reminder`（把 `remind_at` 推到 `now + minutes`、清掉该期次的
   `reminder_fires` 行让第二次不再被去重压掉、并写审计日志；合法范围 1–10080 分钟）
   与对应的 Tauri 命令，界面上的提醒卡片带「稍后 10 分钟 / 1 小时 / 明天」三个按钮。
7. **到点只发事件、不弹通知**。§16 P3 的验收写的是「到点弹通知」，而
   `spawn_reminder_task` 之前只 `app.emit("reminder:fired")`，没有任何系统通知。
   现在每条到点提醒都会用 `tauri-plugin-notification` 弹一条系统通知，错过的提醒
   聚合成一条；前台另有 `ReminderToasts` 卡片兜底（无通知守护进程的桌面环境、
   以及需要按钮的「稍后提醒」场景 —— 系统通知带不了按钮）。
8. **设置里的「启用提醒」是死的**。`reminder.enabled` 只在设置页读写，Rust 侧没有任何
   代码读它，关掉开关照样弹通知。现在定时任务每轮先读该设置：关掉只停"通知 + 卡片"，
   重复任务的按期物化照旧（统计需要它，设计 §5.5）。
9. **承接第 7 条时踩到几个只在真窗口里才暴露的问题**（9–11），都已修：
   - **启动即 panic**：`spawn_reminder_task` 在 `setup` 里比 `app.manage(state)` 先跑，
     而它在被搬运进任务的第一时间就调 `app.state::<AppState>()`，于是
     `state() called before manage()` 直接 panic、窗口全白。改为先 `manage` 再 spawn。
   - **手工 `cargo build --release` 出来的应用是白窗口**：没有 `custom-protocol` feature 时
     webview 会去连 `devUrl` 而不是加载内嵌资源。现在 `Cargo.toml` 显式声明该 feature，
     手工打包要带 `--features custom-protocol`（`tauri build` 会自动带上），
     `scripts/smoke-gui-xvfb.sh` 头部也写明了，避免下次又对着白窗口调半天。
10. **错过的提醒卡片靠事件送达是送不到的**。`reminder:catch_up` 在 `setup` 阶段就发了，
    那时 webview 还没注册监听，于是"漏掉的提醒"面板永远不出现 —— 截图里没有卡片就是
    这个原因。改成把列表暂存在 `AppState::missed_reminders`，前端 mount 时调
    `reminder_missed` 取走（读时清空）；事件仍然发着，两条路径靠期次 key 去重。
11. **提醒卡片上的 🔔 emoji 在没装 emoji 字体的系统上是豆腐块**（容器里就复现了）。
    改成一个纯 CSS 红点，任何字体环境都一致。

最后两项原本记在「待办」里、以为本机做不了的，装上通知守护进程后跑通了，顺带又抓到
两个只看代码发现不了的缺陷：

12. **同一条漏掉的提醒会弹两次通知**。`dunst` 的记录直接暴露了这一点：一次是启动时的
    汇总（`OmniTODO 错过的提醒`），一次是 30 秒 tick 里的单条（`OmniTODO`）。原因是
    启动 catch-up 只发了汇总、**没把这批期次标记为已触发**，而它们又正好落在
    `due_now` 的 60 秒回看窗口里，于是又被弹了一遍。设计 §9.2 要的正是「聚合成一条汇总
    通知」。现在 catch-up 发完汇总就 `mark_reminder_fired`，并由
    `scripts/smoke-notification-xvfb.sh` 断言「恰好一条」守住这个行为。
13. **全局快捷键和托盘菜单都打不开快捷添加**。`shortcut.rs` 和 `tray.rs` 都在发
    `quickadd:open`，但前端**没有任何监听者**——这个事件是死的。设计 §12 要求
    「全局快捷键唤起快捷添加窗」（§16 P2 也把它列为验收项）。应用只有一个窗口，
    所以 `App.tsx` 收到事件就跳到 `/quickadd` 路由。
14. **`omnitodo://` deep-link 根本没实现**。设计 §9 要求「点击通知经 deep-link
    `omnitodo://task/<id>` 聚焦到该任务」，§11 也把 `omnitodo://projects` /
    `omnitodo://task/{id}` 列为 MCP 的 resource URI，但插件只在 `lib.rs` 里
    `init()` 了，没有任何地方解析 URL 或通知前端。补齐时还踩到一个平台差异：
    **Windows 和 Linux 上系统不会给运行中的实例发事件，而是另起一个进程、把 URL
    作为命令行参数传进去**（deep-link 插件自己的 README 写明了），所以只监听事件
    在这两个平台上等于没接。现已加上 `tauri-plugin-single-instance`（必须在
    `Builder` 最先注册）把第二个进程的参数转交给已有窗口，并新增 `deeplink.rs`
    做 URL 解析（含 `omnitodo://task/x`、`omnitodo:///task/x`、带 query/fragment
    这几种平台会产生的变体）与前端聚焦，解析部分有 4 个单测。

## 已知待办（未完成）

按「能不能在本机真验证」重新分了两类：**本地已闭环但依赖真实桌面环境的**，和
**本机物理上做不了的**。

### A. 需要别的机器 / 证书（本机无法执行）

- **macOS 安装包**：✅ **已在 macOS 构建机上完成**（`.app` 23.5 MiB + `.dmg` 9.0 MiB，
  `scripts/package.sh dmg,app`，挂载核对 + 真机运行，见 [`docs/packaging.md`](./packaging.md)）。
  仍未做的是**签名与公证**：需 Apple Developer 证书（付费账号）与 `notarytool`；
  未签名包在真机首开会被 Gatekeeper 拦，需右键→打开或去掉 quarantine 属性。
  这不是「还没试」，是缺证书与账号。
- **Windows MSI 与签名**：NSIS 已在 Linux 上交叉构建产出（`scripts/package-windows-cross.sh`）。
  MSI 试过交叉构建：装上 .NET 8 + WiX 5.0.2 后，`wix build` 能启动，但**任何
  `Directory/@Name` 写法都报 `WIX0389 ... is not a relative path`**，即 WiX 的路径校验
  在非 Windows 上不可用 —— 所以 `scripts/package-windows-cross.sh` 才会直接拒绝 `msi`
  参数（退出码 2）。签名还另需 Windows 主机或自定义 `sign_command`。
  交叉构建出的 NSIS 安装包**未在 Windows 上实际安装运行过**。
- **托盘右键菜单 / 拖拽手势**：需在有窗口管理器的真实桌面人工点击。应用窗口本身、
  页面渲染与 deep-link 已在 macOS 真机验证（见上「真实桌面冒烟（macOS）」），
  但托盘右键菜单与 dnd-kit 的 pointer 事件序列仍需人手过一遍；autostart 写入开机项后的
  重启验证同样如此。Windows 上 deep-link 的系统级注册与单实例转发也建议在真机再确认一次。

### B. 本机做不了，但已把能验证的部分都验了

- **GitHub Releases 上传**：设计 §15 的手动更新依赖 Releases 页面。按约定
  「先本地，暂不推送」，本轮**不做**上传，也不因此阻塞其余验收；真要发时
  `app_releases_url` 指向仓库的 Releases 页，届时再验证一次更新检查即可。
- **AppImage 打包需要代理时，`linuxdeploy` 只认小写变量**：只导出 `HTTPS_PROXY` 会以
  `failed to run linuxdeploy` 失败（deb 不受影响）。细节与容器内重跑命令见
  [`docs/packaging.md`](./packaging.md)。
- **拖拽排序的排序键假设**：手动排序（`sort: "manual"`）只在项目视图启用，
  且仅把 `task_reorder` 命名的任务重排；列表外的任务保留原 rank。
- **前端长列表**：超过 60 行才启用 `@tanstack/react-virtual` 开窗；
  拖拽排序列表刻意不开窗（虚拟化会让 dnd-kit 的测量失效）。

### C. 已在本机虚拟显示下真实验证（新增）

原先记在待办里的两项，其实不需要真实桌面会话也能验，现在都跑通了：

| 项 | 怎么验的 | 脚本 |
|---|---|---|
| 到点弹**系统通知** | 装 `dunst` 当通知守护进程，给虚拟屏配好 D-Bus 会话，然后按 with/without 两帧做区域像素比对；`dunst -print` 的日志证明通知确实带着任务标题送达 | `scripts/smoke-notification-xvfb.sh` |
| **全局快捷键**唤起快捷添加 | 快捷键是 X-global 的，不需要窗口管理器；`xdotool` 直接合成 `Ctrl+Shift+Space`，比对主内容区像素 | `scripts/smoke-shortcut-xvfb.sh` |
| **deep-link** `omnitodo://task/<id>` 聚焦任务 | 装包时 `x-scheme-handler/omnitodo` 已注册；再按 `.desktop` 的 `Exec` 方式再启一次进程带 URL，断言详情面板打开且标题区域确有深色文字（截图里能确认聚焦的是 `DeepLinkTargetTask` 而不是另一个任务） | `scripts/smoke-deeplink-xvfb.sh` |

这些都不是「加了个开关就算数」：通知验证抓到**重复弹两次**（缺陷 12），快捷键验证抓到
`quickadd:open` **没有任何监听者**（缺陷 13），deep-link 验证抓到**跨进程 URL 根本传不进来**
（缺陷 14）——三个都是只看代码发现不了的。
