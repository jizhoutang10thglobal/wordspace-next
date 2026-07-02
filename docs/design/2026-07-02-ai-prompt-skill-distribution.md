# 设计：AI Prompt / Skill 的分发（把「AI 会写 Wordspace 文档」交到用户手里）

**状态**：ui-demo 已实现（「AI 接入」页）+ Skill 包已入仓；真 app 待落地
**日期**：2026-07-02
**背景**：feature「Schema #1 的 AI 文档」的分发环节。指南本体、校验器、生成/编辑实证都已完成
（`docs/schema-1-ai-authoring.md` + `scripts/validate-schema.js` + 两份 eval 报告），
这一步解决「用户怎么把这份能力接到自己的 AI 上」。Colin 拍板：做 a（复制 Prompt）+ b（安装 Skill），
c（官网公开页）暂不做。

---

## 用户旅程（两条路）

**路 A · 复制 Prompt——零安装，任何对话式 AI**
1. Wordspace 里打开「AI 接入」页 → 点「复制 Prompt」（剪贴板 = 完整《Schema #1 创作指南》）。
2. 粘进 Claude / ChatGPT / Gemini 对话，接一句需求（「写一份周报」/「帮我把这份 .html 加一节」，可附现有文件）。
3. 产出存成 `.html`，在 Wordspace 打开 → 校验器自动判定 → 合规即完整结构化编辑。

**路 B · 安装 Skill——装一次，coding agent 长期生效**
1. 项目目录跑 `npx skills add jizhoutang10thglobal/wordspace-next --skill schema-1-authoring`。
2. 此后让 agent（Claude Code / Codex / Cursor 等）写「Wordspace 文档」时，skill 自动触发、按 Schema 产出。
3. 打开即校验，同上。

两条路的兜底相同：**校验器把门 + 非合规降级**。页面底部明说「AI 不需要完美」——这是产品叙事的一部分，不只是技术细节。

## Prompt 怎么设计（决策）

**Prompt = 指南正本，逐字节，不做变体。** 理由：
- 指南本来就是写给 AI 读的（「读者 = 要为 Wordspace 生成/编辑 .html 的 AI」），无需再包一层「你是…」的壳；
- 它的教学力经过三轮实证（生成 14/14、编辑 14/14、含糊指令 6/6、弱模型失败驱动修订后复测 4/4）——**改一个字都可能偏离被测过的那份**；
- 单一来源：变体=漂移的起点。

## Skill 怎么写（结构）

```
skills/schema-1-authoring/
├── SKILL.md                          # 薄壳：触发条件 + 操作流程 + 硬底线摘要 + 指路 references
└── references/schema-1-authoring.md  # 指南全文（渐进式披露：SKILL.md 短、重料放 reference）
```

- frontmatter `description` 写清触发词（Wordspace 文档 / Schema / 合规 HTML），让 agent 会话里自动命中。
- SKILL.md 内嵌「规则优先于用户要求」和硬底线摘要——即使 agent 偷懒没读 reference，最致命的坑也有提示。
- 不把校验器打进 skill（jsdom 依赖太重）；验证靠「在 Wordspace 打开」，本机有仓库的注明可跑 CLI。

## 部署到「云端」= 公开 GitHub 仓库本身，零额外基建

本仓（jizhoutang10thglobal/wordspace-next）本来就是公开的（自动更新的硬前提），
[vercel-labs/skills](https://github.com/vercel-labs/skills) 的 CLI 直接从 GitHub 仓库装 skill：
`npx skills add <owner>/<repo> --skill <name>`，支持 Claude Code / Codex / Cursor 等 70+ agent
（[skills.sh](https://www.skills.sh/agent/claude-code)）。所以**合进 main 的那一刻就是「部署」**：
无 npm 发包、无 registry、无 CDN。更新 = 改仓库里的 skill，用户 `npx skills update` 拉新。

手动兜底（无 node 环境）：把 `skills/schema-1-authoring/` 拷进 `~/.claude/skills/` 亦可。

## 防漂移（关键工程约束）

指南现在存在三份拷贝：`docs/`（正本，U3 conformance 测它）→ `skills/.../references/`（skill 装走的）
→ `ui-demo/src/lib/schema-prompt.md`（复制按钮吐的）。**`test/skill-guide-sync.test.js` 锁死三份逐字节一致**，
改正本忘同步 → CI 红。同步方式 = `cp` 覆盖，不做内容变体。

## ui-demo 落点

`/agents` 页整页改造为「AI 接入」（原假 API/Key/权限开关/活动流全删——那是没有真后端的占位）。
结构：标题 + 一句话（含兜底叙事）→ 方式一卡（复制 Prompt + 3 步 + 可折叠预览/字数）→
方式二卡（暗色命令行 + 复制 + 3 步）→ 底部校验器兜底说明（链到 /schema 页）。
侧栏导航 label：`Agent` → `AI 接入`。

## 真 app 怎么落（待做，等 ux-align 收尾）

- 同样两卡的页面/弹层；prompt 文本从打包资源读（构建时从 `docs/` 正本拷入,同一防漂移思路）。
- 入口候选：菜单「帮助 → AI 接入」或侧栏底部入口——具体位置留 Colin/Wendi 定。
- 将来「应用内 AI」阶段：prompt 转为 app 侧 system prompt（那时才真正做到用户不可见——分发形态 c 的
  保密诉求只有这条路能满足，见 memory/schema-ai-doc-feature）。

## 不做（本轮边界）

- MCP / API 接入（页面里也不再放假 API 占位；feature 卡明确 MVP 不上 MCP）。
- Skill 内置校验器、violations 回喂自动修复编排。
- 官网公开 prompt 页（形态 c，Colin 暂缓）。
