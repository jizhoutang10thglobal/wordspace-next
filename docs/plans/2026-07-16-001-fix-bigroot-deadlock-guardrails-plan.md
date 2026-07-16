# P0a 止血包：大根死锁陷阱 + 扫描护栏 · 执行 plan

2026-07-16，Colin 拍板 P0 最高优先级。诊断正本 = `docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md`
（**执行前必读**，含 D1–D6 死锁链与全部 file:line 证据）。本 plan 只管止血：让 app 在遇到巨型根时
**不死锁、不冻死、永远可移除**。真正支持大根浏览是 P0b（另一份 plan，本包合并后立即执行）。

执行纪律：仓根 `CLAUDE.md` 的「开发时的测试纪律」+「变异自检两条铁律」；独立 worktree 干活；
push 用 `jizhoutang10thglobal` token；PR CI 跑 merge commit，先 rebase main 再信本地绿。
⚠ 并行 session 正活跃改 `sidebar.js`（Wendi 反馈批），预期 merge-train，勤 rebase。

## 0. 已核实事实（别再调研，直接信；行号基于 main b6acbc7，rebase 后可能漂移，按符号找）

- 添加路径两段式**已经正确**：`ws-add-folder` 秒回 `{status:'added'}` 不带树（`ipc.js:600-608`），
  renderer `pickFolder` 先 `adoptRoot(r.root, null)` 渲染根行+loading 行再异步读树（`sidebar.js:208-214`）。
- **启动路径是死锁点**：renderer 启动 IIFE `sidebar.js:2835-2856` 先 `await Promise.all(infos.map(wsReadTree))`
  （`:2839`）**然后才** `rootsState = infos.map(mkRootState)`（`:2840`）；rootsState 空时 `render()` 在
  `:439-443` 早返回 → 空态永驻、根行不渲染 → 唯一移除入口（根行右键 `:563-569`）不可达。
  `resyncRoots`（`:703-716`）有同款形状。
- `readTree`（`workspace.js:106-121`）：walk（`:49-73`，串行递归 readdir，跳过规则在「不递归进去」环节）
  → fillInos（`:79-92`，每文件 stat，批 64）→ buildFileTree+sortNodes+addAbs 同步（`:120`）。
  **无条目上限/超时/取消**。`readSubtrees`（`:127-168`）是子树版。
- 「已包含」拒绝：`classifyRoot`（`src/lib/roots.js:35-46`）判注册表；`child` 分支 `ipc.js:586-589`；
  toast 文案在 `sidebar.js:195-196`。
- 「父目录吸收」确认已有 token 模式可抄：`pendingAbsorb`（`ipc.js:41,590-598` + `ws-absorb-confirm` `:611-645`）。
  ⚠ `ws-absorb-confirm` 在 `:644` 同步 `await readTree` 全量阻塞——本包顺手让它也走两段式/预算。
- 菜单栏：`main.js:130-181`，无任何移除/重置入口；`workspaceStore.clear()`（`workspace-store.js:174`）
  是没人调的死代码。菜单→renderer 走 `webContents.send('menu', cmd)`（现有 `onMenu` preload 通道）。
- 失联根已有「重新定位/移除」UI（`sidebar.js:658-679`）——巨型根**不会**进 missing 态（目录可达），
  但这套 UI 形状可以给「过大」态抄。
- 诊断探针：`perfDiag.recordRead(path, ms, fileCount)`（`workspace.js:119`）。
- e2e 基建：`e2e/*.spec.js`，Playwright-Electron，launch 模板见 `e2e/app.spec.js:14-28`
  （env `WS2_USERDATA` 指临时 userData——**毒化 workspace.json 测试就靠它**）；dialog stub 模式见
  `e2e/tabs.spec.js:394-399`；单测 = `node --test test/*.test.js`（**不是 vitest**）。

## 1. 执行切片（顺序做，每片一个 commit）

### U1 · 修 D2：启动路径照抄添加路径（最高杠杆）
`sidebar.js` 启动 IIFE（`:2835-2856`）与 `resyncRoots`（`:703-716`）重排：
1. `wsGetRoots()` 一返回就 `rootsState = infos.map((r) => mkRootState(r, null))`（loading 态）+
   `syncChrome(); render()` —— **根行（含 loading 行）先见人，移除入口即刻可达**。
2. 树改为**逐根串行**加载（for-of await，不再 `Promise.all` 并发全量扫），每根到货
   `st.tree=...; st.loading=false; render()`。一根巨型不阻塞其他根的树到货（串行顺序把小根排前：
   按上次 `fileCount`（perf-diag 有）或注册顺序即可，不强求）。
3. ⚠ **冷启动竞态红线**：`resolveRestore()`（`:2854`）与 restoreReady/`__pendingColdOpen` 的时序是
   血换的（双击 .html 冷启动 vs 恢复工作区抢跑）。改动前先读该区域注释与 `e2e/cold-start.spec.js`、
   `e2e/tabs.spec.js`，保持语义：resolveRestore 的触发不得早于 tabs 恢复所需状态、也不得再被巨型根
   的读树阻塞（建议：rootsState 赋值+首帧后即可 resolve，树独立补齐——若与 cold-open 语义冲突，
   以「不阻塞 + cold-start spec 全绿」为准绳自行裁量并在 PR 里说明）。
**验收**：e2e——毒化 userData（预写 workspace.json 指向一个「读树很慢/过大」的 fixture 根）→
启动后侧栏非空态、根行可见带 loading/过大态、右键可移除、移除后 app 恢复正常。

### U2 · 修 D3：walk 条目预算 + 「过大」根态
- `workspace.js` walk 加预算：遍历中计数（文件+目录），超过 `TREE_BUDGET` 停止遍历，返回带
  `truncated: true` 与 `entryCount`。**默认 150,000**（Colin 拍板），
  `WS2_TREE_BUDGET` 环境变量可覆盖（e2e 用小值）。`readTree` 透传 truncated；truncated 时**跳过
  fillInos**（省 15 万次 stat 的意义都没了）；`readSubtrees` 同预算同形状。
- renderer：`truncated` 的根**不渲染局部树**（半棵树比没有更误导），根行下渲染一条「过大」提示行：
  「此文件夹包含超过 15 万个项目，Wordspace 暂时无法完整打开——建议移除后选择具体的工作文件夹」+
  内联 [移除] 按钮（走现有 `removeRootUI`）。根行右键菜单照常可用。样式抄失联根的降级行（`:658-679`）。
- watcher 联动：truncated 根**不做**全量重扫响应（tree-changed 事件对它 no-op），防永动机。
**验收**：node:test——合成 tmp 树超预算 → truncated=true、entryCount 正确、恰好等于预算不截断
（边界）、fillInos 被跳过;e2e——`WS2_TREE_BUDGET=50` + 60 文件 fixture → 过大行渲染、可移除、
app 全程可交互。

### U3 · 修 D4：不依赖树渲染的逃生门
菜单栏（`main.js` File 菜单）加「管理文件夹…」→ `send('menu','manage-roots')` → renderer 弹一个
极简 modal（复用现有 modal 壳样式）：直接 `wsGetRoots()` 列出**注册表**里的根（名字+路径+状态），
每行 [移除] 按钮走 `wsRemoveRoot`（复用现有撤销 toast 逻辑可选，不强求）。这个入口**只依赖注册表
IPC，不依赖 rootsState/树**——是 D2 修复失效时的兜底逃生门。
**验收**：e2e——空态下菜单触发 manage-roots modal 列出根并成功移除。

### U4 · 病灶路径确认框（抄 pendingAbsorb token 模式）
`ws-add-folder` 在 classifyRoot 之前判病灶路径：`os.homedir()`、`/`、`/Users`、`/Users/<x>`（家目录
本身）、`/Volumes/<x>`（卷根）→ 返回 `{status:'confirm-huge', token, path, name}`（token 存
pendingHuge Map，形状抄 `pendingAbsorb`）；renderer 弹确认框：「你选的是整个用户目录/磁盘，
通常包含数十万系统文件，可能非常慢。建议选择里面具体的工作文件夹。[仍要打开] [换一个文件夹]」，
确认走 `ws-add-folder-confirm(token)` 继续原 `independent` 流程。
**验收**：e2e——dialog stub 返回 `os.homedir()` → 确认框出现;取消不注册;确认后照常注册（配合
小预算 → 过大态）。

### U5 · 修 D5：拒绝文案给出口
`child` 拒绝 toast（`sidebar.js:195-196`）:若父根当前 `loading` 或 `truncated`（非正常态），文案改为
「『X』在你打开的『Y』里——但『Y』还没加载出来/过大。可以在 管理文件夹 里移除『Y』后再打开『X』」
并附动作按钮直接打开 U3 的 manage-roots modal。正常态保持原文案。
**验收**：e2e——注册过大根后添加其子文件夹 → 新文案 + 按钮可达 modal。

### U6 · 门 + spec + 收尾（同 PR）
- `e2e/bigroot.spec.js`：U1-U5 的验收全落这里 + **变异自检**（把预算守卫打坏（预算改巨大/判断取反）
  → 过大态断言必翻红；先 commit 再变异；fixture 条目数别与预算凑巧同长度）。
- 新建 `docs/features/workspace-big-roots.md` 占位 spec（铁律：改真 app UI 必须同 PR 建 spec）：
  行为契约 = 本 plan U1-U5 的用户可感知行为；欠账 = ui-demo 对齐未做 + P0b 懒加载。
- `npm test` 全绿;动了 sidebar/ipc/workspace 核心 → 推 PR 前 `npm run test:e2e:dot` 全量本地兜底
  （宿主跑;已知 3 个视觉取色测试在宿主本来就红、CI 上绿——见 PR #216 评论的核实记录，别被吓到，
  其余必须绿）。
- CHANGELOG 不动（发版时再写）。

## 2. 完成定义

全部 U 验收绿 + `npm test` 679+ 全绿 + `e2e/bigroot.spec.js` 全绿含变异自检 + 全量 e2e:dot 本地
兜底（除已知 3 条宿主色差）+ rebase 最新 main 后 CI（test+e2e）绿 + feature spec 占位就位。
PR 开出来即报告，**不自合**——主 session 要做对抗审查。

## 3. 红线

- 别动 srcdoc 样式镜像、CSP、blockedit——本包只碰 sidebar.js / ipc.js / workspace.js /
  workspace-store.js / main.js / file-tree.js 及新增文件。
- 冷启动竞态（restoreReady/__pendingColdOpen）语义不得破坏——cold-start/tabs spec 是权威。
- 预算值 150,000 是拍板值，别改;e2e 一律用 `WS2_TREE_BUDGET` 覆盖,别造真 15 万文件的 fixture。
- 「过大」态的根**照常持久化**（D1 不在本包根治——可见+可移除+不重扫后，持久化无害且保留用户意图）。
