---
title: Wendi 2026-07-15 五条反馈——侧栏布局/折叠统一/导航加载反馈/⌘\/⌘R
status: active
date: 2026-07-15
origin:
  - Wendi Slack 反馈 2026-07-15 12:55-12:58（原话见 §1）+ 截图（空态 CTA 夹在收藏与置顶之间）
  - 代码勘察：2026-07-15 对 origin/main 的定点调查（本文全部 file:line 据此；实现时以现场为准）
  - 拍板：Colin 2026-07-15——折叠方向选「三栏都可折叠」（Wendi 原话给了两个方向）
---

# Wendi 反馈批次 2（U1-U5，只写不执行，交执行 session）

## 0. 一句话与执行纪律

五条独立修复：①空态「打开文件夹」挪到底部 ②收藏/置顶/标签页折叠统一（都可折叠）③网页导航期加载反馈（治「闪回旧页面」）④⌘\ 切侧栏全焦点可用+可发现 ⑤⌘R=刷新网页标签。每条一个 Unit，按 §5 的切分打包成 PR。

执行纪律（CLAUDE.md 硬规则，逐条适用）：开发迭代只跑受影响 spec（`npx playwright test e2e/<spec>.spec.js`）；动 `sidebar.js`/`shell.js`/`main.js` 属共享核心，推 PR 前本地 `npm run test:e2e:dot` 全量兜底；**改真 app UI/交互的 PR 必须同 PR 更新对应 feature spec**（每 Unit 已列清单）；变异自检先 commit 再变异。

## 1. Wendi 原话 → Unit 对照

| # | 原话 | Unit |
|---|---|---|
| W1 | 「没有打开文件夹的时候，这个打开文件夹怎么跑到收藏这里来了，应该放在下面」 | U1 |
| W2 | 「如果收藏有折叠，那么置顶和标签页都应该可以折叠才行。或者就都不折叠，必须统一」 | U2 |
| W3 | 「我用浏览器每打开一个新页面，渲染区都要跳转旧页面。那一两秒的缓冲好像有点问题」 | U3 |
| W4 | 「能不能加一个快捷键，隐藏/显示侧边栏」 | U4 |
| W5 | 「以及 Cmd+R 是刷新」 | U5 |

## 2. 已拍板决策（执行者不重开）

| 决策 | 结论 | 出处 |
|---|---|---|
| 折叠方向 | **三栏都可折叠**：置顶/标签页补收藏同款折叠（caret+localStorage 记忆+折叠时栏标带计数）；**置顶/标签页默认展开**（主导航，别一装就藏；收藏默认收起是既有拍板不动） | Colin 2026-07-15 |
| ui-demo 同步 | U1 无需改 ui-demo（其空态本在底部）；U2 **同步 ui-demo**（ArcSidebar 置顶/标签页段标加同款折叠，保持两侧折叠语言一致）；U3/U4/U5 为真 app 独有（mock 无真导航/无菜单），记有意分歧 | 勘察 B 节 |
| U3 方案 | **Chrome-style**：导航期间保留旧页面 + 明确的加载指示（标签行 spinner；不做全屏遮罩——快站会闪烁）。视觉细节以 Wendi 验收为准 | 本 plan（可验收调） |
| ⌘R 语义 | v1 只对**网页标签**生效（真刷新页面）；**文档标签 no-op**（防未保存编辑被重载吞掉）；不加 ⌘⇧R 强刷 | 本 plan |
| 快捷键实现通道 | ⌘\ 与 ⌘R 都走**应用菜单加速器**（菜单加速器在 iframe/网页/主层任何焦点都触发——`src/main/web-tabs.js:238` 注释已证）；顺带新增「视图」菜单让两者可发现 | 勘察 ④⑤ |

---

## 3. Implementation Units

### U1 · 空态「打开文件夹」挪到底部（S）

- **现状与根因**：空态 CTA = `#sb-empty`（`src/renderer/index.html:68-71`，提示文案 + `#sb-empty-open` 按钮），DOM 位置写死在 `#sb-fav`(53) 之后、`#sb-pinned`(73) 之前；侧栏 `#sb-body` 是块流布局（无 flex/order），DOM 顺序=视觉顺序 → CTA 夹在收藏和置顶之间。显隐由 `syncChrome()`（`src/renderer/sidebar.js:159-171`）控制：0 根显示、有根隐藏；0 根时树/筛选/文件段标全 hidden。
- **修法**：把 `#sb-empty` 整块移到 `#sb-tree`(86) 之后（`#sb-body` 末尾）。纯 DOM 顺序调整，`syncChrome`/按钮接线（`sidebar.js:2047` → `pickFolder`）零改。如视觉间距不对，`shell.css` 微调 `.sb-empty` margin。注意 `#sb-sticky`(67) 是绝对定位浮层不占流，不受影响。
- **Files**：`src/renderer/index.html`；（可能）`src/renderer/shell.css`；测试 `e2e/sidebar.spec.js`。
- **Spec 同步**：`docs/browser-feature-spec.md` §3.1 侧栏自上而下图 + 验收清单「侧栏自上而下=…」条；`docs/features/workspace-file-tree.md` 补一句空态 CTA 的位置描述（现完全未提，欠账补上）；ui-demo 只有文字无按钮（`ui-demo/src/components/ArcSidebar.tsx:760`）→ 在 `docs/features/browser.md` 有意分歧表记「app 有按钮、demo 纯文字」。
- **Test scenarios**：
  1. 0 根启动：`#sb-empty` 可见，且其 `boundingBox().y` 大于 `#sb-pinned` 和 `#sb-tabs` 的 y（视觉顺序断言——功能断言测不出布局，用坐标，doc-tabs 教训）。
  2. 0 根但有收藏+有网页置顶标签时同样成立（Wendi 截图正是此态）。
  3. 点「打开文件夹」→ 仍走 pickFolder 打开工作区（smoke，防挪动断接线）。
  4. 有根时 `#sb-empty` 隐藏（现状回归门）。
- **Verification**：截图对照 Wendi 原图场景（收藏 1 条 + 置顶 1 条 + 0 根），CTA 在最下。

### U2 · 三栏折叠统一——置顶/标签页补同款折叠（M）

- **现状与根因**：收藏折叠全套在 `src/renderer/browser.js:534-577`（`FAV_OPEN_KEY='ws-fav-open'` localStorage + `renderFav` 的 `is-open` toggle + `favHead.onclick` + 计数 `favCount`；caret 在 `index.html:61`，旋转 CSS `browser.css:105-106`）。置顶/标签页栏标由 `sidebar.js` `zoneHeader(text,onPlus)`（`sidebar.js:1977-1993`）渲染——无 caret、无状态、无交互；`renderZones()`（`sidebar.js:2003-2029`）每次全重建两区。
- **修法**：给 `zoneHeader` 增加折叠能力（caret span 抄 `index.html:61` 的 SVG + click 翻转），新 localStorage 键 `ws-pinned-open`/`ws-tabs-open`（**默认 '1' 展开**，与收藏默认收起相反——见 §2 拍板）；`renderZones` 每次**从 localStorage 读**折叠态（它全重建，内存变量会丢——勘察实证）决定是否渲染 zoneList + toggle `is-open`；折叠时栏标带计数（抄 `favCount` 体例）。保留「两区栏标恒显示」的既有设计（`sidebar.js:2000-2002` 注释）——折叠只藏列表不藏栏标。CSS 抄 `browser.css:105-106` 改 `.sb-zone` 域。**ui-demo 同步**：`ui-demo/src/components/ArcSidebar.tsx` 置顶(1218)/标签页(1221) 的 `arc-section-label` 加同款折叠（它的收藏折叠 1182-1193 连 localStorage 键名都和真 app 同套，照抄扩展）。
- **Files**：`src/renderer/sidebar.js`；`src/renderer/shell.css`；`ui-demo/src/components/ArcSidebar.tsx`（+其 css）；测试 `e2e/browser.spec.js` 或 `e2e/tabs.spec.js`。
- **Spec 同步**：`docs/browser-feature-spec.md` §4.3（现只写收藏折叠 200-223）+ §4.4 标签系统 + 验收清单「收藏(折叠…)/置顶/标签页」行改为三区折叠契约。
- **Test scenarios**（抄 `e2e/browser.spec.js:382-398` 收藏折叠门的套路）：
  1. 点「置顶」栏标 → 置顶列表隐藏、caret 态翻转、栏标出现计数；再点恢复。「标签页」同。
  2. 折叠态持久化：折叠标签页区 → 重启 app → 仍折叠（localStorage 键断言辅助，主断言 DOM）。
  3. 默认态：全新 userData 启动 → 置顶/标签页展开、收藏收起（三键默认值各自正确，别把收藏默认也改了）。
  4. 折叠时新开一个标签 → 计数 +1、**不**强制展开（与收藏折叠行为一致）。
  5. 收藏折叠现有 e2e 回归不破（同文件跑一遍）。
- **Verification**：三栏折叠交互/视觉一致（caret 同款、旋转同款、计数同款）；ui-demo 与真 app 行为一致。

### U3 · 网页导航期加载反馈——治「渲染区跳转旧页面 1-2 秒」（M，本批最大）

- **现状与根因**（勘察实证）：
  - **原地导航**（在网页标签上 omnibox 回车 `browser.js:475-496` submitOmni→submitNavigate、导航条刷新 `browser.js:346`）：同一个 WebContentsView 不摘，**旧页面持续绘制到 `did-navigate` 提交**（慢站 1-2s+），期间**零加载反馈**——这是 Wendi 感知「跳转旧页面/缓冲有问题」的主路径。
  - **起始页→真网页**是 07-12 有意设计（提交沿才切，`browser.js:244-247` everCommitted / `:254-272` navSeq），行为对标 Chrome、保留。
  - **loading 信号链齐备但 renderer 从不消费**：主进程 `did-start-loading/stop`（`src/main/web-tabs.js:172-173`）置 `rec.loading` 并 `pushUpdate`(75) 推来；`browser.js` 只把 `s.loading` 存进 webState(46)，全文无任何 loading UI 分支。
  - 新开标签路径（点收藏/瓦片 → `focusOrOpen:321-324` → openWeb → `activate:167-170` 立即 show 新 view）：新 view 是不透明白底（07-12 修法，回归门 `e2e/browser.spec.js:172-212`），理论上无旧页残留。
- **修法**：
  1. **执行第一步=复现矩阵**（defer 到执行时的 runtime 确认）：三条路径各自观察渲染区——(a) 网页标签上 omnibox 输新址 (b) 点收藏开新标签 (c) 起始页首航。确认「旧页面」出自哪条（预期主要是 a），如 (b) 也复现则回来加测并查 activate 时序。
  2. **消费 loading 信号**：`browser.js onWebTabUpdated`（`:244` 区块，已有 loading/everCommitted/navSeq 三信号在手）加分支——**任何** `s.loading` 为真的网页标签,其侧栏标签行加 `is-loading` 态（favicon 位变 spinner,CSS 动画进 `browser.css`;Chrome 语义:后台标签加载也转圈）;导航条刷新钮只对**激活**标签变加载态。提交（everCommitted/navSeq 沿）或 `did-stop-loading` 后撤。
  3. **保留旧页面**（Chrome-style，§2 拍板）：不做全屏遮罩、不动导航模型——用户看到旧页+明确的「正在加载」，1-2s 缓冲从「像 bug」变「像浏览器」。
  4. 可选小补（执行者判断）：`web-tabs.js nav()` 若无 `stop` action，补一行 `wc.stop()`,让加载态的刷新钮可变「停止」；工作量超预算就记 v2,只做 spinner。
- **Files**：`src/renderer/browser.js`；`src/renderer/browser.css`；`src/renderer/sidebar.js`（标签行 is-loading 渲染，视标签行归属而定）；（可选）`src/main/web-tabs.js`；测试 `e2e/browser.spec.js`。
- **Spec 同步**：`docs/browser-feature-spec.md` §4.1 刷新/导航 + §4.5「导航加载期显示什么」补契约；`docs/features/browser.md` 07-12「闪回文档」条追记「闪回旧网页=导航期反馈」续修。
- **Test scenarios**（扩「闪回文档回归门」`e2e/browser.spec.js:172-212` 的本地 http server 套路，给 server 加慢响应路由）：
  1. 网页标签上导航到慢站 → 加载开始后标签行 `is-loading` 可见（真实 DOM+像素级断言）、渲染区仍显示旧页（Chrome 语义回归门）、提交后 spinner 消失且新页上屏。
  2. 快站导航 → spinner 不闪烁成噪音（出现即可、无断言卡毫秒；或断言不留残留态）。
  3. 新开标签(点收藏) → 无旧页面内容出现（扩现有闪回门:像素断言渲染区非旧页内容）。
  4. **变异自检**（先 commit 再变异）：删掉 loading 消费分支 → 场景 1 的 spinner 断言必翻红。
- **Verification**：Wendi 场景真机走一遍——开 WhatsApp 再导航去慢站，感知从「卡在旧页像 bug」变「旧页+转圈,正常加载」。

### U4 · ⌘\ 切换侧栏——全焦点可用 + 菜单可发现（S）

- **现状与根因**：折叠实现已全（`sidebar.js:2296-2317`：`setSidebarCollapsed`/`toggleCollapsed`/`#sb-toggle`/`#sb-reopen`）。⌘\ 在两个焦点域已通：主层 `document` keydown（`sidebar.js:2311-2317`）+ 网页标签聚焦经 `web-tabs.js before-input-event` 白名单转发（`:267` `'\\'→'toggle-sidebar'`，renderer `browser.js:294` 接）。**失灵域=焦点在文档编辑 iframe `#doc-frame` 内**（keydown 不冒泡到父层，`shell.js` 挂在 iframe 上的 keydown `:350-362/:406-418` 不含 `\`）——Wendi 大概率在编辑文档时按的。另外应用菜单（`src/main/main.js buildMenu:130-172`）无侧栏项 → 不可发现。
- **修法**：`main.js buildMenu` 新增「视图」子菜单（与 U5 共用），加「切换侧栏 ⌘\」项 `accelerator:'CmdOrCtrl+\\'` → `sendMenu('toggle-sidebar')`；renderer 的 onMenu 路由表（`e2e/tabs.spec.js:110` UX2 证明 Cmd+W/T 已走此通道）加 `'toggle-sidebar'` → `toggleCollapsed()`。**菜单加速器覆盖一切焦点**（`web-tabs.js:238` 注释实证），iframe 失灵域被一次修掉；现有 document keydown 和 before-input-event 转发两条路径保留（冗余无害——菜单加速器优先吃掉按键,不会双触发,执行时验证一下再定去留）。
- **Files**：`src/main/main.js`；`src/renderer/sidebar.js` 或 onMenu 路由所在文件（执行时看现场，UX2 测试可定位）；测试 `e2e/tabs.spec.js`。
- **Spec 同步**：`docs/browser-feature-spec.md` §7 快捷键全表 ⌘\ 行补「全焦点（含文档编辑中）」契约。
- **Test scenarios**（抄 `e2e/tabs.spec.js:110` UX2 的 menu 路由范式）：
  1. 经 menu 事件触发 `toggle-sidebar` → 侧栏 `is-collapsed`、宽度变 0、`#sb-reopen` 出现;再触发恢复。
  2. **焦点在文档编辑器内**（点进正文后）触发 → 同样生效（原失灵域回归门）。
  3. 网页标签聚焦时按 ⌘\（既有转发路径）→ 不双触发（切一次不是两次；若菜单与转发抢,按修法注释处理后断言单次）。
- **Verification**：三个焦点域（主层/文档编辑/网页）⌘\ 都单次生效；菜单栏能看到「视图 → 切换侧栏」。

### U5 · ⌘R = 刷新当前网页标签（S）

- **现状与根因**：⌘R 现在全域 no-op——自建菜单（`main.js:130-172`）整体替换了 Electron 默认菜单,默认的危险 `View>Reload ⌘R`（重载整个 renderer）已不存在;`web-tabs.js shortcutOf`（`:259-275`）无 `r` 映射;shell/renderer 均不处理。刷新能力已存在但只挂按钮：导航条 `navReload.onclick`（`browser.js:346`）→ `webNav(key,'reload')` → `web-tabs.js nav 'reload'`（`:339`）`wc.reload()`。
- **修法**：「视图」菜单（U4 建的）加「刷新 ⌘R」→ `sendMenu('reload')`；renderer onMenu 路由 `'reload'`：激活标签是**网页** → `webNav(key,'reload')`（或复用 `navReload.click()` 含 disabled 守卫）；**文档标签 → no-op**（§2 拍板,防未保存编辑丢失;v2 可议安全 reloadDoc）。**不**在 `shortcutOf` 加 `r`（菜单加速器已全焦点覆盖,加了反而可能双触发）。冲突确认：⌘R 当前无主认领（勘察实证）,无双触发风险。
- **Files**：`src/main/main.js`；onMenu 路由文件（同 U4）；`src/renderer/browser.js`（如走 webNav 需拿激活 key）；测试 `e2e/browser.spec.js` 或 `e2e/tabs.spec.js`。
- **Spec 同步**：`docs/browser-feature-spec.md` §7 快捷键全表**新增 ⌘R 行**（现无此契约）+ §4.1 刷新语义。
- **Test scenarios**：
  1. 网页标签激活,经 menu 触发 `reload` → 页面真重载（**强断言**：本地 http server 命中计数 +1,非查 JS 状态）。
  2. 文档标签激活,触发 `reload` → 无导航、正文内容不变、无报错（no-op 回归门;尤其文档有未保存编辑时内容仍在）。
  3. 起始页标签（url=null）触发 → no-op 不炸（边界:reload 无 url 的 view）。
- **Verification**：网页上 ⌘R 行为与 Chrome 一致;编辑文档时误按 ⌘R 不丢任何东西。

---

## 4. 明确不做（别顺手加）

⌘⇧R 强刷、加载进度条（只做 spinner）、全屏加载遮罩、文档标签 ⌘R 重载（v2 议）、停止按钮超预算时的强做（可记 v2）、「都不折叠」方案（已拍板弃）、侧栏区域拖拽排序。

## 5. 交付与工程约定

- **PR 切分（防 merge train）**：PR1 = U1+U2（侧栏,共改 browser-feature-spec §3/§4）；PR2 = U3（浏览器加载）；PR3 = U4+U5（菜单/快捷键,共改 main.js + spec §7）。**顺序合**（都改 `docs/browser-feature-spec.md`,并行会级联 DIRTY——2026-07-14 Wendi 四 bug 批的实证教训）。
- 新 worktree + 短命分支;每单元绿了就 commit;push 用 jizhoutang10thglobal token;auto-merge + BEHIND 自动 update-branch。
- e2e 参照：①布局 `e2e/sidebar.spec.js`;②折叠 `e2e/browser.spec.js:382`;③闪回门 `e2e/browser.spec.js:172`;④⑤键位 `e2e/tabs.spec.js:110/127`。
- 给 Colin/Wendi 的验收脚本：照 §1 原话逐条在真机走一遍;②要 Wendi 看三栏折叠视觉;③要她重走「开新页面」流感受缓冲。
- 完成后：本 plan status 翻 completed;`docs/features/` 各 spec 已在各 Unit 列清。
