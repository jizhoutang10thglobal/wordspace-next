# 浏览器（标签上网 / 收藏 / 历史 / 右键菜单）—— 对齐 spec

> **正本在 [`../browser-feature-spec.md`](../browser-feature-spec.md)**（本模式的先例，留在原位；
> 完整规格：每功能三层 = 交互契约 → ui-demo 参考实现 → 真 app 后端设计）。
> 本文件是 features/ 注册表里的**薄指针**——防两份规格漂移（本仓防漂移教训：绝不写变体）。
> 改浏览器行为 → 改正本；本文件只维护锚点与欠账。

## 行为契约

见正本 §1–§9：心智模型、数据模型、侧栏布局（收藏折叠区在置顶上方）、地址栏+自动补全、
标签系统、⌘T 新建 modal、起始页、**网页态无网页头**、页内查找、缩放、右键菜单六分节、
历史、收藏管理页 + Netscape 互通、设置、normalize/resolve 管线、快捷键全表、会话恢复。
六项拍板结果（默认引擎 Bing / 删主页设置 / 点收藏聚焦已开 / 折叠态持久化 / 新标签瓦片取书签栏 /
导入重名文件夹加后缀不合并）在正本 §13。

## 文件映射

| 子模块 | ui-demo | 真 app |
|---|---|---|
| 交互总览 | 见正本 §16 源码索引 | 下面各行 |
| view 生命周期/安全边界/原生右键/导航事件 | mock（§13 差异表） | `src/main/web-tabs.js` |
| IPC 面 + 导入导出对话框 | 无 | `src/main/browser-ipc.js`（spec §10.3） |
| 收藏/历史/设置持久化 | zustand persist | `src/main/browser-store.js`（`userData/browser-*.json`，防抖原子写） |
| 收藏纯逻辑 + Netscape 互通 | `ui-demo/src/mock/bookmarks.ts` | `src/lib/bookmarks.js` |
| 历史纯逻辑（60s 合并/cap500） | `ui-demo/src/mock/history.ts` | `src/lib/web-history.js` |
| 右键菜单 builder（双胞胎） | `ui-demo/src/lib/webCtxMenu.ts` | `src/lib/web-context-menu.js` |
| 下载（正本 §4.11，2026-07-17 恢复） | `ui-demo/src/mock/downloads.ts`（记录+假进度引擎）+ `ui-demo/src/lib/downloads.ts`（纯逻辑，移植整体搬）+ `DownloadsPopover.tsx` + `ArcSidebar.tsx` 入口 | `src/lib/downloads.js`（纯逻辑+文件名清洗）+ `src/main/web-tabs.js`（`will-download` 引擎/命名管线/未提交 url 回滚/`dl*` 动作）+ `src/main/browser-store.js`（downloads 第四 cell）+ `src/main/browser-ipc.js`（`dl-*` 通道）+ `src/renderer/browser.js`+`browser.css`+`index.html`（进度环/popover）+ `src/lib/web-context-menu.js`（右键双胞胎）；测试 `test/downloads.test.js` + `e2e/web-downloads.spec.js` |
| omnibox 输入判定 / 引擎表 | `ui-demo/src/mock/browser.ts` / `browserSettings.ts` | `src/lib/url-input.js` + `tld-set.js` / `search-engines.js` |
| 决策纯逻辑（权限/scheme/缩放步进） | 散在组件里 | `src/lib/web-tabs-policy.js` |
| 标签模型的 web 身份类 | `ui-demo/src/mock/store.ts` | `src/lib/tabs.js`（`web:` 前缀 / updateEntry / 关闭栈） |
| 侧栏导航条/omnibox/收藏区/起始页/历史页/收藏页/设置页/查找条 | `ArcSidebar/WebView/NewTab/HistoryPage/BookmarksPage/Settings` | `src/renderer/browser.js` + `browser.css` + `index.html`（DOM）+ `sidebar.js`/`shell.js` 接线 |
| 测试 | —— | `test/{bookmarks,web-history,web-context-menu,web-tabs-policy,url-input,tabs}.test.js` + `e2e/browser.spec.js`（本地 http server 真加载 + attach/bounds/像素三件套强断言） |
| 默认浏览器（系统集成,正本 §10.6） | 无（网页 mock 没有系统集成面） | `package.json` `build.protocols`/`fileAssociations` + `src/main/main.js`（open-url 路由/冷启动队列/WS2_OPEN_URL seam）+ `src/main/browser-ipc.js`（set-default IPC）+ `src/renderer/browser.js`（设置页行）+ `e2e/default-browser.spec.js` + `test/default-browser-config.test.js` |

## 有意分歧

见正本 §13「刻意差异表」（mock 渲染方式 / DOM vs 原生菜单 / 缩放全局 vs 每标签 /
关标签焦点 / 历史触发点 / favicon / 默认引擎 glass vs Bing / 新标签瓦片演示位 vs 书签栏前 N /
normalize TLD 真验证 / 权限 default-deny 白名单 / ⌘/ 面板暂缺 / **下载 mock vs 真下载**（假进度+
无真落盘+访达=演示 toast，2026-07-17）），
均为拍板差异，日期与拍板人在正本 §15 决策日志。不在该表里的行为差异都算漂移。
另：**默认浏览器为真 app 独有**（正本 §10.6，2026-07-13）——ui-demo 不移植，不算漂移。

另：**空态「打开文件夹」CTA**（Wendi 2026-07-15）位置已挪到侧栏最底（正本 §3.1）。真 app 是带按钮的 `#sb-empty`；
ui-demo 空态是 Library 底部纯文字 `arc-lib-empty`（无按钮）——**记有意分歧、不算漂移**。三栏折叠（收藏/置顶/标签页）
两侧已同步（正本 §3.1/§4.4），不是分歧。

## 对齐锚点

- ui-demo 侧：PR #150 合入 main 的 commit（2026-07-10，正本定稿 + 六项拍板落地）
- 2026-07-17 **下载（标准档）ui-demo 定稿**（分支 `feat/ui-demo-downloads`，正本 §4.11/§12/§13/§15
  同 PR 还账）：mock 站触发点/工具栏进度环/popover/右键存储/toast 三连/持久化记录全套；
  门 = `ui-demo/scripts/test-downloads.mjs`（含变异自检记录）。真 app 侧未动，欠账见下。
- app 侧：`feat/browser-port` 分支（2026-07-11，按正本 §14 验收清单全量移植；合 main 后以 merge commit 为准）
- 2026-07-13 收藏区 header 重样式（栏标化 + 对齐网格，正本 §4.3 已更新，Wendi「视觉乱」反馈）：
  ui-demo PR #170 + app PR `fix/app-sidebar-fav-align`，两侧同步落地，此项无欠账。
- 2026-07-17 **收藏区栏标补 uppercase**（Colin 英文界面真机抓到：`Bookmarks` 混排、PINNED/TABS/FILES
  全大写）：`.sb-fav-label` 抄了 `.sb-sec-label` 配方（等宽/fs-xs/semibold/tracking-label/text-3）却漏
  `text-transform: uppercase`——中文下隐形，i18n 英文一开就穿帮。app PR `fix/sidebar-fav-uppercase`；
  配 e2e 一致性门 `e2e/sidebar-typography.spec.js`（computed style 比对收藏头 vs 全部区块头 + 锚死
  uppercase，任何一侧再漂移即翻红）。栏标规范正本在 `docs/style.md`「分区栏标」。
- 2026-07-17 **置顶/标签页计数对齐**（Colin 真机抓到：计数比栏标上浮 ~2.5px、间距 14px vs 收藏行
  6px）：根因是移植时栏标拆成带不对称 padding 的子 span（ui-demo 里栏标 class 就在行容器上、天然
  不错位）。app PR `fix/app-zone-count-align`：padding 上移 `.sb-zone-head`、label 归零、caret 边距
  归容器；正本 §4.3「对齐网格」补计数同线+6px 契约；几何门进 `sidebar-typography.spec.js`（Range 量
  纯文字矩形：同行中线/全侧栏间距/左缘三不变式）。**ui-demo 无此病、零改动**，此项无欠账。
- 2026-07-17 **收藏管理入口改常显**（Wendi「与标签页『+』统一」+ Colin 拍板「都一直出现」，推翻 07-13
  hover 才显）：`browser.css .sb-fav-manage` / ui-demo `ArcSidebar.css`，两侧同一 PR 落地，正本 §4.3/§14/§15。
- 2026-07-14 **User-Agent 归一（反 CAPTCHA）**：app PR `fix/browser-ua`（Wendi「网页搜索总弹人机验证」）。
  正本 §11.7 记契约；`web-tabs.js` `ensureSession` + `web-tabs-policy.js` `browserUA()`。真 app 独有
  （ui-demo 是 iframe mock、无 Electron session，不移植、不算漂移）。
- 2026-07-14 **错误页恢复（P1，探索测试 p1）**：加载失败后换好网址 / 导航条 reload 能真恢复 view（此前
  已提交过的标签失败后是死路——占位卡死、view 脱挂,只有切标签靠 activate 复活）。正本 §10.2 已更新
  （`did-fail-load` 占位行 + `did-navigate` 的 `navSeq` 提交序号 + 收尾≠提交说明）；app PR
  `fix/browser-error-page-recover`（`web-tabs.js` 加 navSeq、`browser.js onWebTabUpdated` 补提交沿恢复分支）。
  真 app 独有（ui-demo iframe mock 无 WebContentsView attach/detach，不移植、不算漂移）。
- 2026-07-18 **下载真 app 移植落地（标准档，`feat/app-browser-downloads`，U1–U6）**：正本 §4.11 契约全量
  落地——`will-download` 真接 `DownloadItem`（`setSavePath` 锁系统「下载」文件夹 + 对真磁盘 uniquify + 文件名
  清洗 §11.5 + 进度节流推 renderer）替掉旧 cancel+toast；工具栏进度环 + popover（注册 `.dlp-overlay` 进
  `OVERLAY_SEL` 摘 view + veil/Esc 关，见正本 §13 实现修正）；「在访达中显示」= `shell.showItemInFolder`
  （只定位）；原生右键双胞胎 `save-link`/`save-image`（`web-context-menu.js`，与 ui-demo `webCtxMenu.ts` 同构）；
  未提交 url 回滚修「地址栏敲下载 URL → 重启静默重下」雷（P4）；下载记录 = browser-store 第四 cell
  （`browser-downloads.json`，load-sanitize 翻 `interrupted`）。门：`test/downloads.test.js` +
  `test/browser-store.test.js`（node:test）+ `e2e/web-downloads.spec.js`（8 条真下载：字节完整/uniquify/取消
  无残留/P4 重启不重下/重启中断/popover/进度环着色/收起态 toast，含变异自检两探针=打掉 uniquify 翻红 U2、
  打掉回滚翻红 P4）+ `e2e/browser.spec.js` 安全不变式改真下载落盘（读真磁盘字节）+ 右键 probe 补 save-link；
  测试产物走 `WS2_DL_DIR`=tmpdir 零落盘。navSeq 提交沿契约与下载触发的 `-3 ERR_ABORTED` 已由
  `e2e/browser.spec.js`「P1 恢复不误触发」再验证（下载中止型导航不动错误页/恢复逻辑）。真 app 独有的后端
  （ui-demo 是 mock 假进度，见 §13 差异表）。⚠ 本条里「popover 注册 `.dlp-overlay` 进 `OVERLAY_SEL` 摘 view」
  **已被 2026-07-20 打磨推翻**（改锁侧栏宽不摘 view），见下条。
- 2026-07-20 **下载 UX 真机反馈打磨（标准档，`fix/downloads-ux-polish`，Colin 真机三点）**，两侧同步：
  ① **popover 锁进侧栏宽度、不覆盖网页区**：`anchorPos` 读 `#sidebar` rect 锁宽（`left=sb.left+8`/`width=sb.width-16`），
  `.dlp-overlay` 从 `OVERLAY_SEL` 拿掉 → 不再摘原生 view，**连带根拔「快速开关 popover→`webHideAll` 竞态」**
  （原对抗审查 P2）；关闭三管 veil+Esc+图标 toggle；`window blur` spike 实证不 fire（不用）。ui-demo 同步锁
  `.arc-sidebar` 宽。② **toast 改小、侧栏开着不顶网页**：主进程删 3 处 `web-toast` 发送，renderer 从
  `downloads-changed` 状态迁移 diff 派生 toast（首帧只建基线、同迁移只发一次）；侧栏开=侧栏内紧凑 `.dl-toast`
  （不调 `webToastInset`），收起=over-web 兜底。③ **completed 加「打开」按钮**：`web-tabs.js dlOpen`
  （`existsSync? shell.openPath : missing`，**用户手动打开 ≠ §11.5 自动打开红线**）+ `browser-ipc dl-open` +
  preload `dlOpen` + `buildActs` 放「在访达中显示」前 + i18n `browser.dlOpen` 双语。门：node:test 760 + i18n 三门
  + `e2e/web-downloads.spec.js`（改 popover 用例=删摘 view 断言、加锁侧栏宽断言；加「打开」e2e + 侧栏开着 toast
  e2e=view bounds 无 72px inset；变异探针④=打掉 dlOpen 的 `shell.openPath` 翻红）；ui-demo `i18n:scan` 三门 +
  vite build + 亮/暗手验（popover 不盖内容、开按钮、toast 小；暗态像素解码）。正本 §4.11/§13 落地细则 #1/#4 同 PR 更新。

## bug-hunt 修复批（2026-07-15，探索测试 `docs/plans/bug-hunt-2026-07-14/`）

- **P3-11 收藏容量语义**：无条数上限；收藏变更推 renderer 改 leading-edge 防抖合并
  （`browser-store.subscribe`/`notify`，`browser-ipc` 订阅驱动，替掉每次变更的显式 `pushBookmarks`）。
  正本 §2.2 容量语义已更新。门 `test/browser-store.test.js`。
- **P3-10 导入同名同内容文件夹跳过**（温和修正）：`bookmarks.js` `importNetscape` 名同+url 集合相等→跳过不造副本，
  「导出→原样导回」零翻倍。正本 §4.9/§13#6/§15。门 `test/bookmarks.test.js`。
- **P3-09 手动建/改文件夹撞名加后缀**：`bookmarks.js` `addFolder`/`renameFolder` 复用 `uniqueName`，与导入同口径。
  正本 §4.9。门 `test/bookmarks.test.js`。
- **P2-4 含冒号词组落搜索**：`url-input.js` 收窄 opaque scheme 拦截为已知危险名单，`note:hello` 等落搜索。
  正本 §5。门 `test/url-input.test.js` + `e2e/browser.spec.js`。
- **P2-3 切标签复位地址栏**：`browser.js` `syncChrome` 按 key 变化强制结束打字态、丢弃未提交输入（守住原守卫）。
  正本 §4.2。门 `e2e/browser.spec.js`。
- **P3-01 死收藏星标**：`browser.css` `[hidden]` 防御清单补 `.sb-omni-star`/`.web-nt-pins`/`.wp-search-x`
  （display:flex 压过 UA `[hidden]` 的同款隐患一并补）。门 `e2e/browser.spec.js`。
- **P3-02 置顶标签保留关闭钮**（Colin 拍板方案 B，纯 docs）：正本 §4.4/§13/§15 记「置顶有×=取消置顶并移除，⌘W 仍守置顶」。

## Wendi 2026-07-15 反馈批（plan `docs/plans/2026-07-15-001-fix-wendi-feedback-sidebar-browser-plan.md`）

- **U4 ⌘\ 切换侧栏——全焦点可发现**：新增「视图」应用菜单加速器作**主通道**（`main.js buildMenu` 新增「视图」子菜单 →
  `sendMenu('toggle-sidebar')` → `shell.js onMenu` → `sidebar.js __sbHooks.toggleSidebar`）。菜单加速器覆盖**全焦点域**
  ——尤其**文档编辑 iframe 内的原失灵域**（keydown 不冒泡出 iframe，原来只能靠主层 keydown 兜、兜不到，这是 Wendi 报的 bug）。
  保留 `sidebar.js` 主层 `document` keydown 作**主层 fallback**（macOS 真实按键被原生菜单先吃、这条不触发=不与菜单双触发；
  只有绕过原生菜单的 CDP 注入 / 菜单未覆盖平台域才落它——现有 `page.keyboard.press('Control+\\')` e2e 靠它）。
  **删掉** `web-tabs.js shortcutOf` 的 `'\\'→'toggle-sidebar'` 转发 + `browser.js onWebShortcut` 接收端——web view 焦点下
  `before-input` 与菜单加速器是两层、会**真**双触发（切两次=no-op），主层 keydown 不同故留。正本 §7 已补「全焦点」契约。
  门 `e2e/tabs.spec.js`（UX-U4，menu 路由 + iframe 聚焦回归）+ 既有 `workspace.spec.js`/`sidebar.spec.js`（keydown fallback）。
- **U5 ⌘R 刷新网页标签**：自建菜单替换了默认 `View>Reload`，此处「视图」菜单显式给回 → `sendMenu('reload')`；
  `browser.js __webMenu` 网页态 → `navReload.click()`（复用导航条按钮 disabled 守卫：起始页 url=null → no-op）；
  **文档标签有意 no-op**（`shell.js onMenu` 无 reload 分支，防未保存编辑丢失，§2 拍板）。正本 §7 新增 ⌘R 行。
  门 `e2e/browser.spec.js`（U5 web 刷新=`/rl` 路由 server 命中+1 强断言 + 无目标不炸）+ `e2e/tabs.spec.js`（UX-U5 文档 no-op=易失标记存活）。

## Wendi 2026-07-16 反馈：弹层期间背景保住网页内容（快照垫底）

- **原契约不变**：DOM 弹层（更新面板/⌘T/保存/⌘P/AI 接入，`OVERLAY_SEL`）出现时摘掉原生 view
  （Electron 里 WebContentsView 恒在 HTML 层之上，不摘弹层被网页盖住），关弹层挂回。
- **新增**：摘 view **之前**先对 view 自己的 webContents 截一帧（窗口级 capturePage 不合成子 view，
  实测恒白），垫在弹层下（`.web-snap`，z=390 < 弹层 400，pointer-events:none）——弹层背景是冻结的
  页面快照而非空态底（Wendi「更新的时候背景变白，按说应该 keep the tab content」）。快照垫好（或
  250ms 超时/截图失败放弃，退回素底）才摘 view，弹层绝不被截图卡住；关弹层 `webShow` 挂回后下两帧
  撤图（不闪素底；引用局部化防迟到撤图误删下一个弹层的新快照）。
- 链路：`web-tabs.js capture(key)` → `browser-ipc.js webtab-capture` → `preload.js webCapture` →
  `browser.js` OVERLAY_SEL 守卫（一处改，全部弹层受益）。ui-demo 无原生 view 分层问题，弹层天然
  盖在内容上——**无需对齐，无漂移**。
- 门：`e2e/browser.spec.js`「弹层摘 view 垫页面快照」（Wendi 原路径：手动检查更新→available 弹面板；
  断快照非空 data 图+几何盖内容区+view 真摘；关弹层快照撤掉+像素级红底回屏）。变异自检过
  （capture 恒 null → 翻红）。
- 已知边界：弹层开着时拖窗口改尺寸，快照不跟随重拍（静态帧，罕见路径）；快照是冻结帧，页面里的
  视频/动图在弹层期间不动（可接受，弹层本就阻断交互）。

## 欠账

- **下载 toast 的 action/tone + 启动 interrupted 计数条**（U6 记账，非阻塞降级）：真 app 下载 toast 现由 renderer
  从 `downloads-changed` 状态迁移 diff 派生（2026-07-20 打磨，替换原主进程 `web-toast` 单字符串通道），仍是
  **纯文案** = 无正本 §4.11 的可点「显示」action / danger tone；启动时「N 个下载被转 interrupted」的 neutral
  计数条未做（load-sanitize 静默翻转）。进度环 + popover 入口常显兜底，用户仍可一键点开。要补需扩 toast 通道
  带 action/tone（正本 §13 落地细则 4/5 已记降级）。**下载主体 U1–U6 已落地，见上
  「对齐锚点」2026-07-18 条**。
- **打包冒烟 / Windows 未验**（正本 §13「仍开放」；dev 态 mac 全绿，签名打包后的 WebContentsView/
  持久化路径未实测）。
- **默认浏览器仅 macOS**（正本 §10.6）：Windows/Linux 未做（Win 要安装器注册表 + `second-instance`
  argv 的 URL 解析，现只解析文件路径）。plist 声明已在本地未签名包字节级实证（CFBundleURLTypes
  http/https）；**签名发版后需真机闭环**：装新版 → 系统设置把默认浏览器切成 Wordspace → 从别的 app
  点链接验热/冷两路。
- **⌘/ 快捷键面板**：ui-demo 有（`ShortcutsPanel.tsx`）、真 app 暂无（快捷键可发现性的第三档，未拍板。
  前两档已做：简洁 tooltip + 教学气泡，见正本 §7「可发现性两档」；ui-demo 定稿 PR #227、真 app 同步移植）。
- **U4/U5 菜单加速器的 web view 焦点跨平台假设**（2026-07-15 对抗审查记账，非阻塞）：⌘\/⌘R 在**网页标签聚焦**时
  能生效，依赖「原生应用菜单加速器在焦点落在子 `WebContentsView` 上时也触发」。此点仅 macOS 已由 ⌘W（菜单加速器、
  不转发、浏览时能关标签）间接实证；**Windows/Linux 未验**（本 feature 整体 Windows 未验，见上「打包冒烟」）。U4 删了
  跨平台的 `before-input` 转发后，web 焦点下无 fallback——若某平台原生加速器够不到聚焦的子 view，⌘\/⌘R 在浏览时会失灵。
  主层/文档 iframe 焦点不受影响（走主窗口菜单，且 ⌘\ 有主层 keydown fallback）。真机闭环验放到 Windows 打包冒烟一并做。
- **错误恢复与弹层并发**（对抗审查记账，非阻塞，极窄路径）：错误页恢复导航**加载期间**打开 ⌘P/⌘T 弹层,
  提交推到时 view 会短暂盖在弹层上——与上方 everCommitted 起始页分支同款既有盲点（弹层观察器在 view 脱挂时
  `attachedKey=null` 不触发暂停）,弹层关掉即自愈。加 `!document.querySelector(OVERLAY_SEL)` 守卫会造出「弹层关掉
  后 attachedKey 仍 null → 卡死」的更差态,故不加、与既有分支保持一致。要根治得连弹层观察器 resume 一起改。
- **文档标签的后退/前进**：导航条按钮对文档标签恒灰——文档区导航历史是另一个 feature
  （ui-demo #146，尚未移植真 app），移植后接进 §4.1 的分派。
- **favicon 磁盘缓存**（正本 §10.4 的 `favicons/`）：现为内存 data:URL + 收藏落库时随存；
  重启后标签行 favicon 回落地球图标（视觉可接受），有需要再补磁盘缓存。
- **tld-set 快照有个别假 TLD**（如 `web`/`git` 未委派）：地址栏输 `foo.git` 会当网址走死路错误页
  而非搜索。tld-set 是刻意近似快照,正确修法是从 IANA 根区脚本重新生成,别手删（怕误删真 TLD）。
- **P3 图标/文案细节**（bug sweep 2026-07-12 记账,非阻塞）：补全下拉「开着的标签」图标应 Globe2 现 Globe；
  标签行 web 图标 Globe/14 应 Globe2/13；⌘⇧= 未触发放大（仅 ⌘=）；空地址栏回车应回起始页现 no-op。
  以及**每标签独立缩放**：Electron zoom 按 host 在 session 内传播（同站两标签互相带动、重启保留），
  真正隔离要给每标签独立 session,代价大,暂受此限（正本 §4.6/§13 的「每标签」是意图,实现有此约束）。

## bug sweep 记录（2026-07-12）

5 路对抗审查（主进程/renderer 状态机/sidebar-shell 集成/纯逻辑库/spec 契约漂移）+ Colin 实测报的
「加载中闪回文档」。修了 ~25 个确认项（含 6 个 P1，两路交叉确认的丢数据/状态分裂），
新增回归门（闪回真断言 + lib 7 条 + policy/tabs）。详见 commit `adf711d`→`b997c22`。

**续修（Wendi 2026-07-15）：「闪回旧网页」=导航期零反馈**。07-12 那次修的是透出**文档**（新 view 白/深底防闪回）；
Wendi 又报的是**原地导航时旧网页保留 1-2s 却没有加载指示**，误以为卡死。修法=Chrome-style 保留旧页 + 标签行 spinner
（`loading` 信号本就在推、renderer 补消费；正本 §4.1「导航加载期反馈」）。不是改导航时序，是补可见反馈。
