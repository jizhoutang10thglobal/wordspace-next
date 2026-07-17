# 大根护栏（Big-root guardrails）—— 对齐 spec

两阶段（2026-07-16，Colin 拍板 P0 最高优先级）。诊断正本：
`docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md`（D1–D6 死锁链 + §5 懒加载调研）。
- **P0a 止血包**（`docs/plans/2026-07-16-001-fix-bigroot-deadlock-guardrails-plan.md`）：让 app 遇到巨型根
  不死锁、不冻死、永远可移除。
- **P0b 懒加载架构**（`docs/plans/2026-07-16-002-feat-lazy-tree-big-roots-plan.md`）：把「过大」根从「不可浏览+
  可移除」升级为**可正常浏览编辑的简化模式（lazy）**——浏览层按层懒加载（VS Code 路线），全量枚举类功能按预算降级。

上限的单位是**条目数（文件 + 目录），不是 GB**。整根走全量还是走 lazy 的阈值 = **150,000 条目**
（`WS2_TREE_BUDGET` 覆盖，仅测试）；lazy 模式下单层最多 **50,000** 直接子项（`WS2_DIR_BUDGET` 覆盖）。
本包只在真 app（`src/**`）落地，ui-demo 侧未做（见欠账）。

## 行为契约

上限的单位是**条目数（文件 + 目录），不是 GB**（诊断 §1）。300GB 的视频文件夹毫无压力，
20 万小文件的 `node_modules` 是灾难。所有护栏都以条目数为轴，**永不按字节判断/拒绝**。

### P0a 止血（不死锁、不冻死、永远可移除）

- **启动不被大根门控（U1）**：冷启动恢复上次工作区时，根行（含「正在读取文件夹…」加载行）与右键
  「移除」入口**在读树完成之前就渲染出来、即刻可点**。树逐根串行到货，一根巨型不阻塞其他根、也不阻塞
  整个界面。即便某根读树极慢/失败，用户也永远能看见它、移除它。（修死锁内核 D2。）
- **条目预算触发简化模式（U2 → P0b）**：单根读树遍历到 **150,000** 条目即停止（`WS2_TREE_BUDGET` 覆盖，
  仅测试），该根转 **简化模式（lazy）**（见下）。恰好等于预算不算超（边界）。
- **逃生门（U3）**：菜单栏「文件 → 管理文件夹…」弹 modal，**只依赖注册表（wsGetRoots/wsRemoveRoot），
  不依赖侧栏树/根行渲染**，列出全部根 + 逐个「移除」。这是 U1 万一失效时的兜底移除路径。空态也能开。
- **病灶路径确认（U4）**：添加 `~`（家目录）、`/`（文件系统根）、`/Users`（及其直接子目录 = 各人家
  目录）、`/Volumes/<x>`（卷根）时，先弹确认框劝导选具体工作文件夹：「换一个文件夹（主按钮）/ 仍要打开」。
  取消不注册；「仍要打开」照常注册（配合预算，海量根落简化模式）。
- **拒绝给出口（U5）**：添加子文件夹被「已经在 X 里了」拒绝时，若父根还在加载 / 是简化模式的大文件夹，
  文案改为引导「直接在它里面展开找到，或在『管理文件夹』移除父根后单独打开」，并附动作按钮直达逃生门
  （原文案对正常态父根不变）。
- **持久化**：简化模式根照常持久化（可见 + 可浏览 + 可移除，保留用户意图）。根在读树前就持久化
  （D1）本包不根治——止血靠可见/可移除。

### P0b 简化模式（lazy 浏览，V1–V3）

- **按层懒加载浏览（V1）**：超预算的根进「简化模式」——根行带**「简化模式」徽标**（hover 解释为什么）。
  浏览层**展开哪层读哪层**（`ws-read-dir(rootId, dirRel)` 单层 readdir，成本 O(本层直接子项)、与整棵树规模
  无关），收起不丢已加载数据（**会话内缓存**，不做跨会话磁盘缓存）。单层直接子项超 50,000 → 截断本层 +
  提示。可正常打开文档（展开到文档 → 点击 → 进编辑器）、可移除（根行右键）。**普通根（≤15 万）走全量、
  一字不变。**
- **lazy watcher（V2）**：简化模式根的磁盘变化只重读「**已加载层 ∩ 变化目录**」；overflow / 根层变化 / 平台
  没给路径 → 只重读**已加载集**，**永不全量**（否则高 churn 大根变永动机）。未展开层的变化不触发任何扫描。
  重读保留已加载子树的展开态（不把用户展开的深层重置）。
- **枚举类功能降级（V3）**：简化模式根上——① **筛选**只搜已加载层 + 行尾提示「仅搜索已浏览过的目录」；
  ② **Cmd+P 快速打开**跳过简化模式根 + 面板底注提示；③ **inode 跟随**降级为路径匹配（lazy 层不 stat 取
  ino，外部改名的标签不自动跟随、按失联语义兜，不崩）；④ **链接索引**（@菜单/反链）扫描超预算 → 该根链接
  功能降级，@菜单底注「文件夹过大，链接功能不可用」（也**修了隐雷**：链接索引以前只跳 dotfile、会钻进
  `node_modules`/`.app` 内部——现复用 `isSkippedName`/`isBundleName`）。

### 全量路径性能加固（V4，不改行为，普通根受益）

- `buildFileTree` 的 `ensureDir` 目录查找从线性 `find` 改成 **name→dir 索引（WeakMap）**，消掉超大扁平目录的
  **O(M²)**（实测：15 万同级目录从 68 秒 → 0.6 秒，100×）。索引不进树，输出与旧版**逐字节一致**
  （`test/file-tree-fidelity.test.js` 对老实现差分锁）。15 万条目真实树 build+sort 同步段 <1s。
- `perf-diag` 补盲区：`recordRead` 加**目录计数 + IPC 载荷字节估算**（O(N) 从 rel 长度估、不真序列化，避免给
  普通根加成本）；`recordDirRead` 记 lazy 单层读取次数（诊断面板可见，也是 V2「未展开层不扫描」的证据）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 启动/串行加载/resync | （未做） | `src/renderer/sidebar.js` 启动 IIFE、`resyncRoots`、`loadRootTree` |
| 条目预算 walk（整根 lazy 阈值） | （未做） | `src/main/workspace.js` `walk`/`treeBudget`/`readTree` |
| 按层读取（lazy 浏览，V1） | （未做） | `src/main/workspace.js` `readDir`/`dirBudget`；`src/main/ipc.js` `ws-read-dir`；`src/renderer/sidebar.js` `loadLazyTop`/`loadDirChildren`/`renderNode(lazy)` |
| 简化模式渲染（徽标） | （未做） | `src/renderer/sidebar.js` `renderRootSection`（`root.lazy` 分支 + `简化模式` 徽标）、`mkRootState` |
| lazy watcher 交集（V2） | （未做） | `src/renderer/sidebar.js` `doLazyScan`/`loadedLazyDirs`/`patchLazyLevel`（`doTreeScan` 分派） |
| 枚举降级（V3） | （未做） | 筛选/Cmd+P：`src/renderer/sidebar.js` `renderRootSection`/`openFindPalette`；链接索引：`src/main/link-index.js` `listFilesMatching`/`isDegraded`、`src/main/ipc.js` candidates `degraded`、`src/editor/mention.js` 降级提示 |
| 全量路径加固（V4） | （未做） | `src/lib/file-tree.js` `buildFileTree`（ensureDir WeakMap 索引）；`src/main/perf-diag.js` `recordDirRead`/payload |
| 逃生门 menu + modal | （未做） | `src/main/main.js`（菜单项）、`src/renderer/shell.js`（onMenu）、`src/renderer/sidebar.js` `openManageRootsModal` |
| 病灶路径判定 | （未做） | `src/lib/roots.js` `dangerRootReason`；`src/main/ipc.js` `hugeRootReason`/`resolveAdd`/`ws-add-folder(-confirm)` |
| 拒绝出口文案 | （未做） | `src/renderer/sidebar.js` `handleAddResult` 的 `child` 分支 |

## 有意分歧

- **ui-demo 侧完全未实现**：P0a/P0b 都是真 app 上 Colin/Wendi 实际中招的紧急工作，先只做真 app（Colin
  2026-07-16 拍板：止血/可用优先）。ui-demo 对齐仍是欠账。

## 对齐锚点

- ui-demo 侧：（无——未实现）
- app 侧：P0a commit `fix/bigroot-p0a`（PR #236）；P0b commit `feat/bigroot-lazy`（2026-07-16，本 PR 合并后填 sha）

## 欠账

- **ui-demo 对齐未做**：整套护栏 + 简化模式在 ui-demo 侧没有对应实现（上面「有意分歧」已记）。
- **D1 复发根治**：根在读树前就持久化仍在（无害：简化模式根现在可见 + 可浏览 + 可移除）；彻底不复发另议。
- **单个超大扁平目录的单次 readdir 内存峰值**：`readDir`/`walk` 仍用 `fs.readdir` 一次性读入整个目录的
  dirent（几百万直接子项的单目录），`dirBudget` 只截断**返回/遍历**的条目数、截不断 readdir 本身的内存峰值——
  真解要流式 `fs.opendir`，留后续。
- **lazy 根的标签跟随/激活恢复**：简化模式根的标签在外部改名后不 inode 跟随（降级为路径匹配，V3）；冷启动
  不自动打开简化模式根上次激活的文档（findNode 只覆盖已加载层）——都按失联语义兜、不丢标签、不崩，但不如
  普通根顺滑。
- **listDocs（改名/移动重写扫 href）**：`workspace.listDocs`（改名/移动时重写引用）仍是全量扫；简化模式根上
  它会受 walk 预算影响、可能扫不全（改名重写在大根上本就不常用），未单独降级处理。
