---
id: S1
title: 最小 Electron 骨架
slug: skeleton
status: draft
owner: Colin
depends_on: []
created: 2026-06-03
---

# S1 · 最小 Electron 骨架

> 一个能跑的最小 Electron 桌面 app：开窗 + 渲染一份内置 HTML 文档；接上 Vitest + Playwright；留一个能过的冒烟测试。后续 feature 都长在这个骨架上。

---

## 1. 产品价值（Why）

给"全自动 feature shipping" demo 一个 greenfield 起跑点：一个真能打开、真能显示文档的 app 外壳，让后面的 feature 有地方加。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- **开窗 + 渲染内置文档**：启动后创建一个桌面窗口，加载并渲染一份内置的本地 HTML 文档，用户能看到标题 + 一两段正文。
- **文档进独立容器元素**：文档渲染进一个独立的容器元素，而非直接铺满裸窗口，为 spec 2 的“外壳 vs 文档纸面”分层预留接缝。
- **测试框架接入**：Vitest（单元）+ Playwright（Electron E2E）都接好，`npm test` 与 `npm run test:e2e` 可跑。
- **可测的逻辑层（与 Electron 解耦）**：把“决定加载哪个文档 / 读取文档内容 / 生成窗口配置”等纯逻辑抽到**不 import electron** 的模块，让 headless Vitest 直接测。

### 🚫 Out of Scope（本 spec 明确不做）

- 任何编辑 / 输入功能 —— 归后续 feature。
- 文件树 / 打开任意文件 / 文件对话框 —— 本骨架只渲染那一份内置文档。
- 主题 / 暗亮切换 / 样式美化 —— 归 **S2**。
- 应用菜单、设置、自动更新、打包分发 —— 本 spec 明确不做。
- 多窗口 / 多标签 —— 单窗口即可。

---

## 3. 既定约束

- **权威测试门 = Vitest（`npm test`）**：无显示的纯命令行容器里可跑，是 unattended run 判绿 / 红的唯一权威依据。
- **容器内不起 Electron GUI**：本 dev container 是无屏幕 Linux 沙盒，没有 `DISPLAY`、没装 GUI 系统库，Electron 窗口起不来。进测试门的断言不能依赖“真的开窗”——要么抽成纯模块单测，要么放进无 `DISPLAY` 自动 skip 的 E2E。真窗口视觉验证由人在 macOS `npm start` 完成，不属于自动门。
- **依赖安装跳过 Electron 二进制下载**：容器防火墙未放行 GitHub release 资源域名，安装时设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（驱动脚本已处理）；不影响 Vitest。Electron 仍作为 devDependency 保留，真二进制在 macOS 本机安装。

---

## 4. UX / 交互

### 4.1 触发与位置

**所属 UI 组件：** 整个应用窗口。
**触发方式：** app 启动（`npm start`）时自动加载并渲染内置文档，无需任何用户操作。

### 4.2 主流程（人在 macOS 本机观察）

1. 用户运行 app（`npm start`）。
2. 系统弹出一个桌面窗口。
3. 系统在窗口的文档容器里渲染内置 HTML 文档：用户看到文档标题和正文。
4. 用户关闭窗口，app 退出。

### 4.3 边界情况

| 情境 | 期望行为（用户视角） |
|---|---|
| 内置文档文件缺失 | 加载逻辑返回明确错误 / 抛错，能被单测断言到，不静默白屏 |
| 在无 `DISPLAY` 的环境跑 E2E | E2E 自动 skip，不报红、不报错 |
| 窗口尺寸取值 | 给一个合理默认（如 1024×768 量级），宽高为正，不为 0 或负 |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号（三件可见实物 + compound 实物）

- **PR**：unattended run 结束时分支已 push、PR 已开（标题 / 正文由 lfg / ce-work 生成）。
- **绿门**：容器内 `npm test` 退出码 0。
- **能用**：人在 macOS 本机 `npm start`，窗口弹出并显示文档内容。
- **学到东西**：仓根 `CLAUDE.md` 多出一段本 run 的环境教训（git diff 可见）——spec 2 自动吃到。

### 5.2 Vitest 验收（必过，构成权威绿 / 红门）

**文档加载逻辑**

- [ ] **[P1] Given** 内置 HTML 文档存在 **When** 调用“解析 + 读取内置文档”的函数 **Then** 返回的 HTML 字符串包含文档里那个可识别标记（如某个标题文字）。
- [ ] **[P1] Given** 内置 HTML 文档文件 **When** 检查其存在性与内容 **Then** 文件存在且非空。
- [ ] **[P1] Given** 目标文档路径不存在 **When** 调用加载逻辑 **Then** 给出可断言的错误，不静默吞掉。

**窗口配置**

- [ ] **[P1] Given** 生成 BrowserWindow 配置的函数 **When** 调用它 **Then** 返回宽高均为正、加载目标指向那份内置文档。

> 这些断言全部不启动 Electron、不需要显示环境——容器里可跑。

### 5.3 Playwright Electron E2E（写好，无 `DISPLAY` 时自动 skip）

- [ ] **[P2] Given** 一个 `_electron.launch()` 的 E2E **When** 启动 app 并等到窗口 **Then** 断言窗口里能看到文档内容（标题 + 正文）。
- [ ] **[P2] Given** 当前环境 `!process.env.DISPLAY` **When** 运行 `npm run test:e2e` **Then** 该 E2E `test.skip(...)`，容器里“全跳过 = 通过”，带屏 macOS / CI 才真跑。

### 5.4 Compound 交付物（必产出）

- [ ] **[P1] 写教训进 `CLAUDE.md`**：run 结束时，仓根 `CLAUDE.md` 被追加一段简短 lessons，至少覆盖本 run 撞到的环境约束：测试逻辑须与 Electron 解耦、Playwright E2E 在无 `DISPLAY` 时 skip、`npm install` 跳过 Electron 二进制下载。
- [ ] **[P1] 可断言**：`git diff` 显示 `CLAUDE.md` 有非空新增内容（含可识别的 lessons 标记）；driver 脚本结束时报告 compound `WROTE / MISSING`（见 `scripts/run-spec.sh`）。

---

## 6. 依赖关系

### 6.1 Feature 间（spec 间）

- **下游 · S2 暗 / 亮主题切换**：S2 的状态栏开关与“外壳 vs 文档纸面”分层都加在本骨架的窗口 / 渲染结构上；本 spec 的“文档进独立容器元素”就是给它留的接缝。

### 6.2 后台能力

- **Electron 桌面运行时**：app 以桌面窗口形态运行，真窗口只在 macOS 本机起得来。

### 6.3 Compound 期望

- 本 run 是 demo 的第一条 spec，负责把环境教训写进仓根 `CLAUDE.md`。Claude Code 每次启动自动加载 `CLAUDE.md`，所以 spec 2 的 run 一启动就吃到它——这段 `CLAUDE.md` diff 就是 demo 现场要指给人看的“系统变聪明了”的起点。
