---
title: "E：行单元契约成文 + 行为×块型完备性矩阵门"
date: 2026-08-07
status: active
origin: docs/brainstorms/2026-08-07-notion-block-model-alignment-research.md §3/§5（方案 E；Colin 2026-08-07 拍板 E→A1 路径）
---

# E：行单元契约成文 + 行为×块型完备性矩阵门

## 问题框定

调研（origin 文档）确认：#421 式 bug 的复发条件不是某个具体漏洞，而是**制度缺失**——「块级交互对列表必须下沉到行」只存在于口口相传和散落的 84 处特判里，每来一个新交互都靠人记得。E 的目标是把它变成两样有形的东西：一份**契约条文**（新交互怎么接行单元）和一道**矩阵门**（机器人逐格检查每个行为×每种块型的作用单元对不对）。

E 是 A1（li 升一等交互块，隔离 worktree `wordspace-next-rowblock` / `feat/row-block-identity`）的前置安全网：A1 动工后每次 rebase main 都要过这道矩阵。**E 本身零产品行为变化。**

## Scope Boundaries（非目标）

- 不动块定义链（classify/blockOf/enterEdit）——那是 A1 的活。
- 不修矩阵跑出来的既有红（若发现新漏点，记欠账开独立 issue/PR，不在本计划内顺手修——除非是 P0 丢数据）。
- 不做 callout/quote 的跨块行级蓝底（已记欠账，独立决策）。
- 不改任何用户可感知行为；不新增交互。

## Implementation Units

### U1：行单元解析收拢成单一显式入口

**Goal**：把散落的行单元解析 helper 收拢在一个命名清晰的分组下，成为契约的代码锚点。现有 helper（均在 `src/editor/blockedit.js`）：`tabLineHostOf`(:883)、`rowOf`(:979)、`caretLineHostIn`(:1002)、`paraOf`(:1013)、`isRowAnchor`(:1026)、`caretRowOf`(:1137)、`topLiOf`(:5186，onCopy 内嵌局部)。

**Approach**：**不搬家不改名不改语义**（避免与并行 session 在热点文件撞车、避免 200+ e2e 回归），做三件轻的：① 给这组函数加统一的「行单元解析层」注释块头，声明契约（见 U2）并互相引用；② 把 `topLiOf` 从 onCopy 局部提升为与其他 helper 同层的命名函数（onCopy 原地调用，行为不变）；③ 盘点全文件对 `closest('li')` 的裸调用（矩阵门的检查对象之一），凡语义上是「找作用行」的，改走既有 helper 或加注释说明为何例外。

**Execution note**：characterization-first——动 `topLiOf` 前先跑 copy 相关 spec 钉现状。

**Files**：`src/editor/blockedit.js`（注释块 + topLiOf 提升 + 裸 closest('li') 盘点）。

**Test**：既有 `e2e/todo-*.spec.js`、`e2e/list-*.spec.js` 受影响子集 + `npm test` 单测全绿即可（零行为变化）。

**Verification**：`git diff` 里除注释外只有 topLiOf 提升一处结构变化；copy 相关 spec 全绿。

### U2：契约条文入 spec

**Goal**：把「行单元契约」写成 feature spec 正文，成为后续 PR 审查的依据。

**Approach**：在 `docs/features/todo-list.md` 加「行单元契约」一节（该文件是列表行为的权威 spec），内容三条：① **取用规则**——任何按行作用的交互，作用单元必须经行单元解析层（U1 那组 helper）获取，禁止直接吃 `blockOf` 产物当行、禁止新增裸 `closest('li')`；② **完备性规则**——新增块级交互必须同 PR 在矩阵门（U3）加行 fixture 用例，不进矩阵不许合；③ **断言时点规则**（#421 教训）——行级门必须在交互态**存续期间**断言（编辑中/选中中/拖拽中），不许只断言操作序列结束后的终态。另在 `docs/features/README.md` 的模板提示里加一句指向。

**Files**：`docs/features/todo-list.md`、`docs/features/README.md`。

**Verification**：条文与 U1 注释块互相引用；铁律（谁改交互谁同 PR 更 spec）本次自我满足。

### U3：行为×块型完备性矩阵门

**Goal**：一个矩阵驱动的 e2e spec，逐格断言「作用单元=行」，让 #421 式漏点在 PR 阶段被机器抓住。

**Approach**：新建 `e2e/row-unit-matrix.spec.js`。**矩阵定义**（数据驱动，行为×fixture 两张表，笛卡尔展开生成用例）：

- **行为轴**（7 项，各配一个「作用单元探测器」）：编辑态高亮（data-ws2-editrow 几何）、跨块选区蓝底（data-ws2-rangesel 标注对象）、行手柄悬停（gripRow 锚定对象）、行菜单作用域（菜单头/删除作用对象）、gutter「+」插入位置、⌘A 第一档范围、Esc 第一档灰选对象。
- **fixture 轴**（6 种，全部真实打开文档）：todo 顶层行、todo 嵌套行、todo 多行叶子（含 `<br>`）、普通 ul 行、ol 行、对照组段落（验证探测器本身：段落的「行」=块自身，防矩阵变哑门）。
- **断言强度**：几何/像素级优先（沿用 `e2e/todo-parent-row-tint.spec.js` 的差分像素与 computed-style 范式），存在性断言只作前置条件不作结论——遵守「CSS 全废但断言还过=弱门」判据。
- **时点**：每格在交互态存续期间断言（U2 第③条自我满足）。

**规模控制**：7×6=42 格，实跑预计 15-25 条（部分行为×fixture 组合不适用，如段落无勾选框；矩阵表里显式标 `n/a` 带理由，不许静默跳）。分片 CI 下预计 +1.5-2 分钟，可接受。

**Execution note**：test-first 没意义（现状应全绿），改用**变异自检验门**：先 commit 全绿矩阵，再逐个变异（把 editrow 下沉逻辑注释掉/把 walkListRows 短路/把 rowOf 改返回 ul），矩阵对应格必须翻红，还原后翻绿。变异前必全 commit（血律）。

**Files**：`e2e/row-unit-matrix.spec.js`（新建）。

**Test scenarios**：上述矩阵即场景清单；另加 1 条元用例——矩阵表与 `n/a` 标注的完整性自检（每格必须是「有用例」或「有理由的 n/a」）。

**Verification**：矩阵全绿 + 至少 3 组变异翻红/还原翻绿的记录（PR 描述里贴）。

## Dependencies & Sequencing

U1 → U2（条文引用 U1 的代码锚点）→ U3（矩阵检查 U1 的 helper 语义）。三个 U 一个 PR 提交（总量小、互相引用，拆开反而难审）；如 U3 膨胀可拆第二个 PR。

## Risks

- **热点文件撞车**：blockedit.js 多 session 共享，U1 刻意只加注释+一处提升；动工前 `/sync-main`。
- **矩阵探测器写弱**：每个探测器过一遍「CSS 全废还过吗」自问 + 变异自检兜底。
- **深色主机像素断言**：沿用 `setAppearance('light')` 钉浅色范式（todo-parent-row-tint 先例）。

## Deferred to Implementation

- 探测器对「⌘A 第一档」「Esc 第一档」的具体断言方式（选区内容 vs 灰选属性）——实现时按最强可测信号定。
- 矩阵是否顺手覆盖 toggle 体内列表行——实现时看成本，超过半天则记欠账。
