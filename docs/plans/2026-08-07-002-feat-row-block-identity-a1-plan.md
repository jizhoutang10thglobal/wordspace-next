---
title: "A1：li 升为一等交互块（行块身份）"
date: 2026-08-07
status: active（工程可动工；行为级收敛项単独标 needs-decision）
origin: docs/brainstorms/2026-08-07-notion-block-model-alignment-research.md §3 方案 A1（Colin 2026-08-07 拍板 E→A1 路径；E 已合 main #430）
worktree: wordspace-next-rowblock / feat/row-block-identity（隔离打磨，稳定 + 真机验收后整体合 main——Wendi「半成品不进 main」原则）
---

# A1：li 升为一等交互块（行块身份）

## 问题框定

现状：块编辑器的「块」= blockRoot 的直接子元素，`<li>` 从来不是块——交互层为了行级手感在 blockOf 产物之外绕行出 84 处 UL/OL/LI 特判（补偿层，还在自产二阶 bug）。A1 把「行是一个块」写进块定义链本身：**交互语义的「块」对列表指向 `<li>`**，补偿层约一半可删。

三条铁约束（调研定稿，不重开）：
1. **磁盘格式一个字节不变**——canonical 仍是一张语义 `<ul>`；serialize/schema-validate/md-adapter 零改动。任何时刻可整体回滚。
2. **保住单 ce 宿主**——contenteditable 仍挂整个 ul（`enterEdit` 不动）。列表内跨行原生打字/选区/IME 的浏览器红利保留，跨块 IME 欠账不扩散。A1 改的是「块」的语义指针，不是 ce 挂载。
3. **用户可感知行为默认零变化**——行为级收敛（⌘A/Esc 档位、菜单双入口）是独立决策项（见「行为收敛决策清单」），不随工程重构顺手改。

## 核心设计：交互块 vs 存储块显式分账

今天 `blockOf` 一个函数背着两种语义：**存储块**（顶层结构单元：serialize、topBlocks 计数、跨块删除、合并落点）和**交互块**（高亮/选中/菜单/拖拽/键盘的作用单元）。列表上两者不同（存储=ul，交互=li），84 处特判就是在调用点手工分账。

A1 的机制 = 把分账做进原语层：
- 新增 `iblockOf(node)`：交互块解析。列表内 → 最深所属 `<li>` 上卷到**合适作用层**（默认=光标/事件所在行，与现 `caretRowOf`/`rowOf` 同语义）；多段容器内 → 直接子 `<p>`（收编 `caretLineHostIn`/`paraOf`）；其余 → 等于 `blockOf`。E 建的行单元解析层是它的雏形，A1 把那九个 helper 归一到 `iblockOf` 一个口子下。
- `blockOf` 保留、语义收窄为**存储块**——名字不换（避免全文件改名巨 diff），注释改契约：消费方必须是结构/序列化语境。
- **灰度门控**（照 `blockOf` 的 details 门控先例）：`WS2_ROWBLOCK` 开关（env/内部 flag），关=全部走旧路径逐字节不变；开=交互链走 `iblockOf`。迁移期间矩阵门在两种开关态各跑一遍（CI 矩阵 job ×2，约 +1 分钟）。收尾时删开关。

## Implementation Units

### U0 调用点分账清单（1-2 天，纯盘点零改动）
`blockOf`/`editingEl`/`selectedEl` 全部消费点逐个标注：存储块 / 交互块 / 双语义（要拆）。产出 `docs/plans/a1-callsite-ledger.md`（worktree 内部工作文档，合 main 前并入本 plan 附录）。**Execution note**：这是 A1 的手术图，画完才准动刀；分账有争议的点先记 open 不猜。

### U1 `iblockOf` 原语 + 门控落地（不接线）
新增原语与开关，行为零变化（开关默认关）。单测直接打（jsdom 级：各块型×光标位置→返回元素断言）。

### U2 视觉链接线：高亮/选中/手柄/菜单/「+」
editrow/rangesel/grip/menu/plus 五条链从「blockOf+行补偿」改为 `iblockOf` 直取。**预期是删码**：refreshEditRow 的 UL/OL 特判、walkListRows 的下钻、gripRow/hoverRow 双轨、menuRow 行模式分支——这些补偿在 `iblockOf` 语义下塌缩为通用块路径。矩阵门（42 格）+ 各深门在开关开态必须全绿；变异自检重放。

### U3 键盘面：⌘A/Esc/Backspace/Delete/Tab/Enter
最大最险的一块，按键分 PR 迁移（worktree 内小步 commit）。行为契约不变的前提下换底座：三档⌘A/Esc 保留（第一档=iblockOf 产物、第二档=存储块、第三档=全篇——档位语义反而变整齐）；行首退格 E1、Delete 前向合并、Tab 多选缩进的 li 特判改经 `iblockOf`。Enter 不动（原生 li 分裂靠单 ce 宿主，铁约束 2）。
**Execution note**：characterization-first——每个键先跑既有 spec 钉现状再动。

### U4 剪贴板与拖拽收编
onCopy 列表打包特判（topLiIn 那段）、行拖拽 placeRow/rowDrop 的容器手术保留（磁盘仍是 ul，劈合不可少），但入口判定统一走 `iblockOf`。此单元预期删码少、主要是归口。

### U5 补偿层清账 + 开关拆除
84 处特判逐个过账：删（补偿已塌缩）/留（存储块语义，加注释标明）/悬（争议项记欠账）。删 `WS2_ROWBLOCK` 开关，新路径转正。全量 e2e（CI）+ 本地 `npm run test:e2e:dot` 兜底（动共享核心的唯一例外条款）。

### U6 真机验收 + 对拍
Colin/Wendi 真机试玩；/align-notion 口径复跑列表维度对拍；矩阵门 + 深门 + 全量绿 → 整体合 main（一列 PR train 或单大 PR，届时定）。合并前 /sync-main 清冲突（blockedit.js 热点，隔离期 main 必有并行改动）。

## 行为收敛决策清单（不随工程走，逐条要拍板）

A1 完成后这些「因错配而生」的行为可以收敛，但每条都改用户手感，单独拍：
- ⌘A / Esc 三档 → Notion 两档？（第二档「整张列表」在行块语义下失去必然性）
- 手柄菜单双入口双作用域 → 合一？（Colin 2026-08-03 拍的 U3=C 需重开）
- 「行模式不设 selectedEl」约束随块身份转正自然解除——7-23「方案 A=动脊椎」否决的正式重开，落 team-memory 广播。

## Scope Boundaries

- 磁盘格式/Schema/md-adapter：零改动（铁约束 1）。
- callout/quote 的段行升块：`iblockOf` 留好口子但本轮只接列表 li——容器 p 行收编记欠账，独立小批。
- 跨块编辑内核加固（bug 归因里的「通用税」半边：跨块 IME/无主态）：**不在 A1 内**——它是独立轨道，调研 Q2 里与 A1 并列。
- ui-demo 侧：不动，漂移照制度进账本。

## Risks

- **隐含假设漏网**：「块=顶层直接子」散布 6100 行 + 200+ e2e。缓解=U0 手术图先行、门控双态跑矩阵、worktree 隔离随时弃。
- **隔离期 main 漂移**：blockedit.js 并行 session 高频改。缓解=每周 merge main + 矩阵重跑；U5 前做一次全量对账。
- **e2e 断言语义位移**：断「顶层块数」的 spec 在 A1 下语义不变（存储块没动），预期红点少；出现即逐条判「断言错」还是「回归」，不许改弱。

## Dependencies / 开工条件

- E 已合 main（#430 ✅）。
- **Wendi 对调研 Q1 点头**（磁盘保语义 ul）——A1 全部工程建立在此前提上；她若答 A2/磁盘拆，本 plan 作废重来。U0（纯盘点）可在等待期先做，U1 起等点头。
