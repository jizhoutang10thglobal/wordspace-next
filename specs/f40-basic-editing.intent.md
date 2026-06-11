---
spec: f40-basic-editing.md
role: 意图卡片（demo gate ① · 现场给人确认用）
---

# 意图卡片 · Spec 6：文本输入与基础编辑（F40 收窄版）

**要 AI 自动做什么（一句话）**
把查看器变成编辑器：文档区常开可编辑（敲字/删字/选中/纯文本粘贴/撤销重做，全走 Chromium 原生），编辑用 localStorage 持久化（重开还在），状态栏加「● Edited」脏标记 + `Reset` 回原文；源码视图改显编辑后的实时 HTML。

**为什么先做这个 / 它长在哪**
wordspace-next 是 HTML-native **编辑器**，demo 到 S5 为止只是查看器。S6 立编辑地基（F40 是 F42/F41/F53/F26 的依赖项），并作为 **v0.0.3 的发版增量**——这版同时捎带 B 两个流水线修复（dmg 公证 + shipping-verify findApp），v0.0.2→v0.0.3 更新时显式弹窗将首次亮相。

**边界（做 / 不做）**
- ✅ 做：常开 contenteditable；纯文本粘贴（拦 paste、去样式、保换行，规范化抽纯模块）；原生撤销/重做；localStorage 持久化；「● Edited」脏标记 + Reset；源码视图显实时 HTML（仍只读）。
- 🚫 不做：查找/替换（归下轮）；真实文件落盘（归 F09/F05）；AI 撤销隔离 / 跨文档隔离 / IME 专项 / Windows / 10 万字压测；源码视图可编辑。

**"做完"长什么样（可见实物）**
1. PR 开好（同分支带 B 两修复）。
2. 权威门绿：容器内 `npm test`（editing 纯模块新单测 + 现有全绿）。
3. CI e2e 绿：va-runner 真开 app **打字**验收（runner 新增通用 type/press 词汇）、va-selftest 变异自检证门有牙、手写 e2e 验粘贴/持久化/Reset/源码衔接。
4. feature 真能用：macOS 上 `npm start`，敲字、粘贴、撤销、重开还在、Reset 回原文。

**运行方式**
宿主协作流（同 S5）：对话拍板 → 实现过全门 → PR → CI → 合并自动发 v0.0.3。

---

确认意图？继续请按 **y**。
