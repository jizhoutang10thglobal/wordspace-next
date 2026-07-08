---
title: 文档互链进真 app——按 ui-demo 已验收交互移植
status: active
date: 2026-07-08
origin:
  - ui-demo 原型（行为权威）：PR #134/#135/#137/#138，Colin 三轮实测验收通过
  - 方案调研（架构权威）：doc-linking 调研 Artifact（四路调研 + 8 缺口收口，2026-07-08）
---

# 文档互链进真 app（@提及 / 点击导航 / 悬停预览 / 反链 / 改名重写 / 断链修复 / 删除守卫）

## 0. 一句话与铁律

把 ui-demo 已验收的文档互链全套 UI/UX **原样**移植进真 app（`src/`，vanilla JS + Electron）。
**ui-demo 是行为权威**：交互长什么样、什么时候弹、什么文案，一律以 ui-demo 现状为准（见 §2 对照清单）；
本文档只规定真 app 架构下**怎么实现同样的行为**，以及三轮对抗审查 + Colin 实测烧出来的硬教训（§7，全部 must-carry）。

铁律（违反任何一条 = 返工）：

1. **磁盘字节 = 纯净相对路径 `<a href="../notes/另一篇.html">链接文字</a>`，零自定义属性、零 class、零 data-\*。**
   浏览器裸开可跳、md 保持 `[text](path)` 原生（md 适配器属性白名单只有 href/title，任何多余属性会让整块降级 HTML 岛，
   见 `src/main/md-adapter.js` REPRESENTABLE ~:173）。编辑器内的一切视觉（提及淡底、断链红虚线）都是**编辑态装饰**，
   走 constructable stylesheet / CSS Custom Highlight（技法见 `src/editor/find.js`），绝不落盘。
   ui-demo 里 `class="ws-doclink"` + `contenteditable="false"` 落进 block.html 是 demo 妥协，真 app **不许**。
2. **链接文字 = 插入时的标题快照**。目标改名不回写各处文字；hover 卡显示目标当前标题（展示层跟随）。
3. **反链/解析 = 可丢弃索引缓存**（主进程，userData JSON），绝不写进用户文件；提供重建逃生门；文件永远是唯一真相。
4. **改名/移动自动重写引用默认开**，toast「已更新 N 篇文档里的链接 · 撤销」；**撤销 = 反向再重写（invertMoves），
   绝不存快照整体回滚**（会吞撤销窗口内的用户编辑）。
5. **CSP**：renderer `style-src 'self' file:` 无 unsafe-inline——inline `<style>`/`setAttribute('style')`/`cssText` 全被拦；
   `el.style.prop=` 单 CSSOM setter 与 constructable stylesheet 安全（已有实证：`menu.style.left`、find.js 高亮表）。
6. **v1 范围**：单根（真 app 现状）、块编辑器创建面、全文档消费面。不做：transclusion、块级引用、database relation、
   跨根链接、unlinked mentions、chip 视觉（显示按原生的冻结决策）。

## 1. 为什么先修一个 P0（U0 必须第一个做、独立可发布）

**现状是数据损坏路径**（代码勘察实证，基于 origin/main）：文档里的 `<a>` 点击今天无人拦截——
renderer 无 click 守卫、main 无 `will-navigate`/`will-frame-navigate`（全仓 grep 零命中）、
iframe `sandbox="allow-same-origin"` 不禁自导航、父页 CSP `frame-src file:` 放行。
块编辑态下点一个相对链接 → iframe 自己导航到目标页 → `loadFromFile` 的 `frame.onload` 只守 loadGen 不守 URL
（`src/renderer/shell.js` ~:395）→ **编辑器错挂到新页面、docPath 仍指旧文件 → 1.2s 自动保存把 B 页内容写进 A 文件**。
U0 把导航收口，同时消掉这颗雷——这也是互链「点击打开」的地基。

## 2. 行为权威：ui-demo 对照清单（= 验收标准）

实现前先跑一遍 ui-demo（`cd ui-demo && npm run preview`，开局即「产品规划.html」演示文档），下表每行都要在真 app 复刻：

| # | 行为 | ui-demo 参照实现 |
|---|---|---|
| B1 | 正文输 `@` / `[[` / `【【`（全半角）→ caret 下弹文档选择菜单；打字即筛（标题+路径）、↑↓ Enter、Esc 关；拼音组字中的 Enter/方向键归输入法 | `ui-demo/src/components/Canvas.tsx` mention 触发 effect + `canvas/MentionMenu.tsx` |
| B2 | 菜单条目两行（标题 + 根内路径消歧）、文档在前其它文件在后（pdf/表格/图片带类型图标）、尾部「新建 \"query\"」+「网址链接…」 | `mentionItems` useMemo + MentionMenu |
| B3 | 选中 → 删掉「触发符+query」→ 插入提及（原子、蓝色淡底、后跟一个空格落 caret）；「新建」建在当前文档同目录、不切走标签页、toast 带「打开」 | `applyMention` |
| B4 | 斜杠菜单「🔗 链接到文档」条目（**在可视区内，不用滚动**）→ 同一个选择菜单 | `SLASH_ITEMS` doclink + `applySlash` |
| B5 | 选中文字 → 格式气泡 🔗 → 同一菜单（wrap 模式：**选中文字变链接、保留用户文字**）；无文件身份才退回网址 prompt | `applyCmd('createLink')` |
| B6 | 侧栏文件拖进正文 → 落点插入链接；落在空白/装饰处 → 兜底插最近文字块末尾；跨根 → toast 明确拒绝，绝不静默 | `onBlocksDragOver/Drop` + ArcSidebar dragstart `effectAllowed='all'` |
| B7 | 点击互链 → 应用内打开目标（非文档文件 → 系统程序面板）；http(s) → 系统浏览器（真 app 语义）；mailto/解析不了 → 拦下不动作 | `onBlocksClickCapture` |
| B8 | 悬停 350ms → 预览卡（标题+前几块摘句+路径+「打开」）；非文档文件 → 类型说明卡；移入卡片不消失（250ms 宽限） | `canvas/LinkPreview.tsx` |
| B9 | 断链 = 红色虚线装饰；悬停/点击 → 修复卡：「重新指向 <同名候选>」×N +「在 <目录> 新建 <名字>」（尊重 .md 扩展名）；修完自愈变蓝 | 断链装饰 effect + LinkPreview broken 面 |
| B10 | 标题区下「N 篇文档链接到这里」折叠行（0 条整体隐藏）→ 展开来源列表（标题+上下文摘句），点击跳转 | `canvas/Backlinks.tsx`（app chrome，不进文档字节） |
| B11 | 改名/移动文件（含所在文件夹改名）→ 指向它的 href 自动重写 + toast「已更新 N 篇 · 撤销」；撤销=名字回滚+反向重写；被后续操作覆盖时明说放弃 | store `renameFile/moveFile/renameDir` |
| B12 | 删除有反链的文件/文件夹（夹外引用才算）→ 守卫弹窗列出来源；「⋯」菜单删除同样走守卫（无旁路） | `DeleteLinkedModal` + ArcSidebar/DocMenu 分流 |

## 3. 真 app 架构落点（勘察实证；行号按 origin/main 当时快照，实现时以现场为准）

- **渲染两路**：`.html` → `frame.src = fileUrl` 直载（`shell.js` loadFromFile ~:391）；`.md`/临时/历史 → `srcdoc` + `injectBase`（~:99, :483-496, md 分流 :611-614）。iframe `sandbox="allow-same-origin"`（index.html ~:140），无 allow-scripts——**文档内脚本不跑，一切逻辑在父层**，父层可自由操作 `contentDocument`（blockedit/basic-edit/find 全是这个模式）。
- **编辑器**：合规 → `WS2BlockEdit`（父层，`src/editor/blockedit.js`）；非合规 → `basic-edit.js`（body 整体 contenteditable）。路由 seam：`shell.js` routeDoc。
- **父层浮层套路**（提及菜单/预览卡/守卫弹窗全用它）：抄 `basic-edit.js` 的 `frameEl`/`frameRect()`/`toHost()` + `position:fixed` append 到父 `document.body`；iframe 内坐标 → 父层坐标要加 frame offset。样式进 `shell.css`。参考成品：`src/editor/find.js`（WS2Find 查找条）。
- **Schema 约束**（`src/lib/schema-validate.js` UNSAFE_SCHEME :14）：相对路径 href 天然合规；`file:` 绝对链接判非合规（跨根天真方案已死）；validator 不管 class/meta——但铁律 1 仍然要求磁盘零装饰。
- **改名/移动挂钩点（重写引用挂这里）**：app 内改名 `sidebar.js` commitRenameOp（→ ipc `ws-rename` → `workspace.js` renamePath）；移动 doMove（→ `ws-move`）；**外部改名** `workspace-watcher.js` fs.watch 去抖 → `onTreeChanged` 全量重读 + **inode 匹配**识别 rename（`lib/tabs.js` reconcileTree ~:150）。三条路都拿得到 oldRel→newRel。
- **自写去重**：主进程重写用户文件后必须走 `doc-watcher.js` noteSelfWrite（mtime 记账，:23）防止触发误重载；每次写盘照常走 history 归档（`ipc.js` save 路径的既有惯例）。
- **索引落点**：主进程新模块，userData JSON，原子写抄 `workspace-store.js`（tmp+rename，:17-24）。树读取本来就每次全根 stat（拿 ino），顺手带出 mtimeMs/size 供增量判断。**主进程无 DOMParser**：html 解析用 unified/rehype-parse（md-adapter 已是依赖）。
- **真 app 斜杠菜单**：`blockedit.js` SLASH_ITEMS :22 起。⚠ 与 ui-demo 不同——**这里的下标引用是真的**（:30 注释：块菜单按下标引用 SLASH_ITEMS[0/2/5]）。加「链接到文档」前必须先把下标引用改成按 key 查找，再把条目放进可视位置（ui-demo 教训：放最后=掉出菜单可视区=用户找不到）。
- **格式气泡链接按钮**：`blockedit.js` addLink :656（现在是 `global.prompt`）→ 换成选择菜单 wrap 模式。
- **侧栏文件拖拽**：`sidebar.js` 文件行 dragstart `effectAllowed='move'`（~:478）→ 改 `'all'`（§7-L9）。

## 4. Implementation Units

依赖：U0 → U1/U2（可并行）→ U3/U4 → U5 → U6/U7 → U8 贯穿。每单元绿了就 commit（并行 session 凭 git log 对齐）。

### U0 · 文档内导航收口（修 P0；独立可发布，建议单独 PR 先合）
- **Goal**：文档 iframe 里的 `<a>` 点击全部收口：相对路径 → 解析 → 工作区内存在 → openDoc 漏斗打开（含非文档文件 → 既有外部程序面板）；不存在 → 断链行为（U4 前先 toast 占位）；http(s) → `shell.openExternal`（新 ipc，参考 main.js 既有 openExternal 用法）；`#锚点` → iframe 内 scrollIntoView；mailto/其它 scheme → preventDefault 不动作。**同时修 onload 错挂**：loadFromFile 的 onload 回调校验 `frame.contentWindow.location.href` 与预期 fileUrl 一致，不一致直接 bail（防编辑器挂错页 + 自动保存写错文件）。
- **Files**：`src/renderer/shell.js`（拦截安装点：wireEditor/attachBasic 之后对 contentDocument 挂 capture click；三条渲染路径都要覆盖：file:// 直载、md srcdoc、非合规 basic-edit）；`src/main/main.js` + preload（openExternal ipc）；可选 belt-and-braces：main 挂 `will-frame-navigate` 兜底 preventDefault。
- **Patterns**：find.js 对 contentDocument 挂监听的方式；resolve 相对路径用 U1 的 resolveHref（U0 先行时可内联一个最小版，U1 落地后换用）。
- **Tests**：e2e——点相对链接打开目标文档（docPath 真切换 + 内容断言）；点链接后继续编辑输入 → **旧文件字节不被污染**（fs.readFile 断言，这是 P0 的回归门）；http 链接 → openExternal 被调（spy via app.evaluate）；锚点滚动；basic-edit 文档里点击同样收口。
- **Execution note**：先写「点击后自动保存把 B 写进 A」的失败测试（现状红），修复后转绿——这颗雷值得一个显式回归门。

### U1 · 路径代数纯逻辑模块（test-first）
- **Goal**：把 `ui-demo/src/lib/links.ts` 移植为 `src/lib/links.js`（CJS 双导出 IIFE，抄 `src/lib/find-ranges.js`/`schema-registry.js` 形制）：`dirOf/baseOf/normalizePath/splitHrefSuffix/resolveHref/relHref/escSeg-unescSeg/invertMoves` + `rewriteDocHtml`（对单文档 html 字节做 moved 映射重写的纯函数，供 U5）。**ui-demo 的实现语义是权威**——写/读按段转义对称（`% # ?` 转义、首段含 `:` 前缀 `./`）、resolve 剥尾缀、rewrite 保留尾缀。
- **Files**：`src/lib/links.js`、`test/links.test.js`（node:test + jsdom）。
- **Tests**：**移植 `ui-demo/scripts/test-links.mjs` 的全部 50 断言**（roundtrip property：`resolveHref(from, relHref(from,to)) === to` 对刁钻文件名全组合——`draft:v2.html`、`涨幅100%.html`、`C# 笔记.html`、`去哪?.html`；段边界 `a/bc` vs `a/b`；越根/外链/锚点拒绝）+ rewrite 的三情况（目标动/自己动/子树同动内部互链不变）+ 尾缀保留。
- **Execution note**：test-first；这是将来所有互链行为的地基，50 断言一个都不能少。

### U2 · 链接索引（主进程，可丢弃缓存）
- **Goal**：`src/main/link-index.js`：对当前根维护 `{ rel → { mtime, size, ino, title, outLinks[] } }`。title = 首个 `<h1>` 文本 → `<title>` → 文件名去扩展（这个定义同时服务 @菜单显示与搜索）。增量：readTree 的 stat 结果对比 mtime/size，只重读变过的文件；html 用 rehype-parse 抽 `a[href]`，md 先过 mdToHtml 再同一口径抽。持久化 userData JSON（版本字段 + 原子写）；`ws-tree-changed` 去抖驱动刷新；提供 `ws-links-rebuild` 逃生门 ipc。
- **IPC 面**：`ws-links-query`（给 @菜单：全部候选 {rel,title,kind}）、`ws-links-backlinks(rel)`（反链条目：来源 rel/title/上下文摘句）、`ws-links-rebuild`；索引更新后向 renderer 发 `links-index-updated`（反链面板/断链装饰刷新）。
- **Files**：`src/main/link-index.js`、`src/main/ipc.js`（注册）、preload 暴露、`src/main/workspace.js`（stat 带出 mtimeMs/size）。
- **Tests**：node:test 直测模块（临时目录造真文件）：建索引 → 改一个文件 mtime → 只重读它；反链正确；重建逃生门；索引文件损坏 → 自动全量重建不崩。
- **Execution note**：索引永远可丢弃；任何「信索引不信磁盘」的捷径都是违背校验器哲学的返工点。

### U3 · 创建面（块编辑器四入口 + 提及菜单）
- **Goal**：B1-B6 全套。提及菜单 = **父层浮层**（shell.css 样式、锚在 iframe caret rect + frame offset）；触发检测挂 contentDocument 的 `input`/`compositionend`（**不要 keydown 的 e.key**——Windows 中文 IME 只给 'Process'；全角 ＠ 也要认）；菜单开着时键盘导航在父层 document 上接管，`e.isComposing || e.keyCode === 229` 一律放行给输入法。插入：**先定目标（校验/新建）再动正文**；删「触发符+query」用 **DOM 真相定位**（TreeWalker 找触发符 → Range.deleteContents，带「caret 附近」窗口守卫），不按 query 计数回删；插入用 Range.insertNode（`<a href>` 纯净 + 后跟普通空格文本节点安置 caret——**不要 ui-demo 的 &nbsp; 妥协**，实测 caret 行为后定）。斜杠条目：先把 blockedit.js 的下标引用改 key 查找，再把「链接到文档」放进可视位置。气泡 🔗：wrap 模式（保存选区 → 选后 createLink 语义包裹）。拖拽：sidebar dragstart `effectAllowed='all'`；drop 挂 contentDocument（iframe 内坐标直接可用）；空白落点 → 最近可编辑块兜底；跨根/无身份 → toast 拒绝。@新建 → 走既有新建文档 ipc 建在当前文档同目录，不切标签页，toast 带「打开」。
- **Files**：`src/editor/mention.js`（新，WS2Mention，形制抄 find.js）、`src/editor/blockedit.js`（斜杠条目 + 气泡 addLink 换装 + '@' 触发接线）、`src/renderer/sidebar.js`（effectAllowed）、`src/renderer/shell.css`、preload/ipc（用 U2 的 ws-links-query）。
- **Tests**：e2e——@ 弹菜单/筛选/Enter 插入（断言**磁盘字节**：保存后 `<a href="相对路径">标题</a>` 且无 class/contenteditable）；`[[` 与全角路径（用 `page.keyboard.insertText('＠')` 走 input 路径）；斜杠条目**不滚动可见**（offsetTop < menu clientHeight 断言）；气泡 wrap 保留选中文字；拖拽用**真实管线**（见 §7-L10）；IME：组字中 Enter 不选菜单（CDP Input.imeSetComposition 或至少 isComposing 合成回归门）。
- **Execution note**：serializer 剥除清单要核对——blockedit 编辑态加的任何临时属性（contenteditable 等）确认被 `serialize.js` 剥掉，磁盘字节用 e2e 断言钉死。

### U4 · 消费面（点击导航接 U0 + 悬停预览 + 断链装饰/修复）
- **Goal**：B7-B9。断链装饰 = **CSS Custom Highlight**（`::highlight(ws-broken)` 红虚线效果近似：红字 + 下划线；技法照抄 find.js：constructable stylesheet 注入 iframe adoptedStyleSheets + `frame.contentWindow.CSS.highlights`）——**不改 DOM、不落盘**。提及淡底同理（`::highlight(ws-doclink)` 或退化为不做淡底、维持原生蓝——以 Wendi 视觉验收为准，能用 Highlight 做就做）。悬停预览卡 = 父层浮层：目标文档读文件（既有 read ipc）→ 取 title + 前几块纯文本摘句；非文档文件 → 类型卡。修复卡：候选 = 同名文件 + **doc-id 匹配（U7 落地后）**；「重新指向」= 改那一条 href（经块编辑写回 + 保存管线）；「原地新建」尊重 .md。
- **Files**：`src/editor/linkview.js`（新：装饰 + hover 卡 + 修复卡，或并进 mention.js 成一个 WS2Links）、`shell.js`（文档加载/索引更新时刷装饰）、`shell.css`。
- **Tests**：e2e——断链装饰的**像素级变异探针**（find.spec.js FIND-1 模式：截图 → 清 Highlight → 再截 → Buffer.compare 必不同；哑门自检）；hover 卡出现/宽限期；rebind 后磁盘字节的 href 真变 + 装饰自愈；「新建」后链接变通。
- **Execution note**：装饰绝不进字节——e2e 加一条「装饰开着时保存 → 磁盘字节无任何 wordspace 痕迹」的门。

### U5 · 改名/移动/外部改名 → 重写引用
- **Goal**：B11。三挂钩全接：commitRenameOp/doMove 完成后 → 主进程 `ws-links-rewrite(moved 映射)`：索引反查受影响文件 → 逐文件重写 href。**磁盘字节保真**：用 rehype-parse 的 parse5 sourceCodeLocation 拿到每个 href 属性值的字节区间，**只 splice href 值本身**，文件其余字节一字不动（非合规野生 HTML 也安全）；md 文件同理按 remark 位置信息或 mdToHtml→定位（实现者选定一种，用「重写前后除 href 外字节相同」的测试钉死）。写盘走 noteSelfWrite + history 归档。重写完成 → toast（renderer）「已更新 N 篇 · 撤销」；**撤销 = invertMoves 反向重写 + 前提校验**（文件仍在新路径、旧路径未被占，否则明说放弃）。**外部改名**（onTreeChanged inode 识别出 rename）→ **询问式** toast「检测到 X 改名，N 篇文档链接指向旧路径，一键更新」——用户没在 app 里操作，不静默写他的磁盘。子树（文件夹改名/移动）用统一算法（旧自身路径解析 → moved 映射 → 新自身路径重算），内部互链天然不变。
- **Files**：`src/main/link-rewrite.js`（新）、`ipc.js`、`sidebar.js`（挂钩 + toast）、`lib/links.js`（复用 U1）。
- **Tests**：e2e 真 fs——改名后 fs.readFile 断言引用方 href 已重写 + **其余字节逐字节相同**；撤销往返；6.5s 内连续两次改名点旧 toast → 明说放弃不做半套；外部改名（测试里直接 fs.rename）→ 询问 toast → 确认后重写；共享场景（一个文件被删后同名新建等）不误伤。
- **Execution note**：「1 文件 = 1 doc」在真 app 天然成立，但重写入口仍加断言（防未来打破）；对**打开中的文档**被重写 → 走 doc-watcher 的外改重载路径确认不冲突（编辑中的脏文档如何处理：v1 跳过重写它并在 toast 里注明「1 篇打开中的文档未更新」，避免和未保存编辑打架——这是 demo 没有的真 app 新问题，实现者按此决策执行）。

### U6 · 反链面板 + 删除守卫
- **Goal**：B10 + B12。反链面板 = 父层 chrome（放文档头部区域，位置与顶栏/面包屑协调，视觉对齐 ui-demo Backlinks 的折叠计数样式）；数据走 ws-links-backlinks，`links-index-updated` 时刷新。删除守卫：sidebar 文件/文件夹删除 + 一切其它删除入口（右键、菜单、快捷键——grep 全部 doDelete 调用点）先查反链（文件夹版 = 夹外引用），有 → 父层确认弹窗列来源（样式抄既有关闭确认弹窗）；确认后走既有删除+撤销 toast；撤销恢复文件 → 链接自愈（装饰随索引更新刷新）。
- **Files**：`src/renderer/shell.js`/`sidebar.js`、`shell.css`、可能新 `src/renderer/backlinks.js`。
- **Tests**：e2e——反链计数/展开/跳转；0 反链不渲染；删除守卫弹窗内容（列表来源正确）；**所有删除入口无旁路**（逐入口测）；撤销删除后反链与装饰自愈。
- **Execution note**：反链绝不注入文档字节（Craft 反例）；「夹内互链不算」语义照 ui-demo `computeDirBacklinks`。

### U7 · doc-id 修复锚（方案已批准：落盘）
- **Goal**：保存时 `<head>` 无 `wordspace-doc-id` 则补 `<meta name="wordspace-doc-id" content="<uuid>">`（与 wordspace-schema meta 同位置惯例）；md 走 frontmatter（穿行机制已有，md-adapter base64 meta）。**ID 只是修复提示不是真相**（校验器哲学：绝不因 meta 自称改变任何判定）。索引记录 docId → 断链修复候选升级为：doc-id 全库匹配 > 同名 > ino 历史。
- **Files**：save 管线（`ipc.js` save-doc 处或 serializer）、`link-index.js`、`linkview.js` 修复卡。
- **Tests**：改名+外部移动后凭 doc-id 找回目标并修复；无 id 的老文件不受影响；id 不参与合规判定（schema-validate 回归）。
- **Execution note**：写 meta 是对用户文件的静默修改——只在**用户主动保存**时补（不做后台扫描补写）；PR 描述里向 Colin 明示这个行为。

### U8 · e2e 强门 + 变异自检（贯穿，最后收口）
- **Goal**：`e2e/doc-links.spec.js`（+分文件按需）覆盖 §2 全表；全部 S4 强断言（真实 fs 字节 / computed / 像素 + 变异探针，不查 JS 设的 class）；`test/links.test.js` property 50 断言进 CI test job。至少两处变异自检：断链装饰（清 Highlight 必翻红）+ 重写字节保真（故意全文件重序列化必翻红）。宿主全量 e2e + CI xvfb 双绿后才 PR。
- **Execution note**：拖拽必须真实输入管线（§7-L10）；跨 iframe 真拖是已知难点——优先 Playwright 裸 mouse down/move/up 驱动 Electron 原生 DnD，不行用 CDP Input.dispatchDragEvent，最后兜底才允许合成事件 + 手动真机验证记录（在 PR 里注明验证方式）。

## 5. 已拍板决策（不要重新讨论）

| 决策 | 结论 | 出处 |
|---|---|---|
| 链接身份 | 双层：相对 href 为主 + doc-id 修复锚（meta/frontmatter，仅提示） | 方案 §01，Colin 批准 |
| 链接视觉 | 原生 anchor + 编辑态淡底装饰（非 chip；装饰不落盘） | 拍板项④ + 冻结决策「显示按原生」 |
| 改名重写 | 默认自动 + toast 撤销（=反向重写） | 拍板项②，demo 验收 |
| @菜单范围 | v1 只进块编辑器；非合规/基础编辑文档只有消费面（点击/被反链/被重写） | 拍板项③ |
| 跨根 | v1 不支持（真 app 单根现状；file: 被 Schema 禁） | 方案 §04 |
| 新建位置 | 当前文档同目录；不切走标签页 | demo 验收 |
| 删除守卫 | 文件+文件夹（夹外引用）+ 全入口无旁路 | demo 验收 + 共享文档删除守卫教训 |

## 6. 明确不做（v1 范围外，别顺手加）

transclusion/嵌入（iframe 在 Schema #1 非合规，需独立 Schema 决策）；块级引用/块图谱（Logseq 前车之鉴）；
database relation/rollup；跨根链接；unlinked mentions；粘贴 URL 自动转内链（可留 v1.1）；大小写/NFD 归一化（记为已知限制，
macOS 大小写不敏感场景 resolve 可能 miss——修复卡兜底，真解留给后续）。

## 7. 硬教训清单（三轮对抗审查 + Colin 实测烧出来的，全部 must-carry）

- **L1 写/读对称**：文件名含 `: % # ?` 会撞 URL 语法。写端按段转义（%25/%23/%3F）+ 首段含冒号前缀 `./`；读端按段 decode（失败原样兜底）。property 门 50 断言钉死。
- **L2 重写保尾缀**：`#锚点`/`?query` 在 resolve 时剥、重算时必须接回去，否则静默丢用户数据。
- **L3 重写按文件迭代**：解析基准 = 该文件自身路径，与写入端同基准；真 app 加「1 文件=1 doc」断言。
- **L4 撤销 = 反向重写**：绝不存快照回滚（吞用户编辑）；执行前校验前提，不满足就明说放弃，不做半套。
- **L5 IME 触发走 input/compositionend**：keydown 的 e.key 在 Windows 中文 IME 下只给 'Process'；全角 ＠ 要认；菜单键盘处理加 `isComposing || keyCode===229` 守卫。
- **L6 删除定位用 DOM 真相**：TreeWalker 找触发符整段删，不按 query 计数回删；校验/新建放删除之前（失败不动正文）。
- **L7 编辑器内所有 `<a>` 点击默认 preventDefault**：mailto/相对路径的默认导航会打飞页面（真 app = iframe 自导航 = P0）。
- **L8 功能在 ≠ 可发现**：手势型交互必须配可见入口（菜单/工具栏/拖拽）+ 教学内容；菜单条目必须在可视区内（下标引用先改 key 再重排）。**哑失败 = 用户眼里没做**：所有拒绝路径（跨根拖拽、无身份文档）都要有 toast/提示。
- **L9 DnD effectAllowed 与 dropEffect 必须兼容**：源声明 'move' + 落点要 'link' → 浏览器直接禁 drop（事件都不发）。文件拖拽源声明 `'all'`。
- **L10 合成 DragEvent 测拖拽 = 假绿门**：它绕过浏览器 DnD 协商整条链。拖拽验收必须真实输入管线（dragTo / 裸 mouse / CDP）。
- **L11 带 transform 的入场动画禁用 fill-mode both**：会永久劫持 fixed 后代的包含块（真 app 父层浮层如遇同类动画，同坑）。
- **L12 切文档清态**：预览卡/菜单/计时器持有的 DOM 引用跨文档必失效；rebind 前 `document.contains` 守卫。
- **L13 验证 agent 会全盖章**：对抗审查的 finding 自己按 merit 复核（本 feature 三轮审查 27+27 confirmed 里约 1/4 是妥协/注记级）。

## 8. 交付与工程约定

- **工作方式**：新 worktree（别占主目录，并行 session 在用）+ `feat/app-doc-linking` 分支；每单元绿了就 commit（git log 是并行对齐的真相源）；**别动 `ui-demo/`**。
- **验收流**：U0 单独 PR 先行（P0 修复独立价值）；其余可一个 PR 或按 U3/U5 切两个。宿主全量 e2e + CI（e2e 是 main 的 required check）双绿；PR 前跑一轮对抗审查（路径代数/编辑器接线/UX 语义三维度，参考本 feature ui-demo 轮的审查维度）并按 merit 修复。
- **给 Colin 的验收脚本**：照 §2 表 B1-B12 在真 app 逐条走一遍 +「点击链接后继续编辑不会写错文件」（U0 回归）+「保存后用浏览器直接打开 .html，链接原生可点」（铁律 1 的终极验收）。
- **完成后**：progress/memory 更新按仓惯例；本计划 status 翻 completed。
