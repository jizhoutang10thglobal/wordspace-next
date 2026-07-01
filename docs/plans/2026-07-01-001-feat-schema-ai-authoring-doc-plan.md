---
title: "Schema #1 的 AI 可读创作文档 + 外部生成→校验回路（Feature 2 / AI 生成按 schema）"
type: feat
status: active
date: 2026-07-01
origin: docs/brainstorms/2026-06-30-schema-foundation-requirements.md
---

# Feature 2：AI 生成按 Schema — 可读创作文档 + 文件式校验回路

## 问题框架

Wordspace 的新方向：AI 按 Schema #1 生成 / 编辑合规 HTML。冻结架构（origin brainstorm §KD3 / R5–R7）已把**近期 AI 定死**为：

> 一份**AI 可读的 Schema 文档** → 外部 agent（如 Claude）读它、产出 `.html` → Wordspace 的**确定性校验器**把门（走文件式回路）。**MVP 不上 MCP、不做应用内 AI。**

「AI 改不出错」的保证来自 **校验器永远把门（KD1）+ 非合规降级（feature 3）**，**不依赖 AI 产出必然合规**（R6）。所以本 feature 的两个真交付物是：**(a) 让 AI 一次命中率尽量高的创作文档**，**(b) 一道任何 AI 产出都要过的确定性校验门**。二者都不碰 ui-demo、不碰 in-app AI UI（那是「后续阶段」，本 plan 明确不做）。

**为什么现在做**：Schema #1 的校验器（`src/lib/schema-validate.js`）已在 `feat/schema-1` 落地并经对抗验证，块/行内词汇已冻结（`docs/schema-1-draft-v0.md` §0–§4）。校验器 = 单一真相源（KD2）已就位，正好据它派生 AI 文档并用它做验证门。

## 需求追溯（origin brainstorm）

| 需求 | 出处 | 本 plan 如何覆盖 |
|---|---|---|
| R5 存在一份 AI 可读 Schema 文档，让外部 AI 据此生成合规 HTML | origin §需求 | **U2**（创作文档） |
| R6 「AI 改不出错」由校验器 + 非合规降级保证，不靠 AI 必然合规 | origin §需求 | **U1**（校验门）+ **U4**（实证命中率、不追求 100%） |
| R7 MVP 不引入 MCP；走「读文档 → 产出文件 → Wordspace 校验」文件式回路 | origin §需求 | 全 plan 范围锚定文件式回路；MCP 列非目标 |
| KD2 Schema 单一真相源；人/AI 读的那份从机器可读那份派生、防漂移 | origin §决策 | **U3**（文档↔校验器一致性测试，防漂移） |
| KD4 marker 仅 advisory，识别以校验器核实际内容为准 | origin §决策 | U2 如实写「marker 不保证合规」；U1 校验器压根不看 meta |

## 关键决策（含理由）

- **KD-a｜AI 文档形态 = 可移植 markdown 参考文档**（`docs/schema-1-ai-authoring.md`），**先不做成 Claude Skill / 不做 MCP**。
  理由：origin KD3 明确 MVP = prompt/documentation、no MCP。markdown 参考文档最可移植——外部 agent 可当上下文喂、将来要包成 SKILL.md 或系统 prompt 也是零成本再封装。**先文档、后封装**。
- **KD-b｜防漂移靠「实证绑定」而非代码生成**：AI 文档里的每个正例必须被校验器判 conform、每个反例必须被判 violation 且 rule 名对得上（U3 测试强制）。
  理由：校验器是权威（KD2）。让文档的每条断言都被校验器背书，是最简单可靠的防漂移手段——文档吹的规则若和校验器不符，U3 立刻红。比「从机器规格生成文档」轻、且直接测的是「AI 会读到的那份文字对不对」。
- **KD-c｜校验门复用 `schema-validate.js` + jsdom 跑 node**：`new JSDOM(html).window.document` → `validate(doc)`（已有 pattern，见 `test/doc-templates.test.js`）。
  理由：校验器本就是框架无关纯 JS；jsdom 提供「磁盘字节 reparse 出的 Document」正合 §4.3 铁律③（判 reparse DOM、不判活 DOM）。
- **KD-d｜范围 = 只做外部文件式回路**：no in-app AI、no MCP、no 自动多轮修复。violations 回喂 AI 修复只定**约定 + 单步工具**，不做编排。
  理由：用户已拍板走 Feature 2 / 冻结架构；把面收窄到「文档 + 校验门 + 实证」，是能独立交付、且被校验器兜底的最小完整回路。
- **KD-e｜本 plan 消费校验器、不改校验器规则**：Schema #1 本身的 bug 收口 / 规则演进是 `2026-06-30-001-feat-schema-1-closed-editor-plan.md` 的活。本 plan 如实描述**校验器当前**的规则；校验器变了，U2 文档 + U3 fixtures 跟着走（U3 会逼同步）。

## Implementation Units

### U1 — 校验 CLI（文件式回路的「门」）
**Goal**：一个 node 脚本 `scripts/validate-schema.js <file.html>`：读磁盘 HTML → jsdom reparse → 跑 `validate` → 打印 `{conform, violations:[{rule,tag,msg}]}`（JSON）+ 人读摘要，退出码 `conform?0:1`。这是外部 agent「产出 → 校验」回路的校验一环，也是 U3/U4 的公共底座。
**Files**：
- 新建 `scripts/validate-schema.js`
- 复用 `src/lib/schema-validate.js`、`src/lib/schema-model.js`
- 新建 `test/validate-schema-cli.test.js`
**Patterns to follow**：jsdom + validate 的用法照 `test/doc-templates.test.js:3-29`（`new JSDOM(html).window.document` → `validate(doc)`）。
**Approach**：argv 取路径 → `fs.readFileSync` → `new JSDOM(html).window.document` → `validate` → `console.log(JSON.stringify(result))` + 非空 violations 逐条打印 `rule / tag / msg` → `process.exit(conform?0:1)`。缺文件 / 读失败 → stderr + 退出码 2。
**Execution note**：test-first。
**Test scenarios**：
- canonical 合规文档（照 `schema-1-draft-v0.md` §2.1 小样例）→ 退出 0、`conform:true`、violations 空。
- 含 `<script>` → 退出 1、命中 rule `script`。
- `<h5>` 块 → rule `block-tag`。
- 表格带 `colspan` → rule `table-merge`。
- `<p>` 内嵌 `<div>` → rule `nested-block`。
- 不存在的文件 → 退出码 2、stderr 有提示。
**Verification**：`node scripts/validate-schema.js <ok.html>` 打印 conform、退出 0；`<bad.html>` 列出 violations、退出 1。`node --test test/validate-schema-cli.test.js` 全绿。

### U2 — AI 可读 Schema #1 创作文档（核心交付物）
**Goal**：写 `docs/schema-1-ai-authoring.md` —— 让外部 AI **一次产出合规 HTML** 的权威创作指南。面向 AI 读者（祈使、精确、零歧义），覆盖：标准骨架、块速查表（每块 canonical HTML）、行内标记表、三类内容模型、head 白名单、marker 语义（advisory）、**硬禁清单**（每条直接对应校验器的一个 `rule`）。
**Files**：
- 新建 `docs/schema-1-ai-authoring.md`
- 派生依据（读，不改）：`docs/schema-1-draft-v0.md` §0/§2/§3/§4、`src/lib/schema-validate.js`（规则必须与校验器逐条对齐 = KD2 防漂移）
**Approach**：结构 =
  1. **30 秒骨架**：doctype + `html[lang]` + head（charset meta / `meta[name=wordspace-schema][content="1"]` / title / 仅 `style[data-ws-schema-css]`）+ body 扁平挂块。
  2. **块速查表**：p / h1–h4 / ul·ol·li（+ `ul.ws-todo>li[data-checked]`）/ blockquote / `div.ws-callout` / hr / `table.ws-table`（矩形、无合并、cell phrasing-only）/ `details>summary`（toggle，`open` 持久）/ img / figure。每块给 canonical 正例。
  3. **行内标记**：b/i/u/s、code（内只放文本）、a[href]（过 safeHref、禁 `on*`/`target`）、span 色/高亮（或 mark）、br。叠加规则三条硬约束。
  4. **硬禁清单**（对应校验器 rule）：`script`/`event-attr`(on*)/`unsafe-href`/`block-style`(块带 style)/`block-tag`(h5/h6/section/裸 div)/`nested-block`/`list-child`/`li-content`/`cell-content`/`table-merge`/`table-structure`/`table-ragged`/`head-*`(base/link/http-equiv/作者 style)/`figure-content`。每条：**为什么禁 + 合规替代写法**。
  5. **完整样例文档**（可直接过校验器）。
  6. **marker 声明 ≠ 合规**：写清「校验器只看内容、不信 meta 自称」（KD4）。
**Test scenarios**：文档本身是文档，其正确性由 U3 强制（文档内每个正例过校验器、每个反例被拒且 rule 对得上）。
**Verification**：U3 全绿；人读一遍确认覆盖 §2/§3/§4 全部块与行内、无遗漏、无与校验器冲突的措辞。

### U3 — 文档↔校验器一致性测试（防漂移，KD2）
**Goal**：把 U2 文档里的正例 / 反例固化成 fixtures，断言：**正例全 `conform`；反例全 non-conform 且命中文档声称的 `rule`**。堵「文档说合法但校验器拒 / 文档说非法但校验器放」两向漂移。
**Files**：
- 新建 `test/schema-1-ai-doc-conformance.test.js`
- 新建 `test/fixtures/ai-doc/ok/*.html`（正例）、`test/fixtures/ai-doc/bad/*.html`（反例，文件名或旁注带期望 rule）
- 复用 `src/lib/schema-validate.js`
**Patterns to follow**：`test/doc-templates.test.js`（遍历 fixtures → jsdom → validate → 断言 conform）。
**Execution note**：test-first —— fixtures + 断言先写，逼 U2 文档的每条规则都有对应例子。
**Test scenarios**：
- 每个 canonical 块正例（p/h1-4/todo/callout/quote/table/toggle/figure…）→ `conform:true`。
- 每类硬禁反例 → `conform:false` 且 violations 含期望 rule：`script` / `event-attr` / `unsafe-href` / `block-style` / `block-tag`(h5) / `nested-block` / `cell-content` / `table-merge` / `head-link` / `head-base` / `head-meta-http-equiv` / `figure-content`。
**Verification**：`node --test test/schema-1-ai-doc-conformance.test.js` 全绿。改文档规则 → 必须同步改 fixture，否则红（这就是防漂移的门）。

### U4 — 真 AI 生成实证（裁判≠运动员 / 教训要实证）
**Goal**：用真 AI（Claude subagent）读 U2 文档、按 N≥8 条真实提示生成 `.html`，跑 U1 校验器量**一次命中合规率**，把典型 violations 回喂改进 U2 文档，产出实证报告。这是 R6 的落地：**不追求 AI 100% 合规，但要量出命中率、并证明校验门真拦得住非法产出**。
**Files**：
- 新建 `docs/schema-1-ai-generation-eval.md`（报告：命中率 + top 失败 rule + 对 U2 的修订记录）
- 用 U1 `scripts/validate-schema.js`
**Approach**：提示覆盖多块型（周报 / 三列价格表 / 带 callout+todo 的方案 / 引用 + 多级标题 / 带图 figure …）。每篇：AI 只拿 U2 文档 → 产出 `.html` → 过 U1 → 记录 conform/violations。命中率低于阈值的失败模式 → 回改 U2（补规则说明 / 加反例）→ 至少跑一轮「生成 → 校验 → 改文档 → 再生成」闭环，记录前后命中率变化。
**Scope note**：这是**实证 + 文档迭代**，不是自动化编排；violations 回喂只走人读 + 改文档，不建多轮修复机器人（KD-d）。
**Test scenarios**：逐篇记录 conform/violations；聚合一次命中率；列 top 3 失败 rule；记录闭环前后命中率。
**Verification**：报告存在；命中率量出来了；证明「非法产出被校验器拦下」至少有真实例子（不是所有产出都碰巧合规）；U2 据实证至少改过一轮。

## 顺序 / 依赖

```
U1（校验门, test-first）
   └─► U2（创作文档, 派生自校验器）  ← U2 起草可与 U1 并行, 但其验证依赖 U1/U3
          └─► U3（文档↔校验器一致性, test-first）  ← 需要 U1 + U2 的正反例
                 └─► U4（真 AI 实证）  ← 需要 U1 门 + U2 文档
```
建议：先 U1 落门 + U2 起草并行 → U3 把二者钉死 → U4 拿真 AI 压。每个单元绿了 commit（注 U 号），worktree = `feat/schema-1`（与 schema 其他工作同分支）或另开短命 `feat/schema-ai-doc` 分支，独立合 main。

## 风险 & 依赖

- **jsdom 解析 ≠ Chromium 解析**：U1/U3 用 jsdom reparse，真 app 里校验走浏览器 reparse（`file://` 直载）。二者对畸形 HTML 的容错可能有别 → jsdom 判合规、Chromium 未必逐字节等价。MVP 校验门用 jsdom 可接受（Schema #1 是良构子集、差异面小），但**报告里记一句**：权威校验路径最终是 app 内浏览器 reparse，jsdom 是回路侧近似。
- **校验器是 v1、Schema #1 §7 仍有 open bug**：U2 描述的是「校验器当前」规则，不是「Schema 理想终态」。校验器演进（closed-editor plan）→ U2 + U3 fixtures 跟着改（U3 逼同步，是特性不是负担）。
- **AI 命中率未知**：U4 前不知道一次命中率多高。若很低，说明 U2 文档还不够（这正是 U4 要暴露并迭代的），不是 blocker——校验门（U1）保证「低命中率也不会有非法文档溜进合规编辑」。
- **依赖**：`src/lib/schema-validate.js` / `schema-model.js`（已在 `feat/schema-1`）、jsdom（已装）。无新外部依赖。

## Scope Boundaries（非目标）

- ❌ **in-app AI UI**（ui-demo 的 `AiSoonModal` / Ask AI / 斜杠 `/ai` / 右下角 Agent 面板）——origin 划为「后续阶段」，本 plan 一律不碰。
- ❌ **MCP / 校验器-as-tool**——origin R7 MVP 明确不上。
- ❌ **自动多轮修复回路 / 生成编排机器人**——只定 violations 回喂的人读约定 + U1 单步校验工具。
- ❌ **改校验器规则 / Schema #1 本身的 bug 收口**——那是 closed-editor plan 的活；本 plan 只消费校验器。
- ❌ **不动 ui-demo（React/Vite）**——本 feature 是文档 + node 工具产物。

## Deferred to Implementation（执行时定）

- U2 文档的**分节粒度与措辞**（速查表用表格还是逐块小节；给 AI 的语气模板）——起草时按「AI 好读、例子够密」定。
- U4 的**提示集具体内容 + 合规率阈值**——执行时按覆盖块型的原则拟；阈值先记录观测值、不预设硬数字（R6 不追求 100%）。
- 是否把 U2 文档**顺手包一层 SKILL.md**（薄封装、指向同一份 markdown）——留到 U4 见实证效果后再定，不阻塞主线。
