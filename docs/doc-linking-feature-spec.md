# 文档互链 + 文档导航 back/forward — 真 app 开发移交规格

> **这份文档给谁**：接手在真 app（`src/`，vanilla JS + Electron）继续开发本 feature 的 AI/工程师。
> **行为权威**：ui-demo（React 原型，Colin/Wendi 多轮实测验收）。本文把 ui-demo 的交互细节写死到参数级，
> 并规定真 app 架构下怎么实现同样的行为。凡「Colin 拍板」标注处以本文为准（覆盖 ui-demo 旧行为）。
> **开工前必读 §2 现状盘点**——这个 feature 真 app 已完成约一半，别重复造轮子。
> 姊妹文档：`docs/plans/2026-07-08-001-feat-doc-linking-app-plan.md`（原始实现 plan，含更多架构勘察）；
> `docs/browser-feature-spec.md`（main 上，同类移植规格的先例）。

---

## §0 产品概念：这组 feature 是什么

**文档互链**：Notion 式的文档间链接。在文档 A 里通过 `@提及` / 选中文字加链接 / 拖拽文件，插入一个指向
文档 B 的链接；点击跳转应用内打开；B 改名/移动时引用自动重写；B 被删时警告；A 里能看到「谁链到了我」（反链）。
纯离线本地，文件是唯一真相。

**back/forward 导航**：互链的直接衍生需求——互链让「点一下就跳走」变成高频动作，点错要能一键回上一篇
（Colin 2026-07-09 拍板：复用浏览器式的后退/前进按钮，全 app 导航逻辑统一）。

### 铁律（违反任何一条 = 返工，全部有 e2e 门钉死）

1. **磁盘字节 = 纯净相对路径 `<a href="../notes/另一篇.html">链接文字</a>`，零自定义属性、零 class、零
   data-\*、零 contenteditable。** 文档必须在任何浏览器裸开可用（Wordspace = HTML-native 的核心产品原则）；
   .md 文档保持 `[text](path)` 原生（md 适配器属性白名单只有 href/title，多余属性会让整块降级 HTML 岛）。
   编辑器内一切视觉（断链红虚线等）都是**编辑态装饰**，走 CSS Custom Highlight / constructable stylesheet
   （技法照抄 `src/editor/find.js`），绝不落盘。
   ⚠ ui-demo 落盘 `class="ws-doclink"` + `contenteditable="false"` + `&nbsp;` 是 demo 妥协，真 app **不许**
   （真 app U3 已实现为纯 `<a href>` + 普通空格文本节点，e2e 字节断言钉死）。
2. **链接文字 = 插入时的标题快照**。目标改名不回写各处链接文字；悬停卡显示目标当前标题（展示层跟随）。
3. **反链/解析 = 可丢弃索引缓存**（主进程，userData JSON），绝不写进用户文件；提供重建逃生门；
   索引损坏/删除后自动全量重建。任何「信索引不信磁盘」的捷径都是返工点。
4. **改名/移动自动重写引用默认开**，toast「已更新 N 篇文档里的链接 · 撤销」；**撤销 = 反向再重写
   （invertMoves），绝不存快照整体回滚**（会吞撤销窗口内的用户编辑）。
5. **CSP**：renderer `style-src 'self' file:` 无 unsafe-inline——inline `<style>` / `setAttribute('style')` /
   `cssText` 全被拦；`el.style.prop =` 单 CSSOM setter 与 constructable stylesheet 安全（已实证）。
6. **双层身份**：相对 href 为主身份 + `wordspace-doc-id` meta 为修复锚（U7，仅提示、绝不因 meta 改变判定——
   与 schema 校验器同哲学）。

---

## §1 真 app 架构速写（接手前要知道的地形）

- **单编辑器架构**：一次只有一个文档活在 `#doc-frame` iframe 里。`shell.js` 的 `openDoc(absPath)` 就地替换
  当前文档（`docPath = p`、iframe 重载、undo 栈清空）。「多标签」是侧栏的标签列表（`src/lib/tabs.js`），
  点标签 = 重新 openDoc。
- **渲染三路**：`.html` 合规 → `frame.src = fileUrl` 直载 + `WS2BlockEdit`（块编辑器，`src/editor/blockedit.js`）；
  `.html` 非合规 → 同样直载 + `basic-edit.js`（body 整体 contenteditable）+ 降级条；`.md` → 主进程转 HTML 后
  `srcdoc` + `injectBase`。路由 seam：`shell.js` routeDoc（对磁盘字节 reparse 判合规）。
- **iframe sandbox="allow-same-origin"（无 allow-scripts）**：文档内脚本不跑，一切逻辑在父层操作
  `contentDocument`。**父层浮层套路**（提及菜单/悬停卡/守卫弹窗全用它）：UI 元素 append 到父 `document.body`、
  `position:fixed`，iframe 内坐标 + `frame.getBoundingClientRect()` offset 换算。成品参考：`src/editor/find.js`
  （WS2Find）、`src/editor/mention.js`（WS2Mention，U3 已建成）。
- **多根工作区**（⚠ 原 plan 的「v1 单根」前提已作废——main 已合多根 #136/#141）：根注册表
  `roots = [{id, path, ...}]`，一切文件身份 = `rootId:rel`（`src/lib/tabs.js` keyOf）。主进程
  `rootsLib.ownerOf(realAbs, liveRoots)` 判归属。**跨根链接 v1 不做**（拖拽跨根要 toast 明确拒绝）。
- **保存管线**：块编辑 `WS2Serialize.serializeDocument` / 基础编辑 `WS2BasicEdit.serialize` → ipc `saveDoc` →
  原子写 + history 归档。**自动保存 1.2s 去抖**（`scheduleAutoSave`）——这就是 U0 那颗 P0 雷的引信。
  主进程重写用户文件必须 `doc-watcher.js` noteSelfWrite 防自触发重载。
- **主进程无 DOMParser**：解析 HTML 用 unified + rehype-parse（⚠ 必须用这两个**已声明依赖**；
  hast-util-from-html 是传递依赖，直接 import 会让 `npm ci` 挂）。
- **测试**：纯逻辑 = `node --test test/*.test.js`；集成 = Playwright e2e 真开 Electron（`e2e/*.spec.js`，
  CI required check）。e2e 强断言惯例：断磁盘字节 / computedStyle / 像素，不查 JS 设的 class；变异自检。

---

## §2 现状盘点（2026-07-10；接手 AI 先核对 git log 再动手）

### 已在 main（可直接用）

| 单元 | 内容 | 落点 |
|---|---|---|
| **U0** 点击导航收口 | 文档内 `<a>` capture click 守卫 + onload 硬化，修「点链接 → iframe 自导航 → 自动保存把 B 页写进 A 文件」的 P0 数据损坏 | PR #142。`shell.js` onDocLinkClick / loadedIsExpected；ipc `open-external-url` / `ws-resolve-doc-link` |
| **U1** 路径代数 | `src/lib/links.js` 纯逻辑模块（ui-demo links.ts 语义 1:1 移植），50 断言 property 门 | PR #142。`test/links.test.js` |

### 在分支 `feat/app-doc-linking-mention`（worktree `wordspace-next-doclink`）——**全绿、待 Colin npm start 手测，未合 main**

| 单元 | 内容 | commit |
|---|---|---|
| **U2** 链接索引 | `src/main/link-index.js` 主进程可丢弃缓存（多根 rootId:rel）+ ipc 面 | 41a3b94 |
| **U3** 创建面(1/2) | @提及菜单 → 选文档 → 插入纯净 `<a href>`；`src/editor/mention.js` 新建 | 4bb2c14 |
| **U3** 创建面(2/2) | 拖文件 / 气泡 wrap / @新建 / 非文档候选 | c5faa89 |
| U3 审查修复 | DOM 真相 query（核心）+ safeHref + 列表落点 + 生命周期，8 confirmed | 09c664c |
| Colin 手测三修 | **删斜杠入口 / wrap 菜单锚按钮下方 / @新建跳转新文档**（§3 已按新口径写） | d469675 |

状态：474 单测 + 全量 e2e 绿（`e2e/doc-links.spec.js` 11 条）。⚠ 分支可能落后 main 几个提交
（#145/#146 等）——**动工前先 rebase 到最新 main**（PR CI 跑 merge commit，本地绿 ≠ CI 绿，这是本仓
用血换的教训）。PR #143（U2 单独 PR）若还开着，已被本分支的栈取代，可关。

### 未做（= 接手 AI 的工作清单）

| 单元 | 内容 | 规格 |
|---|---|---|
| ~~**U4** 消费面~~ | ~~悬停预览卡 + 断链装饰（CSS Highlight）+ 断链修复卡~~ **已落 app**（`editor/linkview.js`；step 5-6 像素门/host-verify 待收） | §5.1–5.3 |
| ~~**U5** 改名/移动重写~~ | ~~三挂钩 + 自动重写引用 + 撤销~~ **已落 app**（`main/link-rewrite.js`；app 内/外部改名探测/撤销全做，仅移动文案+md 引用式欠账） | §5.4 |
| ~~**U6** 反链面板 + 删除守卫~~ | ~~「N 篇文档链接到这里」+ 删除警告~~ **已落 app**（`shell.js`/`sidebar.js`/`link-index.dirBacklinks`） | §5.5–5.6 |
| ~~**U7** doc-id 修复锚~~ | ~~保存补 meta + 修复卡候选升级~~ **已落 app**（`lib/doc-id.js` + 索引 docId 快照/carry-forward + 修复卡置顶移动候选） | §6.4 |
| **U8** e2e 强门收口 | 全表覆盖 + 变异自检（各单元 e2e + U4 像素门+变异探针已随手做，host-verify 待 merge 前） | §7 |
| **N1** back/forward 真 app 版 | 文档区后退/前进（ui-demo 已上 live 验收中） | §4.2 |

### ui-demo 参照哪里跑

最新 main 的 ui-demo（`cd ui-demo && npm install && npx vite`），或直接看公开 live
`https://wordspace-ui-demo.vercel.app`。互链全套 + back/forward 都在上面。

---

## §3 交互规格 · 创建面（真 app U3 已实现——本节是行为存档 + 手测中，读懂即可，别重写）

> 真 app 实现：`src/editor/mention.js`（WS2Mention 父层浮层）+ `src/editor/blockedit.js` 接线 +
> `src/renderer/sidebar.js` 拖拽源。以下为已实现行为的权威描述（含 Colin 拍板差异）。

### 3.1 @ 提及菜单（核心入口）

- **触发**：正文输入 `@` / 全角 `＠`（trig=1），`[[` / `【【`（trig=2）。检测挂 contentDocument 的
  `input` / `compositionend` 事件（**绝不用 keydown 的 e.key**——Windows 中文 IME 只给 'Process'/229）。
  只在块编辑器编辑态触发；临时文档/工作区外文档 → toast「临时 / 工作区外文档暂不支持文档互链」。
- **菜单**：父层浮层（`.ws-mention-menu`，shell.css，position:fixed z-index 300，`ws-pop-in` 入场动画
  **无 fill-mode**——L11 教训）。锚在 caret 下方 +6px、左对齐 caret；下方放不下翻到 caret 行上方；
  水平不出右缘（视口宽 -280 夹取）。
- **候选**：打开时**一次**拉全根候选（ipc `ws-links-candidates`，文档 + 非文档文件都列，排除当前文档自己），
  缓存进会话；之后每键**同步筛**（`applyFilter`，标题+路径小写 includes）——绝不每键发 ipc
  （并发响应乱序会把筛过的列表盖掉，已实证的竞态）。
- **条目**：文档在前（📄/📝 图标），非文档在后（📕 pdf / 🖼 图片 / 📊 表格 / 📽 slides / 📎 其它）；
  两行 = 标题 + 根内路径（路径行仅当 rel 含 `/` 时显示，重名消歧）。query 非空时尾部追加
  「新建「{query}」」项；恒有「网址链接…」项。ui-demo 截前 8 条，真 app 为完整列表 + max-height 滚动
  （非关键差异，保持现状）。
- **query 的 DOM 真相机制**（U3 审查后的核心设计，别退化）：打开时钉死 `anchorOff`（块内字符偏移）+
  `trigLen`；每次 `input` 事件由 `syncFromDom()` 从 `blockEl` 的 [anchorOff → caret] 文本**重新推导** query
  ——不靠 keydown 累积。这一举解决：中文 IME 组字文本残留、query 含 @ 时删错、光标移走后漂移。
  触发符不见了 / caret 跑到 anchor 之前 / query 超长 → 自动关菜单。
- **键盘**（菜单开着时，父层接管）：`↑↓` 移动选中项、`Enter` 选中、`Esc` 关、`Backspace` 删 query 末字符
  （query 空 → 关菜单）。**IME 组字中（`isComposing || keyCode===229`）一律放行给输入法**。
  左右方向键/Home/End/PageUp/Down → 关菜单放行（光标要走）。
- **插入**（选中文档后）：先算 href = `WS2Links.relHref(fromRel, targetRel)`（U1 路径代数，`% # ?` 按段
  转义、首段含 `:` 前缀 `./`）→ `deleteFromAnchor` 删掉 [anchorOff, caret)（触发符+query，DOM 真相定位，
  不按计数回删）→ `Range.insertNode` 插入**纯净 `<a href>{标题快照}</a>`** + 一个**普通空格文本节点**
  落 caret（不是 `&nbsp;`）→ markDirty + undo checkpoint。**任何失败分支都不碰正文**（先定目标再动正文）。
- **「网址链接…」**：`window.prompt('链接地址', 'https://')` → `WS2Format.safeHref` 白名单校验
  （挡 `javascript:` / `data:` / `file:`）→ 不过 → alert「不允许的链接地址」；过 → 插入普通 `<a href>`。
- **「新建「query」」**（Colin 2026-07-09 拍板，**覆盖 ui-demo 旧行为**）：在当前文档同目录建
  `{query}.html`（schema-1 合规骨架：meta + `<h1>{query}</h1><p></p>`；同名自动去重）→ 把链接插进当前
  文档 → **保存当前文档**（先 save 再跳，否则 openDoc 的脏守卫会吞掉刚插的链接）→ **openDoc 跳去编辑
  新文档**。toast「已新建「{title}」并链接」。ui-demo 旧行为「不切走标签页」已废弃。

### 3.2 气泡「链接」（wrap 模式）

- 选中一段文字（单块内）→ 格式气泡 → 🔗 链接按钮 → 弹**同一个**提及菜单，wrap 模式。
- **菜单锚点（Colin 2026-07-09 拍板，覆盖 ui-demo）**：锚在气泡工具栏**「链接」按钮正下方 +6px**
  （用户点按钮的地方，菜单像从按钮掉下来）——不是 ui-demo 的选区下方（点上方按钮、菜单落选区下
  隔一整行 = 手感远，Colin 实测否掉）。
- 选中文档后：恢复保存的选区（cloneRange 存的 savedRange）→ `execCommand('createLink', href)` ——
  **选中的文字整体变链接、文字保留**（wrap 语义）。
- wrap 模式下 query 是**虚拟的**（不进正文）：可打字筛（父层 preventDefault 收字符）。
  ⚠ **已知限制**：wrap + 中文 IME 组字会替换选中文字——中文筛靠 `handleComposition` 收
  compositionend，但组字过程会动选区。ASCII 筛/方向键选可用。列为待修项，接手可修
  （思路：组字期间冻结 savedRange 的恢复时机）。
- 无文件身份（临时文档）或无选区 → 退回 `window.prompt` 网址输入（safeHref 校验同上）。

### 3.3 拖文件进正文

- **拖拽源**（sidebar.js 文件行 dragstart）：`effectAllowed = 'all'`（**L9 教训**：源 'move' + 落点 'link'
  = 浏览器直接禁 drop、事件都不发）+ 全局 `window.__wsDragFile = {rootId, rel, kind, title}`；
  dragend 清（含 document 级兜底，防 drop 后残留）。
- **落点**（blockedit onDragOver/onDrop，挂 contentDocument）：落点插入纯净 `<a href>`；
  落在 `ul`/`ol` 容器上 → 收到最后一个 `li`（别把 `<a>` 插成 list 的直接子节点）；
  落在空白/装饰处 → 最近可编辑文字块末尾兜底。
- **拒绝路径全部有 toast**（L8：哑失败 = 用户眼里没做）：跨根拖 → toast 明确拒绝；拖到自己 → toast
  「不能链接到文档自己」。
- 任何文件类型都可拖（html/md/pdf/图片/其它）——非文档文件链接点击走系统程序面板（§4.1）。

### 3.4 斜杠菜单入口 —— **已废弃（Colin 2026-07-09 拍板删除）**

ui-demo 的斜杠菜单还有「🔗 链接到文档」条目；真 app 曾实现后**已删**（commit d469675）：
手感冗余，创建入口统一收敛到 `@`。**接手别把它加回来**；将来若 ui-demo 也删，以真 app 为准。

---

## §4 交互规格 · 导航

### 4.1 点击链接（U0，已在 main）

capture 阶段拦 contentDocument 全部 `a, area` 点击（含 SVG `<a>` 的 xlink:href），按
`WS2Links.classifyScheme(href)` 分流：

| href 形态 | 行为 |
|---|---|
| 相对路径（`b.html` / `../notes/x.md#锚`） | ipc `ws-resolve-doc-link` 解析（decode 按段、剥 `#/?` 尾缀、realpath、`ownerOf` 判根内）→ 存在：html/md → `openDoc(abs)` 应用内打开；其它类型 → `showViewer`（图片/PDF 预览、其余给「默认程序打开」卡片）→ 不存在：toast「目标不存在」占位（U4 换成断链修复卡） |
| `http:` / `https:` / `mailto:` / `tel:` | ipc `open-external-url`（scheme 白名单显式放行这四种）→ 交系统程序（浏览器/邮件/拨号）。`classifyScheme` 把这四种判 `'web'` |
| `#锚点` | **放行给 iframe 原生片段滚动，不接管**（`onDocLinkClick` 在 preventDefault 之前 `if (kind==='anchor') return`——**无 scrollIntoView 调用**，别去写程序化滚动） |
| `javascript:` / `file:` / 其它未知 scheme / 越根绝对路径 / `\\` UNC | `classifyScheme` 判 `'ignore'` → preventDefault 拦下不动作 |
| **编辑态例外** | 块编辑器**编辑中**（`a.isContentEditable`）点链接 = 放光标改文字，不跳转（Notion 同款）；跳转靠非编辑态点击 |

**onload 硬化**（P0 的另一半，动 shell.js 渲染路径时别拆）：loadFromFile/loadFromHtml/reloadDoc 的
onload 回调校验 `loadedIsExpected(wantUrl)`（decoded file:// pathname 对比；srcdoc 变成 file:// = 被
导航走 → bail）。防「iframe 被导航走 + 晚到 onload 把编辑器挂错页 + 1.2s 自动保存写错文件」。
**回归门**：`e2e/doc-links.spec.js` U0-P0 用例（点链接后旧文件字节不被污染，fs 断言 + 变异验证过）。

### 4.2 back/forward（N1，未做——本节是完整设计）

**ui-demo 已实现并上 live**（PR #146，`ui-demo/src/mock/nav.ts` + ArcSidebar 箭头分派），交互语义
验收中。

> **⚠ 归属决策（Colin 2026-07-11，覆盖本节默认排期）**：真 app 的 N1 **挂到浏览器 feature 的统一导航
> 移植上做，不在 doc-linking 这条单独建**。原因：浏览器 feature（`docs/browser-feature-spec.md`）在真 app
> 也要建一套侧栏导航 chrome（web back/forward），与文档 back/forward 抢同一块地盘；ui-demo 已把两者统一
> 在侧栏箭头上（按标签类型分派）。所以真 app 应由**浏览器移植的执行者**建 app 级导航 chrome 时，**一并
> 建统一前进后退（web+doc 共用）**，照 ui-demo 模型。下面这套「doc-header 独立版」设计**降级为兜底**
> （仅浏览器移植遥遥无期 + 痛感急时才单独做）。眼下文档「回上一篇」靠标签页兜。

真 app 移植设计（**兜底路径**，基于代码勘察，seam 都核实过）：

- **历史模型**：app 级单栈 `{past: NavEntry[], current: NavEntry|null, future: NavEntry[]}`。
  条目 = **内容持久身份**，工作区内 = `{rootId, rel, abs}`，工作区外 = `{abs}`——**绝不按 tabId/标签
  对象记**（标签会去重复用/关闭，易失）。相邻去重（same identity 不重复 push）。
  新导航发生时 `future` 清空（标准浏览器语义）。
- **push 挂载点**（两个导航终点，全部入口——点链接/点标签/点树/recents/@新建跳转——都汇进它们）：
  `shell.js` `openDoc`（通过 `p === docPath` no-op 守卫和 openSeq 作废分支**之后**、`docPath = p`
  之前 push）+ `showViewer`（顶部 push）。**遍历抑制**：back/forward 触发的重放期间置 `applying`
  标志，openDoc/showViewer 里检测到就不 push（防回灌）。
- **back()/forward()**：弹栈取条目 → 置 applying → 用记录的 abs 重跑 openDoc/showViewer（从盘重载，
  行为等价于点侧栏标签；脏守卫照常走——用户取消丢弃时导航中止，此时**要把栈指针拨回去**）→ 清
  applying。目标已删/失联 → toast「已移动或删除」，跳过该条（不消费导航）。
- **改名/移动跟随**：`shellRetargetDoc`（改名/移动已打开文档时被调）同步重写历史栈里的匹配条目
  （旧 rootId:rel → 新），与 tabs 的 retargetEntry 同款语义。
- **UI 落点**：真 app 没有 ui-demo 那种侧栏顶（红绿灯+地址栏）。按钮放**文档头 `#doc-header`
  面包屑左侧**（`.ws-breadcrumb` 前面；**落 UI 前先在 index.html 确认那块 chrome 确为空、不与现有
  内容打架**）：两颗 chevron 图标钮（‹ ›），
  `disabled` 接 canBack/canForward（无历史置灰——「能点但没反应」= 手感坏，ui-demo 同款修正）。
  样式对齐 `docs/style.md`（纸方墨圆）。
- **快捷键**：建议 `Cmd+[` / `Cmd+]`（VS Code/浏览器惯例）。⚠ 接线前 grep 现有快捷键
  （Cmd+F 查找 / Cmd+P 面板 / Cmd+\\ 侧栏）确认不冲突。
- **纯逻辑模块**：`src/lib/nav-history.js`（不 import electron，CJS 双导出 IIFE 形制抄 `tabs.js`），
  node:test 单测：push 相邻去重 / back-forward 往返 / future 清空 / applying 抑制 / retarget 重写 /
  已删目标跳过。
- **将来与浏览器统一**（架构预留，别做实现）：浏览器 feature（`feat/browser-tabs` worktree，未合）
  落地后，网页导航 push 进**同一个栈**（条目加 `{kind:'web', url}` 变体）+ 按当前标签类型分派——
  历史内核零改。ui-demo 已验证这个分派模式（nav.ts 的 'web' 预留注释）。
- **开放口径（Wendi 验收中，别当冻结决策）**：历史算不算「切标签」？当前 ui-demo 实现 = 点树/点链接/
  切标签**都**入历史（"back = 上一篇看过的"）。另一口径 = 只有链接跳转入历史。**默认按前者移植，但把它
  做成一个可切的接线点**（push 挂 `openDoc`〔全导航〕还是只挂 `onDocLinkClick` 路径〔仅链接跳转〕），
  Wendi 拍板后一行切换——**别把默认硬编死**。

---

## §5 交互规格 · 消费面（U4-U6，未做——参数级规格，全部实测自 ui-demo 源码）

> 以下参数（毫秒/像素/文案）实测自 ui-demo main（2026-07-10 快照）。文案**原文照抄**（引号内一字不改）；
> 尺寸/延时是行为验收标准。ui-demo 参照文件：`ui-demo/src/components/canvas/LinkPreview.tsx` /
> `Backlinks.tsx` / `components/Canvas.tsx` / `components/DeleteLinkedModal.tsx` / `lib/links.ts` /
> `mock/store.ts`。视觉 token 见 `ui-demo/src/styles/tokens.css` + `docs/style.md`（纸方墨圆）。

### 5.1 悬停链接预览卡（U4）

**定时器**（两个独立计时器：开卡 hoverTimer / 关卡 closeTimer）：
- 悬停站内链接 **350ms** → 开卡（悬停期间用**最新**文件树状态判断断链，别用打开文档时的快照）。
- 鼠标移出链接 → **250ms** 宽限后关卡。
- 鼠标移入卡片 → 取消关闭（keep）；移出卡片 → **200ms** 后关。
- 已悬停在同一个 `<a>` 上不重开。
- **切文档/标签 → 立即清卡 + 清两个定时器**（L12：跨文档 DOM 引用必失效）。

**定位**：卡钉在链接矩形**下方 +8px**；`left = clamp(12, rect.left - 8, 视口宽 - 312)`——只做水平
夹取，**无上下翻转**（ui-demo 现状；真 app 视口更矮，实现时可加下方放不下上翻，不算行为偏离）。
卡片：宽 **300px**，max-height 260px，圆角 10px，padding 12px 14px，父层 fixed（z 高于文档、低于菜单）。

**内容——目标是文档（html/md）**：
- 标题行：文档图标 14px + 目标**当前标题**（截断）。
- 摘要：目标文档前 **4 个块**的纯文本，每块截 **72 字符**加「…」（空白折叠）。
  真 app 取法：读目标文件（既有 read ipc）→ 解析 → 取 body 前 4 个块级元素 textContent。
- 页脚：目标根内路径（截断，小字）+「打开」按钮（accent 色）→ 点击 = 关卡 + 应用内打开目标。

**内容——目标是非文档文件**（pdf/图片/表格等）：标题行 = 文件名；提示文案原文：
「**非文档文件，打开后转交系统对应程序。**」；页脚同上（打开 = showViewer 面板）。

**不弹卡**：http(s) 外链、`#锚点`、mailto、越根链接——悬停无任何卡。

**断链时的悬停/点击卡** → 见 5.3（同一张卡的断链面孔）。

### 5.2 链接视觉装饰（U4）——⚠ 真 app 与 ui-demo 机制必须不同

**ui-demo 的视觉效果（= 验收标准）**：
- 站内互链：accent 蓝字 `#1d6fbf` + 极淡蓝底 `#e8f1fa` + 圆角 4px + padding 0 3px + **无下划线**；
  hover 底色加深 `#d8e6fc`。
- 断链：danger 红字 `#b91c1c` + 淡红底 `#fdf3f2` + **红虚线下划线**（`underline dashed`，
  text-underline-offset 3px）。
- 手写/粘贴进来的相对链接**同样**被纳入装饰与互链行为（不只 @ 插入的才算）。
- 修复/目标恢复后装饰**自愈**（下轮检测刷新）。

**机制差异（铁律 1）**：ui-demo 直接 toggle DOM class（demo 妥协，装饰会落库）。真 app **必须**用
**CSS Custom Highlight**（`::highlight(ws-broken)` 等）+ constructable stylesheet 注入 iframe
`adoptedStyleSheets`——不改 DOM、不落盘。技法**照抄 `src/editor/find.js`**（跨 sandbox iframe 的
Highlight + 样式表已实证可行；inline style 会被 CSP 拦）。
⚠ Highlight 能力边界：能做字色/下划线/底色，做不了圆角和 padding——**断链红虚线是必须的**（红字 +
虚线下划线 Highlight 都支持）；站内链接的淡底 chip 效果做不了就**保持原生蓝链接样式不加装饰**
（冻结决策「显示按原生」，Wendi 视觉验收为准）。

**检测**：文档加载完成 + `links-index-updated` 事件（索引刷新推送）时，扫 contentDocument 全部
`a[href]`：`classifyScheme` = relative → resolve → 根内文件存在？→ 不存在标 broken Highlight。
外链/锚点/越根不标。

### 5.3 断链点击 → 修复卡（U4，候选升级在 U7）

**点断链**：U0 现状是 toast 占位；U4 换成弹修复卡（位置 = 链接矩形下方，同悬停卡）。
**悬停断链** 350ms 同样弹这张卡。

**卡内容**（文案原文）：
- 头部：断链图标 + 「**链接目标不存在**」（danger 色）。
- 路径行：断链的目标路径。
- 说明：「**目标可能被移动、改名，或已删除。**」
- **候选「重新指向」**：最多 **3 条**，每条「重新指向 {候选路径}」。候选 = 同根内**纯文件名精确
  相等**（`baseOf` 相等）**且是文档类文件**（ui-demo `repairCandidates` 额外要求 `f.docId`——pdf/图片等
  非文档文件**永不入候选**，别把同名 pdf 列成重新指向目标）。U7 落地后升级为：doc-id 全库匹配 > 同名 >
  ino 历史，优先级递减。
- **「新建」**：「在 {目标目录 或 '根目录'} 新建「{文件名}」」——**尊重断链的扩展名**
  （断链指向 `.md` 就建 `.md`，否则 `.html`）。**实现细化**：只对编辑器可创作的类型（html/md）给这条；
  断链指向 pdf/图片等无从「新建」（且这类也不会有同名文档候选），此时卡里只有头部/路径/说明。

**「重新指向」行为**：undo checkpoint → **保留原 href 的 `#锚点`/`?查询` 尾缀**（splitHrefSuffix 剥出、
重算后接回——L2）→ 只改那一条 `<a>` 的 href（relHref 重算）→ 走保存管线落盘 → toast
「**已重新指向 {路径}**」（success）→ 装饰自愈。目标 `<a>` 已不在文档（切走了/块删了）→ toast
「**链接已不在当前文档，未能重新指向**」（danger），不动任何东西。

**「新建」行为**：目录 = 断链目标的目录；文件名 = 断链目标名（`.md`/`.html` 按断链后缀）；
建 schema-1 合规骨架 → toast「**已新建「{名}」**」（success）→ 链接自然解析通、红虚线自愈。
**不切走**当前标签页（注意：这与 @新建的「跳转」不同——修复场景用户在修当前文档，别打断）。

**关闭**：执行动作 / 悬入卡再移出（200ms）/ 切文档。ui-demo 没有 Esc/点外部关闭——真 app 实现
**加上 Esc 关闭**（父层浮层惯例，find.js 同款），算修 ui-demo 缺口不算行为偏离。

### 5.4 改名/移动 → 自动重写引用（U5）

**三挂钩**（真 app 的挂载点都勘察过）：
1. app 内改名：`sidebar.js` commitRenameOp → ipc `ws-rename` → 完成后触发重写。
2. app 内移动：doMove → ipc `ws-move`（含拖拽移动、跨根移动除外）→ 同上。
3. **外部改名/移动**（Finder 里动的）：`workspace-watcher.js` fs.watch → onTreeChanged → inode 匹配
  识别 rename → **询问式** toast「检测到 X 改名，N 篇文档链接指向旧路径，一键更新」——用户没在
  app 里操作，**不静默写他的磁盘**（与 1/2 的自动重写不同）。

**重写算法**（`rewriteDocsForMoves` 语义，U1 的 `invertMoves` 已备好）：
- **按文件迭代**（不按 doc 抽象）：解析基准 = 该文件**自身路径**（L3）。
- 对每个受影响文件的每个 `a[href]`：resolve(own, href) → target；`targetNew = moved.get(target) ?? target`、
  `ownNew = moved.get(own) ?? own`；两头都没动跳过；**尾缀原样保留**（L2）；`newHref = relHref(ownNew, targetNew) + suffix`。
- 文件夹改名/移动 = 子树整体 moved 映射；**子树内部互链天然不变**（旧解析+新重算抵消），只有
  「树外↔树内」被真改写。
- **磁盘字节保真**：用 rehype-parse 的 sourceCodeLocation 拿 href 属性值字节区间，**只 splice href 值**，
  文件其余字节一字不动（非合规野生 HTML 也安全）；.md 同理按位置信息。测试钉死：「重写前后除 href
  外字节逐字节相同」。
- 写盘走 noteSelfWrite（防自触发重载）+ history 归档。

**toast 语义**（文案原文，ui-demo 实测）：
- 改名有引用被更新：「**已更新 {N} 篇文档里的链接**」success + **「撤销」action**（无引用不弹）。
- 移动（恒弹）：「**已移动「{名}」到 {目录 或 '根目录'}**」neutral，有链接更新再拼
  「** · 已更新 {N} 篇文档里的链接**」+ 撤销 action。
- 文件夹改名：「**已更新 {N} 篇文档里的链接**」success，**无撤销 action**（文件夹改名本身无撤销，
  与现状一致，只告知链接跟上了）。
- toast 生命周期：带 action **6500ms**，无 action 2600ms。

**撤销 = 名字/位置回滚 + `invertMoves` 反向重写一遍**（L4：绝不快照回滚）。前置校验：文件仍在新路径
**且**旧路径未被占；不满足 → 明说放弃、不做半套，toast 文案**改名分支**「**文件已被后续操作改动，
无法撤销这次链接更新**」、**移动分支**「**文件已被后续操作改动，无法撤销移动**」（两条文案不同，
neutral）。

**边界**：
- 改**文档标题**（h1/title）≠ 改文件名——**不触发任何重写**（链接文字=快照，标题跟随只在悬停卡）。
- **打开中的脏文档**被重写：v1 跳过它并在 toast 注明「1 篇打开中的文档未更新」（别和未保存编辑打架
  ——真 app 新问题，ui-demo 没有，按此决策执行）。
- 「1 文件 = 1 doc」在真 app 天然成立，重写入口仍加断言防未来打破。

### 5.5 反链面板（U6）

- **位置**：文档**标题区下方**（不是文档底部）。真 app 落点 = `#doc-header` 面包屑条下方、正文 iframe
  上方的父层 chrome（**绝不注入文档字节**——Craft 反例）。
- **数据**：ipc `ws-links-backlinks(rootId, rel)`（U2 已实现）→ 来源条目 {rel, title, snippet}。
  **排除自链**；每个来源文件**只出一条**（取首个命中块做上下文）。`links-index-updated` 推送时刷新。
- **空态 = 整体隐藏**（0 反链不渲染任何东西）。
- **折叠头**（默认折叠）：caret（展开转 90°）+ 反链图标 + 「**{N} 篇文档链接到这里**」。
- **展开每条**：文档图标 + 来源标题（截断，medium）+ 上下文 snippet（**80 字符**截断加「…」，
  淡色小字）；title 属性 = 来源路径。**点击 = 应用内打开来源文档**。
- 文件夹版语义（删除守卫用）：`computeDirBacklinks` = **夹外引用才算**（夹内互链不算反链）。

### 5.6 删除守卫（U6）

- **触发**：删除文件/文件夹时先查反链（文件夹 = 夹外引用）。**有反链才弹守卫**，无反链直接删
  （保留既有删除+撤销 toast）。**全部删除入口无旁路**（sidebar 右键 / 文档头「⋯」菜单 / 快捷键——
  grep 全部删除调用点逐一接，这是共享文档删除守卫的对抗审查教训）。
- **守卫弹窗**（父层 modal，样式抄既有关闭确认弹窗）：
  - 标题（文件）：「**「{文件名}」被 {N} 篇文档链接**」。
  - 标题（文件夹）：「**文件夹「{名}」里的文档被 {N} 篇外部文档链接**」。
  - 说明原文：「**删除后这些文档里指向它的链接会断开（显示为断链，可在链接上重新指向或撤销删除
    恢复）：**」
  - 来源列表：最多列 **5 条**（标题 + 路径），超出追加「**… 等 {N} 篇**」——⚠ 这个 N = **引用总数**
    （与标题里同一个 N，`referrers.length`），**不是「余下 = 总数 - 5」**（别实现成 remainder）。
  - 按钮：「**取消**」+「**仍要删除**」。**Esc / 点遮罩 = 取消**。
- **删除后**：引用**不重写**、变断链（红虚线装饰自然出现）；**撤销删除 → 文件恢复 → 链接自愈**。
  删除 toast：「已删除「{名}」」/「已删除文件夹「{名}」({N} 个文件)」+ 撤销 action。

---

## §6 backend 设计（真 app）

### 6.1 已建成（接手直接用，API 稳定）

**`src/lib/links.js`**（U1，纯逻辑，CJS 双导出 IIFE，`window.WS2Links` / `module.exports`）：
`dirOf / baseOf / normalizePath / splitHrefSuffix(href) → [path, suffix]（⚠ 数组非对象；无 #/? 尾缀时 [href, '']；消费端一律位置解构 [0]/[1]，别写 {path,suffix} 解构=两个 undefined） / resolveHref(fromRel, href) → rel|null /
relHref(fromRel, toRel) → href / classifyScheme(href) → 'web'|'anchor'|'relative'|'ignore' /
linkTarget / invertMoves / escSeg / unescSeg`。50 断言 property 门（`test/links.test.js`）：
roundtrip `resolveHref(from, relHref(from,to)) === to` 对 `draft:v2.html`、`涨幅100%.html`、`C# 笔记.html`、
`去哪?.html` 全组合。**写/读按段转义对称**（`% # ?` → %25/%23/%3F、首段含 `:` 前缀 `./`）。
`classifyScheme` 把首字符 `/` 和 `\` 判 ignore（Windows UNC → NTLM 泄漏的防线）。

**`src/main/link-index.js`**（U2，主进程可丢弃缓存）：
- 结构：`Map<rootId, {path, docs: Map<rel, {mtime, size, ino, title, kind, outLinks:[{rel, snippet}]}>}>`。
  title = 首个 `<h1>` → `<title>` → 文件名去扩展。
- 解析：html 用 **unified + rehype-parse**（已声明依赖；⚠ 别 import hast-util-from-html——传递依赖，
  npm ci 会挂）；.md 先过 `md-adapter.mdToHtml` 再同一口径。snippet 跳过 script/style 文本。
- 增量：stat 对比 **mtimeNs**（纳秒）+ size，只重读变过的文件。**读失败绝不写空条目**（stat 成功但
  readFile 失败 → 跳过本轮、下轮重试；否则空条目带有效 stat 戳会永久固化——已实证的坑）。
- 持久化：userData `link-index.json`，**read-modify-write 合并**（keepPaths——全量覆盖会抹掉未加载
  根的缓存）+ 原子写。
- ipc 面（preload 已暴露）：`ws-links-query`（全部文档候选）/ `ws-links-candidates`（文档+非文档，
  @菜单用）/ `ws-links-backlinks(rootId, rel)` / `ws-links-rebuild`（逃生门）；索引更新 →
  `links-index-updated` 推送 renderer。
- 生命周期：`startRootWatch` 回调驱动增量刷新（合并突发）；根移除/吸收/重定位 → dropLinkIndex。
- **已知限制**（plan §6 拍板延后）：大小写不敏感 FS 上 href 大小写 ≠ 磁盘 → 反链丢/误标断链
  （点击仍能开）。真解 = FS 大小写探测 + NFC 归一，U4 修复卡兜底，别在 U4-U6 顺手修。

**`src/editor/mention.js`**（U3，WS2Mention 父层浮层）+ **shell.js 的互链桥**：
`window.__wsDocContext()` → {rootId, rel}（当前文档身份，异步算好；`__wsDocContextReady()` 等就绪）；
`window.__wsCreateLinkedDoc(rootId, fromRel, title)` → {rel, abs}（同目录建文档）；
`window.__wsOpenCreatedDoc(abs)`（先 save 当前再 openDoc）；`window.__wsToast`。

**ipc `ws-resolve-doc-link(fromAbs, href)`**（U0）：decode 按段 → 剥尾缀 → 基于 fromAbs 目录 resolve →
realpath（父目录 realpath + basename，容忍目标不存在）→ `ownerOf` 判根内 → **统一返回单一对象
`{ abs, rel, rootId, kind, name, exists, insideRoot }`**。⚠ **无 `{miss}` / `{outside}` 判别联合**——
**断链 = `insideRoot:true && exists:false`；工作区外 = `insideRoot:false`**（消费端 shell.js 用 `r.insideRoot`
/ `r.exists` 分流，别写 `if(res.miss)`/`if(res.outside)`=恒 undefined 死分支）。坏参 / 非 file: URL 带 host /
无法解析 → `{ error: 'bad args' | 'unresolvable' }`。

### 6.2 要新建的模块（U4-U6 + N1）

- **`src/editor/linkview.js`**（U4，或并入 mention.js 成 WS2Links 编辑器面）：装饰扫描（CSS Highlight
  注入）+ 悬停卡 + 修复卡。形制抄 find.js（constructable stylesheet + 父层浮层 + 切文档 detach）。
- **`src/main/link-rewrite.js`**（U5）：moved 映射 → 索引反查受影响文件 → 逐文件字节保真重写 →
  noteSelfWrite + 归档。renderer 侧 toast + 撤销（invertMoves 再来一遍）。
- **`src/renderer/backlinks.js`**（U6，或并进 shell.js）：反链折叠条 + 展开列表；删除守卫弹窗接
  sidebar/菜单全部删除入口。
- **`src/lib/nav-history.js`**（N1）：见 §4.2。
- **U7**：save 管线补 `<meta name="wordspace-doc-id" content="<uuid>">`（`<head>`，与 wordspace-schema
  meta 同位置；md 走 frontmatter 穿行）。**只在用户主动保存时补**（不后台扫描补写——静默改用户文件，
  PR 里要向 Colin 明示）；id 不参与合规判定（schema-validate 回归门）。索引记 docId → 修复卡候选升级。

### 6.3 与 ui-demo backend 的对应关系（帮助读 ui-demo 源码）

| ui-demo（React/zustand mock） | 真 app |
|---|---|
| `mock/store.ts` 的 files/docs 内存态 | 磁盘文件 + 主进程 link-index 缓存 |
| `openFileTab(file)` | `shell.js openDoc(abs)` / `showViewer(node)` |
| `lib/links.ts` | `src/lib/links.js`（1:1 语义移植，已完成） |
| `rewriteDocsForMoves`（内存重写 blocks） | `link-rewrite.js`（磁盘字节保真 splice href） |
| `computeBacklinks`（每次现算） | `ws-links-backlinks`（索引增量维护） |
| DOM class 装饰（会落库，demo 妥协） | CSS Custom Highlight（绝不落盘） |
| `mock/nav.ts` useNav（zustand 订阅 activeTabId） | `src/lib/nav-history.js` + openDoc/showViewer 手动 push |

---

## §7 验收与测试门

- **单测**：`npm test`（node:test）。links.js 50 断言 property 门已在；nav-history / rewrite 字节保真
  照此标准补。
- **e2e**：`e2e/doc-links.spec.js` 已有 11 条（U0-P0 变异验证 / .md / basic-edit / http 外链 / 断链 /
  索引 IPC / @中文筛 / @新建跳转 / 拖拽真管线 / wrap / 非文档候选）。U4-U6 照 §5 补，**强断言原则**：
  断磁盘字节（fs.readFile）/ computedStyle / 像素对比，不查 JS 设的 class；**开发迭代只跑本 spec**
  （`npx playwright test e2e/doc-links.spec.js`），全量 231+ 条交 CI（main required check）。
- **U4 是纯视觉单元（悬停预览卡 / 断链修复卡 / 断链 Highlight 装饰），e2e 像素门之外必须真起 app 肉眼
  看一遍**：worktree 里 `WS2_USERDATA=/tmp/ws-dev-ud npm start`——⚠ **必须设独立 `WS2_USERDATA`**，
  否则撞已安装正式版的单实例锁、秒退（`main.js:10` 支持此 env 覆盖，仅非打包态）；开一个含互链的文件夹
  逐个浮层看渲染/翻转/宽限期。宿主 `node scripts/host-verify.js` 是既有真机验证入口（真开 app + VA 判 +
  变异探针 + 截图存证）。
- **必备变异自检**（至少两处，哑门 = 没门）：断链装饰（清 Highlight → 像素对比必翻红，find.spec.js
  FIND-1 模式）+ 重写字节保真（故意全文件重序列化 → 「除 href 外逐字节相同」断言必翻红）。
  ⚠ 变异自检两铁律：**先 commit 再变异**（还原会冲掉未提交的修复，已实踩两次）；fixture 字符串长度
  也是测试变量（同长度巧合会造哑门）。
- **拖拽必须真实输入管线**（L10）：Playwright dragTo / 裸 mouse down-move-up；合成 DragEvent = 假绿。
- **给 Colin 的手测脚本**（每个 U 交付时给一份，人话、逐条可勾）：先例见本分支交付记录——
  A@提及中文筛 / C 气泡 wrap / D 拖拽落点+跨根拒绝 / E @新建跳转 / F 点链接不写错文件 / G 终极验收。
- **铁律 1 终极验收**：插好链接存盘 → Finder 里浏览器直接打开该 .html → 链接原生可点；文本编辑器看
  源码 = 干净 `<a href="相对路径">标题</a>`。

## §8 已拍板决策（别重新讨论）· 明确不做 · 已知限制

**已拍板**：

| 决策 | 结论 |
|---|---|
| 链接身份 | 双层：相对 href 为主 + doc-id 修复锚（仅提示） |
| 链接视觉 | 原生 anchor + 编辑态装饰（非 chip；装饰不落盘；Highlight 做不了的不做） |
| 改名重写 | 默认自动 + toast 撤销（= 反向重写）；外部改名 = 询问式 |
| 创建入口 | **只有 @ / 气泡 / 拖拽三入口——斜杠已删（Colin 2026-07-09）** |
| @新建 | 建同目录 + 插链接 + 存 + **跳转新文档**（Colin 2026-07-09，覆盖 ui-demo） |
| wrap 菜单锚点 | **气泡「链接」按钮正下方**（Colin 2026-07-09，覆盖 ui-demo 选区下方） |
| @菜单范围 | 只进块编辑器；非合规/基础编辑文档只有消费面（点击/被反链/被重写） |
| 跨根 | v1 不支持（拖拽跨根 toast 拒绝；file: 绝对链接被 Schema 判非合规） |
| 删除守卫 | 文件+文件夹（夹外引用）+ 全入口无旁路 |
| back/forward | 复用浏览器式按钮语义；文档/网页按标签类型分派；先做文档半（Colin 2026-07-09） |

**明确不做（v1 范围外，别顺手加）**：transclusion/嵌入、块级引用、database relation、跨根链接、
unlinked mentions、粘贴 URL 自动转内链（v1.1 可议）、大小写/NFD 归一化（已知限制兜底）。

**已知限制（记录在案，别当 bug 修）**：wrap + 中文 IME 筛会替换选中文字（ASCII/方向键可用，待修项）；
大小写不敏感 FS 的 href 大小写错配（修复卡兜底）；打开中的脏文档跳过重写（toast 注明）。

## §9 硬教训（ui-demo 三轮对抗审查 + 真 app 实现烧出来的，全部 must-carry）

- **L1 写/读按段转义对称**：文件名含 `: % # ?` 撞 URL 语法；property 50 断言钉死。
- **L2 重写/重新指向保尾缀**：`#锚点`/`?query` resolve 时剥、重算后必须接回。
- **L3 重写按文件迭代**：解析基准 = 该文件自身路径。
- **L4 撤销 = 反向重写**：绝不快照回滚；前提不满足明说放弃。
- **L5 IME 触发走 input/compositionend**：keydown 在 Windows 中文 IME 只给 'Process'；
  `isComposing || keyCode===229` 一律放行。
- **L6 删除/query 定位用 DOM 真相**：anchorOff 钉死 + syncFromDom 重推导；绝不按计数回删。
- **L7 编辑器内所有 `<a>` 点击默认收口**：不拦 = iframe 自导航 = P0 数据损坏。
- **L8 功能在 ≠ 可发现**：拒绝路径全部要 toast；菜单条目必须在可视区。
- **L9 DnD effectAllowed 必须与落点 dropEffect 兼容**：源声明 `'all'`。
- **L10 合成 DragEvent 测拖拽 = 假绿门**：必须真实输入管线。
- **L11 带 transform 的入场动画禁 fill-mode both**：永久劫持 fixed 后代的包含块。
- **L12 切文档清态**：浮层/计时器持有的 DOM 引用跨文档必失效；`document.contains` 守卫。
- **L13 验证 agent 会全盖章**：对抗审查 finding 按 merit 自己复核。
- **L14（真 app 新增）PR CI 跑 merge commit**：本地绿 ≠ CI 绿；信本地前先 rebase 最新 main。
- **L15（真 app 新增）候选拉取一次会话一次**：打字同步筛缓存，绝不每键发 ipc（乱序竞态实证）。
- **L16（真 app 新增）索引读失败不写空条目**：空条目带有效 stat 戳会永久固化。

---

*本文档 = 交互行为权威 + 真 app 架构落点。写作时间 2026-07-10；分支/PR 状态以 git log 现场为准。*

