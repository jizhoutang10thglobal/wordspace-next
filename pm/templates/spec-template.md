<!--
  wordspace-next-demo · Feature Spec 模板（AI 无人值守版）
  ──────────────────────────────────────────────────────────
  源：projectx-board/pm/templates/spec-template-feature.md（人类工程师版）。
  本模板是它的"亲兄弟"——同样的 6 段 body + frontmatter，让 demo spec 读起来跟
  F46 / F06 / F15 同源。但下游变了：projectx 的下游是外部人类 dev + Wendi 周评，
  本仓的下游是同一条 unattended pipeline（run-spec.sh → /lfg → ce-plan → ce-work → PR）。
  所以对人类版做了 6 处有意调整（每处在正文对应位置有 ← 注释）：

    1. frontmatter 砍到只留身份与依赖（去掉 layer/ui_component/nature/priority/release/
       blocks/related/csv_row_ref/reviewers/updated——那些是 board/周评/外部 dev 协作用的）。
    2. §2 In Scope 必含"可测的逻辑层（与 Electron/DOM 解耦）"——headless Vitest 门要咬得住。
    3. §3 既定约束装 AI-run 环境约束：Vitest=权威门 / 容器不起 GUI / 跳过 Electron 二进制下载。
    4. §5.1 成功信号 = 三件可见实物 + compound 实物（替代人类版的"用户时刻 + 性能预算 ≤100ms"，
       因为 headless 量不到真窗口性能；性能/手感留给人在 macOS 肉眼）。
    5. §5 验收拆成 5.2 Vitest 必过（容器内权威快门，纯逻辑）/ 5.3 Electron E2E 放 CI（xvfb）真跑
       / 5.4 compound 交付物。projectx 的 5-lens 非功能验收：跨平台/长时间/大规模/并发砍进 §2 Out，
       保留的客观项落到 5.2 或 5.3。
    6. "由 dev 决定 / 由设计稿决定"的留口必须消掉——无人 agent 没有下游人接，留口会让它当场停下来问；
       要么收进 §3 既定约束，要么划进 §2 Out。

  ruleset 仍然适用：起草读 projectx-board/pm/templates/spec-ruleset.md 的 A 段，自审跑 B 段。
  一个 demo 例外：A1/B5"零实现泄漏"对外部 dev 是红线，但 §3 既定约束 + §5 验收里**允许**出现
  Vitest / Electron / npm test / CLAUDE.md / DISPLAY ——它们是 demo 的运行机制本身、是交付物的一部分，
  不是泄漏给外部 dev 的实现细节。§1/§2/§4 仍守零实现泄漏。

  [方括号] 占位符全部替换；spec 实例 commit 前删除本 HTML 注释。
-->

---
id: S##
title: <短标题>
slug: <kebab-case-slug>
status: draft            # draft | running | shipped
owner: Colin
depends_on: []           # spec 间依赖，如 [S1]；无则 []
narrowed_from:           # 若从某 projectx feature 收窄而来，写其 id（如 F46）；否则删此行
created: YYYY-MM-DD
---

# S## · <标题>

> <一句话副标题：这条 spec 做什么、长在哪个骨架上>

---

## 1. 产品价值（Why）

[一句话，从用户视角，不超过 50 字。不写废话首段。]

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- [范围内项 1，具体到用户能看见 / 能操作什么]
- [范围内项 2]
- **可测的逻辑层（与 Electron / DOM 解耦）**：把"判断 / 读取 / 状态 / 配置生成"等纯逻辑抽到**不 import electron** 的模块，让 headless Vitest 直接测。 <!-- ← AI-run 必备交付物：门要有东西可咬 -->

### 🚫 Out of Scope（本 spec 明确不做）

- [范围外项] —— 归 [S## / 永远不做]
- [若本 spec 是某 projectx feature 的收窄版，把砍掉的大维度列在这：反转色 / 跨平台一致 / 大文档性能 / 持久化 / 并发 等] <!-- ← Out 列同时承担"这是 F## 收窄版"的声明 -->

---

## 3. 既定约束

- [产品决策 1，一句话——凡是会让无人 agent 停下来问的"由 X 决定"，在这里拍死或划进 Out]
- **容器内权威快门 = Vitest（`npm test`）**：无显示容器里稳跑，是 unattended run 当场判绿 / 红的快门。
- **app 集成真门 = CI 上 xvfb 跑的 Playwright e2e**：vitest 只测纯逻辑，碰不到 preload 注入 / ipc / DOM——「vitest 全绿但 app 打不开」靠这道兜（见 `CLAUDE.md` S3）。容器装不了 xvfb，所以 e2e 不在容器跑、放 `.github/workflows/ci.yml` 的 e2e job（`xvfb-run` + `electron.launch` 加 `--no-sandbox`）。**不要用 `test.skip(!DISPLAY)` 假绿**——skip 不等于通过。真窗口视觉验证仍可由人在 macOS `npm start` 看。
- **容器内不起 Electron GUI**：无屏幕 Linux 沙盒里 Electron 窗口起不来；容器内门只跑 vitest 快门，e2e 交给 CI。
- **renderer 要用纯逻辑模块（如主题/配置逻辑）→ 走 preload，不要在 renderer 顶层 require**：renderer 网页在 `nodeIntegration:false` 下没有 `require`（顶层 `require('../lib/xxx')` 会崩）。正确：preload `require` 它 + `contextBridge` 暴露 `window.api.*`，renderer 用 `window.api.*`，并在 `window-config` 加 `sandbox: false`（preload 要 require 自定义模块必须配它）。详见 `CLAUDE.md` S3。
- **依赖安装跳过 Electron 二进制下载**：设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（驱动脚本已处理）；不影响 Vitest。

---

## 4. UX / 交互

### 4.1 触发与位置

**所属 UI 组件：** [整个窗口 / 底部状态栏 / 左侧栏 / ...]
**触发方式：** [app 启动自动加载 / 点击某开关 / 进入某模式时显示 / ...]

### 4.2 主流程（人在 macOS 本机观察）

1. 用户 [做什么]（如 `npm start`）
2. 系统 [给什么用户可观察到的反馈]
3. 用户 [下一步]

### 4.3 边界情况

| 情境 | 期望行为（用户视角） |
|---|---|
| [异常输入 / 缺失资源] | [应该怎样——要能被单测断言，不静默白屏] |
| [操作失败] | [应该怎样] |
| [反复触发：连续点 N 次] | [最终状态与次数一致，无错乱] |

<!-- 并发（人 + AI + 外部进程）这一类在 demo 多数 N/A：不适用就删该行，不写"本类不适用" -->

### 4.4 键盘映射

<!-- 无键盘交互则 commit 前删本节 -->

- `[Key]`：[作用]

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号（三件可见实物 + compound 实物）

- **PR**：unattended run 结束时分支已 push、PR 已开。
- **绿门**：容器内 `npm test`（vitest 快门）退出码 0；**CI 上 e2e job（xvfb 真跑 Electron）也绿**，确认 app 真能打开（堵「vitest 绿但 app 坏」）。
- **能用**：人在 macOS 本机 `npm start`，[看到 / 能做什么]。
- **学到东西**：仓根 `CLAUDE.md` 多出一段本 run 的环境教训（git diff 可见）——下一条 spec 自动吃到。

<!-- ← AI-run 调整：替代人类版 §5.1 的"用户时刻 + 性能预算（≤100ms）"。headless 量不到真窗口性能，
     改成机器可检的可见实物；性能 / 手感留给人在 macOS 肉眼，不进自动门。 -->

### 5.2 Vitest 验收（必过，构成权威绿 / 红门）

**[子主题]**

- [ ] **[P1] Given** [前置状态] **When** [调用某纯逻辑函数] **Then** [可断言的返回 / 行为]
- [ ] **[P1] Given** ... **When** ... **Then** ...

> 这些断言全部不启动 Electron、不需要显示环境——容器里稳定可跑。

### 5.3 Playwright Electron E2E（CI 上 xvfb 真跑，构成 app 集成门）

- [ ] **[P2] Given** 启动 app **When** [真窗口里的动作] **Then** [computed-style / 可见性断言]
- [ ] **[P2] Given** app 因 preload / 集成层坏掉（`window.api` 没注入、文档空白）**When** 在 CI 用 `xvfb-run npm run test:e2e` 真跑 **Then** e2e 断言失败、CI e2e job 红——**不用 `test.skip(!DISPLAY)` 让坏 app 假绿过门**；`electron.launch` 的 args 加 `--no-sandbox`（无特权 runner 约束，与 app 的 `webPreferences.sandbox` 是两回事）。

<!-- ← AI-run 调整：人类版 §5.3 的 5-lens 非功能（Scale / Time / Environment / Concurrency / Failure
     Recovery）——demo 把跨平台 / 长时间 / 大规模 / 并发砍进 §2 Out；保留的客观项要么变 §5.2 纯逻辑断言，
     要么放这里在 CI（xvfb）真跑的 e2e。lens 不适用就整段省略。 -->

### 5.4 Compound 交付物（必产出）

- [ ] **写教训进 `CLAUDE.md`**：把本 run 撞到的环境约束作为一段简短 lessons 追加进仓根 `CLAUDE.md`。
- [ ] **可断言**：`git diff` 显示 `CLAUDE.md` 有非空新增内容；driver 脚本结束时报告 compound `WROTE / MISSING`。

<!-- ← AI-run 新增，projectx 无等价物。把老 CAF 模板的"Documentation Sync 人工清单"换成主动
     MUST-produce + git-diff 可验。这是 demo 的 compound 闭环——下一条 spec 的 run 一启动自动 load。 -->

---

## 6. 依赖关系

### 6.1 Feature 间（spec 间）

- **上游 · S## [spec 名]**：[依赖什么 / 缺失会怎样]

<!-- 某类关系无，删该行，不留空 placeholder -->

### 6.2 后台能力

- **[能力名]**：[产品层意义，不写具体库]

### 6.3 Compound 期望

- [本 run 自动复用上一条 spec 写进 `CLAUDE.md` 的教训，少走重复弯路——demo 现场要指给人看的"系统变聪明了"]

<!-- projectx §7 参考材料整段删（真 spec 都不留打不开的本地路径）。
     若 spec 的 premise 来自某次真实运行 / dev 报告，按老 CAF 规则在 §1 或 §6 逐字粘原文 evidence，不接受二手转述。 -->
