---
title: "Feature 3 — 非合规 HTML 的基础编辑（真 app：校验器接入 + 分流 + 降级基础编辑器 + 保真回写）"
type: feat
status: active
date: 2026-07-01
origin: ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md
---

# Feature 3：非合规 HTML 的基础编辑（真 app 落地）

## 问题框架

Schema 三 feature 的最后一块。前两块已就位（`feat/schema-1`）：**校验器**（`src/lib/schema-validate.js`，判任意 HTML 合不合规）+ **合规文档的完整块编辑器**（`src/editor/blockedit.js`）。缺的是把校验器**接进 app**、并给**不合规文件**一条降级路径——这正是用户要的两个能力：

1. 打开一个文件 → app **自动判**合不合规 → 合规走完整编辑、不合规走**基础编辑** + 顶部降级提示条。
2. 基础编辑 = 让用户**把能改的部分改好、且不破坏原文件的样式/排版/定位**（改错字、改颜色、删一段），复杂结构操作锁掉。

**UX 权威 = ui-demo 已冻结的设计**（origin 需求文档 + `ui-demo/src/components/BasicEditor.tsx`，parallel session 做的 React 原型，已合并 PR #82）。本 plan = **把那套 UX 照搬进真 app（vanilla JS/Electron），并补 ui-demo 没有的后端**（真校验器接入 + 真读写保存）。

## 需求追溯（origin）

三个能力（origin §3 冻结，其余明确不做）：
- **A 富就地文字编辑**：点文字就地 `contentEditable` 改；选中浮出格式条 = 粗/斜/下/删 + 文字色 + 高亮 + 清除格式。**不加**链接、行内代码。
- **B 删整块**：选中块只能删整块。**不做**拖拽重排、复制/复刻。
- **C 空间切块**：非文字编辑态，方向键 `↑↓←→` 按**渲染几何**（`getBoundingClientRect` 的 `nearestInDir`）在块间移焦点，**不按 DOM 顺序**（左右分栏/绝对定位才对得上）。焦点块 `Delete`=删、`Enter`=进文字编辑。
- **只读**：图片等非文字元素、CSS 生成内容（`::before`）→ 🔒，改不了。

## 关键决策

- **KD-a｜真 app 用真校验器（`schema-validate.js`），不移植 ui-demo 的 `schemaCheck.ts`**。后者是原型的简化判定；真相权威是确定性校验器。renderer 里 `schema-validate.js` 按 `schema-model.js` 同款方式作 `<script>` 加载（已双导出 `global.WS2SchemaValidate`），判定跑 **`DOMParser` reparse 磁盘原始字节**（§4.3 铁律③：判 reparse DOM，不判活的编辑 DOM；renderer 的 DOMParser = jsdom 的浏览器等价物）。
- **KD-b｜编辑器 chrome 全走宿主浮层，绝不注进 iframe DOM**（照 ui-demo）。格式条/焦点框/悬停删除都是 `#main` 层的绝对定位浮层，坐标由 iframe rect + 元素 rect 换算。iframe 仍 `sandbox`（不跑文档 JS）。保住「文件只被序列化、不被 chrome 污染」的保真红线。
- **KD-c｜非合规保存 = 最小 diff 回写，不走 block 编辑器的 `cleanRoot`**。block 编辑器的 serialize 会按 Schema 规整；非合规文件**不能规整**（那会改坏它）。基础编辑保存 = 直接把（被就地编辑过的）iframe document 序列化回 `.html`，其余字节尽量原样。这是 ui-demo 缺的后端（origin §9 明说 ui-demo 是 mock、真 app 要真读写）。
- **KD-d｜分流锚在校验器结果、不锚在别的**。`openDoc` 里 HTML 文件先判：`conform` → `WS2BlockEdit.attach`（现有完整编辑）；非 `conform` → 基础编辑器 + 降级 banner。新建文档走模板（已验证合规）→ 自然走完整编辑；对其也判一次（合规=no-op，便宜保险）。
- **KD-e｜范围 = 只做 origin §3 的 A+B+C + 只读 + banner + 保存**。§6 非目标照搬：不拖拽/不复制/不标序号/不按 DOM 顺序切/工具条不加链接与行内代码/不把非合规「修」成合规/不跑文档 JS。

## Implementation Units

### U1 — 校验器接入 renderer + 打开即判 + 分流 + 降级提示条（后端①②③）
**Goal**：`schema-validate.js` 进 renderer；`openDoc` 打开 HTML 时用 `DOMParser` reparse 原始字节判合规；`conform` 走现有 `WS2BlockEdit.attach`，非 conform 走基础编辑器 + 顶部一条降级提示（origin §7：不展开违规清单）。
**Files**：
- 改 `src/renderer/index.html`（`schema-model.js` 后加 `<script src="../lib/schema-validate.js">`）
- 改 `src/renderer/shell.js`（`openDoc`/`loadDoc` 加：取原始 HTML → `new DOMParser().parseFromString(raw,'text/html')` → `WS2SchemaValidate.validate` → 分流；非 conform 不 attach block 编辑器、改挂基础编辑器）
- 改 `src/main/ipc.js` / `preload.js`（若 renderer 拿不到原始字节，加一个「读原始 HTML 文本」的 IPC；能复用现有读取则不加）
- 改 `src/renderer/shell.css`（`.ws-degrade-notice` 降级提示条样式）
**Approach**：判定用**磁盘原始字节**（不是 iframe 已注入 chrome 的 live DOM）。分流是单一入口：`validate(reparsed).conform ? attachFull() : attachBasic()`。
**Execution note**：集成层，真门在 U5 e2e；单元本身以「判定函数正确 + 分流走对」为准。
**Verification**：打开合规文件 → 进完整块编辑（现有行为不变）；打开非合规文件（带 script/h5/合并格/块 style）→ 出降级 banner + 基础编辑器、不进块编辑器。

### U2 — 基础编辑器 A：富就地文字（vanilla 移植 + 宿主浮层格式条）
**Goal**：把 `BasicEditor.tsx` 的能力 A 移植成 vanilla JS 模块 `src/editor/basic-edit.js`（`WS2BasicEdit.attach(doc, host)`）：iframe body `contentEditable`，选中文字 → 宿主浮层格式条（粗/斜/下/删 + 文字色 6 + 高亮 5 + 清除），`execCommand` 实现。调色板复用编辑器同款。
**Files**：新建 `src/editor/basic-edit.js`；改 `src/renderer/index.html`（加载它）；`src/renderer/shell.css`（复用 `.ws-fmtbar` + `.nce-*` 浮层样式，照 ui-demo `BasicEditor.css`）。
**Patterns to follow**：`ui-demo/src/components/BasicEditor.tsx`（refreshBubble/exec/调色板）、真 app 现有 `src/editor/format.js`（execCommand + styleWithCSS=false 的既有做法）。
**Verification**：非合规文件里点一段文字能改；选中出格式条；粗/斜/下/删 + 上色/高亮/清除都生效且只动选区。

### U3 — 基础编辑器 B+C：删整块 + 空间切块（方向键 + 悬停🗑 + 焦点框）
**Goal**：移植能力 B（删整块：悬停右上角 🗑、或 Esc 进块模式后 Delete）+ C（空间切块：Esc 后方向键 `nearestInDir` 按渲染几何移焦点、Enter 进文字编辑）。`collectBlocks` + `nearestInDir` 照 ui-demo 逐行搬。块删除 keyed 到节点身份；导航用 `getBoundingClientRect`。
**Files**：续写 `src/editor/basic-edit.js`（collectBlocks/nearestInDir/两模式切换/焦点框/悬停删除浮层）；`shell.css` 焦点框 + 悬停删除样式。
**Patterns to follow**：`BasicEditor.tsx` 的 `collectBlocks`/`nearestInDir`/`toBlock`/`caretTo`/`removeBlock`/`onKeyDown`（几乎可直接搬，去掉 React state、改成宿主 DOM 浮层元素）。
**Verification**：Esc 后方向键在块间按视觉方向走（左右分栏 `←→` 对、绝对定位块按屏幕位置可达、不从顶跳底）；焦点块 Delete 删除、Enter 进文字编辑；悬停任意块 🗑 可删；图片/CSS 生成字只读（不进 blocks / 给 🔒）。

### U4 — 非合规保存：最小 diff 回写 `.html`（后端，ui-demo 缺的）
**Goal**：基础编辑的保存**不走** block 编辑器的 `serializeDocument`（那会按 Schema 规整、改坏非合规文件）。改为：把编辑后的 iframe document 序列化回 HTML（剥掉本模块注入的任何临时属性——若有），其余字节原样，写回 `docPath`。保存后重新判一次合规（改字/删块一般仍非合规、留在基础编辑）。
**Files**：改 `src/renderer/shell.js`（`save()` 按当前模式分流：block 模式走现有 serialize；basic 模式走新的 `WS2BasicEdit.serialize(doc)`）；`src/editor/basic-edit.js`（导出 `serialize`：`'<!doctype…>' + documentElement.outerHTML`，或保原 doctype）。
**Approach**：basic-edit 的 chrome 全在宿主浮层、没注进 iframe，所以 iframe document 本身就是「干净的编辑结果」，序列化直接可用。保 doctype（照 block 编辑器 `buildWordspacePrintHtml` 的 doctype 透传法）。
**Verification**：改字 + 删块后保存 → 磁盘文件里那段字/那块变了、**其余（样式/内联 style/定位/未触及的块）逐字节不变**；重开文件改动在。

### U5 — e2e 真门（宿主 Electron，强断言）
**Goal**：一道真启动 app 的 e2e，覆盖分流 + 三能力 + 保真保存。锚在真实 fs（读回磁盘字节比对）+ 真实渲染几何，不查 JS 直设的 class（CLAUDE.md S4）。
**Files**：新建 `e2e/nonconform-basic-edit.spec.js`。
**Test scenarios**：
- 打开合规 seed → 进完整块编辑（无降级 banner）；打开非合规 seed（含 `<script>`/`h5`/合并格/块 style）→ 出降级 banner + 基础编辑器。
- A：改一段文字 + 加粗 → 保存 → 磁盘该段变化、含 `<b>`/`<strong>`；其余字节不变。
- B：删一个块 → 保存 → 该块从磁盘消失、其余不变。
- C：Esc 后 `ArrowRight` 在左右分栏间移焦点（断言焦点框落到视觉右侧那块的 rect），绝对定位块可达。
- 保真：一个带内联 `style`/绝对定位的非合规文件，改一处字后保存，未触及的 `style`/定位属性逐字节保留。
**Verification**：`xvfb-run … npx playwright test e2e/nonconform-basic-edit.spec.js`（CI）+ 宿主真跑绿。

## 顺序 / 依赖
```
U1（校验器接入 + 分流 + banner）
   └─► U2（基础编辑 A 富文字）  ← 需要 U1 把非合规文件挂到基础编辑器
          └─► U3（基础编辑 B+C 删块 + 空间切块）  ← 与 U2 同一模块，续写
                 └─► U4（非合规保存回写）  ← 需要 U2/U3 的编辑结果
                        └─► U5（e2e 真门）  ← 需要全链路
```
每单元绿了 commit（注 U 号）。分支 = `feat/schema-1`（校验器 + 完整编辑器都在这，Feature 3 挂同一处），或短命 `feat/schema-3` 分叉自 feat/schema-1。

## 风险 & 依赖
- **feat/schema-1 落后 main 两版**（memory：分叉自 v0.4.3）——真 app 的 `openDoc`/`save` 是 v0.4.3 版；本 plan 改这些。将来跟 main（v0.4.5 + ux-fixes）合并要保住我的 doc-tabs / cold-start / tooltip / PDF.js 等（[[doc-tabs-feature]]、[[render-export-model]]）。合并是独立协调点、不在本 plan。
- **保真是红线**：非合规保存**绝不**能按 Schema 规整。KD-c + U4 + U5 的逐字节比对是护栏。
- **空间导航手感**：`nearestInDir` 的 `cross*2` 权重在真实文档上可能要微调（origin §9 开放问题）——先照搬 ui-demo，e2e 只验「方向对、不乱跳」不验像素完美。
- **依赖**：`schema-validate.js`/`schema-model.js`（已在 feat/schema-1）、renderer `DOMParser`/`execCommand`（浏览器原生）。无新外部依赖。

## Scope Boundaries（非目标，照 origin §6）
- ❌ 拖拽重排、复制/复刻块。
- ❌ 前端标块顺序序号。
- ❌ 按 DOM 顺序做方向键切换。
- ❌ 工具条加链接、行内代码。
- ❌ 把非合规文件「修」成合规/结构化（那是 block 编辑器的事）。
- ❌ 跑文档 JS、加载外链样式。
- ❌ 移植 ui-demo 的 `schemaCheck.ts`（用真校验器）。

## Deferred to Implementation
- 「点字=编辑、方向键=切块」的切换手势打磨（Esc 退出后焦点是否自动落块）——origin §9，实现时手感调。
- 表格/嵌套的「块粒度」个别文档歧义——照 origin §3C「不追求完美、别乱跳」。
- renderer 取原始字节的方式（复用现有读取 vs 新加 IPC）——U1 执行时按现状定。
