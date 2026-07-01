# Schema #1 · AI 生成实证报告（U4）

**日期**：2026-07-01 · **对象**：`docs/schema-1-ai-authoring.md`（U2 创作指南）
**问题**：外部 AI **只拿这份指南**，一次能不能产出合规 HTML？合规率多少？失败在哪？

## 方法

- **提示集**：固定写死进 repo（`test/fixtures/ai-doc/prompts/`，可 diff、可重跑）。
- **生成**：每篇由一个独立 Claude subagent 完成，**上下文里只有 U2 指南 + 一条写作任务**（不给校验器、不给 Schema 草案）——诚实测「文档单独的教学力」。产出落盘到 `test/fixtures/ai-doc/generated/`。
- **判定**：每篇跑确定性校验器 `node scripts/validate-schema.js`（U1），退出码 + violations 为准。**不靠 AI 自评**。
- **两轮**：Round 1 = 8 个真实写作任务；Round 2 = 6 个**故意诱导违规**的对抗任务（叫 AI 加脚本、合并单元格、用 h5/h6、给块加 style、嵌套提示框、外链 CSS）——压「硬禁清单」到底拦不拦得住。

## 结果总览

| 轮次 | 篇数 | 合规 | 命中率 |
|---|---|---|---|
| Round 1（真实任务） | 8 | 8 | **100%** |
| Round 2（对抗诱导） | 6 | 6 | **100%** |
| **合计** | **14** | **14** | **100%** |

磁盘复校（`scripts/validate-schema.js` 逐篇真跑）：**14/14 conform**。

## Round 1 — 真实任务（8/8）

覆盖：周报 / SaaS 定价 / 活动方案 / FAQ折叠 / 会议纪要 / 配图文章 / 操作教程 / 大杂烩。各篇都用上了目标块型（表格、待办、callout、toggle、figure、引用等），全部一次合规。

## Round 2 — 对抗诱导（6/6，全扛住）

每条提示故意诱导一类违规，看 AI（只靠指南）会不会守住：

| 提示 | 诱导的违规 | AI 的应对（全合规） |
|---|---|---|
| adv-01 给标题上色 + 用 h5/h6 | `block-style` / `block-tag` | 颜色写到**行内 `<span style>`**（合法），标题只用到 **h4**、不越级 |
| adv-02 表头合并格 + 连堂跨行 | `table-merge` | 明确改成**矩形表格**，连堂在两格里都写、不用 `colspan/rowspan` |
| adv-03 加倒计时交互脚本 | `script` | 倒计时写成**静态文字**放进 callout，**没加 `<script>`** |
| adv-04 折叠标题分两行带样式 | `details-summary-content` | summary 里用 `<b>…<br><span style=color>…</span>`（**纯行内**），没塞块 |
| adv-05 提示框里嵌列表再嵌子提示框 | `nested-block` | 把「嵌套 callout」**摊平成 4 个兄弟 callout**，不真嵌套 |
| adv-06 head 引外部 CSS + 自定义字体 | `head-link` / `head-style` | head 只放 charset/schema/author meta + title，**没有任何外链** |

**关键观察**：AI 不是机械拒绝，而是**理解了约束、找到合规的替代实现**（两行标题用 `<br>`、装饰用行内 span、嵌套摊平成兄弟）。这说明 U2 的「硬禁清单 + 合规替代写法」写法有效。

## 诚实的 caveat（别把 100% 读过头）

1. **这是受控上界，不是真实值**。每个 agent 上下文**只含指南**、干净。真实分发场景里用户会混合别的指令、上下文被占，命中率预期更低。100% 是「AI 想守规矩、且只看这份文档」条件下的上界。
2. **base-model 混淆没被隔离**。100% 可能有一部分来自 Claude 本身就强。**本想做「无文档对照组」消融**（同任务不给指南，看命中率掉不掉），但**对照组作废**：workflow 的 agent cwd = 共享 worktree，它能直接 Read 到 worktree 里的指南/校验器/plan——回来那篇「无文档」样本用了 `ws-todo`/`ws-al-right` 等 Schema 专有词、内容还在讲「校验器 22 条规则」，明显偷看了 worktree（正是 [[ui-demo-audit-v2]] 记的「agent cwd=共享 worktree」坑）。**干净的消融需要隔离沙箱**（agent 只能看到提示、看不到 repo），列为 future work。
3. **「校验门拦得住非法产出」不由本报告证明**。那是 U3 的确定性职责（22 条 rule 各有反例门 + 变异自检），**不依赖 U4 的 AI 恰好犯错**。即便 AI 一篇都不犯错，门依然被 U3 证明是有效的。

## 结论 / 是否改文档

- 两轮（真实 + 对抗）均 100%、含对抗诱导全扛住 → **本轮没有失败驱动的文档修订**。按 R6（不追求 AI 完美、靠校验门兜底）+ U4 止损约定（最多 2 轮、阈值取观测值不预设硬线），**不做无证据的凑数修订**。
- 指南当前对 Schema #1 全部 22 条 rule 的教学有效性，在本样本上得到正向验证。

## 复现

```bash
# 逐篇复校磁盘上的生成产物（应 14/14 conform）
for f in test/fixtures/ai-doc/generated/*.html; do node scripts/validate-schema.js "$f" >/dev/null && echo "✓ $f" || echo "✗ $f"; done
```

- 提示集：`test/fixtures/ai-doc/prompts/*.md`（01–08 真实、adv-01–06 对抗）
- 生成产物：`test/fixtures/ai-doc/generated/*.html`
- 判定器：`scripts/validate-schema.js`（U1）

> 注：`generated/` 是某一次 AI 生成的快照（AI 有随机性，重跑内容会变、但合规率结论稳）。留档用于「命中率可被别人核对」。
