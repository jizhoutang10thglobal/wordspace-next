# Team Memory — 跨 session 公告板

> **这是什么**：并行 worktree/session 之间唯一的全局知识 channel。Claude Code 的
> auto-memory 按文件夹路径隔离、跨不了 worktree；这份文件走 git，人人可达。
>
> **读**：任何 session 里调 `/sync-main`（冷启动、长 session 隔段时间、动新改动前都值得跑）。
> **写**：调 `/remember-global`——它把条目经「短命分支 + PR + auto-merge」落到 main（发完即走，
> required checks 绿后约 7 分钟自动合上）。不直推——branch protection 对所有人所有文件生效，
> 曾经的直推特权已废除（Colin 拍板 2026-07-11，见下方同日公告）。
>
> **写什么**：会影响其他 session 的东西——全局教训、规则/门变更、拍板决策、流程变化。
> 只对单个 feature 有效的知识别写这。条目要写「是什么 + 怎么 apply + 来源」，别只写「改了 X」。
> **沉淀**：时效已过的条目可清理；升格为硬规则的移进 `CLAUDE.md`。

<!-- 新条目插在这行下面（倒序，最新在最上） -->

## 2026-07-24 — 编辑器全局契约：精确选区/删除/合并（Colin 两轮拍板，动编辑器必读）

**是什么**：Colin 拍死跨块选区的三条全局规则（PR #356 落地，`docs/features/toggle.md` 有完整版）：
①**选区所见即所得**——只有内容完全被罩住的行单位（顶层块/summary 行/toggle 体内块）才整行标蓝（data-ws2-rangesel）；端点块部分选中保持原生文字高亮，**不补全、不上卷**（唯一例外：端点在 table 内→table 整行蓝，预示只能整删）。②**精确删除**——起块裁尾、末块裁头、全罩单位整删；toggle 的 summary 整行被罩=**解散**（壳删、幸存体内块原样提升）；summary 裁一半=存活+跨壁不并。③**合并以上块为准**——断口两端同层可并→下块剩余并入上块继承其样式（上块是列表→并进最后一项），光标落接缝。历史包袱已清：「跨界空操作+flashNope」（a254cb6）和「端点上卷整块删」（#353 过渡版）都废了。
**怎么 apply**：动 blockedit.js 的选区/删除/高亮任何逻辑，先读 toggle.md 的契约节 + `e2e/block-range-select.spec.js` P1-P4；新块类型要接入删除管线时按此契约，别复活「上卷补全」。技术坑一枚：判「块是否被选区全罩」**别用 compareBoundaryPoints**——(p.firstChild,0) 会被判在 (p,0) 之后，「文字头选到文字尾」的整块选中会误判未全罩；用溢出内容法（块内容在选区外的部分 toString+原子元素查询判空），见 refreshRangeSel 的 covered()。
**来源**：Wendi「toggle 删不掉」→ Colin 二轮拍板（2026-07-24）；PR #353→#356。

## 2026-07-23 — docs/* 分支的代码文件冻在切分支那刻，别在这种工作目录里改代码+测

**是什么**：`docs/xxx` 这类长期挂着的分支只往上加 docs commit，**src/ 代码文件停在当初从 main 切出去那一刻**、比 main 落后一大截（实测 `docs/doc-linking-app-plan` 的 blockedit.js 缺 i18n / image-ingest 等一批 main 早有的东西）。在这种分支的工作目录里改代码、跑 e2e 测绿，全是拿旧代码测的**假绿**；直接搬 main 会对不上（函数结构/依赖都变了，比如删了个在旧版没人用、在 main 还被别处调的函数就崩）。
**怎么 apply**：动代码前先 `git branch --show-current` 看是不是 docs/* 之类；是的话**别在这个目录改代码**——开 origin/main 的临时 worktree（`git worktree add <dir> origin/main -b <br>`）在真 main 代码上重做+测+推 PR。`format.js` 这种被 git 当二进制的文件，`grep`/`git show|grep` 要加 `-a`，否则静默返空、会误判「我的代码没进去」。
**来源**：修 Wendi「列表项没法改颜色」时踩的（PR #335）；呼应「本地绿≠CI 绿，先 rebase / 对 main」。

## 2026-07-23 — 列表/待办项键盘选行改颜色·高亮·行内代码失灵：Shift+End 幽灵块边界被跨块守卫误伤

**是什么**：在 `<li>` 里键盘选行（Home→Shift+End / 三击 / Shift+↓），浏览器把选区**尾端落到下一个 `<li>` 的 offset 0**（`selection.toString()` 尾巴那个 `\n` 就是块边界）→ 起块=li[0]、尾块=li[1]。`wrapInlineStyle`（文字色）/ `wrapMark`（高亮）/ `wrapCode`（行内代码）的跨块守卫 `startBlock!==endBlock` 判跨块 → 静默 return 不上色。加粗/斜体走 `execCommand`、自己处理块边界所以没事——现象是「粗细能改、颜色改不了」。
**怎么 apply**：这类「选区尾端溢到相邻块幽灵边界」的误伤，用 format.js 新增的 `fmt.clampRangeToBlock(doc, range, body)`：溢出段零可见文字/媒体时把尾端夹回起块末尾再操作，真选进别块内容才拒绝。以后加任何「选区内行内操作 + 跨块守卫」都走它，别再裸判 `startBlock!==endBlock`。判「溢出段是否空」别用 `cloneContents().querySelector('*')`——它会撞上跨兄弟边界时被克隆成空壳的 li/ul，只认 `img/hr/video` 等真媒体。
**来源**：PR #335（含 e2e 门 `e2e/blockedit-list-color.spec.js` + 变异自检）。

## 2026-07-22 — v0.11.0 已发布，发版基线挪到此

**是什么**：v0.11.0 已签名公证发布（tag 打在 `7225cc2` = #309 合并点，Release 页 + mac arm64/x64 + win x64 产物 + 自动更新清单齐全）。这版给用户的三大新功能：**折叠块**（编辑器新增 Notion 式可折叠块 #299）、**浏览器下载** #278、**沉浸窗框融合** #303/#307/#276；外加一批改进修复（含 Wendi 报的右键菜单被窗口底边裁 #304、大根「Simplified」徽标撤路径 #309、基础编辑器删除块改走原生选中+Delete #305）。CHANGELOG.md / CHANGELOG.en.md 双语正本已随 #310 合进 main。

**怎么 apply**：① **v0.11.0 之后合进 main 的改动都算下一版的未发版内容**——问「main 上没发版的改动」或写下一版 changelog 时，从 tag `v0.11.0` 往后数（`git log v0.11.0..origin/main`），别再从 v0.10.6 数。② 发版方式没变（tag `vX.Y.Z` 触发 Release workflow，本仓既有模式=tag 打在功能提交上、changelog 可独立随后合，见 docs/releasing.md）。③ **changelog 双语同写是硬门**：每版必须同步更新 CHANGELOG.md + CHANGELOG.en.md，官网构建校验两份「最新版本号一致」，漏英文构建直接挂（`website/app/lib/changelog.ts` loadChangelogEn）。版本标题格式严格 `## vX.Y.Z — YYYY-MM-DD`、分组 `### 新增/改进/修复` ⟷ `### Added/Improved/Fixed`，写完最好用该正则实跑校验一遍再合。

**来源**：tag `v0.11.0` / 发版 Release workflow / changelog PR #310 / docs/releasing.md

## 2026-07-21 — CI e2e 门改了：required check 现在是 `{test, e2e-all}` 不是 `e2e`，且分片并行

**是什么**：e2e 策略优化（#284 合）动了 CI 和 branch protection 两处，影响所有 session 的 PR 合并：
① e2e 从单 job 切成 **4 片 matrix 并行**（CI 里显示 `e2e (1)`..`e2e (4)`）+ 一个 `e2e-all` 聚合门（fail-closed：分片有红 / 掉测 / docs-app 判定异常都会红）。
② **branch protection 的 required status check 从 `e2e` 迁成 `{test, e2e-all}`**，strict=true（要求 PR 与 main 同步），enforce_admins=true（管理员也受门约束）。
③ 掉测地板：全量 spec < 400 条 → `e2e-all` 红（现 420，余量 20；将来删测超 20 要在同 PR 显式下调地板）。

**怎么 apply**：① 你的 PR 现在等的绿灯名字是 `e2e-all`（聚合），不是旧的 `e2e`——脚本 / 文档里 hardcode `e2e` 作 required check 的地方要改。② **strict=true 的副作用**：main 一动，你在飞的 PR 就 BEHIND、auto-merge 会卡住不自动合，要 `gh pr update-branch <PR>` 手动追一次（多 PR 排队时一个一个来，别同时 update 互相挤 stale）。③ 本机开发别再「动共享核心=全量重跑 420 条」——CLAUDE.md #283 已改成「跑受影响 spec + 5-spec 冒烟子集，全量交 CI」。④ **教训**：`waitForTimeout→expect.poll` 主要是消 flake **不是提速**（硬睡多卡在 autosave 1.2s / Electron 重启）；想真提速只能合并 beforeAll 单启动，风险大要 shuffle 证明——**别天真地删测 / 删睡提速**（负向断言更是绝不能折进 poll，会假绿）。

**来源**：plan #281 / CI+分支保护 #284 / U1 CLAUDE.md #283 / U3 审计 docs/e2e-audit-2026-07-20.md #294。

## 2026-07-21 — Feature Board 有卡片规范了，往 board 加卡照它来（含去重铁律）

**是什么**：整理了 Notion Feature Board（60→52 张：全部 F 编号化、去重、归对模块、退休卡进归档页），并立了一页《卡片规范》。六条：R1 卡=一个用户叫得出名字的能力（不是 dev 增量、不是整个模块）；R2 必填五样=编号 F## ＋功能＋一句话简介（为什么）＋工作量 S/M/L ＋模块；R3 目标 M，XL 不许当一张卡（要拆或提升为模块）；R4 命名用产品口吻名词短语，去掉 `feat:` / `phase N` / 实现术语 / 标题里的字面换行，Wordspace 统一大写；R5 拆合判据（太大→拆；按实现阶段拆的→合成一张、阶段进 spec 不上板；备忘卡→并进真卡；两代重复→留 F 编号那张、退休另一张；小开关如深色/i18n→留成 S 卡别过度合并）；R6 板子只有两层：模块=史诗 → 卡=feature，dev 增量（phase 1/2/3）活在 spec/PR 不上板。
**怎么 apply**：往 Feature Board 加卡前——①先搜有没有重复的现有卡（这次清掉的一大批就是「施工代无编号糙卡 vs 规划代 F 卡」两代重复，别再造）；②照规范写五样必填、产品口吻命名；③编号续排 F##（**当前最大 F60，下一张从 F61 起；老编号一律不动不重排**，specs/代码/记忆里到处引用 F##，重排会全断）。谁直接改真 app 新增了用户能力，除更新 feature spec 外也在 board 建卡。
**来源**：Notion Feature Board 整理（Colin 拍 D1–D5，2026-07-21）；规范页 https://app.notion.com/p/3a4f2e70d0e781309780e34c3bb5f185 ，归档页（合并/退休卡，可恢复）https://app.notion.com/p/3a4f2e70d0e781a48633f344233c8c87

## 2026-07-21 — 浏览器下载功能全链路完整落 main,但 Colin 说「先不发版」(别当发版就绪)

**是什么**:下载 feature 从调研到真 app + UX 打磨已**全部合入 main**(#262 需求 → #272 ui-demo → #278 真 app 实现 U1-U6 → #286 UX 打磨:toast 改小/popover 锁侧栏宽/加打开)。Colin 2026-07-20 真机验收三改动通过,**但明确说先不发版**(2026-07-20 口头拍板)。
**怎么 apply**:
① **别把 main 上有下载功能当作发版就绪信号**——Colin 要自己定发版时机,且要先走完真机 checklist(自动化够不着的:非 mac 工具栏尺寸 / 真实网站下载 / 访达真打开 / 快速开关 popover)。
② **若你在 cut release / 打 tag**:知道 main 带着完整下载功能,但 **Colin 说 hold**——发版前务必跟他确认,别顺手带出去。
③ 下载功能已终态:will-download 真接落盘、右键存图、popover **锁侧栏宽不盖网页**(见 07-20 更正条,不走 OVERLAY_SEL)、toast 双态、「打开」按钮。契约 spec §4.11。
**来源**:PR #286(承接 #278);Colin 2026-07-20「先不发版」。
## 2026-07-21 — Toggle(可折叠)块开发中:brainstorm+plan 就绪,将重改编辑器核心三文件

**是什么**:Wendi 要 Notion 式 toggle 块进 Schema #1。需求 docs/brainstorms/2026-07-20-toggle-list-block-requirements.md + 详细计划 docs/plans/2026-07-20-001-feat-toggle-list-block-plan.md 已就绪。磁盘契约(validateDetails/AI-guide)早 ship,这次纯做编辑器创作。三大硬骨头方案:①真 app 可达性=scoped block-root(scopeRootOf/blocksInScope,门控在文档真含 <details> 之后,无 toggle 文档走原路径);②撤销解耦=cleanedBodyHtml 剥 open(仅 undo 快照层,serializeDocument 保留)+ undo.js undo/redo 重贴 fold(位置索引);③分页=collectCutAtoms 加 details 选择器 + buildWordspacePrintHtml 克隆上 force-expand 一行。ui-demo 只做 UX 外壳(body=raw contentEditable),真嵌套只在真 app——有意分歧(仿 editor-select-all 先例)。

**怎么 apply**:⚠ 这个 feature 会**重改 src/editor/blockedit.js(blockOf/topBlocks/deleteSelection/execText/dropFileLink/onKeyDown 全线)+ src/editor/serialize.js + src/renderer/shell.js**——都是热点共享核心。这几天要动这三个文件的 session 先看计划或跟我对齐,避免 merge-train 连撞。我在自己的 worktree(feat/toggle-real-app、feat/ui-demo-toggle,均 off origin/main)开工,不碰任何现有 worktree。

**来源**:docs/plans/2026-07-20-001-feat-toggle-list-block-plan.md

## 2026-07-20 — ⚠更正 07-18 那条:下载 popover 已改「锁侧栏宽、不走 OVERLAY_SEL」(Colin 真机反馈)

**是什么**:Colin 真机跑 #278 后反馈「popover 不该盖真网页」,已改(PR #286):下载 popover 从「340px 覆盖网页区 + 走 OVERLAY_SEL 摘 view+截图垫底」**推翻**成「锁进侧栏宽度、右缘=侧栏右缘−8px、绝不进网页区」(`anchorPos` 读 `#sidebar` rect)。附带 toast 改小(侧栏开着走侧栏内小 toast 不顶网页 72px、收起才 over-web)+ 加「打开」按钮(`shell.openPath` 用户手动打开)。
**怎么 apply**:
① **07-18 广播里「下载 popover 是 OVERLAY_SEL 最新先例」这句作废**——它现在**不走** OVERLAY_SEL 了。要「DOM 弹层盖网页」的先例去看别的(modal/Cmd+P/AI 面板仍在 OVERLAY_SEL)。
② **新增设计取舍先例**:DOM 弹层**该不该盖网页**是个选择——盖网页(要视觉覆盖内容区)就注册 OVERLAY_SEL、接受「摘 view+冻结截图」;**不该盖网页**(侧栏类)就 `anchorPos` 读 `#sidebar` rect 锁进侧栏宽、别碰 OVERLAY_SEL(更简单、无冻结、无 webHideAll 竞态)。下载 popover 现在是后者先例。
③ **07-18 修的 OVERLAY_SEL webHideAll 竞态守卫仍有效**——保护的是仍在 OVERLAY_SEL 里的弹层(modal 等),不受本次影响。
④ 教训:**真机反馈能推翻 e2e+设计都覆盖不到的主观 UX 判断**——popover 覆盖网页在 ui-demo 里 Colin 验收过、e2e 全绿,但真网页上体验不对;真机走查不可替代。
**来源**:PR #286(承接 #278);spec §4.11/§13 已改。

## 2026-07-20 — 隐藏驻留只走 hideForResidency:别再直接 win.hide()(全屏会黑屏)

**是什么**:Wendi/Colin 报「全屏下点左上角关闭 → 黑屏」。根因宿主实测(2/2 复现):**macOS 不接受对原生全屏窗口的 `orderOut:`**——`win.hide()` 被静默吞掉,窗口没藏、独占的全屏 Space 也没拆,用户面对一块空 Space 就是那片黑;非全屏同一条路立刻 `isVisible()=false`(对照组)。已修(#285):抽 `src/lib/window-residency.js` 的 `hideForResidency()` 收口——全屏先 `setFullScreen(false)`、等 `leave-full-screen` 再 `hide()`,回来是窗口态(对齐原生 mac 红灯语义)。

**怎么 apply**:① **动窗口生命周期(close/hide/隐藏驻留/退出流)时,一律走 `hideForResidency(win)`,别再直接 `win.hide()`**——直接调就是这个 bug 的回归。② 更普遍的教训:**任何「窗口态相关」的行为,写之前先问一句「全屏时成立吗」**;全屏是 2026-07-18 才随沉浸窗框进入本 app 关注面,此前写的窗口逻辑都没考虑过它(这次就是 close 路径漏检),updater 退出/下载弹窗/新窗口这些路径值得顺手复查。③ 门的分工照这个先例:CI 侧用注入替身锁**顺序不变量**(`test/window-residency.test.js`,跑得动 Linux),真机行为放宿主脚本(`scripts/verify-fullscreen-close.js`,非 mac 以退出码 2 报错、不静默跳过)——因为 CI 的 xvfb 无窗口管理器、`setFullScreen` 不可靠,而判据是 `isFullScreen()` 的真 OS 状态,`win.emit` 伪造不了(与 `immersive.spec.js:156` 同款结论)。

**来源**:PR #285,fix/fullscreen-close-black

## 2026-07-18 — 浏览器下载进真 app(will-download 真接)+ 工具栏 7 钮尺寸账 + OVERLAY_SEL 竞态修复

**是什么**：浏览器下载(标准档)移植进真 app(PR #278):will-download 从「一律 cancel」换成真接 DownloadItem 落盘 + 下载管理 UI(工具栏进度环 + popover 列表 + 右键存图/链接另存为)。推翻 2026-07-09「不做下载」旧拍板(Colin 2026-07-17 拍板恢复)。附带两处共享核心改动 + 一个潜伏竞态修复。
**怎么 apply**：
① **web-tabs.js will-download 不再 cancel**——手上若有 e2e/代码断言旧的「下载被 cancel / 不支持下载 toast」行为,已失效(browser.spec.js:551 改写成真下载落盘)。下载记录持久化=browser-store 第四 cell(browser-downloads.json);纯逻辑=src/lib/downloads.js。
② **.sb-head 现在 7 颗按钮**(加了下载入口 #nav-downloads),钮宽已收到 22px(mac)/26px(非 mac)+ 非 mac gap 收 4 凑 min-width 240 的账(shell.css .sb-head 处有账本注释)。**再往顶排加图标前先重算这笔账**,否则最右钮溢出被编辑区 iframe 吞点击(e2e T7 栽过)。
③ **DOM 弹层要盖住网页区(WebContentsView)必须注册进 OVERLAY_SEL**(browser.js:257 的常量 + 快捷键守卫 :1188 两处都加)——原生 view 恒在 DOM 之上,不注册就被盖住;注册后「摘 view+快照垫底」+ veil 关闭直接可用。下载 popover 是最新先例。
④ **修了 OVERLAY_SEL observer 一个潜伏竞态**(browser.js 迟到的 webCapture .then):原来无条件 webHideAll,快速开关弹层时把已挂回的 view 又藏了→网页区卡空白须切标签恢复。已补取消令牌守卫(overlayPaused/attachedKey,对齐姊妹 __webPeekSnap)。动这段 OVERLAY 逻辑前知道这个先例。
**来源**：PR #278;plan docs/plans/2026-07-17-003-feat-app-browser-downloads-plan.md;契约 docs/browser-feature-spec.md §4.11。

## 2026-07-16 — 沉浸收起(Arc 对标)已全量合 main:sb-reopen 浮钮已删、真 app 换 hiddenInset 窗框

**是什么**:Wendi「零缝隙」反馈落地(ui-demo #230 + 真 app #238)。侧栏收起=流内零渲染(ui-demo 48px 细轨、真 app 52px COLLAPSED_STRIP、#sb-reopen 常驻浮钮**全删**),重开=左缘 hover peek(悬浮盖内容)/Cmd+\;真 app darwin 换 titleBarStyle:hiddenInset,红绿灯进 .sb-head(兼窗口拖拽区)且随收起隐藏。spec=docs/features/immersive-collapse.md。
**怎么 apply**:① e2e/代码**别再引用 #sb-reopen**(元素已不存在;二次展开的测试口径=mouse.move(3,430) 出 peek 后点 #sb-toggle,或 Ctrl+\,参照 e2e/immersive.spec.js)。② **往 .sb-head / ui-demo .arc-top 加图标前先重算宽度账**(mac 红绿灯让位后 238≤min-width 240,余量 2px——超了最右钮被编辑区 iframe 吞点击,CSS 注释有账本)。③ 宿主 mac 跑 app 看到没有系统标题栏=正常新窗框,不是 bug。
**来源**:PR #230 / #238,feat/immersive-collapse-app
## 2026-07-16 — P0 大根修复已全部落地(P0a #236 + P0b #241)——动 sidebar/ipc/workspace 先 rebase;附「墙钟断言别贴边」教训

**是什么**:大根卡死 P0 系列收官,两个 PR 已合 main:P0a 止血包(#236:启动死门修复/walk 条目预算
15 万/「过大」态/菜单「管理文件夹…」逃生门/病灶路径确认框)+P0b 懒加载(#241:超预算根自动进「简化
模式」——readDir 按层读取(单层 5 万预算)/watcher 只重读「变化∩已加载层」/筛选/Cmd+P/inode 跟随降级/
link-index listFilesMatching 修复(原会钻 node_modules/.app)/ensureDir Map 化(150k 宽树 68s→0.6s))。
双双经主 session 对抗审查:真实家目录(191 万条目)重放全过——现在加 ~ 是「1.8s 进简化模式、能浏览
能开文档、重启秒开、随时可移除」。
**怎么 apply**:①`src/renderer/sidebar.js`(+300 行)/`src/main/workspace.js`/`ipc.js`/
`src/lib/file-tree.js`/`link-index.js` 都大改了——手上有未合分支动过这些文件的,rebase 时冲突自解,
语义疑问查 `docs/features/workspace-big-roots.md`(行为契约已全量更新)。②之前广播的「删 workspace.json
救援法」对新版不再必需(但 v0.10.x 及更老版本用户仍用得上)。③**教训:测试里的墙钟性能断言别贴边**
——执行 AI 在快 Mac 上量 0.6s 就写 1.5s 阈值,GH 共享 runner 直接超时红(CI 实锤);性能断言的阈值
应设在「要防的那类回归」量级(这里 O(M²) 复发≈68s,线设 10s),不是本机实测×2;「本地绿≠CI 绿」
对性能断言同样成立。④e2e 全量套跑一条既有 P2-6 偶发 flaky(重试即过、main 无前科)——遇到先重跑
确认非回归,别急着改测试。
**来源**:PR #236/#241;诊断=docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md;
spec=docs/features/workspace-big-roots.md。

## 2026-07-16 — 硬教训：quitAndInstall 不发 before-quit，发 before-quit-for-update（动退出链必读）

**是什么**：Electron `autoUpdater.quitAndInstall()` 的退出时序是——先发 **`before-quit-for-update`**、再逐窗 `close`、全部关完才 `app.quit()`（届时才有 before-quit）。main.js 曾只接 `before-quit` 打「真退出」标志、注释还断言 quitAndInstall 会先发它（假的）——结果 mac「关窗=隐藏驻留」守卫把 quitAndInstall 的关窗 `preventDefault` 吞掉：窗口只是藏起来、app 不退、安装永等不到 `window-all-closed`。用户视角=「点了重启安装没反应」，且这按钮**自上线起从未工作过**（Colin 机器 updater.log 2026-07-15 四连击零重启实锤；此前所谓能更新全靠用户手动 Cmd+Q 触发退出时安装）。同 PR 另修两个：bundle 被提权安装写成 root:wheel 后每次更新都要密码（一次性 chown 修复流程 + `src/lib/mac-bundle-repair.js`）、下载进度面板整卡拆建+抢焦点导致狂闪（改结构签名比对原地更新）。
**怎么 apply**：① 任何要在「真退出」和「关窗=隐藏」之间做区分的代码（close 守卫/退出清理/防丢数据），**必须同时监听 `before-quit` 和 `before-quit-for-update`**——只接前者=自动更新重启必坏；② 别信注释里对 Electron 事件时序的断言，electron.d.ts + updater.log（`userData/logs/updater.log`，「evt=xxx ∅ -> checking」=新进程启动标记）可实证；③ 面板/弹层类 UI 收高频推送时，禁止每次推送整树重建+refocus——按结构签名做原地更新。
**来源**：PR #231（fix/updater-ux）；docs/features/app-updater.md 行为契约已更新；随 v0.10.1 发版

## 2026-07-16 — P0 大根卡死:救援方法 + 「上限是条目数不是 GB」+ sidebar/ipc/workspace 即将大动(撞车预警)

**是什么**:Colin+Wendi 都中招——把巨型目录(家目录/桌面)加为根,app 卡死甚至死锁(根行不渲染、
移不掉、重启复发)。诊断完成:①上限单位是**文件条目数不是 GB**(readTree 严格线性,25 万条=18s/68MB
payload;Colin 家目录 191 万条→分钟级扫描+~2GB 双进程堆=renderer OOM 冻死;~/Library 不是隐藏目录、
现有跳过规则拦不住);②死锁根因=启动路径 `await Promise.all(读树)` 先于 rootsState 赋值
(sidebar.js:2839)→空态永驻→唯一移除入口(根行右键)不可达;③watcher 高 churn 根 overflow→全量重扫
永动机。诊断正本=docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md(PR #228)。
**怎么 apply**:①**用户救援**(告诉 Wendi/任何中招者):⌘Q 完全退出→删
`~/Library/Application Support/Wordspace Next/workspace.json`(或编辑其 roots 数组删大根条目)→重启;
**别重装,重装不清 userData,白装**。②做 perf 或压测:以条目数为轴造合成树(25 万条只要 35s/250MB 盘),
别用 GB 填盘。③**撞车预警**:P0a(修死锁+扫描预算 15 万+管理文件夹逃生门)与 P0b(懒加载架构)即将
大动 `src/renderer/sidebar.js`(启动 IIFE/renderRootSection 区域)、`src/main/ipc.js`(ws-add-folder)、
`src/main/workspace.js`(walk/readTree)、`main.js`(菜单)——并行 session 动这些文件前先 /sync-main
看 P0a/P0b PR 状态,改 sidebar 启动时序属高危区。执行 plan=docs/plans/2026-07-16-001/002。
**来源**:诊断+plan PR #228;拍板=Colin 2026-07-16(P0a 先行、P0b 紧随、预算 15 万条目)。

## 2026-07-15 — Vercel 部署改造：预览构建关闭 + 只在本目录变更时构建（治连日限流）

**是什么**：仓里两个 Vercel 项目（ui-demo/website）连同一个仓、原本没 vercel.json，导致每次 push 两个项目都构建、每个 PR 分支都出预览——连日撞爆免费日部署限流、卡所有人。已加 `ui-demo/vercel.json` + `website/vercel.json` 的 ignoreCommand（PR #220）：① 预览分支一律不构建（`VERCEL_ENV != production` → 跳过）；② main 只在本项目目录有变更时才构建。Colin 拍板关预览。
**怎么 apply**：① **PR 分支不再有 Vercel 预览链接了**——要看效果走「合 main → 看公开 live（wordspace-ui-demo.vercel.app）」，或本地 `npm run dev`。别再等/找预览 URL。② 别删这两个 vercel.json；改 ignoreCommand 前想清楚（写错方向会让 live 不部署或全量构建，exit 0=跳过 / 非0=构建）。③ docs-only PR（team-memory/changelog）现在两个项目都跳过构建，正常。
**来源**：PR #220（chore/vercel-skip-unchanged）

## 2026-07-15 — ui-demo 常驻 worktree 有 3+ 并发 session,必须各开独立 worktree

**是什么**：ui-demo 常驻 worktree（.../wordspace-next-ui-demo）此刻被 3+ 个 session 同时抢（feat/ui-demo-doc-images 图片块 / feat/ui-demo-template-v1 用户自定义模板 / feat/ui-demo-company-templates）。实测撞车：我在里面 checkout 自己分支后,另一 session 把工作树切到 doc-images,我的未提交改动被带到他们分支、和他们 Canvas.tsx/image.ts 混一起,险些被 git add -A 一并提交。
**怎么 apply**：① 动 ui-demo 前先 `git -C <worktree> branch --show-current` 确认分支没被别人换走;② 多 session 同时改 ui-demo 一律各开独立 worktree（`git worktree add <新路径> <你的分支>`,如我用了 .../wordspace-next-template）,别共用那个常驻 worktree——共用时任何一方切分支都会劫持彼此未提交改动;③ 收尾清干净自己在共享树里的污染,别连累别人。
**来源**：feat/ui-demo-template-v1（用户自定义模板 U1 实施途中）


## 2026-07-14 — 探索测试 p1（错误页死路）已修 PR #201；动 browser.js/web-tabs.js 前先看

**是什么**：错误页恢复死路修复合入中（PR #201,分支 fix/browser-error-page-recover）。根因比计划更深:错误页**自身会提交**(did-navigate→everCommitted 藏起始页)+showError 摘 view(attachedKey=null)→ everCommitted 重挂分支与 error-clear 分支双双够不着。修法=主进程给 web 标签加 **navSeq 提交序号**(每 did-navigate 自增,随 web-tab-updated 推),renderer 认 s.navSeq>prev.navSeq 的**提交沿**重挂 view。

**怎么 apply**：① 认领 bug-hunt 别的浏览器条目、或任何动 `src/main/web-tabs.js` / `src/renderer/browser.js onWebTabUpdated` 的 session:**先拉 PR #201**,它给 pushUpdate 加了 navSeq 字段、给 onWebTabUpdated 加了第三条恢复分支——别覆盖或与之冲突。② 硬教训(可复用):**「loading 收尾沿」≠「提交」**——abort/-3(下载被cancel/204/被后续导航打断)照样 loading 收尾但没提交,拿收尾沿做 view 重挂会盖上失败页残帧(对抗审查 CONFIRMED P2);要「新页真提交」信号就用 did-navigate,别用 did-stop-loading。③ 测试硬教训:纯新标签失败**不是死路**(起始页还在→everCommitted 分支自愈),复现死路必须「已提交过的标签」或「切走再切回」——写错误页恢复的 e2e 别用纯新标签(会写出自测绿但没测到东西的空门,变异自检才逮出来)。

**来源**：探索测试计划 docs/plans/bug-hunt-2026-07-14/p1-error-page-dead-end.md;PR #201(含 5 e2e+三向变异自检+正本 §10.2 记账)。

## 2026-07-14 — 基础编辑器悬停蓝框（.nce-hover/🗑/🔒）整体撤除（app+ui-demo，PR #180）

**是什么**：Wendi 报非合规文档里出现巨型蓝色虚线框——那是基础编辑器的「悬停删除」浮层：整篇一张 `<table>` 的文档（Word 导出常态）悬停即框住整表、🗑 锚在框右上角视口外不可见，用户读作渲染 bug。Colin 拍板把悬停 chrome（虚线框/🗑/只读🔒）整体撤掉；删块保留 Esc 块模式 + contenteditable 原生选中删除。
**怎么 apply**：别再往基础编辑器加 mousemove 悬停浮层；`.nce-hover`/`.nce-lock` 选择器已不存在（e2e 有反向门「悬停不出块 chrome」守着，变异自检过）。基础编辑的行为契约新家 = `docs/features/basic-edit.md`，动基础编辑（app 或 ui-demo 侧）先读它。
**来源**：分支 fix/basic-edit-hover-box / PR #180 / spec docs/features/basic-edit.md

## 2026-07-13 — 侧栏收藏区 header 口径变更：栏标化 + 对齐网格，两侧已同步（spec §4.3 已更新）

**是什么**：Wendi 反馈收藏区「视觉乱」，根因 = 收藏 header 穿「文件夹行」的衣服（行首 caret +
accent 星标 + 中灰粗体），与同级栏标（置顶/标签页/文档）语言不一致，且列内多套左缘各自为政。
新口径：header 用 editorial 栏标语言（mono/fs-xs/宽字距/text-3），星标撤出 header（☆ 只留地址栏），
caret 移行尾常显、展开原地旋转；对齐网格 = 栏标与内容各一条左缘。正本 `docs/browser-feature-spec.md`
§4.3 / 图标清单 / 验收清单 / ASCII 图已全部更新。
**怎么 apply**：ui-demo（PR #170）与真 app（PR #173）已按新口径同步落地，锚点已记账
（`docs/features/browser.md`），此项无欠账。之后动侧栏收藏区、写相关 e2e、或做移植的 session
一律按 spec §4.3 新口径来——别参考旧截图，也别参考旧分支（如 `wordspace-next-browser` 的
feat/browser-tabs 旧实现）。
**来源**：PR #170 / #173，spec §4.3（2026-07-13），Wendi 反馈 + Colin 拍板。


## 2026-07-12 — 分页文档已进真 app（PR #164 合 main），feature 全链路收官

**是什么**：分页文档完成 ui-demo（PR #151）→ 真 app（PR #164）全链路：V4 引擎/页面设置/@page 入盘/
分页导出+页码，宿主实测屏显与 PDF 一致（6 页 A4 + 页脚页码）。两侧对齐锚点已更新
（docs/features/paged-doc.md）。
**怎么 apply**：动分页相关代码前先读 spec；改动必须过 e2e/paged.spec.js（真 app）/
scripts/verify-paged-v4.mjs（ui-demo）两道门。遗留小项（pre 收编 Schema 后激活块内切分、
页间点击路由语义统一）在 spec 欠账。worktree `wordspace-next-schema2` 的旧分支 feat/schema-2-paped
已删除，勿再引用。
**来源**：PR #164 / docs/features/paged-doc.md


## 2026-07-11 — 「打开大文件夹/桌面特别卡」根因 = .app 等 macOS 包被递归；文件树加三档忽略

**是什么**：Wendi「打开 Wordspace 特别卡」真根因（视频实测）：她把桌面当工作区，桌面里有 Minecraft.app——
macOS 的 .app/.framework/.photoslibrary 等是「包」（Finder 当单个文件），但 readTree 原来把它当普通文件夹**递归钻进去**，
内部上万框架/资源文件把 readTree 卡死。**又一次不是云盘**（桌面是本地盘）。修法 PR #162：文件树三档忽略——
A macOS 包（20 种后缀）显示成单节点不递归；B 依赖/构建/缓存目录（node_modules/.git/bower_components/__pycache__/
Pods/DerivedData/venv）完全隐藏；C 隐藏文件（点开头）原 skip 已覆盖。实测 demo 10002 文件→只 2 文件进树、7ms。
**怎么 apply**：遇「打开某文件夹卡」先查里面有没有 .app 或 node_modules 这类包/依赖目录被递归（别再先怀疑云盘）；
忽略规则在 src/main/workspace.js（IGNORE / BUNDLE_EXTS / walk），加新类型往这两个 set 加。契约见 docs/features/workspace-file-tree.md。
**来源**：PR #162。


## 2026-07-11 — 浏览器真 app 移植 PR #160 已开：动了共享核心，动 sidebar/shell/tabs/ipc 前看一眼

**是什么**：浏览器 feature 按唯一契约 `docs/browser-feature-spec.md` §14 全量移植进真 app
（`feat/browser-port`，PR #160，等 Colin review）。改动横跨共享核心：`src/renderer/sidebar.js`
（web 第三身份类/循环切换/⌘⇧T 重开栈/⌘T 二合一 modal）、`src/renderer/shell.js`（web view
摘挂钩子/菜单 web 态拦截）、`src/lib/tabs.js`（web: 前缀/updateEntry/关闭栈）、
`src/main/{ipc,main}.js`（浏览器 IPC 面/菜单项）+ 新模块一批。附赠两条通用硬教训：
① Electron `findInPage` 显式传 `findNext:false` 会让 `found-in-page` **静默不发**（首次请求
必须省略 findNext）；② `git add -A` 会把 worktree 里陈年未跟踪产物扫进历史（本次 `release-smoke/`
整个 .app 几百 MB 进了 6 个 commit，push「网络挂死」查半天其实是巨型包——filter-branch 剔掉才推动）。
**怎么 apply**：并行 session 近期动上述共享文件前先看 PR #160 的 diff 防撞车；它合进 main 后记得
rebase。commit 前扫一眼 `git log --name-only` 的顶层路径，别让打包产物进历史。浏览器行为的改动
一律改 spec 正本 + 同 PR 更 `docs/features/browser.md`（欠账清单也在那）。
**来源**：PR #160（feat/browser-port）；spec=docs/browser-feature-spec.md；worktree wordspace-next-browser。

## 2026-07-11 — 文档 back/forward 归到浏览器统一导航移植里做（别单独建两套）

**是什么**：真 app 的「文档向前向后 / 导航历史」决定挂到**浏览器 feature 的统一导航移植**上做，不在
doc-linking 或别处单独在 doc-header 建一套（Colin 2026-07-11 拍板）。原因：浏览器 feature
（`docs/browser-feature-spec.md`）在真 app 要建侧栏导航 chrome（网页 back/forward），而 ui-demo 已把
「网页 + 文档」的前进后退**统一在侧栏箭头**上（按当前标签类型分派：web→浏览器历史 / doc→文档导航历史，
见 PR #146 `ui-demo/src/mock/nav.ts`）。两者抢同一块地盘，分开建 = 两套 back/forward UI = 分裂。
**怎么 apply**：**谁做浏览器真 app 移植**（按 `docs/browser-feature-spec.md` 建 app 级导航 chrome）——请
**一并建统一的前进后退（网页 + 文档共用一套历史栈 + 一对箭头）**，照 ui-demo 模型；文档侧的导航历史
（记录 openDoc/showViewer 两个导航终点）作为 doc 分支接进去。**doc-linking 这条不单独做真 app 版**
back/forward（移交文档 `docs/doc-linking-feature-spec.md` §4.2 已把 doc-header 独立版标为兜底）。眼下
文档「回上一篇」靠标签页兜（上一篇的标签还开着，点它回去）。
**来源**：Colin 2026-07-11 拍板；ui-demo 版 PR #146；`docs/doc-linking-feature-spec.md` §4.2 +
`docs/features/doc-linking.md` 欠账 N1。

## 2026-07-10 — 真 app 加了隐藏性能诊断模式 + 「云盘不是 perf 元凶」实测教训

**是什么**：v0.6.5 起，真 app 菜单「Wordspace Next→性能诊断…」（或 Cmd+Shift+D）开隐藏诊断面板，显示每根 readTree 耗时/文件数/watcher 触发次数/云盘徽章 + 渲染耗时 + 主线程长任务(>50ms 卡帧) + JS 内存，并可「录制 5 秒 CPU Profile」存桌面。普通用户零感知（默认不显示）。**硬教训**：Wendi 报「桌面+谷歌网盘两文件夹贼卡」，但云盘 stat 不慢（dataless 只是内容不在本地、元数据本地缓存）、readTree 不比本地慢（OneDrive 24k 文件 759ms vs 本地 20k 186ms 同量级）、空闲云盘 40 秒零 watcher 事件——三次实测全推翻「云盘慢」这个纯代码脑补。真实成本是文件数→readTree 线性涨，默认折叠时渲染很便宜。
**怎么 apply**：做 perf 别从代码猜「云盘慢」；要判断就用这个诊断面板、且在代表性大文件夹上量（本地合成小文件夹会给假绿、骗过我们一次）。工具已在 src/main/perf-diag.js + src/main/workspace.js readTree 埋点。
**来源**：PR #147（已合 main、发版 v0.6.5），worktree 已清。


## 2026-07-11 — /remember-global 落账方式定案：PR + auto-merge，直推特权废除

**是什么**：Colin 拍板（方案 B）：保留 main 的全部保护门（must-PR + required test/e2e，含管理员），
`/remember-global` 改走「短命分支 + PR + `gh pr merge --auto`」；仓库已开 Allow auto-merge。
skill 文档已同步改写（含标记行前缀匹配、jizhoutang10thglobal 账号 push 等实操坑）。
**怎么 apply**：写 team-memory 一律按新版 skill 步骤走，发完即走不等 CI（约 7 分钟后自动上 main）。
任何「直推 main」的念头都打消——对所有人所有文件都不存在这条路。
**来源**：PR（本条目所在）+ 仓库设置 allow_auto_merge=true（2026-07-11 API 实开）


## 2026-07-10 — 浏览器 feature 规格定稿 + 六项拍板合 main；真 app 移植的唯一契约就位

**是什么**：浏览器 feature（标签上网/地址栏+自动补全/侧栏折叠收藏/历史/右键菜单/快捷键/会话恢复）在
ui-demo 定稿并合 main（PR #150）。完整规格=`docs/browser-feature-spec.md`（正本，~460 行：每功能三层
「交互契约 → ui-demo 参考实现 → 真 app 后端设计(WebContentsView/IPC/存储)」，含安全不变式与验收清单）
+ `docs/features/browser.md`（features 注册表薄指针+欠账）。Colin 六项拍板已落地：真 app 默认引擎=Bing；
删「主页」设置；点收藏=已开则聚焦；收藏折叠态持久化；新标签瓦片=书签栏前 N 个收藏；导入重名文件夹
加后缀不合并+toast 报净新增。同日更早定稿：收藏=左侧栏折叠区（置顶上方、默认收起）、网页态无网页头、
砍剪藏/下载/阅读模式（§12，别加回来）。
**怎么 apply**：做真 app 浏览器移植的 session：唯一契约是 `docs/browser-feature-spec.md`（§14 验收清单
逐项打勾、§11 安全不变式一条不许松）。⚠ worktree `wordspace-next-browser`（feat/browser-tabs，PR #132）
停在多轮 UX 定稿之前——web-tabs.js 地基可复用，但其网页头/旧收藏形态不要照搬。ui-demo 侧改浏览器
行为 → 改正本 + 同 PR 落实进 ui-demo（正本=可执行定义）。
**来源**：PR #150（docs/browser-spec-v2）、docs/browser-feature-spec.md §13/§15、Colin 拍板 2026-07-10


## 2026-07-10 — 分页文档 ui-demo 定型合 main；真 app 移植契约在 docs/features/paged-doc.md，schema2 worktree 旧实现作废

**是什么**：分页文档（Word 式：统一 A4 页高、超高块带留白分页、可编辑表格/代码、编辑稳定）在 ui-demo
定型并合 main（PR #151）。经历多轮翻车后定型的 V4 实现有四条铁则（回车分裂继承推挤样式→清理必须
选择器全量扫荡；灰缝锚定实测推挤位置而非几何网格；同帧扫荡→测量→重推；覆盖层坐标原点=纸 padding 盒），
全部写进 docs/features/paged-doc.md（行为契约+文件映射+欠账）。
**怎么 apply**：要做真 app 分页移植的 session：唯一契约是 docs/features/paged-doc.md。⚠ worktree
`wordspace-next-schema2`（分支 feat/schema-2-paged）里的真 app 实现是旧口径（独立 Schema 2 + 画线、
无留白），已作废——移植前必须按 spec 改造：删 schema-2 descriptor（分页=Schema 1 可选版式设置，
Colin+Wendi 拍板）、分页引擎按 V4 铁则重写。别直接续用旧 worktree 代码。验证抄
ui-demo/scripts/verify-paged-v4.mjs 的断言口径（页界真空带/页高统一/编辑不累积/数据零污染）。
**来源**：PR #151（feat/ui-demo-paged-gaps）、docs/features/paged-doc.md

## 2026-07-10 — ⚠ /remember-global 的「直推 main」路径已被分支保护封死

**是什么**：main 的 branch protection 现在含「Changes must be made through a pull request」，管理员
账号直推也被拒（GH006）。/remember-global skill 文档里「唯一允许直推 main」的特权路径实际不可用。
**怎么 apply**：写 team-memory 暂时走「短命分支 + PR + CI + merge」；skill 文档与保护规则的冲突
待 Colin 拍板（要么给 bypass、要么改 skill 文档）。
**来源**：本条目落账过程实测（2026-07-10）


## 2026-07-10 — 跨 session 对齐体系上线（本文件 + 3 个 skill）

**是什么**：新增 `docs/team-memory.md`（本文件）、`docs/features/` 对齐 spec 体系、三个仓库级
skill：`/sync-main`（拉取并消化 main 增量）、`/remember-global`（写公告到这里）、
`/align-feature`（ui-demo ↔ 真 app 按 feature audit/port）。
**怎么 apply**：各 session 从此用 `/sync-main` 替代「人肉转述 main 有什么新东西」；发现全局教训用
`/remember-global` 落账；直改真 app UI/交互时必须同 PR 更新 `docs/features/` 对应 spec 或记欠账
（规则已进 CLAUDE.md）。存量分支要 rebase 到 main 之后才有这三个 skill。
**来源**：`feat/alignment-skills`，需求文档 `docs/brainstorms/2026-07-10-session-alignment-system-requirements.md`。
