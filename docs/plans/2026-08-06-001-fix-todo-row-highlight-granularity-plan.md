# fix: 列表编辑态高亮收到行级 + 两条粒度补齐（Wendi「第二行和上一行连成一起」）

- **来源**：Wendi 2026-08-05 反馈（Slack），原话「打开第一行 to do list，然后点击回车换行，第二行实质上
  已经是另一个 block 了，但是选中深色的其实还是和上一行连成一起的」。v0.12.2 修了 Esc 那半，Wendi 复测
  「这个 bug 还在」，Colin 复现确认。
- **拍板（Colin 2026-08-06）**：① 本轮按「修高亮」交付，**不动存储模型**；架构题（每行独立成块）
  带成本单单独回给 Wendi 拍（= U4）。② 同区域另两条粒度缺口一并修（U2 / U3）。
- **origin**：`docs/brainstorms/2026-07-23-todo-item-granularity-requirements.md`（status: needs-decision）。
  本 plan 承接它的方案 B（存储单元与交互单元解耦），并**补齐它没覆盖的最后一处漏**。
- **诊断**：ce-debug 全程实测，探针见「验证」节。

---

## 问题

`<li>` 在本编辑器的块模型里从来不是块——`blockOf` 只爬到 `blockRoot` 的直接子为止，`<ul>` 才是块。
于是点进任何一行，`enterEdit` 拿到的都是整个 `<ul>`，把 `data-ws2-editing` 挂在它身上；而
`[data-ws2-editing]{background:rgba(0,0,0,.015)}` 画的是这个元素的**整个盒子**。回车建的新行进的是
同一个 `<ul>`（Enter 在非空项上交给原生 `insertParagraph`，不新建 ul），所以编辑第二行时，第一行也在
那层底色里 —— 这就是用户看到的「连成一起」。

**实测（三行 todo，光标在第 2 行）**：承载高亮的元素 = `UL`，高 **93.6px**；单行高 28px；**罩住 3.3 行**。
同文档对照，点进一个段落：高亮元素 = `P`，高 **28px**，不多不少就是它自己。
**列表是唯一一个「高亮范围 ≠ 正在编辑的东西」的块类型。**

### 为什么 v0.12.2 修了还在

v0.12.2 修的是 **Esc 那条路径**（`data-ws2-selected` 从 `<ul>` 下沉到 `<li>`），配了几何门
`e2e/grip-scope-consistency.spec.js` E-1。那道门的操作序列与 Wendi 的复现**逐字相同**——点第一行 →
End → 回车 → 打字 → Esc → 量框高。**Bug 出现在按 Esc 的前一个键**，而门直到按完 Esc 才开始看。

全仓 e2e 里 `data-ws2-editing` 只被查过「在不在 / 是什么标签」，**从没有一条断言过它罩多高**
（`toggle-align` / `plus-picker` / `block-indent` / `blockedit-scroll-jump` / `toggle` 各处均为存在性断言）。
这是本 plan 要补的核心覆盖缺口，也是 U1 几何门的立论。

### 为什么本轮不改存储模型

Wendi 报的是**症状**，开的药方（「这两行应该没有任何关联」）是**架构**。研究后确认改架构要付三笔
现在没有的成本，且磁盘格式对她不可见——交互层补完最后这一处后，她能观察到的行为已 100% 对齐 Notion
（手柄 / 拖拽 / 块菜单 /「+」/ Esc 分级 / ⌘A 分级 / 行首退格剥离都已是行级）。三笔成本的完整证据进 U4 的
提案文档，交 Wendi 拍板。摘要：

| 阻碍 | 证据 |
|---|---|
| **编号连续性无兜底** | BASELINE_CSS 里 `ol` 不写 `list-style-type`、全仓零 `counter-reset`。拆成 N 张相邻 `<ol>` 每张从 1 重数；救它要每行写 `start=N` 且插入/删除/拖拽后全列重编号——仓里无此机制，且 `docs/features/todo-list.md` 已把「按拆分位置重算 start」记为「复杂度不匹配收益，留作后续」 |
| **嵌套要重开已拍板的 Schema 铁律** | `ws-indent-*` 作用域硬编码在 Tab 分支的 `text/heading/quote/.ws-callout`；`docs/schema-1-draft-v0.md` §1.3 例外的拍板原文明写「**列表/toggle 的层级仍只用 DOM 嵌套**」（Colin 2026-07-24） |
| **markdown 往返** | `src/main/md-adapter.js` 的 `REPRESENTABLE` 白名单里 `ul`/`li` **零允许属性** → 行的 ul 带 class（表嵌套）或 li 带 id（doc-linking 锚点）即整表岛化，`test/md-adapter.test.js` 既有断言当场红。另：相邻单项列表在 md 里靠 marker 交替（`- / * / -`）才不合并，实测是不动点，但**外部编辑器统一 marker 后会在 md 层合并**，回 app 即 N 行塌成一张 ul——单向、静默的结构塌缩 |

**一条对 Q4 有用的新事实**：单看 to-do，md 往返是干净的——`rehypeFromWsTodo` 会主动删掉 `ws-todo` class，
实测两张单项 todo ul 往返为不动点。brainstorm 悬了两周的 Q4（只给 to-do 特殊待遇？）因此有了技术侧答案。

---

## 需求

- **R1** 编辑列表某一行时，编辑态高亮只罩那一行，不罩兄弟行。（Wendi 反馈正身）
- **R2** 段落 / 标题 / 引用 / callout 等既有块的编辑态高亮行为**一字不变**。
- **R3** 行选中与整表选中两档的高亮左缘一致，勾选框不在框外。
- **R4** 跨块选区覆盖到列表的部分行时，那些行有与其他块同款的块级高亮。
- **R5** 所有新增交互标记零入盘（reparse 后 conform，磁盘字节无 `data-ws2-*`）。
- **R6** 架构题（每行独立成块）以带证据的提案交 Wendi/Colin 拍板，不在本轮实现。

---

## 关键技术决策

**KTD1 — 编辑态高亮跟随「交互单元」，用新标记 `data-ws2-editrow` 承载。**
CSS 选不中「含光标的那个 li」，所以必须落一个属性。沿用仓内既有范式：`menuRow`（块菜单作用行）、
`rowSelEl()`（段选中真相源）都是同一形状的行级标记。`[data-ws2-editing]` 的底色改为
不作用于 `ul`/`ol`，由 `[data-ws2-editrow]` 接手列表那一档。

**KTD2 — 清理一律按属性扫 DOM，不靠引用数组。**
这是 2026-08-06 team-memory 公告的硬教训（`retagElement` 原样复制全部属性 → 交互标记漏进产物，
引用指向已被摘走的旧元素 → 状态永久卡死，v0.12.2 实爆过一次清不掉的蓝底）。`data-ws2-editrow` 的
清理必须 `querySelectorAll('[data-ws2-editrow]')` 全扫，引用只当快路径；门要分两层（一层守「别造出来」，
一层守「造出来了也清得掉」），样板 `e2e/blockedit-turn-into.spec.js` MT-7 / MT-8。

**KTD3 — 本轮只下沉列表，不动多段容器（callout / quote）。**
容器有可见边框，编辑框内某段时整框着色读作「你在这个框里」，是合理的；列表没有边框，整表着色读作
「这些行是一个东西」，正是 bug。两者语义不同，不一并改。容器侧若将来要行级化，另记 spec 欠账。

**KTD4 — 行级 `rangesel` 必须自带收窄的光晕。**
诊断期量到：相邻 `<li>` 间距 4.8px（`:where(li){margin:.3em 0}` 折叠后），而
`[data-ws2-rangesel]` 的 box-shadow spread 是 4px，两行各自挂上后两侧光晕合计 8px > 4.8px，
会产生 3.2px 的双重叠加带（alpha .16 叠 .16 ≈ .29，比本体还深）→ 必然糊成一条。所以 U3 落
行级蓝底时**必须**配 `li` 特化、把 spread 收到小于行距的一半。
（同一测量顺带解释了 `[data-ws2-selected]` 的 6px 外晕会压进上一行 1.2px——视觉上不显著，
本轮不动，记 spec 欠账。）

**KTD5 — U2 保持文字位置不变。**
勾选框画在 `.ws-todo > li::before` 的 `left:-22px`，在 li 盒子**外面**；行选中框（li 盒）左缘 306.2px、
整表选中框（ul 盒）左缘 279px，差 27.2px。修法是把勾选框挪进 li 盒：给 `.ws-todo` 减少左内距、
给 `.ws-todo > li` 补等量左内距、`::before` 相应右移，**净文字位置不变**。这是入盘语义 CSS
（`data-ws-schema-css="todo"`），老文档打开时经 `refreshSemanticStyles` 自愈补注，所以必须配
「老文档打开后 CSS 已更新且文字不位移」的回归。

---

## 实现单元

### U1. 编辑态高亮下沉到行

**目标**：编辑列表某一行时，只有那一行有编辑态底色。（R1 / R2 / R5）

**依赖**：无

**文件**：
- `src/editor/blockedit.js`（`enterEdit` / `exitEdit` / `onSelectionChange` / 选中态 CSS 段）
- `src/editor/serialize.js`（`WS2_MARKERS` 追加 `data-ws2-editrow`）
- `e2e/todo-row-editing-highlight.spec.js`（新建）
- `docs/features/todo-list.md`（契约 + 已知局限）

**做法**：新增行级标记 `data-ws2-editrow`，在三处维护——`enterEdit` 落列表时按当前光标定初值、
`onSelectionChange` 里跟着光标换行、`exitEdit` 清除。取行用**最深 li**（与 `rowOf` 的既有规则一致，
`closest('li')` 在嵌套里会爬到宿主行）。CSS 把 `[data-ws2-editing]` 的底色排除 `ul`/`ol`，新增
`[data-ws2-editrow]` 承接。清理按属性全扫（KTD2）。

**参照**：`menuRow`（块菜单行作用域）的标记生命周期；`clearSelectedAttr` 的按属性清理范式。

**测试场景**（`e2e/todo-row-editing-highlight.spec.js`）：
- **几何正身**：三行列表点进第 2 行 → 承载编辑底色的元素高度 == 单行高 ±2，**不等于三行之和**。
  这条是本 plan 的核心门，口径照抄 `grip-scope-consistency.spec.js` E-1 的几何写法（不查 class）。
- **对照不回归**：同文档点进段落 → 底色元素高度 == 该段落自身高度（R2）。
- **跟随光标**：光标从第 1 行移到第 3 行 → 全文档任一时刻恰好一个 `[data-ws2-editrow]`，且是当前行。
- **嵌套取最深**：光标落在子项 → 标记在子项那个 li 上，不在宿主行。
- **退出清零**：Esc / 点到文档外 → `[data-ws2-editrow]` 计数为 0。
- **清得掉（KTD2 第二层）**：强行给一个陈旧 li 盖上该属性再触发选区变化 → 清理后计数为 0
  （只清引用数组的实现必然过不去）。
- **零入盘**：编辑后序列化 → 磁盘字节不含 `data-ws2-editrow`，reparse `conform === true`。

**变异自检**：摘掉行下沉（退回把底色画在 `ul` 上）→ 几何正身必须红、对照段落那条必须仍绿；还原后全绿。

**验收**：上述门全绿 + 变异画像定点；真机点进多行列表逐行走一遍，底色只跟着当前行。

---

### U2. 勾选框收进行选中框

**目标**：行选中与整表选中的高亮左缘一致，勾选框在框内。（R3）

**依赖**：无（与 U1 同文件不同段，可并行）

**文件**：
- `src/editor/blockedit.js`（`TODO_CSS` 入盘语义 CSS + 编辑器侧同款规则）
- `e2e/todo-row-editing-highlight.spec.js`（追加）或 `e2e/todo-checked-visual.spec.js`（就近追加）
- `docs/features/todo-list.md`

**做法**：按 KTD5，把勾选框的绘制位置从 li 盒外挪进盒内，`.ws-todo` 与 `.ws-todo > li` 的左内距
等量对冲以保持文字净位置不变。入盘 CSS 与编辑器 CSS 两处口径必须同步（既有 pair 机制）。

**参照**：`refreshSemanticStyles` 的 pairs 表与 `ensureTodoStyle` 的自愈补注路径。

**测试场景**：
- 行选中框左缘 == 整表选中框左缘（±1）。
- 勾选框的渲染矩形完整落在行选中框内。
- **文字不位移回归**：todo 行文字左缘绝对位置与改动前一致（与 `todo-checked-visual.spec.js` 现有基线对齐）。
- **老文档自愈**：打开一份带旧版 todo CSS 的文档 → style 块被更新为新口径，且文字不位移。
- 勾选/未勾选两态视觉不回归（`todo-checked-visual.spec.js` 既有断言保持绿）。

**变异自检**：撤掉左内距对冲 → 「左缘一致」与「文字不位移」中至少一条必须红。

**验收**：门全绿；真机对一份既有 todo 文档目验勾选框与文字都没动位置。

---

### U3. 跨块选区给列表行块级蓝底

**目标**：跨块选区覆盖到列表的部分行时，那些行有与其他块同款的块级高亮。（R4 / R5）

**依赖**：U1（行级标记的生命周期与清理范式先立起来，U3 复用）

**文件**：
- `src/editor/blockedit.js`（`refreshRangeSel` 的遍历集合 + `rangesel` 的 li 特化 CSS）
- `e2e/list-rangesel-rows.spec.js`（新建）
- `docs/features/todo-list.md` / `docs/features/editor-cross-block-selection.md`（若存在则同步）

**做法**：`refreshRangeSel` 现在只遍历 `blocksInScope(root)`（= `root.children`），`<li>` 永不进集合，
所以部分覆盖的列表一个标记都不打。改为：列表块被**完整覆盖**时维持现状（整个 `<ul>` 打标记，
既有行为不变），**部分覆盖**时下沉到被覆盖的那些 `<li>`。按 KTD4 配 li 特化的收窄光晕。
清理沿用 U1 的按属性全扫。

**参照**：PR #314 定的「跨块选区整行蓝底对齐 Notion」口径；`refreshRangeSel` 现有的 `covered()` 判定。

**测试场景**：
- **部分覆盖**：从上方段落选到四行列表的第 2 行 → 第 1、2 行有标记，第 3、4 行没有。
- **完整覆盖不回归**：选区罩住整张列表 → 仍是整个 `<ul>` 一个标记（既有行为）。
- **相邻行分得开（KTD4）**：两个相邻行同时标记时，两者光晕之间仍留出未着色带
  （几何断言：spread × 2 < 行距，或直接量两行之间中点像素未被叠加双重着色）。
- **收得掉**：选区塌缩 / 点击别处 → `[data-ws2-rangesel]` 计数为 0。
- **作用一致**：该状态下改颜色 / 删除，作用范围与高亮显示的行集合一致（画的 == 做的，
  这是 PR #395 I4 用血换的不变式）。
- **零入盘**：序列化后无 `data-ws2-rangesel`，reparse conform。

**变异自检**：撤掉部分覆盖的下沉 → 「部分覆盖」那条红、「完整覆盖不回归」那条仍绿；
撤掉 li 特化光晕 → 「相邻行分得开」红。

**验收**：门全绿 + 变异画像定点；真机从段落拖选进列表中部，目验只有被选到的行变蓝。

---

### U4. 架构提案：每行独立成块的成本单，交 Wendi 拍板

**目标**：把「每行独立成块」从口头指令变成一份带实测证据、可拍板的提案。（R6）

**依赖**：无（文档单元，可与 U1-U3 并行）

**文件**：
- `docs/brainstorms/2026-08-06-todo-row-independent-block-costing.md`（新建）
- `docs/brainstorms/2026-07-23-todo-item-granularity-requirements.md`（加一行指针，指向新文档；不改原结论）

**做法**：写一份决策备忘，包含——
① Wendi 原话 + 本轮症状已修的说明（避免她以为架构没做就是 bug 没修）；
② 三笔成本，每笔带 file 锚点与实测读数（见「问题」节表格）；
③ **对 origin brainstorm 的两处更正**：(a) 它把方案 A 的两条路捆在一起否决了——「`blockOf` 对 li 破例」
（动脊椎）与「磁盘拆成 N 张单项 ul」（块模型零改动，因为每张 ul 本来就是块）代价差一个量级；
(b) §2 反对的是「body 层平铺的游离 `<li>`」，那确实违反 I2，但**不是**「每行一张 ul」——后者
经 `schema-validate.js` 的 `validateList` 逐 ul 独立校验，100% 合规，且 `serialize.js` 对列表零规范化；
④ Q4 的技术侧答案（只给 to-do 时 md 往返干净，实测不动点）；
⑤ 三个可选终态（只 to-do 且只扁平 / 全量三种列表 / 维持方案 B）各自的代价与残留问题，给出推荐。

**测试场景**：`Test expectation: none —— 纯决策文档，无行为变更。`

**验收**：文档可被 Wendi 单独读懂（不要求她读代码）；三笔成本每笔都能追到具体文件；
brainstorm 的 status 与新文档形成闭环。

---

## 范围边界

**本轮做**：U1-U4。

**不做（有意）**：
- 存储模型不动（磁盘仍是 canonical `<ul>`）——Colin 2026-08-06 拍板，架构走 U4 提案。
- 多段容器（callout / quote）的编辑态高亮不下沉（KTD3）。
- `[data-ws2-selected]` 的 6px 外晕压邻行 1.2px：实测视觉不显著，记 spec 欠账不动。
- 带子项的行被选中时框住整棵子树：与现有行选中行为一致，记为已知局限。

### 后续跟进
- Wendi 拍完 U4 后，若走架构，另开 feature 级 plan（编号重编、嵌套表达、md 往返各是独立单元）。
- 容器行级高亮（KTD3 的另一半）。

---

## 风险

- **`blockedit.js` 是三 session 共同热点**（表格第三批刚合、Tab 分派在制品）。U1/U3 动的是
  `enterEdit`/`exitEdit`/`onSelectionChange`/CSS 段，与表格（cell 态）和 Tab（键分派）不重叠，
  但推 PR 前必须 rebase 最新 main 并复跑受影响 spec。
- **U2 动入盘 CSS**：影响所有既有 todo 文档的渲染。文字位移回归门是这条的主要防线，别省。
- **新标记漏进产物**：KTD2 的两层门就是为这条设的（team-memory 2026-08-06 已实爆过一次）。

---

## 验证（诊断期已完成的实测，供实现期复用）

诊断探针 `e2e/probe-todo-rowsel*.spec.js`（`WS2_PROBES=1` 才跑，不进默认套）已采集：
编辑态高亮几何（列表 93.6 vs 段落 28）、行间距 4.8px、两档选中框左缘 306.2 / 279、
嵌套 Esc 取行正确、⌘A 二档后 Esc 升整表。实现期可直接改造成正式门或作为对照保留。

**e2e 纪律**：开发循环只跑受影响 spec（`todo-*` / `list-*` / `grip-scope-consistency` / `blockedit-turn-into`）；
全量 690+ 交 CI。动到共享核心时推 PR 前跑一次五条冒烟子集。
