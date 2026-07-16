# P0b 懒加载架构：真正支持超大根 · 执行 plan

2026-07-16 Colin 拍板：**P0a（同日 001 plan）合并后立即执行本 plan，不另排期**。
诊断正本 = `docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md`（必读）。
目标：把「过大」根从 P0a 的「不可浏览+可移除」升级为**可正常浏览编辑**——浏览层走懒加载
（VS Code 路线），全量枚举类功能按预算降级。**普通根（≤15 万条目）行为一字不变，零回归。**

执行纪律同 P0a plan 头部（CLAUDE.md 测试纪律/变异自检铁律/worktree/token/rebase）。
本 plan 建立在 P0a 已合并的代码上（过大态/预算/manage-roots 已存在）。

## 0. 设计决策（已拍板/已论证，执行时不再重开）

- **混合模式**，不是全盘重写：readTree 预算内 → 现状全量模式（树/筛选/inode 跟随/Cmd+P 全功能）；
  超预算 → 该根进 **lazy 模式**。切换按根自动判定，用户无感。
- lazy 模式的浏览 = **按层读取**：展开哪个目录读哪层。这是 VS Code 已验证的路线。
- 全量枚举类功能在 lazy 根上**降级而非硬撑**（详见 V3），宁可少功能不可冻死。
- 磁盘格式/链接语义零改动——这是纯运行时/IPC/渲染层的架构调整。

## 1. 执行切片

### V1 · 按层读取 IPC + lazy 树数据模型
- 主进程新 IPC `ws-read-dir(rootId, dirRel)`：单层 readdir（复用 walk 的跳过规则:isSkippedName/
  bundle），返回该层 children（与 readTree 节点同形状,无 ino 或懒 ino）,自身带小预算
  （单目录直接子项 > 5 万 → 截断 + truncated 标记,VS Code 在单层百万子项上也会死,我们直接护栏）。
- renderer:lazy 根的 `st.tree` 只持有已加载的层;节点加 `childrenLoaded` 标志;展开未加载目录 →
  loading 行 → `ws-read-dir` 到货渲染。收起不丢已加载数据(会话内缓存)。
- P0a 的「过大」提示行替换为可展开的 lazy 树 + 根行「简化模式」徽标(hover 解释为什么)。
**验收**:e2e——`WS2_TREE_BUDGET=50` 下 60 文件根进 lazy 模式,逐层展开浏览、打开文档正常;
普通根走全量路径不变(现有 sidebar/live-tree/tabs spec 全绿)。

### V2 · lazy 根的 watcher 语义
- lazy 根的 `ws-tree-changed`:只对**已加载目录集**求交(affectedDirsOf ∩ loadedDirs),交集非空
  → `ws-read-dir` 重读那些层;overflow/null(现在会触发全量重扫)→ 只重读**已加载集**,永不全量。
- 去抖:lazy 根沿用 suggestDebounceMs,但重扫成本已是 O(已加载层),3s 上限不再错配。
**验收**:e2e——lazy 根内外部增删文件,已展开层实时跟新;未展开层的变化不触发任何扫描
(diag 的 scopedReads 计数为证);变异自检:把交集过滤打坏 → 全量扫描出现 = 翻红。

### V3 · 全量枚举功能的降级
- **树筛选**(sb-filter):lazy 根 → 只筛已加载层 + 行尾提示「简化模式:仅搜索已浏览过的目录」。
- **Cmd+P 命令面板**(`sidebar.js:2261-2264` 现在扁平全树):lazy 根跳过 + 面板底注一行提示;
  全量根不变。
- **inode 跟随**(外部改名/移动标签跟随):lazy 根无全量 ino → 降级为路径匹配(改名后标签断链
  转外部标签,现有失联语义已能兜);全量根不变。
- **链接索引**:`listFilesMatching`(`link-index.js:113-129`)修两点——复用 isSkippedName/
  isBundleName(修隐雷:现在会钻 node_modules/.app);加条目预算,超了该根链接功能降级
  (@ 菜单/反链提示「此文件夹过大,链接功能不可用」),别让它替树再做一次全量扫。
**验收**:每项一条 e2e(lazy 根筛选提示/Cmd+P 提示/改名降级不崩/巨根 @ 菜单提示);
全量根上四项功能既有 spec 全绿。

### V4 · 全量路径的性能加固(顺手,不改行为)
- `ensureDir` 线性 find(`file-tree.js:58`)→ Map 索引,消 O(M²)。
- `readTree` 的同步段(buildFileTree+sortNodes+addAbs,`workspace.js:120`)分片让出事件循环
  (每 N 节点 setImmediate)或挪 worker_threads——执行时按改动风险自行选,目标:15 万条目的
  全量根不再有 >1s 的主进程同步冻结。
- perf-diag 补盲区:recordRead 加 payload 字节数与目录计数。
**验收**:node:test——Map 版 buildFileTree 与旧版输出逐字节一致(fidelity);合成 15 万树
readTree 主进程最长同步段 <1s(用 perf-diag 长任务探针断言)。

### V5 · 门 + spec 收尾
- `e2e/bigroot-lazy.spec.js` 收全部验收 + 变异自检;合成大树生成脚本入仓
  `scripts/gen-bigroot-fixture.mjs`(诊断文档 §1 的方法,给 CI/本地压测复用)。
- 更新 `docs/features/workspace-big-roots.md`(P0a 建的占位):lazy 模式行为契约全量补齐,
  欠账清掉「P0b 未做」。
- 全量 e2e:dot 本地兜底 + rebase 后 CI 绿。PR 开出即报告,**不自合**(主 session 对抗审查)。

## 2. 完成定义

Colin 家目录场景(191 万条目)在本包后:添加 → 确认框 → lazy 模式 → 秒级可浏览、可打开文档、
可移除,全程无冻结;普通根全部既有 spec 零回归;上面每片验收绿。

## 3. 红线

- 磁盘字节/Schema/链接 href 语义一字不动。
- 全量根(预算内)的行为与性能特征不得变差——它是 99% 用户的日常路径。
- 冷启动竞态语义(restoreReady)、单实例锁、CSP——照旧红线。
- 别顺手做树的跨会话磁盘缓存(诱人但另立 feature,防 scope 爆炸)。
