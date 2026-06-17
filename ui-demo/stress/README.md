# ui-demo 编辑器压测 harness（v1）

确定性、固定种子、**纯代码无 LLM** 的压测：Playwright 真鼠标/键盘随机加权地狂操作编辑器，
**每步后断言一组永真不变量**，任一违反就带种子 + 复现命令报出来。专抓「build 绿、手测漏、
用户一上手就坏」的机械/交互 bug（卡死、editingId↔焦点 desync、faithful-save 破、对齐、崩）。

设计/决策：`docs/plans/2026-06-17-004-feat-ui-demo-stress-harness-plan.md`、
`docs/brainstorms/2026-06-17-ui-demo-editor-stress-harness-requirements.md`。
（persona AI「make-sense」判官层是 v2，不在本 harness。）

## 前置

- dev server 在跑：`npm run dev`（默认 `localhost:5180`），或用 `--url` 指向 Vercel 预览。
- Playwright 已装（`npm install` 会带上；chromium 由 `npx playwright install chromium` 下载，宿主跑）。

## 怎么跑

```bash
# 压测（随机种子，默认 300 步）
npm run stress

# 复现某次（固定种子 + 步数）
npm run stress -- --seed 12345 --steps 200

# 多种子扫一遍
npm run stress -- --seed 1 --runs 10 --steps 200

# 变异自检：故意打断不变量，证明门有牙（不是哑门）
npm run stress:selfcheck

# 调试：开有头浏览器看它操作
npm run stress -- --seed 42 --steps 80 --headed

# 指向 Vercel 预览
npm run stress -- --url https://wordspace-ui-demo.vercel.app/#/docs
```

产物在 `test-results/stress/`：`report.md`（人话报告）、`actions-<seed>.json`（复现日志）、`viol-<seed>.png`（违反截图）。
有违反时进程退出码非 0（CI 友好）。

## 9 条不变量（`invariants.mjs`）

每步后跑，违反即报：
1. 无未捕获 JS 错 / `console.error`
2. 块数不莫名归零（删到底留空正文块）
3. 无重复 block id + 类型合法
4. `editingId` ↔ DOM 焦点同步（本 session 踩的 desync）
5. 块被聚焦时光标在其中（genuine caret-loss）
6. 无删不掉的空行堆积（空块 Enter 刷一堆删不掉）
7. faithful-save：块内容不含编辑器 chrome（`ws-block-controls`/`contenteditable=` 等）
8. gutter `⋮⋮` 与首行对齐（只量非空非编辑的稳定块，阈值 8px）
9. designed/不可编辑块不可 `contentEditable`（不污染 AI HTML）

## 变异自检（`selfcheck.mjs`）

`npm run stress:selfcheck` 对 #2/#3/#4/#7/#8/#9 各注入一个已知坏状态，断言对应不变量**必翻红**；
该红不红 = 哑门 = 退出码非 0。（开发时这道就抓出过 #7 原本是哑门。）发版里程碑前过一遍。

## 加一条不变量

1. 在 `invariants.mjs` 的 `snapshot()` 里采所需数据，在 `runInvariants()` 末尾 `add(id, label, ok, detail)`。
2. 在 `selfcheck.mjs` 的 `MUTATIONS` 加一个注入坏状态的用例，`target` 设成该不变量 id（证明它有牙）。
3. 跑 `npm run stress:selfcheck` 确认翻红，再 `npm run stress` 确认干净态不误报。

## 定位

- **按需 / 里程碑跑**为主（本地 / agent 触发）。确定性、便宜。
- 进 CI 当**咨询报告**可以（退出码已就绪），但起步**不当硬合并门**——fuzz 即使固定种子也可能有环境波动，先观察。
- 只**出报告**，修不修人决定（不自动修）。
- 只测 **ui-demo 编辑器**；真 Electron app 由 `scripts/acceptance-audit/`（另一条线）管。
