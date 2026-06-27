---
status: active
created: 2026-06-27
slug: external-file-tabs
related:
  - docs/plans/2026-06-26-001-feat-doc-tabs-plan.md
---

# 工作区外文件也进标签页（abs 身份的外部标签）

## 问题 / 背景

当前（v0.4.2）标签的身份是「工作区相对路径 `rel`」。用顶部「打开」按钮打开一个**不在当前工作区文件夹内**的文件（例：工作区=Desktop，打开 ~/Downloads/x.html，不把 Downloads 设成工作区），文件能在编辑区/查看器打开，但**不进「标签页」区**——因为它相对 Desktop 算不出 `rel`，`sidebar.js` 的 `onOpen` 兜底 `openTabFromAbs` 拿到 `classify-file` 返回的 `rel=null` 后直接 `return`、不建标签。这是上一轮（doc-tabs）拍的**决策 B**（工作区外只预览、不进标签）的直接结果，不是新 bug。

Wendi/Colin 试用后要反转：把 app 当浏览器，**打开任何文件 = 开一个标签页**，工作区外的也要进标签栏。

**已拍板（AskUserQuestion）：**
1. 外部标签**持久化 + 重启恢复**（按当前工作区根存；文件已不在则重启时静默丢弃）。
2. 外部标签**加轻量视觉标记**（区别于工作区内标签：名旁小 ↗ + 淡色 + 悬停显完整路径）。

## 方案概述

把标签身份从「只认 `rel`」扩成「**`rel` 优先、无 `rel` 用 `abs`**」：
- 统一身份键 `keyOf(e) = e.rel || e.abs`。`rel` 是相对路径（无前导 `/`），`abs` 是绝对路径（mac 有前导 `/`、win 有盘符），二者**永不相等**，所以单字段 `keyOf` 不会跨类型撞键，且**对现有 rel 标签完全向后兼容**（rel 标签 `abs===undefined`，`keyOf` 恒等于 `rel`，所有现有行为/测试/已落盘的 `activeRel` 逐字不变）。
- 外部 entry = `{ rel: null, abs, kind, title, open, pinned }`（无 rel，以 `!entry.rel` 判定「外部」）。
- 点外部标签：`kind==='html'` → `openDoc(abs)`；非 html → `showViewer({abs, rel:null, kind, name})`。`shell.js` 这两条路**已支持纯 abs**（上一轮为「打开」按钮加的 `fileUrlAbs`/`openExternalAbs`），无需改 shell.js。
- 持久化：外部 entry 存进 `tabsByRoot[当前root]`（跟内部标签同桶，换工作区各自保留）。重启恢复时，内部 entry 按 `findNode(rel)` 过滤幽灵（原逻辑），外部 entry 改按主进程 `fs.stat(abs)` 校验存在性（新 IPC），不在就静默丢。

**关键认知**：`shell.js` 和大部分 IPC 上一轮已经为 abs 路径铺好了（`classify-file`/`file-url-abs`/`open-external-abs`/`openDoc(abs)`/`showViewer` 双路）。这一轮主要改的是 **`tabs.js` 的身份键** 和 **`sidebar.js` 的建标签/点击分发/持久化校验**，外加 `workspace-store.js` 放行无 rel 的 entry。

## 范围边界（Scope）

**做：** 工作区外文件经「打开」按钮进标签页、可点击重开、可 pin、持久化+重启恢复、视觉轻标记、磁盘已删则重启丢弃。

**不做：**
- 不监听外部文件的运行期磁盘变化（外部标签不进 `doc-watcher`；外部文件被删/改只在「下次点击兜错」+「重启 sanitize」两个点处理，跟内部标签运行期也不监听任意删除一致）。
- 不做「外部文件后来被移进工作区 / 工作区切到其父目录 → 把 abs 标签自动升级成 rel 标签」的合并（per-root 分桶 + realpath classify 已让同一 root 内同一文件不会既 rel 又 abs，见决策 D3；升级是纯锦上添花，留作 follow-up）。
- 不改 `read-doc`/`assertHtmlPath` 的工作区无关性（本就允许任意 abs 的 .html，已验证）。

## 关键决策（Decisions）

- **D1 身份键 = `rel || abs`，不加命名空间前缀。** 理由：rel 相对、abs 绝对，永不撞；保留 `activeRel` 字段名与「rel 标签 activeRel 仍是 rel 字符串」的向后兼容（已落盘的 workspace.json + 现有 18 个 tabs 单测不动即过）。对抗审计提的「命名空间前缀」更保险但会破坏向后兼容与现有断言，权衡后不采用。
- **D2 「外部」用 `!entry.rel` 判定，不存独立 `external` 字段。** 少一个持久化字段、少一处可能不一致。
- **D3 外部标签的去重/存在性靠 realpath + per-root 分桶，不做跨 root 合并。** `classify-file` 用 `fs.realpath` 归一化算 rel（已实现），所以「abs 其实在工作区内」（含 /private 软链、符号链接目标在 root 下）会算出非 null rel → 走 rel 标签、不会建外部标签 → 同一 root 内同一物理文件不会既 rel 又 abs。跨 root 因分桶隔离也不会重复显示。
- **D4 存在性校验放 renderer `loadTabs`、用新 IPC `path-exists(abs)`。** 主进程 `getTabs` 的 sanitize 不做磁盘 IO（保持同步、不耦合恢复与 stat）。内部 entry 仍按 `findNode` 过滤、外部 entry 按 `fs.stat` 过滤。
- **D5 顺带硬化跨工作区 persist 竞态：`ws-set-tabs` 带上 renderer 的 `root`，主进程校验 `=== activeRoot` 不符就丢弃写入。** 现状 persist 是 fire-and-forget + 主进程盲信 `requireRoot()`（[[doc-tabs-feature]] 记的 follow-up）；外部标签带绝对路径，写错桶会让用户在 B 工作区点开 A 时打开的某个外部文件，危险被放大，所以这一轮一并修。
- **D6 隐私：外部文件绝对路径明文落进 `userData/workspace.json`。** 接受（root 本就是绝对路径、隐私面早已存在，外部 abs 是同类扩展）。PR/文档注明 workspace.json 含本地绝对路径、不应同步上传。

## 实现单元（Implementation Units）

### U1 — `tabs.js`：身份键扩成 `rel || abs`（纯逻辑，test-first）
- **Files:** `src/lib/tabs.js`（改）、`test/tabs.test.js`（增）
- **Approach:** 顶部加 `function keyOf(e){ return e.rel || e.abs; }` 并导出。`mkEntry` 透传 `abs`（title 默认 `basename(rel||abs)`）。把 `openEntry`/`setActive`/`closeEntry`/`pinEntry`/`unpinEntry`/`dropEntry`/`resolveActive` 里所有 `e.rel === X` 的去重/查找/比较换成 `keyOf(e) === key`；`resolveActive` 回落返回 `.rel` 改 `keyOf(...)`；`openEntry`/`pinEntry` 的 `activeRel` 赋值用 `keyOf(file)`。`retargetEntry`/`removeEntry` 只被工作区内 rename/delete 触发、传入永远是 rel，对外部 entry（key=abs）天然不命中，无需特殊处理（但渲染层的 `*TabsUnder` 要防 undefined.indexOf，见 U4）。更新 `tabs.js` 顶部「rel 作 entry 身份」的注释为「rel 或 abs」。
- **Execution note:** test-first（纯逻辑，先写失败单测）。
- **Test scenarios（unit）:** `keyOf` 落回（带 rel→rel；带 abs 无 rel→abs）；`openEntry` 外部文件 `{abs:'/x/out.html',kind:'html'}`→进 `tabEntries`、`activeRel===abs`、重复 open 同 abs 不新增；`closeEntry`/`pinEntry`/`unpinEntry`/`dropEntry` 对外部 entry 走一遍 + 混合 rel/abs entry 互不串键，`invariant()`（无幽灵、两区不重复、pinned 优先）仍成立；`resolveActive` 在 `activeRel` 是外部 abs 时正确保留/回落；**现有 18 个用例不改、全绿**（证明 rel 路径恒等）。
- **Verification:** `npm test` 中 tabs 全绿，含新增外部 entry 用例。

### U2 — `workspace-store.js`：放行无 rel 的外部 entry + 持久化（含 D5 root 校验）
- **Files:** `src/main/workspace-store.js`（改）、`test/workspace-store.test.js`（增）
- **Approach:** `validEntry` 从「`typeof e.rel==='string' && (open||pinned)`」放宽成「`(typeof e.rel==='string' || typeof e.abs==='string') && (open||pinned)`」，并保留 `abs`/`kind`/`title` 字段。`setTabs(file, root, state)` 增加 `root` 形参，由调用方（ipc handler）传入并断言 `=== activeRoot`，不符丢弃（D5）。`activeRel` 仍存字符串（现在可能是 abs），sanitize 不变。
- **Test scenarios（unit）:** `setTabs`/`getTabs` round-trip 一条外部 entry（`{abs,kind,title,open,pinned}` 无 rel）→ 读回保留 abs；`validEntry` 放行 abs-only、仍丢「rel 和 abs 都没有」的坏项；root 不符时 `setTabs` 不写。
- **Verification:** `npm test` 中 workspace-store 全绿。

### U3 — 主进程 IPC：`path-exists` + `ws-set-tabs` 带 root
- **Files:** `src/main/ipc.js`（改）、`src/renderer/preload.js`（改）
- **Approach:** 新增 `ipcMain.handle('path-exists', (_e, abs) => fsp.stat(abs).then(()=>true, ()=>false))`，preload 暴露 `pathExists(abs)`。`ws-set-tabs` 改成收 `(state, root)` 并把 root 透给 `workspaceStore.setTabs`（D5）；preload `wsSetTabs(state, root)` 对应改。
- **Test scenarios:** 无独立单测（薄 IPC），由 U6 e2e 覆盖（重启恢复/删除丢弃路径会经过 `path-exists`）。
- **Verification:** e2e 重启用例绿。

### U4 — `sidebar.js`：建外部标签 + 点击分发 + 存在性分流 + 守卫
- **Files:** `src/renderer/sidebar.js`（改）
- **Approach:**
  - `openTabFromAbs(abs)`：`meta.rel===null` 时不再 `return`，改 `openTabEntry({ abs, rel:null, kind:meta.kind, title:meta.name||basename(abs) })`。**保留现有 `rootBefore` 竞态守卫**，且让它对外部分支也生效（await classify 回来若 `current.root` 变了就放弃，对抗 case #8）。
  - `tabRow(entry)`：`row.dataset.key=keyOf(entry)`（拖拽 dataTransfer 也存 key）；`is-active` 比较用 `keyOf(entry)===tabState.activeRel`；点击改成统一 `openTabRow(entry)`——`entry.rel` → `openNode(findNode(entry.rel))`（内部，行为不变）；无 rel → `kind==='html'?openDoc(entry.abs):window.__shellShowViewer({abs:entry.abs,rel:null,kind:entry.kind,name:entry.title})`。外部 entry 加视觉标记（见 U5）：`row.classList.add('sb-tab-ext')`、name 后插 `<span class="sb-tab-ext-ico">`+EXT_SVG、`row.title=entry.abs`。
  - `isPinned`/`closeTabRel`/`dropTabRel`/`pinRel`/`unpinRel` 全部从「裸 rel」改成 `key=keyOf(entry)`；`closeTabRel` 关激活后回落时，next active 可能是外部 key → 用 `tabState.entries.find(e=>keyOf(e)===tabState.activeRel)` 拿 entry 再走 `openTabRow(entry)`，不只 `findNode`。
  - `loadTabs`：过滤分流——`e.rel?findNode(e.rel):await window.ws2.pathExists(e.abs)`（外部 entry 存在才留），不在的剔除并 `persistTabs()` 回写（静默丢，D4）；照抄 `rootBefore` 竞态守卫。恢复激活项：内部走 `openNode(findNode)`、外部走 `openTabRow`。
  - `removeTabsUnder`/`retargetTabsUnder`：前缀匹配加 `e.rel &&` 守卫（外部 entry 的 rel 是 null/undefined，不加会 `undefined.indexOf` 崩——对抗 case #5，high）。外部 entry 天然不被工作区内 rename/move/delete 波及。
  - `renderRail`：对无树节点的外部 entry `findNode(e.rel)` 返 null → **skip**（外部标签不上收起态图标轨，可接受；避免轨上出现无法定位的图标）。
  - `pinFromTree`（树右键置顶）不涉及外部（外部文件不在树、无右键菜单），不动。
- **Execution note:** 这是最大的一单，逐函数对照 changeMap 改；改完先靠 U1 单测保证纯逻辑，再靠 U6 e2e 保证集成。
- **Test scenarios:** 见 U6（集成层）。
- **Verification:** U6 e2e 全绿。

### U5 — `shell.css`：外部标签轻标记
- **Files:** `src/renderer/shell.css`（改）
- **Approach:** 新增 `.sb-tab-ext .sb-name{ color: var(--c-text-2); }`、`.sb-tab-ext-ico{ flex:none; width:14px; height:14px; display:inline-flex; align-items:center; color:var(--c-text-3); }`、可选 `.sb-tab-ext .sb-ico{ color:#6f6f6f; }`。不动 `.sb-tab.is-active`（外部标签激活时同样高亮，两 class 叠加）。CSP 安全（纯 class + SVG innerHTML 注入，跟现有 `SVG.file` 同款；不碰 setAttribute('style')/cssText）。
- **Verification:** 截图核对 + U6 断言 `.sb-tab-ext`/`.sb-tab-ext-ico` 存在。

### U6 — e2e：反转决策 B + 外部标签全流程
- **Files:** `e2e/tabs.spec.js`（改）
- **Approach:** **删/反转**现有「工作区外文件→不进标签页（决策 B）」那条（`e2e/tabs.spec.js:267-275`，硬编码反向断言，不反转会上线即红门——对抗 case 列的 openRisk）。新增：
  - 开工作区外 html（`stubPick` 一个 tmp 下、wsDir 外的 .html）→ 进编辑器 + `tabRow` 出现 + `is-active` + 带 `.sb-tab-ext` 标记 + `title===abs`。
  - 开工作区外非 html（png）→ 应用内预览 + 进标签 + 外部标记。
  - 点外部标签重开（切到别的标签再点回）→ 正确重载该外部文件。
  - 重启恢复：开外部文件、poll workspace.json 含该 abs、`app.close`、重启 → 外部 `tabRow` 恢复且可点开。
  - 外部文件磁盘删了→重启静默丢：开外部文件落盘、删该文件、重启 → 外部 `tabRow` 不出现（`path-exists` 剔除）。
  - 去重不打架：开工作区内 a.html（rel 标签）+ 开工作区外 /tmp/a.html（abs 标签）→ 两个独立标签共存、各自高亮、互不去重。
  - 工作区内 rename/delete 不波及外部标签：既有外部标签时改名/删一个内部文件 → 外部标签纹丝不动（防 `undefined.indexOf` 崩溃回归）。
- **Verification:** `npx playwright test e2e/tabs.spec.js` 全绿；本地宿主跑全套 e2e 不回归。

## 风险（Risks）

- **R1 信任边界扩大**：外部标签点击复用 `file-url-abs`/`open-external-abs`（不经 `assertInsideWorkspace`），这两个 IPC 原注释写明「仅服务『打开』按钮 pick→view 流」。现在「持久化后重启自动重开」也会调它们。缓解：abs 来源仍是用户曾亲手 `pickFile` 的路径（不是可篡改的任意注入），恢复只重开用户开过的；不构成新越权面。PR 说明。
- **R2 `undefined.indexOf` 崩**（对抗 high）：外部 entry 无 rel，`removeTabsUnder`/`retargetTabsUnder` 不加 `e.rel &&` 守卫会运行期崩。U4 已列守卫 + U6 有回归门。
- **R3 持久化静默丢**（对抗 high）：`validEntry` 不放宽则外部标签每次 wsSetTabs 被主进程默默扔、重启恢复落空。U2 已列。
- **R4 跨 root persist 竞态**（对抗 high）：fire-and-forget + 盲信 requireRoot 会把外部标签写错桶。D5/U2/U3 的 root 校验修掉。
- **R5 隐私**（D6）：abs 明文落盘，接受 + 披露。
- **R6 现有 e2e 硬编码决策 B**：`tabs.spec.js:267-275` 必须反转（U6），否则上线即红。

## 留给实现期（Deferred to Implementation）
- 外部标签的 `dataTransfer`/`dataset` 从 `rel` 切到 `key`，要同步 e2e 里 `tabDnd` helper 的选择器（若它依赖 `data-rel`）——实现时核对 `e2e/tabs.spec.js` 的拖拽 helper。
- `renderRail` 是 skip 外部还是用 entry 自身造图标——计划取 skip（最省、可接受），实现时若发现收起态体验差再议。
- 外部标签 title 用 `basename`；是否在 tooltip 外再显示父目录名做消歧（多个同名外部文件），留观察。
