# 打包与分发（设计 §15 / §16 P6）

OmniTODO 桌面端用 Tauri 2 bundler 产出各平台安装包；`omnitodo-mcp` 作为**侧车
（sidecar）**打进安装包，用户无需单独下载 MCP 服务。

## 一条命令

```bash
scripts/package.sh                 # 当前平台默认：Linux → deb,appimage,rpm；macOS → dmg,app
scripts/package.sh nsis,msi        # 在 Windows 构建机上
scripts/package.sh dmg,app         # 在 macOS 构建机上

scripts/package-windows-cross.sh nsis   # 不想开 Windows 机器：在 Linux 上交叉构建
```

脚本做三件事，顺序不能颠倒：

1. `ui/` 构建前端到 `ui/dist/`（`bundle.frontendDist` 指向它）；
2. `scripts/build-sidecar.mjs` 编译 `omnitodo-mcp` 并复制为
   `omnitodo-desktop/binaries/omnitodo-mcp-<target-triple>`；
3. `tauri build --bundles <...>` 产出安装包。

产物位于 `omnitodo-desktop/target/release/bundle/<format>/`。

macOS 上还多一步注意：`tauri build --bundles dmg` 结束时会调 `bundle_dmg.sh`，
它用 AppleScript 让 Finder 排布图标，在**没有 Finder 自动化权限的构建机**上会以
`AppleEvent 已超时 (-1712)` 失败。Tauri 只在 `CI` 环境变量存在时会加 `--skip-jenkins`
跳过这一步，所以 `scripts/package.sh` 在 macOS 上默认导出 `CI=true`，`.dmg` 照常产出
（仅少了自定义图标排布）；想要漂亮布局的真实桌面会话设 `OMNITODO_PRETTY_DMG=1` 即可。

## Windows 安装包（在 Linux 上交叉构建）

Tauri 支持用 cargo-xwin 交叉编译到 `x86_64-pc-windows-msvc`：MSVC CRT/SDK 从微软服务器
取到 `~/.xwin-cache`，`clang-cl` 编译 C 部分（含 bundled SQLite），`lld-link` 链接，
`makensis` 出 NSIS 安装包。所以没有 Windows 机器也能产出 `.exe` 安装包：

```bash
apt-get install -y llvm clang lld nsis      # clang-cl 由脚本补软链
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin --locked

scripts/package-windows-cross.sh nsis       # → artifacts/OmniTODO_0.1.0_x64-setup.exe
```

脚本先把 `omnitodo-mcp` 交叉编译成 `omnitodo-mcp-x86_64-pc-windows-msvc.exe`
放到 `binaries/`（Tauri 的侧车命名约定，Windows 需 `.exe` 后缀），再调
`tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`。

三点必须知道：

- 产出的安装包**未签名**（签名需要 Windows 主机，或自定义
  `bundler > windows > sign_command`）；未签名的安装包在 Windows 上会触发
  SmartScreen 提示。
- `--bundles msi` **仍然需要 Windows**：MSI 由 WiX 生成，WiX 只有 Windows 版；
  脚本会直接拒绝 `msi` 并提示改用 nsis。
- 交叉构建产物**本机无法运行验证**（没有 Windows），只做到了「文件类型是 NSIS/PE」
  与「安装包里确实含 `omnitodo-desktop.exe` 与 `omnitodo-mcp.exe`」这一步。

## 无 GUI / 无 root 的 Linux 机器

Tauri 构建需要 WebKitGTK/GTK 开发库，普通用户装不了系统包。此时用容器构建，
宿主机只需要 Docker：

```bash
scripts/package-linux-docker.sh              # deb + AppImage
scripts/package-linux-docker.sh deb,appimage,rpm
```

脚本在 `rust:1-trixie` 里装好依赖后构建，并把安装包拷到 `./artifacts/`。
容器内的 `cargo` 走宿主机 `~/.cargo/config.toml` 里的镜像源，npm 走
`NPM_REGISTRY`（默认 npmmirror）；构建缓存保存在名为 `omnitodo-build-target`
的 docker volume 中，重复执行不必重新编译。

**AppImage 需要访问 GitHub Releases**（下载 `AppRun` 与 `linuxdeploy`）。
若直连不可用，宿主机先导出代理再执行，脚本会把它传进容器：

```bash
HTTPS_PROXY=http://<proxy>:<port> HTTP_PROXY=http://<proxy>:<port> \
  scripts/package-linux-docker.sh deb,appimage
```

注意 `linuxdeploy` 是外部二进制，它只认**小写**的 `http_proxy`/`https_proxy`；
只导出大写变量时 `tauri build` 会以 `failed to run linuxdeploy` 失败（deb 不受影响，
因为它不走这一步）。在已启动的构建容器里手动重跑时，四个变量都要给全：

```bash
docker exec -w /work/omnitodo-desktop omnitodo-build bash -lc '
  export PATH=/usr/local/cargo/bin:$PATH \
         http_proxy=$HTTPS_PROXY https_proxy=$HTTPS_PROXY \
         HTTP_PROXY=$HTTPS_PROXY HTTPS_PROXY=$HTTPS_PROXY
  node node_modules/@tauri-apps/cli/tauri.js build --bundles appimage \
    --config "{\"build\":{\"beforeBuildCommand\":\"\"}}"'
```

本机（Debian 13 / trixie）就是用这条路径验证的，见文末「已在本机验证」。

## macOS 安装包（.app / .dmg）

macOS 产物**必须在 macOS 上构建**（`codesign` / `hdiutil` / WebKit 都是系统自带的），
`tauri build --bundles dmg,app` 即可，无需额外工具链：

```bash
scripts/package.sh dmg,app          # 已在 macOS 14 (arm64, Xcode 26) 上验证
```

产物：`OmniTODO.app`（23.5 MiB）与 `OmniTODO_0.1.0_aarch64.dmg`（9.0 MiB）。
未签名（没有 Developer ID 证书），首次打开需右键→打开或 `xattr -dr com.apple.quarantine`；
上架/免 Gatekeeper 拦截还需 Apple 开发者证书做签名 + 公证（`notarytool`），见「尚未完成」。

`.dmg` 的最后一步是 `bundle_dmg.sh` 用 AppleScript 调 Finder 排布图标。构建机若没有
Finder 自动化权限（无人值守的 CI / 自动化会话），这一步会以
`AppleEvent 已超时 (-1712)` 失败并使整个 `tauri build` 退出 64。Tauri 只在检测到 `CI`
环境变量时才给 `bundle_dmg.sh` 传 `--skip-jenkins`；`scripts/package.sh` 因此在 macOS 上
默认 `export CI=true`，跳过的只是 Finder 图标布局，`.dmg` 本身照常产出且可用。
真实桌面会话想要漂亮布局：`OMNITODO_PRETTY_DMG=1 scripts/package.sh dmg,app`。

## 侧车（sidecar）机制

- `tauri.conf.json` → `bundle.externalBin = ["binaries/omnitodo-mcp"]`；
- Tauri 要求文件带目标三元组后缀，故 `build-sidecar.mjs` 复制成
  `binaries/omnitodo-mcp-x86_64-unknown-linux-gnu`（Windows 再加 `.exe`）；
- 打包时 Tauri 把它放到主程序同目录（`.deb` 里是 `/usr/bin/omnitodo-mcp`，
  AppImage 里是 `usr/bin/omnitodo-mcp`）；
- 应用内 `mcp_cmds::mcp_status` / `mcp_copy_client_config` 按
  「当前可执行文件同目录 + `omnitodo-mcp`」定位它，因此读到的就是随包分发的那份。

`binaries/` 是构建产物，已在 `.gitignore` 中忽略；不要手工提交二进制。

## 图标

图标源文件由脚本生成，不依赖 ImageMagick / Pillow：

```bash
node scripts/gen-icon.mjs                    # → omnitodo-desktop/icons/source.png (1024²)
cd omnitodo-desktop && npm run icons         # tauri icon：全套 PNG / .ico / .icns / 商店图
```

改配色或图形只需改 `scripts/gen-icon.mjs` 里的常量并重跑上面两条命令。
`bundle.icon` 引用的是标准五件套：`32x32.png`、`128x128.png`、`128x128@2x.png`、
`icon.icns`、`icon.ico`。

## 依赖声明

`bundle.linux.deb` 里**不**手写 `depends`，交给 Tauri 依据实际链接的 so 自动推导。
理由：Tauri 是**合并**而非替换显式列表，手写会把同一条依赖写两遍；而自动推导出的
`libgtk-3-0` 在 Debian 13 上仍可安装——`libgtk-3-0t64` 声明了
`Provides: libgtk-3-0`，所以 `t64` 改名不会导致依赖不可满足
（已用 `apt-get install ./OmniTODO_0.1.0_amd64.deb` 实测确认）。

## GitHub Actions 三端自动发布

`.github/workflows/release.yml` 是上面那些本地路径在 CI 上的等价物：推一个 `v*` 标签
就出三端安装包并建 Release；在 Actions 页面手动 `workflow_dispatch` 则只构建、只上传
artifacts，不建 Release（用来试跑）。

| 平台 | runner | 产物 |
| --- | --- | --- |
| Windows | `windows-latest` | NSIS `.exe`、WiX `.msi` |
| macOS | `macos-latest` | universal `.dmg`（x86_64 + arm64 合并） |
| Linux | `ubuntu-22.04` | `.deb`、`.AppImage`、`.rpm` |

- **标签号必须与版本号一致**：`omnitodo-desktop/tauri.conf.json` 的 `version` 是
  `0.1.0` 就得推 `v0.1.0`，工作流第一步就校验，不一致直接失败——否则安装包文件名里的
  版本号与 Release 号对不上。
- 步骤顺序与本地脚本一致：前端 `ui/dist` → 侧车 → `tauri build`。CI 里前端已单独构建过，
  所以 `tauri build` 显式传 `--config '{"build":{"beforeBuildCommand":""}}'` 跳过重复构建。
- Linux 用 `ubuntu-22.04` 而不是 `24.04`：glibc 基线更低，装出来的 deb / AppImage 兼容面更广。
- macOS 出的是 **universal** 包（`tauri build --target universal-apple-darwin`，需要先
  `rustup target add x86_64-apple-darwin aarch64-apple-darwin`）。Tauri 只把**主程序**
  lipo 成胖二进制（`crates/tauri-cli/src/interface/rust/desktop.rs` 里那一小段 `lipo`），
  侧车得自己合并：工作流把两个架构的 `omnitodo-mcp` 用 `lipo -create` 合成
  `omnitodo-desktop/binaries/omnitodo-mcp-universal-apple-darwin`。名字不能省——Tauri 找侧车
  是拿 `externalBin` 直接拼 `--target` 的原值（`tauri-utils` 的 `external_binaries`），
  universal 构建要找的就是这个名字，给它两个单架构文件反而不对。
- 三端产物都是**未签名**的：Windows 触发 SmartScreen 提示，macOS 首次打开需右键→打开或
  `xattr -dr com.apple.quarantine`；签名 / 公证见文末「尚未完成」。
- 缓存：`ui` 与 `omnitodo-desktop` 各有一份 `package-lock.json`（根目录没有 `package.json`，
  所以 `setup-node` 的缓存键必须用 `cache-dependency-path` 指到这两份）；Rust 侧用
  `Swatinem/rust-cache`，两个 target 目录（根 workspace 与 `omnitodo-desktop`）都缓存。

CI 本身没法在本机验证，第一次跑建议先在 Actions 页面 `workflow_dispatch` 试一遍，
三端都绿了再推标签。

## 更新方式

不做自动更新（设计 §15）。设置页与「关于」展示 `app.releases_url`
（默认 `https://github.com/yunqilee69/OmniTODO/releases`），用户手动下载覆盖安装；
数据目录与 DB 不受影响。

## 已在本机验证

`scripts/package-linux-docker.sh deb,appimage`（Debian 13 / trixie 容器，Rust 1.99、
Tauri CLI 2.12.2）产出：

- `artifacts/OmniTODO_0.1.0_amd64.deb`（11.1 MiB）
- `artifacts/OmniTODO_0.1.0_amd64.AppImage`（111.1 MiB）

`scripts/package-windows-cross.sh nsis`（同一个容器里交叉编译）产出：

- `artifacts/OmniTODO_0.1.0_x64-setup.exe`（6.2 MiB）

`scripts/package.sh dmg,app`（macOS 14 / arm64，Xcode 26.6，Rust 1.95）产出：

- `OmniTODO.app`（23.5 MiB）
- `OmniTODO_0.1.0_aarch64.dmg`（9.0 MiB）

不只看「构建成功」，而是把包打开验证过：

| 检查 | 结果 |
| --- | --- |
| `dpkg -I` 依赖 | `libayatana-appindicator3-1, libwebkit2gtk-4.1-0, libgtk-3-0`（无重复） |
| `apt-get install ./OmniTODO_0.1.0_amd64.deb` | 成功，依赖全部解析 |
| `dpkg -L omni-todo` | `/usr/bin/omnitodo-desktop`、`/usr/bin/omnitodo-mcp`、`OmniTODO.desktop`、32/128/256@2 图标 |
| `/usr/bin/omnitodo-mcp --version` | `omnitodo-mcp 0.1.0` |
| `ldd /usr/bin/omnitodo-desktop` | 无 `not found` |
| `AppImage --appimage-extract` | `AppRun`、`.desktop`（含 `x-scheme-handler/omnitodo`）、图标、`usr/bin/{omnitodo-desktop,omnitodo-mcp}` |
| 运行解包出的侧车 | `omnitodo-mcp 0.1.0` |
| 前端确实打进去了 | 安装后的 `/usr/bin/omnitodo-desktop` 内含 `assets/index-<hash>.js` 键，与 `ui/dist/assets/` 的哈希逐一对得上（资源体是压缩存储，故按资源名核对而非直接 grep 文案） |
| Windows 包的类型 | `file` 识别为 `PE32 ... Nullsoft Installer self-extracting archive` |
| Windows 包的载荷 | `7z l` 列出 `omnitodo-desktop.exe`（18.8 MB 解压后）与 `omnitodo-mcp.exe`（侧车）——侧车确实随包分发 |
| Windows 侧车本体 | 交叉编译出的 `omnitodo-mcp.exe` 为 `PE32+ ... x86-64`（含 bundled SQLite 的 C 编译） |
| macOS `.app` 结构 | `Contents/MacOS/{omnitodo-desktop,omnitodo-mcp}`、`Contents/Resources/icon.icns`、`Contents/Info.plist` |
| macOS 侧车随包 | `.app` 内 `omnitodo-mcp --version` → `omnitodo-mcp 0.1.0`；`mcp_cmds` 按「主程序同目录」定位，正好命中 `Contents/MacOS/omnitodo-mcp` |
| macOS deep-link 注册 | `Info.plist` `CFBundleURLSchemes = omnitodo`；实时 `open omnitodo://task/<id>` 聚焦到该任务，且进程数不变（`single-instance` 转发生效） |
| macOS `.dmg` 内容 | `hdiutil attach` 挂载为 `/Volumes/OmniTODO`，内含 `OmniTODO.app` + `Applications` 软链 + `.VolumeIcon.icns`；从挂载点运行侧车 `--version` 正常 |
| 前端确实打进去了（macOS） | `.app` 主二进制内含 `assets/index-<hash>.js` 四个键，与 `ui/dist/assets/` 文件名逐一对得上 |

### 装完跑一遍页面级冒烟

包里装出来的东西能不能真的用，用虚拟显示验收（本机无 GUI 会话也能跑）：

```bash
# 一次性装上 GUI 侧工具（Xvfb + 合成点击 + 截图 + 中文字体）
apt-get install -y --no-install-recommends \
  xvfb xauth dbus-x11 xdotool imagemagick fonts-noto-cjk

scripts/smoke-gui-xvfb.sh --bin /usr/bin/omnitodo-desktop \
                          --cli /build-target/release/omnitodo
```

它会新建一个临时数据目录、灌入固定样例数据、把应用跑在 Xvfb 上，用合成点击/按键
走完 Inbox / 详情 / Today / 日历 / 快速添加 / 项目 / 设置 / 搜索 / 完成勾选 / 提醒卡片，
每步截图到 `artifacts/smoke/`，然后断言四件事：勾选确实写进了 SQLite、Inbox 只含
未归档任务、点「稍后提醒」把 `remind_at` 推到了未来、提醒卡片确实被点掉（像素比对）。
逐张截图对应内容见 [`docs/implementation-status.md`](./implementation-status.md)。

`--bin` 必须是**生产构建**：缺 `custom-protocol` feature 时 webview 会去连 `devUrl`
而不是加载内嵌资源，所有页面都是白的。`tauri build` 出来的安装包自带该 feature；
手工构建要写 `cargo build --release --features custom-protocol`。

另外三个冒烟脚本同样在虚拟显示下验证通知、快捷键与 deep-link，需要额外的依赖：

```bash
# 通知：需要 dunst（通知守护进程）+ libnotify-bin
apt-get install -y --no-install-recommends dunst libnotify-bin
scripts/smoke-notification-xvfb.sh --bin /usr/bin/omnitodo-desktop \
                                   --cli /build-target/release/omnitodo

# 全局快捷键与 deep-link：只需要上面那套 xdotool 工具
scripts/smoke-shortcut-xvfb.sh --bin /usr/bin/omnitodo-desktop \
                              --cli /build-target/release/omnitodo
scripts/smoke-deeplink-xvfb.sh --bin /usr/bin/omnitodo-desktop \
                              --cli /build-target/release/omnitodo
```

它们分别证明「到点真的弹出系统通知」（dunst 收到带任务标题的通知 + 气泡区域像素比对 +
断言只弹一次）、「`Ctrl+Shift+Space` 真的能唤起快捷添加」、以及
「`omnitodo://task/<id>` 真的能聚焦到指定任务」。这几项以前被记在待办里，
以为需要真实桌面会话，实际在虚拟屏上就能验。

注意 deep-link 那个脚本要求**先装包**：协议处理器是由 `.desktop` 里的
`x-scheme-handler/omnitodo` 注册的，只跑 `cargo build` 出来的二进制不会被系统识别；
脚本自己会检查这一项。

未验证的部分：Windows 产物（已交叉构建但无法在本机运行验证）、以及托盘右键菜单等
需要窗口管理器的手工交互。GUI 窗口本身已在 macOS 真实桌面会话上实测（应用启动、
各页面渲染、灌入数据后刷新、`omnitodo://` deep-link 聚焦任务，均在真实显示器上截图确认）；
系统通知气泡已由 `smoke-notification-xvfb.sh` 在装了 dunst 的虚拟屏上验证过；
deep-link 在 Linux（虚拟屏）与 macOS（真实桌面）上都验证过，Windows 的协议注册方式不同，
建议在 Windows 真机再确认一次。

## 尚未完成（需平台证书 / 环境，非本机可验证）

本轮逐项**实测**过可不可行，而不是照着文档想当然。结论如下：

| 项 | 阻塞点 | 是否试过 |
| --- | --- | --- |
| Windows MSI | **WiX 5 拒绝在非 Windows 上构建**（实测，见下） | 装上 .NET 8 + `wix` 5.0.2 试过 |
| Windows 代码签名 | 需 Windows 主机或自定义 `sign_command`；未签名的安装包会有 SmartScreen 提示 | 无证书，无法 |
| macOS `.app`/`.dmg` | — | **已在 macOS 构建机完成**（见上「macOS 安装包」与「已在本机验证」），无需证书即可产出未签名包 |
| macOS 签名 / 公证（notarization） | 需 Apple Developer 证书（付费账号）+ `notarytool` | 无证书与账号，本机无法完成；未签名包在真机首开会被 Gatekeeper 拦，需右键→打开或去掉 quarantine 属性 |
| GitHub Releases 上传 | 需先推送仓库 | 按约定「先本地，暂不推送」，本轮不做 |
| 托盘右键菜单、拖拽手势 | 需窗口管理器的人工点击 | 应用窗口、页面渲染与 deep-link 运行已在 macOS 真机验证（见上）；托盘菜单与 dnd 拖拽仍待人工 |

### 为什么 MSI 不能在 Linux 上交叉构建（实测记录）

「WiX 只有 Windows 版」这个说法需要证据，所以真的装了一遍：

```bash
# 容器里装 .NET 8 + WiX 5 CLI（两者都支持 Linux）
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /usr/local/share/dotnet
dotnet tool install --global wix --version 5.0.2
```

结果：`wix --version` 正常输出（只有一条 `WIX0000: The WiX Toolset only supports
Windows` 警告），说明程序本身能在 Linux 跑。但**真正构建 MSI 时必然失败**，且失败点
与 Windows 上的写法无关：

```text
error WIX0389: The Directory/@Name attribute's value, 'OmniTODO', is not a relative path.
```

试过 `Name="OmniTODO"`、`Name="OmniTODO\"`、`Name="Probe"`、`Name="OmniTODO\Sub\"`
四种写法，全部报同一条错——WiX 的路径校验在非 Windows 上就是坏的。结论：
**MSI 必须在 Windows 上生成**，这也正是 `scripts/package-windows-cross.sh` 拒绝
`msi` 参数（退出码 2）的原因。NSIS 不受影响，可以在 Linux 上交叉构建。

### 在虚拟显示下已经验证掉的（不需要真实桌面会话）

| 项 | 脚本 |
| --- | --- |
| 页面级交互（渲染、点击写库、Inbox 语义、稍后提醒、附件删除落库） | `scripts/smoke-gui-xvfb.sh` |
| 到点真的弹系统通知 | `scripts/smoke-notification-xvfb.sh` |
| 全局快捷键 `Ctrl+Shift+Space` 唤起快速添加 | `scripts/smoke-shortcut-xvfb.sh` |
| deep-link `omnitodo://task/<id>` 聚焦任务 | `scripts/smoke-deeplink-xvfb.sh` |
