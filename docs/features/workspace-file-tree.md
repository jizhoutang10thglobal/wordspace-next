# 工作区文件树 —— 对齐 spec

## 行为契约

把文件夹当工作区打开时，文件树递归扫描该文件夹，但按三类忽略——治「打开大文件夹 / 桌面特别卡」
（Wendi 2026-07-11 实测根因：桌面里的 `Minecraft.app` 被当普通文件夹递归钻进去，内部上万文件把 readTree 卡死）：

- **macOS 包（package/bundle）**：`.app` / `.framework` / `.bundle` / `.photoslibrary` / `.fcpbundle` /
  `.dSYM` / `.pkg` / `.mpkg` / `.plugin` / `.kext` / `.xpc` / `.component` / `.qlgenerator` / `.prefPane` /
  `.imovielibrary` / `.tvlibrary` / `.aplibrary` / `.musiclibrary` 等——树上**显示成单个节点，不递归进内部**
  （Finder 同款：包在 Finder 里就是单个文件；一个 `.app` 内部可几千到十几万文件）。

- **依赖 / 构建 / 缓存目录**：`node_modules`、`.git`、`bower_components`、`__pycache__`、`Pods`、
  `DerivedData`、`venv`——**完全隐藏**（对文档编辑器是纯噪音，且是文件数炸弹，`node_modules` 常 10 万+）。
  **不含** `build`/`dist`/`out`/`target` 这种普通词，怕误伤用户真文件夹。

- **隐藏文件**（点开头 `.xxx`，含 `.DS_Store`/`.Spotlight-V100`/`.fseventsd` 等）+ 原子写临时文件
  （`.ws2tmp*`）——**完全隐藏**。

判定按名字/后缀（不引 macOS UTI，够用且简单）。实现：判定住在 `src/lib/file-tree.js`
（`isSkippedName` / `isBundleName`，2026-07-14 从 workspace.js 局部挪进 lib——watcher 要共用同一份规则），
`src/main/workspace.js` 的 `walk()` 消费。

**外部变化实时跟随的性能语义（2026-07-14，Wendi「还是好卡」修复；行为结果不变——树照样实时跟随磁盘，
变的是响应成本从 O(整棵树) 降到 O(变化子树)）**：

- **噪音事件直接丢弃**：变化路径落在上面三类忽略里（`.DS_Store`、`.git`/`node_modules` 内部、bundle 内部…）
  的磁盘事件在 watcher 层丢弃，不换来任何重扫（`isNoisePath`；bundle *自身*的增删/改名不算噪音——父目录列表会变）。
- **子树级重扫**：watcher 报得出变化路径时，只重扫「受影响目录」的子树（父目录归并 + 祖先去重，cap 8，
  `affectedDirsOf` → IPC `ws-read-subtrees` → renderer 路径拷贝 patch 进旧树）；拿不到路径 / 变化落在根层 /
  太散超 cap → 回落全量 readTree（行为同旧版）。
- **聚焦兜底收口**：窗口 focus 不再对所有根全量重扫（大根「切回 app 就卡」的来源）；改为冲掉在途去抖
  （`ws-watch-flush`，保住 e2e 的 focus 确定性触发）+ 仅对 watcher 失活（平台不支持递归 watch/挂了）的根全量刷新。
- **单飞 + 自适应去抖**：同根扫描在飞时新事件只并进 pending、飞完补跑一次；去抖时长 = 上次扫描耗时 ×2
  （200ms floor / 3s cap，`perf-diag.suggestDebounceMs`）。
- **stat 限并发**：readTree 逐文件取 ino 的 stat 按 64 一批，不再无界并发塞满 libuv 线程池
  （否则打开/保存文档的 IO 全排在几万个 stat 后面 = 整个 app 卡住）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 忽略规则/噪音判定/受影响目录归并 | （无——mock 数据） | `src/lib/file-tree.js`（`IGNORE`/`BUNDLE_EXTS`/`isNoisePath`/`affectedDirsOf`） |
| 扫描（全量 + 子树级） | 同上 | `src/main/workspace.js`（`walk`/`readTree`/`readSubtrees`/`fillInos`） |
| watcher（噪音丢弃/pending 收集/去抖/flush） | 同上 | `src/main/workspace-watcher.js` |
| renderer（单飞/子树 patch/聚焦收口） | 同上 | `src/renderer/sidebar.js`（`onTreeChanged`/`patchSubtrees`/focus 接线） |
| 门 | 同上 | `test/tree-watch-scoped.test.js` + `e2e/live-tree.spec.js`（含噪音/聚焦负断言门，变异自检过） |

## 有意分歧

ui-demo 用 mock / 内存数据、不扫真实文件系统，这套忽略只在真 app 生效——**无 ui-demo 对应实现**，不算漂移。

## 对齐锚点

- app 侧：commit `<待填>`（2026-07-11，本 PR）
- app 侧：分支 `perf/scoped-tree-watch`（2026-07-14，磁盘事件响应 O(整棵树)→O(变化子树)，合 main 后以 merge commit 为准）

## 欠账

若将来 ui-demo 接真实文件系统，需对齐这套忽略规则（bundles / 依赖目录 / 隐藏文件）。
