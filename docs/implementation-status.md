## 2026-10-16 项目主题色 + 日历只画未完成的事

两件事一起做，因为它们是同一个问题的两半：跨项目视图里「这条属于谁」要看得见。

- **项目色早就有完整数据通路，缺的只是入口**：`projects.color`（TEXT/Nullable）→ `domain::Project` /
  `ProjectPatch` → `api.projectCreate(name, color)` / `api.projectUpdate(id, {name, color})` 一路都在，
  MCP 与 CLI 也早就能读写；UI 上此前没有任何地方能改它，所以库里这个字段几乎永远是 NULL。
  这次把入口补在侧栏「编辑项目」弹窗里，新建项目时也一并带上。
- **色板是固定的十色，不是自由取色盘**（`ui/src/lib/projectColors.ts`，设计 §3.6）：项目色要以
  8px 圆点和 16% 淡底两种形态在纸白与炭黑两套底色上都读得出来，而这个应用只有一个信号色
  （仪表绿）加一层优先级色阶——放开自由取色，很容易挑到跟这两者撞车的颜色，反而失掉「一眼分得开」。
  新建时取 `nextProjectColor()`＝色板里第一个没被占用的色（不是按项目数量取模）：两个项目撞色就
  违背了配色的唯一目的。十色全占满才回落到取模。
- **不用 antd 的 `ColorPicker`**：它的触发态是个不可聚焦的 `div`（`pickAttrs(rest)` 只透传
  `data-*`/`aria-*`），键盘 Tab 不到；而这里要的正是一个能 Tab 到、能读出当前色的按钮。
  自建 `ProjectColorPicker.tsx`：真 `Button`（`aria-label`/`title` 带当前色）触发，`Popover` 里
  十个 `role="radio"` 按钮组成 `role="radiogroup"`，选中项打勾，选完即关。
- **无色项目不猜色**：`color` 为 NULL 的项目继续画中性发丝点，不替它挑一个——存量库里可能已经有
  几十个无色项目，自动上色等于替用户做了一堆他没做过的决定，还得在界面上解释为什么。
- **跨项目视图靠 `useProjectIndex()`**（`ui/src/hooks/useProjectIndex.ts`，复用 `qk.projects` 缓存）
  把 `project_id` 解析成名字与颜色：收件箱 / 今天 / 即将到来 / 标签 / 搜索的任务行前面加
  项目色点 + 项目名（`TaskRow` 的 `project` prop，由 `TaskList` 的 `showProject` 开关打开）。
  项目视图自己**不**打开这个开关——那一页每行的答案都一样；子任务也不显示——分支属于父任务的项目。
- **日历「已完成不显示」放在 core，不是前端藏**：`service/calendar.rs` 改传
  `TaskFilter { include_completed: false, .. }`（落到 SQL 就是 `status NOT IN ('done','cancelled')`）。
  `list_calendar` 的语义本来就是「还有什么要做」，前端过滤会让 MCP 与 CLI 拿到不一样的答案。
  MCP 的 `list_calendar` 描述同步改成 `Finished work is not listed: only open tasks appear`。
- **但「完成一期」不等于「整个系列结束」**：重复任务的锚点被勾掉后，**还没到的期次仍然要显示**——
  否则周日勾掉「每周五交周报」，日历上往后所有周报就一起消失了。这一点专门补了回归测试
  `calendar_keeps_future_occurrences_of_a_finished_anchor`。
- **日历项带上 `project_id` 才谈得上上色**：`CalendarItemDto` 增 `project_id: Option<Id>`，锚点查询
  改成 `SELECT id, project_id ...`，虚拟期次继承锚点的项目（它自己不是一条真任务）。月/周网格里
  每一块按项目色画：实体期次是 16% 淡底 + 左缘 3px 实色条，虚拟期次是虚线边 + 55% 半透明的左条，
  两者的区别（「已排期」与「还没排」）不因为上了色就看不出来。正在拖的 `DragOverlay` 块带同一套颜色。
- `embedded` 模式（项目视图内嵌的日历）照样上色，但不在 tooltip 里重复项目名——那一页的项目是已知的。

验证：`cargo test --workspace` **48 + 10 passed**；`cargo clippy --workspace --all-targets -- -D warnings`
干净；`cd ui && npx tsc --noEmit` 干净；`npx vitest run` **171 passed / 23 文件**（新增
`lib/projectColors.test.ts` 5 例、`TaskRow.test.tsx` 的 project chip 3 例、`NavMenu.test.tsx`
的配色 2 例）；`npm run build` 成功。真浏览器在 `dev-preview.html`（stub IPC）上核对：编辑器色板
十色可选、选中后触发点变色、Popover 收起；标签视图的任务行显示色点 + 项目名；给另一项目的任务
排上日期后，日历同一天并排出现两个不同色的块（一红一绿）；把一个已排期任务勾成完成 → 强制刷新
→ 它从日历上消失。
未做：README 截图未重生成（本机只有 Firefox，出的图与现有 Chrome 截图风格不一致，宁可留旧图）。

## 2026-10-16 侧边栏可收起（收起按钮在 rail，展开按钮在视图顶栏最左）

- **两个半区、一处状态**：`ui/src/components/SidebarToggle.tsx` 一个组件两种 `variant`，
  rail 里的 `collapse` 挂在 wordmark 行右端（`ml-auto`），顶栏里的 `expand` 是 `PageHeader`
  的第一个子元素——即标题（项目视图里是项目名）左边。哪一半当前不可达就不进 DOM，而不是
  用样式藏起来：rail 收起到 0 宽后，里面残留的按钮仍是 Tab 站，焦点会掉进一个看不见的地方。
- **状态在 `ui` store，不落 `settings`**：`sidebarCollapsed` + `setSidebarCollapsed/toggleSidebar`，
  写 `localStorage.omnitodo.sidebar.collapsed`（与 `NavMenu` 的项目分组折叠同一套做法）。理由：
  这是设备本地偏好，跟着机器走而不是跟着库走，不需要跨端同步。
- **rail 不变形，只被裁掉**：`Layout.Sider` 传 `collapsedWidth={0}` + `trigger={null}`
  （antd 自带的 zero-width 把手不要），内层容器固定 `width: 264`、外层 `overflow: hidden`。
  否则收起/展开的 200ms 里每一帧都在改宽度，项目名会逐帧重排成一团再散开。
- **日历自带顶栏**：`Calendar` 路由不走 `PageHeader`，所以 `CalendarBoard` 的非 `embedded`
  分支自己放一个展开按钮；项目内嵌的日历已经在项目视图的顶栏之下，不重复放。
- **顺带修掉一个会"静默改错数据"的口子**：rail 收起后仍挂载，里面的项目行 droppable 仍持有
  真实矩形（`overflow` 裁剪不影响 `getBoundingClientRect`），而应用级落点用的是
  `closestCenter`——按"最近中心"判定，不看指针在不在目标上。原样保留的话，把任务拖到列表
  左半边就可能被收进一个看不见的项目。`ProjectLabel` 的 `useDroppable` 现在带
  `disabled: railCollapsed`，回归用例 `ui/src/components/NavMenu.test.tsx` 直接读 dnd-kit
  的 droppable 注册表断言这个标志（收起 → disabled，展开 → 恢复）。

验证：`cd ui && npx tsc --noEmit` 干净；`npx vitest run` **161 passed / 22 文件**（新增
`SidebarToggle.test.tsx` 2 例、`NavMenu.test.tsx` 1 例，`stores/ui.test.ts` 加 1 例）；
`npm run build` 成功（产物仍约 1.54 MB / gzip 496 KB）。真浏览器在
`http://localhost:5173/dev-preview.html`（stub IPC）上核对：点 rail 里的收起按钮 → rail 实测
0 宽、`localStorage` 写 `1`、顶栏出现展开按钮且位于项目名左侧（x=24 对 62，同一行）；
点展开 → 恢复 264 宽、`localStorage` 回 `0`；以 `1` 重载 → 打开即收起、顶栏按钮在；`/calendar`
路由下按钮确实是自带顶栏的第一个子元素。

> 注意：这台机器上 `npx vitest run` 用 Node 21.7.3 会挂在 `@ant-design/icons` 的 CJS 构建
> `require("@ant-design/colors/es/generate")` 上（5 个渲染 antd 的用例文件整文件报
> "Cannot use import statement outside a module"，HEAD 上同样复现，与本次改动无关）。
> 换 Node 24 运行即全绿——Node ≥ 22.12 默认支持 `require(esm)`。
> 另外本次真浏览器验收时，内置浏览器的渲染帧一度停摆（2 秒内 `requestAnimationFrame` 回调
> 0 次），表现为 Playwright 的定位器点击一直等"元素稳定"而超时、截图超时；改用坐标点击与
> 状态直读绕过，未做真实拖拽验收（拖拽本身也依赖 rAF）。

## 2026-10-16 看板 / 日历 / 板块 / 任务详情弹窗（对照 Todoist 移植）

四件互相关联的东西一起做，因为「板块」是另外三件的地基：Todoist 的看板列就是板块，
列表视图按它分组，任务详情弹窗里它是任务的一个字段。

- **板块（`crates/omnitodo-core/src/service/section.rs` + 迁移 `0002_sections.sql`）**：
  项目内部的分栏。三条不变量在服务层一处实现（`ensure_section_in_project` 加任务写路径里的
  派生逻辑），不在各调用点重复判断：板块只能收纳本项目的任务；只有顶层任务带板块（子任务跟随
  父任务，`parent_id` 非空即丢弃 `section_id`）；删除板块默认只把任务释放回「无板块」，
  Todoist 那种"连任务一起删"是对话框里的显式勾选项。项目内板块名唯一（忽略大小写，软删除行不参与）。
- **与 Todoist 的一处刻意分歧**：Todoist 按 `(project_id, section_id, parent_id)` 给任务编号，
  每个板块内从 0 重排；本项目保留 `(project_id, parent_id)` 下的单一 `sort_order`。理由是
  `Sort::Manual` 与既有拖拽排序都直接读这一列，改成按板块分段会让"项目内跨板块的手工顺序"
  这个概念消失。代价是同一板块内的序号不连续，不影响显示与拖拽。理由写在设计 §5.9。
- **看板视图（`ui/src/components/BoardView.tsx`）**：列宽 286px，顺序 `[无板块, ...板块, 添加板块]`；
  列头是「名称 + 计数 + 拖动手柄 + ⋯」，列脚是「添加任务」（不在列头）；列体整段都是落点，
  空列留 1px 占位否则测不到尺寸。跨列落点写两条命令（先 `task_update` 写 `section_id`，
  再 `task_reorder` 写序号），与 Todoist 的 `item_move` + `item_reorder` 一致。看板自带嵌套
  `DndContext`：这里的落点同时决定"哪一列"和"哪个位置"，而应用级解析是按任务行算的。
  碰撞检测按拖拽类型过滤候选再取面积最小者，卡片因此胜过它所在的列体。
- **列表按板块分组（`ui/src/components/SectionHeader.tsx` + `ui/src/lib/sections.ts`）**：
  `[无板块, ...板块]`，标题行可折叠、可双击就地重命名、悬停 `＋` 直接在该板块新建任务，
  `⋯` 菜单给重命名 / 上移 / 下移 / 删除。板块换位在列表里走菜单而不是拖动手柄——应用级拖拽
  上下文是"任务"形状的，同一片区域不该有两种落点解释。折叠状态存 `settings` 的
  `ui.sections.collapsed`（纯客户端偏好，不落到 `sections` 行上）。
- **项目视图三种模式**：列表 / 看板 / 日历，分段控件切换，选择存 `ui.project.view_mode`。
- **项目内日历**：`calendar` 命令加可选 `project_id`；`CalendarBoard` 以 `embedded` 模式复用，
  点日期格空白处直接在该日建任务（预填全天日期，项目日历里同时预填该项目）。
- **任务详情弹窗的「板块」字段**：顶层任务可选「无板块」或本项目任一板块；子任务该项禁用并显示
  「子任务跟随父任务」。
- **MCP**：只读加 `list_sections`，写入加 `create_section` / `update_section` / `delete_section`，
  `list_calendar` 加可选 `project_id`。

### 浏览器真拖拽 / 真点击验收发现并修掉的两个缺陷

两个都是"静默无效"型——动作走完了、没报错、就是没效果：

1. **看板板块拖动完全没反应**。列的 sortable 节点 id 是 `section:<id>`，列体 droppable 的 id 是
   `column:<key>`，两者共用同一个 `useSortable`/`useDroppable` 命名空间但只有前者带
   `kind: "column"`，所以碰撞永远落在 `section:<id>` 上；而 `onDragEnd` 只认 `column:` 前缀，
   于是拿到 `null` 直接 return。同一个前缀假设还让"卡片拖到另一张卡片上"失效：卡片注册用的是
   任务 id 本身，代码却在 `slice("card:".length)`。修法是把两个命名空间的解码收成显式助手
   （`sectionOfColumnId`，卡片 id 就是任务 id），并在 `boardCollision` 里过滤掉 active 自己。
   回归用例 `ui/src/components/BoardView.test.tsx`。
2. **日历点日期格建任务会早一天**。格的 `day` 是本地零点时间戳，`onCreate` 却用
   `civilDate`（UTC getter）去换算，UTC 以东会落到前一天；而同一格的分组键用的是
   `civilOfDay`，拖拽改期也一直用 `civilOfDay`。现在种子直接取该格自己的分组键
   （`quickAddSeedForDay`），任务必然落在被点的那一格。回归用例在 `ui/src/lib/calendar.test.ts`。

顺带补了预览桩的两处缺口（只影响 `dev-preview.html`，不影响产品）：桩里根本没有
`quickadd_commit` 处理器，而桩对未注册命令是"返回 null"而不是报错，所以预览里回车建任务
一直静默失败——这正好掩盖了上面第 2 条的验收；另外项目日历建的任务此前会落到收件箱而不是
该项目，现在随种子带上 `project_id`，并用 `#项目名` chip 显示出来（否则这个去向既看不见也改不了）。

验证：`cargo test --workspace` **56 passed / 0 failed**（core 46 + mcp 10）；`cd ui && npx tsc --noEmit`
干净；`cd ui && npx vitest run` **157 passed / 20 文件**；`cd ui && npm run build` 成功。
真浏览器验收在 `http://localhost:5173/dev-preview.html`（stub IPC）上用真实指针事件跑完：
卡片从「无板块」拖进「进行中」后读回 `section_id=s-now` 且序号追加到该列末尾、板块计数 2→3；
卡片拖到另一列某张卡片的上半区 → 读回落在该卡片之前；列内卡片上移一位 → 序号重排；
拖动列头手柄 → `section_reorder` 生效且 DOM 列序同步变成 `[无板块, 待排期, 进行中]`；
列表模式渲染出「无板块(4) / 进行中(2) / 待排期(2)」三组标题，收起「进行中」后两行消失且
`settings.ui.sections.collapsed` 写入 `{"p-zhi":["s-now"]}`，新建板块重名被拒、换名后建出
「设计评审(0)」；详情弹窗的「板块」读作「进行中」、改成「待排期」后读回 `s-next` 且计数跟随、
改回「无板块」后读回 `null`，子任务那一项禁用并显示「子任务跟随父任务」；项目日历只显示本项目的
期次（给另一项目的任务加日期后，全局日历多出一条而项目日历不变），点 10/23 建出的任务
`due_at=2026-10-23T00:00:00Z`、`all_day=true`、`project_id=p-zhi`，全局日历点 10/24 建出的任务
落收件箱且没有 `#项目` chip。

### 看板列脚的「添加任务」重做

看板能用之后暴露的观感问题：列脚的添加任务是"一枚按钮"，展开后是"一个小输入框"，
两者都不像它旁边那些卡片，也不像列表视图里同一个动作的样子。对着 Todoist 的看板结构
（`board_section__footer` 只有一个槽位，收起时是触发钮、展开时是编辑器，二者互斥）改了三处：

- **收起态**从 antd `Button type="text" size="small"` 换成列内的行（`.composer-trigger--board`）：
  `px-2 py-1.5`、圆角与卡片一致、左缘与上方卡片的复选框列对齐；悬停除文字变 `--accent`
  再铺一层 `--bg-hover`——它坐在一列卡片中间，该像卡片那样响应悬停。
- **展开态**从 `Input size="small"` 换成卡片形的 `composer-box`：`--bg-surface` +
  `1px --border-strong` + `--e1`，两行无边框输入（任务名称 / 描述），底部分隔线以下是
  板块 chip（`# 名称`；无板块列不放 chip，"无板块"不是名字）+ `×` 收起。比列表 composer
  少优先级与日期 chip：286px 的列放不下。键盘与列表一致（`Enter` 落库并留框继续下一条、
  `Esc` 收起、两行都空时失焦收起）。顺带把描述也接进了 `task_create`。
- **末尾「添加板块」**从"一枚通栏按钮"换成"一根列"：同宽、通高、同圆角，虚线
  `--border-strong` 且不铺底。它此前是浮在列外的按钮，读起来不像"这里将出现一列"。

验证：`cd ui && npx tsc --noEmit` 干净、`npx vitest run` **157 passed / 20 文件**、
`npm run build` 成功（本轮只动前端，未改 Rust）。浏览器里在 `dev-preview.html` 的看板模式
读两种状态的**计算样式**核对：收起态 268×33、`padding 6px 8px`、圆角 6px 与卡片一致、
左缘与卡片左缘偏移 0；展开态 268×112、`--bg-surface` + `1px --border-strong`（`rgb(61,57,51)`）
+ `--e1`、两个无边框输入、chip 读作 `# 进行中`；添加板块列 286×620 与相邻列等高、`1px dashed`。
行为上：在「待排期」列脚输入标题与描述后回车 → 卡片落在该列（不是无板块）、描述跟随、
输入框留开且已清空；在「无板块」列脚同样操作 → 卡片落在无板块列、框内不出现 chip。
（本机 IAB 渲染器在窗口失焦时不产生动画帧，Playwright 的 `click()` 可及性等待必然超时，
所以点击与输入都在页面内派发事件完成。）

## 2026-10-15 MCP 工具返回形状与过滤入参修复

装上包实测 MCP 后反馈的一组问题，根因都是工具层没把调用方当外人：

- **列表工具返回数组，被客户端整条拦掉**。`structuredContent` 必须是 JSON 对象，
  `list_projects`/`list_tags`/`list_upcoming`/`list_calendar`/`list_subtasks`/
  `list_attachments`/`list_due_reminders` 返回的是 `Vec`，客户端报
  `expected record, received array` 并连 `content` 文本一起丢弃，所以看起来"调用直接失败、
  内容也看不到"。现在统一包成 `{items, count}`，协议层再兜一道（真收到数组就包一层），
  分页类工具返回 `{items, total, limit, offset}`。
- **列表/搜索/导出查不到已完成任务**。`TaskFilter` 默认 `include_completed=false`，
  SQL 会加 `status NOT IN ('done','cancelled')`；而调用方传的 `status`、`project`、
  `project_name`、`project_id`、`completed_from` 都不是 `TaskFilter` 的字段，serde 静默
  丢弃，于是"成功但空结果"。现在三个工具直接接受扁平的 `scope`（`open`/`completed`/`all`，
  默认 `open`）、`project`（id 或名称）、`priorities`、`statuses`、`due_*`、`start_*`、
  `completed_*`、`limit`/`offset`；非法取值报 validation 错误，不再静默。
  `TaskFilter` 新增 `completed_after`/`completed_before`。
- **`get_project` 只认 id**。汇总里 `by_project[].key` 给的是项目名，调用方拿不到 id
  （列表工具又正好在报错）。现在 `id` 走 `resolve_project_id`，id 和名称都能用；
  名称歧义时报 `AmbiguousProject` 而不是猜一个。
- **汇总里 7 和 10 对不上**。`completed` 数当前存活任务（不受窗口影响），
  `throughput` 数 `task_completions` 的完成事件。本机库里 10 条完成记录中有 3 条属于已软删除
  的任务，于是 `completed=7` 而 throughput 求和为 10。现在 throughput / 平均耗时 / 准时率
  一律 `JOIN tasks ... deleted_at IS NULL`，并新增 `completed_in_window`，三项之和恒等于它；
  字段名与工具描述也写明了两套数据集的区别。

验证：`cargo test --workspace` 48 passed（core 38 + mcp 10）；`cargo clippy --workspace
--all-targets` 0 warning；`cd ui && npm test` 98 passed、`tsc --noEmit` 通过。
另外用真实二进制对本机 `~/.omnitodo/omnitodo.db` 的副本重放了报告里的调用：
`list_tasks {scope:completed, project:"示例项目"}` 返回 7 条、`list_tasks {}` 返回 0 条、
`search_tasks {query:"fastjson", scope:completed}` 命中 1 条、
`export_tasks {scope:completed}` 导出 7 行 CSV、`get_project {id:"示例项目"}` 解析到
`01a132e1-…`、`summary_report {days:7}` 给出 `completed=7` / `completed_in_window=7` /
`throughput=[["2026-10-15",7]]`、`scope:"nope"` 报 validation 错误。

## 2026-10-15 MCP 控制端点 token 持久化与设置面板

两个改动，都是配 MCP 时暴露的：

- **token 持久化**。`control_token` / `http_token` 原先每次启动重新生成，填进客户端
  配置的值下次启动即失效。现在存 SQLite `settings` 表（`mcp.control_token` /
  `mcp.http_token`），首次启动生成一次，之后保持不变；设置页可修改或重新生成，
  改完立即生效（端点每个请求现读 `Arc<RwLock<String>>`，不需要重启应用）。
  校验限 16–128 字符、`[A-Za-z0-9_-]`，因为 token 要放进 `Authorization: Bearer` 头。
- **设置页 MCP 面板重构**（`ui/src/components/McpPanel.tsx`）：状态四宫格（侧车版本、
  二进制绝对路径 + 是否检测到、数据目录、控制端点状态）、能力对照表（13 只读 / 7 写工具）、
  按客户端分页的 stdio 配置（ZCode 的嵌套 `mcp.servers` 与通用 `mcpServers`）、
  可编辑的 token。顺手修了两个真 bug：复制出来的 `command` 是绝对路径而不是裸文件名，
  token 不再带引号（引号会原样进进程参数，回调一律 401）。

设计文档 §4.4 原来说端口/token 存 `config.json`，理由是「进程启动前就要读到」，
但端点都在 `Core::open_default()` 之后才起，该理由不成立，已改为统一存 `settings` 表。

验证：`cargo test --workspace` 44 passed（core 37 + mcp 7）；`cargo clippy --workspace --all-targets`
0 warning；`cargo test`（omnitodo-desktop）10 passed（含 `mcp_config` 的 5 个）；
`cargo clippy`（omnitodo-desktop）仅剩
一处改动前就有的 `tray.rs` unused import；`cd ui && npm test` 98 passed、`tsc --noEmit` 通过。
设置页用 stub IPC 在浏览器里走了一遍：带引号的 token 被拒绝且保存按钮禁用、保存后 ZCode 片段
与参数行同步换成新 token、重新生成需二次确认且片段跟随、通用 JSON 页签是顶层 `mcpServers` 形状、
写入开关即时改变能力表的勾叉颜色。
# 实现进度（对照设计 §16 交付分期）

本机无 GUI 环境，但**页面级冒烟已用虚拟显示（Xvfb）真实跑通**：启动打包好的应用、
用合成点击/按键走完各页面，并核对点击确实写进了数据库（见「页面级冒烟」一节）。
后续在一台有 Aqua 会话的 macOS 上又补做了**真实桌面冒烟**与 **macOS 打包**（见
「真实桌面冒烟（macOS）」与 [`docs/packaging.md`](./packaging.md)）。剩下未闭环的
只剩 Windows（MSI、真机运行）与签名、公证这类需要证书和对应平台的部分。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `cargo test --workspace` | **56 passed / 0 failed**（core 46 + mcp 10，见最新一轮记录） |
| `cargo clippy --workspace --all-targets` | 0 warning |
| `cargo clippy -p omnitodo-desktop --all-targets` | 0 warning（在 `rust:1-trixie` 容器内，见 `scripts/package-linux-docker.sh`） |
| `cd ui && npm test` | **157 passed / 20 文件**（vitest） |
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
| 数据真能显示 | 先用 CLI 往默认库（`~/.omnitodo/omnitodo.db`）灌 1 项目 + 3 任务（含重复规则与标签），再启动应用 | 侧栏出现「工作 2」「#汇报 1」「#设计 1」，Inbox 只列未归档的 `评审设计稿`（项目内任务不出现），优先级色块与截止文案正确 |
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

## 前端组件层（Ant Design v6）

`ui/` 的组件层已从手写 Tailwind 组件全量替换为 **Ant Design v6**，配色/圆角/字体按
[`DESIGN.md`](../DESIGN.md) 通过 `ConfigProvider` 的 `theme` 令牌注入（`ui/src/theme/antd.ts`），
明/暗/跟随系统三态同时驱动 antd 算法与自留 CSS 变量。两处刻意保留自绘：日历网格
（antd `Calendar` 无法承载跨格拖拽改期）与列表容器 `<ul>`（antd `List` 会丢 dnd-kit 排序与
`@tanstack/react-virtual` 开窗）。验证：`npm run build` + `npm test` 通过（此后随各轮功能扩展，
当前 157/157），并用无头 Chrome 渲染真实页面逐一核对了 Inbox（明/暗）、详情抽屉、日历、
快速添加、项目/标签视图、设置。

⚠️ **待复跑**：`scripts/smoke-gui-xvfb.sh` 用**硬编码坐标**点击（`ROW_Y`/`NAV_Y_*`/`PANEL_CLOSE_*` 等，
见该脚本第 109–129 行），antd 改版后侧栏 Menu、行高、抽屉位置都已变化，这些常量需要按新布局
重新标定；本机（macOS）无 X11/Xvfb，未能在此复跑，故上表 P1–P4 的页面级冒烟证据仍是改版**之前**
那一轮的结果。2026-10-16 加入的「列表 / 看板 / 日历」切换控件落在项目页页头右侧，列表模式的
行位置因此整体下移了一点，标定常量时一并核对。

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
- **拖拽的层级落点（本轮改动，已在浏览器里用真实 pointer 事件验证，未在打包后的桌面应用里人手拖过）**：
  落点语义已改成 **Todoist 式**——指针的垂直位置只选**间隙**（悬停行上半带＝落在它前面，下半带＝
  落在它后面），水平位移只定**层级**（每 20px 一格，`round(dx / ROW_INDENT_STEP)`，所以一次
  拖拽就能跨多层，而不是一层一次）；层级再被相邻行夹紧（不得比上一行深一层以上、不得比下一行浅），
  最后**由层级推导父级**。拖到顶层行旁边即升回上一层，往右推一格即成为上一行的第一个子任务——
  「拖进去」和「拖出来」因此是同一条规则的两个方向。算法与常量对齐逆向分析得到的 Todoist web
  实现（`getTaskPlacement`：`round(dx/28)` 后夹紧到 `[next, min(prev + 1, 5)]`）；OmniTODO 的
  缩进步长是 20px（`ROW_INDENT_STEP`），深度上限 5（`lib/layout.ts` 的 `MAX_TASK_DEPTH`，与 core
  `ensure_parent` 的上限一致）。决策是纯函数 `planPlacement`（`ui/src/lib/nestDrop.ts`，21 条单测，
  含"一次跨两层"、"夹紧到上限/下限"、"拒绝落进自己的子树"）；可见行由 `lib/visibleRows.ts` 在落点
  时刻从渲染出的 `<ul>` 上读回（哪些分支展开只有 DOM 知道，5 条单测）。写入沿用 core 早已支持的
  `task_update {parent_id | clear_parent_id}`（仅重挂父级时才写）再 `task_reorder(order)`。
  **已验**：`tsc --noEmit` + `vite build` + 全部测试文件全绿；并在 `dev-preview.html`
  （mock IPC）里用真实 pointer 事件跑通了四次完整拖拽——同级重排、往右推一格收为子任务
  （写 `parent_id` + `sort_order`）、往左拉回顶层（写 `clear_parent_id`）、以及**一次 40px 位移
  直接下潜两层**（成为孙任务）；每次落点线的缩进（`left` = `rowRuleInset(depth)`）与松手后
  实际写入的父级完全一致，控制台无报错。**未验**：打包后的桌面应用里人手拖一次——本机的
  `cua.drag` 只投递 move 事件、不投递按下/松开（实测 `pointerdown` 计数为 0），所以浏览器里的
  手势是由页面内派发的 pointer 序列驱动的，走的是同一套 React/dnd-kit 代码路径，但毕竟不是真人鼠标。
- **看板 / 板块 / 日历的拖拽（2026-10-16）**：同上，已在 `dev-preview.html` 里用页面内派发的
  pointer 序列验证（跨列换卡写 `section_id`、卡片落到另一张卡片的上半区即插到它之前、列内重排、
  列头手柄换位），**未在打包后的桌面应用里人手拖过**。同一轮还发现：这个环境里的 IAB 标签页
  一旦窗口失焦就不再产生动画帧（`requestAnimationFrame` 永不回调），Playwright 的
  actionability 检查因此永远等不到"稳定"，`click()` 一律超时——所以本轮的点选是用页面内
  派发的 `click` 驱动的，不是 `tab.playwright.click()`。这是环境限制，不是应用行为。

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
