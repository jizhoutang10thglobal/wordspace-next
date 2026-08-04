# Callout 标注块 —— 对齐 spec

> **建立缘由**：`docs/features/` 下原本没有 callout spec（23 份里独缺这一份），而 callout 的交互
> 契约全散在代码里、一处也没落纸。2026-08-04 与 Notion 做粒度对拍（14 条事实双侧实测）时
> 动了它的斜杠插入行为，按仓库铁律「谁改真 app 的 UI/交互，谁在同一个 PR 更新对应 feature spec」
> 补建此份。**本份先如实记录现状 + 把对拍查出的差异记成欠账，不代表这些行为已被拍板认可。**

## 行为契约

**身份与结构**
- callout = `<div class="ws-callout">`，磁盘结构由 Schema 约束：**只允许 phrasing 或 `<p>` 子元素**
  （`schema-validate.js` 的 `childrenAreMultiPara`）——**列表、表格、图片、折叠块一律不许放进框内**。
- 编辑器里它是**一整块可编辑文本容器**：整个 div 挂 `contenteditable`，框内的 `<p>` 不是独立块单元。
  实测佐证：点框内第二段，`document.activeElement` 是 `div.ws-callout` 本身，不是那个 `<p>`。
- 入盘样式随文件走（`data-ws-schema-css="callout"` 的 style pair，文档里出现 `.ws-callout` 时自动补注），
  app 外的浏览器直接打开同样渲染成灰底圆角框。

**创建与转换**
- 斜杠菜单「提示」：当前块为空 → 原地变身成空 callout；非空 → 在其下方新建。光标落框内。
- **没有反向入口**：格式气泡的「转为」十项与块菜单三项都不含 callout，已经变成别的块之后回不来，
  只能靠 undo。（对拍 C3 实测；是否补入口待拍板。）

**空 callout 里用斜杠插入别的块**（2026-08-04 修，对拍 C13）
- 产物**插在 callout 之后**，callout 容器保留，其 id 不被搬走。
- 之所以不做成 Notion 那样「插进框内当子块」：Schema 禁止 callout 容纳列表/表格等块。
  「插到框后」是约束下的非破坏解，**不是**「我们不支持嵌套」这个结论。
- 该规则对四个替换站点统一生效（图片 / 折叠块 / 表格 / 其余块），它们机制各不相同
  （图片会把锚块 `remove`、表格走 `replaceWith`、其余走 `turnInto`），共用一个 `canReplace` 判据。
- ⚠ 不能用 `isLeafTextBlock` 当守卫：`LEAF_TEXT_TAGS` 含 `DIV` 且空 callout 无块级后代 → 判 true，拦不住。

**首行 Backspace**（2026-08-04 修，对拍 C8）
- **单段 callout**（`<div class="ws-callout">文字</div>`，无 `<p>` 后代）：整框内容并进上一块、框消失、不丢字。
  这条与 Notion 一致，是既有行为，未动。
- **多段 callout**（含 `<p>` 子元素）：**只有第一个子块脱框并进上一块，框带着剩下的子块继续存在**
  （Notion 双子块实测同款）。框被掏空才移除，终态与单段那半一致。
- 上一块不是「叶子文字块」（图片、分隔线、透明包裹块）时不吞内容、光标留原处——沿用既有约定。
- 只接管 callout：`blockquote` 等其它容器块的同款死键**未对拍、未修**，见欠账。
- 整块缩进：响应 Tab / Shift+Tab 的 `ws-indent-*` 整块缩进；转成 callout 时既有缩进被清掉。
- 拖拽：⋮⋮ 手柄拖动的是**整个框**（含全部子段），作为一个顶层块重排。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 块定义 / 斜杠项 | `ui-demo/src/**`（块类型表） | `src/editor/blockedit.js`（`SLASH_ITEMS` 的 `callout` 项、`newBlock`） |
| 可编辑判据 | — | `src/editor/blockedit.js` `isEditableEl` 的 `ws-callout` 特判 |
| 入盘样式 | — | `src/editor/blockedit.js` `CALLOUT_CSS` / `ensureCalloutStyle` |
| 结构合法性 | — | `src/lib/schema-validate.js` `childrenAreMultiPara` |

## 有意分歧

| 差异 | 谁拍的 | 日期 |
|---|---|---|
| callout 内不容纳列表/表格/图片等块（Notion 可以）——Schema 层硬约束，不是实现缺失 | Schema §决策4（既有） | — |
| 空 callout 里斜杠插入 → 产物落在框**后**（Notion 落框**内**） | 上一条的直接后果 | 2026-08-04 |

## 对齐锚点

- ui-demo 侧：未建立（callout 未做过 ui-demo↔app 的正式对齐）
- app 侧：commit `9774157`（C13 斜杠插入，2026-08-04）、`c7adf78`（C8 首行退格，2026-08-04）

## 欠账

**结构性（对拍 2026-08-04 查出，14 条事实里 12 条差异同一根因）**
- **框内段落不是独立块单元**：手柄 / 菜单 / 「在下方插入」/ 选中 / 拖拽的作用单元都是**整个框**，
  Notion 是**容器 + 独立子块**（每个子块各有手柄与菜单）。这不是十几个小修，是「要不要把 callout
  变成真容器」这一个架构级选择。**待 Colin/Wendi 拍板**，未拍板前不要零敲碎打地改其中某一条。
- 具体表现（各条均双侧实测）：悬停框内任一段，手柄恒钉在框首行（C1）；框内第 2 段走菜单「删除」
  会删掉整个框（C2）；「在下方插入」的新块落在框外（C5）；框末 Enter 掉出框外、框中间 Enter
  把一个框劈成两个（C6/C7，两个结果互斥）；Esc 选中的是整框而非该段（C9）；框内跨段拖选不打
  块级高亮（C10）；外部段落拖不进框内（C11）；空 callout 无占位提示（C14）。

**明确缺陷**
- ~~**C8（P2）多段 callout 首行 Backspace 是死胡同**~~ —— **2026-08-04 已修**（`feat/ux-granularity`
  落地后阻塞解除），契约见上面「首行 Backspace」，门 `e2e/callout-backspace-merge.spec.js` 6 条。
  留档根因：`isLeafTextBlock` 对单段 callout 判 true、多段判 false（多段有 `<p>` 块级后代），
  同一个键因此分叉成「吞掉整框」与「死无反应」两种；⚠ 该根因是 main 上的既有代码，
  **不是任何一方本轮新引入的**。
- **同款死键在别的容器块上可能仍在**：新分支只认 `.ws-callout`。`<blockquote><p>…</p><p>…</p></blockquote>`
  走的是同一条 `!isLeafTextBlock(cur) → return`，理论上同样死键，但**未与 Notion 对拍、未实测**，
  故未一并接管（铁律：没对拍就不许照着推断改）。下一轮对拍 quote 维度时一并处理。

**其他**
- 没有「转为 callout」入口（C3）；「转为」面板不标注当前块类型（C4）。
- 现实触发面提醒：多段 callout 用户自己造不出来（编辑器建的是裸 phrasing 单段），只能来自外部文件
  或粘贴——这也是 C8 长期没被发现的原因。
- callout 的判据散在三处各写各的（`isEditableEl` 的 classList 特判、Tab 的 indentable 判断、
  `turnInto`/`ensureBlockStyle` 靠 `item.cls` 分派），没有单一的「是不是 callout」谓词。
  本轮沿用既有写法未做收敛（缺陷修复里不夹带重构），记账待独立处理。
