# 沉浸收起(侧栏零缝隙) —— 对齐 spec

> 来源:Wendi 2026-07-16 对标 Arc 反馈(「他们的应用根本没有一点缝隙,所有的地方都可以隐藏,
> 我们的应用顶上和左边都有一条栏」)。Colin 拍板 **ui-demo-first**;真 app 已移植,两侧同步演进
> (2026-07-17 起含 10px 窗框 + 网页 peek 快照垫底,Wendi 视频反馈三连修;
> 2026-07-18 Colin 拍板窗框扩 **非全屏恒有**——展开态也有框,只有真全屏没框)。
>
> 两项拍板(Colin 2026-07-16):① 重开入口 = **纯 Arc 式**(左缘 hover peek + Cmd+\,零常驻可见 UI,
> 不留浮钮);② 沉浸范围 = **网页标签全隐、文档标签保留 52px 文档头**(文件名/保存有功能价值,
> 不算废边距;Wendi 的截图对比都是网页,痛点在网页标签)。

## 行为契约

**收起 = 沉浸**:侧栏收起后流内零渲染——没有 48px 细轨、没有常驻浮钮,内容区只隔一圈 10px
窗框(网页标签 = 页面即窗口;文档标签保留文档头)。

**侧栏与窗框融合 = 一块 chrome 表面**(Wendi 2026-07-21「边框和左侧边栏的融合…还是尴尬」+
「对 Arc 来说,左侧边栏是浮在整个窗口上面的一个卡片」→ Arc 图层模型:窗=连续 chrome 底,
内容=浮在上面的圆角纸,侧栏不是独立面板、是 chrome 底上的内容):侧栏底色=窗框同色
(`--c-bg-chrome`)、无右边线,「侧栏+缝+框」一块表面,内容纸(#main 1px 边+圆角)独享层级。
连带:`.sb-sticky` 吸顶实底同步 chrome;`.sb-tab.is-active` 白 puck 对比降一档(Arc 同款观感);
sunken 保留给「凹一档」语义的小卡(失联根/挂载路径头)。**全屏例外**:摘框摘缝后侧栏与内容纸
直接相邻,补回 1px `border-right` 分界(限展开态——收起态 width:0 时 border 仍画 1px 会露线)。
门=`e2e/immersive.spec.js`「融合」(同色+非透明探针+边线,变异自检三向)。ui-demo 同步
(ArcSidebar.css .arc-sidebar / .arc-folder-head 吸顶)。

**10px 窗框带 = 非全屏恒有**(Wendi 2026-07-17 初稿只做收起态,Colin 2026-07-18 拍板扩「不仅收起态,
不收起也要有!只要不是全屏就要有」):内容四周均匀内缩 10px,露出 chrome 色(`--c-bg-chrome`)边框带,
内容区加 1px `--c-border` 细边 + `--r-md` 微圆角(纸方:内容=一块纸)。**真 app 里这圈是
`-webkit-app-region: drag` 的窗口拖动区**(顺带解掉「窗口拖拽无处可拖」欠账);ui-demo 无真窗口,纯视觉。

- **展开态**:侧栏贴左缘(侧栏本身=左侧 chrome,Arc 同款,**不给左带**——左缘让给原生红绿灯,不冒边带骑灯的险),
  内容 `#main` 四周 10px——左 10px = 与侧栏的缝;top/right/bottom 三条 drag 带照常(顶带横跨全宽含侧栏顶,
  与 .sb-head 拖拽区并存不冲突)。
- **收起态**:侧栏宽 0,内容从窗左 10px 起——视觉/行为与初稿(#271)**完全一致,零回归**。
- **真全屏**(macOS `enter-full-screen` / F11):两态都摘框(`#main` margin 0 / 无边 / drag 带全隐);
  但收起态的左缘 peek 触发热区**保留**(变透明、hover 不加深,不堵重开路)。

**重开三入口**:
1. **左缘 hover peek**(Arc 签名交互):触发已升级为**双通道**(Wendi 2026-07-22「必须精确停在
   那道缝上,Arc 滑到窗口左边或左上角就出来」):
   - **主进程光标轮询**(真手感来源,`ws-edge-watch`,只在收起态跑、窗口聚焦时判、90ms 一拍):
     唤出区 = 左缘带(窗左 **-24px..+16px** 全高——甩出窗外也认)∪ 左上角区(**80×48**,灯那片);
     首拍即开(不再要 120ms 停留);驻留区(唤出区∪卡区+24px 右缓冲)之外才宽限收回。
     **armed 机制**:光标动过才开始判定(触发语义=「进入」不是「静止在」;顺带堵死 xvfb 全局光标
     常驻 (0,0) 落在角区的 CI 误触发)。几何=纯函数 `src/lib/edge-zones.js`(node:test 钉住)。
     ⚠ 07-17 曾删过一版指针 watcher(「左带永属 DOM,触发单一化」)——当时是简化,这次为手感恢复,
     且 DOM 有结构性缺口:光标甩出窗外 DOM 永远收不到、快速划过+停留会取消、无左上角区。
   - **DOM 热区**(10px 左边框带,保留):e2e 的确定驱动通道 + 双保险;hover 加深反馈不变。
   完整侧栏以悬浮层滑出,**盖在内容上、不推挤布局**;移开 → 240ms 宽限滑回。
2. **Cmd+\\**(既有快捷键,行为不变)。
3. peek 悬浮层里点「收起侧栏」toggle 钮 = 真展开回停靠态。

**peek 实现约束**(移植也要遵守):
- **单实例**——peek 与停靠共用同一个侧栏组件实例,不另挂第二份。全局快捷键监听挂在该组件上,
  双实例会双挂监听、Cmd+\\ 一次触发两回(开了秒关)。
- 悬浮层静止态 `transform: none`——挂着 translateX(0) 会劫持内部 fixed 弹层(右键菜单等)的
  包含块(doc-linking 原型踩过的坑)。
- 藏起时 `visibility: hidden`(延迟到滑出动画结束)——防 tab 键聚焦到屏幕外的侧栏控件。
- 悬浮层 z 层:压过内容与文档浮层、低于 modal/toast。
- 悬浮层随窗框内缩(top/left/bottom = 10px),滑出后贴左边框内侧、视觉上从边框「长出来」;
  藏起位移要多让出左偏的 10px(`translateX(calc(-103% - 10px))`),否则右缘会在左带里露一丝。

**假红绿灯随侧栏走**(ui-demo):红绿灯画在侧栏顶部,收起即消失、peek 时随层滑回——一比一预演
真 app hiddenInset 后的 Arc 行为。

**peek 浮卡的红绿灯 = DOM 假灯**(真 app,Wendi 2026-07-22「把这3个按钮放到卡片上」):
原生灯搬不进 DOM 卡(Electron 无 AppKit `standardWindowButton` 重挂,Arc 是原生搬的所以灯能随
卡滑)。此前灯瞬移到卡内 (24,22),但卡要滑 320ms 才落位——滑入/滑出各有 ~1/3 秒灯悬空浮在内容上
=「灯不在卡片上」;落位后还差 1.2px(卡 1px 边框账)。终解:**peek 全程不显原生灯**,卡头部画三颗
DOM 假灯(`#sb-fakelights`,mac 专属,CSS 按 `is-mac+is-sb-peek` 显),随卡滑入滑出、与图标排同处
40px 头天生对齐;观感=macOS 原色 12px 圆 + hover 整组出符号(对齐 ui-demo `.arc-traffic`);点击走
`ws-win-ctl`(关/最小化/全屏,与原生同语义)。展开态仍是原生灯(14,12),不变。
e2e 用 `WS2_FAKE_MAC=1` seam 在 linux CI 上强挂 `is-mac` 测 mac 专属分支。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 收起态渲染(零流内元素+热区+peek 容器) | `ui-demo/src/components/ArcSidebar.tsx`(collapsed 分支) | `src/renderer/index.html`(#sb-edge-hot,sb-reopen 已删)+ `src/renderer/sidebar.js`(peek 控制器) |
| peek/热区样式与动效 | `ui-demo/src/components/ArcSidebar.css`(.arc-edge-hot/.arc-peek) | `src/renderer/shell.css`(.sb-edge-hot / body.is-sb-peek .sb 变身,keyframes 入场不用 fill) |
| 10px 窗框(**非全屏恒有**)+ 左带 hover 反馈 | `ui-demo/src/App.css`(.ws-main margin+边+圆角+clip **恒有** / .ws-body chrome 底 **恒有**;.is-immersive 仅标收起态供组件级 edge-hot/peek)+ `ArcSidebar.css`(.arc-edge-hot 10px/.arc-peek 内缩) | `shell.css`(**`body:not(.is-win-fullscreen)`** #main margin:10px + .win-frame 三条 drag 带)+ `index.html`(.win-frame-top/right/bottom);左带=#sb-edge-hot **不设 drag**(drag 区吞鼠标事件会哑掉 hover 触发),hover 加深限非全屏 |
| **全屏摘框接线**(非全屏恒有的状态源) | —(网页无 OS 全屏,框恒有) | `src/main/main.js`(`win.on('enter/leave-full-screen')` → broadcastFullscreen + `get-fullscreen` 启动初值)→ `preload.js`(getFullscreen/onFullscreenChanged)→ `sidebar.js`(挂/摘 `body.is-win-fullscreen`,启动查初值+听 live) |
| 窗框(hiddenInset+红绿灯进侧栏头) | 假红绿灯画在侧栏(天然等效) | `src/main/main.js`(darwin-only titleBarStyle+trafficLightPosition)+ `shell.css`(.sb-head 拖拽区/is-mac 让位 70px+26px 钮凑 240 最小宽的账) |
| 红绿灯随收起隐/peek 现 | —(无真窗框) | `src/main/ipc.js` ws-window-buttons + `sidebar.js` 收起/peek 时机调用 |
| 网页 peek 快照垫底 | —(iframe 无此问题) | `src/renderer/browser.js` __webPeekSnap(截帧垫 .web-peek-snap、摘 view;250ms 超时/失败退回 peekPush 推让)+ `sidebar.js` openPeek 异步化(peekPending 取消旗) |
| 网页态左缘 hover 侦测 | —(DOM 直接收 mouse) | 同 DOM 一条路径——#main 内缩 10px 后左边带永远是 DOM 地盘,原主进程 ws-edge-watch 指针轮询**已删**(ipc.js/preload/browser.js 三处) |
| 快捷键 Cmd+\\ | `ArcSidebar.tsx` 全局 keydown(已有) | `src/renderer/sidebar.js`(菜单加速器主通道+keydown fallback,已有) |
| 验证门 | `ui-demo/scripts/test-immersive.mjs`(15 断言:收起 11 + **展开态框 4**,boundingBox/computed 强口径;变异自检:回 48px 细轨 3 收起断言翻红 / 框改回收起态专属 2 展开断言翻红) | `e2e/immersive.spec.js`(**6 门**:收起 3 + **展开态框 / 全屏无框 / 全屏收起 peek 3**;全屏用 `win.emit('enter-full-screen')` seam 驱动真接线,变异自检:恒有选择器回 .is-sb-collapsed → 展开门红、全屏接线摘掉 → 全屏门红)+ `e2e/browser.spec.js`(贴零/推让门 + **展开态 view bounds 跟随 #main**;52px 条回植翻红)+ align/sidebar/tabs 三处旧断言改口 |

## 有意分歧

- ui-demo 没有真窗框,「顶上那条栏」(macOS 标题栏)只能在真 app 解决——ui-demo 的假红绿灯在侧栏里,
  收起后整体消失,视觉上已等效终态。
- **窗框范围(Colin 2026-07-18)**:真 app 真全屏(macOS)时摘框(Arc 同款);ui-demo 无 OS 全屏概念,
  框恒有、不做全屏例外——刻意分歧,不是漏做。真 app 的全屏摘框走 body.is-win-fullscreen,ui-demo 无对应类。
- 文档头保留是拍板②的范围收窄,不是漏做;后续若 Wendi 要文档也全隐,再开「文档沉浸模式」单题。

## 对齐锚点

- ui-demo 侧:PR #230(2026-07-16 合 main)
- app 侧:已移植(2026-07-16,分支 feat/immersive-collapse-app)。
- 两侧:窗框扩「非全屏恒有」(Colin 2026-07-18 拍板「不仅收起态,不收起也要有!只要不是全屏就要有」,#271 扩展)——
  U1 真 app(shell.css 恒有 + 全屏检测接线)+ U2 ui-demo(App.css 恒有)+ U3 本 spec;
  plan=`docs/plans/2026-07-18-001-feat-frame-always-plan.md`。
- 两侧:侧栏融合 + peek 红绿灯挪进浮卡(Wendi 2026-07-21 四点反馈之 1/3;PR #303 已合)。
  同批反馈之 4「收起态无框」= v0.10.6 没带 #276 的发版问题,零代码;之 2「触发手感」待 Colin 对照 Arc 定案。
- app 侧:Wendi 2026-07-22 二轮手感(测的是已含全部修复的 v0.11.0,非版本乌龙)——①「灯不在卡片上/
  重合没对齐」=灯瞬移 vs 卡滑 320ms 的时序悬空 + 1.2px 卡边框账 → **终解 DOM 假灯**(见行为契约,
  Colin 拍板弃「原生灯+时序同步」案);②「必须精确停在缝上」=DOM 热区结构性缺口 → **恢复主进程
  光标轮询**(双通道,见重开三入口;armed 机制防 CI 误触发)。分支 feat/arc-peek-feel。
  ⚠ watcher 轮询本体(interval/armed/focus 逻辑)CI 测不到(xvfb 光标不动、armed 永假=天然静默),
  zone 几何有 node:test、renderer 接线有 IPC 直发 e2e,轮询手感靠宿主真机验收兜。
- 两侧:Colin 2026-07-21 手感验收两修——①**红绿灯垂直对齐**:trafficLightPosition y 14→12
  (macOS 渲染灯组带内边,y=14 实测灯心 21.8 ≠ 40px 头钮中心 20,像素质心量的;peek 位联动 24,22;
  改 y 三处联动:main.js 构造 + ipc.js 归位 + sidebar.js peek 位)。②**toggle 两形态**:展开=
  「收起」(面板+左箭头)、收起/peek=「展开」(面板+右箭头),tooltip 同步(setSidebarCollapsed 是
  is-sb-collapsed 唯一写点,挂那全路径覆盖);i18n 加 sidebar.expandSidebarTitle(ui-demo 的
  expandSidebarHint 早已在字典、图标这次才跟上,换 PanelLeftClose/PanelLeftOpen 条件渲染)。
  门=e2e「toggle 两形态」;灯对齐无 getter,宿主像素质心量测兜。
- app 侧:分支 feat/immersive-frame-peek(2026-07-17,Wendi 视频反馈三连修)。**「同宽右移」定案已反转**:
  Wendi 拒绝内容被推(「挤过去又挤回很乱」)→ 改快照垫底(照更新弹窗白背景 #247 的 webCapture 方案):
  peek 滑出前对 view 截帧垫 .web-peek-snap、摘掉 view,页面视觉纹丝不动(Arc 同款);截图失败/超时
  250ms 退回推让。openPeek 因此异步化(peekPending 取消旗:截图在途鼠标已走就不滑出)。主进程指针
  watcher 同 PR 删除(窗框让左带永属 DOM,触发单一化)。

## 欠账(剩余)

- **Windows/Linux 窗框**:仍是标准系统标题栏(hiddenInset 为 darwin 专属;Windows 要
  `titleBarStyle:'hidden'`+`titleBarOverlay` 另做,顶上那条在 Win 上还在)。
- ~~收起态窗口拖拽~~:已解(2026-07-17)——10px 窗框 top/right/bottom 三条 drag 带,左带留给
  peek 触发(drag 吞鼠标事件,二者不能兼得)。展开态原本靠 .sb-head 拖;2026-07-18 窗框扩成非全屏恒有后,
  **展开态也有 top/right/bottom 三条边带可拖**(与 .sb-head 并存不冲突,顶带横跨全宽含侧栏顶)。
- ~~全屏下窗框仍在~~:已解(Colin 2026-07-18)——主进程 `enter/leave-full-screen` → renderer 挂/摘
  `body.is-win-fullscreen`,真全屏两态都摘框(收起态 peek 热区保留、变透明,不堵重开)。CSS 全走
  `body:not(.is-win-fullscreen)` 组合表达,不写两份。
- ~~展开态顶带盖侧栏图标钮顶 4px~~:已解(Colin 2026-07-18)——窗框扩成非全屏恒有后,横跨全宽的顶带
  (`.win-frame-top`,z235,drag)盖住展开态侧栏图标钮顶 ~4px(钮 y=6..34 ∩ 顶带 y=0..10),那 4px 变回
  drag 吞点击。修:`.sb-head` `position:relative;z-index:236` 抬到顶带之上,no-drag 钮赢回顶边;只抬头不抬
  整个 `.sb`(免造层叠上下文困住挂 body 的浮层)。拖窗仍走 sb-head 空白处。门=`e2e/immersive.spec.js`
  「图标钮顶边归钮不归拖拽条」(elementFromPoint 真实层叠判定+变异自检)。
- **peek 期间页面是冻结帧**(快照垫底的固有取舍):页面里的视频/动图在 peek 打开期间不动,
  收回即恢复;peek 是瞬态交互,可接受。
- ~~红绿灯与 peek 悬浮卡的相对位置~~:07-21 的 (24,22) 瞬移案已被 **2026-07-22 DOM 假灯终解取代**
  (瞬移案的灯在卡片滑入/滑出动画期间悬空浮在内容上——Wendi「灯不在卡片上」;见行为契约「peek 浮卡
  的红绿灯 = DOM 假灯」)。`ws-window-buttons` 的 pos 参数保留作兜底,peek 不再调用。
- **红绿灯可见性无 e2e**:setWindowButtonVisibility 无公开 getter,CI 又是 linux(is-mac 分支不跑),
  只有宿主探针(窗高==内容高)+目验兜着。
- ~~全屏+收起找不到关闭钮~~:已解(Colin 2026-07-22 抓的死胡同,解法两迭代)——收起态的
  `setWindowButtonVisibility(false)` 连带压掉 macOS 全屏顶栏下拉里的灯。一版「进全屏强制恢复原生灯」
  被否(与 peek 卡假灯撞出**重复灯**);终案(Colin 拍板):顶栏下拉**不放灯**,watcher 加**全屏顶缘
  唤出带**(`FS_TOP=8`,全宽)——全屏推顶=macOS 顶栏下拉 + **侧栏 peek 同步滑出**,关闭钮只活在
  卡上的假灯,单一来源不重复。非全屏不做顶缘触发(窗顶那条是拖拽带,会打架)。
  **灯常驻拍板(Colin 2026-07-22)**:非全屏收起态灯保持隐藏(Wendi 零缝隙原则),发现性由
  左上角触发区接住(鼠标怼左上角=peek 卡带灯滑出);「灯常驻钉窗角」案被否——会悬浮在内容纸上,
  且破 Wendi 原始诉求(真要走那条先问 Wendi)。几何=edge-zones 单测;整链宿主目验。
- **.sb-head 加图标要重算账**:is-mac 下 让位 70+右 6+6×26+gap 6 = 238 ≤ min-width 240,余量 2px
  (shell.css 注释同款警示,ui-demo .arc-top 处也有一条)。
