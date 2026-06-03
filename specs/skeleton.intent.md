---
spec: skeleton.md
role: 意图卡片（demo gate ① · 现场给人确认用）
---

# 意图卡片 · Spec 1：最小 Electron 骨架

**要 AI 自动做什么（一句话）**
建一个能跑的最小 Electron 桌面 app：打开一个窗口，在窗口的文档容器里渲染一份本地 HTML 文档；接上 Vitest + Playwright，并留一个能过的冒烟测试。

**为什么先做这个 / 它长在哪**
后面所有 feature（spec 2 的主题切换等）都长在这个骨架上。本仓初始只有裸脚手架，骨架是 greenfield 起跑点。

**边界（做 / 不做）**
- ✅ 做：开窗 + 渲染一份内置 HTML 文档（渲染进独立容器元素，给 spec 2 的外壳 / 纸面分层留缝）；doc 加载逻辑抽成不依赖 Electron 的模块；Vitest 冒烟测试通过；Playwright 的 Electron E2E 写好但无显示环境时自动跳过；把本 run 踩到的环境教训写进 `CLAUDE.md`（供 spec 2 自动吃到——这就是 compound）。
- 🚫 不做：任何编辑功能、文件树、菜单、设置、主题（主题是 spec 2）；不追求好看。

**“做完”长什么样（三件可见实物）**
1. PR 开好（容器内自动 push + `gh pr create`）。
2. 权威门绿：容器内 `npm test`（Vitest）退出码 0。
3. feature 真能用：你在 Mac 上 `npm start`，弹出窗口并显示那份文档。
4. 学到东西：`CLAUDE.md` 多出一段本 run 的环境教训（git diff 可见）——spec 2 会自动吃到，这是 compound 实物。

**运行方式**
隔离 dev container 内、`claude -p /lfg` 无人值守跑；确认意图后你走开，AI 自己 plan → work → 测试 → 开 PR。

---

确认意图？继续请按 **y**。

（注：真窗口的视觉验证在你 Mac 上现场做——容器是无屏幕的 Linux 沙盒，开不了 GUI，这是刻意的安全取舍。权威测试门是 Vitest，不依赖开窗。）
