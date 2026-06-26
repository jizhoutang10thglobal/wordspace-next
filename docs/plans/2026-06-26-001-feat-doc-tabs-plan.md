---
title: 文档标签页（浏览器式 Tabs）+ 置顶（统一双标记模型）
status: active
date: 2026-06-26
slug: feat-doc-tabs
feature: F06（本地文件管理侧栏 · 标签页 + 置顶）
origin: 用户截图（ui-demo TabStrip）+ 本次对话逐项拍板
owner: Colin（拍板）/ Claude（实现）
---

# 文档标签页 + 置顶（统一双标记模型）

## 问题框定

侧栏能浏览/整理文件树、打开文件（html 进编辑器、非 html 进查看器），但**没有"当前/最近打开了哪些"的概念**——一次只看得见一个。要照 ui-demo `TabStrip`，在文件管理区**顶部**加：
- **标签页**：打开文件的记录，像浏览器 tab，方便看/切"最近开了哪些"。轻量、被动。
- **置顶**：用户**特意留下**的快速入口，更高一层的主动动作。

v0.4.0 已发的"从文件树右键置顶文件"（`pinsByRoot` 持久化）**保留并融进来**——置顶就是它，只是再加上"也能从标签上钉"。

## 核心模型（拍板锁定）

底层是**同一批被跟踪的文件，每条带两个标记**：`open`（开着 = 在标签页区）、`pinned`（钉了 = 在置顶区）。

```
被跟踪文件 entry = { rel, kind, title, open, pinned }
  · 置顶区   渲染 pinned===true 的（无论开没开）
  · 标签页区 渲染 open===true && pinned===false 的
  · 去重不变式：钉了优先 → pinned 的只在置顶区，绝不在标签页区重复
  · entry 存在 ⇔ open || pinned；两者都 false 即销毁该 entry
```

`rel` = 工作区内相对路径，作 entry 身份（去重键）。`kind` = `file-tree.kindOf`。`title` = 文件名。激活态 `activeRel` = 当前编辑器/查看器里的文件。

**拍板决策**

| # | 决策 | 取值 |
|---|------|------|
| K1 | 置顶 × 标签页关系 | 同一批文件的 `open`/`pinned` 双标记；置顶=pinned、标签页=open&&!pinned；**不是两个独立列表，也不是"pin 只能从标签钉"** |
| K2 | 持久化 | open 的标签 + pinned 的都按工作区根持久化，重启恢复全部 + 上次激活的那个 |
| K3 | 哪些文件 | 所有打开的文件（html 进编辑器、非 html 进查看器）都进标签页；任意文件都能钉进置顶 |
| K4 | 拖拽 | 标签拖拽排序 + 跨区拖动（置顶 ⇄ 标签页 = pin/unpin + 定位）一起做 |
| K5 | 钉的入口 | **文件树右键「置顶」（不必先打开）** + 标签上的 📌，两条路都通；钉的目标都是置顶区 |
| K6 | 既钉又开 | **只显示在置顶区**（去重，pinned 优先）；取消钉后若还 open → 落回标签页区；若没 open → 销毁 |
| K7 | 钉住的标签 | 置顶区的项**不显示 ×**（要先取消钉才能从打开记录里关）；× 只在标签页区的项上 |

## 状态变换（语义，纯逻辑 `tabs.js` 承载）

| 操作 | 效果 |
|------|------|
| 打开文件 `open(rel,kind,title)` | entry 存在则 `open=true` + 激活；不存在则建 `{open:true,pinned:false}` 追加到标签页区末尾 + 激活 |
| 切换 `setActive(rel)` | 设 `activeRel`（调用方按 kind 走 openDoc/showViewer） |
| 关标签 `close(rel)` | `open=false`；若 `!pinned` 则销毁 entry；若关的是激活项 → 激活**剩下还开着的标签里的最后一个**（只认 open 的项）；只剩没开过的纯置顶快捷方式 → `activeRel=null`（回空态，不自动开快捷） |
| 钉 `pin(rel,kind,title)` | entry 存在则 `pinned=true`；不存在（从树直接钉、没开）则建 `{open:false,pinned:true}`。移出标签页区、进置顶区 |
| 取消钉 `unpin(rel)` | `pinned=false`；若 `!open` 则销毁；若 open 则落回标签页区 |
| 拖拽 `drop(rel, toPinned, toIndex)` | 设 `pinned=toPinned` + 在目标区内重排到 toIndex（夹紧边界） |
| 改名/移动被跟踪文件 `retarget(oldRel,newRel,newTitle)` | 改 entry 的 rel+title+kind，open/pinned/激活态保持（**顺带补掉 v0.4.0"置顶文件改名后丢失"的遗留坑**） |
| 删除被跟踪文件 `remove(rel)` | 销毁 entry；若是激活项 → 激活剩下最后一个 / 回空态 |

脏检查：切换/关闭激活项时若当前文档未保存，走现有 `openDoc`/`showViewer` 内建的丢弃确认。

## 布局

侧栏自上而下：sb-head（+新建文档 / 打开文件夹 / 收起）→ **置顶区**（有 pinned 才显示，行含 📌toggle，无 ×）→ **标签页区**（行含 📌 + ×，头部带 "+"）→ 文档区（筛选框 + 文件树，现有）。收起态图标轨顶部显示 pinned + open 的图标（active 高亮）。

## 已决的小决策

| # | 决策点 | 取值 |
|---|--------|------|
| D1 | 文件树右键「置顶/取消置顶」 | **保留**（= K5 的直接钉入口；就是 v0.4.0 那条，不拆） |
| D2 | 标签页区头部 "+" | = 新建文档（开模板台，新文档打开后自然成为激活标签）；与侧栏头「+新建文档」同义 |
| D3 | 工作区外单文件 | 不进标签/置顶（按 rel 持久化，工作区外没 rel）；照旧全宽编辑 |
| D4 | 老数据迁移 | 迁移：启动时旧 `pinsByRoot[root]` 的 rel → `{open:false,pinned:true}` entry，迁完弃用旧字段 |

## 范围边界（非目标）

- 不做浏览器：ui-demo 的 `web` 标签 / 地址栏 / 前进后退 / 新建网页标签都不要。标签只有"文件"一种。
- 不做多空间 / 云空间切换：单一本地工作区。
- 标签竖排在侧栏里、跟 body 一起竖向滚动（不做横向标签条 + 溢出滚动）。
- 保留单文件全宽编辑（无工作区时行为不变）。

## 实现单元

### U1 — 双标记纯逻辑 + 持久化 + 迁移（数据层）
**Goal**：把上面"状态变换"表做成可单测的纯逻辑 + 按工作区根持久化（含老 pin 迁移）。
**Files**
- 新建 `src/lib/tabs.js`（纯 Node，无 electron）：`openEntry(entries, {rel,kind,title})`、`setActive`、`closeEntry(entries, activeRel, rel)`、`pinEntry(entries, {rel,kind,title})`、`unpinEntry(entries, activeRel, rel)`、`dropEntry(entries, rel, toPinned, toIndex)`、`retargetEntry(entries, oldRel, newRel, newTitle, newKind)`、`removeEntry(entries, activeRel, rel)`、`pinnedOf/tabsOf(entries)`、`nextActive(entries, closingRel)`。全返回 `{entries, activeRel}` 或派生数组。**去重不变式**用断言/测试守住。
- 改 `src/main/workspace-store.js`：`pinsByRoot` → `tabsByRoot`（存 `{entries:[…], activeRel}`）；`getTabs(storeFile, root)`、`setTabs(storeFile, root, state)`；**迁移**：getTabs 时若该 root 无 entries 但有旧 `pinsByRoot[root]` → 合成 `{open:false,pinned:true}` entries（kind 用 `kindOf`）。保留式读写（不冲别的 root）。删 `getPins/setPins`。
- 改 `src/main/ipc.js`：`ws-get-pins/ws-set-pins` → `ws-get-tabs/ws-set-tabs`（按 `requireRoot()`）。
- 改 `src/renderer/preload.js`：`wsGetTabs/wsSetTabs` 取代 `wsGetPins/wsSetPins`。
**Patterns**：`ui-demo/src/mock/store.ts:412-441/732-779`（openFileTab/closeTab/togglePin/dropTab 语义）；`src/lib/file-tree.js`（纯逻辑+kindOf）；现有 `workspace-store.js` 的 readRaw/writeRaw + pinsByRoot 形状。
**Execution note**：test-first。
**Test scenarios**（`test/tabs.test.js` + `test/workspace-store.test.js`）
- openEntry：新 rel → 标签页区末尾 + 激活；重复 → 只激活不新增；open 一个已 pinned 的 → 仍只在置顶区（不进标签页，守去重不变式）。
- closeEntry：关激活 → 激活剩下最后一个（含置顶项）；关非激活 → 激活不变；`open=false` 后 `!pinned` 销毁、`pinned` 保留在置顶；关到空 → activeRel=null。
- pinEntry：open 的标签钉 → 移出标签页、进置顶；树里直接钉没开的 → 建 `{open:false,pinned:true}`，不进标签页。
- unpinEntry：取消钉且还 open → 落回标签页；取消钉且没 open → 销毁。
- dropEntry：同区重排到 toIndex；跨区设 pinned + 定位；越界夹紧。
- retargetEntry：改 rel/title/kind，open/pinned/激活保持。
- removeEntry：销毁 + 激活项则激活下一个。
- 去重不变式：上述每步后断言"没有 entry 同时被算进置顶区和标签页区"。
- workspace-store：getTabs/setTabs 往返 + 重存 root 不冲；迁移：仅旧 pinsByRoot → 合成 pinned entries；损坏 JSON → 空。
**Verification**：`node --test test/tabs.test.js test/workspace-store.test.js` 全绿。

### U2 — 渲染两区 + 文件树右键钉（渲染层）
**Goal**：渲染置顶 + 标签页两区；文件树右键「置顶/取消置顶」直接钉（保留 v0.4.0 入口，改成写 entries）。
**Files**
- `src/renderer/index.html`：文件树上方放置顶区 + 标签页区容器（标签页区头部带 "+"）。复用/替换现有 `#sb-pins`。
- `src/renderer/shell.css`：标签行（图标+标题+hover 出 📌/×、active 高亮）、区标签、"+"、拖拽 drop 高亮/插入线。
- `src/renderer/sidebar.js`：entries/activeRel state；`renderZones()`（置顶=pinnedOf、标签页=tabsOf）；行渲染（图标按 kind、draggable、click→切换、📌→pin/unpin、×→close）。**替换** `renderPins/loadPins`；文件树右键「置顶」改成 `pinEntry`/`unpinEntry`（保留该菜单项）。
**Patterns**：`ui-demo/src/components/ArcSidebar.tsx`（TabRow/TabStrip）；现有 `sidebar.js` 的 renderPins（被替换形状）、showContextMenu、sb-kind-* 上色、CSP 安全单 CSSOM 定位。
**Verification**：开两个文件渲染两标签 + 右键树文件能钉进置顶（U3 e2e 覆盖）。

### U3 — 标签 ↔ 打开文件打通（shell + sidebar）
**Goal**：打开/切换/关闭/重启与 entries 联动；编辑器/查看器与标签互为真相。
**Files**
- `src/renderer/sidebar.js`：扩 `__sbHooks.onOpen(abs)` → 找树节点 → `openEntry` + 激活（工作区外找不到 → 不建，D3）；标签 click → `openNode`（脏检查内建）；close 激活 → 开 nextActive / `__shellCloseDoc()`；每次变更 `wsSetTabs` 持久化。
- `setWorkspace`：`wsGetTabs` 载入 → renderZones → 打开 activeRel（重启恢复）。
- 边界同步：`commitRenameOp/doMove` 命中被跟踪文件 → `retargetEntry`；`doDelete` → `removeEntry` + 重激活。
- `src/renderer/shell.js`：基本不动（openDoc/showViewer/shellCloseDoc 已暴露 + 已调 onOpen）；确认 onOpen 两条打开路径都触发。
**Patterns**：现有 shell.js openDoc/showViewer/shellCloseDoc/__shellDocPath/__shellRetargetDoc；sidebar.js commitRenameOp/doMove/doDelete。
**Execution note**：真 Electron e2e 兜底。
**Test scenarios**（`e2e/tabs.spec.js`）：开→标签出现+激活+编辑器显示；开第二个→两标签+切换；重复开→不新增；关激活→激活下一个；关到空→回 #home；非 html→查看器+标签；改名被开文件→标签跟随（`__shellDocPath` 指新路径）；删被开文件→标签消失+激活下一个；重启→标签+激活恢复。
**Verification**：`e2e/tabs.spec.js` 绿 + `workspace.spec.js`/`sidebar.spec.js` 不回归（注意 sidebar.spec.js 里旧"置顶"用例要改写）。

### U4 — 置顶端到端 + 迁移验收
**Goal**：树右键钉 / 标签 📌 钉都进置顶、持久化、重启恢复；老 pin 迁移验收；去重 + K6/K7 行为。
**Files**：`src/renderer/sidebar.js`（pin/unpin 入口都接 `pinEntry/unpinEntry` + 持久化 + 重渲染；置顶项无 ×）；迁移在 U1 store 完成。
**Test scenarios**（并入 `e2e/tabs.spec.js`）：右键树文件→进置顶（没打开也行）；标签 📌→移到置顶、× 消失；既钉又开只在置顶不重复；取消钉若还开→落回标签页；重启→置顶恢复；迁移：预置旧 pinsByRoot 的 workspace.json→启动后作 pinned 出现。
**Verification**：上述 e2e 绿。

### U5 — 拖拽排序 + 跨区移动
**Goal**：拖标签区内重排 + 跨区（置顶 ⇄ 标签页）= pin/unpin + 定位。
**Files**：`src/renderer/sidebar.js`（行 ondragstart 暂存；两区作 drop 目标、按光标 Y 算插入位 → `dropEntry` + 持久化 + 重渲染）；`shell.css`（drop 高亮 + 插入线）。
**Patterns**：ui-demo TabStrip insertAt/targetIndex/dropTab；**复用本仓已验合成 DragEvent 测法**（`e2e/sidebar.spec.js` 的 `dnd()`：单 page.evaluate dispatchEvent dragstart→dragover→drop + 同一 DataTransfer，判定落持久化顺序）。
**Test scenarios**（并入 `e2e/tabs.spec.js`）：拖未钉标签进置顶→变 pinned；同区重排→顺序变（断言渲染 + wsGetTabs 持久化顺序）；跨区拖回→unpin。
**Verification**：e2e 绿 + `--repeat-each=3` 无 flake。

### U6 — 收起轨 + "+" + 收尾
**Goal**：折叠态图标轨显示 pinned+open 标签；标签页区 "+" = 新建文档；空态/脏态收尾。
**Files**：`src/renderer/sidebar.js`（renderRail 改成 pinned+open 标签图标 + active 高亮 + 分隔线 + 树顶层；"+"→ openCreateModal('')，新文档经 onOpen 自然成激活标签）；`shell.css` 收尾。
**Patterns**：现有 renderRail；ui-demo CollapsedRail。
**Verification**：e2e 绿 + 全量 `npm test` / `playwright test` 不回归。

## 依赖与排期

```
U1（纯逻辑+持久化+迁移, test-first）─> U2（两区渲染+树右键钉）─> U3（打通开/切/关/重启）─┬─> U4（置顶+迁移验收）
                                                                                        ├─> U5（拖拽）
                                                                                        └─> U6（收起轨+"+"+收尾）
```
U4/U5/U6 都改 `sidebar.js` 同文件 → 串行做。

## 风险

- **R1 双标记去重不变式**：pinned 与 open&&!pinned 两区互斥、entry 销毁条件（!open&&!pinned）。漏一处就出现重复或幽灵 entry。缓解：纯逻辑每个变换后断言不变式 + 单测穷举。
- **R2 数据形状变更 + 迁移**：`pinsByRoot`→`tabsByRoot`，老数据迁移；workspace.json 损坏/老格式容错回空。
- **R3 标签↔编辑器真相同步**：开/切/关/改名/移动/删除/重启七路径。缓解：所有打开过单一漏斗（onOpen 建 entry、标签 click 走 openNode）；边界同步复用 `__shellRetargetDoc/__shellCloseDoc`；e2e 覆盖每路径。
- **R4 拖拽 flaky**：复用合成 DragEvent 测法 + `--repeat-each=3`。
- **R5 旧 sidebar.spec.js 置顶用例**：语义变了，要改写成新模型，别留假绿。

## 验收门（done-bar）

- `test/tabs.test.js` 纯逻辑全绿（八类变换 + 去重不变式）+ workspace-store 标签持久化/迁移绿。
- `e2e/tabs.spec.js` 真 Electron 覆盖：开/切/关/重复/非html/改名跟随/删除/重启/树右键钉/标签📌钉/既钉又开去重/取消钉落回/拖拽排序+跨区/迁移/收起轨/"+"。
- 现有 `npm test` + `playwright test` 零回归。
- 真机截图对齐 ui-demo 标签外观（置顶区 + 标签页区 + 📌/× + active 态）。
- 跑在分支 `feat/doc-tabs`，先不合 main，做完由 Colin 检查。
