---
title: "fix: 堵住「绿但坏」测试盲区 + 重跑 spec2 验证流程闭环"
type: fix
status: active
date: 2026-06-05
deepened: 2026-06-05
---

# fix: 堵住「绿但坏」测试盲区 + 重跑 spec2 验证流程闭环

## Summary

spec2（主题切换，PR #3）暴露了无人值守流程的致命盲区：14 个 vitest 全绿、lfg 报 DONE、PR 开好，但真启动 Electron app 是坏的（`window.api` 没注入、文档空白、主题切不了）。根因是 preload 在默认 `sandbox: true` 下 `require` 了项目自定义模块；但**更根本的问题是测试盲区**——唯一会真启动 app 的 playwright e2e 因无头容器没 `DISPLAY` 被 `test.skip` 全跳过、且根本没进任何门，app 集成层零自动化覆盖。

本计划不手动修 app，而是**把门和教训做扎实进 main，然后重跑 spec2**，验证流程读到教训、撞上新门后能否自己产出正确的 app。这才是 compound 的闭环证明，也是给 Wendi 的核心叙事：发现流程会漏 → 补门 + 写教训 → 流程自愈。

---

## Problem Frame

- **直接症状**：`src/renderer/preload.js` 里 `require('../lib/theme-manager')` 在 Electron 默认 sandbox 下加载自定义模块必然失败 → 整个 preload 挂掉 → `window.api` undefined → renderer 全死。
- **根问题**：测试策略有洞。`vitest` 只测脱离 Electron 的纯逻辑（当然全过）；`e2e/app.spec.js` 用 `_electron` 真启动 app，但每个测试顶上 `test.skip(!process.env.DISPLAY)`，容器无 X server 全 skip，而 skip 在 playwright 里算「通过」（绿勾）。更糟：e2e 根本没被任何门调用（`run-spec.sh` 权威门和 `ci.yml` 都只跑 vitest）。于是「绿但坏」一路畅通到 PR。
- **为什么这次必须根治**：这个 demo 的全部卖点是「无人值守产出可靠的 PR」。一个会产出「看着成功、实际坏掉」成品的流程，可靠性叙事直接崩。

---

## Key Findings（研究实据）

1. **xvfb 在 dev container 装不了**（blocker）。基础镜像 `node:20`（Debian bookworm）不带 xvfb 也不带 Chromium 系统库；`.devcontainer/init-firewall.sh` 默认 DROP，白名单（github / npm / anthropic / vscode 等十余个域名）里**没有任何 Debian apt 源域名**，`apt-get update` 连不上源。结论：容器内 e2e 真跑不可行，e2e 真门只能放 CI。
2. **e2e 真跑的标准姿势已收敛**（2026）：`xvfb-run -a --server-args="-screen 0 1280x720x24" -- npm run test:e2e`，并给 `electron.launch` 的 `args` 加 `--no-sandbox`（无特权环境 Chromium setuid sandbox 起不来）。ubuntu-latest 不预装 xvfb，且要 `npx playwright install-deps` 补 Chromium 共享库。
3. **`--no-sandbox`（CLI）≠ `webPreferences.sandbox`（app 代码）**。前者是 CI 环境约束（让 Chromium 进程在无特权容器能启动），后者是 app 安全设计。两者正交，plan 与教训里绝不能写混。
4. **sandbox 最优修法是方案 C**，不是 `sandbox: false`。theme-manager 三个导出（`toggleTheme`/`getShellClass`/`DEFAULT_THEME`）全是无状态纯函数、零 Node 依赖，本就不该走 preload。改成 renderer.js 直接 `require`、preload 只留 ipc 桥，则 sandbox 保持默认 true（纵深防御不丢）、不引构建步骤、spec2 解耦不破（theme-manager.js 一行不动，仍是单一可测来源）。
5. **electron@33 不受 36.x 的 `electron.launch` 崩溃 bug 影响**，保持 `^33` 即可。

---

## Key Technical Decisions

### KTD1. e2e 真门放 CI，不放容器内
xvfb 在容器装不了（Finding 1）。容器内权威门继续跑 vitest 快门；e2e 真门加进 `ci.yml`（独立 job、xvfb-run、不继承 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`）。代价：当场拦不住坏 app（容器内 e2e 仍 skip/不跑），靠 CI 异步兜底 + 教训预防。诚实接受这个限制，不假装当场能拦。

### KTD2. sandbox 修法：A 方案（preload require + sandbox:false）
**⚠ 更新（2026-06-05，第二次重跑后实证推翻原决策）**：原 KTD2 写的「方案 C（renderer.js 直接 require theme-manager，保 sandbox:true）」**经实证是错的**——renderer 网页在 `nodeIntegration: false` 下没有 `require`，那句会 ReferenceError 崩、文档加载不出来（CDP 实测 `typeof require === undefined`）。研究 agent 当时误判「renderer 有 require」，我没实证就写进了 S3 教训，第二次重跑的 AI 照做、撞坑、e2e 红（**但门拦住了、坏 app 没进 main**）。

**实证过的正确修法 = A 方案**：preload `require('../lib/theme-manager')` + `contextBridge` 暴露 `window.api.theme.*`，renderer 用 `window.api.theme.*`，并在 `window-config` 加 `sandbox: false`（preload 要 require 自定义模块必须配它）。对本地可信 demo app 丢进程沙箱可接受。实测对照：方案 C → 本地 e2e 2 failed；A 方案 → 2 passed。已同步修正 CLAUDE.md S3。

### KTD3. 不手动修 app —— 修法靠 CLAUDE.md 教训，由重跑的 AI 自己写对
用户已选「重跑」路线。手动改 app 代码会被重跑覆盖、白改。正确做法：把修法（实证过的 A 方案，见 KTD2）写进 CLAUDE.md 教训，重跑时 AI 读到 → 写对。门是兜底：万一 AI 没照做或撞别的坑，CI e2e 真跑会 fail，暴露问题（第二次重跑就是这么被门拦下的）。教训预防 + 门兜底，双保险。

### KTD4. 删掉 `test.skip(!DISPLAY)`，让缺 DISPLAY 变 fail 而非假绿
`test.skip` 是当前最大的假绿来源（Finding 2 配套）。删掉后，e2e 只在有 xvfb 的 CI 跑（有 DISPLAY 真跑）；容器/本地不调 `test:e2e` 所以不受影响。缺 DISPLAY 时让它 fail，逼环境配对，别给假绿留后门。

---

## Implementation Units

「补门 + 教训」这批改的是 main 上的 spec1 骨架 + 基建（**此时 main 还没有 spec2 主题代码**，主题代码由后续重跑产生）。U1-U4 互相独立，可并行。

### U1. e2e 测试：删假绿守卫 + 加 --no-sandbox
- **Goal**：让 `e2e/app.spec.js` 在有 xvfb 的环境真能启动 Electron 并真断言。
- **Files**：`e2e/app.spec.js`
- **Approach**：删掉 spec1 冒烟测试里的 `test.skip(!process.env.DISPLAY, ...)` 那一行；给 `electron.launch({ args: [...] })` 的 args 数组开头加 `'--no-sandbox'`（与 `main.js` 路径并列）。main 上此刻只有 spec1 那一个 e2e 测试，主题 e2e 测试由重跑产出（届时 AI 沿用本文件已建立的「无 skip + --no-sandbox」模式）。
- **Test scenarios**：这是测试代码本身的改动。验证手段是 U3 的 CI e2e job 真跑：app 正常时该测试绿，app 坏（window.api 没注入）时 `toContainText('Wordspace')` 超时失败。
- **Verification**：CI e2e job 能拉起 Electron 并对内置文档断言通过（重跑前先用 main 现有 app 验证门本身是活的）。

### U2. playwright 配置 CI 加固
- **Goal**：防 `test.only` 漏测、CI 下加重试和合适 reporter。
- **Files**：`playwright.config.js`
- **Approach**：在现有 `{ testDir: './e2e', testMatch }` 基础上加 `forbidOnly: !!process.env.CI`、`retries: process.env.CI ? 1 : 0`、`reporter: process.env.CI ? 'github' : 'list'`。不改 testDir/testMatch。
- **Test scenarios**：无行为逻辑。`Test expectation: none -- 纯配置`。
- **Verification**：CI 上 e2e 用 github reporter 输出；本地 `npm run test:e2e` 仍用 list。

### U3. ci.yml 加独立 e2e job（真门）
- **Goal**：在 GitHub Actions 上真跑 e2e，作为「绿但坏」的兜底门。
- **Files**：`.github/workflows/ci.yml`
- **Approach**：新增一个独立 `e2e` job（与现有 `test` job 平级），步骤：checkout → setup-node(20, cache npm) → `npm ci` → `sudo apt-get update && sudo apt-get install -y xvfb` → `npx playwright install-deps chromium` → `xvfb-run -a --server-args="-screen 0 1280x720x24" npm run test:e2e`。**关键**：这个 job 绝不继承现有 job 级的 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（e2e 要真 Electron 二进制），所以两个 job 各写各的 env。
- **Patterns to follow**：现有 `test` job 的 checkout/setup-node/npm ci 结构。
- **Test scenarios**：`Test expectation: none -- CI 配置`。其有效性由「U1 改好后该 job 在 app 坏时变红」证明。
- **Verification**：push 后 GitHub 上出现 `e2e` check；对当前（正常的）spec1 app 跑绿。
- **Deferred 提醒**：把该 job 设为 branch protection 的 required check（否则红了也不挡合并）——这步要在 GitHub 设置里做，超出代码改动，记到执行序列里提醒 Colin。

### U4. CLAUDE.md 写 S3 教训
- **Goal**：把这次的根因和修法沉淀成教训，让重跑（及未来 spec）的 AI 读到后避坑。
- **Files**：`CLAUDE.md`
- **Approach**：按现有 `## Spec SN Lessons — YYYY-MM-DD` 格式新开 `## Spec S3 Lessons — 2026-06-05`，至少三条粗体单句标题 + 解释：
  1. **preload 在默认 sandbox 下不能 require 项目自定义模块**——纯逻辑模块（如 theme-manager）直接在 `renderer.js` 里 `require`，preload 只留真正跨进程的 ipc 桥，别在 preload require 它再 contextBridge 暴露。保持 `sandbox` 默认 true。（这是方案 C 的指导，重跑 AI 据此写对。）
  2. **e2e 真跑只能放 CI（GitHub Actions + xvfb），容器内装不了 xvfb**——防火墙白名单没 apt 源；`electron.launch` 要加 `--no-sandbox`（这跟 app 的 `webPreferences.sandbox` 是两回事）。
  3. **纠正 S1 那条「容器里全 skip = 退出码 0 = 成功」**——`test.skip` 不等于通过，它是假绿；真门必须能在 app 坏时 fail。
- **Test scenarios**：`Test expectation: none -- 文档`。可断言性：`git diff` 能看到 CLAUDE.md 新增 S3 段。

---

## Execution Sequence

1. **补门 + 教训进 main**（U1-U4，可并行实现 → 一起 commit、push 进 main）。push 前用 main 现有 spec1 app 让 CI e2e job 先绿一次，确认门本身是活的、不是误配。
2. **（手动一次性）把 CI `e2e` job 设为 required status check**（GitHub 仓库设置 → branch protection）。提醒 Colin，agent 没这权限。
3. **作废 PR #3 + 清理**：`gh pr close 3`、删远端 demo 分支；宿主切回 main、丢弃 spec2-preview 分支和那行临时 `sandbox: false`。
4. **从干净 main 重跑 spec2**（`run-spec.sh specs/f46-theme-demo.md`）。AI 读到 S3 教训 → 用方案 C 写对 app；新主题 e2e 测试沿用无-skip 模式 → PR 的 CI e2e 真跑。
5. **验证重跑产物**：CDP 截图确认 app 真能跑（文档显示 + 主题切换）；看新 PR 的 CI e2e check 绿。两者都过才算流程闭环成立。

---

## Scope Boundaries

### In scope
- 补 e2e 真门（CI）、删假绿守卫、CLAUDE.md S3 教训、重跑 spec2 + 验证。

### Deferred to Follow-Up Work
- **容器内当场真跑 e2e**：要动基建（Dockerfile 装 xvfb + Chromium 系统库、`init-firewall.sh` 白名单加 `deb.debian.org`/`security.debian.org`、走 npmmirror 镜像下 Electron 二进制）。这能把「CI 异步兜底」升级成「容器内当场拦截」，但属于动基建的大改，先跟 Colin 确认再单独做。
- **e2e 二进制下载在容器的方案**：与上同源。

### Outside this product's identity（非目标）
- **重新设计主题视觉**：文档纸面写死白 + 占满屏 → 切换肉眼几乎只见按钮文字变化。这是产品设计取舍（要不要更多 UI 吃主题色、松动「纸面绝对不变」AC），不是测试可靠性问题，留作单独产品讨论。

---

## Risks & Mitigations

- **重跑时 AI 没照 S3 教训写、又踩 sandbox 雷**：CI e2e 门兜底——真跑会 fail，PR 红暴露。但 agent 当场查不到 CI（token 缺 Actions:read），靠人看 PR 红勾。可接受（教训已大幅降低概率）。
- **CI e2e job 配错导致误绿/误红**：执行序列第 1 步要求先用 main 现有正常 app 验证门是活的（app 好该绿），再依赖它。
- **删 test.skip 后某无 xvfb 环境误跑 e2e 变红**：容器内权威门和本地默认不调 `test:e2e`，只有 CI（有 xvfb）跑，风险可控。
- **node_modules 平台污染**：宿主验证时装的 darwin electron 二进制经 bind mount 进了容器，但重跑容器内只跑 vitest（不需 electron 二进制），无影响。重跑前无需特意重装。
