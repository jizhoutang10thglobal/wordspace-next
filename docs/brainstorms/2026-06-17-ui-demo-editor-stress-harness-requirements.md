---
date: 2026-06-17
topic: ui-demo-editor-stress-harness
---

# 需求：ui-demo 编辑器「不变量 + 猴子压测」自动找-bug harness（v1）

作者：Colin + Claude（/ce-brainstorm）

## 问题 frame

ui-demo 编辑器反复出现「不报错、`vite build` 绿、人工手测也容易漏，但用户一上手就坏」的 UX/交互 bug。本 session 实证（全程没被任何现有检查挡住，靠 Colin 手测才发现）：

- 单击落点被既有 `editingId` effect 顶到块末（点中间落不到点击处）。
- 编辑态块带多余灰底。
- 空块里 Enter 刷出一堆**删不掉**的空行（Backspace 删不掉当前空块）。
- 方向键不能跨块。
- gutter `⋮⋮` 与文字行没对齐。
- React `editingId` 与 DOM 焦点 **desync**。

共性：这些都是**客观规则被破坏**（不是"好不好看"的主观判断），但单测/build 覆盖不到、人工手测靠运气。要一套**可重复、确定性、可复现**的自动压测，在 Colin/Wendi 之前把这类机械/交互 bug 抓出来。

> 本 session 已用 Playwright MCP 手动验证此法对 ui-demo 可行：驱动 localhost:5180、模拟点击/Enter/Backspace/方向键、用 JS 量不变量（gutter 偏差=0、块数、editingId↔焦点、存盘 HTML 干净），当场复现并验证了上面几个 bug。本文把它正式化、自动化。

## 它是什么（v1 形态）

一个**确定性、固定种子**的压测 harness（**全程无 LLM/AI**，纯代码）：

1. **驱动**：Playwright 驱动真 ui-demo（dev `localhost` 或 Vercel 预览），用**随机加权**的编辑动作序列狂操作（打字 / Enter / Shift+Enter / 各位置 Backspace / 方向键 / 点随机块 / 斜杠插各类型 / `⋮⋮` 菜单 / 转块 / 拖拽重排 / 文末续写）。
2. **断言**：**每一步动作后**跑一组硬编码的「永真不变量」。
3. **报告**：任一不变量违反 → 记下**固定种子 + 到该步的动作日志**（可一键复现），最小化成人话 bug 报告。

它**不判断"功能合不合理"**——只判断"客观规则有没有被破坏"。所以不需要 AI，确定、便宜、可进 CI。

## 两层模型（v1 做第一层；第二层 AI 判官 deferred）

| 层 | 是什么 | 抓哪类 bug | AI? | 状态 |
|---|---|---|---|---|
| **① 不变量 + 猴子压测** | 纯代码：Playwright 狂操作 + 硬编码不变量断言 | **机械/交互**：卡死、desync、faithful-save 破、对齐、崩 | 无 | **v1（本文范围）** |
| **② persona AI 判官** | LLM/VLM agent 模拟真人编辑 + 看截图，按人写期望判「make-sense」+ 对抗验证 + 报告 | **主观 UX gap**：功能对用户合不合理（如"图片插进来但没法换真图"） | 有 | **v2（deferred）** |

两层抓的是**不同 bug 类、互补**，不是替代关系。v1 是便宜的回归网，先铺；v2 照搬 App 版 `acceptance-audit`（见 `docs/brainstorms/2026-06-17-agent-acceptance-audit-requirements.md`）的 persona 判官思路，第二步加。

## Key Decisions

- **v1 = 确定性压测层，无 AI critic。** AI 判官（"模拟真人挑刺、判 make-sense"）是 v2，单独迭代。理由：本 session 的 bug 全是客观机械类，硬不变量就能抓，加 AI 只会更慢更贵更飘。
- **放 `ui-demo/` 自己一套**（独立 Playwright-web harness，跟被测的东西住一起、`npm run` 跑、CI 算 ui-demo-only）。**借鉴** App 版 `scripts/acceptance-audit/` 的哲学（不变量 / 变异自检 / 人话报告），**不共享代码**。
- **分工**：parallel session 管 Electron App 的 `acceptance-audit`，本 harness 管 ui-demo。两边 surface 不同（Electron vs web）、并行不互卡。
- **跑法**：按需跑为主（`npm run` / 命令），固定种子可复现；稳定后**可选**在 CI 出「咨询报告」，**不当硬合并门**（避免 fuzz 偶发卡 PR）。
- **变异自检**：harness 自带"故意打断一条不变量 → 必须翻红"的自测，证明门有牙、不是哑门（沿用 CLAUDE.md S4 哲学）。
- **只出报告，人决定修不修**（不自动修复）。

## 需求

- **R1 驱动真 ui-demo（web）。** Playwright 打 dev `localhost` 或 Vercel 预览；每次跑前把 mock store 重置到**固定种子文档**（避免 persist 的脏 doc 串扰，见工程现实）。
- **R2 随机加权动作集。** 覆盖编辑器现有交互：打字 / Enter / Shift+Enter / Backspace（块首与中间）/ ↑↓←→ / 单击随机块（可编辑与不可编辑）/ 斜杠插每类型 / `⋮⋮` 菜单各项（转块/复制/删除/颜色/在下方插入）/ 拖拽重排 / 文末续写。动作权重可配。
- **R3 不变量清单（每步后断言；初版见下，可增删）。**
- **R4 固定种子可复现 + 动作日志。** 同种子 → 同序列；违反时输出能复现的最短动作日志。
- **R5 人话报告。** 列：第几步触发、哪条不变量、当时状态/截图、复现种子。给 Colin/Wendi 看。
- **R6 变异自检。** 内置至少一个"打断已知不变量（如临时跳过 Backspace 删块）→ harness 必报红"的自测；不报红 = 警告"门哑了"。
- **R7 运行方式。** 一条命令本地/agent 触发；可选 CI 咨询报告模式（非硬门）。
- **R8 不替代现有检查。** vitest（若将来有）/ 真 app 的 e2e 继续守它们的；本 harness 是 ui-demo 的「机械交互不变量」补充层。

## 不变量清单（初版，从本 session 的 bug 长出来；可增删）

1. **无未捕获 JS 错 / `console.error`**（页面监听）。
2. **块数永不莫名归零**；删到最后一块应留一个空正文块（不空白死）。
3. **无孤儿 / 重复 block id**；每块 type 合法。
4. **React `editingId` ↔ DOM 焦点同步**（`.ws-block-editing` 的块 == `document.activeElement` 所在块）。
5. **光标永远在一个真实可编辑块里**（不丢、不落到不可编辑块/容器上）。
6. **空块可删、不堆积删不掉的空行**（块首 Backspace 能删/并）。
7. **存盘 HTML 干净**：不含 `.ws-block-controls` 等 UI DOM、不含 `position`/`left`/`top`/`width:px` 等定位尺寸 inline 样式（faithful-save）。
8. **gutter `⋮⋮` 与所属块首行对齐**（computed 偏差在阈值内）。
9. **designed/AI 块永不被置为 `contentEditable`**（不污染其 inline-style HTML）。

## Scope 边界

**v1 不做：**
- persona AI 判官层（= v2，下面 deferred）。
- 自动修复（只报告，人决定）。
- 非编辑区（侧栏 / 文件管理 / TopActions 等）——先聚焦编辑器。
- 真 Electron App（parallel session 的 `acceptance-audit` 管）。

**Deferred（规划中的 v2）：**
- **persona AI 判官层**：LLM/VLM agent 模拟真人按人写期望判 make-sense + 对抗验证 + 报告。启动时再定期望文件格式/位置、模型档位、与 v1 怎么编排进一套 workflow。

## Dependencies / 假设

- **加 Playwright 到 `ui-demo/` 的 devDependency**（ui-demo 现在只有 dev/build/preview，无任何测试框架）。
- 借鉴 `scripts/acceptance-audit/`（共享 worktree）的结构/哲学，但 ui-demo 版独立、不共享代码。
- 假设：ui-demo 的 mock store 状态可在每次跑前确定性重置（否则 persist 脏数据会让"可复现"失真）。

## 工程现实（borrow + 本 session 踩到的，写进去免得再踩）

- **合成事件命中假象**：`dispatchEvent` 在容器元素上，`e.target` 是容器不是子节点（ul/table），会误判。harness 要用 **Playwright 真鼠标/键盘**（走真实命中测试），或派发在真实子元素上。
- **React contentEditable 受控冲突 / 光标乱跳**：本仓 `Canvas.tsx` 用 `focused.current` + "未聚焦才同步 innerHTML" 守；新落点全走 `requestAnimationFrame`。不变量 #4/#5 重点盯这条。
- **persist 跨 reload 脏状态**：mock store 把编辑后的脏 doc 存住了（本 session 实测 reload 后残留空块）。harness 每次跑前要重置到固定种子文档。
- **make-sense 判定离不开截图**（VLM）——这是 v2 的事，v1 的不变量靠 DOM/computed-style 就够。

## Open questions（留 plan / 下一轮）

- 随机动作权重、每次跑多少步 / 多少 seed、跑多久。
- 不变量违反后怎么**自动缩短**复现序列（delta-debug）。
- 截图存证在 v1 要不要（违反时存一张帮人看）vs 纯 DOM 状态。
- v2 何时启动、期望文件格式（沿用/扩展 App 版 `*.expect.md`？）。

## 成功标准

- 把本 session 这批 bug（空块卡死 / editingId↔焦点 desync / gutter 没对齐 / 编辑态灰底 / 单击落点被顶尾）当**回归基准**——harness 能在它们重现时自动抓出来。
- 一条命令产出**可复现**（带种子）的人话 bug 报告。
- **变异自检**证明门有牙（打断不变量必翻红）。
- 误报可控（确定性断言，不靠概率判定）。
