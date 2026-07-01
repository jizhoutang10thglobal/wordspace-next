---
status: active
date: 2026-07-01
branch: feat/app-ui-demo-align
base: feat/ux-fixes（叠加，非 origin/main；合并顺序：ux-fixes 先合 main → 本分支 rebase 跟上）
owner: align session（Colin 指派）
---

# 把 ui-demo 的「保存模型 / 收起 / Cmd+P」对齐进真实 app

## 背景与边界

ui-demo（`ui-demo/**`，Vercel 原型）是 UX 参考标准。这一轮把它领先 app 的几块交互落进真实 Electron app（`src/**`）。

**非合规 HTML 基础编辑不在本轮**——另一个 parallel session 负责，本分支不碰 `schemaCheck` / `BasicEditor` 那套。

**与 `feat/ux-fixes` 的分工（关键，避免撞车）**：ux-fixes 已经做完了我原清单里的一大半，本分支**不重做**：
- ✅ 侧栏宽度拖拽 + 持久化（`sidebar.js` `initSidebarResize`）
- ✅ Cmd+T 新建 / Cmd+W 关标签（menu → `new-tab`/`close-tab`）
- ✅ 点标签 → 文件树展开定位（`sidebar.js` `expandToFile`）
- ✅ 收起态竖排图标轨已删（`renderRail` no-op）
- ⚠️ 查找文件做了 Cmd+F 聚焦筛选框（本轮在其上**再补** Cmd+P 命令面板）

本分支叠在 ux-fixes 之上开发；三个共享文件（`shell.js`/`sidebar.js`/`shell.css`）的改动都往它后面加。

## Colin 拍板的决策

- 保存模型（Wendi 会议）：**做**。
- 未保存关闭确认：app 现在是原生 `confirm()`（`sidebar.js:427`）/ 主进程原生对话框（`main.js:37`）——**关标签这道照 ui-demo 改成三按钮 modal**；关 app 那道保持主进程原生对话框（ui-demo 关窗也走原生 beforeunload，方向一致）。
- 收起态：ux-fixes 现在是 48px 细条（`shell.css:144`）——**改成"真收起"**（全隐藏 + 侧栏外重开入口），去图标轨 + 去 hover 气泡（图标轨 ux-fixes 已删）。
- 查找文件：**补 Cmd+P 命令面板**（独立浮层、模糊搜文件名跳转），Cmd+F 聚焦筛选框保留不动。
- 新建弹窗：app 是纯本地编辑器、没有网页标签 → ui-demo 的 Arc 地址栏（开网页）**不 port**；**保留现有模板台**，只把它接到临时文档流上。

## 架构差异（本轮的核心难点）

**app 与 ui-demo 的文档模型根本不同**：
- ui-demo：doc 活在内存（zustand），"在不在文件树"取决于有没有 `FileEntry`。临时文档 = `unsaved:true` 的 doc + 不建 FileEntry；`saveDocTo` 才补 FileEntry 进树。切标签零丢失（所有 doc 都在内存）。
- app：**每个 doc 就是磁盘上的真文件**，新建即 `wsNewDoc` 写盘（`sidebar.js:757`），`save()` 要求 `docPath` 存在才存（`shell.js:368`），单 iframe 编辑器一次只 live 一个 doc（切文档 = 重载 iframe）。app **没有**"存在于内存、还没落盘"的文档这个位置。

所以 app 版临时文档要新造，且要解决"单编辑器切标签会丢内容"：用一个**内存 tempStore**（`Map<id,{title,html}>`）在 shell 里暂存所有临时文档内容，切走前 stash、切回时重渲染 → 临时文档也能像 ui-demo 那样自由切标签不丢。真实文件的脏态守卫（`shell.js:297`）保持不变（真文件内容在磁盘、内存不 hold，切走仍按原逻辑提示）。

## 实现单元

### Unit 1 — 保存模型（优先级 1）

**临时文档（tempDoc）**
- 身份：`WS2Tabs` entry `keyOf=rel||abs`，临时文档两者皆无 → 合成 `abs:'temp:'+id` + `temp:true` 标记。`persistTabs` 过滤掉 `e.temp`（临时文档不持久化、重启即弃，符合"临时"语义）。
- 新建入口分流：`标签页 +`（`sidebar.js:640`）/ Cmd+T（`newTab` hook `:898`）→ **临时**（不落盘）；文件夹 hover-+（`:256`）/ 右键"新建文档"（`:267`）→ **直接落盘**（有明确目标文件夹，保持现状）。
- `openCreateModal` 加 `temp` 模式：模板选中后不 `wsNewDoc`，改为建临时文档。
- shell 侧：`tempDoc={id,title}` + `tempStore`；`openTempDoc(id,title,html)` 用 `loadFromHtml`（srcdoc）渲染、`docPath=null`；`stashTemp()` 切走前把 contentDocument 序列化回 tempStore；`openDoc`/`showViewer` 入口先 `stashTemp()`（临时文档不弹脏守卫，真文件维持原守卫）。
- 保存按钮 / 脏态：save 可用条件改为 `tempDoc || (docPath && dirty)`；有 tempDoc 时 `setDirty` 反映"未保存"（关 app 原生对话框据 `isDirty` 提示，临时文档也算未保存）。

**SaveModal「保存到哪里」**
- 套现有 `.sb-modal-overlay` / `.sb-modal` 壳（`shell.css:269`）。
- 列工作区根 + 各子文件夹（走 `current.tree` 的 `isDir` 节点）。默认根。
- 选中 → `wsNewDoc(dir, base, serializedHtml)` → `refresh()` 进树 → 临时标签转真 rel 标签（`removeEntry('temp:'+id)` + `openEntry({rel})`）→ shell `finalizeTemp(abs,rel,name)`：`docPath=abs`、`docInfo=pathInfo`、`watchDoc`、`tempDoc=null`、`flashSaved`。
- `save()` 遇 tempDoc：序列化 → 走 `__sbHooks.openSaveModal(id,title,html)`。

**CloseConfirmModal**
- 替换 `sidebar.js:427` 原生 `confirm()`。触发：关激活标签且（临时 || 脏）。三按钮：保存并关闭 / 不保存直接关闭 / 取消。
- 保存并关闭：临时 → SaveModal（存完再关）；已存盘但脏 → 直接 `save()` 再关。
- 不保存：临时 → 丢弃（删 tempStore + 标签）；已存盘 → `__shellDiscard()` 后关。

**触及**：`src/renderer/shell.js`、`src/renderer/sidebar.js`、`src/renderer/shell.css`（+ 必要时 `index.html`）。主进程不改（`wsNewDoc(dirRel,base,html)` 已够）。

### Unit 2 — 收起改"真收起"

`shell.css` `.sb.is-collapsed { width: 48px }` → 全收起（宽 0 / 移出）。侧栏全隐后 `sb-toggle` 也没了 → 加一个侧栏外的重开入口（doc 顶栏一个小按钮 / 保留 Cmd+\）。对齐 ui-demo 的收起观感。

### Unit 3 — Cmd+P 命令面板

独立浮层（新 DOM，套 modal 壳），输入框模糊搜当前工作区所有文件（`current.tree` 扁平化），↑↓ 选、Enter 打开（走 `openNode`/`openTabFromAbs`），Esc 关。Cmd+P 触发（加进 `main.js` 菜单发 `find-palette` + `shell.js onMenu` + `__sbHooks`）。Cmd+F 聚焦筛选框保留。

## 验证

- 纯逻辑（若给 `WS2Tabs` 加临时/命令面板相关 helper）→ `node --test` 单测。
- Electron 集成（临时文档新建/保存/关闭确认/切标签不丢/收起/Cmd+P）→ 扩 `e2e/*.spec.js`（Playwright+真 Electron）。**本容器无显示器跑不了 Electron**，e2e 交 CI/宿主 host-verify 跑；容器内只做 build + 纯逻辑单测 + 代码自检。
- 不合 main。做好交 Colin，ux-fixes 先合后本分支 rebase。

## 范围边界

- 只动 `src/**`（真 app），不碰 `ui-demo/**`、不碰 parallel session 的非合规编辑/`schema-1`。
- 不做：Arc 地址栏、web 标签、多 doc 常驻内存编辑器（真文件切标签仍按现有脏守卫，非本轮）。
