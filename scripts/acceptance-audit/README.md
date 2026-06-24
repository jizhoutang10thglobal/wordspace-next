# 真 app 验收审计（acceptance-audit）

真 app（Electron 本地 HTML 编辑器）的「人类式」验收审计：用真 app 跑一遍核心交互，按**人写的验收期望**判它对用户 make 不 make sense，再人话报告。和 ui-demo 的 `ui-demo/audit/` 是**同一套思路的两个 consumer**。

## 裁判 ≠ 运动员：消费同一份契约

「做对了长什么样」的期望由**产品层契约** [`specs/acceptance/editor.expect.md`](../../specs/acceptance/editor.expect.md) 定义——人写、`CODEOWNERS` 锁、**ui-demo 主导 seed 与演进**（概念/设计领先于真 app，契约从 ui-demo 流向 app）。

本审计**只读**这份契约、不另维护一份会分叉的期望：

- 按 `surface` 筛：只判 `surface ∈ {app, both}`（`ui-demo` 专属项跳过）。
- 按 `status` 判：`planned`（功能还没做）判 **pending**、不判 fail——契约在描述目标、不是说 app 坏了。功能真做好把它翻 `built`（走 CODEOWNERS）。
- 实现 AI **不改期望**。app 需要补/改期望，改在那份契约里走 CODEOWNERS review，别在这里另起炉灶。

> 共享的是**契约**，不是 harness。ui-demo 审计驱动 web 构建（Playwright on Vite），本审计驱动**真 Electron app 的 iframe 编辑器**（DOM 完全不同）——取证层各做各的，期望同一份。

## 两层结构

1. **取证层（确定性、无 LLM）** —— `capture.mjs` + `scenarios.mjs`：真启动 app、逐场景真鼠标/键盘驱动 → 截图 + DOM 证据 → `evidence.json`。`expectations.mjs` 把证据与契约 join 成判定层输入。
2. **判定层（persona AI 判官）** —— `.claude/workflows/acceptance-audit.js`：每场景一个「资深用户 + 挑剔 UX」判官读截图 + DOM + 期望判 make-sense；每条 fail 派独立 agent **对抗证伪**压误报；汇总人话报告。

## 运行（三步）

真 Electron 只能在**有显示器**的环境跑（宿主 macOS / CI 的 xvfb job）——同 `e2e/app.spec.js` 的约束。

```bash
# 1) 取证：真跑 app、采证据 + 截图
npm run audit:capture

# 2) 配对：证据 × 契约（surface∈{app,both}）→ stage 到 /tmp/acceptance-audit（含 index.json / rec/ / pending.json）
npm run audit:prepare

# 3) 判定：跑判官 workflow（在 Claude Code 里）
#    先写 /tmp/acceptance-audit/run-config.json：
#    { "judgeInput": "/tmp/acceptance-audit/index.json", "mode": "audit",
#      "report": "/tmp/acceptance-audit/report.md", "pending": "/tmp/acceptance-audit/pending.json" }
#    再调用 Workflow（name: "acceptance-audit"）。报告写到 report 路径。
```

单跑一个场景：`npm run audit:capture -- --only insert-list`。列出场景：`npm run audit:capture -- --list`。
看 app 适用期望：`npm run audit:expectations`。

## 变异自检（门有没有牙）

「门存在 ≠ 门够强」（CLAUDE.md S4）。`mutations.mjs` 在 drive 之后把功能效果**故意打坏**，产出坏证据喂判官；judge workflow 跑 `mode:selfcheck` 时：**哑门 = 判官被骗把注坏场景判 pass**。判 fail（或诚实 unsure）= 门有牙。

```bash
npm run audit:capture -- --mutate all   # 注坏所有有变异定义的场景 → evidence.mutated.json
# prepare 时把 --evidence 指向 evidence.mutated.json，run-config 的 mode 设 "selfcheck"，再跑 workflow
```

## 环境坑（实测，沿用 ui-demo 教训）

- 判定 agent 的 cwd 是共享 worktree，会把含 worktree 名的绝对路径「规整」成 sibling worktree、读不到文件 → 假 unsure。所以 `audit:prepare` 把截图 + 记录 **stage 到 `/tmp/acceptance-audit`**（无 sibling 可混淆），run-config / index / rec 里全用 `/tmp` 绝对路径。
- Workflow 的 `args` 投递不稳 → 配置走固定路径的 `run-config.json`，不靠 args。
- 截图读不到时判官退化为只读 DOM 证据判，**不因文件读不到就 unsure**（unsure 只留给证据本身不足）。
