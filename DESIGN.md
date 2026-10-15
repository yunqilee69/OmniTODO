# OmniTODO 视觉设计规范（DESIGN）

- 版本：v1.0
- 日期：2026-10-12
- 适用：`ui/`（React 19 + Tailwind）
- 关联文档：[`2026-10-12-todo-desktop-design.md`](./2026-10-12-todo-desktop-design.md)（产品与技术设计）、[`docs/implementation-status.md`](./docs/implementation-status.md)（实现进度）

本文回答两件事：**这类产品适合什么风格**（§1–§2），以及**具体怎么落地成一套令牌与组件规范**（§3 起）。规范里的每个令牌都能直接写成 CSS 变量与 Tailwind 配置（§10），并给出从当前实现迁移的路径（§11）。

---

## 1. 结论先行：TODO 类产品适合什么风格

**推荐方向：静默工坊（Quiet Workshop）—— 以「精密仪器 + 暖纸」为基调的冷静工具风。**

一句话：**像一台做工很好的仪器放在一张暖色纸面的书桌上**。它不是白底蓝按钮的"又一个效率 App"，也不是花哨的便签玩具；它安静、精确、有手感，把注意力全留给任务本身。

### 为什么是这个方向

TODO 应用的使用场景对风格有明确约束：

1. **每天开很多次、每次很短**。风格必须"一眼进入状态"，不能有需要适应的装饰。→ 排斥极繁与玻璃霓虹。
2. **要扫读大量条目**。信息密度是功能，不是缺点。→ 需要克制的层级与清晰的字重差，而不是大圆角大留白的"卡片流"。
3. **它要降低焦虑、而不是制造焦虑**。冷白 + 高饱和红会让人紧绷；暖中性纸面让人松弛。→ 暖色调基底。
4. **它是"我自己的工具"，本地优先、无账号、键盘驱动**。气质应对齐"工匠的工具"，而非"社交产品的门面"。→ 有手感、有克制、有签名细节。
5. **高频重复操作需要反馈的愉悦**。勾选完成是核心动作，值得一次满足的微交互。→ 动效聚焦在少数高光时刻。

### 候选方向对比

| 方向 | 代表气质 | 适配度 | 判断 |
|---|---|---|---|
| 极简冷静（Linear / Things 3） | 白底、细字、单一强调色 | 高 | 正确但**太容易撞款**，缺签名元素会沦为"通用后台" |
| **精密仪器（Braun / Rams 仪表盘）** | 暖中性、精确刻度、单一信号色 | **最高** | **选它**：兼具冷静、密度、手感与独特性 |
| 便签 / 手帐 | 暖纸、手写感 | 中 | 安抚但密度低、高频扫读不耐看 |
| 柔和糖果（马卡龙） | 圆角、糖果色 | 中 | 亲和，但显"玩具"，专业性不足 |
| 粗野主义（Brutalist） | 等宽、硬边、高密 | 中 | 极客向，但冷、可读性差、劝退普通用户 |
| 玻璃拟态 / 霓虹暗色 | blur + glow 渐变 | 低 | 花哨、伤可读性、已是过时套路 |
| 极繁 / 高饱和 | 装饰、动效堆叠 | 低 | 日常工具会迅速疲劳 |

> 本规范落在"精密仪器"一档，并用**暖纸基底 + 仪表绿信号色 + 优先级左缘刻度 + 手写勾**四个签名元素破"通用后台"的局。

---

## 2. 设计原则与反模式

### 2.1 五条原则

1. **信息优先（Information first）**：任何装饰若不能帮助理解或操作，就去掉。密度是被鼓励的。
2. **一个信号色（One signal）**：全局只有**一个品牌强调色**（仪表绿）。优先级、状态用另一套语义色系，二者永不混用。
3. **扁平 + 发丝线（Flat + hairline）**：默认无阴影，靠 1px 暖灰发丝线分层；阴影只留给真正"浮起来"的东西（菜单、弹窗、提醒卡）。
4. **颜色从不单独承载信息**：优先级/状态永远是"颜色 + 形状/文字"双通道（复选框圆环色 + `⋯` 菜单与 `sr-only` 里的优先级文案；日期色 + 警示图标 + 相对词），保证色觉障碍下可读。
5. **反馈要短促而确切（Fast, definite）**：动效 90–320ms，只出现在高光时刻；日常操作绝不弹跳、不连播动画。

### 2.2 反模式（明确禁止）

- 紫/蓝紫渐变配白底、渐变 hero 区。
- 把 `Inter / Roboto / system-ui` 当作品牌字体（只可作 CJK/离线兜底）。
- "每个卡片一个大柔和阴影 + 16px 大圆角 + 渐变描边"的 AI 后台套路。
- 用 emoji 当功能图标（📎 ↻ ✕ ＋ 🔔）——渲染不一致、气质像玩具。
- 纯黑色实心高亮做导航选中态（当前实现如此，见 §11）。
- 只靠颜色区分优先级。
- 骨架屏到处闪、彩带动效、常驻环境动画（对专注工具是干扰）。
- 超过 3 个字号的层级、超过 2 个强调色相。

---

## 3. 设计令牌：色彩

采用**语义令牌**命名，明/暗两套取值；组件只引用语义名，不写死色值。

### 3.1 基底与文字

| 语义令牌 | 明色（纸 Paper） | 暗色（炭 Charcoal） | 用途 |
|---|---|---|---|
| `--bg-app` | `#F6F3EE` | `#1A1816` | 应用底（暖纸 / 暖炭），带极淡纸纹（§6） |
| `--bg-surface` | `#FCFAF7` | `#211F1D` | 主内容面（列表、详情、卡片） |
| `--bg-sunken` | `#ECE8E0` | `#141311` | 侧栏 / 凹陷区 / 输入内陷 |
| `--bg-hover` | `rgba(33,31,28,.05)` | `rgba(237,233,226,.06)` | 行/项悬停 |
| `--bg-selected` | `rgba(14,110,99,.10)` | `rgba(63,167,149,.16)` | 选中（配合强调色左条） |
| `--border-hairline` | `#E4DFD7` | `#2E2B27` | 默认分隔线（1px） |
| `--border-strong` | `#CFC8BB` | `#3D3933` | 输入框、需要更明确边界处 |
| `--text-primary` | `#211F1C` | `#EDE9E2` | 正文、任务标题 |
| `--text-secondary` | `#57524A` | `#B3ACA0` | 次要文字 |
| `--text-tertiary` | `#8A8378` | `#857E72` | 元信息、计数、时间戳 |
| `--text-disabled` | `#B4AC9F` | `#5A544C` | 禁用 |
| `--text-on-accent` | `#FFFFFF` | `#0B2B27` | 强调色上的文字 |

### 3.2 品牌强调色（唯一信号色）

| 语义令牌 | 明色 | 暗色 | 用途 |
|---|---|---|---|
| `--accent` | `#0E6E63` | `#3FA795` | 品牌色：选中、焦点环、"现在"/今天、主按钮 |
| `--accent-hover` | `#0B5A51` | `#4FBBA8` | 悬停 |
| `--accent-soft` | `#E3EFEB` | `#12312C` | 强调色浅底（选中行底、标签底） |
| `--accent-ink` | `#0A4A43` | `#8FD8CC` | 强调色浅底上的文字 |

> 为什么是"仪表绿/铜绿"（verdigris，`#0E6E63`）而不是蓝？蓝是效率工具的重灾区（Linear/Things/TickTick 都是蓝），且冷白+蓝会加重紧绷感。铜绿少见于该品类、与暖纸和谐、天然传达"校准/专注/指北针"的仪器感，且与全部优先级语义色都不冲突。

### 3.3 优先级（复选框圆环，暖→热刻度）

优先级是**刻度**，由任务行复选框的圆环颜色表达，颜色由低到高升温。环永远画着——`none` 用中性描边，
不上色；也就是说"有没有颜色"和"优先级多高"是同一件事，不占额外空间。

| 优先级 | 令牌 | 明色圆环 | 说明 |
|---|---|---|---|
| none 无 | `--border-strong` | 中性描边 | 未设优先级 |
| low 低 | `--prio-low` | `#5A80B0`（灰蓝） | 最弱信号 |
| medium 中 | `--prio-medium` | `#E0A70F`（琥珀） | |
| high 高 | `--prio-high` | `#EF6A0E`（亮橙） | |
| urgent 紧急 | `--prio-urgent` | `#D81F1A`（朱红） | 最高 |

> 色相刻意沿 蓝 → 琥珀 → 橙 → 红 拉开：圆环只有 1.5px，
> 旧的赭石/焦橙/朱红三者色相过于接近，缩小到该粗细后几乎无法区分。
> **颜色不是唯一通道**：环色给视觉，`⋯` 按钮的可见名与行内 `sr-only` 文案给读屏（§13）。

### 3.4 状态语义色

| 语义令牌 | 明色 | 用途 |
|---|---|---|
| `--state-done` | `#6E7F60`（鼠尾草绿） | 已完成（勾痕、完成计数） |
| `--state-overdue` | `#C23B2E` | 逾期（=朱红，配合图标/文案，不单用色） |
| `--state-success` | `#3F7C4F` | 成功提示、MCP 连接正常 |
| `--state-warning` | `#B9882B` | 警告 |
| `--state-danger` | `#C23B2E` | 危险/删除 |
| `--state-info` | `#4A6FA5` | 系统/MCP 中性信息 |
| `--scrim` | `rgba(24,22,20,.38)` | 弹窗遮罩 |
| `--focus-ring` | `--accent`（2px，offset 2px） | 键盘焦点 |

### 3.5 对比度要求

- 正文/任务标题 ≥ **4.5:1**；大字号与 UI 图形边界 ≥ **3:1**。
- `--text-tertiary` 仅用于 ≥13px 的次级/元信息，不用于正文。
- 交付前用对比度检查器复核两套主题全部"文字 × 底"组合。

---

## 4. 设计令牌：字体

### 4.1 字族

| 角色 | 字族 | 用途 |
|---|---|---|
| UI / 正文 | **IBM Plex Sans SC** → IBM Plex Sans → `system-ui, "PingFang SC", "Microsoft YaHei", sans-serif` | 界面与任务文本；Latin 与中文同源，气质统一、非通用脸 |
| 展示 | **Fraunces**（variable）→ IBM Plex Sans SC → serif | 仅限：wordmark、空状态大标题、报告页大数字 |
| 等宽 | **IBM Plex Mono** → `ui-monospace, SFMono-Regular, monospace` | 时间、计数、快捷键提示、MCP token/端口、代码/URI |

> 字族不得换成 Inter/Roboto/system 作主字体。中文 UI 不设 letter-spacing（CJK 加字距会散）；Latin 小标签可 `+0.06em`。Fraunces 只用于展示层级，绝不进正文与表单。
> **离线要求**：桌面应用不能依赖 Google Fonts CDN。用 `@fontsource/*` 打包进 bundle（见 §11）。

### 4.2 字阶（桌面，root 16px）

| 名称 | 字号/行高 | 字重 | 字族 | 用途 |
|---|---|---|---|---|
| `display-xl` | 32 / 1.15 | 600 | Fraunces | 空状态标题、wordmark |
| `display` | 24 / 1.2 | 600 | Fraunces | 报告大数字、视图大标题 |
| `title` | 18 / 1.3 | 600 | Plex Sans | 视图标题（"今天"） |
| `section` | 15 / 1.4 | 600 | Plex Sans | 区块标题 |
| `body` | 14 / 1.5 | 400 | Plex Sans | 任务标题、输入 |
| `small` | 13 / 1.45 | 400 | Plex Sans | 次要说明 |
| `meta` | 12 / 1.4 | 500 | Plex Sans / Mono | chip、计数、时间戳 |
| `micro` | 11 / 1.3 | 600 | Plex Sans | 全大写分组标签（`+0.06em`） |
| `mono-num` | 12–13 | 500 | Plex Mono | 时间、快捷键、token（`tabular-nums`） |

- 字重只用 **400 / 500 / 600**（展示可 600）。禁止 700+。
- 任务标题最大行宽 **~72ch**；超长截断 + `title` 提示。
- 所有数字列（计数、日历、统计）启用 `font-variant-numeric: tabular-nums`。

---

## 5. 设计令牌：间距 · 圆角 · 层次

### 5.1 间距（4px 基准）

`0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`

| 场景 | 取值 |
|---|---|
| 图标与文字 | 6–8 |
| chip 内边距 | 水平 6 / 垂直 2 |
| 行内边距 | 见密度模式 |
| 面板内边距 | 16–20 |
| 区块间距 | 20–24 |
| 页面外边距 | 24 |

### 5.2 密度模式

| | comfortable | compact（默认） |
|---|---|---|
| 行高 | 40px | 32px |
| 行垂直内边距 | 8 | 4 |
| 列表字号 | body 14 | body 14 |
| 说明 | 触屏/演示 | 桌面键盘高频使用 |

密度由设置项或 `[data-density]` 切换。

### 5.3 圆角

| 令牌 | 值 | 用途 |
|---|---|---|
| `--r-xs` | 4 | 小 chip |
| `--r-sm` | 6 | 按钮、输入、导航项、任务行 |
| `--r-md` | 10 | 卡片、面板、chips 组 |
| `--r-lg` | 14 | 快速添加窗、模态 |
| `--r-full` | 999 | 复选框、圆点、胶囊 |

> 嵌套圆角 = 父圆角 − 间距间隔。大圆角只出现在真正"浮起"的容器。

### 5.4 阴影 / 层次

| 令牌 | 值 | 用途 |
|---|---|---|
| `--e0` | none（仅发丝线） | **默认**：列表、面板、卡片 |
| `--e1` | `0 1px 2px rgba(33,31,28,.06), 0 1px 1px rgba(33,31,28,.04)` | 悬停浮起、拖拽静置 |
| `--e2` | `0 4px 12px rgba(33,31,28,.10)` | 菜单、下拉、popover |
| `--e3` | `0 12px 32px rgba(33,31,28,.16)` | 模态、快速添加窗、提醒卡、拖拽中 |

原则：**扁平是常态，阴影是例外**。

---

## 6. 签名元素（让它不像"通用后台"）

这五点是本设计的辨识度来源，必须落在实现里：

1. **优先级圆环**：优先级直接长在复选框的圆环上（蓝→琥珀→橙→红），`none` 用中性描边。一眼扫读、无需 chip 堆叠，也不额外占用行宽——行的左缘因此是一条干净的直线，不带条纹。
2. **纸感基底**：`--bg-app` 上叠一层 ~2% 不透明度的细噪点（`feTurbulence` 生成的内联 SVG 或极淡 PNG），侧栏顶边加 1px 微高光。多一分"实物"感，少一分"平网页面"。
3. **仪表绿焦点**：所有"选中/现在/今天/主操作"都用铜绿。导航选中 = 左缘 2px 强调条 + `--bg-selected` 底，**不是黑色实心胶囊**。
4. **手写勾**：复选框勾选时，勾线以 `stroke-dashoffset` 画出（约 160ms），而非瞬间出现。
5. **"今天"指针线**：Today/Upcoming 列表与日历里，用 1px 强调色细线 + 小圆点标记"现在/今天"，像仪表指针。

---

## 7. 布局

### 7.1 三栏骨架

```
┌───────────┬─────────────────────────────┬──────────────────┐
│ Rail 264  │ List 自适应(≥360)            │ Detail 400       │
│ 导航/项目 │ 标题栏 + 列表（虚拟滚动）     │ 详情（可改宽/抽屉）│
│ /标签     │                             │                  │
└───────────┴─────────────────────────────┴──────────────────┘
```

| 区域 | 宽度 | 说明 |
|---|---|---|
| Rail（`--bg-sunken`） | 默认 264，可拖 220–320 | 顶：Fraunces wordmark；**「添加任务」主按钮**（唤起快速添加）；搜索框；四条入口导航（收件箱/今天/即将到来/日历）；项目（色点+计数，可折叠）；标签（计数）；底：设置入口 + 明暗切换 |
| List（`--bg-surface`） | `flex-1`，min 360 | 顶栏**通栏**：视图标题（`title`）+ 计数靠左，工具靠右（项目视图右端是「显示设置」齿轮，弹窗里配「是否显示已完成」与排序方式）；主体列表在**居中的定宽内容栏**（上限 760）里，>60 行开虚拟滚动 |
| Detail（`--bg-surface`） | 弹窗，默认 560 | 居中弹窗（`centered` + `--r-lg` + `--e3`，无底栏），正文超长时内部滚动：标题/状态/优先级/时间/项目/描述/重复/标签/附件。用弹窗而非右侧抽屉——详情是一份自上而下读的表单，居中后与唤出它的列表同轴，而不是挂在窗口右缘 |

- 栅格 8px；内容外边距 24px。
- **窄窗降级**：窗口 < 720px → Rail 折成 56px 图标栏。
- 提醒卡：右下角堆叠，宽 320，`--e3`。
- 快速添加：悬浮输入框（不遮挡页面，无遮罩），**窗口水平居中、垂直偏上**；宽 640（上限），`--r-lg` + `--e3`。

### 7.2 当前实现差异（见 §11 迁移）

现在是两栏（Rail + List）+ 详情浮层；目标为三栏可调。迁移可分阶段，不阻塞。

---

## 8. 组件规范

> 每个组件给出：用法 / 关键令牌 / 状态 / 易错点。当前文件列在括号内，便于对照改造。

### 8.1 导航项（`ProjectSidebar.tsx` / `App.tsx`）
- 结构：`图标 + 文本 + 计数`，`--r-sm`，高 28–30，内边距水平 8。
- 默认：`--text-primary`；悬停：`--bg-hover`。
- **选中**：`--bg-selected` 底 + 左缘 2px `--accent` 条 + 文本 `--accent-ink`（暗色为 `--accent`）；计数弱化。
- 悬停才显示的行内操作改为 `⋯` 图标，点击弹出「编辑 / 删除」菜单（删除项用 `--state-danger`）。
- 项目行右端是**一个共享槽位**：默认显示未完成任务计数（`tabular`/11px，弱化），悬停或键盘聚焦（以及菜单展开时）换成 `⋯` 按钮 —— 行较窄，两者不并列，避免挤压项目名。槽位定宽，切换时不抖动。按钮常驻 DOM，只用样式控制显隐，保证键盘可达。

### 8.2 分组标签（`micro`）
- 全大写、`--text-tertiary`、`+0.06em`、上方 16 下方 6。中文标题不强制全大写（中文无大小写），改为 12px/600/`--text-tertiary`。
- 标题右侧为操作簇：新建入口（`+`）在前、折叠图标在最右。点击折叠图标折叠/展开该组列表，折叠状态写入 `localStorage` 跨重启保留；列表折叠时标题与「新建」入口保持可点。计数只出现在各项目行上（见 §8.1），分类标题行不放数字。

### 8.3 任务行（`TaskRow.tsx`）——本设计的核心组件
- 布局：`[拖拽手柄?] [展开箭头 | 拖拽手柄] [复选框(带优先级环)] [标题 / 描述 / 日期·子任务进度 flex] [标签] [附件/重复图标] [＋日期] [⋯]`
- **左侧两个槽位常驻**（无论是否有内容），复选框因此始终在同一条左缘上。紧贴复选框的槽位：有分支的行放**常显**的展开箭头，没有分支的行放**悬停才出现**的拖拽手柄；有箭头的行把手柄再往左挪一位。手柄是悬浮操作，箭头是状态提示，两者不抢同一个位置。
- 悬浮控件**只在悬停、拖拽中、或键盘聚焦时出现**：判定用 `:focus-visible` 而不是 `:focus-within`——鼠标点过的手柄/`⋯` 不该因为留着焦点就一直可见，而 Tab 过来的要能看见。
- 高度按密度模式；行左缘是一条干净的直线——优先级不在这里（见 §3.3/§8.4）。
- 标题：`body`；完成态 `--text-disabled` + 删除线（删除线动画见 §9）。
- **列表容器只有发丝线**：行与行之间 `1px --border-hairline` 分隔，容器本身不要外框、圆角、底色或阴影（§5.4 的 `--e0` 默认）。任务行是"一叠规则线"，不是"一叠卡片"。发丝线**左端从复选框列起画**，不横穿手柄/箭头所在的左侧槽位；右端到内容栏右缘。列表在一条**定宽内容栏**里（上限 760），所以发丝线只跟任务一样长，不会横贯整个窗口；页头是通栏的（标题靠左、工具靠右），两者不必对齐。**居中以列表为准**：内容栏整体左移半个左侧槽位宽度，让复选框列与标题回到轴线上——两个槽位是操作外壳，居中的是任务；纯居中内容栏会把整列任务推到轴线右侧。
- **任意深度的分支都能开合**：子任务行与顶层行是同一套行——在可拖拽的列表里它同样带手柄，且自己还有子任务时带上展开箭头，展开/折叠自己的那一支。不展开就看不到更深的层级，不会一次性铺开整棵子树。拖拽只在**同一父级**的兄弟之间成立，每个兄弟组各自一个 `SortableContext`。
- **行内元信息集中在标题下方一行**（Todoist 式）：日期 chip 与子任务进度同处一行、间隔 12px，`meta` 字号，与标题左对齐；行右端只留标签、附件/重复图标和悬停才出现的 `＋日期` / `⋯`。这样扫读时"何时到期、还有几个子任务"紧贴标题，视线不用横穿整行。
- 悬停：**行本身不加底色**——悬停要露出的手柄与 `＋日期` / `⋯` 淡入就是反馈；整行铺一层 `--bg-hover` 会让"一叠规则线"变浑浊（§8.1 的侧栏导航项仍用 `--bg-hover`，那里是单行、需要指出落点）。**悬停不得改变行高**——所以没有日期时"＋日期"待在右侧槽位里淡入，而不是在标题下方凭空多出一行。
- 逾期：日期用 `--state-overdue` 文字 + 小警示线性图标（不单靠红色）；今天用 `--accent`（§6.3）；其余日期 `--text-tertiary`。
- **子任务进度**（`has_subtasks` 为真的行）：`[分支图标] done/total`，`meta` 字号、`--text-tertiary`；整个分支完成时改 `--state-done`。计数按**整棵子树**（任意深度）统计，与展开后实际显示的行数一致；`done` 与 `cancelled` 都算已勾（与复选框同一规则），否则被取消的子任务会让父行永远差一个。行的展开箭头与进度都只是"这一支有内容"的提示，不展开也能读到，所以未展开时也要显示。
- **易错点**：不要给行加阴影（列表靠发丝线分隔）；不要用行背景色编码优先级（用复选框环色）；窗口化渲染的行是绝对定位的，容器上的分隔线不会落到它们身上，需由行自身携带边框。

### 8.4 复选框（`TaskRow.tsx`）
- 24px 触区，视觉 16px 圆形，1.5px 描边；**描边色即该任务的优先级**（§3.3，`none` 为 `--border-strong`）。`TaskRow` 通过 `--checkbox-ring` 把色值交给 `index.css` 里的共享规则，v6 把边框画在 `.ant-checkbox` 本身，`border-width` 需显式覆盖。
- 悬停：描边变 `--accent`。勾选：填充 `--accent`（暗色 `--state-done`）+ 白/深勾，勾线 160ms 画出。
- 键盘：`Space` 切换，`:focus-visible` 显示 2px 焦点环。

### 8.5 优先级指示
- 行内：**复选框圆环的颜色**（§3.3/§8.4）。没有独立的优先级控件，也不在行尾放圆点——行宽留给标题。
- 就地编辑：`⋯` 菜单里的「优先级」子菜单（无 / 低 / 中 / 高 / 紧急），当前项带勾、其余项带对应色圆点；菜单项在无 `onPatch` 时置灰。
- 无障碍：颜色是唯一视觉通道，因此 `⋯` 按钮的可见名里带上当前优先级（`更多操作：<标题>（优先级：高）`），行内另有一份 `sr-only` 文案（§13）。
- 详情面板：圆点 + 文字标签，两通道。

### 8.6 日期（`TaskRow.tsx` / `TaskDetail.tsx`）
- 行内位置：**标题下方那一行**，与子任务进度同一行；不再是行尾 chip。
- 无值：`＋日期`，藏在行右端槽位里、悬停才显示（不占行高）；有值：`meta` 字号 + Plex Mono 数字，无边框 `DatePicker`，点开即改期。
- 今天/明天等相对日期优先展示相对词，超出一周显示 `M月D日`。
- 颜色只有两档（§6.3）：逾期 `--state-overdue` + 小警示图标（双通道），今天 `--accent`，其余 `--text-tertiary`。

### 8.7 标签 chip（`TagPicker.tsx`）
- `#名称`，`meta` 字号，`--accent-soft` 底 + `--accent-ink` 文字；纯文字标签页可用中性底。
- 可多选；已选带勾；搜索框过滤。

### 8.8 按钮

| 变体 | 样式 | 用途 |
|---|---|---|
| Primary | `--accent` 底 + `--text-on-accent`，`--r-sm`，高 32 | 主操作（新建、保存、导入确认） |
| Secondary | `--bg-surface` + `--border-strong` 描边，文字 `--text-primary` | 次级操作 |
| Ghost | 透明底，悬停 `--bg-hover` | 工具栏、图标按钮 |
| Danger | `--state-danger` 底或描边 | 删除确认 |
| Link | `--accent` 文字 + 悬停下划线 | 内联跳转（如 Releases 地址） |

- 高 32（`compact`）/ 36（`comfortable`）；水平内边距 12；图标按钮 32×32。
- 全部有 `:hover`（降亮度/加底）、`:active`（`translateY(0.5px)`）、`:focus-visible`（焦点环）、`:disabled`（`--text-disabled`、无悬停）。

### 8.9 输入 / 文本域 / 下拉
- 高 32；`--bg-sunken` 或白底 + `--border-strong`；`:focus` 换 `--accent` 描边 + 环。
- 占位文字 `--text-tertiary`。**注意**：`input[type=date]` 空值在 WebKit 会显示灰色示例值（`docs/implementation-status.md` 缺陷 4）——用自定义日期选择或加显式占位修饰规避。

### 8.10 详情面板（`TaskDetail.tsx`）
- 单列分区，区段间 `--border-hairline` 分隔，不用卡片套卡片（子任务清单同样只有发丝线，没有外框）。
- 子任务清单整列**不缩进**（`TaskRow gutters={false}`）：区段标题已说明这里是子任务，再按复选框列缩进会让行和下面的输入框都比同表单其它字段窄一截——清单行的复选框、下面的添加框、上面「重复」的输入框共用区段左边缘。输入框就是 §8.17 那个盒子（`TaskComposer`），只是落库走 `task_add_subtask`（项目随父任务继承，深度上限 5），入口是**区段标题右端的「＋」**（`showTrigger={false}`，盒子只在打开时挂载）。
- 标题为大号可编辑文本（`section`/`title` 字号）。完成、优先级、时间、项目为一组"属性行"。
- 描述：Markdown `textarea` + 预览切换（`MarkdownPreview.tsx`）。
- 附件：行式列表（图标 + 文件名 + 大小 + 删除），拖入上传区用虚线 `--border-strong`。
- 重复编辑器（`RecurrenceEditor.tsx`）：频率分段控件 + 间隔/星期选择，预览人类可读文案。

### 8.11 提醒卡片（`ReminderToasts.tsx`）
- `--bg-surface` + `--border-hairline` + `--e3`，`--r-md`，宽 320，右下堆叠 `gap 8`。
- 结构：状态红点（纯 CSS，非 emoji）+ 标题 + 提醒时间（Mono）+ 三个"稍后"Ghost 小按钮 + 关闭。
- 入场：上滑 200ms + 阴影渐入。

### 8.12 快速添加（`QuickAddPanel.tsx`）
- 悬浮输入框，一行三段：左「＋」字段菜单 · 中「任务名称」输入 · 右「×」关闭。无常驻 AI 区。
- **位置**：窗口**水平居中、垂直偏上**（`top: 90`，宽 648 上限），无遮罩，不遮挡下方列表。居中用 `left/right: 0` + `margin-inline: auto`，不用 `translateX(-50%)`——入场动效动的是 `transform`，用 transform 居中会在 140ms 内被覆盖、面板横向跳一下。
- 「＋」菜单逐行列出简写字段（描述 `::` / 项目 `#` / 截止 `^` / 开始 `>` / 标签 `@` / 优先级 `!` / 提醒 `~` / 重复 `*`），**右侧以 Mono 显示该字段的简写示例**；点选即在光标处插入对应 token。
- 下方按需展示实时解析 chips（标题 / `#项目` / `!优先级` / `^时间` / `@标签` / `::描述`）与 `#项目` 歧义选择列表（设计 §12.2）；无解析结果时给一行简写提示。
- 唤起：侧栏「添加任务」按钮、全局快捷键、**托盘菜单「快速添加…」**，均打开同一面板；托盘/快捷键这两种窗口外的入口要**先把主窗口抬到前台**（`unminimize` + `show` + `set_focus`）再发 `quickadd:open`，否则面板开在用户看不见的地方。回车落库并关闭；Esc、点击面板外关闭。

### 8.13 日历（`Calendar.tsx`）
- 月/周网格；格内任务用小条（`--r-xs`），颜色取项目色或优先级刻度。
- 今天格：`--accent` 描边 + `--accent-soft` 底。
- 已物化期次：实心、可拖；未来重复期次：虚线、只读（设计 §13.1）。
- "现在"指针线（§6.5）。

### 8.14 空状态
- 居中：Fraunces 大标题（如"今天很干净"）+ 一句次级说明 + 一个 Primary 操作。
- 用最小插画（线性、单色、呼应纸纹），不用 emoji 大图。

### 8.15 MCP 状态灯（`Settings.tsx`）
- 小圆点 + 文案：`--state-success`（运行中）/ `--text-tertiary`（未启用）/ `--state-danger`（错误）。
- token/端口用 Mono 展示 + 一键复制（Ghost 图标按钮）。

### 8.16 Toast / 提示
- 底部或右下，`--e2`，`--r-md`，4s 自动消失；成功 `--state-success` 图标，错误 `--state-danger`。

### 8.17 添加任务行（`TaskComposer.tsx`）
- 位置：列表最后一行，新任务就落在它上方，视线不用跳。
- **宽度与列表一致**：收起态与展开态同宽——左端对齐复选框列（`LIST_LEFT_INSET`），右端到内容栏右缘，即与任务行的发丝线等宽；展开态不再多吃 12px 内边距，也不是一个漂浮在列表左边缘之外的独立表单。
- **收起态**：一行 `＋ 添加任务`（`＋` 用 `--accent`，文字 `--text-secondary`），缩进对齐上方标题；悬停文字变 `--accent`。它是一条通栏按钮，不是虚线框。
- **展开态**：一个真正的输入框——`--bg-surface` + `1px --border-strong` + `--r-md`，内含「任务名称」（`body`）与「描述」（`meta`）两行无边框输入，底部分隔线以下是工具行。
- 工具行（左→右）：优先级（`＋` 图标，设置后换成对应色的小旗，点开 5 项菜单）· 项目 chip（项目色 `#` + 名称，静态，说明这条会落到哪里）· 日期 chip（`--bg-hover` 底，`meta` 字号，有值后用 `--accent`）。右端是 `×` 收起。
- 日期是"整天"，落库写 `all_day`，避免跨时区漂移。
- 键盘：`Enter` 落库并清空、焦点留在标题继续下一条；`Esc` 收起；两行都空时失焦自动收起。
- **易错点**：标签 / 提醒 / 重复**不**放在这里——它们的简写入口归悬浮快速添加面板（§8.12），同一字段有第三处入口就多一处要维护。

---

## 9. 动效规范

| 时长令牌 | 值 | 用途 |
|---|---|---|
| `--t-instant` | 90ms | 悬停/按压的颜色变化 |
| `--t-fast` | 140ms | 小元素进出、chip 弹出 |
| `--t-base` | 200ms | 面板滑入、提醒卡、抽屉 |
| `--t-slow` | 320ms | 空状态/页面载入 |
| `--ease-out` | `cubic-bezier(.2,.6,.2,1)` | 进入/默认 |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 退出 |

**只做这几个高光时刻**：

1. **勾选完成**（签名交互）：勾线画出（160ms）→ 标题删除线左→右画出 → 行背景闪一下 `--accent-soft` 再退去（约 300ms）→ 若当前筛选会隐藏已完成，则 400ms 后行淡出收拢。
2. **列表载入**：`translateY(4px)→0` + 透明度，每项错开 24ms，最多前 8 项，每视图一次。
3. **详情面板**：从右滑入（`translateX(12px)` + 透明度，200ms）。
4. **快速添加解析**：chips 逐条弹出（120ms）。
5. **拖拽**：拿起 `scale(1.01)` + `--e3` + `cursor: grabbing`；落下 140ms 落定。
6. **提醒卡**：上滑 200ms + 阴影渐入。

**禁止**：弹跳/弹簧（日常动作）、视差、常驻环境动画。
**无障碍**：`@media (prefers-reduced-motion: reduce)` 下所有位移/缩放归零，仅保留透明度渐隐。

---

## 10. 令牌落地（Tailwind + CSS 变量）

### 10.1 `ui/src/index.css`（令牌源，替换当前内容）

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* 基底与文字（明：纸） */
  --bg-app: #f6f3ee;
  --bg-surface: #fcfaf7;
  --bg-sunken: #ece8e0;
  --bg-hover: rgba(33, 31, 28, 0.05);
  --bg-selected: rgba(14, 110, 99, 0.10);
  --border-hairline: #e4dfd7;
  --border-strong: #cfc8bb;
  --text-primary: #211f1c;
  --text-secondary: #57524a;
  --text-tertiary: #8a8378;
  --text-disabled: #b4ac9f;
  --text-on-accent: #ffffff;

  /* 品牌强调（唯一信号色：仪表绿） */
  --accent: #0e6e63;
  --accent-hover: #0b5a51;
  --accent-soft: #e3efeb;
  --accent-ink: #0a4a43;

  /* 优先级刻度 */
  --prio-low: #5a80b0;
  --prio-medium: #e0a70f;
  --prio-high: #ef6a0e;
  --prio-urgent: #d81f1a;

  /* 状态 */
  --state-done: #6e7f60;
  --state-overdue: #c23b2e;
  --state-success: #3f7c4f;
  --state-warning: #b9882b;
  --state-danger: #c23b2e;
  --state-info: #4a6fa5;
  --scrim: rgba(24, 22, 20, 0.38);
  --focus-ring: var(--accent);

  /* 圆角 / 阴影 / 动效 */
  --r-xs: 4px; --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-full: 999px;
  --e0: none;
  --e1: 0 1px 2px rgba(33,31,28,.06), 0 1px 1px rgba(33,31,28,.04);
  --e2: 0 4px 12px rgba(33,31,28,.10);
  --e3: 0 12px 32px rgba(33,31,28,.16);
  --t-instant: 90ms; --t-fast: 140ms; --t-base: 200ms; --t-slow: 320ms;
  --ease-out: cubic-bezier(.2,.6,.2,1);
  --ease-in: cubic-bezier(.4,0,1,1);

  /* 字体 */
  --font-ui: "IBM Plex Sans SC", "IBM Plex Sans", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-display: "Fraunces", "IBM Plex Sans SC", serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
}

:root[data-theme="dark"] {
  --bg-app: #1a1816;
  --bg-surface: #211f1d;
  --bg-sunken: #141311;
  --bg-hover: rgba(237, 233, 226, 0.06);
  --bg-selected: rgba(63, 167, 149, 0.16);
  --border-hairline: #2e2b27;
  --border-strong: #3d3933;
  --text-primary: #ede9e2;
  --text-secondary: #b3aca0;
  --text-tertiary: #857e72;
  --text-disabled: #5a544c;
  --text-on-accent: #0b2b27;
  --accent: #3fa795;
  --accent-hover: #4fbba8;
  --accent-soft: #12312c;
  --accent-ink: #8fd8cc;
  --scrim: rgba(0, 0, 0, 0.55);
  --e1: 0 1px 2px rgba(0,0,0,.4);
  --e2: 0 4px 12px rgba(0,0,0,.5);
  --e3: 0 12px 32px rgba(0,0,0,.6);
}

html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg-app); color: var(--text-primary); font-family: var(--font-ui); }
.tabular { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

> 纸纹可用一层伪元素叠内联 SVG `feTurbulence`（baseFrequency ~0.8，opacity 0.02）实现，见 §6.2。

### 10.2 `ui/tailwind.config.js`（把语义令牌映射成工具类）

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        surface: "var(--bg-surface)",
        sunken: "var(--bg-sunken)",
        hairline: "var(--border-hairline)",
        strong: "var(--border-strong)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
        disabled: "var(--text-disabled)",
        accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", soft: "var(--accent-soft)", ink: "var(--accent-ink)" },
        prio: { low: "var(--prio-low)", medium: "var(--prio-medium)", high: "var(--prio-high)", urgent: "var(--prio-urgent)" },
        done: "var(--state-done)", overdue: "var(--state-overdue)",
        success: "var(--state-success)", warning: "var(--state-warning)",
        danger: "var(--state-danger)", info: "var(--state-info)",
      },
      borderRadius: { xs: "var(--r-xs)", sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)" },
      boxShadow: { e1: "var(--e1)", e2: "var(--e2)", e3: "var(--e3)" },
      fontFamily: { ui: "var(--font-ui)", display: "var(--font-display)", mono: "var(--font-mono)" },
      transitionTimingFunction: { out: "var(--ease-out)", in: "var(--ease-in)" },
    },
  },
  plugins: [],
};
```

> 迁移期的兼容做法：把 `text-neutral-900` → `text-primary`、`text-neutral-500` → `text-secondary`、`bg-neutral-50` → `bg-app`、`border-neutral-200` → `border-hairline`、`bg-neutral-900 text-white`（选中态）→ `bg-accent-soft text-accent-ink`，逐步替换。

---

## 11. 迁移路线（对照当前实现）

当前 `ui/` 是完全默认的 Tailwind：清一色 `neutral-*`、系统字体、`rounded`/`rounded-lg`、几乎无动效、emoji 当图标（脚本可复核，见 `grep -rhoE '(bg|text|border)-neutral-[0-9]+' ui/src`）。按下面顺序改，每步都可独立验收：

| 阶段 | 动作 | 涉及文件 |
|---|---|---|
| **S1 令牌** | 写入 §10 的 `index.css` 与 `tailwind.config.js`；接入 `@fontsource-variable/fraunces`、`@fontsource/ibm-plex-sans(-sc)`、`@fontsource/ibm-plex-mono`，在 `main.tsx` import | `index.css`, `tailwind.config.js`, `package.json`, `main.tsx` |
| **S2 骨架** | 应用底/侧栏/内容面换 `bg-app`/`bg-sunken`/`bg-surface`；导航选中态由黑胶囊改为强调色左条 + 浅底 | `App.tsx`, `ProjectSidebar.tsx` |
| **S3 任务行** | 加左缘优先级刻度；复选框定制 + 手写勾；日期/优先级 chip 令牌化；换 Lucide 图标替 emoji | `TaskRow.tsx`, `TaskList.tsx` |
| **S4 面板与卡** | 详情面板、提醒卡、快速添加套用 `--r-*`/`--e*` 与入场动效 | `TaskDetail.tsx`, `ReminderToasts.tsx`, `QuickAddPanel.tsx` |
| **S5 动效与空态** | 勾选完成微交互、列表载入错开、空状态换 Fraunces 大标题 | `TaskRow.tsx`, `TaskList.tsx` 各视图 |
| **S6 主题** | 设置里接明/暗切换（`data-theme`），暗色令牌已在 §10.1 备好 | `Settings.tsx`, `stores/ui.ts` |

**验收注意**：`scripts/smoke-gui-xvfb.sh` 等冒烟脚本含像素断言（区域灰度变化、标题区深色文字），改主题后需**重跑**：断言多为"变化前后对比"，本身与配色无关，但 deep-link 用例断言"标题区有深色文字"，浅色主题下依然成立，仍建议实机复核一遍。字体必须**打包进 bundle**（离线/打包环境无网络）。

---

## 12. 文案与语气

- 默认 `zh-CN`，克制、直接、动词开头。按钮用动词（"新建项目""稍后 10 分钟"）。
- 空状态给"平静 + 下一步"，不卖萌（"今天很干净" + "记一件要做的事"）。
- 危险操作说清后果（"删除项目（连同其任务）"——已是现状，保持）。
- 时间用相对词优先（今天/明天/周三），超一周落回日期。
- 技术信息（端口、token、URI）一律 Mono 等宽展示。

---

## 13. 无障碍清单

- [ ] 两套主题所有"文字×底" ≥ AA；`--text-tertiary` 不进正文。
- [ ] 优先级/状态 = 颜色 + 形状/文字双通道。
- [ ] 全部可交互元素可 Tab 到达、`:focus-visible` 有 2px 焦点环。
- [ ] 复选框/导航支持键盘（`Space`/`Enter`/方向键）；拖拽有键盘替代（上/下移）。
- [ ] `prefers-reduced-motion` 生效。
- [ ] 焦点不因面板开关而丢失（详情关闭后焦点回到触发行）。
- [ ] `aria-label` 覆盖图标按钮（现状已有 `${'完成 '}${title}` 之类，保持）。

---

## 14. 令牌速查

| 类别 | 令牌 |
|---|---|
| 面 | app / surface / sunken / hover / selected |
| 线 | hairline / strong |
| 字 | primary / secondary / tertiary / disabled / on-accent |
| 强调 | accent / accent-hover / accent-soft / accent-ink |
| 优先级 | prio-low / prio-medium / prio-high / prio-urgent |
| 状态 | done / overdue / success / warning / danger / info / scrim / focus-ring |
| 圆角 | r-xs 4 / r-sm 6 / r-md 10 / r-lg 14 / r-full |
| 阴影 | e0 无 / e1 / e2 / e3 |
| 动效 | t-instant 90 / t-fast 140 / t-base 200 / t-slow 320 · ease-out / ease-in |
| 字族 | font-ui（Plex Sans SC）/ font-display（Fraunces）/ font-mono（Plex Mono） |

---

## 15. 实现状态（当前）

组件层由 **antd v6** 承担，配色/圆角/字体等令牌通过 `ConfigProvider` 的 `theme` 喂给 antd
（**不是**用 antd 默认蓝）。这样既拿到 antd 的开箱组件与交互，又保留本规范的「静默工坊」外观。
`antd@6` 要求 `react >= 18`（本项目 React 19，无需 v5 的 React 19 patch），且 v6 的选择器不再用
`:where(...)`，因此与 Tailwind preflight 不冲突，无需 `StyleProvider`。

| 层 | 落地 |
|---|---|
| 主题 | `src/theme/antd.ts`：`buildAntdTheme(light|dark)` 把 §3 调色板映射为 `colorPrimary`（仪表绿）、`colorBgLayout/Container/Elevated`、`colorText*`、`colorBorder*`、`borderRadius`、`fontFamily`、`controlHeight` 等，并按明暗切换 `defaultAlgorithm`/`darkAlgorithm`；`Layout`/`Menu`/`Card`/`Segmented`/`Drawer` 等做了组件级覆盖 |
| 组件 | 应用壳用 `Layout`+`Sider`+`Menu`；任务行用 `Checkbox`/`Typography.Text(delete,ellipsis)`/`Tag`/`Dropdown`/`DatePicker`/`Tooltip`；详情用 `Drawer`+`Select`/`DatePicker`/`Switch`/`Input.TextArea`/`Popconfirm`；提醒用 `App.useApp().notification`；日历/快速添加/设置用 `Segmented`/`Button`/`Tag`/`Alert`/`Card`/`Upload`/`Switch`；设置页的 MCP 面板另用 `Tabs`（按客户端分页）与 `Table`（能力对照表）；加载/空/错误态用 `Skeleton`/`Empty`/`Alert`；表单校验与反馈用 `Popconfirm`/`message` |
| 自留样式 | `src/index.css` 只保留 antd 不负责的部分：调色板 CSS 变量（供纸纹、优先级圆环色、行悬停使用）、页面底色/字体、细滚动条、纸纹、`tabular` 数字；外加**任务行的自有外观**（§8.3/§8.4）：`.task-row` 的悬停底色、次级操作（`＋日期` / `⋯`）的淡入、添加框的聚焦态，以及把 antd v6 的方形复选框改成圆形并按 `--checkbox-ring` 上色——v6 把边框画在 `.ant-checkbox` 元素本身，旧版的 `.ant-checkbox-inner` 已不存在，`border-width` 需显式覆盖才能到 1.5px。§4/§5 的字阶、间距、圆角仍由 antd token 表达；§5.4 的 `--e1/--e2/--e3` 在 `index.css` 定义为 CSS 变量、由 `tailwind.config.js` 的 `boxShadow.e*` 映射成 `shadow-e*` 工具类（`--e0` 即"无类"，默认不写） |
| 图标 | 全部改用 `@ant-design/icons`（替换原先的手写 SVG 与 emoji） |
| 主题切换 | 明/暗/跟随系统；写 `[data-theme]` 供自留 CSS 变量，同时驱动 antd algorithm；持久化到 `settings.ui.theme` |

**两处刻意的偏离**（都是为了不丢功能）：

1. **日历网格自绘**：antd `Calendar` 无法承载「把已物化期次拖到另一天」的跨格拖拽，故月/周网格保留 CSS Grid，工具栏与任务块用 antd `Segmented`/`Button`/`Tag`。
2. **列表容器是 `<ul>`**：dnd-kit 排序与 `@tanstack/react-virtual` 都需要真实行元素，antd `List` 的 `<li>` 容器无法承载；列表状态仍用 antd `Skeleton`/`Empty`/`Alert`。

**字体偏差**：`@fontsource/ibm-plex-sans-sc` 不存在，中文回退系统字体（PingFang SC / Microsoft YaHei /
Noto Sans CJK SC）；Latin 自托管 `IBM Plex Sans`，展示字体 `Fraunces Variable`、等宽 `IBM Plex Mono`
（仅打包 latin 子集，约 250 KB）。

**验证**：`cd ui && npm run build`（`tsc --noEmit` + Vite）通过；`npm test` 74/74 通过（含
`TaskRow` / `TaskComposer` 两个组件级用例）；
已用无头 Chrome 渲染真实页面（通过临时 `preview.html` 桩掉 Tauri IPC）核对 Inbox 明色外观。
代价：antd 使前端产物增至约 1.3 MB（gzip ~420 KB）。像素级全页验收仍建议在真实桌面会话或
仓库自带的 Xvfb 冒烟（`docs/implementation-status.md`）中复跑。



