---
title: 跨根互链——链接跨越「文件夹空间」这道墙（A 消费 / B 创建 / C 维护 + 先行移动守卫）
status: active
date: 2026-07-14
origin:
  - 互链 v1（同根全套，已随 v0.8.3 发版）：docs/plans/2026-07-08-001-feat-doc-linking-app-plan.md
  - 现状勘察：2026-07-14 对 main（b19e382）的全量代码调查（本文 §2 全部 file:line 据此）
  - 需求出处：Notion 卡「文件内联 Phase 2」+ 2026-07-09 Colin×Wendi 1:1（改名/移动引用不失效）
---

# 跨根互链（A 消费面 / B 创建面 / C 维护面）

## 0. 一句话与铁律

让文档链接能跨越「文件夹空间」（侧栏并列打开的多个根）：A 让已存在的跨根链接**点得开、看得见**（反链/修复也认它），B 让用户**造得出**跨根链接（@菜单/拖拽），C 让跨根链接**不会烂**（改名/移动/删除的维护网罩到所有根）。执行顺序 A→B→C，各自独立 PR；另有一个独立先行小单元 U-CR0（跨根移动守卫）今天就该修。

铁律（全部继承互链 v1，违反 = 返工）：

1. **磁盘字节 = 纯净相对路径 `<a href>`，零自定义属性**。跨根链接照样是相对路径（两个绝对路径之间总能算出相对路径，浏览器裸开 file:// 照样可跳、md 保持 `[text](path)` 原生）。绝对路径 / `file:` / UNC 仍被 `classifyScheme` 与 `resolveDocLink` 双闸封死（`src/lib/links.js:108-116`、`src/main/ipc.js:283-291`）——**这条安全闸一个字不许动**。
2. **索引 = 可丢弃缓存**，文件永远是唯一真相；本 feature 会 bump 索引 version 1→2，迁移 = 丢弃重建（不写迁移代码）。
3. **改名/移动自动重写默认开、撤销 = 反向重写**（v1 L4）；跨根维护是同一套机器的作用域扩大，不是新机器。
4. **只支持同一磁盘卷**（`stat().dev` 相同）。跨卷（外接盘、Windows 跨盘符）不给创建——Windows 跨盘符根本不存在相对路径，这是格式层面的硬边界，不是实现偷懒。
5. 测试纪律照 CLAUDE.md：开发只跑受影响 spec；变异自检**先 commit 再变异**；fixture 字符串长度是测试变量。

## 1. Use case（写给执行者：用户视角的验收心智）

用户开着两个空间：「工作笔记」和「项目资料」。在工作笔记的《周报.html》里引用项目资料的《报价单.html》。

- **A**：这个链接（不管怎么来的）像正常链接——点开、悬停预览卡、《报价单》标题下「N 篇文档链接到这里」里能看到周报（标注它来自哪个空间）、断了有红虚线和修复卡。
- **B**：打 `@报价` 能在菜单里搜到另一个空间的《报价单》（按空间分组）；把它从侧栏拖进正文不再被拒绝。
- **C**：别人把《报价单》改名/移动（含跨空间移动、Finder 里改名），周报里的链接自动跟；删它之前守卫警告列出周报。

三层是一个功能的三段，终态必须全做：只有 A+B 没有 C 的话，同一个功能「同空间改名自动跟、跨空间悄悄断」，用户不会理解这条技术边界，只会觉得不可靠。

## 2. 现状勘察（实证，行号按 main b19e382；实现时以现场为准）

**已经通的（别重做，写 e2e 钉死即可）**：

- `ws-resolve-doc-link`（`src/main/ipc.js:280-308`）按真实文件系统解析 href、realpath 归一后交 `rootsLib.ownerOf` 比对**所有 live 根**——跨根目标返回 `{insideRoot:true, rootId:B, rel, abs, exists}`。因此**点击打开（`shell.js` onDocLinkClick）、悬停预览卡、断链红虚线、断链修复卡的弹出**（`src/editor/linkview.js:112` 谓词、`:186` hover）对「落在另一个已打开根内」的手写链接**今天已经工作**。
- 目标在根外（未打开的空间/任意磁盘位置）：`insideRoot:false` → 不装饰、不弹卡、点击 toast「链接指向工作区外，未打开」；且**不 stat 越界路径**（防用文档字节嗅探磁盘，`ipc.js:305-307`）——这个行为保持不变。
- 跨设备移动已有 EXDEV 处理路径（`ipc.js:687,697`）——卷边界概念在代码里已存在。

**不通的（= 本 plan 的活）**：

- 索引按根隔离：`Map<rootId,{path,docs}>`，出链只收 `resolveHref` 同根解析成功的 rel（`src/main/link-index.js:94,128-136`）；`resolveHref`/`normalizePath` 越根顶返回 null（`src/lib/links.js:26-38,60-68`）→ 跨根链接**不入索引**。
- 反链/夹外反链/doc-id 反查全部单根内算（`link-index.js:192-245`）→ 跨根来源看不见、修复候选查不到。
- @菜单候选只列源文档所在根（`src/editor/mention.js:99-101`）；插入用同根 `relHref`（`mention.js:220,227`）。
- 拖拽建链跨根直接 toast 拒绝（`src/editor/blockedit.js:1357`「跨文件夹的链接暂不支持」）。
- **`ws-move-across` 零重写**（`ipc.js:684-699` 只调 `workspace.movePathAcross`；`sidebar.js` doMoveAcross 也不调 `notifyRefsRewritten`）→ 跨根移动后：源根指向它的引用悬空 + 它自己内部指向原根兄弟的相对链接全部悬空，**无任何提示**。这是现存数据损坏级缺口。
- 改名/移动重写只扫本根（`ipc.js:155-198` computeMoves/rewriteRefsForMoves）；删除守卫/外部改名「一键更新」只查本根反链（`sidebar.js:786-815,928-956`）。

## 3. 核心设计（已定，执行者不重开）

**路径代数（`src/lib/links.js` 新增，绝不改动现有同根函数的语义——它们有 50 断言 property 门）**：

- `relHrefAbs(fromAbs, toAbs)`：两个绝对路径 → 相对 href。逐段 `escSeg` 转义（与现有写端同规则：`% # ?`、首段含 `:` 前缀 `./`——跨根 href 首段总是 `..` 所以冒号情形只在理论上，仍要过 property 门）。**不同卷返回 null**（卷判定不在纯逻辑层做，见下）。
- `resolveHrefAbs(fromAbs, href)`：绝对路径域解析 → 归一化绝对路径或 null。scheme/绝对/UNC 拒绝规则与 `classifyScheme` 完全一致。
- property 门扩展：`resolveHrefAbs(fromAbs, relHrefAbs(fromAbs,toAbs)) === toAbs`，复用 v1 的刁钻文件名全组合（`draft:v2.html`、`涨幅100%.html`、`C# 笔记.html`、`去哪?.html`）+ 跨根深浅层全组合。
- **realpath 域一致性（新硬教训 N1）**：`ownerOf`/`resolveDocLink` 在 realpath 归一域比对；`relHrefAbs` 的输入必须也是同域（根用 `real || path`，文档 abs 从根 abs 拼出），否则软链场景 roundtrip 破。索引、重写、创建三处的 abs 全部统一走这一个域。

**卷判定**：主进程对每个根缓存 `stat(root.path).dev`（根注册/relocate 时取）；两根 dev 不同 = 跨卷。**别用路径前缀猜**（`/Volumes` 启发式会误判，N2）。

**索引模型（`src/main/link-index.js`，version 1→2）**：outLink 条目在 `resolveHref` 同根解析失败时，改试 `resolveHrefAbs(ownAbs, href)`，成功则存 `targetAbs`（realpath 域）。反链查询升级为两相匹配：同根 rel 匹配（现状不动）+ 跨根 abs 匹配（`join(root.real||path, rel)` 与各根索引里的 `targetAbs` 比）。`linksBacklinks`/`linksDirBacklinks`/`linksMovedTarget` 内部 fan-out 所有 live 根（查询前 `ensureLinkIndex` 逐根懒建——首查可能重，沿用现有懒建+事件刷新模式，别在 UI 阻塞等全量，N4）。返回条目带 `rootId`（来源根），renderer 好标注。

**重写域选择（关键，N5）**：重写一个 href 时——目标与本文件同根 → **必须写根内相对短形式**（现有 `relHref`）；跨根 → `relHrefAbs`。绝不许把同根链接写成绕出根顶的长形式：`resolveHref` 会把越根路径判 null，等价但立刻变「断链」。同根短形式优先是不变式，进单测。

**根生命周期语义（已拍）**：目标所在的空间被移除/失联 → 跨根链接退化为「工作区外」现状行为（不红线、点击 toast）；重新打开那个空间 → 自动恢复正常。不做「去打开那个空间」的引导（v2 候选）。创建跨根链接时**不弹脆弱性警告**（别打扰用户）。

## 4. Implementation Units（顺序执行；U-CR0 独立先行）

### U-CR0 · 跨根移动守卫（S；独立 PR，今天就该出——它保护的是现有单根用户）
- **Goal**：堵 §2 的数据损坏缺口。在 C2 真重写落地前，`doMoveAcross` 执行**前**查两件事：①源根内有多少文档链接到被移条目（文件用 `linksBacklinks`，文件夹用 `linksDirBacklinks`）；②被移文档自身有多少条根内出链（查索引该条目的 outLinks，目录则汇总子树）。任一 >0 → 弹守卫确认（复用删除守卫的弹窗形制与文案骨架，`sidebar.js:928-956`）：「移动到其他文件夹空间后，N 篇文档里指向它的链接将失效 / 它内部的 M 条链接将失效」，确认才移。0 引用 → 无感直移。
- **Files**：`src/renderer/sidebar.js`（doMoveAcross 前置守卫）；可能补一个「条目自身出链计数」的小 IPC（`ipc.js`+preload+`link-index.js`）。
- **Tests**：e2e——有引用时弹窗内容正确/取消不移/确认真移且旧引用变红虚线；无引用不弹。**C2 落地时本守卫改造成「自动重写+撤销 toast」，守卫文案退役**——C2 的 PR 必须处理这一点，别留两套。

### A1 · 索引跨根边 + 反链/修复候选全库化（M 的主体）
- **Goal**：跨根链接进索引（`targetAbs`）；`linksBacklinks`/`linksDirBacklinks`/`linksMovedTarget` fan-out 所有根并带 `rootId` 返回；反链面板来源行标注空间名（灰字前缀，视觉细节以 Wendi 验收为准）、点击跳转用来源自己的 `(rootId, rel)`（`wsAbs` 已有）；修复卡候选升级——doc-id 反查跨全库置顶、同名候选跨根（标空间名）、「浏览…」手选放开到任何已打开根（现状同根限制 `linkview.js:315-328`）。
- **Files**：`src/main/link-index.js`（模型+查询）、`src/lib/links.js`（`resolveHrefAbs`，索引端要用）、`src/main/ipc.js`、`src/renderer/preload.js`、`src/renderer/shell.js`（反链面板）、`src/editor/linkview.js`（修复卡）。
- **Tests**：`test/link-index.test.js` 扩——跨根出链入索引、两相反链、docId 全库反查、version bump 丢弃重建、根移除后 fan-out 不含它；`test/links.test.js` property 扩（§3）；e2e——双根 fixture（复用多根 e2e 的 fixture helper，grep `e2e/` 里 multiroot/roots 用例），断言反链面板跨根来源可见可跳。
- **Execution note**：索引损坏/旧版本 → 丢弃重建的既有路径（`link-index.js:247-263`）要覆盖 version 2。

### A2 · 消费面现状钉死（A1 同 PR 或紧随；主要是测试）
- **Goal**：给「已经通的」上保险——e2e 钉死：跨根链接点击真打开（docPath 切到根 B 文档）、悬停卡出、目标删除后红虚线出+修复卡出；目标在未打开空间 → 不装饰+点击 toast（现状行为回归门）。断链装饰谓词、hover 谓词**不改**（`insideRoot===true && exists===false` 语义天然覆盖跨根）。
- **Tests**：全进 `e2e/doc-links.spec.js` 或新 `e2e/cross-root-links.spec.js`；装饰类断言沿用 v1 的像素级变异探针模式。

### B1 · @菜单跨根候选（M 的主体）
- **Goal**：新 IPC `ws-links-candidates-all` → `[{rootId, rootName, dev同卷标记, docs[], others[]}]`（每根内部排序同现状：文档前、其它后）。菜单分组：**当前根组在最前**（无组头、行为与现状完全一致——单根用户零感知变化），其余根按侧栏顺序排在后面、各带空间名小节头；条目第二行路径带空间名前缀消歧。**跨卷的根整组不列候选**，组头灰字注明「（在另一磁盘卷，暂不支持链接）」——拒绝路径必须可见（v1 L8：哑失败=用户眼里没做）。选中跨根条目 → `relHrefAbs(fromAbs, targetAbs)` 插入（fromAbs 从 docCtx/`__wsDocPath` 取，mention ctx 现有 `fromRel+rootId` 要补 abs）。「@新建」语义不变（建在当前文档同目录，无跨根形态）。
- **Files**：`src/main/ipc.js`+`link-index.js`（candidates-all）、`preload.js`、`src/editor/mention.js`（分组渲染+插入分流）、`src/renderer/shell.css`（组头样式）。
- **Tests**：e2e——双根下 @ 搜到另一空间文档、Enter 插入后**磁盘字节断言**（`../` 开头的纯净相对路径、零属性）、保存后浏览器语义可解析（resolveDocLink 往返）；单根用户菜单外观与 v1 完全一致的回归门；筛选缓存竞态守卫沿用（`mention.js:96` 的同步筛模式，candidates-all 一次拉全量）。
- **Execution note**：候选缓存量变大（多根求和），维持「打开菜单拉一次、打字同步筛」的现有模式即可，别引入每键 IPC。

### B2 · 拖拽跨根放开（B1 同 PR 可并）
- **Goal**：`dropFileLink` 的跨根分支（`blockedit.js:1357`）改为：同卷 → 正常插入（href 分流同 B1）；跨卷 → toast「不同磁盘卷之间暂不支持链接」。保持拒绝：临时/工作区外文档（`ctx.rootId==null`）、自链。sidebar dragstart payload 已带 `rootId`（无需改）。
- **Tests**：e2e 拖拽走**真实输入管线**（v1 L10：合成 DragEvent=假绿门，抄 v1 的拖拽用例驱动方式）；跨卷拒绝的守卫逻辑抽纯函数进单测（e2e 不造双卷环境）。

### C1 · 重写机器作用域扩大（L 的主体）
- **Goal**：`computeMoves`/`rewriteRefsForMoves`（`ipc.js:155-198`）升级到 abs 域：moves = `{fromAbs, toAbs}`（同根操作由 rel 拼 abs）；受影响文件扫描 fan-out 所有 live 根；`link-rewrite.js` 的匹配基准从「本文件 rel」升级为「本文件 abs」，每个 href 先按现状 rel 域匹配（同根，字节行为不变），再按 abs 域匹配（跨根）；重写输出按 §3 域选择规则（同根短形式优先）。字节保真 splice 机制（`link-rewrite.js:49-119`）一字不动。
- **Files**：`src/main/link-rewrite.js`、`src/main/ipc.js`、`src/lib/links.js`（如需 abs 域 moved 映射帮手函数）。
- **Tests**：`test/link-rewrite.test.js` 扩——根 A 文档链根 B 文件、B 内改名 → A 的 href 重写且其余字节逐字节相同；同根链接绝不被写成越根长形式（N5 不变式门）；`#锚`/`?查询` 尾缀保留照旧。
- **Execution note**：改的是共享核心（ipc.js/重写管线）——推 PR 前本地 `npm run test:e2e:dot` 全量兜底（CLAUDE.md 例外条款）。

### C2 · 跨根移动真重写（接 C1）
- **Goal**：`ws-move-across` 移动完成后走 C1 机器：入向引用（所有根内指向被移条目的 href）+ 被移文档**自身出链重算**（自身 abs 变了；原同根目标变跨根、原跨根目标可能变同根——abs 域算法天然覆盖，输出域选择自动分流）→ toast「已更新 N 篇 · 撤销」，撤销 = 反向 moveAcross + 反向重写（前提校验，不满足明说放弃，v1 L4）。**拆掉 U-CR0 的守卫文案**（无引用直移、有引用自动重写，不再吓唬用户）；EXDEV 跨卷移动 → 不重写跨根形式、入向引用按断链守卫提示（跨卷本来不给建链，这里只有存量手写链接受影响）。
- **Tests**：e2e——跨根移动后源根引用文档磁盘字节已重写为跨根相对路径且其余字节不动；被移文档内链自愈;撤销往返；打开中脏文档跳过+toast 注明（沿用 v1 决策）。
- **Execution note**：`movePathAcross` 与源根 watcher 有既有竞态防护（crossMoveGuard、`WS2_SLOW_MOVE_MS` seam，`ipc.js:690-693`）——重写写盘必须走 `noteSelfWrite` 防误重载（v1 既有惯例），且注意别和 watcher 的外部改名探测互相触发（app 内操作 3 秒抑制窗口 `sidebar.js:789` 要罩住重写写盘）。

### C3 · 守卫与外部探测跨根化（C1/C2 同 PR 可并）
- **Goal**：删除守卫的反链查询天然升级（A1 的 fan-out 就是它的数据源——确认 `sidebar.js` 调用点拿到跨根来源后弹窗列表带空间名）；文件夹删除的「夹外引用」语义 = 夹外含其他根；外部改名探测（inode reconcile，本根机制不变）的「一键更新」判定改用全库反链（旧路径在**任何根**有反链才弹、重写 fan-out）。
- **Tests**：e2e——删根 B 被根 A 引用的文件 → 守卫列出根 A 来源；Finder 改名根 B 文件 → 询问 toast → 确认后根 A 引用字节已重写。

### C4 · 变异自检 + 收口（贯穿，最后）
- **Goal**：至少两处变异自检——跨根重写字节保真（故意整文件重序列化必翻红）、反链 fan-out（故意只查单根必翻红：根 B 引用不见 = 门哑）。宿主全量 e2e + CI 双绿；`docs/doc-linking-feature-spec.md` 正本补跨根章节、`docs/features/doc-linking.md` 更新文件映射/欠账/对齐锚点（**铁律：改真 app 交互的 PR 同 PR 更新 feature spec**；ui-demo 不移植跨根——单工作区 mock 无根概念，记入有意分歧表）。

## 5. 已拍板决策（执行者不重开；出处 = 2026-07-14 Colin 会话）

| 决策 | 结论 |
|---|---|
| 磁盘格式 | 跨根 href = 纯相对路径（realpath 域计算），零新属性；绝对/`file:`/UNC 封锁不动 |
| 卷边界 | 只支持同卷（`stat().dev`）；跨卷不给创建（B 层可见拒绝），存量跨卷消费按「工作区外」现状 |
| 根未打开/移除 | 跨根链接退化为「工作区外」现状行为；不做打开引导（v2 候选） |
| 脆弱性 | 接受「根搬家全断」，靠 doc-id 修复卡兜；创建时不警告 |
| 索引 | version 1→2，迁移=丢弃重建 |
| 交付切分 | U-CR0 独立先行；A（A1+A2）/ B（B1+B2）/ C（C1-C4）三个独立 PR 顺序交付，各自可发布 |
| @新建 | 语义不变（当前文档同目录），无跨根形态 |
| ui-demo | 不移植（mock 无多根概念），记有意分歧表，不算漂移 |

## 6. 明确不做（别顺手加）

链接工作区外文件（未打开空间/裸磁盘路径——消费面维持 toast 现状）；跨卷创建；「去打开那个空间」引导；transclusion/嵌入；unlinked mentions；链接到标题锚点的创建 UX；图谱视图；大小写/NFD 归一化（v1 已知限制照旧）。

## 7. 硬教训（v1 的 L1-L13 全部继承——见 docs/plans/2026-07-08-001 §7，实现前通读；本 feature 新增：）

- **N1 realpath 域一致性**：创建/索引/重写三处的 abs 必须与 `ownerOf`/`resolveDocLink` 同一 realpath 归一域（根用 `real || path`），否则软链场景 roundtrip 破、链接建出来就是断的。
- **N2 卷判定用 `stat().dev`**：路径前缀启发式（`/Volumes`）会误判网络挂载/家目录挂载。
- **N3 双根 e2e fixture**：两个真实临时目录注册成两根（复用多根 e2e 的既有 helper）；fixture 文件名别同长度（CLAUDE.md 变异铁律②）。
- **N4 fan-out 懒建成本**：跨根查询前逐根 `ensureLinkIndex`，首查可能重——沿用懒建+事件刷新，别阻塞 UI 等全量，也别为省事改成启动全量扫描。
- **N5 重写域选择不变式**：同根链接必须写根内短形式——写成越根长形式会被 `resolveHref` 判 null、等价路径立刻显示为断链。单测钉死。
- **N6 别动安全闸**：`classifyScheme` 的绝对路径/UNC/scheme 拒绝、`resolveDocLink` 的「不 stat 越界路径」防嗅探——跨根实现全部走「相对路径 + ownerOf 归属」通道，任何「放开一点绝对路径」的捷径都是安全回退。

## 8. 交付与工程约定

- 新 worktree + 分支（`feat/cross-root-links-a` 等），别占主目录；每单元绿了就 commit。
- 每个 PR：CI（`test`+`e2e` required）绿 + 受影响 spec 定向本地跑；动 ipc.js/重写管线的 C 阶段推前本地 `test:e2e:dot` 全量。
- 每个 PR 同步更新 `docs/doc-linking-feature-spec.md` + `docs/features/doc-linking.md`（铁律）；C4 收口时更新对齐锚点。
- 给 Colin 的验收脚本：照 §1 三段 use case 双空间真机各走一遍 + U-CR0 的移动守卫 +「同空间行为与 v0.8.3 完全一致」的回归确认。
- 完成后：progress/memory 按仓惯例；本计划 status 翻 completed；Notion「文件内联 Phase 2」卡链接本文。
