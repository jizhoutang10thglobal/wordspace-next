---
id: S2
title: 暗 / 亮主题切换（F46 收窄版）
slug: f46-theme-demo
status: draft
owner: Colin
depends_on: [S1]
narrowed_from: F46
created: 2026-06-03
requires_va: true
---

# S2 · 暗 / 亮主题切换（F46 收窄版）

> 在 spec 1 骨架上，底部状态栏加一个开关：暗 / 亮切换 **app 外壳**，**文档纸面颜色保真不变**。这是 F46 砍到只剩一个开关的 demo 版。

---

## 1. 产品价值（Why）

夜里写作想让界面柔和不刺眼，但又不希望文档里自己设计的颜色被改。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- **底部状态栏**：在 spec 1 的窗口里引入一个常驻的底部状态栏，放一个暗 / 亮切换开关。
- **app 外壳暗 / 亮切换**：点开关，app 外壳（状态栏 + 文档纸面之外的窗口背景 / 边距）在暗色 / 亮色之间切，即时生效。
- **文档纸面颜色保真**：切换主题时，文档纸面内（spec 1 渲染的那份 HTML 文档自己的背景 / 文字 / 颜色）不受影响。
- **可测的主题逻辑（与 Electron / DOM 解耦）**：主题状态机 + “主题 → app 外壳样式”映射抽成**不依赖 Electron / DOM** 的纯函数，Vitest 直接测。

### 🚫 Out of Scope（本 spec 明确不做 —— F46 收窄）

- **反转色预览** —— 归 F46 完整版，本 spec 不做。
- **外部 AI 通过接口改写文档** —— 归别的 feature。
- **跨平台（Windows / macOS）一致性保证** —— 不做（只在本机 Electron 跑过即可）。
- **大文档（10 万字）性能** —— 不做。
- **主题持久化到重启后** —— 不做（重开回默认即可，主题只是当前会话的显示状态）。
- **多套主题 / 自定义配色 / 色板编辑** —— 不做（只做暗 / 亮二态）。

---

## 3. 既定约束

- **主题只改外壳，不改文档**：暗 / 亮只作用于 app 外壳；文档纸面颜色始终由那份 HTML 文档自己决定。这是本 spec 的核心正确性，必须有测试守住。
- **沿用 spec 1 的测试纪律**（应已写进 `CLAUDE.md`，并按 S3 教训更新）：容器内权威门 = Vitest（`npm test`）快门，无显示容器里可跑；容器内不起 Electron GUI；可测逻辑与 Electron / DOM 解耦。**Playwright Electron E2E 是真门，放 CI（GitHub Actions + xvfb）真跑**——容器装不了 xvfb，所以容器内不跑 e2e，由 CI 那道兜住「vitest 全绿但 app 打不开」。**不要再用 `test.skip(!DISPLAY)` 假绿**（见 CLAUDE.md S3）。真窗口视觉验证仍可由人在 macOS `npm start` 看。
- **依赖安装**沿用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（驱动脚本已处理）。

---

## 4. UX / 交互

### 4.1 触发与位置

**所属 UI 组件：** 底部状态栏（常驻于 spec 1 窗口底部）。
**触发方式：** 点击状态栏上的暗 / 亮切换开关。

### 4.2 主流程（人在 macOS 本机观察）

1. 用户运行 app（`npm start`）：窗口里渲染文档 + 底部有状态栏（默认亮色外壳）。
2. 用户点状态栏的暗 / 亮开关。
3. 系统把 app 外壳切到暗色（状态栏、文档外的窗口背景变暗）。
4. 系统保持文档纸面里的颜色不变（标题色、正文色、任何用户设计色）。
5. 用户再点一次，系统把外壳切回亮色。

### 4.3 边界情况

| 情境 | 期望行为（用户视角） |
|---|---|
| 文档里有彩色内容（如某段带颜色的标题） | 切到暗色外壳后，这些颜色原样显示，不被染暗 |
| 快速反复点 N 次 | 最终主题与点击次数的奇偶一致，无错乱 |
| 重开 app | 回到默认亮色外壳（不持久化，符合 demo 收窄） |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号（三件可见实物 + compound 实物）

- **PR**：unattended run 结束时分支已 push、PR 已开。
- **绿门**：容器内 `npm test`（Vitest 快门）退出码 0，含“切换后文档纸面色不变”的断言；**CI 上 e2e job（xvfb 真跑 Electron）也绿**，确认 app 真能打开（堵「vitest 绿但 app 坏」）。
- **能用**：人在 macOS 本机 `npm start`，点开关外壳暗 / 亮切，文档颜色不动。
- **学到东西**：`CLAUDE.md` 已被 spec 1 写过一段教训、本 run 自动吃到；若本 run 撞到新坑则追加。

### 5.2 Vitest 验收（必过，构成权威绿 / 红门）

**主题状态机**

- [ ] **[P1] Given** 从某个主题出发 **When** 应用切换动作 N 次 **Then** 最终主题与 N 的奇偶一致。
- [ ] **[P1] Given** 初始状态 **When** 读取当前主题 **Then** 为亮色（明确的默认值）。

**主题 → 外壳样式映射**

- [ ] **[P1] Given** 暗 / 亮两个主题 **When** 各自求“app 外壳样式”（class 或 CSS 变量集合）**Then** 两者不同。

**文档纸面解耦（核心）**

- [ ] **[P1] Given** 暗 / 亮两种主题 **When** 求表示“文档纸面样式”的值 **Then** 两者完全相同——即文档样式不从主题派生。这证明的是“主题模型不从主题派生文档样式”，不是“渲染后文档颜色一定没变”——级联渗色（全局 CSS / 外壳变量漏进文档容器）由渲染层的 computed-style 检查守（写好但容器内 skip），靠 macOS 本机肉眼验。

### 5.3 Playwright Electron E2E（CI 上 xvfb 真跑，构成 app 集成门）

- [ ] **[P2] Given** 启动 app **When** 点状态栏开关 **Then** 断言 app 外壳的 class / 背景变了，且文档纸面内某个元素的 computed color 没变。
- [ ] **[P2] Given** app 因 preload / 集成层坏掉（如 `window.api` 没注入、文档空白）**When** 在 CI 用 `xvfb-run npm run test:e2e` 真跑 **Then** E2E 断言失败、CI e2e job 红——**不再用 `test.skip(!DISPLAY)` 让坏 app 假绿过门**。`electron.launch` 的 args 加 `--no-sandbox`（无特权 runner 约束，与 app 的 `webPreferences.sandbox` 是两回事）。

### 5.4 Compound 交付物（必产出）

- [ ] **[P1] 自动复用既有教训**：本 run 启动时已自动 load `CLAUDE.md` 里 spec 1 / S3 的教训（测试解耦 / e2e 真跑放 CI / preload 别在 sandbox 下 require 自定义模块 / electron 跳过下载），少走前面踩过的弯路。
- [ ] **[P1] 撞到新坑则追加**：若本 run 撞到 spec 1 未覆盖的新约束，把它追加进 `CLAUDE.md`；driver 脚本结束时报告 compound `WROTE / MISSING`。

---

## 6. 依赖关系

### 6.1 Feature 间（spec 间）

- **上游 · S1 最小 Electron 骨架**：状态栏、主题开关都加在 S1 的窗口 / 渲染结构上。若 S1 的结构没有清晰的“外壳 vs 文档纸面”分层，本 spec 需先引入该分层（如把文档放进独立容器，状态栏在其外）。

### 6.2 后台能力

- **Electron 桌面运行时**：主题切换作用于真窗口，视觉效果只在 macOS 本机看得到。

### 6.3 Compound 期望

- 本 run 应直接复用 `CLAUDE.md` 里 spec 1 写下的教训，少走 spec 1 踩过的弯路——这是 demo 现场要指给人看的“系统因为上一条变聪明了”。
