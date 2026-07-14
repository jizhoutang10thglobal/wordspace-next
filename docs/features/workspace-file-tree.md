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

- **Windows / 云盘垃圾文件**（名字不带点、靠隐藏属性藏身，跨系统同步后在 macOS 现形——Wendi
  2026-07-14 报的场景：工作区在公司共享云盘、team 里有 Windows 同事）——**完全隐藏**：
  `desktop.ini`、`Thumbs.db`、`ehthumbs.db`（大小写不敏感）、`$RECYCLE.BIN`、`System Volume Information`、
  `~$` 前缀（Office 打开文档时的锁文件，如 `~$报告.docx`）、`Icon\r`（macOS 自定义文件夹图标，名字是
  `Icon`+回车）。**不误伤** `desktop.html` / `~波浪号.html`（单 `~`）/ `Iconography.html` 这类形似的合法文件。

判定按名字/后缀（不引 macOS UTI，够用且简单）。实现：判定住在 `src/lib/file-tree.js`
（`isSkippedName`（含 dotfile / `.ws2tmp` / `IGNORE` 依赖目录 / `JUNK` 云盘垃圾）/ `isBundleName`，
2026-07-14 从 workspace.js 局部挪进 lib——watcher 要共用同一份规则），`src/main/workspace.js` 的
`walk()` 消费。

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

**添加文件夹的加载反馈（2026-07-14，Wendi「点添加桌面后卡 4-5 秒无反馈」修复）**：初次添加/复活一个根走
**两段式**——`ws-add-folder` 的 `added`/`revived` 分支立刻回 `{status, root}`（**不带 tree**、不阻塞在全量
readTree 上），renderer 立即把根装进侧栏 + 渲染「正在读取文件夹…」加载行（`.sb-loading`，安静呼吸动效、
`prefers-reduced-motion` 下静止），再 `wsReadTree` 异步填树。读不到（不可达）→ 转失联灰态（不当空树，避免
reconcile 清标签）。加载期间该根 `st.tree` 仍为 `null`，watcher 事件被 `doTreeScan` 的 `!st.tree` 守卫自然
no-op，不与第二段的 wsReadTree 打架。

## 标签点击与树定位（reveal 三态，2026-07-14）

标签区（置顶 + 标签页）和文件树共用同一个滚动容器 `#sb-body`，在树里 `scrollIntoView` 一个文件行会把
上方标签区一起顶走——**滚动才是刺眼的「往下跳」本体**（展开本身不跳视口）。所以把「展开」和「滚动」拆开，
按入口三态处理（`openTabRow(entry, reveal)` + `expandToFile(rootId, rel, scroll)`）：

| 入口 | 展开折叠目录 | 滚动定位 | 说明 |
|---|---|---|---|
| **点标签**（标签页区 / 置顶区行） | **是** | **否** | 展开到该文件 + 高亮，但不滚视口（Colin 2026-07-14：折叠着也要展开露出来，只是别把视口往下跳）。`reveal='expand'` |
| 关标签后回落到相邻标签 | 否 | 否 | Colin 2026-07-09：关标签不该让树跳到别处（连展开都不做）。`reveal=false` |
| Ctrl+Tab 循环切换 | 否 | 否 | 同上。`reveal=false` |
| 外部打开 / Finder 双击 / 命令面板 F6 定位 / 存盘后定位 / drag-rebase 重激活 / 冷启动恢复 | 是 | 是 | 「主动去找某文件」或程序化重激活，展开+滚动都有助定位。`reveal=true`（默认） |

高亮（`highlightActive`）恒执行。**沿革**：原「点标签自动展开+滚动定位」是 Wendi 2026-07-03 的 F6-①
（原 e2e `UX4`）；Wendi 2026-07-14 报滚动刺眼，Colin 拍板拆成「展开保留、滚动去掉」（e2e 改写为 `UX4v3`，
scrollIntoView 探针做强门）。改动别把滚动加回点标签路径。

## 树交互契约（bug-hunt 2026-07-15）

一批 P2/P3 探索测试修复沉淀的行为契约（实现均在 `src/renderer/sidebar.js`，除注明外）：

- **改名不改格式**（P3-03）：内联改名时用户输入若自带文档后缀（`.html`/`.htm`/`.md`），剥掉再拼回**原**后缀——
  不叠双后缀（`火箭.md` 落 `火箭.html`、不是 `火箭.md.html`）。想真换格式请走「另存为 / 导出」，v1 不在改名里做
  md↔html 转换。判定在 `src/main/workspace.js` `renamePath`（`DOC_EXTS`），换了后缀时回 `formatKept` 让侧栏 toast 提示。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 忽略规则/噪音判定/受影响目录归并 | （无——mock 数据） | `src/lib/file-tree.js`（`IGNORE`/`BUNDLE_EXTS`/`isNoisePath`/`affectedDirsOf`） |
| 标签点击 reveal 三态 | 同上 | `src/renderer/sidebar.js`（`openTabRow(entry, reveal)` / `tabRow` onclick / `expandToFile(rootId,rel,scroll)` / `suppressScrollOnce` / `highlightActive`）+ `e2e/tabs.spec.js` `UX4v3` |
| 扫描（全量 + 子树级） | 同上 | `src/main/workspace.js`（`walk`/`readTree`/`readSubtrees`/`fillInos`） |
| watcher（噪音丢弃/pending 收集/去抖/flush） | 同上 | `src/main/workspace-watcher.js` |
| renderer（单飞/子树 patch/聚焦收口） | 同上 | `src/renderer/sidebar.js`（`onTreeChanged`/`patchSubtrees`/focus 接线） |
| 门 | 同上 | `test/tree-watch-scoped.test.js` + `e2e/live-tree.spec.js`（含噪音/聚焦负断言门，变异自检过） |
| 添加文件夹两段式加载 | 同上 | `src/main/ipc.js`（`ws-add-folder` added/revived 不带 tree）+ `src/renderer/sidebar.js`（`pickFolder`/`loadRootTree`/`renderRootSection` 加载行）+ `src/renderer/shell.css`（`.sb-loading`）+ `e2e/multi-root.spec.js` `MR-load` |

## 有意分歧

ui-demo 用 mock / 内存数据、不扫真实文件系统，这套忽略只在真 app 生效——**无 ui-demo 对应实现**，不算漂移。

## 对齐锚点

- app 侧：commit `<待填>`（2026-07-11，本 PR）
- app 侧：分支 `perf/scoped-tree-watch`（2026-07-14，磁盘事件响应 O(整棵树)→O(变化子树)，合 main 后以 merge commit 为准）
- app 侧：分支 `fix/hidden-junk-files`（2026-07-14，Windows/云盘垃圾文件名单，Wendi）
- app 侧：分支 `fix/add-folder-loading`（2026-07-14，添加文件夹两段式加载反馈，Wendi）
- app 侧：分支 `fix/tab-click-no-reveal`（2026-07-14，本 PR：点标签展开+高亮但不滚动视口，拆 F6-①的展开/滚动，Colin 定）

## 欠账

- 若将来 ui-demo 接真实文件系统，需对齐这套忽略规则（bundles / 依赖目录 / 隐藏文件 / 云盘垃圾）。
- macOS `chflags hidden`（UF_HIDDEN）设的隐藏——名字不带点、不在垃圾名单里时按名字判不出来；Node fs 读不到
  BSD flags（无原生 API），本轮不处理。待有真实用户案例再评估是否引原生方案。
- **`ws-absorb-confirm`（嵌套「并入并添加」）仍同步 `await readTree`**：吸收新父根时全量扫描仍阻塞回复。
  较罕见 + 有 rebase 复杂度，本轮未改两段式；有需要再对齐。
- **冷启动多根恢复（`ws-get-workspace`）仍全量 `await readTree`**：启动时多个大根串行全量扫描仍会拖慢首屏，
  是同类卡顿的另一个面，单独立项，本 PR 不动。
- **扫描本体提速（U2）**：ino stat 移出首帧关键路径 / walk 有界并发——两段式已消除「干等无反馈」，扫描本身
  的耗时是另一层优化，用 `ws-diag` 量化后单独 PR。
