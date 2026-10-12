# OmniTODO

跨平台、本地优先的桌面待办应用。设计说明见
[`2026-10-12-todo-desktop-design.md`](./2026-10-12-todo-desktop-design.md)，
实现进度见 [`docs/implementation-status.md`](./docs/implementation-status.md)。

数据落在本机单个 SQLite 文件，无账号、无服务端即可完整使用；对外通过一个
原生 MCP Server 让外部 agent 直接读本地库。

## 仓库结构

```
crates/
  omnitodo-core/   # 纯逻辑库：domain / db / repo / service，无 Tauri、无 MCP
  omnitodo-cli/    # headless CLI：冒烟测试、脚本、维护命令（bin: omnitodo）
  omnitodo-mcp/    # 独立 MCP server：stdio + streamable HTTP（bin: omnitodo-mcp）
omnitodo-desktop/  # Tauri 2 桌面壳（需 WebView 系统库，独立构建，见下）
ui/                # React 19 + TS + Vite 前端
docs/              # 实现进度、打包说明
scripts/           # check.sh、图标生成、侧车构建、打包
```

## 构建与测试（headless）

需要 Rust（stable）。首次构建会编译 `sqlx` 与 bundled SQLite。

```bash
scripts/check.sh                # cargo test + clippy + 前端单测/打包，一条命令全绿
cargo test --workspace          # core + cli + mcp，共 38 个测试
cargo clippy --workspace --all-targets

cd ui && npm install && npm test && npm run build   # 前端 64 个单测 + 严格类型检查 + 打包
```

页面级验收（无 GUI 会话也能跑，需要 Xvfb/xdotool/imagemagick 与中文字体）：

```bash
scripts/smoke-gui-xvfb.sh --bin /usr/bin/omnitodo-desktop --cli target/release/omnitodo
scripts/smoke-notification-xvfb.sh --bin /usr/bin/omnitodo-desktop --cli target/release/omnitodo
scripts/smoke-shortcut-xvfb.sh       --bin /usr/bin/omnitodo-desktop --cli target/release/omnitodo
scripts/smoke-deeplink-xvfb.sh       --bin /usr/bin/omnitodo-desktop --cli target/release/omnitodo
```

第一个把应用跑在虚拟显示上，合成点击走完各页面（含提醒卡片与「稍后提醒」）、逐步截图，
并断言勾选、Inbox 范围、稍后提醒改库、卡片被点掉这四件事都成立；后三个分别验证
**到点真的弹出系统通知**（起一个 dunst 通知守护进程）、**全局快捷键真的能唤起快捷添加**
（`Ctrl+Shift+Space`）、**deep-link 真的能聚焦任务**（`omnitodo://task/<id>`）——都不需要真实桌面会话。
`--bin` 要传生产构建——手工 `cargo build --release` 必须带 `--features custom-protocol`，
否则 webview 会去连 `devUrl` 而不是加载内嵌资源，页面全是白的。

`omnitodo-desktop` 依赖 WebView 系统库（WebView2 / WebKitGTK / WKWebView），
不在 workspace 内，随 GUI 环境单独构建：

```bash
cd omnitodo-desktop && npm install
npx tauri dev        # 需要已构建的 ui
```

## 打包安装包

```bash
scripts/package.sh                     # 本平台（如 Linux: deb/appimage/rpm）
scripts/package-linux-docker.sh        # 无 GUI / 无 root 的 Linux 机器用容器构建
scripts/package-windows-cross.sh nsis  # 在 Linux 上交叉构建 Windows 安装包（未签名）
```

`omnitodo-mcp` 作为侧车打进安装包（`bundle.externalBin`），用户无需单独下载。
图标由 `scripts/gen-icon.mjs` 生成源图后用 `tauri icon` 派生全套。
细节（含代理、依赖声明、已验证结论）见
[`docs/packaging.md`](./docs/packaging.md)。

## CLI 快速上手

```bash
cargo run -p omnitodo-cli -- init
cargo run -p omnitodo-cli -- project add "工作"
cargo run -p omnitodo-cli -- task add "写周报" --project 工作 --priority 3 --tag 汇报 --due 明天
cargo run -p omnitodo-cli -- quickadd "评审设计稿 !紧急 @设计 ^明天 18:00 ::重点看交互"
cargo run -p omnitodo-cli -- search "设计稿"
cargo run -p omnitodo-cli -- report --days 7
cargo run -p omnitodo-cli -- import backup.json --format todoist   # 也支持 markdown / todotxt
cargo run -p omnitodo-cli -- export --format json
```

`--project` 收项目名或 id；`--due` / `--start` 收 `2026-10-12`、`2026-10-12 18:30`、
`明天 下午3点`、`+3d` 或原始毫秒。纯日期按全天存（UTC 零点，不做时区换算）。

数据目录（可用 `--db` 覆盖）：Windows `%APPDATA%\OmniTODO\`、macOS
`~/Library/Application Support/OmniTODO/`、Linux `~/.local/share/omnitodo/`。

## MCP Server

```bash
# stdio（Cursor / Claude Desktop；默认只读）
omnitodo-mcp --db "<数据目录>/omnitodo.db"

# 写工具（需在应用设置里开启 mcp.write_enabled）
omnitodo-mcp --db "<数据目录>/omnitodo.db" --write

# 常驻 HTTP（仅 127.0.0.1，需 Bearer token）
omnitodo-mcp --db "<数据目录>/omnitodo.db" --http --port 8787 --token <token>
```

写工具提交成功后，若传入 `--notify http://127.0.0.1:8788/internal/notify
--notify-token <t>`，会回调桌面应用的控制端点刷新 UI（设计 §4.5）。
