---
title: 编辑区 quick fixes —— 手动更新 + 砍预览/历史/侧栏/Float
status: active
date: 2026-06-17
origin: 用户直述（5 个 quick fix）+ 对比截图（app vs ui-demo）
branch: 待建 fix/editor-quickfixes（从 main）
---

# 编辑区 quick fixes（v0.2.x）

## 问题 frame
v0.2.0 发出后，用户对比 app 与 ui-demo，要做一轮收敛：app 暂时**只做编辑区**（Wendi：左侧文件管理先不要），
顺带砍掉几个现在没用/多余的入口，并补一个**手动检查更新**入口。都是小改，多数是删除。

## Scope（5 件）
1. **加手动检查更新**：macOS 应用菜单 `Wordspace Next` → 「关于 Wordspace Next」**下面**加「检查更新…」。点击 → 查更新 → 有新版问用户「是否下载并安装」、用户决定；没有则提示「已是最新」；出错提示失败。
2. **删「预览」按钮 + 功能**（右上角 预览/编辑 切换）。
3. **删「历史版本」按钮 + 功能**（右上角按钮 + 弹窗 UI）。
4. **删整个左侧文件管理栏**（arc-sidebar 门面 + lockout）→ app 单栏、编辑区铺满。
5. **插入面板去掉「Float 浮动」**，只保留「Flow 文档流」。

## 非目标 / 边界
- **不动 iframe 里用户文档的内容/样式**（保真红线）。编辑区「装真 HTML 进 iframe」是产品本质，不为像 ui-demo 原型去伪造假块——本轮不碰编辑区内容观感。
- **不改启动自动更新行为**：启动仍自动查+静默下载+弹「重启安装」；手动入口是**叠加**，让用户自己决定是否下载（决策：auto 路径保持原样，仅 manual 路径加「先问再下载」）。
- 画布的自由拖动/缩放不动（item 5 只去插入面板的 Float 选项；已有元素拖动仍可转 absolute）。
- 历史「存盘归档」后端（main/history.js 在 saveDoc 时写历史文件）**先保留**（不可见、动它要碰 save 路径，风险不值）；本轮只删历史的**可见 UI**。若要彻底删归档另开单元。

## 关键决策
- **手动 vs 自动更新区分**：`autoUpdater.autoDownload = false`，用模块级 `manualCheck` 标志分流：
  - `update-available`：manual → 弹「发现 vX，下载并安装？」用户选是才 `downloadUpdate()`；auto（启动）→ 直接 `downloadUpdate()`（保持原静默下载）。
  - `update-not-available`：manual → 弹「已是最新（当前 vX）」；auto → 静默。
  - `update-downloaded`：沿用现有「立即重启/稍后」弹窗（两条路共用）。
  - `error`：manual → 弹「检查更新失败」；auto → 仅 console（同现状）。
- **dev 态**：`!app.isPackaged` 时手动点「检查更新…」弹「开发模式无法检查更新」（electron-updater 在 dev 不工作）。
- **预览删除后画布常驻编辑态**：去掉 toggleMode，wireEditor 里 `canvas.enable()` 保留（永远可编辑）。repositionToolbar 里我之前加的 `canvas.getState().enabled` 守卫无害可留。

## 实现单元

### U1：手动检查更新（菜单 + updater 分流 + 纯弹窗逻辑 + 单测）
- **文件**：`src/main/main.js`（菜单加项 + setupAutoUpdater 重构为 auto/manual 分流 + 模块级 `checkForUpdatesManual()`）、`src/lib/update-prompt.js`（加纯函数 `buildAvailableDialogOptions(version)` / `buildUpToDateDialogOptions(currentVersion)` / `buildCheckErrorDialogOptions()` + 判定 `shouldDownload(responseIndex)`）、`test/update-prompt.test.js`（补新函数单测）。
- **做**：
  - 菜单：app submenu 改 `[{role:'about'}, {label:'检查更新…', click: checkForUpdatesManual}, {type:'separator'}, {role:'quit'}]`。
  - `setupAutoUpdater`：`autoUpdater.autoDownload=false`；按上「关键决策」挂 4 个事件 + manualCheck 分流；启动仍 `checkForUpdates()`（auto 路径）。
  - `checkForUpdatesManual()`：dev → 弹开发模式提示；packaged → `manualCheck=true` + `autoUpdater.checkForUpdates()`，catch 出错弹失败 + 复位 manualCheck。
  - 弹窗文案/按钮/判定走 update-prompt.js 纯函数（electron 只负责 showMessageBox + 接 response）。
- **验证**：单测覆盖新纯函数；手动构造 dev 态点菜单弹「开发模式无法检查更新」（本地 dev 可肉眼验）；packaged 真更新链路无法本地常规验（发版后实测，沿用既有更新实证手段）。

### U2：删「预览」
- **文件**：`src/renderer/index.html`（删 `#mode-btn`）、`src/renderer/shell.js`（删 `modeBtn` 引用、`toggleMode()`、`modeBtn.onclick`、prepFrame 里 `modeBtn.disabled`、wireEditor 里 `modeBtn.textContent`）。
- **保留**：wireEditor 的 `canvas.enable()`（常驻编辑态）。
- **验证**：右上角无「预览」；编辑/拖拽/选择照常；e2e 不再点 #mode-btn。

### U3：删「历史版本」UI
- **文件**：`src/renderer/index.html`（删 `#history-btn`、`#history-modal` 整块）、`src/renderer/shell.js`（删 `historyBtn`、`showHistory()`、`formatTs()`、`historyBtn.onclick`、`#history-close` 绑定、prepFrame 里 `historyBtn.disabled`）。
- **保留**：main/history.js 存盘归档（不可见、不碰 save 路径）。
- **验证**：右上角无「历史版本」；保存照常（含归档）；e2e 删历史用例。

### U4：删左侧文件管理栏
- **文件**：`src/renderer/index.html`（删 `<aside id="sidebar">` 整块含 lockout）、`src/renderer/shell.css`（删全部 `.arc-*` + `.sidebar-lock*` + `.arc-avatar`；body 仍 `display:flex`，`#main` `flex:1` 自然铺满单栏）。
- **验证**：无左栏，编辑区占满窗口；CSP/保真不受影响（侧栏本是父层 chrome）。

### U5：插入去 Float
- **文件**：`src/editor/insert.js`（删 `floatBtn` + Float 分支 + `insert-modes` 切换；`insert()` 恒走 `placeFlow`；可删 `placeFloat` 或留作未用，倾向删 UI 触发、保留纯工厂函数不动以免动到单测）、`src/renderer/shell.css`（`.insert-modes`/`.insert-mode` 可留可删，无引用即死规则，删之）、`test/*insert*`（若有 Float/placeFloat 单测，相应调整）。
- **做**：插入面板只剩 10 类型网格（Flow），无 Flow/Float 切换条；新元素恒插入文档流（选中元素后插其后 / 否则插 body 顶）。
- **验证**：插入面板无「Float 浮动」；插入元素进文档流；现有插入单测（createElement 工厂）不破。

### U6：e2e/单测适配 + 本地真跑
- **文件**：`e2e/app.spec.js`
- **做**：删/改受影响用例 ——「启动后显示空态首页 + 左侧文件栏门面」去掉侧栏断言；删「回归门：预览模式隐藏气泡」（#mode-btn 没了）；删「侧栏 lockout」（侧栏没了）；删「历史版本：保存两次后可恢复旧版」（历史 UI 没了）。其余（编辑/工具栏/保真/弹层不吃点击/拖动/nudge/slash/危险scheme/关窗拦截）保留。
- **验证**：本地 host `npm run test:e2e` 全绿 + `npm test` 全绿；推 CI e2e 真门绿。

## Test 场景
- 手动更新纯函数：available/up-to-date/error 弹窗的 message/buttons/默认键 + shouldDownload 判定（单测）。
- dev 态点「检查更新…」弹开发模式提示（手验）。
- 删除项回归：右上角只剩「打开 / 保存（+插入）」；无预览/历史/侧栏；插入无 Float。
- 保真：存盘不含任何 chrome 痕迹（arc-*/sidebar/...）。

## 风险 / 依赖
- 手动更新的「packaged 真链路」本地常规验不了，只能发版后实测（既有更新实证手段）。纯弹窗逻辑用单测兜，main.js 接线靠 review + dev 态手验。
- 删历史 UI 但留后端归档：若后续要「彻底无历史」，再开单元删 saveDoc 的归档调用（碰 save 路径，单独验保真）。
- 本轮后大概率发 **v0.2.1**（patch，bug/清理类）；发版走既有 tag 流程，**合并与打 tag 分步**（v0.2.0 那次教训）。

## Deferred 到实现时
- insert.js 里 `placeFloat` 纯函数留不留（倾向留、只摘 UI 触发，少动单测）。
- 手动更新「检查中…」要不要加一个 progress/disable 防连点（先不做，查更新很快）。
