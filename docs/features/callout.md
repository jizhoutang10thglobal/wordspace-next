# Callout 标注块 —— 对齐 spec

> **建立缘由**：`docs/features/` 下原本没有 callout spec（23 份里独缺这一份），而 callout 的交互
> 契约全散在代码里、一处也没落纸。2026-08-04 与 Notion 做粒度对拍（14 条事实双侧实测）时
> 动了它的斜杠插入行为，按仓库铁律「谁改真 app 的 UI/交互，谁在同一个 PR 更新对应 feature spec」
> 补建此份。**本份先如实记录现状 + 把对拍查出的差异记成欠账，不代表这些行为已被拍板认可。**

## 行为契约

**身份与结构**
- callout = `<div class="ws-callout">`，磁盘结构由 Schema 约束：**只允许 phrasing 或 `<p>` 子元素**
  （`schema-validate.js` 的 `childrenAreMultiPara`）——**列表、表格、图片、折叠块一律不许放进框内**。
- 编辑器里：**存储是一整块**（整个 div 挂 `contenteditable`、`activeElement` 是容器本身），
  **交互按行**（2026-08-05 容器化，Colin 拍板全按 Notion）：框内每个直接子 `<p>` 是独立交互行——
  手柄/菜单/删除/「在下方插入」/「+」/Enter/Esc/拖拽的作用单元都是段。机制 = 列表行级（U1-U4）
  的推广（`isRowAnchor` 谓词、`paraOf` = `rowOf` 的容器版）。**首段悬停给容器手柄**（框外左侧、
  作用=整框），其余段给段手柄（Notion C1 实测同款的分域）。
- 入盘样式随文件走（`data-ws-schema-css="callout"` 的 style pair，文档里出现 `.ws-callout` 时自动补注），
  app 外的浏览器直接打开同样渲染成灰底圆角框。

**创建与转换**
- 斜杠菜单「提示」：当前块为空 → 原地变身成空 callout；非空 → 在其下方新建。光标落框内。
- **转换入口**（2026-08-05 修，对拍 C3，Colin 拍板全按 Notion）：气泡「转为」与块菜单「转为提示」
  都能把文字块一键变 callout；「转为」面板给**当前块类型**挂高亮，callout 里打开时 Callout 项亮
  （C4——此前 callout 里开面板 10 项全无高亮，根因是类型判定对 DIV 返回 null）。
  callout → 正文走既有多段拍平语义（甲<br>乙），不丢字。
- **空框占位**（2026-08-05 修，对拍 C14）：空 callout 编辑态显示灰色占位文字，与普通空段落**同一句**
  （Notion 两处同文案 → 复用同一词条）。判空是 JS 维护的 `data-ws2-empty`（与 toggle 共用一条通道、
  同一剥除白名单；`:empty` 被占位 `<br>` 破功、`:has()` 感知不到文本节点，纯 CSS 判不了）。
  浏览器直开/非编辑态不出现。

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
- app 侧：commit `9774157`（C13，2026-08-04）、`c7adf78`（C8，2026-08-04）、容器化（C1/C2/C5/C6/C7/C9/C11，2026-08-05）

## 欠账

**结构性（2026-08-05 容器化落地，Colin 拍板全按 Notion）**
- ~~框内段落不是独立块单元~~ —— **已按 Notion 做成「存储整块 + 交互按行」**（护栏：Schema 决策4
  文法一动不动，容器化只做交互层；先例 = todo 方案 B 的存储/交互解耦）。
  已结账：C1 手柄分域 / C2 段菜单删除只删段 / C5 插入落框内 / C6/C7 框内 Enter 切行不劈框 /
  C9 Esc 分级（段→框）/ C11 段落可拖入拖出（门 `e2e/callout-container.spec.js` 11 条）。
- **仍欠**：C10 框内跨段拖选不打块级高亮（rangeSel 未下沉，后续批次）；混排容器（裸行内+<p> 交错，
  外部文件形态）的悬停手柄分域失准（paraOf 恒给段手柄、整框手柄经悬停不可达，只剩 Esc 二级一条路
  ——对抗审查 ADV-C6 advisory，修复只做了 Enter 侧的 stop 扫描）；段菜单不给「转为」组
  （Notion 段菜单有 Turn into，但段级转为的目标语义未对拍——别造半吊子）；框内「+」不弹块类型
  选择器（**有意分歧**：文法只装 `<p>`，弹全量选择器会引导非法类型）；空末行 Enter 跳出框
  （列表双回车退出同款约定，Notion 未实测此条）。

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
- ~~没有「转为 callout」入口（C3）；面板不标注当前类型（C4）~~ / ~~空 callout 无占位（C14）~~
  ——2026-08-05 已修，见「创建与转换」。
- 现实触发面提醒：多段 callout 用户自己造不出来（编辑器建的是裸 phrasing 单段），只能来自外部文件
  或粘贴——这也是 C8 长期没被发现的原因。
- callout 的判据散在三处各写各的（`isEditableEl` 的 classList 特判、Tab 的 indentable 判断、
  `turnInto`/`ensureBlockStyle` 靠 `item.cls` 分派），没有单一的「是不是 callout」谓词。
  本轮沿用既有写法未做收敛（缺陷修复里不夹带重构），记账待独立处理。
