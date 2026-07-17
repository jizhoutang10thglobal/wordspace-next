# P0 诊断：打开超大根目录卡死 + 死锁陷阱（2026-07-16）

报告人：Colin + Wendi（两人独立中招）。诊断方法：两路只读代码侦察（全链路地图 + 死锁链）+
合成树基准实测 + 外部调研。基线 = main `b6acbc7`。**本文是诊断正本**；执行见配套两份 plan：
`docs/plans/2026-07-16-001-fix-bigroot-deadlock-guardrails-plan.md`（P0a 止血包）、
`docs/plans/2026-07-16-002-feat-lazy-tree-big-roots-plan.md`（P0b 懒加载架构）。

## 0. 事故现场

- **Colin**：把用户家目录 `~` 添加为根（实测 **1,915,164 条目**，其中 `~/Library` 独占 990,885——
  它不是点开头目录，现有跳过规则拦不住）。app「分析很久」后界面停在空态；添加任何其他文件夹都被
  「已经在 xx 里了」拒绝；没有任何 UI 能移除这个看不见的根；重启复发。以为只能重装。
- **Wendi**：桌面（400-500GB）作根，此前「很卡」，近期变成「直接卡死没法用」。

## 1. 核心认知：上限的单位是「条目数」，不是 GB

readTree 全链路对条目数**严格线性**（实测，暖缓存、扁平小目录 = 最理想条件）：

| 条目数 | readTree 扫描 | IPC 载荷 |
|---|---|---|
| 2.5 万 | 1.6 s | 6.8 MB |
| 25 万 | 18.2 s | 68.4 MB |
| 推算 100 万 | ~73 s | ~270 MB |
| Colin 家目录 ~190 万 | **分钟级** | **~520 MB** |

300GB 的视频文件夹（几千个大文件）毫无压力；2GB 的 node_modules（20 万小文件）是灾难。
40GB 桌面能跑 = 条目少，不是「40GB < 某个字节上限」。**一切讨论、预算、压测都必须以条目数为轴。**

压测方法随之明确：**不需要填满磁盘**。合成树（250 目录 × 100 文件结构）25 万条目只需 35 秒生成、
250MB 磁盘——可以在任何机器上模拟「5TB 家目录」级负载。指标 = 扫描秒数 / IPC 载荷 MB /
双进程堆 / watcher 风暴 CPU。（团队旧教训「合成小树假绿」不冲突：那是「证明快」不能用小树；
这里是「量爆炸曲线」，合成树正是正确工具。）

## 2. 卡死机制（全链路，file:line 基于 b6acbc7）

添加根后的第二段全量加载，每一步都是 O(全部条目)、多处同步冻结：

1. **walk 串行递归 readdir 全树**（`src/main/workspace.js:49-73`）：无条目上限、无深度上限、
   无超时、无取消。跳过规则只有点开头/`.ws2tmp`/IGNORE 集（node_modules/.git 等 7 个）/JUNK/
   bundle（.app 等，显示节点但不进入）——**`~/Library` 全量硬走**。
2. **fillInos 对每个文件 stat**（`workspace.js:79-92`，批 64）：190 万次 stat 打满 libuv 4 线程池，
   开/存文档全排队。
3. **buildFileTree + 中文 localeCompare 全排序 + addAbs 三步全同步**（`workspace.js:120`）：
   一口气冻结主进程事件循环数十秒；`ensureDir` 用 `children.find` 线性扫（`src/lib/file-tree.js:58`），
   超大扁平目录退化 **O(M²)**。
4. **整棵树一个 JSON 过 IPC**（`ipc.js:730`）：几百 MB structured-clone，序列化/反序列化两端各同步冻结。
5. **renderer 再两次全树同步遍历**（annotateTree + collectDirRels，`sidebar.js:225-226`）并在自己
   堆里再存一份 → 主 + renderer 共 ~2GB 堆 → **V8 old-space 上限 → renderer OOM/冻死 =「卡死」的真身**。
6. **每次启动全部重来**：树零缓存，启动对每个根**并行**全量重扫（`sidebar.js:2839` Promise.all）。
7. **watcher 永动机**：高 churn 根（家目录/桌面）一个去抖窗口 >128 事件 = overflow → null →
   **全量重扫**（`workspace-watcher.js:21,51`；`file-tree.js:176,184` 根层变化/受影响目录>8 同样退化）；
   去抖上限 3s（`perf-diag.js:54`）vs 扫描分钟级 → 扫完即再扫。
8. Cmd+P 命令面板把所有根的树扁平成全文件数组（`sidebar.js:2261-2264`）——巨根下又一次全树冻结。

**「为什么修了三轮反而更糟」**：#162（bundle 跳过）/#183（事件按子树）/#189（两段式首帧）各修了
真实的一段，但核心的 O(N) 全量扫 + 巨型载荷 + 启动死门从未动过。线性系统里数据量长 30% 就能跨过
renderer 堆悬崖，从「卡但能忍」变「彻底冻死」——是阈值穿越，不是回归。（要在 Wendi 机器上确证：
Cmd+Shift+D 性能诊断面板看每根文件数/readTree 耗时，可录 CPU profile。）

## 3. 死锁链 D1–D6（「看不见 + 移不掉 + 重装无效」的完整机制）

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| **D1** | 根在读树之前就持久化 | `ipc.js:601-608`（:602 persistRoots 先于一切扫描） | 坏根跨重启永生，每次启动复发 |
| **D2** | 启动 UI 门控在全量读树上 | `sidebar.js:2839-2840`（`await Promise.all(wsReadTree)` 先于 rootsState 赋值）+ `:439-443`（rootsState 空 → render 早返回） | 读不完的根 → **空态永驻、根行永不渲染**。添加路径没这 bug（先 adoptRoot 带 loading 再读树,`:208-213`）——Colin 撞的是重启路径 |
| **D3** | readTree 无任何护栏 | `workspace.js:49-92`；`ipc.js:720` 无 timeout/abort/上限 | 读树真的永不完成，D2 的门永不释放 |
| **D4** | 唯一移除入口与根行渲染强耦合 | 根行右键 `sidebar.js:563-569`；菜单栏无移除/重置（`main.js:130-181`）；`workspaceStore.clear()` 是死代码 | 根行不渲染 = 无任何移除路径 |
| **D5** | 「已包含」拒绝判注册表 | `roots.js:41`、`ipc.js:586-589`、文案 `sidebar.js:195-196` | `~` 一注册，所有子文件夹全被拒；「去那个文件夹里展开」是空头支票 |
| **D6** | 无自救 | 重装不清 userData；无 in-app 重置 | 用户以为要重装，且**重装其实无效** |

死锁内核 = D2+D3+D4（看不见+读不完+移除依赖可见），D1 使其复发，D5 封死绕行。
**单点最高杠杆 = 修 D2**（启动照抄添加路径的形状）。

## 4. 用户级救援（立即可用，已广播 team-memory）

⌘Q 完全退出 → 删 `~/Library/Application Support/Wordspace Next/workspace.json`
（或编辑其 `roots` 数组删掉大根条目）→ 重启。**不要重装——重装不清这个文件，白装。**

## 5. 外部调研：天花板高的产品全走懒加载

- **VS Code**：文件树每层展开才读那一层，从不全量扫描；递归 watch 配 `files.watcherExclude`
  排除病灶目录；搜索用 ripgrep 按需跑。即便如此，单目录几百万直接子项也会卡死
  （issue #281507），社区在要求展开保护（#237394）。
- **Obsidian**：启动全量扫 + 全量索引（与我们同架构）= 前车之鉴：5 万笔记加载 3 分钟、
  重索引 27 分钟；百万笔记被社区判「不现实」。
- 结论：全量扫描架构的天花板就是 Obsidian 的惨状；要支撑「打开你的文件夹」这个产品承诺
  （用户必然会指向 ~ 和桌面），浏览层必须懒。

## 6. 已拍板（Colin 2026-07-16）

1. **分层执行：P0a 止血包先行，P0b 懒加载架构紧随其后**（不排期，P0a 合并即启动 P0b）。
2. 全量/懒模式切换预算：**150,000 条目**（实测 10 万条 ≈7s/27MB 为可忍上缘，取 15 万留余量；
   e2e 用环境变量覆盖）。永不按 GB 判断/拒绝。
3. 添加 `~`、`/`、`/Users`、磁盘卷根时弹确认框，劝导选择具体工作文件夹。
4. 执行编排：Opus 子代理实现（独立 worktree），主 session 对抗审查后合并。

## 7. 意外发现（顺手记账）

- link-index 是懒建的（`linkBuilt` 守卫 `ipc.js:181`），没用过 @ 菜单/反链不会触发——排除了
  一个「越修越糟」嫌疑；但它的 `listFilesMatching` 只跳 dotfile、不复用 isSkippedName/isBundleName
  （`link-index.js:121`），会递归进 node_modules/.app 内部——隐雷，P0b 顺手修。
- 诊断面板盲区：只量 renderer 内存、量不到主进程堆；无 IPC payload 体积指标；fileCount 不含目录。
