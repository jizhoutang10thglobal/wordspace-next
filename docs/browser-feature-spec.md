# Wordspace 浏览器 Feature —— 完整规格（UI/UX · 交互 · 数据 · 后端设计 · 移植指南）

> **文档用途**：ui-demo（`ui-demo/**`，React/TS/Vite 原型）已把「Wordspace 也是个浏览器」这套
> UI/UX、交互逻辑、图标、数据模型全部定稿（Colin + Wendi 逐轮 review 拍板）。ui-demo 是**权威参考、
> 领先真 app**。本文档是给**接手把它开发进真 Electron app（`src/**`）的 AI / 人**的完整规格：
> 照着做，就能把真 app 和 ui-demo 的 UI/UX、交互、前后端逻辑对齐。
>
> **写法约定**：每个功能按三层写——
> ① **交互契约**：用户可感知的一切（布局/图标/文案/时序/键位）。这部分必须 1:1 对齐，是验收标准。
> ② **ui-demo 参考实现**：mock 层（zustand + localStorage）怎么实现的。它是交互语义的**可执行定义**——
>    真 app 不照抄代码，但语义要一致；mock 的坑和刻意简化会标注。
> ③ **真 app 后端设计**：主进程 / IPC / 存储 / `WebContentsView` 接线怎么做。ui-demo 没有真后端，
>    这部分是**从交互契约推导出的设计**（Colin 要求：后端按交互逻辑来设计），接手者可按此落地、也可在
>    不改变交互契约的前提下调整实现细节。
>
> **读法**：先读 §1–§3（心智模型/数据模型/布局），再按 §4 逐功能实现；§10 是真 app 总体架构、§11 安全
> 不变式、§12 砍除清单、§13 已知差异与待拍板项——动手前必读。§14 是验收清单。
>
> 最后更新：2026-07-13（收藏区 header 归化为栏标语言 + 对齐网格定稿，Wendi「视觉乱」反馈）。

---

## 1. 心智模型与定位

Wordspace 是本地优先的 HTML/md 文档编辑器，同时**它自己也是个浏览器**（样式参照 Arc）。关键：

- 文档和网页**共用同一套标签系统、同一个侧栏、同一条地址栏**。不是两个 app 拼一起，是一整套。
- 用户在同一个侧栏里既开自己的 `.html` 文档，也开真网页，标签混装、可互相置顶/拖拽。
- 浏览器定位 = **「够用的标准浏览器」**（剪藏等融合卖点已砍，见 §12）：地址栏上网、收藏、历史、
  查找、缩放、右键菜单、会话恢复——齐全但克制，不做下载、不做扩展、不做多 profile。

---

## 2. 名词与数据模型（契约层）

以下 TS 形状来自 ui-demo，**字段语义是契约**（真 app 存储格式可自定，但要能表达同样的信息）。

### 2.1 Tab（`ui-demo/src/types.ts`）

```ts
interface Tab {
  id: string
  docId?: string
  kind: 'doc' | 'web' | 'file'   // doc=文档(块编辑器/基础编辑); web=网页; file=非HTML文件(pdf/图片/其他)
  title: string
  url: string                     // 地址栏字符串：doc=本地路径/发布链接; web=网址
  favicon?: string
  fileName?: string; fileKind?: FileKind; rootId?: string   // file/文件型 doc 标签用
  pinned?: boolean                // true=「置顶」组，false/无=「标签页」组
}
```

- 标签是**全局单一集合**（不分空间），渲染分两组：置顶组在前、普通组在后。
- 内容区（MainDocs）只渲染**激活标签**：`web → WebView`、`file → PdfViewer/ImageViewer/ExternalFilePanel`、
  `doc → Canvas`（非合规 HTML 走 BasicEditor）。

### 2.2 收藏（`ui-demo/src/mock/bookmarks.ts`）

```ts
interface Bookmark { id: string; title: string; url: string; folderId: string; addedAt: number /*ms*/; favicon?: string }
interface BmFolder { id: string; name: string }
const BM_BAR = 'bm-bar'   // 「书签栏」固定文件夹：☆/⌘D 默认落这里；不可改名/删除
```

**容量语义（真 app，P3-11）**：收藏是用户数据 → **不设条数上限**（静默丢弃比膨胀更糟；导入超大文件 toast
报净新增数即可）。放大器只有一个——「每次变更把全量 state 灌 renderer」：磁盘写早已防抖（`browser-store`
`schedule` ~500ms 原子写），**推送 renderer 走 leading-edge 防抖合并**（`browser-store.subscribe`：单次变更
立即推、星标即时；`NOTIFY_MS`≈200ms 窗口内的多次变更合并成一次 trailing 推）。见 §10.4。

### 2.3 历史（`ui-demo/src/mock/history.ts`）

```ts
interface HistEntry { id: string; url: string; title: string; visitedAt: number /*ms*/; favicon?: string }
// 上限 500 条；只记 http(s) 与内置搜索结果页；同 url 60 秒内连续访问合并为一条（更新时间和标题）
```

### 2.4 浏览器设置（`ui-demo/src/mock/browserSettings.ts`）

```ts
type EngineKey = 'glass' | 'bing' | 'google' | 'ddg'
SEARCH_ENGINES = {
  glass:  { name: 'Glass 搜索',  url: 'glass://search?q=%s' },   // ui-demo 虚构引擎（见 §13）
  bing:   { name: 'Bing',        url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google',      url: 'https://www.google.com/search?q=%s' },
  ddg:    { name: 'DuckDuckGo',  url: 'https://duckduckgo.com/?q=%s' },
}
// state: { engine: EngineKey }；searchUrl(q) = 模板 %s ← encodeURIComponent(q)
// 默认引擎：demo=glass（虚构，结果页能在 demo 内渲染）；真 app=**Bing**（Colin 2026-07-10 拍板）。
// 「主页」设置已删（拍板：起始页本身就是主页，不做可配置主页）。
```

### 2.5 每标签导航历史（mock 专用，真 app 不需要）

```ts
// useBrowser.history: Record<tabId, { stack: string[]; index: number }>
```
真 app 用 `webContents` 自带导航历史（§6），**不要**自己再造栈。

---

## 3. 布局总览

### 3.1 左侧栏（`ArcSidebar`，自上而下）

```
┌──────────────────────────────┐
│ 🔴🟡🟢   ⎡侧栏⎦ ‹ › ↻ 🕘 🔍   │ ← 顶栏导航条（§4.1）
│ [🌐 地址栏………………… ☆]        │ ← omnibox（§4.2）
│ 收藏 3               ⧉ ▸    │ ← 收藏区，默认收起（§4.3）★置顶上方
│ 置顶                          │
│   ⌕ 员工手册            📌   │ ← TabStrip pinned（§4.4）
│ 标签页                    +   │
│   🌐 Designer News   📌 ✕   │ ← TabStrip normal
│ 文档                          │
│   [筛选文件…]                 │
│   ▸ 品牌升级 …（文件树）      │
│ ─────────────────────────── │
│ 🤖  ⚙  ⌨  (WD)              │ ← 底部工具行
└──────────────────────────────┘
```

侧栏可拖拽调宽（左缘 `arc-resize`）、可收起（收起后只剩一条窄轨 + 展开钮 `PanelLeft`）。

### 3.2 内容区四态

| 激活标签 | 渲染 | 备注 |
|---|---|---|
| `web` + `wordspace://newtab` | 新标签页（§4.5.2） | 无任何网页 chrome |
| `web` + 网址 | **网页直接铺满** | **无网页头**（2026-07-10 决定，见下） |
| `doc` | 编辑器（Canvas/BasicEditor） | 非本 spec 范围 |
| `file` | PDF/图片查看器 或「用默认程序打开」面板 | 非本 spec 范围 |

> **⚠ 无网页头（2026-07-10 Wendi+Colin 定稿）**：网页态**没有任何 Wordspace chrome 罩在网页上方**。
> 原来那条「🔒 + 站点标题 + 域名」的网页头已删——冗余，URL 和安全指示地址栏里已有。
> 真 app 落地含义：**不要**在 `WebContentsView` 上方叠 `#web-header`；view 的 bounds = 侧栏右侧的
> **整个内容区**（只随侧栏宽度/收起变化 + 窗口 resize），全高无头部偏移。

---

## 4. 逐功能规格

### 4.1 顶栏导航条

**交互契约**
- 一排图标钮（自左向右）：收起侧栏 `PanelLeft`(15) → 后退 `ChevronLeft`(16) → 前进 `ChevronRight`(16)
  → 刷新 `RotateCw`(13) → 历史记录 `History`(15) → 查找文件 `Search`(14，title 含 ⌘P/Ctrl+P)。
  左上角三个 mac 红黄绿灯是纯装饰（demo 模拟窗口；真 app 用系统交通灯，别画）。
- **后退/前进按「当前标签能否导航」实时显示 disabled**（灰态、不可点）。文档标签用文档区自己的
  导航历史（main 已有 #146 那套）；网页标签用网页导航历史。
- 刷新：仅网页标签有效（重载当前 URL）。
- 历史钮 → 历史页（§4.8）。查找文件 = ⌘P 命令面板（找本地文件，与网页无关，不在本 spec 展开）。
- 点后退/前进/刷新时若正在看历史/收藏/设置页，**先回到主视图**再生效（demo 里是 `navigate('/docs')`）。

**ui-demo 参考实现**：`goBack/goForward` 调 `useBrowser.back()/forward()`；`canBack/canFwd` 响应式订阅
per-tab 栈。刷新 = `navigate(activeTab.url)`（栈有「连续同 url 不重复压栈」守卫，所以刷新不撑大历史）。

**真 app 后端设计**
- 后退/前进/刷新 → IPC 到主进程，对激活 web 标签的 `webContents` 调 `goBack()/goForward()/reload()`。
- disabled 态：主进程监听 `did-navigate` / `did-navigate-in-page`，把
  `{ tabId, url, title, canGoBack, canGoForward }` **push** 给 renderer（如 `webtab:state` 频道），
  renderer 存进标签状态驱动按钮。不要 renderer 轮询。

---

### 4.2 地址栏 omnibox（+ 自动补全）

**交互契约**
- 一条输入框，值 = 激活标签的 `url`（切标签时同步重置）。placeholder「搜索,或输入网址」。聚焦时全选。
- 左侧状态图标随标签类型变：已发布文档=`Globe`(绿) / 内部文档=`Lock` / **网页=`Globe`** / 本地文档=`FolderClosed`（均 13）。
  本地文档在右侧显示「本地」小标签。
- **网页标签时右端显示收藏星标 `Star`(14)**：未收藏=描边，已收藏=实心（accent 色）。点击/⌘D 切换（§4.6）。
  新标签页（`wordspace://newtab`）不显示星标。
- **自动补全**：开始打字即弹建议下拉（在地址栏正下方）；每条=图标+标题+URL（去 scheme）。
  - 数据源按优先级去重合并：**① 开着的网页标签 → ② 收藏 → ③ 历史**（历史取 `search(输入, 8)`）。
  - 匹配 = url 或 title 包含输入（不分大小写）；排除空值和 `wordspace://newtab`；**最多 6 条**。
  - 图标：标签=`Globe2`、收藏=`Star`、历史=`History`（12）。
  - 键盘：`↓`/`↑` 移动选中（↑ 可回到 -1 = 原始输入）、`Enter` 走选中项或原始输入、`Esc` 收起并失焦。
    鼠标 hover 同步选中态；点击建议直接提交。
  - **网页标签上显示的是当前 url（没在打字）时不弹**；失焦 150ms 后收起（留出点击建议的时间窗）。
- **回车提交语义**：若当前激活的不是网页标签 → **先开一个新网页标签**再导航（文档标签不被顶掉）；
  是网页标签 → 当前标签原地导航。输入经 §5 的 `normalize` 处理（网址/搜索自动判别）。
- `⌘L` 聚焦并全选地址栏（侧栏收起时先展开）。

**ui-demo 参考实现**：`omniSug` 为 `useMemo`；提交 `submitOmni(explicitUrl?)`；建议项 `onMouseDown`
preventDefault（防 blur 先触发）。

**真 app 后端设计**
- 自动补全数据源换真的：打开的 web 标签（renderer 内存）+ 收藏 + 历史。收藏/历史若在主进程持有，
  提供 `history:search(q, limit)` / `bookmarks:list` IPC；量小（≤500 + 收藏），也可启动时全量同步到
  renderer 内存、变更时增量推送——**推荐后者**（补全要逐键响应，不该逐键跨 IPC）。
- 提交：renderer 跑 `normalize`（§5）得最终 URL → `webtab:navigate {tabId, url}`。主进程**白名单校验**
  再 `loadURL`（§11）。

---

### 4.3 收藏区（左侧栏，默认收起）★ 本轮定稿

> **口径演进（反转过两次，以此为准）**：侧栏平铺收藏区（臃肿，废）→ 网页态顶部书签栏（2026-07-09，
> Wendi 不要，废）→ **左侧栏折叠收藏区（2026-07-10 定稿）**。位置=「置顶」**上方**（对齐 Arc 把
> Favorites 放最顶），**默认收起、点标题行才展开**——用折叠解决臃肿。网页态书签栏、网页头都已删。

**交互契约**
- **收起态**（默认）：仅一行，**穿侧栏栏标的衣服**——与「置顶/标签页/文档」同一套 editorial
  栏标语言（mono、fs-xs、宽字距、text-3 灰），模式抄「标签页」行的「栏标 + 右侧动作」：
  `「收藏」 + 数量(灰) ……行尾 Bookmark(13) 管理入口 + ChevronRight(12) caret`。
  管理入口**默认透明，hover 标题行或展开态才显现**；caret 常显（展开可发现性）；hover 整行
  浅灰底、标题升 text-2。**行首不再有 caret 和 Star**（☆ 概念只留在地址栏；行首图标+彩色星标
  让同级 section 穿两套衣服，是「视觉乱」的根源——2026-07-13 按 Wendi 反馈定稿）。
- **对齐网格**：栏标文字左缘 8px（同置顶/标签页/文档），收藏项/文件夹名/空态文案左缘 10px
  （同标签行内容）。侧栏滚动列只允许这两条左缘。
- 点标题行任意处 toggle 展开/收起（管理入口点击 stopPropagation，不触发 toggle）。
- **展开态**：caret 原地旋转 90°（复用 `.arc-caret`，同文件树折叠）；下方列出书签：
  - 「书签栏」文件夹（`BM_BAR`）的书签**直接平铺**（不带文件夹名）；
  - 其余**非空**文件夹显示为分组：文件夹名小标题（灰、xs 字号）+ 其下书签；空文件夹不渲染；
  - 每条书签 = `FavChip`（见下）+ 标题（单行省略号，title 提示完整 url）；hover 整行浅灰底。
  - 一条收藏都没有时显示空态文案：「点地址栏的 ☆ 收藏网页」。
- **点书签的打开语义（2026-07-10 拍板）**：已开着该网址的网页标签（含置顶）→ **聚焦过去**；
  否则**新标签打开**（前台激活）并记入历史。连点同一收藏不会堆重复标签。若正在历史/收藏/设置页则回主视图。
- **折叠态记住上次**（拍板）：展开/收起状态持久化，下次启动恢复；首次默认收起。
- 管理入口 → 收藏管理页（§4.9）。
- **FavChip 图标算法**（无真 favicon 时的替身，比灰地球好认）：取标题首字大写（空则 `·`）；
  色相 `h = (h*31 + charCode) % 360` 逐字符累计（seed=url，同 url 永远同色）；
  底色 `hsl(h 55% 92%)`、字色 `hsl(h 42% 40%)`；16×16px、圆角 4、字号 10/600。

**ui-demo 参考实现**：`ArcSidebar` 内 `.arc-fav` 区 + `FavChip` 组件；`favOpen` 持久化在
localStorage（key `ws-fav-open`）。`openBookmark(url,title)`：先按 url 找已开的 web 标签 →
`setActiveTab`；找不到才 `openWebTab` + `history.record`；最后回 `/docs`。

**真 app 后端设计**
- 收藏数据主进程持有（§4.9 存储），启动全量同步 renderer + 变更推送（`bookmarks:changed`）。
- 有 favicon 缓存（§10.4）时书签图标优先真 favicon，取不到回退 FavChip（算法照搬，纯前端）。
- 点书签：renderer 先按 url 匹配已开 web 标签（含置顶）→ 聚焦；否则走「新建 web 标签 + 加载」流程
  （同 §4.4 / §10.2）；历史由主进程 `did-navigate` 自动记（mock 手动 record 的补丁真 app 不需要）。
- 折叠态持久化（跟侧栏宽度等 UI 状态放一起），首次默认收起。

---

### 4.4 标签系统：置顶 / 标签页 / 拖拽 / 关闭 / 重开

**交互契约**
- 两个分区：「置顶」在上（无 + 按钮），「标签页」在下（标题行右侧 `Plus`(14) 新建）。
- 每行：类型图标（网页=`Globe2`(13)，文档/文件=`FileText`(13)）+ 标题（省略号）+
  未保存圆点（临时文档）+ 置顶钮（`Pin`/已置顶 `PinOff`，12）+ 关闭钮 `X`(12)。
  **置顶标签没有关闭钮**（同浏览器惯例，防误关）；激活行高亮。
- **拖拽**：任意标签行可拖。拖到「置顶」区放下=置顶、拖到「标签页」区=取消置顶、区内拖=重排；
  放置位置由插入线指示（落点在行中线上/下 = before/after）。置顶区为空时显示提示
  「把标签页拖到这里置顶」并在 dragover 时高亮整区。
- **关闭**：点 X 或 `⌘W`（置顶标签 `⌘W` 无效）。未保存的临时文档 → 先弹确认（保存/不保存/取消）。
  关闭激活标签后的激活转移：**真 app 已定「激活相邻标签、不滚动文件树」**（main #145，Wendi/Colin
  反馈）——移植保持真 app 行为；ui-demo 仍是「激活数组最后一个」，此处以真 app 为准（§13）。
- **重开关闭的标签 `⌘⇧T`**：后进先出栈，容量 15；只记**非文档**标签（web / 非 HTML file——
  临时文档重开也没内容）；重开 = 原 url/title/pinned 恢复成新标签并激活。
- **标签切换**：`Ctrl+Tab` / `Ctrl+Shift+Tab` 按条顺序循环（置顶组在前、普通组在后；**不做 MRU**）；
  `⌘1..8` 直达第 N 条、`⌘9` 直达最后一条（浏览器语义）。
- **会话恢复**：重启后恢复所有标签（含 web 标签的 url/title/pinned）+ 上次激活标签（§8）。

**ui-demo 参考实现**：`store.ts` 的 `tabs/closedTabs/activeTabId` + `dropTab(tabId, pinned, toIndex)`
（一次完成变组+定位）+ `togglePin/closeTab/reopenClosedTab/newBrowserTab/openWebTab/setTabUrl`。
拖拽用 HTML5 DnD，被拖 id 存模块级变量（dragover 期间 `getData()` 被浏览器封锁）。
`openWebTab(url, title, background?)`：**永远新建**标签；`background=true` 不切激活。

**真 app 后端设计**
- 真 app 已有同构标签系统（`src/renderer/sidebar.js`：open/pinned 双标记、重启恢复、拖拽、外部文件 ↗）。
  web 标签作为一种新 kind 接入：**一个 web 标签 ↔ 一个 `WebContentsView`**（生命周期见 §10.2）。
- 关闭 web 标签 → 销毁对应 view（释放内存）；`⌘⇧T` 重开 → 按存的 url 重建 view（**不是**复活旧 view）。
- 置顶/拖拽/重排纯 renderer 状态，主进程只需在激活变化时切换显示的 view。

---

### 4.5 新建标签入口

#### 4.5.1 ⌘T /「标签页 +」→ 新建 modal（Arc 式二合一）

**交互契约**：`⌘T` 或点「标签页」区的 `+`，弹**新建 modal**（不是直接开空标签）：
- 顶部一条**地址栏**（自动聚焦，可直接打字）：输入 + `Enter` → 开新网页标签并导航过去，关 modal。
- 下方是**新建文档**：范式选择（「范式 1」可用；范式 2/3 灰态「敬请期待」）+ 空白文档 + 公司模板。
  从这里建的文档是**临时文档**（unsaved，不进文件树，手动保存才落地——已有机制）。
- `Esc` 或点遮罩关闭。
- 设计意图：Arc 式「新标签 = 新网页 or 新文档」一个入口。

**ui-demo 参考实现**：`CreateModal.tsx` 的 omni 态（`useUI.openNewTab()` 置 `createOmni=true`）；
地址栏提交 = `newBrowserTab()` + `useBrowser.navigate(v)`。

**真 app 后端设计**：纯 renderer UI。地址栏提交走 §4.2 同一条 navigate 管线。

#### 4.5.2 新标签页（起始页）

**交互契约**：`url` 为空或 `wordspace://newtab` 的 web 标签渲染起始页：
- 居中一列：「Wordspace」字标 → 大号搜索框（自动聚焦，placeholder「搜索,或输入网址」，
  `Enter` 提交走 normalize）→ 快捷方式瓦片格 → （有置顶标签时）置顶快捷行 → 底部安全提示。
- 快捷瓦片 = 首字彩色 chip + 名称。**真 app（拍板 2026-07-10）：取「书签栏」文件夹前 N 个收藏**
  （与收藏体系连通，不单独维护；空收藏时显示空态/引导收藏）。ui-demo 保留写死的 7 个演示位
  （招聘页/公司官网/Designer News/Glass 搜索/FlowDesk/维基百科/Example）——demo 需要「有网可上」的
  素材，属 §13 刻意差异，**不照搬**。
- 置顶快捷行：`Pin` 图标 + 各置顶标签标题按钮，点了切过去。
- **安全提示文案（产品口径，保留）**：「内置浏览器没有恶意网站防护，访问陌生网站请自行留意」。

**真 app 后端设计**：起始页是**本地 surface**（renderer 内部页面/本地 HTML），绝不是远程 URL；
新建 web 标签先不创建 `WebContentsView`（起始页不需要），首次导航到真网址才建（§10.2 懒创建）。

---

### 4.6 网页态内容区：查找条 / 缩放 /（demo 的 iframe 回退）

**交互契约**
- **网页直接铺满，无网页头**（§3.2）。右键菜单见 §4.7。
- **页内查找 `⌘F`**（仅网页标签；文档标签的 ⌘F 归编辑器查找）：网页右上角浮出胶囊查找条
  （绝对定位 top 8 / right 16，pop-in 动画）：`Search`(13) + 输入框(180px，placeholder「在页面中查找」)
  + 上一个 `ChevronUp`(14) + 下一个 `ChevronDown`(14) + 关闭 `X`(14)。
  自动聚焦全选；`Enter`=下一个、`⇧Enter`=上一个、`Esc`=关闭并清除高亮；循环查找（到底回到开头）。
- **缩放 `⌘+ / ⌘- / ⌘0`**（仅网页标签）：步长 0.1、范围 0.5–2.0、`⌘0` 复位 1.0。
- （demo-only，**不移植**）真外部 URL 用 `<iframe>` 尽力渲染，顶部一条灰条提示
  「某些网站不允许内嵌预览,若空白可在系统浏览器打开」+「打开」钮。这是 iframe 被 X-Frame-Options
  拦截的演示性妥协；真 app 用 `WebContentsView` 加载真网页，**没有这个问题，也不要这条提示**。

**ui-demo 参考实现**：查找用 `window.find()`（mock 站是同文档 DOM，够用）；缩放是 `useBrowser.zoom`
**全局单值**（内容区只渲染激活标签，所以视觉上等效）+ CSS `zoom` 包裹层。

**真 app 后端设计**
- 查找：`webContents.findInPage(q, { forward, findNext })` + `stopFindInPage('clearSelection')`；
  监听 `found-in-page` 事件拿 `matches/activeMatchOrdinal`，**建议**查找条显示「N/M」计数（mock 没有，增强项）。
  查找条本身是 renderer 浮层——注意它会被 `WebContentsView` 盖住！两个方案：把查找条做成主进程小
  view / 或把网页 view 顶部让出一条放 DOM 查找条。**真 app 已有先例**（文档内查找的父层浮层），对
  web 标签推荐：查找激活期间把 view bounds 顶部收缩出查找条高度，或用独立小 `WebContentsView` 叠加。
  这是移植时的实现决策点，交互契约（位置/键位/行为）不变。
- 缩放：**每标签独立** `webContents.setZoomFactor(factor)`（mock 的全局值是简化；真 app 存进各标签
  状态、切标签恢复）。范围/步长同上。

---

### 4.7 网页右键菜单

**交互契约**——按光标下的**真实上下文**组装，六个分节按序，节内无内容整节消失，节间恰一条分隔线：

| # | 分节 | 出现条件 | 条目（id → 文案） |
|---|---|---|---|
| 1 | 链接 | 光标在链接上 **且 url 是 http(s)**（`javascript:`/`data:`/`file:` 整节不出） | `open-link` 在新标签页打开链接 / `open-link-bg` 在后台标签页打开链接 / `copy-link` 拷贝链接 |
| 2 | 图片 | 光标在图片上 | `copy-image` 拷贝图片 / `copy-image-url` 拷贝图片地址（仅 http(s)）。**无下载项**（下载已砍） |
| 3 | 选中 | 有选中文字 | `copy-selection` 拷贝 / `search-selection` 用 <引擎> 搜索「<截断20>」 |
| 4 | 编辑框 | 光标在 input/textarea/contenteditable | `cut` 剪切 / `copy` 拷贝 / `paste` 粘贴 / `select-all` 全选 |
| 5 | 导航 | 总是 | `nav-back` 返回（enabled=canGoBack）/ `nav-forward` 前进（enabled=canGoForward）/ `reload` 重新加载 |
| 6 | 页面 | 总是 | `copy-page-url` 拷贝页面链接 / `export-pdf` 导出 PDF |

- **选中文字截断**：空白折叠为单空格、**按 Unicode 码点**截 20 字加 `…`（不许切断 emoji/代理对）。
- **拷贝链接清洗**：`copy-link`/`copy-page-url` 先删跟踪参数
  `utm_* fbclid gclid dclid yclid msclkid mc_eid igshid spm ref_src`（功能参数如 `?id=` 保留；
  URL 解析失败原样返回）。
- 菜单定位：**紧贴光标**，默认左上角贴光标向右下展开；右缘放不下→右缘贴光标向左开、下缘同理（边距 8px）。
- 关闭时机：点菜单外 / `Esc` / 窗口 resize / 任何滚动。禁用项（back/forward 不可用时）灰态不可点。

**ui-demo 参考实现**
- 纯逻辑 builder `ui-demo/src/lib/webCtxMenu.ts`（`buildWebCtx(info, ctx) → CtxItem[]`，与真 app 的
  `src/lib/web-context-menu.js` 是对齐的双胞胎）。
- DOM 渲染 `WebContextMenu.tsx`：**`createPortal` 到 `document.body`**——血泪教训：嵌在带 `transform`
  的祖先里，`position:fixed` 会以祖先为包含块、菜单离光标十万八千里。
- 动作处理集中在 `WebView.run(id, info)`。demo 里 `copy-image`/编辑四件套/`reload`/`export-pdf` 是
  toast 桩；`search-selection` 开新标签搜索；`open-link` 前台新标签、`open-link-bg` 后台+toast。

**真 app 后端设计（必须原生菜单）**
- `WebContentsView` 是独立原生视图**盖在 DOM 之上**——任何 DOM 菜单都会被网页盖住。**只能**用主进程
  `Menu.buildFromTemplate(template).popup()`。
- 接线（`feat/browser-tabs` 分支已有骨架，直接复用）：`wc.on('context-menu', (e, params) => openCtxMenu(key, params))`；
  `params.linkURL / srcURL / selectionText / isEditable / mediaType` 直接映射 builder 的 `info`；
  `canGoBack/canGoForward` 从 `wc.navigationHistory` 取。
- **动作单一收口** `executeCtxAction(key, id, args)`（id 白名单校验，防任意动作注入）：
  `copy-* → clipboard.writeText`（清洗逻辑在主进程）、`copy-image → wc.copyImageAt(params.x, params.y)`、
  编辑四件套 → `wc.cut()/copy()/paste()/selectAll()`、`reload → wc.reload()`、
  `nav-back/forward → wc.goBack()/goForward()`、`export-pdf → wc.printToPDF({...})` + 保存对话框、
  `open-link` → 通知 renderer 新建前台 web 标签、`open-link-bg` → 后台标签 + toast。
- mock 已知缺口：demo 的 `open-link` **没记历史**；真 app 主进程按 `did-navigate` 自动记（§4.8），
  天然覆盖，无需专门修。

---

### 4.8 历史

**记录规则（契约）**
- 只记 `http(s)` 和内置搜索结果页；`wordspace://newtab` 永不记。
- **只记主动导航**：地址栏提交、点页面链接、点收藏、刷新；**back/forward 不记**。
- 同 url **60 秒内**连续访问合并为一条（更新标题和时间，不堆重复）。上限 **500 条**（FIFO 淘汰最老）。
- 从历史页点开一条：demo 不再重复记（60s 合并之外的实现细节）；真 app 走 `did-navigate` 自动记，
  会记——**接受这个差异**（浏览器惯例本来就记）。

**历史页 `/history`（契约）**
- 入口：顶栏 `History` 钮。页面：返回钮 `ChevronLeft` + 标题「历史记录」+ 搜索框（`X` 清空）+
  右侧「清除浏览数据」`Trash2` 按钮 → 下拉菜单：**最近一小时 / 最近 24 小时 / 最近 7 天 / ―― / 全部清除**（红色危险态）。
  范围清除语义 = 删除**该时间段内**（比 cutoff 新）的记录，更老的保留。
- 列表按自然日分组：「今天」「昨天」「M 月 D 日」；每行 = `HH:MM` 时间 + `Globe2` + 标题 + url（去 scheme），
  行尾 `X` 删除单条；点行 = 开新网页标签并跳回主视图。
- 空态：无记录「还没有浏览记录」；搜索无命中「没有匹配的历史记录」。
- 搜索 = 标题或 url 包含（不分大小写），按时间倒序。

**ui-demo 参考实现**：`mock/history.ts`（zustand persist，key `wordspace-history`）+ `HistoryPage.tsx`。
地址栏补全用的 `search(q, 8)` 额外做同 url 去重（只出最近一条）。

**真 app 后端设计**
- **主进程自动记录**：监听每个 web 标签 `wc.on('did-navigate')` 与 `did-navigate-in-page`（SPA 路由也算访问），
  顶层 frame、http(s) 白名单、60s 合并、cap 500。标题常在导航后才到——记录时先用 url 当标题，
  `page-title-updated` 时若头部条目同 url 且 60s 内则补写标题（正好复用合并逻辑）。
- 存储：`userData/browser-history.json`（§10.4；写入防抖 + 原子写）。
- IPC：`history:list`、`history:removeOne(id)`、`history:clear(range)`、`history:search(q, limit)`
  （或全量同步 renderer + 变更推送，见 §4.2 的取舍）。**不给 renderer 提供「写入任意历史」的口子**，
  记录只由主进程导航事件驱动。

---

### 4.9 收藏管理页 `/bookmarks` + Netscape 导入导出

**交互契约**
- 入口：收藏区标题行的 `Bookmark` 钮。页面：返回钮 + 标题「收藏夹」+ 三个操作：
  「新文件夹」`FolderPlus` / 「导入」`Upload` / 「导出」`Download`。
  说明行：「导入 / 导出用的是浏览器通用的 HTML 书签格式（Netscape），可以和 Chrome、Safari、Firefox、Edge 互相搬。」
- 按文件夹分区：文件夹名**就地改名**（输入框失焦提交，空值回退原名）；「书签栏」固定不可改名不可删
  （title 提示「书签栏（固定）」）；其他文件夹可删（**连同其中书签**，title 已警告）。每区显示书签数，空文件夹显示「空」。
  **手动建/改名撞名（P3-09）**：新建「新文件夹」或改名撞现有名 → 自动加「名字 2」式后缀（与导入路径同口径、
  不弹错、低摩擦）；改成自己现名不加后缀。纯逻辑在 `bookmarks.js` `addFolder`/`renameFolder`（复用 `uniqueName`），
  IPC 只调用。
- 每条书签一行：`Globe2` + 标题（就地改，失焦提交，空值回退为 url）+ url（去 scheme，title 提示全 url）+
  **文件夹下拉**（选中即移动）+ 打开 `ExternalLink`（**同 §4.3 语义：已开则聚焦，否则新标签+记历史**）+ 删除 `Trash2`。
- **导出**：生成 `bookmarks.html` 下载（demo 用 Blob；真 app 用保存对话框），toast
  「已导出为 bookmarks.html（Chrome/Safari/Firefox 都能导入）」。
- **导入**：选 `.html` 文件解析合并。规则（Colin 2026-07-10 拍板）：
  - 对方的「书签栏」（`PERSONAL_TOOLBAR_FOLDER`）并入我们的书签栏（书签栏天然只有一个）；
  - 其他文件夹**追加为新文件夹，重名不合并**——与现有文件夹重名时加「名字 2」式后缀
    （同名≠同一个文件夹，宁可 `工作 2` 也不悄悄搅在一起；后缀式样与 app 文件树去重一致）；
    **例外（2026-07-14 温和修正 P3-10）**：与现有同名文件夹**内容完全相同**（内含书签 url 集合相等）时
    视为「重复导入同一份」→ **跳过不造副本**，这样「导出当备份→原样导回」零翻倍；只有内容有差异才加后缀。
  - 同文件夹同 url 的书签跳过（去重）；
  - toast 报**净新增数**：「已导入 N 个书签」/ 全是重复「这些书签都已存在，没有新增」/
    解析不出「没识别到书签（需要浏览器导出的 HTML 书签文件）」。

**Netscape Bookmark File Format（互通硬契约——两端逻辑一字别改语义）**
- 导出结构：`<!DOCTYPE NETSCAPE-Bookmark-file-1>` + 生成注释 + `<META charset UTF-8>` + `<TITLE>/<H1>Bookmarks` +
  嵌套 `<DL><p>`；文件夹=`<DT><H3>名字</H3>`（书签栏那个加 `PERSONAL_TOOLBAR_FOLDER="true"`）；
  书签=`<DT><A HREF="url" ADD_DATE="Unix秒">标题</A>`；`&<>"` 实体转义。
- 解析必须**宽松**：Netscape HTML 的闭标签故意不闭合，**绝不能当 XML 解**——用 HTML 宽松解析
  （demo 用 `DOMParser('text/html')`；真 app 主进程无 DOM，可用 `JSDOM`/`parse5`/或按行的宽容解析器，
  行为对齐即可）：遍历每个 `<h3>`（文件夹）→ 紧随的 `<DL>` 里 `dt > a` 是书签（容忍裸 `a`）；
  只收 http(s)；`ADD_DATE` 秒→毫秒；整份文件没有 `<h3>` 时，把所有裸 `<a>` 兜底进书签栏。
  **实测互通**：已吃过 Chrome 真实导出文件（3 书签 + 子文件夹全对）。

**ui-demo 参考实现**：`mock/bookmarks.ts` 的 `toNetscapeHtml/fromNetscapeHtml`（`importHtml` 返回
`{parsed, added}`，重名后缀去重已实现）+ `BookmarksPage.tsx`。

**真 app 后端设计**
- 存储 `userData/browser-bookmarks.json`：`{ version, folders, bookmarks }`（§10.4）。`BM_BAR` id 固定。
- IPC：`bookmarks:list / add / removeByUrl / removeOne / update / addFolder / renameFolder / removeFolder /
  exportToFile / importFromFile`。导入导出走主进程 `dialog.showOpenDialog/showSaveDialog` + `fs`（没有 Blob hack）。
- `removeByUrl(url)` 语义注意：**跨全部文件夹删除该 url**（地址栏 ☆ 取消收藏用它——即使这条收藏在
  「稍后读」里也会被移除）。`removeFolder` 删文件夹连带其中书签，`BM_BAR` 拒绝。

---

### 4.10 设置 · 浏览器

**交互契约**：设置页「浏览器」区，只有一行：
- **默认搜索引擎**：下拉（Glass 搜索 / Bing / Google / DuckDuckGo），说明「在地址栏打一句话（不是网址）时用它搜索」。
  选择即生效于 §5 的 normalize——影响全部三个搜索入口：**地址栏打词、新标签页搜索框、右键「用 X 搜索选中文字」**。
  我们**不自建搜索引擎**，只是把词转发到所选引擎的结果页（一个普通网页）。
- **「主页」设置已删**（Colin 2026-07-10 拍板）：起始页本身就承担主页职责，不做「可配置主页网址」这种
  遗产功能。新标签页/启动固定进起始页。**不要加回来。**

**真 app 后端设计**：并入 app 现有 settings 机制（键位建议 `browser.searchEngine`）。
搜索引擎列表可扩展；**真 app 默认引擎 = Bing（拍板）**（Glass 是 demo 虚构的，仅存在于 ui-demo）。

---

## 5. 地址输入处理管线（normalize / resolve）

浏览器的大脑，纯函数，真 app renderer 侧要有等价实现（`ui-demo/src/mock/browser.ts`）：

**`normalize(input) → url`**
1. trim；空 → `wordspace://newtab`（起始页）。
2. 已带 scheme（正则 `^[a-z][a-z0-9+.-]*:\/\/`）→ 原样返回。
   **⚠ 安全注意**：这条会放行 `file://` 等任意 scheme——mock 无所谓，**真 app 主进程 loadURL 前必须
   白名单校验**（http/https/内部 scheme），见 §11。（`javascript:alert(1)` 无 `//` 不命中此条，
   会因「无点」落入搜索分支，自然无害。）
3. 含空格 **或** 不含 `.` → 当搜索词：`searchUrl(raw)`（当前默认引擎模板 + `encodeURIComponent`）。
4. 其余（裸域名/路径）→ 补 `https://`。

**真 app 的含冒号输入判定（`url-input.js`，P2-4 收窄）**：真 app 除了带 `//` 的 authority scheme（只放行
`http`/`https`，其余 `file://`/自定义 `foo://` → **blocked**），还要判「无 `//` 的 opaque 冒号输入」。只有**已知
危险/不支持协议**才 blocked，名单 = `{ javascript, data, file, vbscript, blob, chrome, about, ws, wss, ftp,
mailto, tel, intent }`；**名单外的含冒号输入一律落搜索**（`note:hello`/`todo:fix`/`re:报价`/自定义 `myapp:token`
都是搜索词，不是网址——「非网址即搜索」）。端口写法（冒号后是数字，如 `localhost:8080`）不进 scheme 判定、走
域名/IP 真验证。`mailto:`/`tel:` v1 不外呼、维持 blocked。

**`resolve(url) → { kind, title, ... }`**（ui-demo 专用的渲染分类；真 app 简化）
- 空 / `wordspace://newtab|home` → 起始页。
- `glass://…` → demo 内置搜索结果页（虚构引擎）。
- 命中 mock 站域名表 → 渲染手写 mock 站（**demo 素材，不移植**：tenthglobal.com / news.design / flowdesk.app 及 www 变体）。
- 其余 → 真网页。标题兜底 = host 去 `www.`。
- 真 app 只需两类：起始页（本地 surface）/ 真 URL（交给 `WebContentsView`）；页面标题来自
  `page-title-updated` 事件，不用猜。

---

## 6. 前进/后退导航历史模型

**契约**：每个网页标签独立的前进/后退；后退/前进不产生新历史记录；地址栏和按钮 disabled 态实时反映。

**ui-demo 参考实现**（`useBrowser.history`，理解语义用）：
- `navigate(input)`：**首次导航前把标签当前页种成栈起点**（否则点链接跳走后 back 无处可退——修过的真 bug）；
  截断 forward 分支；**连续同 url 不重复压栈**（刷新不撑栈）；提交到标签（url+标题）；记历史。
- `back()/forward()` 移动 index 并提交，不记历史。栈**不持久化**（刷新后按钮回到 disabled，直到再次导航）。

**真 app**：`webContents` 自带完整导航历史——`goBack/goForward/canGoBack/canGoForward`
（`navigationHistory` API），事件驱动推送状态（§4.1）。**不要**自己再实现栈。
会话恢复后的 web 标签只恢复 url（导航历史不跨重启恢复，同 mock 行为，也是主流浏览器默认）。

---

## 7. 快捷键全表（契约；mac `⌘` = Win/Linux `Ctrl`）

| 键 | 作用 | 条件/细节 |
|---|---|---|
| `⌘L` | 聚焦并全选地址栏 | 侧栏收起时先展开 |
| `⌘T` | 新建 modal（地址栏 + 新建文档二合一） | §4.5.1 |
| `⌘W` | 关闭当前标签 | **置顶标签无效**；未保存文档先弹确认 |
| `⌘⇧T` | 重开最近关闭的标签 | 栈容量 15，只记非文档标签 |
| `Ctrl+Tab` / `Ctrl+⇧+Tab` | 按条顺序循环切标签 | 置顶组在前；非 MRU；不带 ⌘ |
| `⌘1`–`⌘8` / `⌘9` | 直达第 N 条 / 最后一条标签 | 顺序=置顶组+普通组 |
| `⌘D` | 收藏 / 取消收藏当前网页 | 仅网页标签（非起始页）；取消=跨全部文件夹删该 url |
| `⌘F` | 页内查找 | 文档标签→编辑器查找条；**网页标签→网页查找条**（§4.6） |
| `⌘⇧F` | 聚焦文件树筛选框 | 侧栏收起时先展开 |
| `⌘P` | 查找文件（命令面板） | 与浏览器无关，占位说明 |
| `⌘+` `⌘-` `⌘0` | 网页缩放 大/小/复位 | 仅网页标签；±0.1，范围 0.5–2 |
| `⌘,` | 打开设置 | |
| `⌘\` | 收起/展开侧栏 | |
| `⌘/` | 快捷键面板开关 | 面板开着再按要能关（toggle 收在同一个 handler，防重复监听秒开秒关） |
| `⌘S` / `⌘⇧S` | 保存 / 另存为 | 文档域，列出防冲突 |

实现纪律（ui-demo 已踩平，真 app 保持）：
- **弹层守卫**：任何 modal/面板开着时全局快捷键不穿透（`⌘/` 例外，它要能关自己的面板）。
- **未命中放行**：不属于表内的组合绝不 `preventDefault`；`⌘⌥*` 组合归编辑器（转块），不碰。
- handler 内**读实时 store 状态**（`getState()`），不吃闭包旧值——缩放/关标签都栽过闭包过期。
- 真 Electron 里 `⌘T/⌘W/⌘1-9` 建议同时注册**应用菜单加速键**（网页 demo 里这些会被浏览器吞，
  Electron 菜单级注册才稳）。

---

## 8. 会话恢复

**契约**：重启 app 后恢复全部标签（含 web 标签的 url/title/pinned）与上次激活标签。
不恢复：每标签的前进/后退栈、缩放值、查找条、`closedTabs` 重开栈、收藏区展开态（除非按 §13 决定持久化）。

**ui-demo**：zustand `persist.partialize` 把 `tabs + activeTabId` 一起落 localStorage。

**真 app**：并入现有标签持久化（workspace/tabs 恢复机制已在 `sidebar.js`）。web 标签恢复时
**懒加载**：先恢复标签行，激活到它时才创建 `WebContentsView` 并 loadURL（冷启动别把 N 个网页全拉起）。
注意既有教训：冷启动「恢复工作区」与外部打开文件有竞态，恢复流程要串行化（restoreReady 那套已在 main）。

---

## 9. 视觉与动效规格

- **设计语言**：纸方墨圆（canonical `docs/style.md`；token `ui-demo/src/styles/tokens.css`）。浏览器部分全部用 token，无裸色值（FavChip 的 hsl 算法色除外，那是数据驱动色）。
- 常用 token：面板底 `--c-surface`、边 `--c-border`、hover `--c-hover`、正文/次级/三级字色
  `--c-text/-2/-3`、强调 `--c-accent` + `--c-accent-tint`（星标实心、激活态）、圆角 `--r-sm/--r-md/--r-pill`、
  浮层影 `--shadow-pop`、动效 `--dur-fast + --ease / ws-pop-in / ws-fade-in`。
- 浮层（右键菜单/查找条/清除历史下拉）统一：surface 底 + border 细边 + `--shadow-pop` + `ws-pop-in` 入场。
- hover 反馈统一：透明 → `--c-hover` 底，字色升到 `--c-text`，`--dur-fast` 过渡。
- **图标索引（lucide，尺寸=px）**：
  导航条 `PanelLeft 15 / ChevronLeft 16 / ChevronRight 16 / RotateCw 13 / History 15 / Search 14`；
  地址栏 `Globe·Lock·FolderClosed 13 / Star 14`；补全下拉 `Globe2·Star·History 12`；
  收藏区 `Bookmark 13 / ChevronRight 12（.arc-caret，展开旋转 90°）`，FavChip 16×16；
  标签行 `Globe2·FileText 13 / Pin·PinOff·X 12 / Plus 14`；
  查找条 `Search 13 / ChevronUp·ChevronDown·X 14`；
  历史页 `ChevronLeft 18 / Search 14 / Trash2 14 / Globe2 13 / X 13`；
  收藏页 `ChevronLeft 18 / FolderPlus·Upload·Download·Trash2 14 / Globe2 14 / ExternalLink 13`。

---

## 10. 真 app 总体后端架构

### 10.1 进程分工

| 职责 | 归属 |
|---|---|
| 侧栏/地址栏/收藏区/标签行/起始页/历史页/收藏页/设置页（全部 UI） | renderer（app 自己的 DOM，非网页内容） |
| `WebContentsView` 创建/销毁/显隐/bounds、loadURL 白名单、导航、右键菜单、findInPage、zoom、printToPDF | 主进程 |
| 历史**记录**（导航事件驱动）、收藏/历史/favicon **持久化**、导入导出文件对话框 | 主进程 |
| normalize、自动补全、标签重排/置顶、折叠态等纯 UI 状态 | renderer |

### 10.2 WebContentsView 生命周期（每个 web 标签一个）

```
标签创建(⌘T→输入网址 / 点收藏 / 恢复会话激活) ──► 懒创建 view(首次真导航时)
  new WebContentsView({ webPreferences: {
      session: persist:webtabs,   // 与文档 iframe 的 session 隔离
      preload: 无,                 // 零 preload —— 网页内容拿不到任何 Wordspace API
      sandbox: true } })
激活标签 ──► contentView.addChildView(view) + setBounds(内容区整块：x=侧栏宽, y=0, 全高全宽)
            (订阅：侧栏拖宽/收起、窗口 resize → 重算 bounds；无网页头 → 无顶部偏移)
切走(激活了 doc/file/其他 web 标签) ──► removeChildView(隐藏；view 保活，保导航历史/滚动位置)
关闭标签 ──► webContents 销毁，释放内存（⌘⇧T 重开 = 按存的 url 重建，不复活旧 view）
```

事件接线（每个 view 建好即挂）：

| 事件 | 动作 |
|---|---|
| `page-title-updated` | 更新标签行/地址栏标题；补写历史头条目标题（§4.8） |
| `did-navigate` / `did-navigate-in-page` | push `webtab:state{url,title,canGoBack,canGoForward,everCommitted,navSeq}`；主进程记历史。**`navSeq` 每次真提交自增**——renderer 拿它认「新页刚真提交」的沿（错误页恢复重挂 view 靠它，见下方「加载失败占位与恢复」） |
| `page-favicon-updated` | 下载并缓存 favicon（§10.4），推给 renderer（标签行/收藏/历史图标） |
| `did-start/stop-loading` | 标签行 loading 态。**注意**：`did-start-loading` 会清 `error`；加载**收尾**（stop）**不等于提交**——中止型导航（-3 ERR_ABORTED：下载被 cancel、被后续导航打断、204）照样收尾但没提交,恢复重挂只认 `navSeq` 提交沿、绝不认 stop 沿（否则会把脱挂 view 里的失败页残帧盖上） |
| `did-fail-load`（主 frame，非 -3） | 分类为 error-page → push `error{code,desc,url}`；renderer 显 `#web-error` 占位 + 重试钮，并**摘掉空白 view**（`attachedKey=null`，别拿失败的空 view 盖内容区）。**-3(ERR_ABORTED)/子 frame 不算**（`classifyLoadFailure='ignore'`,不置 error、不换页面） |
| `render-process-gone` | 内容区崩溃占位 + 重新加载按钮（同 `#web-error` 通道） |
| `setWindowOpenHandler` | **deny** 弹窗；`target=_blank`/window.open 的 http(s) 链接 → 转成**前台新 web 标签**（浏览器惯例）；其余 scheme 丢弃 |
| `session.on('will-download')` | `item.cancel()` + toast「不支持下载」（下载已砍，§12） |
| `setPermissionRequestHandler` | **默认全拒**（摄像头/麦克风/地理位置/通知），v1 不做授权 UI |
| 证书错误 | 默认拒绝加载，不做「继续访问」旁路 |

### 10.3 IPC 面（建议频道名，语义为准）

```
renderer → main
  webtab:create {tabId}                    // 可选：懒创建时由 navigate 隐式完成
  webtab:navigate {tabId, url}             // url 已 normalize；main 白名单校验后 loadURL
  webtab:back / forward / reload {tabId}
  webtab:activate {tabId} / webtab:close {tabId}
  webtab:setBounds {rect}                  // 或 renderer 报告内容区 rect，main 存着给激活时用
  webtab:find {tabId, q, forward, findNext} / webtab:findStop {tabId}
  webtab:setZoom {tabId, factor}
  bookmarks:add/removeByUrl/removeOne/update/addFolder/renameFolder/removeFolder
  bookmarks:exportToFile / bookmarks:importFromFile      // main 弹系统对话框
  history:removeOne {id} / history:clear {range} / history:search {q, limit}

main → renderer (push)
  webtab:state {tabId, url, title, canGoBack, canGoForward, loading, favicon}
  webtab:findResult {tabId, matches, activeMatchOrdinal}
  bookmarks:changed {folders, bookmarks}   // 全量小数据，直接推全量最简单
  history:changed {entries}                // 或增量；≤500 条推全量也可接受
```

原则：**历史写入无 renderer 入口**（只由 main 导航事件驱动）；右键菜单动作在 main 单一收口白名单校验；
补全所需数据同步到 renderer 内存（逐键补全不跨 IPC）。

### 10.4 存储布局（userData 下，全本地）

| 文件 | 内容 | 写策略 |
|---|---|---|
| `browser-bookmarks.json` | `{version, folders[], bookmarks[]}` | 变更防抖 ~500ms，临时文件+rename 原子写（沿用 app 现有模式） |
| `browser-history.json` | `{version, entries[]}` cap 500 | 同上 |
| `favicons/` + 索引 | 按 origin 哈希存 png | 尽力而为缓存，丢了退 FavChip |
| 既有 settings 存储 | `browser.searchEngine` / `browser.homepage` | 走现有机制 |
| 既有 tabs 持久化 | web 标签 `{url,title,pinned}` 并入 | 走现有机制 |

### 10.5 与现有分支的关系

真 app 分支 `feat/browser-tabs`（PR #132，worktree `wordspace-next-browser`）已有可复用地基：
`src/main/web-tabs.js`（persist:webtabs、零 preload、sandbox、`openCtxMenu/executeCtxAction` 收口、
`WS2_CTXMENU_PROBE` 测试 seam）+ `src/lib/web-context-menu.js`（builder 双胞胎）+ 打包冒烟脚本。
**但该分支停在多轮 UX 定稿之前**——它的网页头、（若有）剪藏/收藏旧形态**不要照搬**，一律以本文档为准
（无网页头、侧栏折叠收藏区、砍除清单 §12）。

### 10.6 系统集成：默认浏览器（2026-07-13，Wendi 案「没法把 Wordspace 设成默认浏览器」）

真 app 独有（ui-demo 是网页 mock，没有系统集成面），三层：

1. **候选资格 = 打包声明**：`package.json` `build.protocols` 声明 `http`/`https`（electron-builder 生成
   `CFBundleURLTypes`）→ macOS 系统设置「默认网页浏览器」下拉才会列出 Wordspace。顺带
   `build.fileAssociations` 声明 `html`/`htm`（Finder「打开方式」不再要用户强选）。这份声明只活在
   **打包产物**里——dev 态（`npm start`）永远不出现在系统列表，验证要用装好的 .app。
   配置回归门：`test/default-browser-config.test.js`（谁删了 protocols 立刻红）。
2. **接收路由**：`app.on('open-url')`（main.js）→ scheme 白名单（复用 `web-tabs-policy.isAllowedNavUrl`，
   file:/javascript: 直接丢弃）→ 复用既有 `web-open-request` 通道建网页标签。冷启动（app 没开时点
   链接）：URL 进 `pendingOpenUrls` 队列等 `did-finish-load` 冲刷（与 open-file 同款），renderer 侧
   消费者再 `await __sbRestoreReady`——不等会被 loadTabs 的标签恢复**整体覆盖**（open-file 的
   `__pendingColdOpen` 同款竞态，变异实证会翻红）。测试 seam：`WS2_OPEN_URL`（走同一道白名单）。
3. **设置页入口**：设置页「默认浏览器」行 + 「设为默认浏览器」按钮
   （`browser-set-default`/`browser-default-status` IPC → `app.setAsDefaultProtocolClient`）。
   macOS 会弹**系统级确认框**，`setAsDefaultProtocolClient` 返回 true ≠ 用户已确认，UI 按「请在系统
   弹窗里确认」处理；dev 态按钮禁用（把 Electron.app 注册成系统 http handler 会污染开发机）。

真门：`e2e/default-browser.spec.js`（热路径 / 冷启动不覆盖恢复标签 / scheme 白名单，变异自检两刀均翻红）。
**欠账**：Windows/Linux 未做（Win 要安装器注册表 + `second-instance` argv 的 URL 解析，现只解析文件路径）。

---

## 11. 安全不变式（一条都不许松）

1. `persist:webtabs` session 与文档加载体系隔离；**web 内容零 preload、零 IPC 暴露**、`sandbox: true`。
2. 文档 iframe 的严格 CSP（`sandbox="allow-same-origin"` 无 `allow-scripts`）**一字不弱化**——那是文档
   安全模型，与网页标签是两套体系，别互相迁就。
3. **loadURL 白名单**：主进程只加载 `http:/https:`（+内部起始页 surface）。`file://`、`javascript:` 等
   一律拒绝（normalize 的 scheme 直通是 renderer 便利，不是加载授权）。
4. 右键菜单：危险 scheme 链接整节不出现；动作 id 白名单收口；拷贝链接先清洗跟踪参数。
5. 无下载（`will-download` cancel）；权限请求默认全拒；弹窗 deny（转标签）；证书错误不旁路。
6. 起始页安全提示文案保留（「内置浏览器没有恶意网站防护…」——产品口径，管理预期）。
7. **User-Agent 归一**（2026-07-14，Wendi 报「网页搜索总弹人机验证」）：`persist:webtabs` session 建立时
   `setUserAgent` 剥掉 Electron 默认 UA 里的 `Electron/<ver>` 和 app 名 token（`web-tabs.js` `ensureSession`，
   纯函数 `web-tabs-policy.js` `browserUA()`），归一成标准 Chrome UA。否则 Google 反滥用把非标准 UA 当 bot →
   `/sorry` 拦截页 + reCAPTCHA。只动这一个 session（不碰主窗口），不伪装 navigator、不引反检测库——内核本就是
   Chromium，只是把 UA 说实话。残余因素：IP 信誉/冷启动无 cookie 由 Google 侧决定，app 控不了（管理预期，非必现）。
   实测（e2e `/ua` 真实请求头）：sec-ch-ua 在测试环境未泄漏 Electron 品牌（null）；若将来真机观测到品牌泄漏，
   Electron 无干净 API 改 UA-CH，记欠账即可（UA 字符串是 Google 的主判定面）。

---

## 12. 明确砍掉的东西（别加回来）

| 功能 | 砍除时间/理由 |
|---|---|
| **剪藏 / 存为文档**（网页→Wordspace 文档） | 2026-07-09 Colin：鸡肋（原是 AI 调研里吹的卖点，复盘砍）。战略后果已接受：浏览器暂无独特卖点 |
| **下载** | 2026-07-09 Colin：不做，避免臃肿。右键菜单相应无「下载/存储图片」项；真 app 还要主动 cancel `will-download` |
| **阅读模式（Reader）** | 2026-07-10 Colin：我们没有「长文详情页」内容形态；该用它的野生网页反而够不着；用户看的是自己的干净文档。将来若做「正文提取/稍后读」用 Readability 重做，不捡旧的 |
| **网页态网页头**（锁+标题+域名条） | 2026-07-10 Wendi+Colin：冗余，地址栏已有 |
| **网页态顶部书签栏** | 2026-07-10：随收藏回侧栏一并删 |
| 标签总览 / 标签静音 | 跳过（与侧栏标签列表重复 / demo 无音频）；真 app 有需要再议 |

---

## 13. 已知 mock↔真 app 刻意差异 & 待拍板项

**刻意差异（真 app 按右列做）**

| 主题 | ui-demo（mock） | 真 app |
|---|---|---|
| 网页渲染 | mock 站组件 + iframe 尽力回退（含「无法内嵌」提示条） | `WebContentsView` 真加载，无提示条，mock 站不移植 |
| 右键菜单 | DOM 浮层（portal 演示同一结构） | **必须原生 `Menu.popup()`**（DOM 会被原生 view 盖住） |
| 页内查找 | `window.find()`，无计数 | `findInPage` + `found-in-page`，建议显示 N/M；注意浮层与 view 的层级（§4.6） |
| 缩放 | 全局单值 | **每标签** `setZoomFactor`，切标签恢复 |
| 关闭激活标签后的焦点 | 激活数组最后一条 | **激活相邻标签**（main #145 已定，以真 app 为准） |
| 历史记录触发 | 手动 `record()` 散点调用（右键开链接漏记、历史页开不记） | main `did-navigate` 统一自动记（天然全覆盖） |
| favicon | 无，一律 FavChip 首字彩块 | favicon 缓存优先，FavChip 兜底 |
| 导航历史栈 | 自维护 per-tab 栈 | `webContents.navigationHistory`，不自造 |
| 默认搜索引擎 | glass（虚构，demo 内能渲染结果页） | **Bing**（拍板） |
| 新标签页快捷瓦片 | 写死 7 个演示站（demo 需要「有网可上」素材） | **书签栏前 N 个收藏**（拍板），空态给引导 |
| normalize 网址判定 | 含 `.` 即当网址补 https:// | TLD 快照 + IP/localhost/端口**真验证**（Min urlParser 式；验不过走搜索——`localhost:3000`/`192.168.1.1` 能开、`file.txt` 不会误导航。语义超集，词→搜索/网址→导航的契约不变） |
| 权限请求 | 无（iframe 演示不触发） | default-deny + 极小白名单：fullscreen / pointerLock / clipboard-sanitized-write（无隐私面，视频全屏/网页复制按钮不坏）；摄麦/定位/通知/设备一律拒（§11.5 的「默认全拒」按此口径落地，2026-07-11） |
| ⌘/ 快捷键面板 | 有 | 暂无（app 本来就没有快捷键面板，属独立小 feature——欠账记在 `docs/features/browser.md`，其余 §7 键位全表已落地） |

**六项拍板结果（Colin 2026-07-10，全部已定，无遗留）**

1. **默认搜索引擎 = Bing**（真 app；demo 保持 glass，见上表）。
2. **「主页」设置删除**：起始页即主页，不做可配置主页。ui-demo 已删（设置行 + `homepage` 字段）。
3. **点收藏 = 已开该网址则聚焦（含置顶），否则新标签打开**。ui-demo 已实现（侧栏收藏区 + 收藏管理页同语义）。
4. **收藏区折叠态持久化**（记住上次，首次默认收起）。ui-demo 已实现（localStorage `ws-fav-open`）。
5. **新标签页瓦片 = 书签栏前 N 个收藏**（真 app；ui-demo 保留演示瓦片=刻意差异）。
6. **收藏夹导入修毛边**：重名文件夹**不合并**、加「名字 2」式后缀当两个文件夹（Colin 修正：同名≠同一个）；
   toast 报净新增数。ui-demo 已实现。**2026-07-14 温和修正（P3-10，Colin「按推荐」）**：同名且**内容完全相同**
   （url 集合相等）的文件夹视为同一份 → 跳过不造副本，「导出→原样导回」零翻倍；内容有差异仍加后缀。真 app
   `src/lib/bookmarks.js` `importNetscape` 已落地（ui-demo 侧待同步）。

**仍开放（非移植阻塞，挂着的更大命题）**
- 战略层：剪藏砍掉后浏览器没有独特卖点，定位=「够用的标准浏览器」（Colin 已接受现状，未补新融合主线）。
- 标签总览 / 静音标签：跳过未做，真 app 有需要再议。
- 真 app 移植完的质量门：打包冒烟、Windows 未测（`feat/browser-tabs` 分支自己的收尾活）。

---

## 14. 验收对齐清单（移植完逐条打勾）

- [ ] 侧栏自上而下 = 导航条 / 地址栏 / **收藏（折叠，置顶上方）** / 置顶 / 标签页 / 文档；无独立收藏平铺区、无网页态书签栏。
- [ ] 网页态**无网页头**，`WebContentsView` 铺满内容区（bounds 只随侧栏与窗口变化）。
- [ ] 收藏区：默认收起一行（栏标样式同置顶/标签页、计数、hover 才显管理入口、行尾 caret 常显展开旋转、无 Star）；对齐网格=栏标 8px/内容 10px；点行展开：书签栏平铺 + 文件夹分组 + FavChip；点书签=**已开则聚焦，否则新标签**；折叠态记住上次。
- [ ] 地址栏：状态图标按标签类型、星标只在网页标签、⌘D/☆ 落书签栏且取消=跨文件夹删、自动补全（标签→收藏→历史，≤6 条，↑↓/Enter/Esc，150ms 宽限）、非网页标签回车先开新标签。
- [ ] 导航条：后退/前进 disabled 实时、刷新仅网页、历史钮进历史页；在子页面点导航先回主视图。
- [ ] 标签：置顶无关闭钮、⌘W 守置顶、未保存先确认、关闭激活→**相邻**、拖拽跨组=置顶语义、⌘⇧T（15 条栈）、Ctrl+Tab 循环、⌘1-9、⌘T 二合一 modal、会话恢复（web 标签懒加载）。
- [ ] 右键菜单：**原生**、六分节按上下文、危险 scheme 整节滤、选中截 20 码点、拷贝清洗跟踪参数、动作主进程白名单收口、back/forward 灰态正确。
- [ ] 历史：main 自动记（http(s)、60s 合并、cap 500、back/forward 不记）；历史页按日分组/搜索/删单条/四档清除（清「最近 X」删的是新记录）。
- [ ] 收藏：管理页全功能（就地改名/移动/删除/书签栏固定）；Netscape 导入导出与 Chrome/Safari/Firefox/Edge 互通（宽松解析）；导入重名文件夹加后缀不合并、toast 报净新增。
- [ ] 设置：搜索引擎接进 normalize，真 app 默认 **Bing**；**没有**主页设置项。
- [ ] 新标签页瓦片取书签栏前 N 个收藏（空态有引导），不照搬 demo 演示站。
- [ ] 查找 `findInPage`（键位/循环/清除高亮）+ 缩放每标签（0.5–2、±0.1、⌘0）。
- [ ] 快捷键全表（§7）+ 弹层守卫 + 未命中放行。
- [ ] 安全不变式（§11）逐条核过：session 隔离/零 IPC/loadURL 白名单/下载 cancel/权限全拒/弹窗转标签。
- [ ] §12 砍除清单没有被做回来。

---

## 15. 决策日志

| 日期 | 决策 |
|---|---|
| 2026-07-09 | 浏览器开发全部先在 ui-demo 定稿，ui-demo = 真 app 的参考基准（Colin） |
| 2026-07-09 | 砍剪藏/存为文档；砍下载；跳过标签总览/静音（Colin） |
| 2026-07-09 | 右键菜单手感修正：菜单必须紧贴光标（portal 出 transform 祖先）；后退按钮要有实时 disabled |
| 2026-07-09 | 收藏做成网页态顶部书签栏（后被 07-10 推翻） |
| 2026-07-10 | 砍阅读模式 + 演示页（Colin） |
| 2026-07-10 | **删网页态网页头**（Wendi+Colin）；**收藏回左侧栏：置顶上方、默认收起点击展开**（Colin 三选一拍板） |
| 2026-07-10 | Glass=虚构搜索引擎的口径保留（避免「克隆了 Bing」误导） |
| 2026-07-10 | **六项拍板（Colin）**：真 app 默认引擎=Bing；删「主页」设置；点收藏=已开则聚焦；折叠态持久化；新标签瓦片=书签栏前 N；导入重名文件夹**加后缀不合并**（修正了最初「按名合并」的提议）+报净新增。除瓦片/引擎（真 app 侧）外均已同步实现进 ui-demo |
| 2026-07-11 | **真 app 全量移植落地**（`feat/browser-port`，按本文档 §14 逐条）。落地口径三则（进 §13 差异表）：权限 default-deny+三项无隐私白名单；normalize 用 TLD 真验证（语义超集）；⌘/ 面板暂缺记欠账。app 侧锚点/文件映射见 `docs/features/browser.md` |
| 2026-07-14 | **导入重名文件夹「温和修正」（P3-10，Colin）**：保持「不合并」原则，但同名+内容完全相同（url 集合相等）→ 跳过不造副本，「导出→原样导回」零翻倍；内容有差异仍加后缀。修订 §4.9 / §13 拍板#6 |

## 16. 源码索引（ui-demo 侧）

| 文件 | 内容 |
|---|---|
| `ui-demo/src/mock/browser.ts` | normalize/resolve、per-tab 导航栈、zoom |
| `ui-demo/src/mock/store.ts` | tabs/closedTabs/activeTabId、openWebTab/newBrowserTab/closeTab/reopenClosedTab/dropTab/togglePin、persist(tabs) |
| `ui-demo/src/mock/bookmarks.ts` | 收藏 store + Netscape 导入导出 |
| `ui-demo/src/mock/history.ts` | 历史 store（recordable/60s 合并/cap/search） |
| `ui-demo/src/mock/browserSettings.ts` | 引擎/主页设置 |
| `ui-demo/src/lib/webCtxMenu.ts` | 右键菜单纯逻辑 builder + cleanShareUrl + trunc |
| `ui-demo/src/components/ArcSidebar.tsx/.css` | 侧栏全部：导航条/地址栏+补全/收藏区(.arc-fav+FavChip)/标签条/快捷键 handler |
| `ui-demo/src/components/WebView.tsx/.css` | 网页态外壳（无头）、查找条、缩放、右键接线、iframe 回退(demo) |
| `ui-demo/src/components/WebContextMenu.tsx/.css` | DOM 菜单（portal/翻转/关闭时机） |
| `ui-demo/src/components/NewTab.tsx/.css` | 起始页 |
| `ui-demo/src/components/CreateModal.tsx` | ⌘T 二合一新建 modal（omni 态） |
| `ui-demo/src/components/HistoryPage.tsx/.css` | 历史页 |
| `ui-demo/src/components/BookmarksPage.tsx/.css` | 收藏管理页 |
| `ui-demo/src/components/Settings.tsx` | 设置·浏览器区 |
| `ui-demo/src/components/MockSites.tsx/.css` | demo mock 站（不移植）；`nav()` 的 ⌘点后台开标签参考 |
| `ui-demo/src/types.ts` / `src/App.tsx` | Tab 类型 / 路由与 MainDocs 分流 |

真 app 侧实现已按本文档落地（2026-07-11，`feat/browser-port`）——完整文件映射维护在
`docs/features/browser.md`；旧试验分支 `feat/browser-tabs`（PR #132）已被取代，别再照搬。

*本文档随 ui-demo 浏览器 feature 演进；改了功能记得同步这里（尤其 §4 契约、§12 砍除、§13 待拍板）。*
