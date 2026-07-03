# 设计：Wordspace Skills 体系（多 Schema / 多 Template 时代的框架）

> 上游：`docs/design/2026-07-02-ai-prompt-skill-distribution.md`（单 schema 的分发怎么做——prompt=正本逐字节、
> skills 生态、wordspace-ai org、防漂移）。本文回答 Colin 2026-07-03 的上层问题：**将来有很多个 Schema、
> 很多个 Template 时，Skills 怎么组织——要几个、各管什么、怎么包含、怎么持久化。**

## 结论先行

**一个入口 Skill（`wordspace`），内部按 Schema 分层横向扩，永远不按"每 Schema 一个 Skill"纵向裂。**

```
skills/wordspace/                      ← 用户只装这一个：npx skills add wordspace-ai/skills
├── SKILL.md                           ← 路由薄壳：任务类型 → Schema 识别 → 指到 reference；硬底线摘要
└── references/
    ├── schema-1.md                    ← Schema #1 指南（docs/ 正本的逐字节拷贝，防漂移测试锁）
    ├── schema-1-templates.md          ← （未来）Schema #1 装饰模板的合法用法，一模板一节
    ├── schema-2.md                    ← （未来）新范式 = 加一个文件 + SKILL.md 路由表加一行
    └── …
```

## 为什么是一个 Skill

- **用户视角**：「让你的 AI 会写 Wordspace 文档」是一个能力，不是每个范式一个能力。装一次、
  `npx skills update` 拉新，新 schema/template 自动获得——用户不需要知道我们又出了什么。
- **判断归属不该推给用户**：「这个文件属于哪个 schema」正是 AI（读 meta）和校验器（判结构）的活。
  多个 skill 意味着用户要先自己判断装哪个/用哪个——把系统该干的事变成了用户的功课。
- **Skill 的渐进披露机制天然支持**：SKILL.md 常驻上下文的只有薄壳（触发词 + 路由 + 硬底线），
  reference 按需读。references/ 下加 100 个文件也不膨胀会话——「怎么包含」的答案就是它。
- **版本/分发只有一条链**：一个 skill = 一个版本号 = 一条镜像管道 = 一条更新命令。

## Schema 识别协议（路由的核心）

- **生成**：SKILL.md 的 Schema 表就是菜单。目前只有 #1，默认之；多范式后由用户意图/指定选行。
- **编辑**：认文件 `<head>` 的 `<meta name="wordspace-schema" content="N">` 选规范
  （指南本就要求生成时写这个 meta，闭环自洽）；没有 meta → 按 #1 处理。
- **安全边界不变**：meta 只用于 AI 选参考文档。校验器判合规**永远不信 meta、只看真实结构**
  （§4.3 铁律），AI 选错了规范也有门兜底——「改不出错 = 校验器把门」的架构在多 schema 下原样成立
  （schema-registry 已按 detect/validate 注册制预留）。

## Template 怎么进 Skill

按 §0 决策：Schema=结构+最小语义 CSS，Template=装饰。对 AI 而言：

- **装饰模板**（未来）：每 schema 一份 `references/schema-N-templates.md`，教「模板 X 提供哪些类/
  结构、怎么合法使用」。模板多了拆成目录（一模板一文件），SKILL.md 不变。
- **内容模板**（会议纪要/周计划那种骨架）：**不进 skill**。AI 自己会生成内容，不需要骨架；
  内容模板是 app 内「新建文档」的功能（`src/lib/doc-templates.js`），两者受众不同。

## 要几个 Skill（现在与未来）

| 阶段 | Skill 数 | 说明 |
|---|---|---|
| 现在 | **1**（`wordspace`） | 生成 + 编辑，Schema #1 |
| 新增 schema/template | 仍是 1 | 加 reference + 路由表加行，版本号 bump |
| 应用内 AI / AI 自检 | 1 + **MCP** | 校验器暴露给 AI = 工具（MCP），不是知识（skill）。feature 卡已拍 MVP 不上 MCP |
| 极端情况 | 才考虑拆第 2 个 | 唯一拆分理由：某新范式（如自由画布）与文档流**毫无共享内容**且指南体量巨大。默认不拆（YAGNI） |

## 持久化 / 版本 / 发布管道

- **真相源**：`docs/schema-1-ai-authoring.md`（主仓，`schema-1-ai-doc-conformance` 测试绑着校验器）。
  每个 schema 的指南将来同样：`docs/schema-N-ai-authoring.md` 为正本。
- **拷贝锁**：`test/skill-guide-sync.test.js` 锁「正本 ↔ skill reference ↔ ui-demo prompt」逐字节一致。
  新 schema 加进来 = 在该测试里逐对加行。同步方式永远是 `cp` 覆盖，不做内容变体。
- **发布仓**：`wordspace-ai/skills`（公开）。由 `.github/workflows/skills-mirror.yml` 自动镜像——
  main 上 `skills/**` 变更即整体覆盖推送（org 仓永远只是发布端、不手改）。
  前置一次性动作（Colin）：建 org `wordspace-ai` + 空仓 `skills` + 配 secret `SKILLS_MIRROR_TOKEN`
  （fine-grained PAT，contents r/w）。secret 未配时 workflow 静默跳过、不红。
- **版本**：SKILL.md frontmatter `version`（semver）。内容更新流程 =
  改 docs/ 正本 → `cp` 同步拷贝 → bump version → 测试锁全绿 → 合 main → Action 自动发布 →
  用户 `npx skills update`（或重跑 add）。
- **用户安装（instruct 用户的三个面）**：
  1. 主命令 `npx skills add wordspace-ai/skills`（skills 生态标准，Claude Code / Cursor 等 70+ agent）；
  2. 手动兜底：把 `skills/wordspace/` 拷进 `~/.claude/skills/`；
  3. 入口面：ui-demo「AI 接入」页（已上线）→ 真 app「帮助 → AI 接入」（待 UI 轮）→ 官网（形态 c，Colin 暂缓）。

## 命名的稳定性承诺

skill 目录/名字 `wordspace` 是**对外契约**（用户已安装的 skill 按名更新），发布后不再改名。
schema-1 专名时代的 `schema-1-authoring` 在发布前（2026-07-03）已更名，无存量用户。
reference 文件名（`schema-1.md`）是 skill 内部实现，可随版本变。

## 不做（边界，与上游文档一致）

- 不做 per-schema 独立 skill、不做 skill 内置校验器（jsdom 太重）、不做 violations 回喂编排（MVP 外）。
- MCP 工具化留到应用内 AI 阶段，与本框架正交（skill=知识，MCP=能力，互不替代）。
