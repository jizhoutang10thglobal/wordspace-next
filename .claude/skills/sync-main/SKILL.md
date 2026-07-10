---
name: sync-main
description: 在任何 worktree/feature 分支的 session 里同步 main 的全局更新——fetch origin/main，汇报新 commit、team-memory 公告、CLAUDE.md 变更和冲突预警，并判断哪些与本 session 的 feature 相关。用户说「同步一下 main」「看看 main 有什么新东西」时触发；session 冷启动、长 session 隔段时间、开始一块新改动之前也应该主动跑。
---

# sync-main — 消化 main 的全局增量

你在一个并行开发的 worktree 里。main 上可能有其他 session 合入的全局规则变更、
team-memory 公告、以及会和本分支冲突的代码改动。这个 skill 的任务：把这些增量拉下来、
读懂、按重要性分层汇报给当前 session。**本 skill 只读，不改任何东西。**

## 步骤

1. **Fetch**：`git fetch origin main`。失败（断网等）就明说「以下基于本地旧的 origin/main，
   可能过期」，不要拿旧数据冒充最新。

2. **算增量范围**：
   ```bash
   BASE=$(git merge-base HEAD origin/main)
   git log --oneline --no-merges $BASE..origin/main
   ```
   main 领先很多（比如 30+ commit）本身就值得汇报——说明该 rebase 了。

3. **读全局知识增量**（这是重点，逐字读，别只看 stat）：
   ```bash
   git diff $BASE..origin/main -- docs/team-memory.md CLAUDE.md docs/README.md .claude/skills/
   ```
   team-memory 的新条目全文读；CLAUDE.md 的新规则/教训全文读。

4. **冲突预警**：本分支改动文件与 main 改动文件求交集：
   ```bash
   comm -12 <(git diff --name-only $BASE..origin/main | sort) <(git diff --name-only $BASE..HEAD | sort)
   ```

5. **判断相关性**：结合当前分支在做的 feature（分支名、最近 commit、对话上下文），
   判断每条增量跟本 session 的关系。

## 输出格式

三层，空层省略：

- **必须行动**：规则/门变了且影响本分支的做法；team-memory 里点名要各 session apply 的公告；
  冲突预警有交集（附文件清单，建议 rebase——记住本仓教训：**PR CI 跑的是 merge commit
  （分支+最新 main），本地绿≠CI 绿，信绿之前先 rebase**）。
- **与本 feature 相关**：main 上动了本 feature 相邻的代码/文档，值得知道但不阻塞。
- **FYI**：其余全局动态，一句话一条。

## 铁律

- 只读。不 rebase、不 merge、不改文件——报告完把「要不要 rebase」的决定留给 session/用户。
- 别吞公告：team-memory 新条目哪怕判断为不相关，也至少在 FYI 层列出标题。
