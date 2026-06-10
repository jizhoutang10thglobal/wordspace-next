<!-- DRAFT，由多 agent 工作流起草、待 Colin 审改冻结。最终家可能在 projectx-board/pm/templates/。 -->

# F## · <短中文标题> — Pipeline-Grade Spec Template

> **这是无人值守 spec→PR 流水线的母模板。** 它把三件事融合成一个 feature 的交付包：board 的人写规格三件套（`.md` / `.intent.md` / `.gate.md`）+ demo 发明的、机器可判、人锁死的可见验收（`.va.json`）。一个 feature 落地为 **四个同 `<slug>` 文件**：
> `specs/F##-<slug>.md`（本规格）· `specs/F##-<slug>.intent.md`（意图卡 = 人类闸门 ①）· `specs/F##-<slug>.va.json`（可见验收，人锁死，实现 AI 不许写/改）· `specs/F##-<slug>.gate.md`（质量门判定）。
>
> **唯一规则源**仍是 board 的 `pm/templates/spec-ruleset.md`（A 段 9 条起草硬规 + B 段 B1–B9 二元门）。本模板**不新增产品规则**，只新增「让规格能被无人值守流水线真跑、真判、judge≠player 不靠自觉」的工程契约。规则与门的冲突，以 ruleset 为准。
>
> **谁写什么（judge≠player 的红线）**：意图卡（`.intent.md`）、可见验收（`.va.json`）、以及 `.va.json` 引用的任何 va-eval metric/阈值，**全部由人（owner = Colin）在实现分支创建之前先写、先 commit**。实现 AI 只写功能代码 + §2 声明的解耦纯逻辑模块，**一行断言都不写、`va-eval` / `va-runner` / `va-selftest` / `va-coverage` / `ci`/`gate.yml` / `playwright*.config` / CODEOWNERS 一律不碰**。这些文件被 `dev/.github/CODEOWNERS` 锁给 Colin。

---

## 0. 文件清单与命名（先于一切）

| 文件 | 作者 | 时机 | 作用 | 缺失后果 |
|---|---|---|---|---|
| `specs/F##-<slug>.md` | 人起草、AI 可协助、人冻结 | 意图卡之后 | 本规格主体（8 节） | 流水线无输入 |
| `specs/F##-<slug>.intent.md` | 人（Colin）写、Wendi review | **最早，先于规格** | 人类闸门 ①；judge≠player 的外部标尺 | host `run-spec.sh` 硬退出 2 |
| `specs/F##-<slug>.va.json` | **人（Colin）写、实现 AI 不许碰** | 实现分支创建**之前** | 机器可判的可见验收（精度锚） | `requires_va: true` 时 `va-coverage.test` 红 → `npm test` 红 |
| `specs/F##-<slug>.gate.md` | `/spec-gate`（机器）+ 人 spot-check | 起草后、实现前 | DoR 二元判定留痕 | ship gate 查不到判定 |

四文件共享同一 `<slug>`（kebab-case）。`requires_va: false`（纯逻辑、零可见效果）时**不需要** `.va.json`，这是合法的。任何有可见/UI 效果的 feature **必须** `requires_va: true` 且提交 `.va.json`。

---

## 1. Frontmatter Schema（YAML，机器读）

board 母版的 14+ 字段（layer/ui_component/nature/priority/release/blocks/related/reviewers/updated…）对无人值守 demo 无意义，**砍到身份 + 依赖 + 流水线承重字段**。Gate B1 grep 这组 key 必须齐全。

```yaml
---
id: F##                      # 例 F46，与文件名一致
title: <短中文标题>           # 例 暗亮主题切换
slug: <kebab-case>           # 例 theme，四个伴生文件共用
status: draft|review|gated|shipped
owner: Colin                 # 谁拍板（va.json/intent 的唯一作者）
reviewers: [Wendi]
depends_on: []               # 例 [F01, F40]；写真实的上游 F##，gate 查依赖完整性
narrowed_from: <F##|null>    # 若本 spec 是把某个被阻塞 feature 缩小后的可跑子集，记原 F##
requires_va: true|false      # ★承重：有可见效果必 true，且必须有同 slug .va.json
va_target: browser|electron  # ★承重：见 §5.3；纯渲染默认 browser
app_branch: colin_pm-track   # 实现落在哪个分支（基于此开 feature 分支）
pr_base: colin_dev           # ★承重：PR 的 base，必须是 gate.yml 触发的分支（见 §5 运行约束）
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

字段约束：
- `requires_va` 与 `va_target` 是流水线承重，写错直接导致门跑不起来或跑错靶。
- `pr_base` **必须** ∈ `gate.yml` 的 `on.pull_request.branches`（当前实测 = `[main, colin_dev]`）。**不要**把 PR 开向 `colin_pm-track`——实测 `gate.yml` 不在该分支触发，整套 CI（vitest + chromium e2e + electron-smoke + va-runner + va-selftest）会静默不跑，「CI 绿」无法被观测。要么在 feature 分支上把 PR base 设成 `colin_dev`/`main`，要么先让 Colin 给 `gate.yml` 加上目标分支触发。**PHASE-1 退出证据 = 真看到一次 workflow run，而不是假定它会跑。**
- frontmatter 可扩展但不可省必填 key；新增字段不得替代规则源。

---

## 2. 规格主体（8 节，每节角色 + 起草指引）

> 起草遵守 ruleset A 段 9 硬规：① 用户视角无技术 ② 零实现泄漏（无 OS/框架 API 名、库名、schema 字段名、半技术黑话）③ 零元注释（不写写作指引/P-tag 图例/决策出处/§X.X 自指）④ 8 节俱全 ⑤ 克制精确措辞（无「100%/永远/完美/丝滑」、无平台偏向「双击/右键」、数字正确、无「如有/视情况」、步骤号连续）⑥ Environment 固定措辞 ⑦ 闭环覆盖 ⑧ §5.1 锚具体情境非 user-story ⑨ 产品决策不甩给 dev。

### 标题块
```
# F## · <title>
> Workspace · <UI 落点> · <性质> — <从 feature-list 粘贴的"说明"原文>
```

### §1 产品价值（Why）
一句话，用户视角，≤50 字。

### §2 范围边界（In / Out）
恰好两块，**无第三类**（B1）。
- **✅ In Scope**：必做项，具体到用户看见/做什么。
  - **★硬交付物（demo 加规，本流水线必有）：本节必须显式声明一个「脱离 Electron/DOM 的可测纯逻辑层」**——一个**不 import electron / 不碰 DOM** 的模块，**点名模块路径 + 它新增的纯函数名**，例如 `src/lib/view-mode.ts`（`toggleMode/isSource`）或 zoom 的 `clampZoom([0.25,4.0])` / `pointerAnchorOffset(...)`。容器内权威 vitest 门只咬得到它；不声明 = 无人值守的快门没有可咬面。这一层覆盖的逻辑必须与 `.va.json` 视觉覆盖的承诺同源（同一条限制，纯函数判一遍、computed-style 判一遍）。
- **🚫 Out of Scope**：每条指向下游 `F##` / 流程 / 「永远不做」。
  - **★把所有阻塞项推到这里**：跨平台、长时运行、超大规模、并发，以及任何依赖未建地基（编辑器 / 多文档 / 文件树 / block 模型）的能力。当前 app（`projectx/dev`，pkg `wordspace` v0.3.0）**没有** contentEditable 编辑器、没有多文档/tab、没有文件树、`.wsp` 而非 `.html`——任何 In-Scope 项**落不到现有代码上的，必须缩进 Out**，并在 frontmatter 记 `narrowed_from`。可落地的纯渲染窄切片：`useTheme`、`useZoom`/`PagedView`/`ZoomWidget`、view-mode 视图状态。

### §3 既定约束
固定产品决策，每条一句。**所有「由 dev 决定 / 由设计稿决定 / 位置由设计稿决定 / 跨 session 是否保留由 dev 决定」这类未决产品/UX 决策必须在这里钉死**（实现细节如「具体 API/库选择由 dev 决定」可留）。无人值守 `/lfg` 没有下游人可问，任何产品/UX 悬挂都会让 agent 停下或自作主张当裁判。Gate B3 grep `由 ?dev ?(决定|定|实现)|留给.{0,4}开发|由设计稿决定` 命中即 fail。**把 `.va.json` 要钉的具体数字写进本节**（例 zoom：上限 400%、下限 25%、连续非步进、pointer-anchor 不变式、按文档隔离），因为这些是「对」与「已发版的错」唯一的分界线，必须是规格的既定约束、再被 §5.2 与 `.va.json` 引用。

### §4 UX / 交互
- **4.1 触发与位置**：UI 落点（真实组件，如底部状态栏 `ZoomWidget`）+ 触发方式。
- **4.2 主流程**：编号的「用户→系统」步骤（号连续），**必须交付意图卡『核心用户时刻』那一句**。
- **4.3 边界情况**：表格，四类必覆盖——异常输入 / 操作失败 / 并发（人 + AI / 外部进程）/ 反复触发。无法在窄切片落地的并发/失败类，推 §2 Out，别写「不适用」。
- **4.4 键盘映射**：无键盘则**删除整节**。

### §5 验收标准（Acceptance Criteria）——承重节

#### 5.1 用户时刻 + 成功指标
锚到具体情境，**不用「作为 X 用户」**。demo 改造：人写版的「用户时刻 + 性能预算（≤100ms / 内存 ≤20MB）」**换成三个机器可判 + 一个 compound 工件**（无头量不到真窗口性能，手感留给人眼在 macOS 上看）：
1. PR 已开。
2. 容器内 `npm test`（vitest run）绿 **且** CI（`gate.yml`）e2e + va-runner + va-selftest 绿。
3. 在 macOS 上真打开 app 可用（人 host-verify 眼判）。
4. §5.4 的 compound 工件已产出（`git diff` 可证）。

#### 5.2 验收场景 Given-When-Then（每行 [P1]/[P2]/[P3] 标签；EARS 5 类覆盖，尤其 IF-THEN 异常；散文保持 GWT 不写 EARS）
**★每条 [P1] 行必须带一个 check-id 标签**，形如：
```
[P1][va:ceiling] Given 文档处于 100%，When 持续放大到上限，Then 缩放停在 400% 不再增长，且页面背景仍为纯白。
```
该标签必须解析到 `.va.json` 里同 `id` 的 check（§8 覆盖门机械校验）。**每条 [P1] 行必须点名一个具体可观测信号 = selector + 计算值 + 阈值**，不许写「zoom works」这种弱断言。强断言判据（S4）：**只要你能想出一种「CSS 全废 / 文本全空但断言还过」的情形，它就还是弱的**——对 F15 这种 modify-not-greenfield 目标尤其致命，因为已发版的 `useZoom`（0.5–2.0、步进、全局、top-center）会让「zoom 变了 scale」这类弱 check 直接放行错成品。

#### 5.3 非功能验收 / 工程靶
demo 改造（人写版五镜头 Scale/Time/Cross-OS/Concurrency/Failure 大幅下放）：跨平台/长运行/大规模/并发**切进 §2 Out**；存活的客观项落到 §5.2 vitest 或本节 CI e2e 真跑。Environment 固定措辞 **(macOS Electron + Windows Electron)**。本节必须显式声明本 spec 的 **VA 运行靶**（与 frontmatter `va_target` 一致）：
- **browser**（纯渲染默认，更快、已接线）：在 Vite webServer（`npm run test:e2e`，baseURL `http://localhost:3000`）里跑。real app 的强计算样式门（`tests/e2e/default-text-color.spec.ts`、`doc-background-white.spec.ts` 读 `getComputedStyle().backgroundColor` 断 `rgb(255,255,255)`；`toolbar-no-overlap.spec.ts` 几何 rect 断言）就跑在这里——VA 的核心量法在这条路上是 native 的。**注意 real app 是 React SPA**：`page.goto('/')` 后要用隐藏 file-input（`tests/e2e/helpers.ts` 的 `openFile()`）先开一份 fixture 文档，页面才有内容——所以 `.va.json` 必须带 `open` 步骤（见 §5.4 VA 契约），不能像 demo 那样 `waitFor` 后立即采集。
- **electron**（需要 preload/IPC 才用）：`_electron.launch`（`playwright.electron.config.ts`），跑前必须 `npm run build:all`（config 缺 `dist-server/server.cjs` 硬失败），`--no-sandbox` 启动。

#### 5.4 交付物 + compound（demo 加规，MUST）
- **VA 契约（精度锚，人锁死）**：见 §「VA 契约」专节。
- **compound（MUST 产出）**：把本次 run 的教训 append 进 repo 根 `CLAUDE.md`，`git diff`（对 merge-base）非空可断言，driver 报 `WROTE/MISSING`，下个 spec 的 run 自动加载。

### §6 依赖关系
- **6.1 Feature 间**：上游/下游/同组（与 frontmatter `depends_on` 一致）。**若上游未建（如 F01 多文档、F40 编辑器未落地），本 spec 要么把依赖那部分推 §2 Out + 记 `narrowed_from`，要么标 `status` 不可跑——绝不靠无人值守 agent 现造地基。**
- **6.2 后台能力**：产品级能力含义，无库名。

### §7 参考材料
v6-demo / meeting-notes 引用；**通常整节删除**（留死的本地路径是反模式）。

### §8 待议问题（可选）
开放问题，**唯一允许 [TODO] 的地方**。任何会落到无人值守 agent 头上的产品/UX 决策不许留这里——要么 §3 钉死、要么 §2 Out。

---

## VA 契约（`specs/F##-<slug>.va.json`）——机器可判的精度锚

**作者 = 人（Colin），实现 AI 不许写、不许改。** 这是 judge≠player 的硬实现：断言强度全部来自这个文件，runner 不认识任何具体 spec。文件结构（自足，generic runner 直接消费）：

```jsonc
{
  "spec": "F##-<slug>",
  "title": "<可见验收标题>",
  "note": "由人(Colin)拍板、实现 AI 不许改（见 .github/CODEOWNERS）。可见性口径：<Colin 一句话定什么算可见成功>。阈值留宽余量防 xvfb/mac 色差 flaky。",
  "launch": {
    "target": "browser",                 // browser | electron，与 frontmatter va_target 一致
    "baseURL": "http://localhost:3000",  // target=browser 时：Vite webServer 入口
    "main": "electron/main.cjs",         // target=electron 时：可启动入口；跑前必须 build:all
    "waitFor": "#root"                   // 就绪 selector
  },
  "steps": [
    { "open": "tests/e2e/fixtures/sample.html" },  // ★real app 必需：SPA 启动时无内容，先开文档
    { "snapshot": "before" },
    { "click": "#zoom-in" },
    { "snapshot": "ceiling" }
  ],
  "checks": [
    {
      "id": "ceiling",                   // 必须能被某条 §5.2 [P1][va:ceiling] 行解析到
      "desc": "放大到上限停在 400%，纸面仍白",
      "selector": "#doc-container",
      "metric": "bgColor",               // 见下「metric 目录」
      "states": { "ceiling": { "equals": "rgb(255, 255, 255)" } },
      "invariantAcross": ["before", "ceiling"]
    }
  ]
}
```

**metric 目录**（采集 = 真开 app 读 `getComputedStyle().backgroundColor` / `textContent` / `getBoundingClientRect`，在 e2e 层；判定 = `va-eval.js` 纯函数）：
- `bgLuminance` — 背景色算 WCAG 相对亮度，`cond {min,max}`，可配 `relations`（如 `"dark < light"`）、`invariantAcross`。**fail-closed**：非不透明背景（alpha<0.99，即所有 CSS 死掉时的 `rgba(0,0,0,0)`）或不可解析颜色 → `throw`（=红），「完全没样式」绝不会被误判成「很暗」。
- `bgColor` — 背景色原始 `rgb()` 串 `equals` + `invariantAcross`。
- `textContent` — 元素文本 `contains / notContains / equals` + `invariantAcross`（S4 内容 metric）。
- **新增 metric（如 zoom 需要的 transform-scale / `getBoundingClientRect` 几何）**：当前 `va-eval.js` 只有上述三种，无 scale/rect。**zoom/几何类 spec 必须在 `va-eval.js` 加新 metric + 容差带**（如「pointer-anchor 偏移 ≤N px」「scale 在 4.0±ε」）。**新 metric 与其容差由人（Colin）在实现分支创建前先 commit；实现分支一行都不许改 `va-eval.js`**——CI 步骤 diff `va-eval.js` 对实现前基线，有改动**自动 reject（不只是 request review）**。schema 可扩展但锁在 CODEOWNERS 下，证明它能表达真 backlog 而不泄漏 judge≠player。

**强度自证（写 `.va.json` 时的硬约束）**：checks 必须**正交**到「杀掉全部 CSS + 清空被验元素 textContent」后必翻红（survive va-selftest 的 baseline-绿-then-必须-红 探针）。范本是 f46 的正交对：`doc-stays-white`（不变式）+ `status-bar-darkens`（关系）。单一「便宜」check（只验已发版就有的行为）通不过本约束。

**CODEOWNERS 锁**：`dev/.github/CODEOWNERS`（当前 projectx **不存在**，必须新建）把 `specs/*.va.json`、`va-eval.*`、`va-runner.*`、`va-selftest.*`、`va-coverage.*`、`gate.yml`、`playwright*.config.*`、`host-verify.*` 指给 Colin。**注意**：CODEOWNERS 只产生「要求 review」，真正 block-on-red 还需 Colin 在 GitHub branch protection 把 CI e2e/va job 设成 required status check + 勾「Require review from Code Owners」——agent 无 Administration 权限（403），**未设之前任何 phase 的「绿」都不真正挡合并**，不要把它当 merge-blocking 信任。

---

## 意图卡契约（`specs/F##-<slug>.intent.md`）——人类闸门 ①

人（Colin）写、Wendi review、**在规格之前冻结**。只放「AI 推不出来、只有人能定」的东西；推得出来的别写，编不出来的字段标 `[待 Colin 补]`、绝不杜撰。它被 `run-spec.sh` 逐字打印、等人按 `y` 才进容器干活（按 `N` 中止）。

```yaml
---
spec: F##-<slug>.md
role: intent-card
---
```
正文字段：
- **一句话**：what + why。
- **核心用户时刻**：单句——哪个用户、什么场景、做了什么、得到什么。**§4.2 主流程必须交付这一刻**；Gate B4 拿它当外部标尺判 §4、拿 Out list 查范围蔓延。
- **In scope** / **Out of scope**。
- **既定约束**：默认「仅桌面端 Electron(macOS+Windows)；文件格式 HTML」。
- **成功长什么样**：一个可感知的成功标记，最好带数字——它是 `.va.json` 阈值的人话来源。

意图卡是 judge≠player 的外部锚：实现 AI **不定义成功**，人确认的意图卡约束它。

---

## 质量门契约（`specs/F##-<slug>.gate.md`）

`/spec-gate` 写：判定 `✅通过/❌不通过` + 被门 spec 文件名 + 日期（`date +%F`）+ 二元 DoR 清单逐项 PASS/FAIL + 每项 evidence + SOFT 提示（不阻塞）+ 跳过了哪些镜头 + `## 历程`（FAIL→fix→re-review 回路留痕）。机制：机械 lint（`spec-lint.sh`，HARD 命中=「文本卫生」FAIL）+ 5 镜头对抗式语义 review（L1 覆盖 / L2 scope / L3 意图 / L4 结构可读 / L5 demo，默认「未就绪」）折叠成二元 DoR。任一硬项 FAIL → 整体不通过 → revise（`/spec-pipeline` 最多 3 轮，再升 Colin）。rubric 0–100 仅作建议色、不是门。

---

## 硬性起草规则（违反 = gate FAIL，无例外）

1. **禁一切开放式延后。** 任何「由 dev/由设计稿决定」的产品/UX 悬挂 → §3 钉死或 §2 Out。无人值守 `/lfg` 没有下游人。Gate B3 grep `由 ?dev ?(决定|定|实现)|留给.{0,4}开发|由设计稿决定`，命中即 fail（实现细节延后「具体 API/库由 dev 决定」放行）。**这条 B3 grep 门当前 projectx 不存在，必须新建并接进 CI**；未建之前，只许跑人工确认无悬挂的 spec（F46/F14 净；F06/F09/F28 带悬挂，不许跑）。
2. **每条 [P1] 验收必须点名具体可观测信号**：selector + 计算值（computed-style / textContent / 几何 rect）+ 可证伪阈值，并带 `[va:<id>]` 标签解析到 `.va.json` 同 id check。禁「works / 正常 / 丝滑」。
3. **每条 [P1] 必有同源的单元逻辑门**：§2 声明的纯逻辑模块必须覆盖该断言背后的逻辑（vitest 判一遍，VA computed-style 判一遍）。视觉对、逻辑也得对。
4. **`.va.json` checks 必须正交到能 survive mutation**（杀 CSS + 清文本后必翻红）；做不到 = 哑门 = 整个 e2e fail。
5. **judge≠player 的时序硬规**：`.intent.md` / `.va.json` / 新增 va-eval metric+阈值 **必须由 Colin 在实现分支创建之前先 commit**（仿 demo commit `4954c27`「VA 输入（人写，实现前置）」）。CODEOWNERS「事后批准」严格弱于「事前写死」。实现分支**禁碰** `va-eval.js`；改了 = CI diff 自动 reject。
6. **覆盖必须机械完整**：`va-coverage.test` 不止查 `.va.json` 存在，还要校验**每条 `[P1][va:<id>]` 标签都解析到一个 check**（缺承重 [P1] 行 = vitest 红）；并加 vacuity 守卫——拒绝 states/relations 为空、或在 mutated（CSS 死、文本空）快照下仍结构性可满足的 check。
7. **8 节俱全、Environment 固定措辞 (macOS Electron + Windows Electron)、克制精确措辞**（无 100%/永远/完美/丝滑/如有；数字正确；步骤号连续）。
8. **frontmatter `pr_base` 必须是 gate.yml 真触发的分支**（`[main, colin_dev]`），否则 CI 静默不跑，「绿」不可观测。
9. **In-Scope 必声明脱离 Electron/DOM 的纯逻辑模块 + 点名其纯函数**，否则容器内权威 vitest 门无可咬面。
10. **产品决策不甩 dev**（A9）；实现细节可留。

---

## 真实 app / 命令 / CI 引用（无悬挂，全部实测）

**目标 app**：`/Users/ctlandu/Documents/GitHub/projectx/dev`（pkg `wordspace` v0.3.0，Electron 41 + React 19 + Vite 6 + TS，main = `electron/main.cjs`，内嵌 Express :4000）。落在 `colin_pm-track` 分支（**不是**陈旧的 `projectx-dev`/`fix-tooltip-contrast` worktree）开 feature 分支。projectx / projectx-board / projectx-dev 是**同一个 repo 的三个 worktree**（`.git` 在 `/Users/ctlandu/Documents/GitHub/projectx/.git`），board spec 在 `pm/product/specs/`、app 在 `dev/`，是同树的 sibling 顶层目录。

**命令（实测自 `dev/package.json`）**：
- 快速权威门（容器内）：`npm test` = `vitest run`（`vitest.config.ts`：`globals:true`、`pool:'forks'`、`include: ['tests/**/*.test.ts']`、coverage 阈值 server/services ≥80%）。
  - **注意**：vitest `include` 是 **TS-only、限 `tests/`**。从 demo 拿过来的 `va-coverage.test.js` / `va-eval.js`（`.js`、在 `src/lib/__tests__/`）**按原样不可见**——必须落成 `tests/va-coverage.test.ts`（或拓宽 `include`），否则「缺 VA → 红」静默不触发。
- 浏览器 e2e：`npm run test:e2e`（`playwright.config.ts`，Vite webServer，headless Chromium，baseURL :3000）。
- Electron e2e：`npm run test:electron-smoke`（`playwright.electron.config.ts`，`_electron.launch`，跑前必 `npm run build:all`）。
- 构建：`npm run build:all`（`vite build` + `build:server` → `dist-server/server.cjs`，main.cjs 运行时 require 它；陈旧 build = 跑陈旧 server，任何真 Electron VA 前必 rebuild）。
- 聚合：`npm run ci`。

**CI**：`/Users/ctlandu/Documents/GitHub/projectx/.github/workflows/gate.yml`（name "CI Gate"，`on: pull_request: branches: [main, colin_dev]`，working-directory `dev`）。两 job：`gate`（ubuntu，typecheck→lint→`test --coverage`→build:all→smoke:prod→`playwright install chromium`→`test:e2e`，浏览器 e2e 走 vite webServer **无需 xvfb**）+ `electron-smoke`（macos-latest，缓存 electron 二进制→build:all→`test:electron-smoke`，native GUI 无 xvfb）。**容器只跑 vitest 快速门**（无显示器、装不了 xvfb）；真 app 集成门跑在 CI（macOS 路径比 demo 的 ubuntu+xvfb 简单，已接线）。

**必须新建（projectx/demo 都缺，是本流水线的真创新）**：
1. `tests/va-coverage.test.ts`（扫 `specs/*.md`，对每个 `requires_va: true` 断言同 slug `.va.json` 存在 **且** 每条 `[P1][va:<id>]` 解析到 check）。
2. spec-agnostic `va-runner`（落成 `tests/.../*.spec.ts`）：**这是重写不是复制**——demo 的 `e2e/va-runner.spec.js` 硬接 `_electron.launch` + 启动后立即采集 index.html 的 `document.body`；real app 是 SPA，需要 (a) browser/baseURL 启动模式（纯渲染默认）、(b) `.va.json` 的 `open` fixture 步骤（页面初始无内容）、(c) build-aware 的 electron 路径。retries=0（flaky 即信号），断言强度全来自 `.va.json`。
3. `va-selftest`（mutation 探针）：每个 VA 先确认 baseline 绿，再杀全部 `<link>/<style>` + 清空被验元素 textContent，重采，断言 VA 必翻红；mutilated app 仍过 = 哑门 = 整个 e2e job fail。**退出证据**：对**当前**（未改的）app 跑一遍 va-selftest 必红，证明在真 projectx 上有牙、不只在玩具上。
4. `dev/.github/CODEOWNERS`（当前**不存在**）锁上述全部 + `.va.json` 给 Colin。
5. **并行硬前置（agent 做不了，Colin 手动）**：GitHub branch protection 把 CI e2e/va job 设 required status check + 「Require review from Code Owners」于 `pr_base` 分支——未设之前没有任何「绿」真正挡合并，别把任何 phase 退出证据当 merge-blocking。

**第一个真跑目标（按风险排序，别选错烧掉 demo）**：
- **F46 主题（缩到 theme-apply only）**：落在真实 `useTheme.ts`（`data-theme` on `<html>`、`matchMedia`），纯渲染、玩具已验证，正交对 `doc-stays-white` + `chrome-darkens` 已证 survive mutation。把 F46 里依赖 F40 编辑器的 text-input 部分推 Out（记 `narrowed_from`）。**这是真正的第一靶。**
- **F14 渲染/源码切换不是干净首选**：其 In-Scope 的「源码视图可编辑 / 语法高亮 / 视图模式按文档隔离」打到缺失的编辑器 + 多文档 + .html-file 模型（`depends_on: [F09,F06,F01,F40]`，app 内 grep 无 `viewMode` 状态）。**要么缩成 render-toggle only（把可编辑/按文档隔离推 Out）、要么和 F15 一样当模板/门压力测试材料**，等 F01+F40 落地。
- **F15 zoom 是 Phase-3 对抗压力测试、永不首跑**：shipped `useZoom`（0.5–2.0、步进、全局、top-center）4 点矛盾于 spec（0.25–4.0、连续、按文档、pointer-anchor）+ `depends_on: [F01,F40]` 未建。它是模板挣价值的地方——人写的 `.va.json` 钉 400% 上限 / 25% 下限 / pointer-anchor 不变式 / 连续非步进；退出证据 = **同一道门在修好的 app 上绿、指向当前已发版（错限/top-center）代码时翻红**（S4 强弱门 before/after 实证）。