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
- **KD-b｜防漂移靠「实证绑定 + 完整性元测试」而非代码生成**：AI 文档里的每个正例必须被校验器判 conform、每个反例必须被判 violation 且 rule 名对得上；**且 U3 有元测试断言「反例覆盖校验器全部 rule」**（校验器当前 20 条 rule、U0 后 +2 = 22；以校验器源码为单一来源，新增一条没补 fixture 就红）。
  理由：校验器是权威（KD2）。让文档的每条断言都被校验器背书，是最简单可靠的防漂移手段——文档吹的规则若和校验器不符，U3 立刻红。但「每条都背书」只有在「反例集完整覆盖 rule 全集」时才成立，否则漏钉的 rule 可任意漂移（doc-review 抓到 U2/U3 原本只列 14/12 条、漏 8 条）——所以完整性靠元测试自动兜、不靠人肉核对。
- **KD-c｜校验门复用 `schema-validate.js` + jsdom 跑 node**：`new JSDOM(html).window.document` → `validate(doc)`（已有 pattern，见 `test/doc-templates.test.js`）。
  理由：校验器本就是框架无关纯 JS；jsdom 提供「磁盘字节 reparse 出的 Document」正合 §4.3 铁律③（判 reparse DOM、不判活 DOM）。
- **KD-d｜范围 = 只做外部文件式回路**：no in-app AI、no MCP、no 自动多轮修复。violations 回喂 AI 修复只定**约定 + 单步工具**，不做编排。
  理由：用户已拍板走 Feature 2 / 冻结架构；把面收窄到「文档 + 校验门 + 实证」，是能独立交付、且被校验器兜底的最小完整回路。
- **KD-e｜校验器与 Schema 定义是一体的、随需同步扩**（Colin 校正 2026-07-01，覆盖原「本 plan 不改校验器」）：Schema 边界画到哪、校验器就执行到哪，二者 aligned。写 AI 文档若暴露校验器的空白（如 toggle 内部没校验），**正解 = 补校验器让规则真被门兜住**，不是在文档里标 advisory 绕过去。本轮具体 = **U0 补 `validateDetails`**。**边界**：已完备的其余规则不动；Schema #1 §7 更大的 bug 收口（A/F/C 档编辑器操作 / 存盘保真）仍归 closed-editor plan，本 plan 只补「为让 AI 文档规则有门兜」所需的校验器缺口。校验器变了 → U2 文档 + U3 fixtures 跟着走（U3 元测试逼同步）。
- **KD-f｜文档分发形态（⚠ 待 Colin 确认，先填 MVP 默认）**：U2 文档怎么送到外部 agent 的上下文？MVP 默认 = **人工喂**（Colin / 用户手动把 `schema-1-ai-authoring.md` 贴进 Claude 会话，或放进项目 repo 让 coding agent 自己读），**不做自动分发 / 不做工具**。
  理由：doc-review（product-lens）指出「文档怎么被读到」是价值链里唯一没 owner 的一环、决定命中率对谁有意义。文件式回路本身没问题，缺的是把这个前提从隐含变显式。填「人工喂」是最小可交付默认，让 U4 命中率有明确适用边界（「在人工喂整份文档的条件下」）。**Colin 若想要别的分发形态（可分享 prompt/link、自动注入），改这条**——但不阻塞 U1–U4。

## Implementation Units

### U0 —（前置）校验器补 toggle 内部校验（validateDetails）
**Goal**：给 `src/lib/schema-validate.js` 加一段 `validateDetails`，让校验器真管 `<details>` 内部结构（现在它对 details 内部睁眼瞎——`schema-validate.js:97` 写着「暂不深验」，任意畸形 toggle 都判 conform）。补上后 toggle 规则才能被门兜住、U2 教的 toggle 规则 U3 能写反例验证（体现 KD-e：校验器随 schema 同步扩）。
**Files**：
- 改 `src/lib/schema-validate.js`（加 `validateDetails`，在 `validateBlock` 的 DETAILS 分支调用；新增 rule `details-summary` / `details-summary-content`）
- 改/补 `test/schema-validate.test.js`（toggle 正例 + 各类坏 toggle 反例）
**Execution note**：test-first。
**Approach**（按草案 §2.1 toggle 规格 + §0 决策 3，⚠ 这几条 = schema 边界，动前已跟 Colin 过）：
- 第一个元素子必须是**恰好一个** `<summary>`（缺 / 多 / 非首子 → rule `details-summary`）。
- `<summary>` = phrasing-only（内塞块 → rule `details-summary-content`，复用现有 `phrasingOnly`）。
- summary 之后的正文 = flow：逐个当块跑 `validateBlock`（**这是 Schema 唯一允许块嵌套的地方**——正文可嵌块、可再嵌 details）。
- details 属性只允许 `open`（布尔）；块级禁 style 已由现有 `block-style` 覆盖，不重复。
**Test scenarios**：
- 正例：`<details open><summary>标题</summary><p>正文</p><ul><li>可嵌列表</li></ul></details>` → conform。
- 反例：无 summary / 两个 summary / summary 非首子 → 含 `details-summary`；summary 里放 `<p>` → 含 `details-summary-content`；正文里放非法块（h5）→ 含 `block-tag`（正文走 validateBlock 自然继承）。
**Verification**：`node --test test/schema-validate.test.js` 全绿；U3 的 toggle 反例门能立起来。
**依赖**：先于 U2/U3 的 toggle 部分；U1（校验 CLI）不依赖它、可并行。

### U1 — 校验 CLI（文件式回路的「门」）
**Goal**：一个 node 脚本 `scripts/validate-schema.js <file.html>`：读磁盘 HTML → jsdom reparse → 跑 `validate` → 打印 `{conform, violations:[{rule,tag,msg}]}`（JSON）+ 人读摘要，退出码 `conform?0:1`。这是外部 agent「产出 → 校验」回路的校验一环，也是 U3/U4 的公共底座。
**Files**：
- 新建 `scripts/validate-schema.js`
- 复用 `src/lib/schema-validate.js`、`src/lib/schema-model.js`
- 新建 `test/validate-schema-cli.test.js`
**Patterns to follow**：jsdom + validate 的用法照 `test/doc-templates.test.js:3-29`（`new JSDOM(html).window.document` → `validate(doc)`）。
**Approach**：argv 取路径 → `fs.readFileSync` → `new JSDOM(html).window.document` → `validate` → `console.log(JSON.stringify(result))` + 非空 violations 逐条打印 `rule / tag / msg` → `process.exit(conform?0:1)`。缺文件 / 读失败 → stderr + 退出码 2。
**Execution note**：test-first。
**Test scenarios**（断言一律用「violations **含**期望 rule」= `some(v=>v.rule===x)`，**别**断言「恰一条」——一个反例可同时命中多条 rule，见下）：
- canonical 合规文档（照 `schema-1-draft-v0.md` §2.1 小样例）→ 退出 0、`conform:true`、violations 空。
- 含 `<script>`（body 内）→ 退出 1、含 `script`。⚠ 实测同时命中 `block-tag`（script 不在 TOP_BLOCKS）——所以断言用「含」。
- `<h5>` 块 → 含 `block-tag`。
- 表格带 `colspan` → 含 `table-merge`。
- **容器嵌块**（`<blockquote><ul><li>a</li></ul></blockquote>`）→ 含 `nested-block`。⚠ **别用 `<p><div></div></p>` 当 nested-block 例子**：HTML5 reparse 会把 `<div>` 踢出 `<p>` 成 body 裸块 → 实际命中 `block-tag` 而非 nested-block（这正是 §4.3 铁律③「判 reparse DOM」的直接后果；顶层叶子块 reparse 后永远不含块级后代，nested-block 只在 callout/quote 容器内触发）。
- 不存在的文件 → 退出码 2、stderr 有提示。
- **系统性全覆盖**：U1 CLI 对校验器**全部 rule**（当前 20 + U0 的 details-* 2 条，以校验器源码为准）各至少有一个反例被正确拒（fixture 数据以 U3 的 `test/fixtures/ai-doc/bad/` 为单一来源，别各写一套）。
**Verification**：`node scripts/validate-schema.js <ok.html>` 打印 conform、退出 0；`<bad.html>` 列出 violations、退出 1。`node --test test/validate-schema-cli.test.js` 全绿。

### U2 — AI 可读 Schema #1 创作文档（核心交付物）
**Goal**：写 `docs/schema-1-ai-authoring.md` —— 让外部 AI **一次产出合规 HTML** 的权威创作指南。面向 AI 读者（祈使、精确、零歧义），覆盖：标准骨架、块速查表（每块 canonical HTML）、行内标记表、三类内容模型、head 白名单、marker 语义（advisory）、**硬禁清单**（每条直接对应校验器的一个 `rule`）。
**Files**：
- 新建 `docs/schema-1-ai-authoring.md`
- 派生依据（读，不改）：`docs/schema-1-draft-v0.md` §0/§2/§3/§4、`src/lib/schema-validate.js`（规则必须与校验器逐条对齐 = KD2 防漂移）
**Approach**：结构 =
  1. **30 秒骨架**：doctype + `html[lang]` + head（charset meta / `meta[name=wordspace-schema][content="1"]` / title / 仅 `style[data-ws-schema-css]`）+ body 扁平挂块。
  2. **块速查表**（分清顶层 vs 嵌套，别让 AI 以为 li 是顶层块）：**顶层块** = `p / h1–h4 / ul / ol / blockquote / div.ws-callout / hr / table.ws-table / details / img / figure`；**嵌套结构** = `li`（只在 ul/ol 直接子，+ `ul.ws-todo>li[data-checked]`）、`summary`+body（在 details 内）、`thead/tbody/tr/th/td`（在 table 内，矩形、无合并、cell phrasing-only）、`figcaption`（在 figure 内、phrasing-only）。每块给 canonical 正例。
  3. **行内标记**：b/i/u/s、code（内只放文本）、a[href]（过 safeHref、禁 `on*`/`target`）、span 色/高亮（或 mark）、br。叠加规则三条硬约束。
  4. **硬禁清单 = 校验器全部 rule 的逐条镜像**（当前 20 条 + U0 补的 `details-summary`/`details-summary-content`；U3 元测试强制「清单 = 校验器 rule 全集」）。逐条：`script` / `event-attr`(on*) / `unsafe-href` / `nested-block` / `list-child` / `todo-checked`(data-checked 只能 true/false) / `li-content` / `table-merge` / `cell-content` / `table-structure`(禁 caption/colgroup/tfoot、表头至多一行) / `table-ragged`(表格须矩形) / `figure-content` / `figcaption-content`(图注只放行内) / `block-style`(块带 style) / `block-tag`(h5/h6/section/裸 div) / `head-meta-http-equiv` / `head-style`(无 `data-ws-schema-css` 的作者 style) / `head-base` / `head-link` / `head-tag`(head 其余非法标签)。**head-* 一律展开成 5 条具名、别用通配**（AI 读通配学不到具体禁什么）。每条：**为什么禁（追到 KD1–KD5 / 安全向量）+ 合规替代写法**。
  5. **reparse 行为教学**：明确写「顶层块级嵌套会被浏览器 reparse 自动拆开、命中 `block-tag` 而非 `nested-block`；nested-block 只在 callout/quote 容器内放列表/块时触发」——防 AI 和后续维护者复制「p 嵌 div = nested-block」的误解。
  6. **完整样例文档**（可直接过校验器）。
  7. **marker 声明 ≠ 合规**：写清「校验器只看内容、不信 meta 自称」（KD4）。
**Advisory 边界（诚实标注）**：toggle 内部规则**由 U0 补的 `validateDetails` 真强制**（不再是 advisory）——U2 照常教、U3 有反例门兜。唯一仍 advisory 的是 `<img>` 双重身份（草案 §7 S7 待决）——U2 只教**块级 img**（body 直接子 / figure 内），行内 img 暂不覆盖、注明待决。
**Test scenarios**：文档本身是文档，其正确性由 U3 强制（文档内每个正例过校验器、每个反例被拒且 rule 对得上）。
**Verification**：U3 全绿（含「清单 = 校验器 20 条 rule 全集」元测试）；人读一遍确认覆盖 §2/§3/§4 全部块与行内、无遗漏、无与校验器冲突的措辞。

### U3 — 文档↔校验器一致性测试（防漂移，KD2）
**Goal**：把 U2 文档里的正例 / 反例固化成 fixtures，断言：**正例全 `conform`；反例全 non-conform 且命中文档声称的 `rule`**。堵「文档说合法但校验器拒 / 文档说非法但校验器放」两向漂移。
**Files**：
- 新建 `test/schema-1-ai-doc-conformance.test.js`
- 新建 `test/fixtures/ai-doc/ok/*.html`（正例）、`test/fixtures/ai-doc/bad/*.html`（反例，文件名或旁注带期望 rule）
- 复用 `src/lib/schema-validate.js`
**Patterns to follow**：`test/doc-templates.test.js`（遍历 fixtures → jsdom → validate → 断言 conform）。
**Execution note**：test-first —— fixtures + 断言先写，逼 U2 文档的每条规则都有对应例子。断言用「violations **含**期望 rule」（`some`），别用「恰一条 / 唯一 rule」（一个反例可命中多条，如 body 内 script 同时命中 `script`+`block-tag`）。
**Test scenarios**：
- 每个 canonical 块正例（顶层块：p/h1-4/ul/ol/blockquote/callout/table/img/figure；+ todo/子列表/thead）→ `conform:true`。
- **反例必须覆盖校验器全部 rule**（当前 20 条 + U0 的 `details-summary`/`details-summary-content`），各至少一个 fixture、`conform:false` 且含期望 rule：`script` / `event-attr` / `unsafe-href` / `nested-block`（用 `<blockquote><ul><li>x</li></ul></blockquote>`，**不用 p 嵌 div**）/ `list-child` / `todo-checked` / `li-content` / `table-merge` / `cell-content` / `table-structure` / `table-ragged` / `figure-content` / `figcaption-content` / `block-style` / `block-tag`(h5) / `head-meta-http-equiv` / `head-style`(无标记作者 style) / `head-base` / `head-link` / `head-tag`。
- **元测试（防漏钉）**：断言「所有 bad fixtures 实际命中的 rule 集合 ⊇ 校验器源码里出现的 rule 全集」——校验器新增一条 rule 而没补 fixture 就红。这是「清单完整」的自动门，不靠人肉核对。
- **toggle（U0 后 gate-backed）**：U0 给校验器补了 `validateDetails`，toggle 跟别的块一样有反例门——坏 toggle（无 summary / 多 summary / summary 非首子 → `details-summary`；summary 内塞块 → `details-summary-content`）断言被拒；正例（含 open、正文嵌块）→ conform。
**Verification**：`node --test test/schema-1-ai-doc-conformance.test.js` 全绿（含元测试）。改文档规则 / 校验器加 rule → 必须同步改 fixture，否则红（这就是防漂移的门）。

### U4 — 真 AI 生成实证（裁判≠运动员 / 教训要实证）
**Goal**：用真 AI（Claude subagent）读 U2 文档、按 N≥8 条真实提示生成 `.html`，跑 U1 校验器量**一次命中合规率**，把典型 violations 回喂改进 U2 文档，产出实证报告。这是 R6 的落地：**不追求 AI 100% 合规，但要量出命中率、并证明校验门真拦得住非法产出**。
**Files**（可复现取证，对标本仓 audit-v2 两段式：固定输入 + 落盘产物 + 复现命令，见 [[ui-demo-audit-v2]]）：
- 新建 `test/fixtures/ai-doc/prompts/*.md`（N≥8 条提示**写死进 repo、可 diff**，覆盖多块型：周报 / 三列价格表 / 带 callout+todo 的方案 / 引用+多级标题 / 带图 figure …）
- 新建 `test/fixtures/ai-doc/generated/<promptId>.html`（AI 产出落盘目录，让 U1 能批量重跑核对）
- 新建 `docs/schema-1-ai-generation-eval.md`（报告：命中率 + top 失败 rule + 对 U2 的修订记录）
- 用 U1 `scripts/validate-schema.js`
**编排机制（plan 替执行者定，别现场拍）**：本轮 **人工驱动**——逐条提示手动开 Claude subagent、把 U2 整份塞进上下文、产出写到 `generated/<promptId>.html`、跑 `node scripts/validate-schema.js` 收结果。⚠ 避开 audit-v2 记的坑：agent cwd=共享 worktree 会规整路径、args 投递不稳（见 [[ui-demo-audit-v2]]）——所以走「文件进 / 文件出」不靠 args。要不要升级成正式 Workflow 留 U4 后（本轮先证明回路，不做编排）。
**命中率语义（诚实标注适用边界）**：本命中率在「agent 上下文**只含 U2 文档**」的受控条件下测得 = **上界**；真实分发场景（用户混合指令、上下文被占）预期更低。报告须写明这一条；有余力则加一组「文档前后各塞一段无关用户指令」的对照，同时给「干净命中率」和「近似真实命中率」。
**止损（防 U4 膨胀）**：**最多跑 2 轮闭环**（初始 + 一轮改文档后复测），无论命中率多少即收；报告记观测值 + top 失败 rule + 修订点。后续文档迭代在独立 PR 做，不在本 plan 范围（阈值是观测值、不设硬达标线——R6 由校验门兜底、不追求 AI 完美）。
**Test scenarios**：逐篇记录 conform/violations（落盘可重跑）；聚合命中率（标注是上界）；列 top 3 失败 rule + 各自在文档中的位置（前/中/后段——失败偏后段先试「精简/前移约束」而非「加更多说明」，避免越补越长反噬）。
**Verification**：报告存在且**附提示集文件 + 产出 .html + 逐篇 U1 输出**（命中率可被别人重跑核实）；2 轮闭环跑完；U2 据实证至少改过一轮。**注**：「校验门拦得住非法产出」的证明是 **U3 反例 fixtures 的确定性职责，不依赖 U4 真 AI 恰好犯错**（解耦：若 U4 那批碰巧全合规也不影响门已被 U3 证明）。

## 顺序 / 依赖

```
U0（校验器补 toggle 校验, test-first）─┐  U1（校验 CLI 门, test-first）─┐
   （先于 U2/U3 的 toggle 部分）        │     （与 U0 可并行）          │
                                       └──────────┬───────────────────┘
                                                  ▼
        U2（创作文档, 派生自校验器）  ← 起草可与 U0/U1 并行, 验证依赖 U1/U3
                                                  ▼
        U3（文档↔校验器一致性, test-first）  ← 需要 U0（toggle 门）+ U1 + U2 的正反例
                                                  ▼
        U4（真 AI 实证）  ← 需要 U1 门 + U2 文档
```
建议：U0（校验器补 toggle）+ U1（CLI 门）+ U2（起草）并行起 → U3 把文档与校验器钉死 → U4 拿真 AI 压。每个单元绿了 commit（注 U 号），worktree = `feat/schema-1`（与 schema 其他工作同分支）或另开短命 `feat/schema-ai-doc` 分支，独立合 main。

## 风险 & 依赖

- **jsdom 解析 ≠ Chromium 解析（且 app 侧校验入口现在压根不存在）**：实测（doc-review）——除 `schema-validate.js` 自身外只有 `test/` 调它，`src/renderer`/preload/任何 app 运行时**都没接校验器**（R3「文件进入即校验分流」是 feature 1/3 的活、尚未落地）。所以 U4 命中率是 **jsdom 回路侧的唯一真值、没有 app 侧数字可对照**。风险不是「两路不一致已被兜住」，而是：**未来 app 用 Chromium reparse 接入校验时，回路侧验过合规的文档可能在 app 侧被判不合规、U4 的绿届时≠app 绿**。收口 = 把「同一批 fixtures 跑一遍 Chromium DOM 做等价性回归」列成对 **feature 1/3 的显式交接项**（本 plan 不做，只记账）。
- **校验器是 v1、Schema #1 §7 仍有 open bug**：U2 描述的是「校验器当前」规则，不是「Schema 理想终态」。校验器演进（closed-editor plan）→ U2 + U3 fixtures 跟着改（U3 逼同步，是特性不是负担）。
- **AI 命中率未知**：U4 前不知道一次命中率多高。若很低，说明 U2 文档还不够（这正是 U4 要暴露并迭代的），不是 blocker——校验门（U1）保证「低命中率也不会有非法文档溜进合规编辑」。
- **依赖**：`src/lib/schema-validate.js` / `schema-model.js`（已在 `feat/schema-1`）、jsdom（已装）。无新外部依赖。

## Scope Boundaries（非目标）

- ❌ **in-app AI UI**（ui-demo 的 `AiSoonModal` / Ask AI / 斜杠 `/ai` / 右下角 Agent 面板）——origin 划为「后续阶段」，本 plan 一律不碰。
- ❌ **MCP / 校验器-as-tool**——origin R7 MVP 明确不上。
- ❌ **自动多轮修复回路 / 生成编排机器人**——只定 violations 回喂的人读约定 + U1 单步校验工具。
- ⚠ **校验器**：本 plan **会按需补校验器**让 schema 规则有门兜（本轮 = toggle 内部校验，U0；KD-e）——校验器与 schema aligned、一体演进。但 Schema #1 §7 更大的 bug 收口（A/F/C 档编辑器操作 / 存盘保真）仍归 closed-editor plan，不在此。
- ❌ **不动 ui-demo（React/Vite）**——本 feature 是文档 + node 工具产物。

## Deferred to Implementation（执行时定）

- U2 文档的**分节粒度与措辞**（速查表用表格还是逐块小节；给 AI 的语气模板）——起草时按「AI 好读、例子够密」定。
- U4 的**提示集具体文案**——执行时按覆盖块型的原则拟（提示的**存在与落盘**已在 U4 定死，只文案待写）；合规率阈值不预设硬数字、记观测值（R6 不追求 100%）。
- 是否把 U2 文档**顺手包一层 SKILL.md**（薄封装、指向同一份 markdown）——留到 U4 见实证效果后再定，不阻塞主线（也是「把硬约束提到最前」的候选手段之一）。
- **文档分发形态**（KD-f）：MVP 默认「人工喂」，Colin 可改成可分享 prompt/link 或自动注入——不阻塞 U1–U4。
