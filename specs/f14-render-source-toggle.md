---
id: S3
title: 渲染 / 源码切换（F14 收窄版）
slug: f14-render-source-toggle
status: draft
owner: Colin
depends_on: [S1, S2]
narrowed_from: F14
created: 2026-06-06
requires_va: true
---

# S3 · 渲染 / 源码切换（F14 收窄版）

> 在 spec 1 的文档查看器上，底部状态栏加一个开关：点一下，`#doc-container` 在「排版好的渲染视图」和「这份文档的 HTML 源码文本」之间整篇切换。这是 F14 砍到只剩「一个开关 + 只读源码」的 demo 版。
>
> ⚠ **2026-06-11 被 S6 修订**：S6（基础编辑）落地后，源码视图的数据源从「启动缓存的原串」改为「当前编辑后文档的实时 `innerHTML`」（无编辑时内容等价、本 spec 的 VA 不受影响、一字未改）。下文「实现落点」里缓存原串的描述以 `specs/f40-basic-editing.md` §3 为准。

---

## 1. 产品价值（Why）

每份文档本身就是一个 HTML 文件。这个开关让用户一键在「渲染视图」（排版好的文档）和「源码视图」（底层 HTML）之间切——既能像看网页一样读，也能钻进源码看 AI 到底往文档里写了什么 HTML。对带外部 AI 协作的工作流尤其有用：用户能直接核对 AI 写进文档的 HTML，而不是只能在渲染视图里间接看。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- **状态栏切换按钮**：在 spec 2 建好的底部状态栏里再加一个开关，点击在「渲染视图 / 源码视图」之间整篇切换当前这份文档。
- **渲染视图**：沿用 spec 1，把文档 HTML 渲染进 `#doc-container`（排版好的标题 / 正文）。
- **源码视图（只读）**：点开关切到源码视图，`#doc-container` 改为**以纯文本形式显示这份文档的 HTML 源码**（用户看到 `<h1>…</h1>` 这种带尖括号的标签文字），只读、不可编辑。
- **切回重新渲染**：从源码视图切回渲染视图，按同一份 HTML 重新渲染呈现。
- **可测的视图逻辑（与 Electron / DOM 解耦）**：视图状态机 + 「视图 → 显示方式」映射抽成**不依赖 Electron / DOM** 的纯模块（如 `src/lib/view-mode.js`），Vitest 直接测。

### 🚫 Out of Scope（本 spec 明确不做 —— F14 收窄）

- **源码视图可编辑 + 即时落盘** —— 本 spec 源码视图**只读**；编辑源码勾回 F40 实时保存 + F42 的 HTML→model 解析，是 F14 最重的依赖，demo 不碰。
- **语法高亮** —— 源码就是一段纯文本，不分色。
- **破损 HTML 的 best-effort 降级 / 不识别标签往返保真** —— 骑在 parked 的 F42 上，不做。
- **视图模式按文档隔离** —— demo 只有一份内置文档，砍掉多文档隔离。
- **渲染 / 源码并排（split）双栏** —— 只整篇切换。
- **大文档（10 万字）性能、跨平台一致性、并发（源码态外部 AI 改文件）、切换动画 / 性能预算** —— 全砍。

---

## 3. 既定约束

- **源码视图只读、天然安全**：源码视图用 `textContent` 显示 HTML 字符串——浏览器把标签当**文字**显示（自动转义尖括号），不会把它当 HTML 再执行一遍，所以没有 XSS / CSP 顾虑，也不碰 spec 2 的 CSP（`default-src 'self'`）。**不要用 `innerHTML` 显示源码**（那会把源码又渲染回去，是 bug）。
- **切换只换显示形态、不改文档内容**：渲染态和源码态是**同一份 HTML** 的两种看法；切换不修改文档内容本身。
- **实现落点（让验收门对得上，必须遵守）**：
  - 切换按钮放 spec 2 的底部状态栏 `#status-bar` 内，按钮 id **`#view-toggle`**。
  - 文档容器沿用 spec 1 的 **`#doc-container`**。
  - **渲染态**：`#doc-container` 用 `innerHTML` 渲染文档 HTML（里面是真实的 `<h1>`/`<p>` 元素，其 `textContent` 是排版后的纯文字、不含尖括号标签）。
  - **源码态**：`#doc-container` 用 `textContent` 显示**同一份原始整篇文档 HTML 串**——即 `getDocContent()`（IPC `get-doc-content` → `loadBuiltinDocument()`）返回的那份原串（含 `<!DOCTYPE>` / `<h1>` / 正文）。**renderer 在启动加载时缓存这份原串**，toggle 到源码态时 `#doc-container.textContent = 该原串`。`view-mode.js` 只负责「当前哪个视图 + 该视图用 innerHTML 还是 textContent」的决策，**持有源串、写 DOM 是 renderer 的事**（纯模块拿不到文档 HTML）。
  - **toggle 必须纯同步**：切换是本地视图切换，**不得在 toggle 时重新发 IPC / 异步取文档**——渲染态用启动时缓存的原串同步 `innerHTML`，源码态同步 `textContent`；否则 e2e 采集慢一拍会 flaky。
  - 视图状态机 + 映射放 `src/lib/view-mode.js`（不 `require('electron')`），preload `require` + `contextBridge` 暴露成 `window.api.view.*`，renderer 用 `window.api.view.*`（别自己 `require`，沿用 S3 教训）。
- **沿用既有测试纪律**（见 `CLAUDE.md` S1/S3/S4）：容器内权威门 = Vitest 快门；e2e 真门放 CI（xvfb）；**可见验收用 `specs/f14-render-source-toggle.va.json`（VA）按 `textContent` 内容真验，不查 class 代理**；本 spec `requires_va: true`，缺 VA 会被 `va-coverage` 当场判红。
- **依赖安装**沿用 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（驱动脚本已处理）。

---

## 4. UX / 交互

### 4.1 触发与位置

**所属 UI 组件：** 底部状态栏（spec 2 建的 `#status-bar`）。
**触发方式：** 点击状态栏上的渲染 / 源码切换开关 `#view-toggle`。

### 4.2 主流程（人在 macOS 本机观察）

1. 用户运行 app（`npm start`）：默认渲染视图，`#doc-container` 里是排版好的文档。
2. 用户点状态栏的渲染 / 源码开关。
3. 系统把 `#doc-container` 切到源码视图：显示这份文档的 HTML 源码文本（看得到 `<h1>…</h1>` 等标签）。
4. 用户再点一次，系统按同一份 HTML 重新渲染，切回排版好的渲染视图。

### 4.3 边界情况

| 情境 | 期望行为（用户视角） |
|---|---|
| 反复点 N 次开关 | 最终视图与点击次数的奇偶一致，无错乱；内容不丢失 |
| 源码视图里 | 只读——能看不能改（demo 收窄；编辑源码归 F14 完整版） |
| 重开 app | 回到默认渲染视图（不持久化） |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号（三件可见实物 + compound 实物）

- **PR**：unattended run 结束时分支已 push、PR 已开。
- **绿门**：容器内 `npm test`（Vitest 快门）退出码 0，含视图状态机断言；**CI 上 e2e job（xvfb 真跑 Electron）也绿**——其中 `va-runner` 按 `f14-render-source-toggle.va.json` 真验「渲染态不漏标签、源码态真显标签、可逆」（`textContent` 内容门），`va-selftest` 变异自检证门有牙。
- **能用**：人在 macOS 本机 `npm start`，点开关在排版视图 ↔ HTML 源码文本之间切，肉眼一眼能看出。
- **学到东西**：本 run 自动吃到 `CLAUDE.md` S1/S3/S4 教训（纯逻辑解耦 / preload sandbox / VA 验收门 / computed-and-content 断言）；若撞到新坑追加。

### 5.2 Vitest 验收（必过，构成权威绿 / 红门）

**视图状态机**

- [ ] **[P1] Given** 从某视图出发 **When** 应用切换动作 N 次 **Then** 最终视图与 N 的奇偶一致。
- [ ] **[P1] Given** 初始状态 **When** 读取当前视图 **Then** 为 `rendered`（明确的默认值）。

**视图 → 显示方式映射**

- [ ] **[P1] Given** `rendered` / `source` 两个视图 **When** 各自求「该用什么方式把 HTML 放进容器」**Then** 两者不同（一个是「按 HTML 渲染」、一个是「按纯文本显示源码」）——纯逻辑决策，不启动 Electron。

> 这些断言全部不启动 Electron、不需要显示环境——容器里稳定可跑。renderer 拿到这个决策后真去写 `innerHTML` 还是 `textContent`，由 e2e/VA 在真窗口里验。

### 5.3 可见验收（VA）+ Playwright Electron E2E（CI 上 xvfb 真跑）

由 `specs/f14-render-source-toggle.va.json` 驱动，`va-runner` 真开 app 按 `#doc-container` 的 **`textContent` 内容**判定（不是查 class）：

- [ ] **[P1] Given** 默认渲染态 **When** 读 `#doc-container` 文本 **Then** 含真实正文「Welcome to Wordspace」且不含开标签「<h1」（真渲染了、没漏源码）。
- [ ] **[P1] Given** 点一次 `#view-toggle` 进源码态 **When** 读 `#doc-container` 文本 **Then** 含开标签「<h1」**且**含正文「Welcome to Wordspace」（真把这份文档的 HTML 源码显成文字，不是随便塞的含 `</` 假串）。
- [ ] **[P1] Given** 再点一次切回 **When** 读 `#doc-container` 文本 **Then** 又含正文、不含「<h1」（可逆回真渲染态）。
- [ ] **[P2]** `va-selftest` 变异自检：把切换逻辑 / 容器内容弄成「源码态没真显源码」这种坏状态时，上面的 VA 必须翻红——证明这道内容门不是哑的。

### 5.4 Compound 交付物（必产出）

- [ ] **[P1] 自动复用既有教训**：本 run 启动时自动 load `CLAUDE.md` 里 S1/S3/S4 的教训（测试解耦 / preload require + sandbox:false / VA 验收门 / 强断言验真实内容而非 class 代理）。
- [ ] **[P1] 撞到新坑则追加**：若撞到新约束，追加进 `CLAUDE.md`；driver 脚本结束时报告 compound `WROTE / MISSING`、VA `HAS / MISSING`。

---

## 6. 依赖关系

### 6.1 Feature 间（spec 间）

- **上游 · S1 最小 Electron 骨架**：渲染视图就是 S1 把文档 HTML 渲染进 `#doc-container` 那条路径；源码态是同一容器换 `textContent` 显示。
- **上游 · S2 暗 / 亮主题切换**：切换按钮加在 S2 建的底部状态栏 `#status-bar` 里，与主题开关并排。

### 6.2 后台能力

- **HTML 渲染 / 源码显示**：同一份文档 HTML，渲染态走 `innerHTML`、源码态走 `textContent`，是两个方向的显示决策，不新增解析 / 序列化架构（F14 完整版那块骑 F42 的硬骨头本 spec 不碰）。

### 6.3 Compound 期望

- 本 run 直接复用 `CLAUDE.md` 里 S1/S2/S3/S4 写下的教训，少走前面踩过的弯路——这是 demo 现场要指给人看的「系统因为前几条变聪明了」。尤其本条会用上 S4 刚扩出来的「VA 验内容（`textContent`）」能力。
