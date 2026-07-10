---
name: remember-global
description: 把当前 session 发现的全局教训/规则变更/拍板决策写进 main 上的 docs/team-memory.md，让其他 session 通过 /sync-main 看到。用户说「这个点让所有 session 知道」「记到全局」「广播一下」时触发；session 自己做出影响全局的改动（改门、改流程、定新规则）后也应该主动提议落账。从任何 worktree/分支都能用，不动当前分支。
---

# remember-global — 向所有 session 广播一条全局知识

跨 session 的唯一知识 channel 是 git 上的 `docs/team-memory.md`（auto-memory 按路径隔离，
跨不了 worktree）。这个 skill 把一条公告直接 commit 到 main 上的这个文件——
**这是唯一允许直推 main 的改动**，除此之外一个字都不许动。

## 步骤

1. **写条目**。格式（新条目插在 team-memory 的 `<!-- 新条目插在这行下面 -->` 标记行之后，倒序）：

   ```markdown
   ## YYYY-MM-DD — <一句话标题>

   **是什么**：<发生了什么变化 / 学到了什么>
   **怎么 apply**：<其他 session 拿到这条后具体该做什么>
   **来源**：<分支 / PR / 需求文档>
   ```

   质量标准：写「为什么 + 怎么 apply」，别只写「改了 X」。收录标准：会影响其他 session 的才写；
   只对本 feature 有效的知识不写。日期用 `date +%Y-%m-%d` 取，别凭感觉写。

2. **给用户过目**：把拟好的条目展示一遍再推。用户已经把内容说得很明确、或明确说过不用确认的，跳过。

3. **落账**（经临时 worktree 直推 main，不动当前分支）：

   ```bash
   git fetch origin main
   TMPWT=$(mktemp -d)/team-memory
   git worktree add "$TMPWT" origin/main --detach
   # 编辑 $TMPWT/docs/team-memory.md：条目插进标记行之后
   git -C "$TMPWT" add docs/team-memory.md
   git -C "$TMPWT" commit -m "docs(team-memory): <标题>"
   git -C "$TMPWT" push origin HEAD:main
   git worktree remove "$TMPWT" --force
   ```

4. **并发冲突**：push 被拒（non-fast-forward，别的 session 刚推过）就在临时 worktree 里
   `git pull --rebase origin main` 后重推，重试一次；再失败就报告用户。
   无论成败，临时 worktree 都要清掉。

## 铁律

- 只许动 `docs/team-memory.md` 这一个文件。commit 里混进任何其他文件都是事故。
- 直推 main 的特权仅限本 skill 的这条路径（Colin 拍板 2026-07-10）；代码、其他文档照走 PR。
- 硬规则沉淀进 CLAUDE.md 走正常 PR，不走本 skill。
