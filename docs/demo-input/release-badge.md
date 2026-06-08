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

# S5 · 状态栏发布徽标（shipping demo 增量）

> 在底部状态栏加一个固定文字徽标 `Shipped by the pipeline`。**刻意做到极简**——本 spec 的用途不是展示功能本身，而是给 macOS shipping 尾巴当「v2 增量」：v1（无徽标）→ 经 lfg 实现并发版 → v2（徽标出现），让「老 app 自动更新成新版」在屏幕上一眼可见。

---

## 1. 产品价值（Why）

给 shipping 流水线一个**最小、可见、可逆判**的改动当演示增量。徽标出现 = 这一版是流水线自动产出并发布的，肉眼即可区分新旧版本——正是自动更新 demo 的视觉锚点。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- 底部状态栏（spec 2 的 `#status-bar`）内显示固定文字徽标 `Shipped by the pipeline`，与现有 `#theme-toggle` / `#view-toggle` 并排。
- 纯渲染、静态文字，无交互。

### 🚫 Out of Scope（本 spec 明确不做）

- 动态内容 / 版本号注入 / IPC 取数据——**刻意不做**，保持极简（shipping 尾巴只需要一个可见 diff，不需要逻辑）。
- 点击交互、可配置文案、主题适配特殊处理。
- **无独立纯逻辑模块**：本 spec 是静态文字、没有可解耦的逻辑，故不新增 vitest 逻辑层（现有 vitest 套件照常全绿）。这是有意为之，区别于 f14 那类带状态机的 spec。

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

### 4.3 边界情况
| 情境 | 期望行为 |
|---|---|
| 重开 app | 徽标恒在（静态、不持久化状态） |
| 切主题 / 切渲染源码 | 徽标不受影响，恒显 |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号
- PR 已开；容器内 `npm test` 绿（现有套件，本 spec 不加单测）；CI e2e 绿（`va-runner` 真验徽标可见、`va-selftest` 变异自检证门有牙）；macOS 上 `npm start` 肉眼见徽标。

### 5.2 Vitest 验收
- 无新增（本 spec 无可解耦逻辑层；现有 vitest 套件须保持全绿）。

### 5.3 可见验收（VA）+ E2E（CI xvfb）
由 `specs/release-badge.va.json` 驱动：
- [ ] **[P1]** 默认态读 `#status-bar` 文本 **Then** 含 `Shipped by the pipeline`。
- [ ] **[P2]** `va-selftest` 变异自检：清空 `#status-bar` 文本后该断言必翻红——证门有牙。

---

## 6. 依赖关系

- **上游 · S1** 最小 Electron 骨架（`#status-bar` 所在窗口）。
- **上游 · S2** 状态栏（徽标加在 `#status-bar` 内，与主题/视图开关并排）。
