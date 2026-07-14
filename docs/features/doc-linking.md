# 文档互链 + 文档导航 —— 对齐 spec

> **参数级完整规格见** [`../doc-linking-feature-spec.md`](../doc-linking-feature-spec.md)（移交文档，511+ 行，
> 交互毫秒/文案原文/backend API 都在那）。本文件只承载对齐专属的东西：**有意分歧清单**（哪些 app↔demo
> 差异是拍过板的、不算漂移）、**文件映射**、**对齐锚点**、**欠账**（谁落后谁）。

## 行为契约

Notion 式文档间链接 + 点错能回上一篇的导航。三个面：

- **创建面**：正文 `@`/`[[`/`【【` 提及菜单、选中文字气泡🔗、侧栏文件拖进正文——三入口都 → 选文档 →
  插入指向它的相对链接（链接文字 = 目标标题快照）。
- **导航面**：点站内互链 → 应用内打开目标；http/mailto/tel → 系统程序；断链 → 提示/修复；back/forward
  → 文档区回退前进（点错回上一篇）。
- **消费面**：悬停链接出预览卡；断链红虚线装饰 + 修复卡；标题下「N 篇文档链接到这里」反链；目标改名/移动
  → 引用自动重写；删除被引用文件 → 守卫警告。

全部纯离线、文件是唯一真相。行为细节（时序/文案/边界）以移交文档为准。

## 文件映射

| 维度 | ui-demo（`ui-demo/src/`） | 真 app（`src/`） |
|---|---|---|
| 路径代数 | `lib/links.ts` | `lib/links.js`（1:1 语义移植） |
| 链接索引/反链 | `computeBacklinks`（现算，`lib/links.ts`） | `main/link-index.js`（主进程可丢弃缓存 + ipc） |
| 创建·提及菜单 | `components/canvas/MentionMenu.tsx` + `Canvas.tsx` | `editor/mention.js`（父层浮层）+ `editor/blockedit.js` 接线 |
| 点击导航 | `Canvas.tsx onBlocksClickCapture` | `renderer/shell.js onDocLinkClick` + ipc `ws-resolve-doc-link` |
| 悬停卡/断链修复 | `components/canvas/LinkPreview.tsx` | `editor/linkview.js`（U4，已落 app：断链装饰 CSS Highlight + 悬停预览卡 + 断链修复卡） |
| 反链面板 | `components/canvas/Backlinks.tsx` | `renderer/shell.js` 反链面板（U6，doc-header 下父层 chrome + ws-abs IPC） |
| 改名/移动重写 | `mock/store.ts` renameFile/moveFile/renameDir | `main/link-rewrite.js`（U5，字节保真 splice；app 内改名/移动 + 外部改名探测 + 撤销全落） |
| 删除守卫 | `components/DeleteLinkedModal.tsx` | `sidebar.js` doDelete 守卫（U6，link-index.dirBacklinks 夹外反链） |
| back/forward | `mock/nav.ts` + `ArcSidebar` 箭头分派 | 待建 `lib/nav-history.js` + doc-header 按钮（N1） |
| 装饰机制 | DOM class toggle（`.ws-doclink`/`.is-broken`，会落库） | CSS Custom Highlight（不落盘，抄 `editor/find.js`） |

## 有意分歧

两侧故意不同、**不算漂移**的地方：

| 差异 | ui-demo | 真 app | 谁拍/日期 |
|---|---|---|---|
| 磁盘字节 | 落 `class="ws-doclink"` + `contenteditable="false"` + `&nbsp;`（demo 妥协） | **纯净 `<a href>text</a>` 零属性 + 普通空格文本节点**（铁律1，e2e 字节断言钉死） | 铁律/方案，Colin 批 |
| 装饰实现 | 直接 toggle DOM class（落库、下轮自愈） | **CSS Custom Highlight**（不改 DOM、不落盘；CSP 下 inline style 被拦） | 铁律1 |
| 创建入口 | @/[[ + **斜杠菜单** + 气泡 + 拖拽 | **删掉斜杠入口**，收敛到 @/气泡/拖拽三个 | Colin 2026-07-09 |
| 气泡 wrap 菜单锚点 | 选区下方 | **「链接」按钮正下方**（点按钮的地方） | Colin 2026-07-09 |
| @新建 | 建同目录 + 插链接、**不切走标签页** | 建 + 插 + 存当前 + **跳去编辑新文档** | Colin 2026-07-09 |
| 触发检测 | input/compositionend（IME） | 同（IME 走 input，非 keydown） | 一致（非分歧，记录以防误改） |
| 打开中的脏文档被重写 | demo 无此问题（内存态） | v1 跳过它 + toast 注明「1 篇打开中的文档未更新」 | 真 app 新边界，实现决策 |
| 修复卡「新建」类型 | 恒有一条「新建」 | **仅 html/md 可创作类型给「新建」**（断链指向 pdf/图片等无从新建；`.md` 尊重后缀建 `.md`） | 实现决策（§5.3「恒有」按可创作类型收窄） |
| 修复卡关闭键 | 执行/悬出/切文档 | 同上 + **Esc 关**（父层浮层惯例，抄 find.js，补 ui-demo 缺口） | 实现补缺，非偏离 |

**不在上表的行为差异都算漂移**，要么 port 对齐、要么补进本表。

## 对齐锚点

- ui-demo 侧：commit `ec6c73d`（2026-07-10；互链创建+消费全套的 main 快照，移交文档 §5 参数据此核验）
- app 侧：commit `b6d1c86`（2026-07-10；分支 `feat/app-doc-linking-mention`，U0-U3 = 点击导航 + 路径代数 +
  链接索引 + 创建面，消费面未做）

锚点 = 上次两侧确认对齐时各自的 commit；下次 port（U4-U8+N1 落 app）完成时更新。

## 欠账

真 app **落后 ui-demo** 的漂移（ui-demo 已有、app 未移植，全在移交文档 §2 的「未做」清单，跟踪于此）：

- ~~**U4 消费面**：悬停预览卡 / 断链装饰 / 断链修复卡~~ **已落 app**（本 PR，`editor/linkview.js`）。
- ~~**U5 改名/移动重写**：app 内改名·移动 + 外部改名探测 + 撤销~~ **已全落 app**（`main/link-rewrite.js` 字节保真 + ipc orchestration + sidebar 撤销/外部探测 + 打开中文档内存改）。**仅剩小欠账**：移动专属 toast 文案（现统一「已更新 N 篇」）、md 引用式链接定义行（inline 已支持）。
- ~~**U6 反链面板 + 删除守卫**：标题下「N 篇链到这里」+ 删除前引用告警~~ **已落 app**（`shell.js` 反链面板 + `sidebar.js` doDelete 守卫 + `link-index.dirBacklinks`）。
- ~~**U7 doc-id 修复锚**~~ **已落 app**（`src/lib/doc-id.js` 保存补 meta + `link-index` docId 快照/carry-forward + 修复卡 doc-id 全库反查现址置顶）。Colin 2026-07-12 批准「保存时改用户文件」。⚠md frontmatter doc-id + 无 head 野生 HTML 记欠账。
- **N1 back/forward**：ui-demo 已做并上 live（PR #146，`mock/nav.ts`）。真 app **决定挂到浏览器 feature 的
  统一导航移植上做**（Colin 2026-07-11 拍板）——**不单独在 doc-header 建一套**。理由：ui-demo 的文档
  back/forward 复用侧栏箭头，而浏览器 feature（`docs/browser-feature-spec.md`）在真 app 也要建一套侧栏导航
  chrome（web-back/forward + web-header）；两者抢同一块地盘。所以等浏览器真 app 移植建 app 级导航 chrome 时，
  **一并建一套统一的前进后退（网页+文档共用）**，照 ui-demo 模型（箭头按当前标签类型分派 web→浏览器历史 /
  doc→文档导航历史）。眼下文档"回上一篇"靠标签页兜（上一篇标签还开着）。仅当浏览器移植遥遥无期 + "回不去"
  痛感急时，才退而求其次建最小 doc-header 独立版、后并。
- **跨根互链（A/B/C）**：互链全套目前只在**单个文件夹空间内**成立（同根跨子目录 OK，跨并列打开的根不行）。
  跨根方案见 `docs/plans/2026-07-14-001-feat-cross-root-linking-plan.md`（A 消费 / B 创建 / C 维护，未做）。
  ⚠ **已先行**：`ws-move-across`（跨根移动）在跨根自动重写落地前**零重写、静默断链**是数据损坏级缺口——
  **U-CR0 跨根移动守卫**已落（`sidebar.js` doMoveAcross 前置守卫 + `link-index.ownOutlinks` + `ws-links-outlinks-count`）：
  有会断的链接（入向引用 or 被移文档自身出向链接）才弹守卫、确认才移，零引用无感直移。C2 落地跨根真重写时
  本守卫改造成自动重写 + 撤销 toast、守卫文案退役。跨根为真 app 独有（ui-demo 单工作区无根概念，不移植不算漂移）。

port 完成一项就从本节清一项、更新对齐锚点。
