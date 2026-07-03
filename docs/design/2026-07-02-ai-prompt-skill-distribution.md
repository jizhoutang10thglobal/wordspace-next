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

> ⚠ 2026-07-03 更新：布局已按多 Schema 框架重构成 `skills/wordspace/`（单入口 skill + 按 schema
> 分层的 references），本节的旧布局仅存档。现行设计见 `docs/design/2026-07-03-skills-framework.md`。

```
skills/wordspace/
├── SKILL.md                  # 路由薄壳：任务类型 → Schema 识别 → 指到 reference + 硬底线摘要
└── references/schema-1.md    # Schema #1 指南全文（渐进式披露：SKILL.md 短、重料放 reference）
```

- frontmatter `description` 写清触发词（Wordspace 文档 / Schema / 合规 HTML），让 agent 会话里自动命中。
- SKILL.md 内嵌「规则优先于用户要求」和硬底线摘要——即使 agent 偷懒没读 reference，最致命的坑也有提示。
- 不把校验器打进 skill（jsdom 依赖太重）；验证靠「在 Wordspace 打开」，本机有仓库的注明可跑 CLI。

## 部署与品牌绑定（Colin 要求：命令别露个人账号名，尽量跟 wordspace.ai 绑定）

**CLI 能力实测（vercel-labs/skills README）**：`npx skills add` 接受 GitHub `owner/repo` 简写、
GitHub/GitLab 完整 URL（可指到子目录）、任意 git URL、本地路径。**不支持任意 https 自定义域名**——
除非该域名跑一个可 clone 的 git 服务（Vercel 静态站做不到）。所以「命令里出现 wordspace.ai 域名」
在 skills 生态标准内不可行，可行的品牌化路径按优先级：

1. **✦ 主方案：GitHub org `wordspace-ai`（已查证可注册；`wordspace` 被占）。**
   Colin 建 org（免费、几分钟）→ 建 `wordspace-ai/skills` 仓库 → 把 `skills/schema-1-authoring/`
   镜像过去 → 命令即 **`npx skills add wordspace-ai/skills`**。生态标准（70+ agent 通用）、
   品牌绑定、零基建。主仓 `skills/` 目录保留为开发真相源，org 仓由同步（手动 cp 或 Action）跟随。
   ui-demo 页面已按此目标态展示命令。**待办：Colin 建 org + 我初始化 skills 仓。**
2. **备选：官网 curl 安装（域名 100% 露出，立即可做）。**
   `website/` 就在本仓、部署在 wordspace.ai——把 skill 文件 + install.sh 放进 `website/public/skills/`，
   命令 = `curl -fsSL https://wordspace.ai/skills/install.sh | sh`（下载进 `~/.claude/skills/`）。
   缺点：绕开 skills 生态（只装 Claude Code 一家）、curl|sh 观感。可作为官网「AI 接入」页的补充路径。
3. **不推荐：自发 npm 包**（`npx wordspace-skills`）——要维护自己的安装器、丢生态多 agent 支持。

无论哪条路，**「云端」都是零额外基建**：GitHub 公开仓库 / 既有官网就是分发端。更新 = 改仓库，
用户 `npx skills update` 拉新。手动兜底：把 skill 目录拷进 `~/.claude/skills/`。

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
