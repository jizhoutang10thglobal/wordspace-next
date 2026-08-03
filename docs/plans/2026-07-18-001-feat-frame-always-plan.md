# feat: 10px 沉浸窗框扩到非全屏恒有(展开态也要,只有真全屏没有)

> status: active · origin: Colin 2026-07-18 拍板(「不仅收起态,不收起也要有!只要不是全屏就要有」,对 #271 的扩展) · 基线 main@7a6adf1 · 日期 2026-07-18

## 现状与目标

#271 给**收起态**做了 Arc 式窗框:`body.is-sb-collapsed` 驱动三件套——chrome 底色、`#main{margin:10px;border:1px;radius;overflow:clip}`(内容=一块纸)、三条 fixed drag 边带 `.win-frame-*` + 左缘可见热区 `.sb-edge-hot`(shell.css ≈:314-341;DOM=index.html:110-112;类开关=sidebar.js ≈:2654)。**展开态没有窗框**;**全屏也有窗框**(spec 欠账已记「全屏窗框」)。

目标(Colin 拍板):**窗框=非全屏恒有**。展开态:侧栏保持贴左缘(侧栏本身就是左侧 chrome,Arc 同款),`#main` 四周 10px(左 10px=与侧栏的缝),top/right/bottom 边带照常 drag;收起态维持 #271 现状;**真全屏(macOS enter-full-screen)两种态都无框**——但收起态的 peek 触发热区在全屏下要保留(变透明即可,别把重开侧栏的路堵死)。

## 关键决策

- **KD1 展开态侧栏贴边,不给左带**:Arc 的形态就是侧栏=左侧 chrome、内容卡片被 padding 包;左缘 pad 掉侧栏会让原生红绿灯(hiddenInset 固定窗坐标)骑在边带上,不冒这个险。左带 `.sb-edge-hot` 仍只在收起态(peek 锚点)。
- **KD2 状态建模**:新 body 类 `is-win-fullscreen`,主进程 `win.on('enter-full-screen'/'leave-full-screen')` → `webContents.send` → preload 暴露 → renderer 挂/摘类;**启动初值**也要对(boot 时 `win.isFullScreen()` 随现有启动握手带给 renderer,或 renderer 主动查一次)。CSS 全部以「`body:not(.is-win-fullscreen)`+态类」组合表达,别写两份。
- **KD3 网页 view 零主进程改动**:bounds 是 renderer 量 `#main.getBoundingClientRect()` 传的(browser.js:111 → preload webShow(key,bounds)),margin 变化自动传导;只需确认展开↔全屏切换时既有的 resize/refit 路径会重新量一次(全屏切换必触发窗口 resize → 应已覆盖,e2e 里断言兜底)。
- **KD4 ui-demo 同步**:现状 `.ws-body.is-immersive{padding:10px}`+`.ws-main` 卡(App.css ≈:22-34)。改为:卡片样式(border/radius/clip+margin)非全屏恒有——展开态 `.ws-main` 上/right/bottom 10px+左距侧栏 10px,`.arc-sidebar` 贴边;ui-demo 是网页无 OS 全屏概念,**不做全屏例外**(spec 记有意分歧)。`.is-immersive` 类保留驱动收起态特有部分(edge-hot/peek)。
- **KD5 drag 边带在展开态的顶带横跨全宽**(含侧栏顶 10px):侧栏头部本来就是 drag 区(shell.css:292),不冲突;红绿灯是原生层,DOM z 不影响。

## 实现单元

### U1. 真 app:窗框非全屏恒有 + 全屏类

- **Files**:`src/renderer/shell.css`、`src/renderer/sidebar.js`(或 shell.js,挂类的位置就近现有 is-sb-collapsed 逻辑)、`src/main/main.js`(全屏事件)、`src/renderer/preload.js`(事件通道)、`src/renderer/index.html`(若边带 DOM 需微调)。
- **Approach**:①CSS 重组:把 #271 的 `body.is-sb-collapsed` 窗框规则改为 `body:not(.is-win-fullscreen)` 恒有(bg-chrome/#main margin+border+radius+clip/三条 win-frame drag 带);`.sb-edge-hot` 仍限收起态,但全屏+收起时保留一条**透明** 10px 热区(hover 不加深,peek 照常触发)。②主进程全屏事件+启动初值+preload 通道+renderer 挂 `is-win-fullscreen`。③收起态视觉/行为与 #271 完全一致(回归零变化);peek 的 `-103% - 10px` 位移等不动。
- **Patterns**:#271 的窗框 CSS 块(shell.css ≈:314-341)、appearance 的 main→renderer 广播管线(主题三态那套)。
- **Test scenarios**(扩 `e2e/immersive.spec.js`,挨着 #271 的窗框几何测试):
  1. **展开态窗框**:启动(侧栏展开)→ `#main` computed margin=10px 四向、border 1px、radius>0;`.win-frame-top/right/bottom` 可见且 `-webkit-app-region:drag`(computed);`.sb-edge-hot` 不存在/不可见;侧栏 `getBoundingClientRect().left===0`(贴边,KD1)。
  2. **全屏无框**:`app.evaluate` 真 `win.setFullScreen(true)` 等事件回来(CI xvfb 若事件不可靠,fallback 直接挂类断 CSS 语义,真事件链宿主验)→ `#main` margin=0、border 0、win-frame 全 hidden;收起态下全屏 → edge-hot 仍在(透明)且 hover 能触发 peek;退全屏恢复。
  3. **收起态回归**:#271 既有窗框断言原样全绿(margin/drag/左带可见性),不许动其断言值。
  4. **网页标签几何**:展开态开网页标签 → view bounds 与 `#main` 矩形一致(x≈侧栏宽+10,y=10;既有 browser.spec 沉浸测试的量法)。
- **Execution note**:改 CSS 前先跑一遍 #271 既有 immersive/browser 沉浸测试记基线;**变异自检(先 commit)**:把「恒有」选择器改回 `.is-sb-collapsed` → 场景 1 红;把全屏类接线摘掉 → 场景 2 红;各自还原绿。

### U2. ui-demo 同步

- **Files**:`ui-demo/src/App.css`(±ArcSidebar.css)、`ui-demo/scripts/test-immersive.mjs`(11 断言门,补展开态断言)。
- **Approach**:KD4;视觉与真 app 同构(展开=侧栏贴边+卡片 10px 缝)。跑 `test-immersive.mjs` 门+其变异自检;ui-demo 无 e2e 基建,视觉靠 vite 起本地截图眼验一张(交给 Colin/Wendi 的证据)。

### U3. spec + 账本(同 PR,铁律)

- **Files**:`docs/features/immersive-collapse.md`——窗框契约改「非全屏恒有」(展开/收起两态一致),欠账「全屏窗框」划掉换成已实现语义;ui-demo 无全屏例外记有意分歧;「收起态不可拖窗」已在 #271 划掉、本次补「展开态边带也可拖窗」一句。
- **Test expectation: none**——纯文档。

## Scope boundaries

- 不动 peek 机制/快照覆盖/触发路径(#271 ②③ 原样)。
- 不动窗框视觉参数(10px/颜色/圆角)——Wendi 还要过目 #271 的初稿,本次只扩适用范围。
- Windows/Linux 不特调(frame 行为同 mac,drag 边带跨平台同 CSS;真机验证只做 mac)。

## 验收

- 全部新旧 immersive/browser 沉浸 e2e 绿 + 两处变异自检红/绿;node:test 全绿;动 shell.css/sidebar.js 共享面 → 本地 `npm run test:e2e:dot` 全量兜底;真机眼验截图(展开框/收起框/全屏无框三张);spec 同 PR;PR 引用本 plan + Colin 拍板语录。
