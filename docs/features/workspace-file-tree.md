# 工作区文件树 —— 对齐 spec

## 行为契约

**空态入口（Wendi 2026-07-15）**：没打开任何文件夹时，侧栏底部（收藏/置顶/标签页之下）有「打开一个本地文件夹…」
提示 + 「打开文件夹」按钮（`#sb-empty`，走 `pickFolder`）。之前它夹在收藏与置顶之间，已挪到最底（详见
`docs/browser-feature-spec.md` §3.1）。注意：0 根且无网页标签时侧栏整体不显示，通用空态由编辑区首页欢迎屏承担；
`#sb-empty` 只在「0 根 + 有网页标签」态下可见。

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

## 侧栏宽度（2026-07-16，Wendi 视频反馈）

侧栏右边界可拖拽调宽，**夹取范围 240–520px**，存 localStorage（ui-demo `ws-arc-width` / 真 app
`ws2-sb-width`）、重启恢复。**最小 240 的由来**：顶排图标行（收起/后退/前进/刷新/历史/查找）的最小
内容宽 ~238px（真 app）/ ~237px（ui-demo，含假红绿灯、顶排图标 26px），旧下限 180 会让右端图标溢出
被内容区盖掉「消失」。三层防线：拖拽 JS 夹取 + 读存值时夹取（旧存值 <240 夹到 240，不跳回默认宽）+
容器 CSS `min-width: 240px` 兜底（收起态归零不受影响）。想比 240 更窄 = 走「收起侧栏」（Cmd+\）。
**往顶排加图标前先重算这笔账**（两边 CSS 里有注释），e2e 门会拦：拖到极限 240 + 顶排 6 图标几何边界
全在侧栏内（坐标断言）+ 旧存值迁移。

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

## 外部标签收编（2026-07-17，Wendi bug）

标签身份两类（`src/lib/tabs.js` keyOf）：工作区内 = `rootId:rel`，工作区外 = 绝对路径 abs（↗ 标记）。
**收编契约**：外部标签指向的文件一旦出现在某个已加载的树里，标签就并进 rel 身份——↗ 消失、
open/pinned 取并集、激活跟随、abs 旧条目销毁（引擎 = `sidebar.js` `mergeExternalDupes`）。触发点 =
所有「树内容到货」处：`loadRootTree`（添加文件夹/启动/复活）、`loadLazyTop`/`loadDirChildren`
（简化模式逐层加载）、`adoptRoot`（吸收/撤销移除带树进来）、`loadTabs` 末尾（启动自愈存量坏状态，
不带 rootId = 对全部根收编）。

沿革：引擎原本只为「根失联/被移除期间开过里面的文件、复活后去重」建（MR-ADV-5），只挂在
`validateRootEntries`（复活/重定位路径）。最常见的「先开单独文件、**再**添加它所在的文件夹」没接线——
外部 ↗ 永驻还被持久化；重启时激活恢复经 onOpen 按树重解析，同一文件翻出两条标签（Wendi 2026-07-16 报）。
门：`e2e/tabs.spec.js` 「先开工作区外文件、再添加其所在文件夹为根」+「启动自愈」两条（先写测试后修复，
修复前双红 = 变异证据）。

### viewer 态文档收编（2026-07-17 第二半，plan `docs/plans/2026-07-17-001`）

上面的引擎只认 tabState 里的条目；**0 根**时打开的文件走单文件 viewer 态（侧栏不挂、不建标签——这仍是
设计而非 bug），文档只活在 shell 的 `docPath`/`viewerFile` 里，添加文件夹后引擎对它视而不见 → 游离
（树行高亮、标签区空），且树里重点被 shell 同文档早退守卫短路、救不回（Colin 2026-07-17 截图）。

**契约**：侧栏一旦在场，**任何打开中的真文件必须以标签形态可见**——编辑器文档（html/md）与查看器文件
（PDF/图片，Colin 2026-07-17 拍板纳入）同待遇。树内 = rel 身份（无 ↗）、树外 = abs ↗ 外部身份（与
「工作区在场时打开根外文件」现行为一致）。收编是**纯身份登记**：不 reload、不碰编辑器/自动保存/dirty。
**web/temp 标签激活时收编整个跳过**（Colin 拍板「不冒，不打扰」；也防「用户关掉的标签被树到货复活」），
重入通道 = 树里点它（shell 同文档守卫的兜底分支补建 entry）。先后开多个只收编当前显示的（单槽语义）。

实现：`shell.js` `viewerFile` 状态 + `__shellOpenFileAbs()`（docPath ?? viewerFile.abs）+ 同文档守卫兜底
（`hasTabFor` 双域判定）；`sidebar.js` `adoptOpenFile()` 并入 `mergeExternalDupes` 末尾（自动继承其全部
现在/将来触发点）、走 `onOpen` 既有漏斗建 entry。门：`e2e/tabs.spec.js`「viewer 收编」四条（冷开收编/
根外 ↗ +点击路由/PDF/web 门+U2 兜底+不复活）。

## 树交互契约（bug-hunt 2026-07-15）

一批 P2/P3 探索测试修复沉淀的行为契约（实现均在 `src/renderer/sidebar.js`，除注明外）：

- **改名不改格式**（P3-03）：内联改名时用户输入若自带文档后缀（`.html`/`.htm`/`.md`），剥掉再拼回**原**后缀——
  不叠双后缀（`火箭.md` 落 `火箭.html`、不是 `火箭.md.html`）。想真换格式请走「另存为 / 导出」，v1 不在改名里做
  md↔html 转换。判定在 `src/main/workspace.js` `renamePath`（`DOC_EXTS`），换了后缀时回 `formatKept` 让侧栏 toast 提示。
- **失联根自动复活探测**（P3-08，`src/main/ipc.js`）：根转失联（外部改名/拔盘）后挂 5s 一次的 `dirExists`
  轮询（`scheduleReviveProbe`/`reviveTimers`）；路径改回原样 / 外置盘插回即自愈——清 `missing`、重挂 watcher、
  广播 `ws-roots-changed` + 该根全量 `ws-tree-changed`，免手点「重新定位」。根移除/重定位/复活/退出取消 timer。
- **文件夹可拖拽移动**（P2-1）：目录行 `draggable=true`，dragstart 记 `dragNode=dir`，复用文件行 / dir 行 /
  根标题的既有 drop（同根走 `doMove`、跨根走 `doMoveAcross`，标签/collapsed 键跟随）。**禁入自身子树**：前端
  `dropWouldNest` 拒绝 + toast，后端 `movePath` 兜底。右键「移动到…」不做（新交互另过 Wendi）。
- **吸顶祖先行接受拖放**（P2-5）：`renderSticky` 的克隆行照 `oncontextmenu` 转发模式补 `ondragover`/
  `ondragleave`/`ondrop`——转发给真行既有 handler（读模块级 `dragNode`），高亮反馈同步到克隆行。吸顶行拖放
  行为等同真行，不再是死区。
- **多条删除各自可撤销（toast 堆叠）**（P2-2）：`showToast` 改栈式——每条独立 DOM + 独立超时 + 独立撤销
  闭包，不再 `innerHTML=''` 顶掉上一条。连删多个时每条的「撤销」各撤各的（删除 token 一删一个）。带撤销条
  超时 15s、无撤销 6.5s；上限 4 条、超出先挤最旧的无撤销条。host 是底部锚定纵向 flex（shell.css 已有）。
  ⚠ 堆叠后 `.sb-toast` 不再是单例，断言要按文案 scope（e2e 里 `.sb-toast', { hasText }`）。
- **树展开态跨重启持久化（缓存语义，rel 失效即弃）**（P3-07）：`workspace-store` 加 `treeState`
  字段 `{ expandedByRoot: {rootId:[rel...]}, collapsedRoots: [rootId] }`——存「偏离默认」的部分（目录默认收起→
  存被展开的目录 rel、cap 500/根；根默认展开→存被收起的根），走既有防抖原子写（`ws-set-tree-state`，写盘前滤
  掉不在册的 rootId）。启动 `restoreTreeState()` 在 `mkRootState`（已全收起）之后、首次渲染前灌回；rel 不在
  当前树即弃。失联/未加载根的展开态用内存 `persistedExpanded` 沿用，别被别根 toggle 的 save 清空。
- **同名跨根消歧**（P3-06）：所有工作区内标签（含置顶区，`tabRow` 两区共用）的 `title` tooltip = `根名 / rel`；
  仅当渲染中的标签（open||pinned）里出现「同名不同根」冲突时，冲突各方名字尾补淡色 `— 根名` 后缀
  （`.sb-tab-rootsuffix` = `--c-text-3`）。无冲突不加、别把标签搞长。`sameNameConflict` 按 basename 分组判定。
- **撤销恢复置顶/打开状态**（P3-05）：删除动作发起时把被删 rel（目录则含级联子孙）的标签 entry 快照
  （pinned/open/kind/title）存进 undo 闭包；撤销成功后按快照 `openEntry`/`pinEntry` 恢复（文件真回来才恢复）。
  否则 `removeTabsUnder` 删掉 pinned，撤销只还原磁盘、reconcile 当新文件，置顶少还原一半。
- **新目录默认收起，外部/内建一致**（P3-04）：watcher 路径（`doTreeScan`）原本漏了 `collectDirRels`，
  外部 `mkdir` 出来的目录因新 rel 不在 `collapsed` 而渲染成展开。修法：reconcile 后把「真·新目录」（新树有、
  旧树无该 rel，且子树无从旧树挪来的文件 ino＝非改名/移动目的地）加进 `collapsed`。dir 无 ino，靠子文件 ino 判改名。
- **外部删除 dirty 文档 → 挽救式另存提示**（P2-6，Colin 2026-07-14 拍板）：`doTreeScan` 的 `activeRelGone`
  分支在回落/关文档前先过 `__shellIsDirty()`；脏就 `__shellRescueDeletedDirty()` 把编辑器当前内容转成临时
  文档（`docPath` 清空、掐自动保存）+ 建临时标签 + 弹 `openSaveModal(true)`。取消 = 保留为未保存临时文档
  （可稍后再存/关，不丢数据）。非脏照旧回落/空态。

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
| 侧栏宽度拖拽 + 最小 240 | `ui-demo/src/components/ArcSidebar.tsx`（`startResize`/`sbWidth` 初始化夹取）+ `ArcSidebar.css`（`.arc-sidebar` min-width / `.arc-top` 收紧） | `src/renderer/sidebar.js`（`initSidebarResize`，`SB_MIN=240`）+ `src/renderer/shell.css`（`.sb.sb-on` min-width）+ `e2e/tabs.spec.js`「侧栏最小宽度 240」 |

## 有意分歧

ui-demo 用 mock / 内存数据、不扫真实文件系统，这套忽略只在真 app 生效——**无 ui-demo 对应实现**，不算漂移。

## 对齐锚点

- app 侧：commit `<待填>`（2026-07-11，本 PR）
- app 侧：分支 `perf/scoped-tree-watch`（2026-07-14，磁盘事件响应 O(整棵树)→O(变化子树)，合 main 后以 merge commit 为准）
- app 侧：分支 `fix/hidden-junk-files`（2026-07-14，Windows/云盘垃圾文件名单，Wendi）
- app 侧：分支 `fix/add-folder-loading`（2026-07-14，添加文件夹两段式加载反馈，Wendi）
- app 侧：分支 `fix/tab-click-no-reveal`（2026-07-14，本 PR：点标签展开+高亮但不滚动视口，拆 F6-①的展开/滚动，Colin 定）
- 双侧：分支 `fix/sidebar-min-width`（2026-07-16，侧栏最小宽度 180→240 + 顶排图标不裁切，Wendi 视频反馈；ui-demo 与真 app 同 PR）

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

### bug-hunt 2026-07-15 修复批的已知边角（对抗审查记账，非阻塞）

- **compact 链整段拖拽只移最深段**（p2-1，P3）：拖一个被合并显示成「a / b / c」的单行，dragNode = 链尾 c
  （与改名同一「尾身份」模型），移动后 c 落到目标、a/b 留成空壳幽灵目录。非数据丢失（c 内容完好、标签跟随）。
  要不要「整链作为一个单元移动」是产品口径问题，留待拍板；届时同时补一条 compact 链移动的 e2e。
- **后台脏文档被外部删不弹挽救**（p2-6，P3）：挽救分派挂在 `activeRelGone`（激活文档被删）上；一个**非激活**
  标签里的脏文档被外部删，走的是标签级 reconcile、不触发挽救 → 那份未保存改动仍会静默丢。激活文档（高频）
  已保；后台脏文档的挽救要另接 reconcile 的删除分支，本轮未做。
- **失联根 session 内复活不重灌展开态**（p3-07，P3）：`restoreTreeState` 只在启动 `resyncRoots` 跑一次；
  重定位/撤销移除/自愈复活后该根按默认（子夹收起）渲染，展开态要下次完整重启才回来。跨重启的持久化（主用例）正常。
- **p3-07 cap 500 按 DFS 遍历序截断**（nit）：超上限时弃的是树里靠后的目录、非「最久未用」。500 对正常工作区够用。
- **吸顶克隆行高亮小瑕疵**（p2-5，nit）：克隆行内部 dragleave 会瞬时抹掉高亮（闪一下）；根排序拖到吸顶根标题时
  克隆显示 drop 框而非插入线。均纯视觉、drop/排序功能正常。
