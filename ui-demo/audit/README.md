# ui-demo 验收审计（v2 · persona AI 判官层）

系统性找 ui-demo 编辑器 **UX gap** 的第二层工具。和 v1（`ui-demo/stress/`，确定性「不变量+猴子压测」抓**机械/交互 bug**）互补，这一层抓「**不报错、DOM 合法、但用户一上手就懵**」的主观问题——靠**人写期望 + persona AI 看截图判 make-sense**。

> 一句话分工：**v1 问「规则破没破」（卡死/desync/对齐），v2 问「这功能对用户 make 不 make sense」。**

---

## 两层结构

| 层 | 是什么 | 确定性 | 成本 | 跑法 |
|---|---|---|---|---|
| **取证** | 真鼠标键盘 drive 每个功能 → 截图 + DOM 证据 | 是（固定种子、可复现、可 CI） | 便宜 | `npm run audit:capture` |
| **判定** | persona AI 读截图+DOM+人写期望判 make-sense → 对抗验证 → 报告 | 否（LLM/VLM，probabilistic） | 贵（~10–25 万 token） | Workflow，按需跑 |

取证和判定**分离**：取证可独立确定性跑（CI 友好、当咨询）；判定层按里程碑/发版前手动跑。**只出报告，人决定修不修**（不自动修）。

---

## 怎么跑

### 1. 取证（确定性、无 LLM）

```bash
cd ui-demo
npm run audit:capture          # 跑全部 MVP scenario → test-results/audit/{evidence.json,*.png}
npm run audit:capture -- --only insert-list   # 只跑一个
npm run audit:capture -- --list               # 列出所有 scenario id
```

前置：dev server 在跑（`npm run dev`，默认 localhost:5180）。`--url` 可改（如指向 Vercel 预览）。

### 2. 接期望（把证据和人写期望 join）

```bash
npm run audit:prepare          # evidence.json + editor.expect.md → judge-input.json
npm run audit:expect           # 只看解析到哪些期望（surface 过滤）
```

### 3. 判定（persona AI 判官，贵、按需）

判定是一个 Workflow（`.claude/workflows/ui-demo-audit.js`）。

> **两个环境坑（已绕过，但要懂）**：① 判定 agent 的 cwd 是**主 session 的共享 worktree**，不是 ui-demo worktree，且会把含 `wordspace-next-ui-demo` 的绝对路径"规整"成 sibling 的 `wordspace-next-demo`、读不到文件 → 假 unsure。② Workflow 的 `args` 投递**不稳**（实测时有时无）。两个坑的统一解法：把产物 **stage 到中性绝对目录 `/tmp/ui-demo-audit/`**（无 sibling worktree 可混淆），并用一个**固定路径的 config 文件**告诉 workflow 读哪份，而不是靠 args。

跑判定三步：

```bash
# a. stage：拷截图到 /tmp/ui-demo-audit + 把每条记录拆成 rec/<id>.json + 一个轻量 index.json
#    （省 token：判官只读自己那条 rec ~4KB，不再 18 个 agent 各重读整份 ~45KB judge-input）
npm run audit:prepare -- --stage /tmp/ui-demo-audit

# b. 写 run-config.json（workflow 从这个固定路径读，规避 args 不稳）。judgeInput 指 index.json。
cat > /tmp/ui-demo-audit/run-config.json <<'JSON'
{ "judgeInput": "/tmp/ui-demo-audit/index.json",
  "mode": "audit",
  "report": "/tmp/ui-demo-audit/report.md" }
JSON
```

```js
// c. 跑 Workflow（scriptPath 用绝对路径；不依赖 args，配置全在 run-config.json）
Workflow({ scriptPath: "<绝对路径>/.claude/workflows/ui-demo-audit.js" })
```

跑完出 `/tmp/ui-demo-audit/report.md`：按严重度排序的人话报告，给非工程的 Wendi 也能看（自行拷回仓库留存）。

> **判定层是 consultative、probabilistic**：persona 判有 run-to-run 方差（同一坏场景不同轮可能 fail 或 unsure）。关键性质是**从不被骗判 pass**（实测变异自检 4 轮 0 假 pass）——判官会诚实存疑，但不会把坏的当好的放行。对策：① 证据层把关键信号显式记下（如 `liCount=0`）让判官少漏判；② 高价值结论多跑几轮取并集（任一轮判 fail 就值得查）；③ 判定层当"咨询报告"、不卡红绿，确定性的取证层 + 变异自检兜底。

### 4. 变异自检（证明判官不被骗、不是橡皮图章）

故意把功能「弄坏」产出坏证据喂判官。**哑门 = 判官被骗把坏场景判 pass（rubber stamp、把坏的放行）——这才是真危险**。判 unsure **不算**哑门：判官没被骗，只是单帧证据不足以「确诊」，诚实提请人复核（对咨询型工具是对的）。所以 `hasTeeth = 没有任何注坏场景被判 pass`。

> 好的 mutation 要造**持久、明确**的坏状态（注入伪内容 / 清空成空列表）。别造**瞬态移除**（如抹掉 toast）——单帧截图分不清「真没反馈」还是「toast 已自动消失」，判官会诚实给 unsure（不是哑门，但也不稳定 fail）。

```bash
# a. 注坏所有 mutation scenario + stage 到独立目录（别和正常 index 撞）
npm run audit:capture -- --mutate all
npm run audit:prepare -- --evidence test-results/audit/evidence.mutated.json --stage /tmp/ui-demo-audit-mut
# b. run-config.judgeInput 指向 /tmp/ui-demo-audit-mut/index.json + mode=selfcheck，跑同一个 Workflow
```

返回 `{hasTeeth, fooled, unsureOnBroken, judged/expected}`：`judged < expected` = inconclusive（agent 出错/session limit，重跑）；`fooled` 非空 = 哑门（被骗判 pass）；`fooled` 空 = 门有牙（`unsureOnBroken` 列出诚实存疑的场景）。

---

## 加一个新功能审计（三步）

1. **`audit/scenarios.mjs`** 加一条 `{ id, label, surface, drive(page), capture(page, driveOut) }`：drive 用真鼠标键盘走该功能（借现有原语：`focusTail` / `slashPick` / `openBlockMenu` / `openDocMenu` / `clickMenuItem`），capture 返回该功能的判定证据。
2. **`specs/acceptance/editor.expect.md`** 加一条 `### E:<同 id> · <标题>`，写人写期望（`surface` / `severity` / `expect` / `fail-if`）。**这份契约人写、CODEOWNERS 锁，判定 AI 只读不改。**
3. （可选）若该功能能「坏」得有代表性，在 **`audit/mutations.mjs`** 加一条注入器，纳入变异自检。

然后 `audit:capture` → `audit:prepare` → 跑判定。新 scenario 自动被覆盖。

---

## 期望契约：ui-demo 主导

`specs/acceptance/editor.expect.md` 是 **产品层、跨 surface 共享** 的验收契约：

- **ui-demo 主导 seed 与演进**（ui-demo 的概念/设计领先于真 app，契约从 ui-demo 流向 app）。
- 每条标 `surface`：`both`（两边判）/ `ui-demo`（仅 demo 态，如 AI 占位、导出 mock）/ `app`（仅真 app，ui-demo 审计跳过）。
- **裁判 ≠ 运动员**：人写、冻结、`.github/CODEOWNERS` 锁。改弱期望是产品决策，走人审。

## 与 App 版审计分工

- **App 版** `scripts/acceptance-audit/`（parallel session）：管真 **Electron app**。
- **本 harness** `ui-demo/audit/`：管 **ui-demo（React 原型）**。
- 两边**消费同一份** `editor.expect.md`（ui-demo seed，app 按 surface 取自己适用项）。借结构/哲学、不共享代码（surface 从 Electron 换成 web，复用 v1 的 launch/reset）。

---

## 文件

| 文件 | 作用 |
|---|---|
| `audit/scenarios.mjs` | MVP 场景集 + drive 原语 + captureCommon |
| `audit/capture.mjs` | 取证 runner（`audit:capture`，含 `--mutate` 变异管道） |
| `audit/mutations.mjs` | 变异注入器（每 scenario「弄坏」的方式） |
| `audit/expectations.mjs` | 解析 expect.md + 按 surface 筛 + pair 证据成 judge-input |
| `.claude/workflows/ui-demo-audit.js` | 判定层 Workflow（loader → persona 判 → 对抗验证 → 报告 / selfcheck） |
| `specs/acceptance/editor.expect.md` | 人写验收契约（ui-demo 主导、CODEOWNERS 锁） |
| `test-results/audit/` | 产物（gitignored）：evidence.json / *.png / judge-input.json / report.md |

定位：里程碑 / 发版前按需跑；取证层可进 CI 当咨询，判定层 probabilistic、不卡红绿、只报告。需求/计划见 `docs/brainstorms/2026-06-17-ui-demo-editor-stress-harness-requirements.md` / `docs/plans/2026-06-17-005-...`。
