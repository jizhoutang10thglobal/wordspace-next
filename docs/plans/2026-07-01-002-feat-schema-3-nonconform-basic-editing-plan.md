---
title: "Feature 3 — 非合规 HTML 的基础编辑（真 app：校验器接入 + 分流 + 降级基础编辑器 + 保真回写）"
type: feat
status: active
date: 2026-07-01
origin: ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md
revised: 2026-07-01（按 5-persona adversarial doc-review：1 blocker + 11 high 全收）
---

# Feature 3：非合规 HTML 的基础编辑（真 app 落地）

## 问题框架

Schema 三 feature 的最后一块。前两块已就位（`feat/schema-1`）：**校验器**（`src/lib/schema-validate.js`，判任意 HTML 合不合规）+ **合规文档的完整块编辑器**（`src/editor/blockedit.js`）。缺的是把校验器**接进 app**、并给**不合规文件**一条降级路径——即用户要的两个能力：

1. 打开一个文件 → app **自动判**合不合规 → 合规走完整编辑、不合规走**基础编辑** + 顶部降级提示条。
2. 基础编辑 = 让用户**把能改的部分改好、且尽量不破坏原文件样式/排版/定位**，复杂结构操作锁掉。

**⚠ 基础编辑是「高频路径」不是边缘**（doc-review adversarial）：校验器 `validateBlock` 里「顶层块带 `style` 属性即判非合规」（`schema-validate.js` block-style），所以**连一个 `<h1 style="color:#333">` 的普通文档都会走基础编辑**，不是只有带 script/合并格的极端野文件。这放大了下面「保真」的重要性——它是日常路径。

**UX 权威 = ui-demo 已冻结的设计**（origin 需求文档 + `ui-demo/src/components/BasicEditor.tsx`，parallel session 的 React 原型，已合并 PR #82）。本 plan = 把那套 UX 照搬进真 app（vanilla JS/Electron）+ 补 ui-demo 没有的后端（真校验器接入 + 真读写保存）。

## 需求追溯（origin §3 冻结）

- **A 富就地文字编辑**：点文字就地 `contentEditable` 改；选中浮出格式条 = 粗/斜/下/删 + 文字色 + 高亮 + 清除。**不加**链接、行内代码。
- **B 删整块**：选中块只能删整块。**不做**拖拽重排、复制/复刻。
- **C 空间切块**：非文字编辑态，方向键 `↑↓←→` 按**渲染几何**（`nearestInDir`）在块间移焦点，**不按 DOM 顺序**。焦点块 `Delete`=删、`Enter`=进文字编辑。
- **只读**：图片等非文字元素、CSS 生成内容（`::before`）→ 🔒 感知，改不了。

## 关键决策

- **KD-a｜真 app 用真校验器（`schema-validate.js`），不移植 ui-demo 的 `schemaCheck.ts`**。renderer 里作 `<script>` 加载（已双导出 `global.WS2SchemaValidate`）；判定跑 **`DOMParser` reparse 磁盘原始字节**（§4.3 铁律③）。**原始字节现成**：`openDoc` 里已经在调 `await window.ws2.readDoc(p)`（`ipc.js` read-doc handler 返回 UTF-8 文本），只是丢了返回值——U1 接住它喂 `DOMParser`，**不新增 IPC**。
- **KD-b｜编辑器 chrome 全走宿主浮层，绝不注进 iframe DOM**（照 ui-demo）。格式条/焦点框/悬停删除/🔒 都是 `#main` 层绝对定位浮层。iframe 仍 `sandbox`（不跑文档 JS）。**注意**：contentEditable 与 cursor 是编辑态、属于「注进 iframe 的东西」，必须走 KD-c 的剥除契约（不是 chrome，KD-b 防不到它）。
- **KD-c｜保真 = 语义/结构等价，不是逐字节**（doc-review blocker 修正）：野生 HTML 一旦 `frame.src=file://` 被 Chromium parse 进 live DOM，再 `outerHTML` 序列化必然规范化（大写标签→小写、无引号属性→加引号、`<br/>`→`<br>`、补全省略的闭合、实体归一）——**零编辑往返即变字节**。所以：
  - 验收判据 = **未触及元素的结构与属性集合保留**（reparse 后比对未编辑节点的 normalized outerHTML / 目标 style·定位属性键值集合），**不测磁盘字节 diff**。
  - 承认「首次保存引入一次浏览器规范化的稳定重排」，改测 **二次保存幂等**（save→reparse→save 结果稳定）。
  - **非合规保存绝不走 block 编辑器的 `cleanRoot`/Schema 规整**（那会改坏它）。
- **KD-d｜基础编辑的编辑态属性有显式剥除契约**（照 `serialize.js` cleanRoot 范式，doc-review 3 个 reviewer 同指）：序列化前克隆 documentElement，剥掉 body 的 `contenteditable`、本模块注入的 body `style`（更稳：**cursor 用注入构造样式表/adoptedStyleSheets，不写 `body.style`**，跟 block 编辑器 zoom 一样不进序列化）、以及浏览器可能注入的 `spellcheck` 等。剥除清单写成显式白名单，别留「若有」。
- **KD-e｜分流做成不碰控制流的纯函数 seam**（doc-review：降低跟 main 合并冲突）：`routeDoc(rawText) → conform:boolean`；`openDoc` 里只加一行 `routeDoc(raw) ? attachFull() : attachBasic()`；`attachBasic` 与 `wireEditor` 平级独立、不嵌进 `loadFromFile`。合并时冲突面从整个 openDoc 函数体缩到一行。
- **KD-f｜命名锚定**：vanilla 模块 `src/editor/basic-edit.js` 导出全局 `WS2BasicEdit`（对齐 `WS2BlockEdit`/`WS2Serialize`）；样式独立 `src/renderer/basic-edit.css`（不塞进 shell.css）；中文称「基础编辑器」。
- **KD-g｜上色/高亮用 CSSOM span，不用 execCommand foreColor**（对齐 block 编辑器 `blockedit.js` applyColor / `format.js` wrapInlineStyle）：`foreColor` 在 `styleWithCSS=false` 注入废弃的 `<font>`、`hiliteColor` 跨浏览器不一致，对野文件是额外脏化。粗/斜/下/删可继续用 execCommand（产 `<b>/<i>/<u>/<s>`），色/高亮复用 `wrapInlineStyle` 建 `<span style>`。
- **KD-h｜范围 = origin §3 的 A+B+C + 只读 + banner + 保存**。§6 非目标照搬（见 Scope Boundaries）。

## Implementation Units

### U1 — 校验器接入 renderer + 打开即判 + 分流 seam + 降级提示条（后端①②③）
**Goal**：`schema-validate.js` 进 renderer；`openDoc` 用现成 `readDoc` 返回的原始字节 `DOMParser` reparse 判合规；纯函数 seam 分流：conform → `WS2BlockEdit.attach`（现有完整编辑），非 conform → `WS2BasicEdit.attach` + 顶部降级提示条。
**Files**：
- 改 `src/renderer/index.html`：① `schema-model.js` 的 `<script>` 后加 `<script src="../lib/schema-validate.js"></script>`；② 加 `<script src="../editor/basic-edit.js"></script>`；③ 加 `<link rel="stylesheet" href="basic-edit.css">`；④ 在 `#doc-frame` **之前**（doc-header 与 iframe 之间）插 `<div id="ws-degrade-notice" class="ws-degrade-notice" hidden></div>`。
- 改 `src/renderer/shell.js`：`routeDoc(raw)` 纯函数 + `openDoc` 里接住已有的 `await window.ws2.readDoc(p)` 返回值判分流 + `attachBasic()`（与 `wireEditor` 平级）+ 切换降级提示条 `hidden`。**基础路径不挂 `undoMgr`**（Cmd+Z handler 已按 `blockEdit===null` guard，天然 no-op）。
- 改 `src/renderer/basic-edit.css`（新建）：`.ws-degrade-notice` 样式。
**Approach**：分流锚校验器 `conform` 单一 bit。降级提示条文案含可发现性提示，例：「此文件不符合 Wordspace Schema，仅支持基础编辑：点文字改字（选中出格式条）· 悬停块右上角 🗑 删除 · 按 **Esc** 后用方向键在块间移动、Delete 删除」。
**Verification**：打开合规文件 → 进完整块编辑、无降级条（现有行为不变）；打开非合规文件（带 script/h5/合并格/**或仅块级 style**）→ 出降级条 + 基础编辑器、不进块编辑器。

### U2 — 基础编辑器 A：富就地文字（vanilla 移植 + 宿主浮层格式条 + markDirty）
**Goal**：`WS2BasicEdit.attach(doc, host, { markDirty })` 里实现能力 A：iframe body 可编辑，选中文字 → 宿主浮层格式条（粗/斜/下/删 + 文字色 6 + 高亮 5 + 清除）。
**Files**：新建 `src/editor/basic-edit.js`（能力 A 部分）；`src/renderer/basic-edit.css`（移植 ui-demo `BasicEditor.css` 的 `.nce-*` + 复用 `.ws-fmtbar` 浮条样式——真 app 目前**没有**这些类，是**移植不是复用**）。
**Patterns to follow**：`BasicEditor.tsx`（refreshBubble/exec/调色板）；色/高亮照 `blockedit.js` applyColor + `format.js` wrapInlineStyle（KD-g，CSSOM span 非 foreColor）；粗/斜/下/删用 execCommand（`styleWithCSS` 传值与 blockedit 统一）。
**关键实现约束**：
- **cursor 不写 `body.style`**：用注入的构造样式表给编辑区 cursor（KD-d，不进序列化）。
- **markDirty 接线**（doc-review：否则保存按钮永远灰）：`attach` 内在 iframe document 挂 `input` → 调传入的 `markDirty`（与 `wireEditor` 对称）。
**Verification**：非合规文件里点一段文字能改；选中出格式条；粗/斜/下/删 + 上色/高亮/清除生效且只动选区；上色产 `<span style>` 非 `<font>`；**改一个字后保存按钮变可用（dirty=true）**。

### U3 — 基础编辑器 B+C：删整块 + 空间切块 + 只读 🔒 + 浮层重定位
**Goal**：能力 B（删整块：悬停右上角 🗑、Esc 块模式后 Delete）+ C（空间切块：Esc 后方向键 `nearestInDir` 按渲染几何、Enter 进文字编辑）+ 只读 🔒 感知 + resize/zoom 浮层重定位。
**Files**：续写 `src/editor/basic-edit.js`（collectBlocks/nearestInDir/两模式/焦点框/悬停删除/🔒/`reposition()`）；`basic-edit.css`（焦点框、悬停删除、🔒 样式）。
**Patterns to follow**：`BasicEditor.tsx` 的 `collectBlocks`/`nearestInDir`/`toBlock`/`caretTo`/`removeBlock`/`onKeyDown`（去 React state、改宿主 DOM 浮层）。
**关键实现约束（doc-review 补）**：
- **🔒 只读感知**（ui-demo 自己也没做全，本轮补）：对 collectBlocks 跳过的只读元素（img/hr/svg/CSS 生成字），悬停时宿主浮层出 🔒 图标代替 🗑；这些元素不可 Enter 进入编辑。
- **collectBlocks 破坏性误判兜底**：野文件「整篇文字挂单个大 div」会让「一个块=整个 body」→ 删块=删全文。加护栏：块面积占 body 视口超阈值（如 ~整篇）时，删除前焦点框视觉标清范围（origin 没禁删块加视觉确认）。
- **`reposition()`**：暴露方法重算 focus/hover/bubble 的 toHost 坐标；shell.js 在 `window resize` 和 `setZoom()` 里 `if (basicEdit) basicEdit.reposition()`（与 blockEdit 对称）。
**Verification**：Esc 后方向键按视觉方向走（左右分栏 `←→` 对、绝对定位块按屏幕位置可达、不从顶跳底）；焦点块 Delete 删、Enter 进编辑；悬停块 🗑 可删；**图片悬停出 🔒 而非 🗑、不可 Enter 进编辑**；**「整篇一个大 div」不会一删删全文（有视觉范围提示）**；缩放后浮层不漂移。

### U4 — 非合规保存：结构保真回写 + 编辑态属性剥除契约（后端）
**Goal**：基础编辑保存**不走** block 编辑器 `serializeDocument`。`WS2BasicEdit.serialize(doc)`：克隆 documentElement → **剥除契约**（KD-d：删 body `contenteditable`、本模块注入的 body `style`/cursor、`spellcheck` 等浏览器注入属性）→ 保原 doctype → `outerHTML` 回写 `docPath`。
**Files**：改 `src/renderer/shell.js`（`save()` 按当前模式分流：block 模式走现有 serialize；basic 模式走 `WS2BasicEdit.serialize`）；`src/editor/basic-edit.js`（导出 `serialize` + 剥除清单）。
**Approach**：因 chrome 全在宿主浮层、编辑态属性走剥除契约剥掉，序列化结果 = 干净的编辑后文档（接受首次的浏览器规范化，KD-c）。doctype 透传照 `buildWordspacePrintHtml`。
**Verification**：改字 + 删块后保存 → 磁盘里那段字/那块变了；**未触及元素的结构与属性集合保留**（reparse 比对，非字节 diff）；**打开→零编辑保存 → body 不含 contenteditable/spellcheck、body 属性与原文一致**；**二次保存幂等**（save→reparse→save 稳定）。

### U5 — e2e 真门（宿主 Electron，强断言，结构级保真）
**Goal**：真启动 app 的 e2e，覆盖分流 + 三能力 + 结构保真 + 剥除契约。断言锚在真实 fs（reparse 后**结构/属性**比对，**不做字节 diff**）+ 真实渲染几何。
**Files**：新建 `e2e/nonconform-basic-edit.spec.js`。
**Test scenarios**：
- **分流**：打开合规 seed → 完整块编辑、无降级条；非合规 seed（① 含 `<script>`/`h5`/合并格的野文件 ② **仅块级带 `style` 的温和文档**——验高频路径）→ 出降级条 + 基础编辑器。
- **A**：改一段文字 + 加粗 → 保存 → reparse 后该段含 `<b>`/文字变化；上色断言查 `span[style]` 非 `<font>`。
- **B**：删一个块 → 保存 → reparse 后该块消失、未触及块的 outerHTML(normalized) 不变。
- **C**：Esc 后 `ArrowRight` 在左右分栏间移焦点（断言焦点框 rect 落到视觉右侧那块）；绝对定位块可达。
- **剥除契约**：打开一个 body 无 style/无 contenteditable 的非合规文件 → **零编辑保存 → reparse 后 body 仍无 contenteditable/style/spellcheck**（编辑态没漏进磁盘）。
- **保真**：带内联 `style`/绝对定位的非合规文件，改一处字保存 → 未触及元素的目标 style/定位属性键值集合保留；**二次保存幂等**。
- **只读**：图片元素悬停出 🔒、不可进入编辑。
- **破坏性兜底**：「整篇挂单个大 div」seed → 焦点/删除不会一下作用到整个 body（有视觉范围提示）。
**Verification**：`xvfb-run … npx playwright test e2e/nonconform-basic-edit.spec.js`（CI）+ 宿主真跑绿。

## 顺序 / 依赖
```
U1（校验器接入 + 分流 seam + banner）
   └─► U2（基础编辑 A 富文字 + markDirty）  ← U1 把非合规文件挂到 WS2BasicEdit
          └─► U3（B+C 删块 + 空间切块 + 🔒 + reposition）  ← 同模块续写
                 └─► U4（结构保真保存 + 剥除契约）  ← 需要 U2/U3 编辑结果
                        └─► U5（e2e 真门）  ← 需要全链路
```
每单元绿了 commit（注 U 号）。分支 `feat/schema-1`（校验器 + 完整编辑器都在这），或短命 `feat/schema-3` 分叉自它。

## 风险 & 依赖
- **保真是红线，但判据是结构级不是字节级**（KD-c）：非合规保存绝不按 Schema 规整；验收测「未触及元素结构/属性保留 + 二次保存幂等」，不测磁盘字节 diff（后者物理不可达，doc-review blocker）。
- **feat/schema-1 落后 main 两版**（分叉自 v0.4.3）：`openDoc`/`save` 是老版；main 的 v0.4.5 版 `openDoc` 已被 tabs+cold-start 竞态修复重写。**用 KD-e 的纯函数 seam 把分流缩到一行**降低合并冲突；合并时仍要保住我的 doc-tabs/cold-start/tooltip/PDF.js（[[doc-tabs-feature]]、[[render-export-model]]）。合并是独立协调点。
- **collectBlocks 启发式**在野文件上会误判（大 div=整块、深层纯包裹容器聚焦不到）——origin §3C「不追求完美、别乱跳」，但「删一块=删全文」是破坏性，U3 加视觉范围兜底 + U5 对抗 seed。
- **空间导航手感**：`nearestInDir` 的 `cross*2` 权重真实文档上可能微调（origin §9）——先照搬，e2e 只验「方向对、不乱跳」不验像素完美。
- **依赖**：`schema-validate.js`/`schema-model.js`（已在 feat/schema-1）、renderer `DOMParser`/`execCommand`/`window.ws2.readDoc`（现成）。无新外部依赖、无新 IPC。

## Scope Boundaries（非目标，照 origin §6）
- ❌ 拖拽重排、复制/复刻块。
- ❌ 前端标块顺序序号。
- ❌ 按 DOM 顺序做方向键切换。
- ❌ 工具条加链接、行内代码。
- ❌ 把非合规文件「修」成合规/结构化（那是 block 编辑器的事）。
- ❌ 跑文档 JS、加载外链样式。
- ❌ 移植 ui-demo 的 `schemaCheck.ts`（用真校验器）。
- ❌ **逐字节保真**（物理不可达；改结构级，KD-c）。
- ❌ **基础编辑下的撤销/重做**：Cmd+Z 在基础模式静默 no-op（不挂 undoMgr、不报错）。

## Deferred to Implementation
- 「点字=编辑、方向键=切块」切换手势打磨（Esc 退出后焦点是否自动落块）——origin §9。
- 表格/嵌套的「块粒度」个别文档歧义——照 origin §3C。
- `nearestInDir` 侧向惩罚权重真实手感微调（origin §9）。
