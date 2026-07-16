# 大根护栏（Big-root guardrails）—— 对齐 spec

P0a 止血包（2026-07-16，Colin 拍板 P0 最高优先级）。诊断正本：
`docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md`（D1–D6 死锁链）。执行 plan：
`docs/plans/2026-07-16-001-fix-bigroot-deadlock-guardrails-plan.md`。

**这是「让 app 遇到巨型根不死锁、不冻死、永远可移除」的止血包，不是「支持流畅浏览大根」**——真正的
懒加载浏览是 P0b（另一份 plan）。本包只在真 app（`src/**`）落地，ui-demo 侧未做（见欠账）。

## 行为契约

上限的单位是**条目数（文件 + 目录），不是 GB**（诊断 §1）。300GB 的视频文件夹毫无压力，
20 万小文件的 `node_modules` 是灾难。所有护栏都以条目数为轴，**永不按字节判断/拒绝**。

- **启动不被大根门控（U1）**：冷启动恢复上次工作区时，根行（含「正在读取文件夹…」加载行）与右键
  「移除」入口**在读树完成之前就渲染出来、即刻可点**。树逐根串行到货，一根巨型不阻塞其他根、也不阻塞
  整个界面。即便某根读树极慢/失败，用户也永远能看见它、移除它。（修死锁内核 D2。）
- **条目预算 + 「过大」态（U2）**：单根读树遍历到 **150,000** 条目即停止（`WS2_TREE_BUDGET` 覆盖，
  仅测试）。超预算的根**不渲染局部树**（半棵树比没有更误导），显示一条「过大」提示行：
  「此文件夹包含超过 15 万个项目，Wordspace 暂时无法完整打开——建议移除后选择具体的工作文件夹」+
  内联「移除」按钮；根标题带「过大」标签、右键可移除。过大根对磁盘 watcher 事件 **no-op**（不重扫，
  防高 churn 大根变永动机）。恰好等于预算不算超（边界）。
- **逃生门（U3）**：菜单栏「文件 → 管理文件夹…」弹 modal，**只依赖注册表（wsGetRoots/wsRemoveRoot），
  不依赖侧栏树/根行渲染**，列出全部根 + 逐个「移除」。这是 U1 万一失效时的兜底移除路径。空态也能开。
- **病灶路径确认（U4）**：添加 `~`（家目录）、`/`（文件系统根）、`/Users`（及其直接子目录 = 各人家
  目录）、`/Volumes/<x>`（卷根）时，先弹确认框劝导选具体工作文件夹：「换一个文件夹（主按钮）/ 仍要打开」。
  取消不注册；「仍要打开」照常注册（配合预算，海量根落「过大」态）。
- **拒绝给出口（U5）**：添加子文件夹被「已经在 X 里了」拒绝时，若父根还在加载 / 过大打不开（非正常态），
  文案改为引导去「管理文件夹」移除父根后再打开子文件夹，并附动作按钮直达逃生门（原文案对正常态父根不变）。
- **持久化**：过大根照常持久化（可见 + 可移除 + 不重扫后无害，且保留用户意图）。根在读树前就持久化
  （D1）本包不根治——止血靠可见/可移除/不重扫。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 启动/串行加载/resync | （未做） | `src/renderer/sidebar.js` 启动 IIFE、`resyncRoots`、`loadRootTree` |
| 条目预算 walk | （未做） | `src/main/workspace.js` `walk`/`treeBudget`/`readTree` |
| 「过大」根渲染 | （未做） | `src/renderer/sidebar.js` `renderOversizeRoot`、`renderRootSection` |
| 逃生门 menu + modal | （未做） | `src/main/main.js`（菜单项）、`src/renderer/shell.js`（onMenu）、`src/renderer/sidebar.js` `openManageRootsModal` |
| 病灶路径判定 | （未做） | `src/lib/roots.js` `dangerRootReason`；`src/main/ipc.js` `hugeRootReason`/`resolveAdd`/`ws-add-folder(-confirm)` |
| 拒绝出口文案 | （未做） | `src/renderer/sidebar.js` `handleAddResult` 的 `child` 分支 |

## 有意分歧

- **ui-demo 侧完全未实现**：P0a 是真 app 上 Colin/Wendi 实际中招的紧急止血，先只做真 app（Colin
  2026-07-16 拍板：止血优先）。ui-demo 对齐延后到 P0b 一起做。

## 对齐锚点

- ui-demo 侧：（无——未实现）
- app 侧：commit `fix/bigroot-p0a`（2026-07-16，本 PR 合并后填 sha）

## 欠账

- **ui-demo 对齐未做**：整套护栏在 ui-demo 侧没有对应实现（上面「有意分歧」已记）。
- **P0b 懒加载浏览**：真正「打开大文件夹也能流畅浏览」靠 P0b 懒加载架构（每层展开才读那一层），
  本包只止血、不解决浏览。见 `docs/plans/2026-07-16-002-feat-lazy-tree-big-roots-plan.md`。
- **D1 复发根治**：根在读树前就持久化仍在（止血靠可见 + 可移除 + 过大不重扫，无害）；彻底不复发留给 P0b。
- **单个超大扁平目录**：`fs.readdir` 仍一次性读入整个目录的 dirent（几百万直接子项的单目录），预算只截断
  遍历总量、截不断单次 readdir 的内存峰值——留给 P0b 的流式 `opendir`。
- **listDocs / Cmd+P**：改名/移动重写扫 href（`listDocs`）与命令面板扁平化也受预算约束（过大根本就不
  渲染树、无从触发），未单独处理。
