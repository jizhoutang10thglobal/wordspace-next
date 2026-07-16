# 沉浸收起(侧栏零缝隙) —— 对齐 spec

> 来源:Wendi 2026-07-16 对标 Arc 反馈(「他们的应用根本没有一点缝隙,所有的地方都可以隐藏,
> 我们的应用顶上和左边都有一条栏」)。Colin 拍板 **ui-demo-first**:本 spec 现状 = ui-demo 已实现、
> 真 app **未移植**(欠账段列全部移植硬活)。
>
> 两项拍板(Colin 2026-07-16):① 重开入口 = **纯 Arc 式**(左缘 hover peek + Cmd+\,零常驻可见 UI,
> 不留浮钮);② 沉浸范围 = **网页标签全隐、文档标签保留 52px 文档头**(文件名/保存有功能价值,
> 不算废边距;Wendi 的截图对比都是网页,痛点在网页标签)。

## 行为契约

**收起 = 沉浸**:侧栏收起后流内零渲染——没有 48px 细轨、没有常驻浮钮,内容区四边贴满窗口
(网页标签 = 页面即窗口;文档标签保留文档头)。

**重开三入口**:
1. **左缘 hover peek**(Arc 签名交互):鼠标滑到窗口最左缘(6px 热区)→ 完整侧栏以悬浮层滑出,
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

**假红绿灯随侧栏走**(ui-demo):红绿灯画在侧栏顶部,收起即消失、peek 时随层滑回——一比一预演
真 app hiddenInset 后的 Arc 行为。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 收起态渲染(零流内元素+热区+peek 容器) | `ui-demo/src/components/ArcSidebar.tsx`(collapsed 分支) | —(欠账:`src/renderer/shell.js` 侧栏已 width:0,但有 sb-reopen 浮钮要按拍板①删) |
| peek/热区样式与动效 | `ui-demo/src/components/ArcSidebar.css`(.arc-edge-hot/.arc-peek) | — |
| 快捷键 Cmd+\\ | `ArcSidebar.tsx` 全局 keydown(已有) | `src/renderer/shell.js`(已有) |
| 验证门 | `ui-demo/scripts/test-immersive.mjs`(10 断言,boundingBox/computed 强口径,变异自检过:回 48px 细轨 3 断言翻红) | —(欠账:e2e) |

## 有意分歧

- ui-demo 没有真窗框,「顶上那条栏」(macOS 标题栏)只能在真 app 解决——ui-demo 的假红绿灯在侧栏里,
  收起后整体消失,视觉上已等效终态。
- 文档头保留是拍板②的范围收窄,不是漏做;后续若 Wendi 要文档也全隐,再开「文档沉浸模式」单题。

## 对齐锚点

- ui-demo 侧:commit `a4b6703`(2026-07-16)
- app 侧:未移植(ui-demo-first,待 Wendi 目验定稿后按 `/align-feature` port)

## 欠账(真 app 移植硬活)

- **窗框**:`BrowserWindow` 加 `titleBarStyle: 'hiddenInset'` + `trafficLightPosition` 挪进侧栏顶
  (ui-demo 假红绿灯的位置);系统标题栏(「Wordspace Next」那条)消失,拖拽区改 `-webkit-app-region: drag`
  (侧栏顶/文档头);窗口标题文字仅留菜单栏。
- **红绿灯随收起隐藏**:收起 → `win.setWindowButtonVisibility(false)`,peek/展开恢复 true(Arc 同款)。
- **左条归零**:`src/renderer/browser.js` 的 `COLLAPSED_STRIP = 52` → 0(网页 view 贴 x=0);
  同时删 `.sb-reopen` 常驻浮钮(拍板①)。
- **⚠ 网页标签的 peek 硬点**:原生 WebContentsView 永远压在 DOM 之上,DOM 悬浮 peek 盖不到网页上。
  移植时要么 peek 期间临时 setBounds 推 view(有拖拽感/重排开销),要么侧栏 peek 用独立原生层实现,
  要么收起态网页下仅支持 Cmd+\\ 重开——**方案未定,移植前单独设计**(文档标签无此问题,DOM peek 直接可用)。
- 收起态窗口拖拽:hiddenInset + 全贴满后无可拖 DOM 区(网页标签下尤甚)——移植时定(Arc 同样牺牲了这个)。
- e2e:真 app 侧需要 Playwright-Electron 断言(view bounds x=0/红绿灯可见性),ui-demo 烟测口径可搬。
