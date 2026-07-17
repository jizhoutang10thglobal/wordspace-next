# 沉浸收起(侧栏零缝隙) —— 对齐 spec

> 来源:Wendi 2026-07-16 对标 Arc 反馈(「他们的应用根本没有一点缝隙,所有的地方都可以隐藏,
> 我们的应用顶上和左边都有一条栏」)。Colin 拍板 **ui-demo-first**;真 app 已移植,两侧同步演进
> (2026-07-17 起含 10px 窗框 + 网页 peek 快照垫底,Wendi 视频反馈三连修)。
>
> 两项拍板(Colin 2026-07-16):① 重开入口 = **纯 Arc 式**(左缘 hover peek + Cmd+\,零常驻可见 UI,
> 不留浮钮);② 沉浸范围 = **网页标签全隐、文档标签保留 52px 文档头**(文件名/保存有功能价值,
> 不算废边距;Wendi 的截图对比都是网页,痛点在网页标签)。

## 行为契约

**收起 = 沉浸**:侧栏收起后流内零渲染——没有 48px 细轨、没有常驻浮钮,内容区只隔一圈 10px
窗框(网页标签 = 页面即窗口;文档标签保留文档头)。

**10px 窗框带**(Wendi 2026-07-17 追加,解「peek 触发边界不可见」):收起态内容四周均匀内缩
10px,露出 chrome 色(`--c-bg-chrome`)边框带,内容区加 1px `--c-border` 细边 + `--r-md` 微圆角
(纸方:内容=一块纸)。**真 app 里这圈是 `-webkit-app-region: drag` 的窗口拖动区**(顺带解掉
「收起态窗口拖拽无处可拖」欠账);ui-demo 无真窗口,纯视觉。展开态不套窗框、不变。

**重开三入口**:
1. **左缘 hover peek**(Arc 签名交互):鼠标滑到左边框带(热区与 10px 左边框重合,触发区=整条
   左边框;hover 背景加深一档 `--c-hover` 做可见反馈,不发光)→ 完整侧栏以悬浮层滑出,
   **盖在内容上、不推挤布局**;移开(侧栏与热区之外)→ 滑回。进出各有小延迟(120ms/240ms 缓冲)
   防误触发/闪烁。悬浮层带右侧圆角 + 投影(纸方墨圆:悬浮层=墨)。
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

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 收起态渲染(零流内元素+热区+peek 容器) | `ui-demo/src/components/ArcSidebar.tsx`(collapsed 分支) | `src/renderer/index.html`(#sb-edge-hot,sb-reopen 已删)+ `src/renderer/sidebar.js`(peek 控制器) |
| peek/热区样式与动效 | `ui-demo/src/components/ArcSidebar.css`(.arc-edge-hot/.arc-peek) | `src/renderer/shell.css`(.sb-edge-hot / body.is-sb-peek .sb 变身,keyframes 入场不用 fill) |
| 收起态 10px 窗框 + 左带 hover 反馈 | `ui-demo/src/App.tsx`+`App.css`(.ws-body.is-immersive)+ `ArcSidebar.css`(.arc-edge-hot 10px/.arc-peek 内缩) | `shell.css`(body.is-sb-collapsed #main margin:10px + .win-frame 三条 drag 带)+ `index.html`(.win-frame-top/right/bottom);左带=#sb-edge-hot **不设 drag**(drag 区吞鼠标事件会哑掉 hover 触发) |
| 窗框(hiddenInset+红绿灯进侧栏头) | 假红绿灯画在侧栏(天然等效) | `src/main/main.js`(darwin-only titleBarStyle+trafficLightPosition)+ `shell.css`(.sb-head 拖拽区/is-mac 让位 70px+26px 钮凑 240 最小宽的账) |
| 红绿灯随收起隐/peek 现 | —(无真窗框) | `src/main/ipc.js` ws-window-buttons + `sidebar.js` 收起/peek 时机调用 |
| 网页 peek 快照垫底 | —(iframe 无此问题) | `src/renderer/browser.js` __webPeekSnap(截帧垫 .web-peek-snap、摘 view;250ms 超时/失败退回 peekPush 推让)+ `sidebar.js` openPeek 异步化(peekPending 取消旗) |
| 网页态左缘 hover 侦测 | —(DOM 直接收 mouse) | 同 DOM 一条路径——#main 内缩 10px 后左边带永远是 DOM 地盘,原主进程 ws-edge-watch 指针轮询**已删**(ipc.js/preload/browser.js 三处) |
| 快捷键 Cmd+\\ | `ArcSidebar.tsx` 全局 keydown(已有) | `src/renderer/sidebar.js`(菜单加速器主通道+keydown fallback,已有) |
| 验证门 | `ui-demo/scripts/test-immersive.mjs`(10 断言,boundingBox/computed 强口径,变异自检过:回 48px 细轨 3 断言翻红) | `e2e/immersive.spec.js`(3 门)+ `e2e/browser.spec.js` 贴零/推让门(变异自检:52px 条回植翻红)+ align/sidebar/tabs 三处旧断言改口 |

## 有意分歧

- ui-demo 没有真窗框,「顶上那条栏」(macOS 标题栏)只能在真 app 解决——ui-demo 的假红绿灯在侧栏里,
  收起后整体消失,视觉上已等效终态。
- 文档头保留是拍板②的范围收窄,不是漏做;后续若 Wendi 要文档也全隐,再开「文档沉浸模式」单题。

## 对齐锚点

- ui-demo 侧:PR #230(2026-07-16 合 main)
- app 侧:已移植(2026-07-16,分支 feat/immersive-collapse-app)。
- app 侧:分支 feat/immersive-frame-peek(2026-07-17,Wendi 视频反馈三连修)。**「同宽右移」定案已反转**:
  Wendi 拒绝内容被推(「挤过去又挤回很乱」)→ 改快照垫底(照更新弹窗白背景 #247 的 webCapture 方案):
  peek 滑出前对 view 截帧垫 .web-peek-snap、摘掉 view,页面视觉纹丝不动(Arc 同款);截图失败/超时
  250ms 退回推让。openPeek 因此异步化(peekPending 取消旗:截图在途鼠标已走就不滑出)。主进程指针
  watcher 同 PR 删除(窗框让左带永属 DOM,触发单一化)。

## 欠账(剩余)

- **Windows/Linux 窗框**:仍是标准系统标题栏(hiddenInset 为 darwin 专属;Windows 要
  `titleBarStyle:'hidden'`+`titleBarOverlay` 另做,顶上那条在 Win 上还在)。
- ~~收起态窗口拖拽~~:已解(2026-07-17)——10px 窗框 top/right/bottom 三条 drag 带,左带留给
  peek 触发(drag 吞鼠标事件,二者不能兼得);展开态可拖不变(.sb-head)。
- **全屏下窗框仍在**:Arc 在原生全屏+隐藏侧栏时收掉边框,我们 v1 未做全屏检测,全屏收起态四周
  仍有 10px 带;有反馈再做。
- **peek 期间页面是冻结帧**(快照垫底的固有取舍):页面里的视频/动图在 peek 打开期间不动,
  收回即恢复;peek 是瞬态交互,可接受。
- **红绿灯与 peek 悬浮卡的相对位置**:trafficLightPosition 定死 (14,14) 是窗口坐标,peek 卡内缩
  10px 后灯在卡内偏上 4px,视觉可用但非像素完美;要精调得动 trafficLightPosition(影响展开态),单独小题。
- **红绿灯可见性无 e2e**:setWindowButtonVisibility 无公开 getter,CI 又是 linux(is-mac 分支不跑),
  只有宿主探针(窗高==内容高)+目验兜着。
- **.sb-head 加图标要重算账**:is-mac 下 让位 70+右 6+6×26+gap 6 = 238 ≤ min-width 240,余量 2px
  (shell.css 注释同款警示,ui-demo .arc-top 处也有一条)。
