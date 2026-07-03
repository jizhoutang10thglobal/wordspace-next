# 多文件夹空间同时打开（Multi-root Workspace）— UX 定稿 + 真 app 后端实现调研

- **状态**：ui-demo 原型已实现（PR 附截图）；本文的后端部分是**调研/设计，未实现**。
- **需求（Colin 2026-07-03）**：目前左侧栏只允许打开一个文件夹。希望能同时打开多个文件夹，甚至把多个文件夹一起打包成一个 workspace。
- **调研基础**：VS Code multi-root workspace（主参照）、Sublime projects、JetBrains attach、Obsidian vault（反例）、Finder 侧栏、Notion teamspace。

---

## 1. UX 定稿（ui-demo 已按此实现）

### 1.1 一条最重要的架构决定：没有「第二种模式」

**「打开一个文件夹」= 恰好只有一个根的工作区。** 不存在「单文件夹模式」和「工作区模式」的切换——VS Code 的双模式是历史包袱，是它最大的概念债（加第二个文件夹的瞬间 settings 位置、窗口标题、变量语义全变，用户懵）。我们从第一天就只有一种模型，untitled/保存只是持久化问题，不是模式切换。

### 1.2 交互词汇（沿用用户已有肌肉记忆，不发明新词）

| 动作 | 入口 | 语义 |
|---|---|---|
| **添加文件夹…** | 侧栏文件树底部常驻一行（+ 图标） | 往当前空间再挂一个根，与现有文件夹并排打开（= VS Code "Add Folder to Workspace…"） |
| **从工作区移除** | 根标题右键菜单（≥2 个根时才出现） | 移除该根：文件树/标签页整组撤走，**磁盘文件不动**（remove ≠ delete），toast 可撤销 |
| **保存工作区…** | 未保存提示条上的「保存…」按钮 | 把当前一组文件夹命名固化（= "Save Workspace As…"）；之后空间切换器里带「工作区」徽标 |
| **工作区切换** | 现有的空间切换器（SpaceSwitcher） | 已保存的工作区就是一个空间条目，一键整组打开 |

### 1.3 侧栏形态

- 每个根 = 一节：**根标题行**（折叠箭头 + 磁盘图标 + 显示名 + 右对齐灰字完整路径，hover title 也是完整路径）+ 它自己的一棵文件树。根标题行同时是「拖文件到该根顶层」的落点。
- 根显示名默认取路径末段（`~/Projects/品牌升级` → `品牌升级`）。重名根靠灰字路径消歧（改名 UI 延后）。
- **未保存工作区提示条**（untitled workspace 语义）：根数 ≥2 且未保存时，树顶显示细虚线条「N 个文件夹 · 未保存为工作区 [保存…]」。加第二个文件夹的瞬间**绝不弹窗打断**——先用后存。
- 空态：所有根都移除后显示「这个空间还没有打开任何文件夹」+ 添加文件夹按钮。
- 筛选框跨全部根过滤；无命中的根整节隐藏。

### 1.4 身份规则（数据层，先于 UI）

文件身份从 `(spaceId, path)` 升级为 **`(spaceId, rootId, path)`**。两个根里同名的相对路径（demo 种子里故意让两个根都有 `素材/`）不再互撞。受牵连的所有键都加 rootId 限定：标签页匹配、树折叠状态 key（`file:<rootId>:<path>`）、重命名/移动/删除的路径前缀改写、查找面板候选 id、新建文档目标 `{rootId, dir}`。**跨根拖拽移动 = v1 禁止**（真实后端是跨设备 EXDEV 语义，另立项）。

### 1.5 v1 明确不做（防 review 误判为遗漏）

根拖拽重排（按加入顺序）、根改显示名 UI、重名根自动父目录消歧、per-root 过滤规则、跨根移动文件、工作区级设置。

---

## 2. 真 app 现状盘点（origin/main 实测，改动面的依据）

真 app 今天是**严格单根**，单根假设散在五处：

1. **`src/main/ipc.js` 的 `activeRoot` 模块单例**：`pick-folder` 设置它；所有 `ws-*` handler 走 `requireRoot()`，只收 relPath，`assertInsideWorkspace(root, rel)` 把关。**安全模型：renderer 永远不发根路径**（防篡改 workspace.json 提权），这条红线多根化后必须保住。
2. **`src/main/workspace-store.js` 持久化 schema**：`{ root, savedAt, tabsByRoot: { [absRoot]: { entries, activeRel } } }`——单一 last-root，tab 状态按根分桶。
3. **`workspace-watcher.js` 单例**：一个 `fs.watch(root, {recursive:true})`，广播无 payload 的 `'ws-tree-changed'`。
4. **标签页身份 `keyOf = rel || abs`**（`src/lib/tabs.js:16`）：工作区内文件用根相对 rel，外部文件（Cmd+O）用 abs。**两个根里同 rel 会撞 key**——和 ui-demo 撞的是同一堵墙。
5. **`sidebar.js` 的 `current = { root, name, tree }` 单对象状态**：树渲染、筛选、查找面板、expandToFile、所有 `rootBefore` 竞态守卫都假设一棵树。

编辑器/shell 层基本免疫：`shell.js` 操作绝对 `docPath`、根无关；`workspace.js` 的文件操作本来就把 `root` 当参数（纯函数、有 node:test）——**单根耦合集中在 ipc 状态、store、watcher、sidebar 四处**，改动面是收敛的。

## 3. 后端目标设计（调研结论,未实现）

### 3.1 数据模型

```
roots: [{ id, name?, path }]        // 有序；id 稳定（uuid），path 绝对路径
activeWorkspace: { roots, savedAs? } // savedAs = workspace 文件路径（未保存则无）
```

- `ipc.js`：`activeRoot` 单例 → **root 注册表（allowlist）**。每个 `ws-*` 通道加 `rootId` 参数；`requireRoot()` → `requireRoot(rootId)`（查 allowlist，查不到即拒）。**renderer 仍然只能用 rootId 引用根、永远不发路径**——安全模型原样保住，`assertInsideWorkspace` 拿 rootId 解析出对应根再校验 rel。
- 标签页身份：`keyOf = rel || abs` → **`keyOf = rootId + ':' + rel || abs`**（或全部升级为 abs——但 abs 会让树高亮/持久化在根移动后断，倾向 rootId+rel 二元组）。触及 `lib/tabs.js` 纯逻辑 + sidebar `data-rel` 选择器 + 持久化 + e2e 选择器，**是最大的一块机械改动**。
- watcher：单例 → **per-root watcher map**；`'ws-tree-changed'` 带 `rootId` payload，renderer 只重读对应根的树。
- `workspace-store` schema 迁移：`root: string` → `roots: []` + `tabsBy` 重新按 workspace（而非单根）分桶；旧格式读到时做一次性迁移（roots=[root]）。

### 3.2 workspace 文件（打包成 workspace 的载体）

跟 VS Code / Sublime 完全一致的约定，避免发明格式：

```jsonc
// 品牌项目.wsworkspace （JSON）
{
  "folders": [
    { "path": "../Projects/品牌升级" },            // 相对路径，锚点 = 本文件所在目录
    { "name": "资料", "path": "/Users/x/Documents/产品资料" } // name 可选，覆盖显示名
  ]
}
```

- **相对路径锚在 workspace 文件自身位置**；「另存为」到新位置时自动重写相对路径（不做这条，用户挪一下文件整个工作区就断——VS Code/Sublime 都做了）。
- untitled 生命周期照抄 VS Code：加第二个文件夹静默生效（内部 untitled 状态），**只在关窗时问一次**「要不要保存这个工作区」，默认按钮=不保存。
- 死路径根：启动时某根不存在 → 显示为错误态（可见、可移除），**不悄悄丢掉**。
- 双击 `.wsworkspace` 打开 = 后续可选（要注册文件关联）；v1 从「打开工作区…」菜单进。

### 3.3 实现顺序建议（等 ui-demo 过了 Wendi review 再排期）

1. `lib/tabs.js` keyOf 二元组化 + 单测（纯逻辑，先行）
2. `ipc.js` root 注册表 + 全通道 rootId 化 + `workspace-store` 迁移
3. per-root watcher + tree-changed 带 payload
4. `sidebar.js` 多根渲染（照 ui-demo 的 RootSection 形态）+ 添加/移除/保存工作区三个动作
5. workspace 文件读写 + untitled 生命周期 + Open Recent
6. e2e：多根树渲染 / 同 rel 不同根不串 tab / 移除根关对应标签 / workspace 文件 round-trip

### 3.4 风险

- **keyOf 改动波及面**（持久化格式、e2e 选择器、外部文件 abs 分支）——建议独立 PR 先行。
- 跨根拖拽 = 跨设备 `EXDEV`，`workspace.movePath` 需要 copy+delete 回退——v1 直接禁,后续单独做。
- 多个 `fs.watch(recursive)` 的资源占用（JetBrains 官方警告 attach 多了拖性能）——v1 限根数量上限（如 8）即可。

---

## 4. ui-demo 实现映射（本 PR）

| 概念 | 代码 |
|---|---|
| 根实体 | `types.ts` `MountRoot { id, name, path }`；`Space.roots?: MountRoot[]`、`workspaceSaved?: boolean` |
| 文件/目录/标签身份 | `FileEntry.rootId` / `dirs[].rootId` / `Tab.rootId`；所有 store 文件操作按 `(spaceId, rootId, path)` 匹配 |
| 根节 UI | `ArcSidebar.tsx` `RootSection`（折叠/右键/拖放落点）+ `.arc-root-*` 样式 |
| 添加文件夹 | `AddFolderModal.tsx` + `store.addRootToSpace`（demo 无真 FS，新根载入示例树） |
| 移除根 | 根标题右键 → `store.removeRootFromSpace`（快照整组撤走 + toast 撤销） |
| 保存工作区 | 提示条「保存…」→ `SaveWorkspaceModal.tsx` + `store.saveWorkspaceAs`（demo 里工作区=空间本身：命名+徽标） |
| 新建/保存文档定位 | `ui.ts` `createTarget: {rootId, dir}`；`SaveModal` 目标列表按根分组 |
