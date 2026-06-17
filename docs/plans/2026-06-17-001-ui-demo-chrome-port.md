---
title: 把 ui-demo（当前 main）整套外观照搬进 Electron app
status: active
date: 2026-06-17
origin: 用户直述需求（口头）；参考 ui-demo on origin/main（PR #39/#40/#41 合并后的 Notion 化版本）
branch: feat/heyhtml-canvas-editor
---

# 把 ui-demo（当前 main）整套外观照搬进 Electron app

## 问题 frame

Electron app 现在的 chrome（横向顶栏 + 浮动 Notion 气泡）跟产品 ui-demo 差太远，用户明确不满。
ui-demo 在 origin/main 上是一套 **Arc 式桌面应用外观**：左侧 274px 文件管理侧栏（omnibox + 收藏 + 标签页
+ 文档树 + 底部 util/头像/空间切换）、右侧白色编辑区（顶部面包屑 + 元信息行、右上角蓝色「分享」浮动钮、
Notion 分块文档）。**没有横向顶栏，也没有底部 AI 条**（当前 main 已去掉）。

目标：把 ui-demo 的**视觉/样式**照搬进 Electron app，让两者看起来像同一个产品。功能边界见下。

> 关键事实更正：实现初期参考了**本地旧 ui-demo**（带 AI 条、无「收藏」），用户指出后已 `git checkout
> origin/main -- ui-demo/` 把工作树 + 本分支 ui-demo 同步到**当前 main**。本 plan 一切以当前 main 的
> ui-demo 为准（tokens.css / global.css / App.css 未变；ArcSidebar / Canvas / TopActions 已 Notion 化）。

## Scope 边界

**做（样式照搬）**
- 左侧文件管理侧栏：照搬 `arc-sidebar` 的结构 + CSS，做成**装饰性外观**（静态假数据填充，看起来像 ui-demo）。
- 右侧编辑区：照搬 `ws-canvas` chrome（白底、居中、文档头面包屑 + 元信息），**直接照抄**。
- 顶部控件：去掉现在的横向顶栏，真功能键（打开/预览/历史/保存）收进编辑区**右上角浮动 actions**
  （照 ui-demo `TopActions` 的蓝色主钮 + ghost 钮风格）。【用户已拍板：右上角浮动 actions、去横顶栏】
- 全量引入 ui-demo 的 design tokens + global reset（细滚动条、选区色、字体栈）。

**不做（功能）**
- 侧栏**只抄样式不抄功能**：鼠标移上去**禁止操作** + 提示「开发中」（整片 lockout）。不接真实文件树/标签页/
  收藏/空间切换/omnibox 的任何逻辑——纯门面。
- AI 条：当前 main 的 ui-demo 已无 AI 条 → 本次不做（用户确认看不到）。
- 不动 iframe 里**用户文档的内容/样式**（保真红线）：编辑区 chrome 只包在 iframe 外围，不向文档注入样式。
- 不动编辑内核（画布选择/拖拽/缩放/nudge/序列化/undo）——本次纯 chrome/视觉。

**明确非目标**
- 不把 ui-demo 的 React 分块编辑器内核搬进来（我们的内核是 iframe + 画布，已 e2e 验证）。
- 不实现侧栏的拖拽收藏、空间切换、folder 折叠等真交互。

## 关键决策

1. **布局重构**：`body` 从「列（顶栏/工具栏/home/iframe）」改成「行：`#sidebar`（左 274px）+ `#main`（右，
   编辑区）」。横向 `#topbar` 删除。浮动 `#toolbar`（Notion 气泡）保持 `position:fixed`、显隐/定位控制器不变
   （`frame.getBoundingClientRect()` 在新布局下照样给出正确视口坐标）。

2. **侧栏 = 纯 CSS 门面 + lockout**：用静态 HTML 复刻 `arc-sidebar` 的 DOM + 类名，照搬 `ArcSidebar.css`
   （直接进 shell.css，类名沿用 `arc-*`）。填**写死的假数据**（omnibox 占位、收藏 2 条、标签页 2 条、
   ~/Wordspace 文档树几个文件、底部 util 图标 + 头像、空间名 "Tenth Global ▾"）让它像 ui-demo。整片盖一个
   透明 lockout 层：`cursor:not-allowed`、吞所有 pointer 事件、hover 显「开发中」徽标/提示。

3. **真功能键 → 右上角浮动 actions**：编辑区右上角一簇（`top-actions` 风格）：`打开`/`预览`/`历史` 用 ghost
   钮、`保存` 用蓝色主钮（`top-share` 风格）；`+ 插入` 也放这里（或保留浮动工具栏入口）。文件名 + 脏标显示在
   **文档头部面包屑**（`本地 / filename.html ●`）。沿用现有 shell.js 的 onclick 处理器，只换 DOM/类名/位置。

4. **编辑区 chrome 包 iframe**：`#main` 内 = `.ws-canvas`>`.ws-canvas-scroll`>[文档头 strip + `#doc-frame`]。
   文档头 strip 用 `ws-breadcrumb`/`ws-doc-meta` 样式显示文件信息。iframe **铺满** canvas 滚动区（不强行套
   820px——用户文档自带宽度，强压会破版）；canvas 提供白底 + 居中留白的「纸面感」。空文档态显示一个
   `ws-empty` 占位（"从右上角打开一个 HTML 文档"）。

5. **macOS 标题栏**：先**保留系统标题栏**、侧栏顶部 `arc-top` 里的红绿灯做成**装饰**（或省略）——避免改
   window-config 引入 frameless 拖拽区的复杂度。若后续要 100% 还原（自绘标题栏 + hiddenInset），单列一个
   后续 unit。本次默认装饰红绿灯（不可点、属 lockout 区）。

6. **顺带修对抗 review 的真问题**（shell.js/css 本就要大动）：浮层横向 clamp、预览态气泡复活守卫
   （repositionToolbar 加 `canvas.getState().enabled` 判断）、横向 cull、翻下方纵向上界 clamp。

## Requirements trace

| # | 需求（用户原话） | 落到 unit |
|---|---|---|
| R1 | 去 main 看 ui-demo 现状，以它为准 | 已做（同步 origin/main）；U0 |
| R2 | 照抄左侧文件管理栏样式，只样式不功能 | U3 |
| R3 | 鼠标放侧栏区域 → 禁止操作 + 提示「开发中」 | U4 |
| R4 | 右侧编辑区样式直接照抄 | U5 |
| R5 | 顶上按钮按 ui-demo 改（现在太丑） | U2 + U6 |
| R6 | 整体更现代、像 ui-demo | U1–U6 合力 |

## 实现单元

### U0：ui-demo 同步到 origin/main（已完成）
- **状态**：已 `git checkout origin/main -- ui-demo/`，工作树 + 本分支 ui-demo == 当前 main。
- **遗留**：本分支（feat/heyhtml-canvas-editor）整体仍落后 origin/main（CI skip、ui-demo 等）。**收尾合 PR 前需
  把 origin/main merge 进来**，否则 #38 合并会回退 main 的 ui-demo。列入风险，非本次阻塞。

### U1：tokens + global reset 全量对齐 ui-demo
- **文件**：`src/renderer/shell.css`（顶部 :root 段）
- **做**：把 ui-demo `tokens.css` 全量 token（含 `--c-bg-sunken/-rail/-chrome`、`--list-w:268`、`--rail-w`、
  `--maxdoc-w:820`、`--h-titlebar:40`、`--fs-*`、`--fw-*`、`--lh-*`、`--shadow-*`、`--ease`）补齐；body 背景改
  `--c-bg-chrome`；加 ui-demo `global.css` 的细滚动条（`::-webkit-scrollbar`）、`::selection`、`ws-truncate`/
  `ws-muted` helper。现有 shell.css 已有子集，扩成全量、值与 ui-demo 一字不差。
- **Patterns**：照抄 `ui-demo/src/styles/tokens.css` + `global.css`。
- **验证**：app 整体配色/字号/滚动条肉眼与 ui-demo 一致；无 token 缺失（grep 用到的 var 都已定义）。

### U2：app shell 布局重构（去横顶栏，行布局）
- **文件**：`src/renderer/index.html`、`src/renderer/shell.css`、`src/renderer/shell.js`
- **做**：`body` 改 `flex-direction: row`；删 `#topbar` 整块；新增 `<aside id="sidebar">`（左）+
  `<section id="main">`（右）。`#main` 列布局承载编辑区 + 右上角 actions。浮动 `#toolbar` 留在 body 末尾
  （fixed，不受布局影响）。`#home`/recents 逻辑：要么并入 `#main` 空态，要么删（U5 决定）。shell.js 里
  `topbarEl`/`insertSlot` 等引用相应调整（insert 触发钮移到 U6 的 actions 区）。
- **Patterns**：`ui-demo/src/App.css`（`.ws-app`/`.ws-body`/`.ws-main`）。
- **验证**：窗口 = 左栏 + 右编辑区两栏；无横顶栏；app 能开文档、浮动工具栏照常浮出（e2e 现有用例仍绿）。

### U3：左侧侧栏门面（HTML + CSS 复刻 arc-sidebar）
- **文件**：`src/renderer/index.html`（`#sidebar` 静态结构）、`src/renderer/shell.css`（`arc-*` 全量样式）
- **做**：静态复刻 `arc-sidebar` DOM：`arc-top`（红绿灯装饰 + 导航图标）、`arc-omni`（搜索框占位 + 本地 tag）、
  `arc-space-bar`（"Tenth Global ▾"）、`arc-scroll`（收藏 2 条 + 标签页 2 条 + 文档树 ~/Wordspace 数个文件）、
  `arc-foot`（模板/Agent/设置 图标 + 头像）。CSS 直接搬 `ArcSidebar.css`（类名沿用）。图标：内联 lucide SVG
  （沿用 toolbar.js 的 svg 注入法，父层 chrome 安全）。假数据写死在 HTML。
- **Patterns**：`ui-demo/src/components/ArcSidebar.tsx`（结构）+ `ArcSidebar.css`（样式，逐条照搬）。
- **验证**：侧栏肉眼与 ui-demo 截图一致（宽度 274、收藏/标签页/文档树/底部布局、配色、hover 态）。

### U4：侧栏「开发中」lockout
- **文件**：`src/renderer/index.html`、`src/renderer/shell.css`、（可选 shell.js）
- **做**：`#sidebar` 上盖一层 `.sidebar-lock`（绝对定位铺满、`cursor:not-allowed`、`pointer-events:auto` 吞点击）。
  hover 时显「开发中」徽标（CSS `:hover` 显示一个居中 pill，或一条顶部提示条）。保证侧栏所有交互都被吞掉
  （不触发任何逻辑——本来也没接逻辑，lock 层是双保险 + 明确的 affordance）。
- **验证**：鼠标移到侧栏任意处 → 出现「开发中」提示、光标 not-allowed、点击无任何反应（不报错、不导航）。

### U5：右侧编辑区 chrome（包 iframe）
- **文件**：`src/renderer/index.html`、`src/renderer/shell.css`、`src/renderer/shell.js`
- **做**：`#main` 内构造 `.ws-canvas`>`.ws-canvas-scroll`>[`.ws-doc-header`(面包屑 `本地 / <filename> ●` +
  meta 行) + `#doc-frame`(铺满)]。空文档态 `.ws-empty` 占位。文件名/脏标更新点从旧 `#doc-name`/`#dirty-dot`
  迁到文档头。CSS 照搬 `ws-canvas`/`ws-canvas-scroll`/`ws-doc-header`/`ws-breadcrumb`/`ws-doc-meta`/`ws-muted`/
  `ws-empty`。注意：iframe 自带用户文档，不套 `.ws-doc` 的 820px（避免破版）；canvas 给白底。
- **Patterns**：`ui-demo/src/components/Canvas.css`（chrome 段）+ `Canvas.tsx`（DocHeader 结构）。
- **验证**：编辑区白底 + 顶部面包屑/元信息条像 ui-demo；打开文档后 iframe 正常显示用户 HTML；保真 e2e 仍绿
  （序列化结果不含任何 chrome 痕迹）。

### U6：右上角浮动 actions（真功能键搬家 + 重绘）
- **文件**：`src/renderer/index.html`、`src/renderer/shell.css`、`src/renderer/shell.js`
- **做**：`.ws-main-doc` 右上角浮 `.top-actions` 簇：`预览`/`历史`/`打开` ghost 钮 + `+ 插入`（WS2Insert 触发钮挂
  这里）+ `保存` 蓝色主钮（`top-share` 风格，仅脏时高亮/可用）。沿用 shell.js 现有 `pickAndOpen`/`save`/
  `showHistory`/`toggleMode` 处理器，仅换 DOM 容器/类名/位置。`#mode-btn`/`#save-btn`/`#history-btn` 等 id 保留
  （e2e 选择器稳定）。`#insert-slot` 移到此簇。
- **Patterns**：`ui-demo/src/components/TopActions.css`（`.top-actions`/`.top-share`）。
- **验证**：右上角一簇按钮，蓝色保存主钮；打开/保存/历史/预览/插入功能照常（e2e 点这些仍绿）。

### U7：浮动工具栏 review 真问题修复
- **文件**：`src/renderer/shell.js`、`src/editor/toolbar.js`
- **做**：
  1. **预览态气泡复活守卫**：`repositionToolbar` 开头加 `if (canvas && !canvas.getState().enabled) { hideToolbar(); return; }`（预览态任何 scroll/resize 都不再弹气泡）。
  2. **浮层横向 clamp**：toolbar.js `holder` 打开后，量 `pop.offsetWidth`，若 `holder.left + popWidth > innerWidth-8` 则 `pop.style.left = 负偏移` 拉回视口（关时清）。
  3. **横向 cull**：shell.js cull 判据补 `|| rect.right < 0 || rect.left > frame.clientWidth`。
  4. **翻下方纵向上界 clamp**：翻下后 `top = Math.max(minTop, Math.min(top, innerHeight - th - 8))`。
- **验证**：贴右缘选区点「链接/更多」弹层不被裁、按钮可点；预览态 resize 不弹气泡；横向滚出元素气泡隐藏。

### U8：e2e + 单测更新 / 加固
- **文件**：`e2e/app.spec.js`、（按需）`e2e/` 新 spec
- **做**：
  - 适配新 chrome：选择器 `#open-btn`/`#save-btn`/`#mode-btn`/`#history-btn`/`#toolbar` 保持可用；首页态断言改为
    编辑区空态（不再是 `#home h1`）。
  - **加固门（来自 review 覆盖缺口）**：① 颜色弹层 closePops 后 `#p1` dblclick 仍能进编辑（弹层不吃点击回归门）；
    ② 选元素→气泡可见→点 `#mode-btn` 进预览→断言 `#toolbar` hidden→`page.setViewportSize` 触发 resize→仍
    hidden（气泡复活回归门）；③ 侧栏 lockout：hover/点击侧栏不触发任何导航、`#toolbar` 不受影响。
  - 侧栏门面无逻辑，无需单测；纯 CSS。
- **验证**：本地 host `npm run test:e2e` 全绿；`npm test` 单测全绿；推 CI e2e 真门绿。

## Test 场景（U8 详列）
- **打开/保存/历史/预览** 经右上角新 actions 正常（迁移现有用例的选择器位置）。
- **浮动工具栏** 文字态/元素态浮出、加粗/转标题/链接/复制 仍生效（沿用现有断言）。
- **保真**：未改时序列化 == 原文档；改后存盘不含 `arc-*`/`ws-canvas`/`top-actions`/`data-ws2`/`tb-*`。
- **侧栏 lockout**：点击侧栏各处无副作用、无报错。
- **回归门**：弹层不吃点击、预览态气泡不复活（见 U8）。
- **CSP**：收紧 CSP 下 app 起来无违规（现有 fidelity spec 仍绿）。

## 风险 / 依赖
- **R-本分支落后 main**：feat/heyhtml-canvas-editor 落后 origin/main（ui-demo + CI skip + 其它）。合 #38 前必须
  merge origin/main，否则回退 main 的 ui-demo。建议本次实现前先 merge origin/main 进本分支（顺带拿到当前 ui-demo
  + CI 对 ui-demo-only 改动跳 Electron 测试的配置）。**这是首要依赖**。
- **真实窗口标题栏**：保留系统标题栏 → 侧栏红绿灯是装饰；若要 frameless 全还原另开 unit（动 window-config）。
- **iframe 宽度**：用户文档自带宽度，canvas 不强压 820px；个别窄文档视觉留白可能偏大——可接受，后续可加居中卡片。
- **lucide 图标量**：侧栏 + actions 需若干 SVG，内联进 shell.js/html；沿用 toolbar.js 的 svg 注入法。

## Deferred 到实现时
- 文档头面包屑要不要显示真实「空间/文件夹」（侧栏是假的）→ 先显示 `本地 / <filename>` 固定前缀。
- 空文档态文案 + 是否保留 recents 列表（可挪进侧栏「文档」假树，或编辑区空态给「打开」按钮）。
- 红绿灯装饰 vs 省略（取决于系统标题栏视觉是否突兀）。
