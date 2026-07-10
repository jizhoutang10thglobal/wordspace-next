---
date: 2026-07-10
topic: session-alignment-system
---

# 跨 session 对齐体系 —— 需求文档

## Summary

两个 git 追踪的 artifact（`docs/team-memory.md` 跨 session 公告板、`docs/features/` 每 feature 一份对齐 spec）加三个薄 skill（`sync-main` / `remember-global` / `align-feature`），解决多 worktree 并行开发的两个对齐问题：全局知识传不到各 session、ui-demo 与真 app 漂移。

---

## Problem Frame

本仓常态是 10+ 个 worktree、各挂一个 AI session 并行开发。session 之间没有任何直接沟通渠道，且 Claude Code 的 auto-memory 按文件夹路径隔离——实证：`~/.claude/projects/` 下主仓和 board worktree 各有独立 memory 目录，其余 worktree 根本没有。于是「全局更新」（最近一例：e2e 门精简）的传播方式是 Colin 人肉给每个 session 发 prompt 让它们检索并 apply，而更新本身的落点还不稳定（有时在 memory、有时只在对话里），Colin 自己也会忘记记在哪。

第二个问题来自开发流程本身：feature 先在 ui-demo 定稿 UI/UX/交互，满意后移植进真 app（`src/`）。但 app 上线后用户实测反馈会导致直接改 app，回流 ui-demo 纯靠人工指挥，漂移账本只存在于 Colin 脑子里。让移植 session「去看 ui-demo 的界面」对不准；读代码虽然准，但代码只说「是什么」，不说交互意图和「哪些差异是拍过板的有意分歧」。

---

## Key Decisions

- **git 是唯一可靠的跨 worktree channel；artifact 优先，skill 是薄壳。** 纯 skill 方案每次调用现场挖状态，又贵又容易漏；跨 worktree 同步原生 auto-memory 被平台的路径隔离堵死，不值得绕。
- **team-memory 独立于 CLAUDE.md，不自动进上下文。** CLAUDE.md 每个 session 无差别烧上下文，只留蒸馏后的硬规则；team-memory 是时效性公告，靠 `/sync-main` 按需读。升格路径：公告先进 team-memory，沉淀为硬规则的再进 CLAUDE.md。
- **`remember-global` 直接 commit 到 main、不走 PR，且仅限 `docs/team-memory.md` 一个文件。** main 无 branch protection、纯 docs 改动，低摩擦优先（Colin 拍板 2026-07-10）。其他一切改动照走 PR。
- **三个对齐 skill 收敛成一个 `align-feature`。** audit 报告是 port 的前半段，两个方向的 port 共享同一份 spec 与锚点，拆成三个 skill 要维护三份重复逻辑。
- **对齐靠 spec 文档，不靠视觉参照。** spec 承载代码表达不了的两样东西：交互意图、有意分歧清单。`docs/browser-feature-spec.md` 是这个模式已验证的先例。
- **漂移在产生时进账本，不等审计发现。** 制度规则：谁直接改真 app 的 UI/交互，谁在同一个 PR 里更新对应 spec 或记欠账。

---

## Requirements

**全局知识同步**

- R1. `docs/team-memory.md` 作为跨 session 公告板：git 追踪，条目格式为日期 + 标题 + 是什么 + 怎么 apply + 来源（分支/PR），新条目倒序插在标记行下方；文件头部说明读写方式与收录标准（影响其他 session 的才写，feature 私有知识不写）。
- R2. `sync-main` skill：任意 worktree/分支可调。fetch origin/main 后汇报三类增量——main 新 commit、`docs/team-memory.md` 与 `CLAUDE.md` 的内容增量、本分支改动文件与 main 改动文件的交集（冲突预警）——并按「必须行动 / 与本 feature 相关 / FYI」分层输出，空层省略。只读；不自动 rebase，有交集时建议 rebase。
- R3. `remember-global` skill：任意 worktree/分支可调，把一条公告写进 main 上的 team-memory 而不动当前分支（经临时 main worktree 提交并推送）；遇并发推送冲突自动 rebase 重试一次；除 `docs/team-memory.md` 外不得改任何文件。

**ui-demo ↔ 真 app 对齐**

- R4. `docs/features/<slug>.md` 每 feature 一份对齐 spec，必含四段：行为契约（用户可感知的一切，写行为不写实现）、文件映射（ui-demo 侧 ↔ app 侧）、有意分歧清单（含拍板人与日期）、双侧对齐锚点 commit。模板与建档时机写在 `docs/features/README.md`。
- R5. `align-feature` skill：audit 模式从双侧锚点起各自 `git log` 映射文件，产出漂移报告——不在有意分歧清单里的行为差异即漂移；port 模式先 audit 再按指定方向移植行为（尊重两侧架构差异，抄行为不抄代码），并在同一 PR 内更新锚点与分歧清单；目标 feature 无 spec 时先从参考实现（默认 ui-demo）生成 spec。
- R6. 权限边界：audit 只读；port 改代码必须走分支 + PR；spec 锚点只在一次对齐完成（port 合并）时更新。

**制度与分发**

- R7. 三个 skill 放仓库 `.claude/skills/`（git 追踪），worktree session 随分支自动获得；CLAUDE.md 增加制度段：team-memory 的读写入口 + 「直改 app UI/交互者同 PR 更新 spec 或记欠账」规则。
- R8. `docs/README.md` 文档地图登记 `team-memory.md` 与 `features/`。

---

## Key Flows

- F1. 广播全局更新
  - **Trigger:** 某 session 做出影响全局的改动（如精简 e2e 门）。
  - **Steps:** 该 session 调 `/remember-global` → 条目落到 main 的 team-memory → 其他 session 调 `/sync-main` → 条目出现在「必须行动」层 → 各自 apply。
  - **Covers:** R1, R2, R3
- F2. app 实测修复回流
  - **Trigger:** 用户反馈导致某 session 直接改真 app 的交互。
  - **Steps:** 制度要求同 PR 更新对应 spec 或记欠账 → 之后任一 session 对该 feature 跑 `/align-feature` audit → 欠账/漂移出现在报告 → 择机 port 回 ui-demo。
  - **Covers:** R4, R5, R7
- F3. 新 feature 移植
  - **Trigger:** feature 在 ui-demo 定稿，准备进真 app。
  - **Steps:** `/align-feature` port（demo→app）→ 无 spec 则先从 ui-demo 实现生成 → 移植 → 合并时写入双侧锚点。
  - **Covers:** R4, R5, R6

---

## Acceptance Examples

- AE1. **Covers R2.** Given main 合入了动 `src/renderer/tabs.js` 的 PR，且本分支也改了这个文件，When 调 `/sync-main`，Then 冲突预警列出该文件、建议先 rebase（引用「PR CI 跑 merge commit，本地绿≠CI 绿」教训），且 skill 不自行执行 rebase。
- AE2. **Covers R5.** Given app 侧锚点之后有一个交互改动、不在有意分歧清单、ui-demo 侧无等价改动，When audit，Then 报告将其列为漂移并建议 port 方向；Given 同一改动已在有意分歧清单，Then 不列为漂移。

---

## Scope Boundaries

- 自动化推送层（SessionStart hook 自动注入 main 增量、PR 层检查 spec 是否更新）：等体系人工跑顺后再加。
- 跨 worktree 同步 Claude 原生 auto-memory：平台按路径隔离，放弃。
- 老 feature 的 spec 一次性回填：不做；已上线 feature 等下次被碰到时按需补。
- `docs/browser-feature-spec.md` 迁移进 `docs/features/`：不迁，留原位作先例；新 spec 一律进 `docs/features/`。

---

## Dependencies / Assumptions

- main 无 branch protection、本机凭证可直推 main——`remember-global` 依赖此现状；一旦 main 上 protection，需改走自动合并的 PR。
- skill 到达存量 feature 分支需要 rebase（或等下个从 main 新切的分支）；存量 session 短期内仍需一句人肉 prompt 引导（可以就是「跑一下 /sync-main」）。
- `sync-main` 与 `remember-global` 依赖能连通 origin；断网时 skill 需明示数据可能过期，不得拿本地旧 `origin/main` 冒充最新。
