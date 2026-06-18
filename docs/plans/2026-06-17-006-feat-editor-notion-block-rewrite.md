---
status: active
date: 2026-06-17
owner: Colin
origin: 用户指令（弃 heyhtml 自由画布内核，编辑器 UX 一比一照 ui-demo main 的 Notion 块式）
---

# 编辑器内核重做：heyhtml 自由画布 → ui-demo 式 Notion 块编辑

## 1. 背景 / 决策

**方向已定（取代之前的"只换皮"）：** App 的编辑器要从 heyhtml「元素可自由拖放/缩放/floating」的自由画布内核，
换成 ui-demo（origin/main，最新）那套 **Notion 式块编辑**：灵活度降低，但可控、所见即所得、统一。
原则：今后正式产品的前端 / UI / UX **以 ui-demo main 为权威源，一比一对齐**。

**权威源**：`ui-demo/`（origin/main，= worktree `wordspace-next-ui-demo`，= Vercel `wordspace-ui-demo.vercel.app/#/docs`）。
两条 ui-demo 分支（`feat/ui-demo-editor-notion-ux`、`feat/ui-demo-wendi`）均已并入 main，无更新的未合分支。
参考实现：`ui-demo/src/components/Canvas.tsx` / `Canvas.css` / `mock/store.ts` / `types.ts` /
`components/canvas/{SlashMenu,BlockActionMenu,FormatToolbar,DocMenu,AiSoonModal}.tsx`。

## 2. 核心架构决策（工程判断，已定）

1. **保留沙箱 iframe**。App 加载不可信的本地 HTML、且 renderer 有 `window.ws2.*` IPC 到主进程；
   ui-demo 直接 `innerHTML` 渲染是无后端 prototype 才安全。我们必须把文档内容继续关在
   `<iframe sandbox>` 里，块式 UI（手柄/菜单/气泡）做成 iframe 内 `data-ws2-ui` 覆盖层或父层 chrome。
2. **"DOM 即块列表"**（不引入并行 Block 数组）。块 = `<body>` 的顶层子元素（排除 `data-ws2-ui`）。
   - 好处：**复用** `serialize.js`（KTD4 保真：只剥白名单标记，不改用户属性）、`undo.js`、`format.js`、
     iframe 装载/存盘/IPC 接线、`text-edit.js`（按元素 contenteditable）。
   - turn-into = `format.retagElement`；reorder = 在父节点内移动顶层兄弟；insert = 造元素插入 flow。
   - 对照 ui-demo 的 store 语义实现：`addBlock(after)` / `setBlockType` / `reorderBlocks(from,to)` /
     `duplicateBlock` / `deleteBlock` / `updateBlockHtml`（我们这边直接操作 DOM，等价语义）。
3. **样式按 ui-demo token + Canvas.css 1:1**。`.ws-block` 包裹/标记顶层元素只为定位手柄；
   选中/编辑/手柄/菜单/气泡的视觉全部照搬 `ui-demo/src/components/Canvas.css`。
4. **删除自由画布**：`dragmove.js`(绝对定位拖拽) / `resize.js` + `resize-geom.js`(8 手柄) /
   `alignguide.js`(对齐线) 不再接线；`insert.js` + 「+ 插入」面板移除；珊瑚/蓝包围框移除。

## 3. 待你拍板的唯一一个产品点（见 §7 问题）

打开一份**已有 HTML 文件**时，正文排版是否**强制套** ui-demo 的统一外观（Notion 式：字体/字号/间距统一 + 居中窄栏）？
- 影响：是否把 ui-demo 的 `.ws-*`/裸标签排版样式注入 iframe（覆盖文档自己的 CSS）、以及存盘是否写入这套样式。
- 其余交互/手柄/菜单/气泡/灰选中一律 1:1，与本问题无关。

## 4. 实现单元（DOM-即-块列表）

> 执行姿态：纯几何/解析逻辑（`block-ops`）test-first 走 node:test；交互/视觉单元靠真机截图验收（KTD：代理断言≠视觉验证）。

- **U1 — 块识别 + 顶层操作（`src/editor/blocks2.js` 新）**
  顶层元素 → 块类型推断（h1-3→heading、p→text、ul/ol→list、blockquote→quote、hr→divider、img→image、
  其余 div/section/table/自定义→`static`/designed）。纯函数：`classify(el)` / `isEditableType(t)` /
  `insertBlockAfter(refEl,type)` / `moveBlock(from,to)` / `turnInto(el,type,level)`（包 `format.retagElement`）/
  `duplicate(el)` / `removeBlock(el)`。可 node:test 单测（DOM 用 jsdom 或最小 stub）。
  Verification：单测覆盖分类 + 增删移转；保真往返（serialize 后无 `data-ws2-*` / 不改用户属性）。

- **U2 — 选中/编辑模型（改 `selection.js` + `text-edit.js` 接线，删旧包围框）**
  单击可编辑块 → 直接进文字编辑、光标落点击处（`caretRangeFromPoint`，回退块末）；
  单击不可编辑块 → 淡灰块选中（`.ws-block-selected`，`box-shadow 0 0 0 1.5px rgba(0,0,0,.18)` + `rgba(0,0,0,.025)` 底）；
  点空白取消；Esc 逐级退出（编辑→选中→无）。删掉珊瑚实/虚线框与 8 手柄。
  Verification：真机截图——无包围框、灰选中样子对、单击即编辑光标落点对。

- **U3 — 左侧 `⋮⋮` 手柄 + 拖拽重排（`src/editor/grip.js` 新，iframe 内 `data-ws2-ui` 覆盖层）**
  每个顶层块左侧 `left:-28px` 悬浮 `⋮⋮`（hover 显 / 灰选中常驻），按块类型微调 top（h1 18 / h2 30 / h3 24 / quote 14 / callout 30 / divider 22 / image 18 / 默认 10）；
  拖动 = 在兄弟间移动该顶层元素 + 2px accent 投放线；点击 = 打开块操作菜单。存盘时 `⋮⋮` 节点剥除。
  Verification：截图手柄位置/对齐；拖拽重排后 DOM 顺序对、存盘无残留。

- **U4 — 块操作菜单（`src/editor/blockmenu.js` 新，父层 chrome）**
  `⋮⋮` 点击弹：转为(正文/标题1-3/引用/提示) / 在下方插入(正文) / 复制 / 删除 / 文字色 swatches。
  样式照 `.ws-blockmenu*`。Verification：每项行为对（转换保留文字、复制插在其后、删除带兜底）。

- **U5 — 斜杠菜单（改 `slashmenu.js` 对齐 ui-demo 语义）**
  `/` 触发：正文/标题1-3/列表/引用/提示/分隔线/✦AI(开发中→占位弹窗)；筛选 + 上下/Enter/Esc/Backspace；
  选中：删掉已输入「/query」→ 空块**就地转换**、非空**在后插入**、divider/image **插入并选中**。
  Verification：截图菜单；空块转换 vs 非空插入路径都对。

- **U6 — Enter / Backspace / 方向键 块流编辑（改 shell.js keydown）**
  Enter 段末→新建正文块进编辑(块首)；list 内交原生(新 `<li>`)；中间交原生；IME/Shift 软换行守卫。
  Backspace 块首：空块删+光标落上一块末；非空并入上一块。↑↓ 跨块导航(首/末行)。
  对照 Canvas.tsx 第 517–636 行逐条移植。Verification：截图 + 行为脚本。

- **U7 — 格式气泡（restyle `toolbar.js` → ui-demo `.ws-fmtbar`）**
  浮在文字选区上方(编辑态) / 选中可编辑块上方(非编辑)；按钮：转为▾ / B I U S / 行内代码 / 文字色 / 高亮 / 链接 / ✦AI。
  命令走 `format.js`(execCommand + safeHref 白名单)；块选中态用 `execOnBlock`(临时 contenteditable+全选+命令+落库)。
  Verification：截图气泡 1:1；加粗/链接存盘留存（KTD2：颜色/高亮若 execCommand 产 inline style 被 CSP 丢，则改 CSSOM/class）。

- **U8 — 文档头 + 空态 + 顶栏（对齐 ui-demo，去「插入」）**
  顶栏去掉「+ 插入」，保留 打开/保存；文档头照 ui-demo 两行式（面包屑 + meta）；底部「本地 HTML 文件 · 路径」；
  空态保留"打开文档"版。820 居中栏 + 排版注入 **取决于 §7 拍板结果**。
  Verification：截图整体观感对照 ui-demo。

- **U9 — 收尾：删死代码 + 单测/真机门**
  移除 `dragmove/resize/resize-geom/alignguide/insert` 的接线与文件（或留文件断接线，按风险）；
  `index.html` 脚本清单更新；跑 `npm test`(node:test) 全绿 + 真机截图验收 + （视情况）e2e。

## 5. 复用 / 删除清单

复用：`serialize.js`、`undo.js`、`format.js`、`shell.js`(iframe 装载/保存/IPC/最近文件)、`text-edit.js`、
`slashmenu.js`、`toolbar.js`、`shell.css`(token)。
删除接线：`dragmove.js`、`resize.js`、`resize-geom.js`、`alignguide.js`、`insert.js`、`canvas.js`(自由画布控制器，按需)。

## 6. 保真 / 安全红线（不可破）

- KTD2：编辑器加的样式只走 CSSOM（`el.style` / 构造样式表），绝不 `setAttribute('style')` / 注入 `<style>`（iframe CSP `style-src` 会丢）。
- KTD4：`serialize.js` 只剥白名单标记（含本次新增的 `data-ws2-*` 手柄/选中类），不改用户属性、不前缀清洗。
- 安全：文档内容继续关在 `<iframe sandbox="allow-same-origin">`，不在 renderer 主世界 `innerHTML` 用户 HTML。

## 7. 待拍板问题（仅此一个，拍完即开干）

打开已有 HTML 文件时，正文排版是否强制套成 ui-demo 统一外观？（A 强制统一最像 ui-demo / B 保留文档自身样式）

## 8. 范围边界（本次不做）

- AI 真功能（仅占位弹窗）、协作光标（ui-demo 自己也没接）、发布/导出、左侧文件管理栏（沿用"先只做编辑区"）。
- 块的嵌套树（ui-demo 也是扁平）；表格/复杂结构走 designed/static 整块编辑，不做单元格级块化。

## 9. 验收

- `npm test`(node:test) 全绿（U1 纯逻辑）。
- 真机截图逐单元对照 ui-demo（KTD：必须真打开看，不靠 class 断言）。
- 关掉自由画布后回归：打开/编辑/存盘往返保真、撤销、CSP 不报错。

## 10. 实现期发现 / 已知限制（2026-06-18）

**对抗式审查确认 14 条问题，已全部修复（1 条 polish 死代码除外），并补单测/真机门兜底。** 关键修复：
转列表补 `<li>`（防裸 ul 写坏文件）、Backspace 按类型安全合并（防 `<li>` 进 `<p>` 等非法嵌套）、
`retagElement` 保留用户全部属性（保真）、空 callout 恒可编辑、跨块上下方向键、文末续写、撤销快照剥编辑器
标记（修「Cmd+Z 撤的是看不见的属性 toggle」）、「转为」菜单首次点不开、幽灵手柄。

**⚠ 已知限制（CSP 取色）：** 实测推翻旧 KTD2「CSSOM `el.style.x=` 不受 CSP 管」的假设——现代 Chromium
（Electron 42）里，**经 CSSOM 设的 style 属性同样受文档自身 `style-src` 约束**。后果：取色/高亮（`wrapInlineStyle`
产 inline 样式）在**文档自己声明了严格 `style-src`（无 `unsafe-inline`）时不生效**（颜色被该文档 CSP 拦 + 控制台告警）。
绝大多数本地 HTML 无此 CSP，取色正常。不改 class+注入样式表绕开：那样存盘后离开注入样式表颜色会丢，inline 才能随文件
持久化。e2e 取色门改测普通文档（回归保护）。**这是固有取舍，非崩溃；记此备后续若需支持严格-CSP 文档再议。**

**新增/重写的权威门：** `e2e/app.spec.js` 整套重写为块编辑器 e2e（旧画布选择器全废）；新增 `test/blockedit.test.js`
（classify/isEditableEl 纯逻辑单测，含空 callout 可编辑）；`test/format.test.js` 加 retagElement 属性保真断言。
`e2e/fidelity.spec.js` 不动（测文档加载/CSP/安全，与编辑器模型无关）。
