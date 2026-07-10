# Wordspace 浏览器 Feature —— UI/UX + 交互 + 前后端对齐规范

> **这份文档的用途**：ui-demo（`ui-demo/**`，React/TS/Vite 原型）已经把「Wordspace 也是个浏览器」这套
> UI/UX、交互逻辑、图标、数据模型都定下来了。ui-demo 是**权威参考、领先真 app**（Colin 2026-07-09 拍板：
> 浏览器所有开发先在 ui-demo 定稿，再移植进真 Electron app `src/**`）。
> 接手把它做进真 app 的 AI/人，请以本文档 + ui-demo 源码为准，逐条对齐。
>
> **读法**：先读第 1、2 节（心智模型 + 两套代码怎么对应），再按第 4 节逐个功能实现。
> 第 6 节是真 app 侧已知的硬约束和坑，动手前必读。第 7 节是**明确砍掉、别加回来**的东西。

---

## 1. 心智模型：Wordspace = 文档编辑器 + 浏览器，一整套

Wordspace 是本地优先的 HTML/md 文档编辑器，同时**它自己也是个浏览器**（样式参照 Arc）。
关键点：文档和网页**共用同一套标签系统、同一个侧栏、同一条地址栏**——它们不是两个 app 拼一起，
是一整套。用户在同一个侧栏里既能开自己的 `.html` 文档，也能开一个真网页，标签混装。

一个标签（`Tab`）有三种 `kind`：
- `doc` —— 一篇文档（本地 `.html`/`.md` 或云端），进块编辑器。
- `web` —— 一个网页（新标签页 / 我们的 mock 站 / 真外部 URL），进浏览器视图。
- `file` —— 从打开的文件夹里打开的非 HTML 文件（pdf/图片/docx…），进「用默认程序打开」面板。

地址栏对这三种都在：文档态显示本地路径 / 发布链接，网页态显示 URL。

---

## 2. 两套代码怎么对应（契约 vs mock 实现）

| 维度 | ui-demo（原型） | 真 app（要做成的） |
|---|---|---|
| 技术栈 | React 18 + Zustand + React Router(HashRouter) + Vite + 纯 CSS | Electron + 原生 DOM/renderer（`src/renderer/**`）+ 主进程（`src/main/**`） |
| 网页渲染 | `<iframe>`（mock 站是 React 组件；真 URL 用 iframe，多数被 X-Frame-Options 拦） | **Electron `WebContentsView`**（`session: persist:webtabs`，zero preload，`sandbox:true`），罩在文档 UI 之上 |
| 「开着的网站」 | 4 个手写 mock 站（公司/SaaS/新闻/搜索），让 demo 里「有网可上」 | 真 `WebContentsView` 直接加载真 URL；mock 站不用移植（它们只是 demo 素材） |
| 收藏/历史/设置存储 | `localStorage`（zustand `persist`） | 磁盘 JSON / `electron-store` / session |
| 标签会话恢复 | `persist` 把 `tabs`+`activeTabId` 存进 localStorage | 已有的重启恢复机制（`src/renderer/sidebar.js` 的 tabs 持久化） |
| 右键菜单 | DOM 浮层（`WebContextMenu.tsx`） | **原生 `Menu.buildFromTemplate().popup()`**（DOM 菜单会渲染在 WebContentsView 下面，见 §6） |

**哪些是必须 1:1 对齐的契约**（用户能感知的一切）：
布局、图标、文案、交互时序、快捷键、右键菜单分节与条目、地址栏行为、书签栏出现/消失的时机、
Netscape 书签互通格式、自动补全优先级、缩放步长、砍掉的功能。

**哪些是 mock 实现细节**（真 app 用不同技术达到同样行为，不用照抄代码）：
zustand store 的具体 action、localStorage 的 key、mock 站组件、`<iframe>` 那套 best-effort 回退。

---

## 3. 地址栏输入的处理管线（`ui-demo/src/mock/browser.ts`）

这是浏览器的大脑，真 app 要有等价逻辑。两个纯函数：

**`normalize(input) -> url`** —— 把用户敲的东西变成规范 URL：
- 已有 scheme（`http(s)://` / `glass://` / `wordspace://`）→ 原样。
- 含空格 **或** 不含 `.` → 当搜索词，走当前默认搜索引擎（`browserSettings.searchUrl`）。
- 其余（裸 host/path）→ 补 `https://`。
- 空 → 新标签页（`wordspace://newtab`）。

**`resolve(url) -> { kind, siteKey?, query?, title }`** —— 把规范 URL 分类成要渲染什么：
- 空 / `wordspace://newtab` / `wordspace://home` → `newtab`（新标签页）。
- `glass://…` → 搜索页（`glass` 是 ui-demo 虚构的搜索引擎，**不是 Bing/Google**，故意虚构避免误导）。
- 命中已知 mock host → 对应 mock 站。
- 其余 → `web`（真 iframe / 真 app 里就是 WebContentsView 加载真 URL）。

> 真 app 对应：`normalize` 逻辑照搬（搜索引擎设置驱动）。`resolve` 里「mock host → mock 站」这一支不用移植；
> 真 app 只需区分「newtab / 真 URL」，真 URL 直接给 WebContentsView。`glass://` 搜索页真 app 里可以是
> 一个内置的本地起始/搜索页，或直接映射到用户选的搜索引擎结果页。

**每个标签独立的前进/后退历史**：`browser.ts` 的 `BrowserState.history` 是 `{ [tabId]: { stack, index } }`。
`navigate` 首次会把标签当前页作为历史起点（否则点链接跳走后 back 无处可退）。真 app 里 `WebContentsView`
的 `webContents` 自带导航历史，直接用它的 `goBack/goForward/canGoBack/canGoForward`，不用自己维护栈。

---

## 4. 逐功能规格

每条：**长啥样 → 怎么交互 → ui-demo 实现 → 真 app 对应**。

### 4.1 顶栏导航条（`ArcSidebar.tsx` `.arc-top-nav`）
- **长啥样**：侧栏最顶，一排图标钮：收起侧栏 `PanelLeft` / 后退 `ChevronLeft` / 前进 `ChevronRight` /
  刷新 `RotateCw` / 历史 `History` / 查找文件 `Search`(⌘P)。左上角有 mac 红黄绿灯装饰。
- **交互**：后退/前进按**当前标签能不能导航**显示 disabled 态（`canBack`/`canFwd` 响应式）。
  历史钮进 `/history` 页。查找文件是命令面板（⌘P，找本地文件，跟网页无关）。
- **ui-demo**：`goBack/goForward/reload` 调 `useBrowser`，然后 `navigate('/docs')` 回到主视图。
- **真 app**：后退/前进/刷新映射到 active `WebContentsView` 的 `webContents.goBack()/goForward()/reload()`；
  disabled 态读 `canGoBack()/canGoForward()`。文档态（doc tab）这些钮作用于文档视图（无网页导航）。

### 4.2 地址栏 omnibox（`ArcSidebar.tsx` `.arc-omni`）
- **长啥样**：导航条下方一条。左侧状态图标随标签类型变：网页=`Globe`、已发布文档=`Globe`(绿)、
  内部文档=`Lock`、本地文档=`FolderClosed`。中间是输入框。网页态右侧有收藏星标 `Star`。本地文档显示「本地」小标签。
- **交互**：
  - 敲字弹**自动补全下拉**，来源按优先级：开着的网页标签 → 收藏 → 历史（去重，最多 6 条）。
    `↑/↓` 选、`Enter` 走选中项或输入内容、`Esc` 收起。建议项图标：收藏=`Star`、历史=`History`、标签=`Globe2`。
  - 回车：若当前不是网页标签，先 `newBrowserTab()` 再 `navigate`（即在新标签里开）。
  - `⌘L` 聚焦并全选地址栏。
- **ui-demo**：`omniSug` 是 `useMemo`（从 tabs/bookmarks/history 算）；`submitOmni` 处理回车/选中。
- **真 app**：自动补全数据源换成真的（打开的 WebContentsView 标签 + 磁盘收藏 + 磁盘历史）。回车走 §3 的 `normalize`。

### 4.3 标签页：置顶 / 普通 / 拖拽 / 会话恢复 / 关闭重开（`store.ts` + `ArcSidebar.tsx` TabStrip）
- **长啥样**：侧栏两个区，「置顶」在上、「标签页」在下。每个标签一行（图标+标题+置顶钮`Pin`/`PinOff`+关闭钮`X`）。
- **交互**：
  - 拖标签到「置顶」区=置顶，拖到「标签页」区=取消置顶，区内拖=重排（`dropTab` 一次搞定 pinned 状态+位置）。
  - 关闭：`⌘W`（置顶标签不关，同浏览器惯例；未保存文档先弹确认）。关掉的非临时标签进 `closedTabs` 栈（上限 15）。
  - `⌘⇧T` 重开最近关闭的标签（`reopenClosedTab`）。
  - `⌘1~9` 直达第 N 个标签（9=最后一个，浏览器语义）。
  - **会话恢复**：刷新/重开 app 后恢复上次开着的标签 + 激活标签（`persist` 的 `partialize` 含 `tabs`+`activeTabId`）。
- **真 app**：真 app 已有等价的标签系统（`src/renderer/sidebar.js`：open/pinned 双标记、重启恢复、拖拽、
  外部文件 `↗` 标签、`keyOf=rel||abs` 身份）。网页标签接进这套：一个 web 标签绑一个 `WebContentsView`。
  关闭标签要销毁对应的 view。会话恢复要连 web 标签的 URL 一起存/恢复。

### 4.4 网页态外壳：网页头（`WebView.tsx` WebChrome）
- **长啥样**：网页内容上方一条细「网页头」：安全指示（`https`/`glass`/`wordspace` 显示 `Lock` 绿锁，
  否则 `Globe` 灰）+ 页面标题 + 域名。跟文档的面包屑同一个壳（视觉统一）。
- **真 app**：这条网页头是 Wordspace 自己的 chrome，**罩在 `WebContentsView` 上方**（不是网页的一部分）。
  真 app 已有 `#web-header` 这层。安全指示读 `webContents.getURL()` 的协议 + 证书状态。

### 4.5 书签栏（网页态才出现）（`WebView.tsx` BookmarkBar + `WebView.css` `.web-bmbar`）
> **这是 2026-07-09 的重要决定**：收藏**不放侧栏**（侧栏已有置顶/标签页/文档，再加收藏太臃肿，
> 且「置顶」和「收藏」概念重叠）。改成 Chrome/Edge 式的**书签栏**——**只在浏览网页时**出现在网页头下方，
> 回到文档就消失（收藏跟「上网」场景绑定）。Arc 本身没有独立书签（置顶标签=书签），我们取了折中：侧栏干净 + 网页态书签栏。
- **长啥样**：网页头下方一条横栏。平铺「书签栏」文件夹（`BM_BAR`）里的收藏（每项=首字母彩块+标题），
  其余非空文件夹收成带 `ChevronDown` 的 `Folder ▾` 下拉，最右一个 `Bookmark` 图标进收藏管理页。空态显示提示文字。
- **交互**：左键点书签=在**当前标签**打开（不堆标签）；`⌘/Ctrl` 点=后台开新标签。文件夹钮点开 popover（点外部关闭）。
- **图标细节**：书签没有真 favicon，用**标题首字**+ 从 URL hash 出的稳定色当小图标（比灰地球更好认）。
- **ui-demo**：`BmFavicon` 组件自绘首字母块。popover 用普通绝对定位（注意父容器别设 `overflow:hidden`，会裁掉下拉——踩过）。
- **真 app**：书签栏在网页态渲染（doc/newtab 态不出现）。真 app 有真 favicon 的话优先用 favicon，回退首字母块。
  点书签=当前 WebContentsView 导航到该 URL；⌘点=新建 web 标签后台加载。

### 4.6 收藏（星标 + 管理页 + Netscape 导入导出）（`bookmarks.ts` + `BookmarksPage.tsx`）
- **加/删**：网页态地址栏的 `Star`（`⌘D` 也行）。默认落「书签栏」文件夹 → 直接出现在书签栏上。
- **管理页 `/bookmarks`**：文件夹分组、增删改、移动、导入、导出。
- **跨浏览器互通（重要契约）**：导入导出用 **Netscape Bookmark File Format**（`<!DOCTYPE NETSCAPE-Bookmark-file-1>`，
  嵌套 `<DL>`，`<DT><H3>` 文件夹，`<DT><A HREF ADD_DATE>` 书签，书签栏文件夹标 `PERSONAL_TOOLBAR_FOLDER="true"`，
  `ADD_DATE` 是 Unix 秒）。**能吃 Chrome/Safari/Firefox/Edge 导出的书签文件，也能导给它们。**
  解析要宽松：Netscape HTML 闭标签故意不闭合，**不能当 XML 解**，用 `DOMParser` 的 `text/html`。实测吃过 Chrome 导出文件。
- **ui-demo**：`toNetscapeHtml`/`fromNetscapeHtml` 在 `bookmarks.ts`。数据结构 `Bookmark{id,title,url,folderId,addedAt,favicon}` + `BmFolder`，`BM_BAR='bm-bar'` 是书签栏特殊文件夹。
- **真 app**：数据落磁盘 JSON。导入导出 format 逻辑照搬（这是互通契约，一字别改）。

### 4.7 历史（`history.ts` + `HistoryPage.tsx`）
- **交互**：主动导航才记（back/forward 不记）。`/history` 页按天分组 + 搜索 + 删单条 + 按时段清空。
- **ui-demo**：`HistEntry{id,url,title,visitedAt,favicon}`，上限 500，只记 `http(s)`/`glass://search`。
- **真 app**：记 `WebContentsView` 的 `did-navigate`。落磁盘。上限/清除逻辑照搬。

### 4.8 右键菜单（`webCtxMenu.ts` 纯逻辑 + `WebContextMenu.tsx` 渲染）
- **长啥样/交互**：网页里右键，按光标下的**真实 DOM**（链接/图片/选中文字/编辑框）算出菜单，六分节按序：
  链接 → 图片 → 选中 → 编辑框 → 导航 → 页面。节内条目无对应上下文时整节不出现，节间一条分隔符。
  - 链接节：在新标签页打开链接 / 在后台标签页打开链接 / 拷贝链接。
  - 图片节：拷贝图片 / 拷贝图片地址（**下载已砍**，见 §7）。
  - 选中节：拷贝 / 用 Glass 搜索「…」（选中文字按码点截断 20 字，不切 emoji）。
  - 编辑框节：剪切/拷贝/粘贴/全选。
  - 导航节：返回（`canGoBack` 决定 enabled）/ 前进 / 重新加载。
  - 页面节：拷贝页面链接 / 导出 PDF。
- **安全**：危险 scheme 链接（`javascript:`/`data:`/`file:`）整个链接节不出——只放行 `http(s)`。
- **拷贝清洗**：拷链接前删追踪参数（`utm_*`/`fbclid`/`gclid`…），功能参数（`?id=`）保留（`cleanShareUrl`）。
- **真 app**：`webCtxMenu.ts` 是纯逻辑，真 app 有对齐的 `src/lib/web-context-menu.js`（`buildCtxTemplate`）。
  **必须用原生 `Menu.buildFromTemplate().popup()`**，不能用 DOM 菜单（DOM 会渲染在 WebContentsView 下面，见 §6）。
  监听 `webContents.on('context-menu', (e, params) => …)`，`params` 直接给链接/图片/选中/可编辑信息。

### 4.9 网页内查找 Cmd+F（`WebView.tsx` web-find）
- **交互**：网页态 `⌘F` 弹右上角查找条，输入 + `Enter`/`⇧Enter` 上下一个 + `Esc` 关。
- **ui-demo**：mock 站是同文档 DOM，用 `window.find()`（演示够用）。
- **真 app**：用 `webContents.findInPage()`/`stopFindInPage()`（Electron 原生页内查找）。

### 4.10 缩放 Cmd +/-/0（`browser.ts` zoom）
- **交互**：仅网页标签。`⌘+`/`⌘-` 步进 0.1，`⌘0` 复位。范围 0.5~2。
- **真 app**：映射到 `webContents.setZoomFactor()`。

### 4.11 搜索引擎 / 主页设置（`browserSettings.ts` + `Settings.tsx`）
- **设置页**「浏览器」区：默认搜索引擎（Glass/Bing/Google/DuckDuckGo）+ 主页。
- 搜索引擎接进 §3 的 `normalize`（地址栏敲一句话就用它搜）。
- **真 app**：落磁盘。搜索引擎列表可扩展。

---

## 5. 快捷键全表（真 app 必须一致）

| 快捷键 | 作用 | 条件 |
|---|---|---|
| `⌘L` | 聚焦并全选地址栏 | 总是 |
| `⌘F` | 网页内查找 | 网页标签（文档标签是文档内查找） |
| `⌘⇧F` | 聚焦左侧文件筛选框 | 总是 |
| `⌘P` | 查找文件（命令面板） | 总是 |
| `⌘D` | 收藏 / 取消收藏当前网页 | 网页标签 |
| `⌘W` | 关闭当前标签 | 非置顶；未保存文档先弹确认 |
| `⌘⇧T` | 重开最近关闭的标签 | 有关闭栈 |
| `⌘ +` / `⌘ -` / `⌘0` | 网页缩放 增 / 减 / 复位 | 网页标签 |
| `⌘1`~`⌘9` | 直达第 N 个标签（9=最后） | 总是 |

> mac 用 `⌘`，Windows/Linux 用 `Ctrl`（ui-demo 有 `IS_MAC` 判断，真 app 同理）。

---

## 6. 真 app 侧已知约束 & 坑（动手前必读）

来自真 app 浏览器分支 `feat/browser-tabs`（worktree `wordspace-next-browser`，未合 main）的实战教训：

1. **网页用 `WebContentsView`，不是 iframe**。`session: persist:webtabs`（和文档 iframe 的 session 隔离）、
   **zero preload**（网页内容不注入任何 Wordspace API）、`sandbox: true`。这是安全边界：**web 内容零 IPC 暴露**。
2. **右键菜单必须原生**。WebContentsView 是独立的原生视图，**罩在 DOM 之上**——任何 DOM 浮层（包括 ui-demo 那种
   `WebContextMenu`）都会渲染在它**下面**、被网页盖住。所以网页右键菜单只能用主进程 `Menu.buildFromTemplate().popup()`。
   `src/main/web-tabs.js` 里 `openCtxMenu`/`executeCtxAction` 是单一收口，`wc.on('context-menu', …)` 触发。
3. **CSP 一字不弱化**。文档 iframe 的严格 CSP（`sandbox="allow-same-origin"` 无 `allow-scripts`）是给本地文档的，
   跟 WebContentsView 是两套加载机制、两套安全模型，别混。
4. **打包后 userData 解析坑**（血泪）：`app.getName()` 读 `package.json` 顶层 `productName`（否则 `name`）；
   electron-builder 的 `build.productName` 只设 Info.plist 的 CFBundleName，**不改运行时 `app.getName()`**。
   打包冒烟测试要隔离 userData，否则会撞生产实例的单实例锁 / 动到生产数据。用 afterPack 改 asar 里的 package.json
   （不是 `extraMetadata`——那会污染源 package.json）。
5. **验证前先 `pkill` 残留 electron**（单实例锁会让 `npm start` 撞锁秒退），且**只杀 `node_modules/electron`**，
   绝不碰生产的 "Wordspace Next" 进程和它的 userData（`~/Library/Application Support/wordspace-next`）。
6. **并发 session 各开 worktree**（共享目录切分支会劫持工作树）。

真 app 相关文件（`feat/browser-tabs`）：`src/main/web-tabs.js`、`src/lib/web-context-menu.js`、
标签系统在 `src/renderer/sidebar.js`。**注意**：真 app 那个分支停在书签栏改造**之前**的状态——
它的收藏/阅读模式（如果有）要按本文档 §4.5 的书签栏方案 + §7 的砍除清单重新对齐，别照搬旧的。

---

## 7. 明确砍掉的东西（别加回来）

Colin 逐个拍板砍的，移植时**不要**做进真 app：

- **剪藏 / 存为文档**（把网页存成 Wordspace 文档）——2026-07-09 判定鸡肋（原是 AI 在融合调研里提的、被吹成
  「做浏览器的唯一正当理由」，复盘后砍）。战略后果：浏览器目前没有独特卖点，定位=「够用的标准浏览器」。
- **下载**——不做，避免 Wordspace 臃肿。右键菜单的「下载图片/存储图片」也一并砍了（只留拷贝图片/拷贝图片地址）。
- **阅读模式（Reader）**——2026-07-09 砍。理由：① 我们产品里没有「长文详情页」这种内容（阅读模式的唯一主场）；
  ② 真正该用它的野生脏网页，我们要么内嵌不了（X-Frame-Options）、要么（对真 WebContentsView/iframe）跨域够不着；
  ③ 用户看的多是自己的干净文档，不需要清理。若将来真做「网页正文提取 / 稍后读」，用正经 Readability 算法重做，别捡这个。
- **标签总览 / 静音标签**——跳过（和侧栏标签列表重复、mock 无音频）；真 app 如需再议。

---

## 8. 对齐检查清单

移植到真 app 后逐条核对（用户能感知的都要一致）：

- [ ] 侧栏只有三块：置顶 / 标签页 / 文档（**没有**独立收藏区）。
- [ ] 书签栏只在浏览网页时出现在网页头下方，回文档消失；平铺书签栏文件夹 + 其余文件夹 ▾ 下拉 + 管理入口。
- [ ] 书签左键当前标签打开、⌘点后台新标签；无 favicon 用首字母彩块。
- [ ] 地址栏：状态图标随标签类型变、自动补全（标签→收藏→历史优先级）、⌘L 聚焦、星标收藏。
- [ ] 顶栏后退/前进按能否导航显示 disabled；历史钮进历史页。
- [ ] 右键菜单六分节、危险 scheme 过滤、拷贝清洗追踪参数、**原生 Menu**。
- [ ] 收藏/历史/设置落磁盘；收藏导入导出走 Netscape 格式、和主流浏览器互通。
- [ ] 快捷键全表一致（§5）。
- [ ] 网页内查找用 `findInPage`、缩放用 `setZoomFactor`。
- [ ] WebContentsView：persist:webtabs / zero preload / sandbox / web 内容零 IPC。
- [ ] 砍掉的东西（§7）没有被做进去。

---

*源码位置*：ui-demo 浏览器相关 = `ui-demo/src/mock/{browser,bookmarks,history,browserSettings,store}.ts` +
`ui-demo/src/components/{ArcSidebar,WebView,WebContextMenu,MockSites,NewTab,HistoryPage,BookmarksPage,Settings}.tsx` +
`ui-demo/src/lib/webCtxMenu.ts` + `ui-demo/src/types.ts`（`Tab`）+ `ui-demo/src/App.tsx`（路由）。
*本文档随 ui-demo 浏览器 feature 演进，改了功能记得同步这里。*
