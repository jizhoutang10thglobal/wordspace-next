---
spec: release-badge.md
role: 意图卡片（demo gate ① · 现场给人确认用）
---

# 意图卡片 · Spec 5：状态栏发布徽标（shipping demo 增量）

**要 AI 自动做什么（一句话）**
在底部状态栏加一个固定文字徽标 `Shipped by the pipeline`，与现有开关并排。

**为什么先做这个 / 它长在哪**
它是 **macOS shipping 尾巴的 v2 增量**：v1（当前 app、无徽标）经 lfg 实现并自动发版 → v2（徽标出现）。徽标出现 = 老 app 自己更新成了新版，这就是给 Wendi 录屏里"自动更新真生效"的肉眼锚点。刻意极简——本周重点是 shipping 闭环，不是功能。

**边界（做 / 不做）**
- ✅ 做：状态栏内一个静态文字徽标 `Shipped by the pipeline`。
- 🚫 不做：动态内容 / 版本号 / IPC / 交互 / 独立逻辑层（无可解耦逻辑，故不加 vitest 单测）。

**"做完"长什么样（可见实物）**
1. PR 开好。
2. 权威门绿：容器内 `npm test`（现有套件全绿，本 spec 不加单测）。
3. CI e2e 绿：`va-runner` 按 VA 真验状态栏含 `Shipped by the pipeline`，`va-selftest` 变异自检证门有牙。
4. feature 真能用：macOS 上 `npm start`，状态栏一眼见徽标。

**运行方式**
同前：dev container 内 `claude -p /lfg` 无人值守；确认意图后走开。

---

确认意图？继续请按 **y**。
