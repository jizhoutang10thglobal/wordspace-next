---
id: S5
title: 状态栏发布徽标（shipping demo 增量）
slug: release-badge
status: draft
owner: Colin
depends_on: [S1, S2]
created: 2026-06-08
requires_va: true
---

# S5 · 状态栏发布徽标 + 显式更新弹窗（shipping demo 增量）

> 在底部状态栏加一个固定文字徽标 `Shipped by the pipeline`。**刻意做到极简**——本 spec 的用途不是展示功能本身，而是给 macOS shipping 尾巴当「v2 增量」：v1（无徽标）→ 经 lfg 实现并发版 → v2（徽标出现），让「老 app 自动更新成新版」在屏幕上一眼可见。
>
> 另含一个配套改动（Colin 2026-06-10 拍板）：自动更新从「静默下载 + 系统通知 + 退出时装」升级为**显式弹窗**——`update-downloaded` 后弹 dialog 问用户，点「立即重启」走 `quitAndInstall()`，录屏更连贯。注意：这个弹窗装进 v0.0.2 后，要 v0.0.2→v0.0.3 那次更新才看得到（v0.0.1 里跑的是旧 updater 代码）。

---

## 1. 产品价值（Why）

给 shipping 流水线一个**最小、可见、可逆判**的改动当演示增量。徽标出现 = 这一版是流水线自动产出并发布的，肉眼即可区分新旧版本——正是自动更新 demo 的视觉锚点。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- 底部状态栏（spec 2 的 `#status-bar`）内显示固定文字徽标 `Shipped by the pipeline`，与现有 `#theme-toggle` / `#view-toggle` 并排。徽标本身纯渲染、静态文字，无交互。
- **显式更新弹窗**：`src/main.js` 的 updater 接线从 `checkForUpdatesAndNotify()` 改为 `checkForUpdates()` + 监听 `update-downloaded` → 弹 `dialog.showMessageBox`（「新版本 vX.Y.Z 已下载，立即重启更新？」，按钮「立即重启」/「稍后」）→ 用户选立即重启则 `quitAndInstall()`，选稍后则维持原行为（退出时自动装）。
- 弹窗的**决策逻辑抽纯模块**（如 `src/lib/update-prompt.js`：构造 dialog 选项、判定 response index 是否该装），不带 `require('electron')`，配 vitest 单测（S1 教训）。

### 🚫 Out of Scope（本 spec 明确不做）

- 徽标动态内容 / 版本号注入 / IPC 取数据——**刻意不做**，保持极简（shipping 尾巴只需要一个可见 diff，不需要逻辑）。
- 徽标点击交互、可配置文案、主题适配特殊处理。
- 更新弹窗不做「下载前先问」（保持自动后台下载，弹窗只在下载完成后出现）；不做下载进度条、稍后提醒队列。

---

## 3. 既定约束

- 徽标文案固定为 `Shipped by the pipeline`（VA 锁的就是这串，人写、实现不许改）。
- 不碰 spec 2 的 CSP（`default-src 'self'`）：样式若需要，走外部 `theme.css`，不用 inline `<style>`（S4 教训）。
- 沿用既有测试纪律：容器内权威门 = Vitest；可见验收 = `specs/release-badge.va.json`（VA，人写、实现不许改），CI e2e 真验。

---

## 4. UX / 交互

### 4.1 触发与位置
**所属 UI 组件：** 底部状态栏 `#status-bar`。**触发方式：** 无（启动即显示）。

### 4.2 主流程（人在 macOS 本机观察）
1. 用户运行 app：底部状态栏可见固定文字 `Shipped by the pipeline`。
2. （装好本版后的下一次发版）app 启动检测到新版本 → 后台静默下载 → 下载完弹窗「新版本已下载，立即重启更新？」→ 点「立即重启」app 重启换上新版；点「稍后」则弹窗关闭、退出 app 时自动装。

### 4.3 边界情况
| 情境 | 期望行为 |
|---|---|
| 重开 app | 徽标恒在（静态、不持久化状态） |
| 切主题 / 切渲染源码 | 徽标不受影响，恒显 |
| dev 模式（非 packaged） | updater 整段不跑（沿用 `app.isPackaged` 守卫），无弹窗 |
| 更新 feed 不可达 / 下载失败 | 沿用 `autoUpdater.on('error')` 兜底，只 console.error、不弹窗不崩 |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号
- PR 已开；容器内 `npm test` 绿（含 update-prompt 新单测）；CI e2e 绿（`va-runner` 真验徽标可见、`va-selftest` 变异自检证门有牙）；macOS 上 `npm start` 肉眼见徽标。

### 5.2 Vitest 验收
- [ ] `update-prompt` 纯模块单测：dialog 选项构造正确（标题含版本号、两个按钮、默认聚焦「立即重启」）；response=立即重启 → 判 install，response=稍后 → 判不 install。
- 现有 vitest 套件须保持全绿。
- **弹窗的端到端行为不设自动门**：它只在 packaged app + 真有新版本时出现，e2e/VA 够不到——权威验证 = 两版本真实更新 demo（这正是本 spec 的存在目的）。诚实标注，不写假门。

### 5.3 可见验收（VA）+ E2E（CI xvfb）
由 `specs/release-badge.va.json` 驱动：
- [ ] **[P1]** 默认态读 `#status-bar` 文本 **Then** 含 `Shipped by the pipeline`。
- [ ] **[P2]** `va-selftest` 变异自检：清空 `#status-bar` 文本后该断言必翻红——证门有牙。

---

## 6. 依赖关系

- **上游 · S1** 最小 Electron 骨架（`#status-bar` 所在窗口）。
- **上游 · S2** 状态栏（徽标加在 `#status-bar` 内，与主题/视图开关并排）。
