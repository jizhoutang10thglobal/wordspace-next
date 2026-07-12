---
name: remember-global
description: 把当前 session 发现的全局教训/规则变更/拍板决策写进 main 上的 docs/team-memory.md，让其他 session 通过 /sync-main 看到。用户说「这个点让所有 session 知道」「记到全局」「广播一下」时触发；session 自己做出影响全局的改动（改门、改流程、定新规则）后也应该主动提议落账。从任何 worktree/分支都能用，不动当前分支。
---

# remember-global — 向所有 session 广播一条全局知识

跨 session 的唯一知识 channel 是 git 上的 `docs/team-memory.md`（auto-memory 按路径隔离，
跨不了 worktree）。这个 skill 把一条公告经「短命分支 + PR + auto-merge」落到 main——
**不直推 main**（branch protection 的 must-PR + required checks 对管理员也生效，直推必被 GH006 拒，
2026-07-10 实测；Colin 2026-07-11 拍板保留门、走 auto-merge，仓库已开 Allow auto-merge）。

## 步骤

1. **写条目**。格式（新条目插在 team-memory 的「新条目插在这行下面」标记行之后，倒序；
   标记行有中文括号后缀，**用前缀匹配**别全字匹配——曾实测全字匹配漏插、静默空 commit）：

   ```markdown
   ## YYYY-MM-DD — <一句话标题>

   **是什么**：<发生了什么变化 / 学到了什么>
   **怎么 apply**：<其他 session 拿到这条后具体该做什么>
   **来源**：<分支 / PR / 需求文档>
   ```

   质量标准：写「为什么 + 怎么 apply」，别只写「改了 X」。收录标准：会影响其他 session 的才写；
   只对本 feature 有效的知识不写。日期用 `date +%Y-%m-%d` 取，别凭感觉写。

2. **给用户过目**：把拟好的条目展示一遍再推。用户已经把内容说得很明确、或明确说过不用确认的，跳过。

3. **落账**（临时 worktree 开短命分支 → PR → auto-merge；不动当前分支，agent 不等 CI）：

   ```bash
   git fetch origin main
   TMPWT=$(mktemp -d)/team-memory
   BR=docs/team-memory-$(date +%s)
   git worktree add "$TMPWT" origin/main -b "$BR"
   # 编辑 $TMPWT/docs/team-memory.md：条目插进标记行之后（前缀匹配标记行）
   git -C "$TMPWT" add docs/team-memory.md
   git -C "$TMPWT" commit -m "docs(team-memory): <标题>"
   # push/PR 用 jizhoutang10thglobal 账号（CTlandu 无写权限，见 CLAUDE.md/board-dev-workflow）
   TOKEN=$(gh auth token --user jizhoutang10thglobal)
   git -C "$TMPWT" -c credential.helper= \
     -c credential.helper='!f(){ echo username=jizhoutang10thglobal; echo "password='$TOKEN'"; }; f' \
     push -u origin "$BR"
   GH_TOKEN=$TOKEN gh pr create --repo jizhoutang10thglobal/wordspace-next \
     --base main --head "$BR" --title "docs(team-memory): <标题>" --body "team-memory 公告落账。"
   GH_TOKEN=$TOKEN gh pr merge "$BR" --repo jizhoutang10thglobal/wordspace-next --merge --auto
   git worktree remove "$TMPWT" --force
   ```

   `--auto` 让 GitHub 在 required checks（test+e2e，~7 分钟）绿后自动合并——team-memory 是异步
   公告板，这点延迟无所谓；agent 发完即走，不阻塞等 CI。

4. **善后与冲突**：无论成败，临时 worktree 都要清掉。如果 PR 因落后 main 变 BEHIND 而没自动合
   （另一条公告先合了），`gh pr update-branch <PR>` 一次即可（同文件同标记行处的并发插入极少冲突；
   真冲突了 rebase 手解后重推）。可选：隔段时间回头 `gh pr view` 确认已合。

## 铁律

- 本 skill 的 commit 只许动 `docs/team-memory.md` 这一个文件。混进任何其他文件都是事故。
- 不直推 main——曾经的「直推特权」已被 branch protection 封死并由 Colin 拍板废除（2026-07-11）；
  任何路径都走 PR，required checks 是不许绕的门。
- 硬规则沉淀进 CLAUDE.md 走正常 PR，不走本 skill。
