---
id: S6
title: 文本输入与基础编辑（F40 收窄版）
slug: f40-basic-editing
status: draft
owner: Colin
depends_on: [S1, S2, S3]
narrowed_from: F40
created: 2026-06-10
requires_va: true
---

# S6 · 文本输入与基础编辑（F40 收窄版）

> 把查看器变成编辑器：渲染视图的 `#doc-container` 常开可编辑——点进去就能敲字、删字、选中、纯文本粘贴、撤销/重做；编辑过的文档用 localStorage 轻持久化（重开 app 还在）；状态栏出现「● Edited」脏标记。这是 F40 砍掉查找替换 / AI 撤销隔离 / 跨文档隔离 / IME 专项 / 双平台 / 10 万字压测后的 demo 版。
>
> 口径（Colin 2026-06-10 拍板）：常开可编辑（无 Edit 开关）；localStorage 轻持久化；查找/替换砍掉归下轮；Edited 指示加。

---

## 1. 产品价值（Why）

编辑区是用户花时间最多的地方，「动字」是每秒都在用的操作。wordspace-next 的产品定位是 HTML-native 编辑器，demo 仓到 S5 为止都只是查看器——S6 把「能编辑」这块地基立起来：敲下的字真出现、改过的真留得住（重开还在）、敲错的真退得回。这也是 F42/F41/F53/F26 等一切后续编辑能力的依赖项。

---

## 2. 范围边界（In / Out）

### ✅ In Scope（本 spec 必做）

- **常开可编辑**：渲染视图下 `#doc-container` 设 `contenteditable`——点击定位光标、敲字、删字（Backspace）、换行，浏览器原生编辑能力直接用，不自造编辑引擎。
- **文本选择**：拖选 / 双击选词 / 全选（`⌘A`），选区原生高亮。原生能力，验收抽测、不重新实现。
- **纯文本粘贴**：拦截 `paste` 事件，只取 `text/plain`，去掉来源的字体/颜色/字号等所有样式，保留文字与换行；插入走 `document.execCommand('insertText')`（并入原生撤销栈）。剪贴板文本规范化（`\r\n` → `\n` 等）抽纯模块。
- **撤销 / 重做**：走 Chromium 原生编辑撤销栈（`⌘Z` / `⌘⇧Z`），含对纯文本粘贴的撤销。无可撤销步骤时按撤销不报错、内容不变。
- **localStorage 轻持久化**：每次编辑后把 `#doc-container` 当前 HTML 存 localStorage；启动时有存档则加载存档、否则加载内置文档。重开 app 编辑还在。
- **「● Edited」脏标记**：状态栏新增 `#edit-indicator`——当前文档与内置原文不同时显示「● Edited」，未编辑（或 Reset 后）不显示。判定逻辑（当前串 vs 基线串比较）抽纯模块。
- **Reset 回原文**：状态栏一个 `Reset` 按钮——清掉 localStorage 存档、恢复内置文档、脏标记消失。（持久化的配套安全阀：没有它，文档一旦改坏永远回不去。）
- **与 S3 源码视图衔接**：源码视图改为显示**当前编辑后**文档的实时 HTML（不再是启动缓存的原串）；源码视图保持只读（不可编辑），切回渲染视图编辑不丢。无编辑时源码视图内容与现行为一致（含 `<h1` 标签字面与正文），S3 的 VA 不受影响、一字不改。

### 🚫 Out of Scope（本 spec 明确不做 —— F40 收窄）

- **查找 / 替换** —— 自成一块，归下轮 spec（v0.0.4 候选）。
- **真实文件落盘** —— demo 没有文件来源（F09/F06 未做），持久化只到 localStorage；「即时落盘到硬盘文件」归 F09/F05 收窄版。
- **撤销外部 AI 写入的隔离** —— demo 无 AI 写入接口，砍。
- **跨文档状态隔离** —— demo 只有一份文档，砍。
- **IME 组合输入专项验收** —— 依赖原生 contenteditable 行为，不专项测（诚实标注：未验）。
- **Windows / 双平台一致性、10 万字压测、8 小时稳定性、Tab 缩进、按词跳等高级光标专项** —— 全砍；方向键/行首行尾等原生自带，不专门验收。
- **源码视图可编辑** —— 仍只读；编辑 HTML 源码牵 F42 解析，不碰。

---

## 3. 既定约束

- **不自造编辑引擎**：输入/光标/选区/撤销全部用 Chromium contenteditable 原生能力；本 spec 自己写的只有四样——paste 拦截、持久化、脏标记、Reset。原生行为不重新实现也不重新验证，验收只抽测「在本 app 里真的能用」。
- **CSP 不动**（`default-src 'self'`，S4 教训）：paste 处理不引入 inline script/style；粘贴只插纯文本，天然不引入新 HTML 结构。
- **实现落点（让验收门对得上，必须遵守）**：
  - `#doc-container` 渲染态设 `contenteditable="true"`；源码态必须移除/关闭可编辑。
  - 粘贴：`paste` 事件 `preventDefault()` → `clipboardData.getData('text/plain')` → 纯模块规范化 → `document.execCommand('insertText', false, text)`（保证并入原生撤销栈；多行文本换行保留）。
  - 持久化：localStorage key `wordspace.doc.html`；`input` 事件后保存当前 `#doc-container.innerHTML`。启动序：有存档 → `innerHTML = 存档`；无 → 沿用现有内置文档加载。
  - 脏标记基线：**启动渲染完成后的 `#doc-container.innerHTML` 快照**（不是源文件字符串——浏览器序列化会做规范化，拿源串比对会误报）。基线 = 内置文档渲染后的串；有存档启动时，基线仍取内置文档渲染后的串（先渲内置取基线、再上存档，或等价办法）。
  - 纯模块 `src/lib/editing.js`（不 `require('electron')`，vitest 直测）：`normalizePasteText(raw)`（`\r\n`/`\r` → `\n`，其余原样）+ `isEdited(currentHtml, baselineHtml)`。DOM 读写、localStorage、事件接线是 renderer 的事。
  - S3 衔接：toggle 到源码态时取**当时的** `#doc-container.innerHTML` 做显示串（`textContent = 该串`），切回渲染态 `innerHTML = 该串`。仍纯同步、不发 IPC（S3 flaky 教训）。`view-mode.js` 不动。
- **e2e 持久层隔离**：`src/main.js` 认环境变量（如 `WSND_USER_DATA`）覆盖 `app.setPath('userData')`；所有 e2e 启动（含 va-runner / va-selftest / 手写 spec）一律用全新临时 userData——否则 localStorage 跨测试运行互相污染，宿主连跑两次必假红。
- **VA runner 词汇扩展（spec-agnostic）**：本 spec 的可见验收需要打字和按键，va-runner 增加通用步骤 `type`（向 selector 输入文本）与 `press`（按键，可带 `times` 重复）——与 `click`/`snapshot` 同级的通用词汇，runner 仍不认识任何具体 spec。VA 文件本身照旧人写、CODEOWNERS 锁、实现 AI 不许改。
- **沿用既有测试纪律**（CLAUDE.md S1/S3/S4）：容器内权威门 = Vitest；e2e 真门在 CI（xvfb）+ 宿主真跑；可见验收 `specs/f40-basic-editing.va.json` 按 textContent 真验、不查 class 代理；`requires_va: true`，缺 VA 被 va-coverage 判红。

---

## 4. UX / 交互

### 4.1 触发与位置
**所属 UI 组件：** 编辑区 `#doc-container`（常开可编辑）+ 底部状态栏（`#edit-indicator` 脏标记、`Reset` 按钮）。

### 4.2 主流程（人在 macOS 本机观察）
1. **敲字**：打开 app，点文档任意处，光标落点，敲字即时上屏；状态栏出现「● Edited」。
2. **粘贴**：从别处复制一段带格式（粗体/彩色）的文字，粘进文档——文字进来了，样式没跟进来，换行还在。
3. **撤销**：`⌘Z` 逐步退回自己的编辑；`⌘⇧Z` 重做。
4. **重开还在**：退出 app 再打开，编辑过的内容还在，「● Edited」也在。
5. **Reset**：点状态栏 `Reset`，文档回到内置原文，「● Edited」消失。
6. **看源码**：点 `Render / Source`，看到的是**编辑后**文档的 HTML；切回来接着编辑。

### 4.3 边界情况
| 情境 | 期望行为 |
|---|---|
| 文档初始状态按 `⌘Z` | 内容不变、不报错 |
| 重做到最新后继续 `⌘⇧Z` | 内容不变、不报错 |
| 粘贴跨段落长文本 | 纯文本插入，换行/段落保留，无来源样式 |
| 源码视图里尝试敲字 | 无效（只读），切回渲染视图才能编辑 |
| Reset 后再编辑 | 从内置原文重新开始，「● Edited」重新出现 |
| 编辑后切主题 / 切视图 | 编辑内容不丢，脏标记不变 |

---

## 5. 验收标准（Acceptance Criteria）

### 5.1 成功信号
- PR 已开；容器内 `npm test` 绿（editing 纯模块新单测 + 现有套件全绿）；CI e2e 绿（va-runner 按 VA 真开 app 打字验收、va-selftest 变异自检证门有牙、手写 e2e 验粘贴/持久化/Reset/源码衔接）；macOS 上 `npm start` 真编辑一遍。

### 5.2 Vitest 验收
- [ ] **[P1]** `normalizePasteText`：`\r\n` 与 `\r` 归一为 `\n`；普通文本原样；空串安全。
- [ ] **[P1]** `isEdited`：串相同 → false；不同 → true；与空串/基线比较安全。
- [ ] 现有套件全绿。

### 5.3 可见验收（VA）+ E2E（CI xvfb + 宿主）
由 `specs/f40-basic-editing.va.json` 驱动（人写、锁）：
- [ ] **[P1]** 初始态：文档含内置正文、不含探针文本（兼证存储隔离没漏）。
- [ ] **[P1]** 点进文档打字 → 探针文本真出现在 `#doc-container`。
- [ ] **[P1]** 打字后 `#edit-indicator` 显示「Edited」。
- [ ] **[P1]** 连按撤销 → 探针文本消失、内置正文仍在。
- [ ] **[P2]** va-selftest 变异自检：打掉编辑能力后上述断言必翻红。

手写 e2e（VA 词汇够不到的）：
- [ ] **[P1]** 粘贴带 `text/html` 的剪贴板数据 → 只有纯文本进文档（无新元素节点、换行保留）。
- [ ] **[P1]** 编辑 → 关 app → 同一 userData 重开 → 编辑还在、脏标记在。
- [ ] **[P1]** Reset → 回内置原文、脏标记消失、localStorage 清空。
- [ ] **[P2]** 编辑后切源码视图 → 源码含编辑进去的文本；切回渲染继续可编辑。

---

## 6. 依赖关系

- **上游 · S1** 文档查看器骨架（`#doc-container`、内置文档加载）。
- **上游 · S2** 状态栏（脏标记、Reset 按钮的落点）。
- **上游 · S3** 渲染/源码切换（本 spec 改其数据源为实时串，VA 行为不变）。
- **下游 ·（板上）** F41 格式 / F53 选区工具栏 / F26 高亮 / 查找替换收窄版（v0.0.4 候选）。
