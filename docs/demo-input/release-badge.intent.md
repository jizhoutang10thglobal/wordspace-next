---
spec: release-badge.md
role: 意图卡片（demo gate ① · 现场给人确认用）
---

# 意图卡片 · Spec 5：状态栏发布徽标（shipping demo 增量）

**要 AI 自动做什么（一句话）**
在底部状态栏加一个固定文字徽标 `Shipped by the pipeline`（与现有开关并排）；同时把自动更新升级成显式弹窗（下载完问用户「立即重启更新？」，点了就 `quitAndInstall()`）。

**为什么先做这个 / 它长在哪**
它是 **macOS shipping 尾巴的 v2 增量**：v1（当前 app、无徽标）经 lfg 实现并自动发版 → v2（徽标出现）。徽标出现 = 老 app 自己更新成了新版，这就是给 Wendi 录屏里"自动更新真生效"的肉眼锚点。刻意极简——本周重点是 shipping 闭环，不是功能。

**边界（做 / 不做）**
- ✅ 做：状态栏内一个静态文字徽标 `Shipped by the pipeline`；`update-downloaded` 后显式弹窗（立即重启/稍后），决策逻辑抽纯模块配 vitest。
- 🚫 不做：徽标动态内容 / 版本号注入 / IPC / 点击交互；更新下载前不问（保持后台自动下载）、无进度条。
- ⚠ 弹窗在 v0.0.1→v0.0.2 这次更新**看不到**（老版本跑老代码），v0.0.2→v0.0.3 起生效。

**"做完"长什么样（可见实物）**
1. PR 开好。
2. 权威门绿：容器内 `npm test`（现有套件全绿 + update-prompt 新单测）。
3. CI e2e 绿：`va-runner` 按 VA 真验状态栏含 `Shipped by the pipeline`，`va-selftest` 变异自检证门有牙。
4. feature 真能用：macOS 上 `npm start`，状态栏一眼见徽标。

**运行方式**
同前：dev container 内 `claude -p /lfg` 无人值守；确认意图后走开。

---

确认意图？继续请按 **y**。
