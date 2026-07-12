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
| 反链面板 | `components/canvas/Backlinks.tsx` | 待建（U6，父层 chrome） |
| 改名/移动重写 | `mock/store.ts` renameFile/moveFile/renameDir | `main/link-rewrite.js`（U5，字节保真 splice；app 内改名/移动已落，撤销/外部改名探测欠账） |
| 删除守卫 | `components/DeleteLinkedModal.tsx` | 待建（U6） |
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
- ~~**U5 改名/移动重写**：app 内改名·移动 → 自动重写引用（字节保真 splice，html+md+非合规，含打开中文档内存改）~~ **已落 app**（`main/link-rewrite.js`）。**仍欠**：撤销（toast「撤销」action，undo=反向 move+invertMoves 重写，要连带反转 tabs/retarget/collapsed）、外部改名探测（Finder 里改名 → workspace-watcher inode 匹配 → 询问式 toast）、移动专属文案、md 引用式链接定义行。
- **U6 反链面板 + 删除守卫**：标题下「N 篇链到这里」+ 删除前引用告警——ui-demo 有，app 无。
- **U7 doc-id 修复锚**：两侧都未落盘 meta（ui-demo 修复候选只用同名，app 待做）。
- **N1 back/forward**：ui-demo 已做并上 live（PR #146，`mock/nav.ts`）。真 app **决定挂到浏览器 feature 的
  统一导航移植上做**（Colin 2026-07-11 拍板）——**不单独在 doc-header 建一套**。理由：ui-demo 的文档
  back/forward 复用侧栏箭头，而浏览器 feature（`docs/browser-feature-spec.md`）在真 app 也要建一套侧栏导航
  chrome（web-back/forward + web-header）；两者抢同一块地盘。所以等浏览器真 app 移植建 app 级导航 chrome 时，
  **一并建一套统一的前进后退（网页+文档共用）**，照 ui-demo 模型（箭头按当前标签类型分派 web→浏览器历史 /
  doc→文档导航历史）。眼下文档"回上一篇"靠标签页兜（上一篇标签还开着）。仅当浏览器移植遥遥无期 + "回不去"
  痛感急时，才退而求其次建最小 doc-header 独立版、后并。

port 完成一项就从本节清一项、更新对齐锚点。
