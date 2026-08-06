# 段落/标题整块缩进（Tab / Shift+Tab）—— 对齐 spec

> Track 2 方案 B（ws-indent-* 类原语），Colin 2026-07-24 拍板。
> 计划正本：`docs/plans/2026-07-24-002-feat-app-block-indent-ws-indent-plan.md`（§1 = 行为唯一真相源）。
> **2026-08-06 Colin 复拍：Tab 按光标位置分派**——行首才是缩进，行中是两个空格。见下一节。

## Tab 按光标位置分派（Colin 2026-08-06 拍板）

Colin 原话：「它只有放在一行的顶端的时候，它才是缩进……但是它如果是在一段文字的中间，比如说两个字的
中间，那你按 tab 它相当于变成两个空格」。

| 光标位置 | Tab 干什么 |
|---|---|
| **行首**（折叠光标） | 原语义一字不动：列表行 = 嵌套子项；段落/标题/引用/callout = 整块缩进 ws-indent；前兄弟是 toggle = 嵌进 toggle 体 |
| **行中/行末**（折叠光标） | 在光标处插**两个空格** |
| **有选区**（非折叠） | 原语义 |
| Shift+Tab（任何位置） | 原语义（反缩进 / 出 toggle / 出列 / 表格回退格） |
| 表格格内（任何位置） | 原语义（移到下一格 / 末格停留 / 首格 Shift+Tab 跳出） |
| IME 组词中（`isComposing` 或 keyCode 229） | 完全不接管（连 preventDefault 都不调） |

### 行首的定义

「行首」= 光标在**行宿主**的最开头（左侧无可见字符，`[\t\n\r ]` 这类源码空白忽略不计），**或**紧跟在
一个 `<br>` 之后（硬换行右边是真的行边界）。

- **行宿主不是 editingEl**。列表的 editingEl 是整个 `<ul>`、引用/callout 的是容器（#406 容器化只把
  交互单元下沉到行，editingEl 没动）。拿 editingEl 判的话「列表第二项的行首」「容器第二段的行首」
  永远判成行中 → 列表嵌套整个失能。所以：列表取 `closest('li')`，多段容器取 `caretLineHostIn()`，
  其余取块自己。
- **软折行不算行首**。文字自动折到下一视觉行的位置，DOM 上没有任何边界节点；判定纯按 DOM 走，天然把
  它算成行中（所以一行几何判定都不需要）。已知副作用：很长的段落里按 `Home` 只到**视觉行首**、
  offset 不为 0，所以「Home 再 Tab」在长段落里会插空格而不是缩进。
- 空块（只挂占位 `<br>`）判成行首 → 空段落 Tab 缩进、空 li Tab 嵌套的既有手感不变。
- `<br>` 谓词必须新写：`Range.toString()` 完全忽略 `<br>`（它不产生字符），所以老的 `isCaretAtStart`
  对 `<p>甲<br>|乙</p>` 判 false。

### 插什么，为什么

- 普通块插两个 **`&nbsp;`（U+00A0）**。HTML 会把连续的普通空格折叠成一个——插普通空格用户**只看得到
  一个**（同文档对照段实测：两个普通空格与一个等宽，两个 nbsp 才真变宽）。
- `&nbsp;` 是普通文本字符，**不碰「块级 style 属性 = 整篇非合规」那条红线**：序列化走 outerHTML，
  U+00A0 被转义成 `&nbsp;` 实体入盘；磁盘字节 reparse 后 `schema-validate.validate()` 判
  `conform:true`，重开仍走块编辑器。p / li / 引用段 / callout 段四种宿主都有往返门钉着。
- **例外按实际 computed `white-space` 判、不按标签名判**：`pre` / `pre-wrap` / `break-spaces` 处插两个
  普通空格（那里空白被保留，塞 nbsp 反而污染代码），其余一律 nbsp。
  ⚠ 拍板细则原文写的是「`<pre>` 或 `<code>` 祖先内」，但实测这两个标签在本 app 里都落不到实处：
  `PRE` 不在 Schema TOP_BLOCKS，含 `<pre>` 的文档整篇非合规、走基础编辑器，块编辑器根本不挂
  （`e2e/block-indent.spec.js` 测 7b 就是这条事实的门）；行内 `<code>` 的 BASELINE_CSS 没设
  `white-space`，computed 是 `normal`，在那儿插普通空格照样只显示一个。按 computed 值判，才能同时做到
  「今天不制造一个静默 bug」和「哪天真给 code 设了 `white-space:pre` 它自动是对的」。
- **有选区时绝不插**：插入会把用户选中的内容替换掉，那是删数据，不是体验问题。

### 撤销

插的两个空格**自成一步**：mutate 前先 `checkpoint()` 冲掉 input 那个 500ms 去抖窗口里 pending 的打字
（不冲的话一次 undo 会把「刚打的字 + 两个空格」一起撤，实测过），mutate 后再 `checkpoint()`。

### 实现取舍（别改回去）

插入直接改文本节点的 `nodeValue`，既不走 `execCommand('insertText')`、也不走 `range.insertNode`：

- `execCommand('insertText')` 有 Chromium 的「空白再平衡」，**产出随上下文变**——行中插两个 nbsp 实测
  落成「nbsp + 普通空格」（`a0 20`），块末落成两个 nbsp。门没法钉死码点。
- `range.insertNode` 把原文本节点劈成三段（`isCaretAtStart` / `trimSeamHead` 这类逐节点扫描对碎节点
  从没被测过），而且不触发 `input`。
- 改 `nodeValue` 同样不触发 `input`，所以 `markDirty()` 必须自己调——漏了 = 屏幕上有空格、关文档就没了，
  真丢数据。

## 行为契约

### 哪些块响应

- 响应整块缩进：段落 `<p>`、标题 `<h1>`–`<h4>`、引用 `<blockquote>`、callout `<div class="ws-callout">`。
- 不响应：列表（走既有 li 嵌套分支）、代码 `<pre>`、表格、图片、分隔线、toggle 容器（Tab 被吞、无动作——但⚠ 前兄弟是 toggle 时既有代码会嵌入**任何**可编辑块，无类型 gate，既有行为保持，别写成「一律 no-op」）。
- 只有**文字编辑态**响应；灰选中态、跨块选区、无编辑态不进此分支。

### 档位与封顶

- 档位 = 块上 class `ws-indent-1..6`，互斥（一块最多一个），0 档 = 无 class。每档 24px（整数像素）。
- **绝对封顶 6 档**（有限词汇上限，超过 6 的 class 永远不许产生）。
- **相对封顶（Notion 约束）**：`maxAllowed = 上一块档位 + 1`；首块 maxAllowed=0 永远缩不了；上一块是列表/图片/toggle 等无 class 块按 0 算。
- Tab：`next = min(cur+1, maxAllowed, 6)`——允许**向下归一化**（残留档位超 maxAllowed 时 Tab 拉回，非 no-op 非加档）。
- Shift+Tab：`next = max(0, cur-1)`；到 0 移除 class；0 档再按 = 静默 no-op。
- `next === cur` 时什么都不做（不打 checkpoint、不 markDirty）。
- 外部/AI 文档自带违反相对封顶的档位 → 照常渲染不主动纠正，仅当用户在该块按 Tab 时归一化。

### 键位优先级（toggle 协调）

- Tab：① 前兄弟是 `<details>` → 走既有 toggle 嵌套，并剥掉本块全部 ws-indent-*（结构嵌套取代数值缩进，防双偏移）；② 否则顶层 + indentable → 整块缩进；③ 否则 no-op。
- Shift+Tab：① 块在 toggle 体内 → 走既有出 toggle，并剥全部 ws-indent-*（出 toggle 归 0 档）；② 否则 indentable 且 cur>0 → 减一档；③ 否则 no-op。
- **toggle 体内不做缩进**（有意范围边界：体内 Shift+Tab 已被「出 toggle」占用，允许体内 Tab 缩进则减档无键可用）。

### 光标/选区

~~缩进与光标位置完全无关：段首/段中/段尾按 Tab 一律整块缩~~ ⚠ **2026-08-06 已被上面的「Tab 按光标位置
分派」推翻**：只有行首（或有选区）才走缩进，段中/段末按 Tab 是插两个空格。

**缩进本身仍然绝不移动光标**（实现只改 classList，不碰 Selection、不重建 DOM）——这条契约没变，
只是触发位置从「任何位置」收窄成「行首」。

### 生命周期

- 段末 Enter → 新块 0 档（不继承）；段中 Enter 劈块 → 后半继承同档。
- turn-into 转 p/h1–h4/blockquote → ws-indent 保留；转 callout/列表 → 被清掉（与 ws-color 同命运的既有机制，不修）。
- undo/redo 精确回滚 class；落盘 class 原样入盘 + `<style data-ws-schema-css="indent">` 随文件走。
- 外部/旧文档带 ws-indent-* 但 head 缺 CSS → attach 时自愈补注；跨文档粘贴 → ensurePastedStyles 探测补注。

### 交互状态矩阵

⚠ 下表的 Tab 列全部以「**光标在行首**（或有非折叠选区）」为前提——行中 Tab 一律是插两个空格，
不进这张表（见开头的「Tab 按光标位置分派」）。Shift+Tab 列不受分派影响。

| 状态 | Tab | Shift+Tab |
|---|---|---|
| 编辑态 + 顶层普通块（indentable） | 缩一档（相对+绝对封顶） | 减一档 / 0 档 no-op |
| 编辑态 + 前兄弟是 toggle | 嵌入 toggle + 剥 ws-indent | —（按体内/顶层规则） |
| 编辑态 + toggle 体内 | no-op（前兄弟非 details 时） | 出 toggle + 剥 ws-indent |
| 编辑态 + list 块 | 既有 li 嵌套分支，不动 | 同 |
| 编辑态 + pre/table 等 | 不缩进（吞键，现状） | 同 |
| 灰选中态 / 跨块选区 / 无编辑态 | 不改现状（editingEl gate 天然跳过） | 同 |
| 首块 | 0 档 no-op；带残留档位 → Tab 归一化到 0 | 减档正常 |
| 封顶（相对或 6 档） | 静默 no-op | — |
| Esc（任何编辑态） | 退到块选中态，之后 Tab 正常移焦出编辑区（WCAG 2.1.2） | 同 |

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 档位状态 | `ui-demo/src/components/Canvas.tsx`（`block.indent` 数字状态 + 内联 `left: indent*24px`） | `src/editor/blockedit.js`（`ws-indent-1..6` class + 入盘 CSS `position:relative;left`） |
| Tab 分支 | `Canvas.tsx` 锚点 `if (e.key === 'Tab' && editingId && doc && !rawEdit)` | `blockedit.js` 锚点 `if (e.key === 'Tab' && editingEl) {` 非 list 分支 |
| 行首/行中分派 | —（ui-demo 无） | `blockedit.js` 的 `isCaretAtLineStart` / `tabLineHostOf` / `tabPadFor` / `insertPadAtCaret` |
| CSS 自愈 | —（内联样式无需自愈） | `refreshSemanticStyles` pairs `['indent', ...]` + `ensurePastedStyles` |
| e2e | — | `e2e/block-indent.spec.js`（15 条，class+坐标双断言）+ `e2e/tab-inline-spaces.spec.js`（13 条，分派正门 + 负向回归钉） |

行为等价，存储形态不同：ui-demo 是内存数字状态，真 app 是有限 class 词汇 + 入盘 CSS（文件在任何浏览器直开同样有缩进）。

## 有意分歧

- **真 app 有 6 档绝对封顶、ui-demo 无**（inline style 可到任意档）。有限 class 词汇的要求（`ws-indent-7` 没有 CSS 会静默失效）。Colin 2026-07-24 拍板方案 B 时随计划确认；≥7 深度的手感 Colin 未验过。
- **toggle 协调（进/出 toggle 剥 ws-indent）真 app 有、ui-demo 无**——ui-demo 没有 toggle 嵌套交互可对齐（#365 §4.2 拍板，2026-07-24）。
- **「Tab 按光标位置分派 + 行中插两个空格」真 app 有、ui-demo 无**（Colin 2026-08-06 直接拍在真 app 上）。
  ui-demo 侧 main 上的 `Canvas.tsx` 连 Tab 缩进分支都还没有（缩进本身在未合并分支 `feat/ui-demo-block-indent`
  @72794e3 上），所以这一层是**有意分歧**、不是漂移。下一个跑 `/align-feature` 的 session 别把它当漂移
  回移；真要对齐得先把 ui-demo 的 Tab 缩进合进 main。

## 对齐锚点

- ui-demo 侧：分支 `feat/ui-demo-block-indent` @ `72794e3`（2026-07-24，Colin 真机验收「手感没问题」；未合 main，合并走 ui-demo 自己的 PR 流程）
- app 侧：本 spec 随实现 PR 落地（feat/app-block-indent-ws-indent，2026-08-03）

## 欠账

- **可发现性**：普通块 Tab 缩进是零视觉线索的全新手势，后续复用仓库既有「快捷键教学气泡」模式补（team-memory wendi-feedback-batch2 那套）。本 PR 不做，非阻塞。
- 跨块多选批量缩进：拍板 no-op（#365 §4.4），批量缩进单独立项。
- 块菜单/工具条缩进按钮：本期键盘 only（ui-demo 亦无）。
- **IME 组词态的 Tab 只靠代码守卫 + 真机验**：`isComposing` / keyCode 229 在 Playwright 里造不出真实
  组词态，e2e 只能用合成事件打 keyCode 229 这一半。中文输入法下的真手感要 Colin 真机敲一次确认。
- **toggle 的 `<summary>` 与图片说明 `<figcaption>` 里的 Tab 没纳入分派**：它们在更前面的分支就 return
  且不 preventDefault，现状 = 原生移焦（也是这两处唯一的键盘逃生路径）。Colin 的规则字面上覆盖它们，
  但需求没点名，本期按现状保留，待拍。（顺带既有瑕疵：summary 焦点移走后 `data-ws2-editing` 还留在
  它身上。）
- **「插进去的空格」在 turn-into / 复制粘贴 / PDF 导出里的表现没专门验过**。nbsp 是普通文本字符，
  理论上全链路透明，但 onCopy 走 cleanClone、PDF 走 pagination，值得手验一次。
