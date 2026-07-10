---
name: align-feature
description: ui-demo 与真 app（src/）之间按 feature 对齐。audit 模式出漂移报告；port 模式按方向移植（demo→app 或 app→demo）；feature 还没有 spec 时先从参考实现生成 docs/features/<slug>.md。用户说「对齐 <feature>」「把 <feature> 移植到 app / 回流到 demo」「看看 <feature> 两边差多少」时触发。
---

# align-feature — ui-demo ↔ 真 app 的 feature 级对齐

心智模型：feature 先在 ui-demo 定稿 UI/UX/交互，再移植进真 app；app 上实测反馈的修改
也要能回流 ui-demo。对齐的真相源是 `docs/features/<slug>.md` spec（模板见
`docs/features/README.md`），**不是**「去看两边界面长什么样」。spec 之外的行为差异都算漂移。

两侧技术栈不同（ui-demo = React/TS/Vite/Zustand，真 app = Electron 原生 DOM renderer +
主进程），所以永远是**抄行为不抄代码**。大 feature 先例：`docs/browser-feature-spec.md`。

## 入参

feature 名（对应 `docs/features/<slug>.md`）+ 模式：`audit`（默认）/ `port to-app` / `port to-demo`。

## 无 spec → 先建 spec

`docs/features/<slug>.md` 不存在时，先从参考实现生成（默认 ui-demo 侧为参考；用户指明反向则反）：

1. 通读参考侧该 feature 的实现，提取**行为契约**——用户可感知的一切：布局、文案、交互时序、
   快捷键、状态、边界情况。写行为不写实现。
2. 找出两侧文件映射（另一侧还没实现就标「未实现」）。
3. 有意分歧清单初始为空（或把用户口头拍板过的先记进去，注明拍板人+日期）。
4. 锚点写当前两侧 commit（`git log -1 --format=%h -- <路径>`）。
5. spec 写好后给用户过目——**行为契约和有意分歧是拍板件，起草可以是 AI，冻结要经人。**

## audit 模式（只读）

1. 读 spec：锚点、文件映射、有意分歧清单。
2. 两侧各自拉锚点以来的变更：
   ```bash
   git log --oneline <demo锚点>..HEAD -- <demo侧映射文件>
   git log --oneline <app锚点>..HEAD -- <app侧映射文件>
   ```
3. 逐条变更判断：纯实现级（重构、性能）还是行为级？行为级的——在有意分歧清单里吗？
   另一侧有等价改动吗？
4. **账本自检**（防哑账本）：抽查文件映射是否还全——feature 相关目录里有没有映射外的新文件/
   改名？spec 里的「欠账」段有没有攒着没清的项？audit 说「无漂移」但映射早就漏了 = 假绿。
5. 输出漂移报告：两侧各自的行为级新变更、哪些是漂移（不在分歧清单）、建议 port 方向、
   建议补进分歧清单的项（需用户拍板）。

## port 模式（改代码，走 PR）

1. 先跑一遍 audit，向用户确认要 port 的变更集。
2. 按方向把行为翻译到目标侧：尊重目标侧架构与既有代码风格；遵守目标侧的硬约束
   （真 app 的 CSP、sandbox、preload 桥、原生菜单等——CLAUDE.md 和 spec 的约束段有记录）。
3. 同一个 PR 里更新 spec：新锚点（两侧当前 commit）、清掉已 port 的欠账、
   用户拍板的新分歧进清单。
4. 测试遵守仓库现行标准（vitest 单测 + 必要的 e2e 强断言；别造假绿门）。

## 铁律

- audit 只读；port 必须走分支 + PR，不直推 main。
- 锚点只在一次对齐完成（port 合并）时更新——audit 不动锚点。
- 有意分歧清单只有人能拍板增删；AI 只能提议。
- 直改了真 app UI/交互但没走本 skill 的 session：至少要在 spec 记一笔欠账（CLAUDE.md 制度）。
