---
date: 2026-07-24
type: feat
slug: app-block-indent-ws-indent
origin: docs/plans/2026-07-24-001-align-app-tab-indent-plan.md
status: active
decision: Track 2 = 方案 B（ws-indent-* 类原语），Colin 2026-07-24 拍板
---

# 段落/标题整块缩进：`ws-indent-*` 类原语实施计划（Track 2 · 方案 B）

## 0. 决策记录与阅读须知（先读这节）

- **拍板**：#365 plan §4.1 的三选项（A 合规嵌套 / B ws-indent 类原语 / C 不做），**Colin 2026-07-24 拍了 B**（决策物料：Track 2 决策 artifact + ui-demo 真机验收）。#337 brainstorm 的 Q2 随本计划收口（见 U6）。手感规格的唯一真相源 = **ui-demo 分支 `feat/ui-demo-block-indent` @ `72794e3`**（Colin 真机验收「手感没问题」）。
- **给执行模型的三条铁律**：
  1. **真 app 代码一律以 `origin/main` 为权威**。动手前 `git fetch origin main`、从 `origin/main` 切分支；读代码用本计划给的 **grep 锚点**定位，**绝不信绝对行号**（本仓有 worktree 挂着 1353 行旧精简版 blockedit.js 的前科，权威版 2900+ 行）。
  2. **本计划 §1 行为规格逐字照做，不许自由发挥**。§3 的代码草图是方向性规格：行为必须与草图一致，变量名/代码组织可微调；**既有代码的语义（toggle 分支、list 分支）一个字都不许改**，只做草图标注的插入。
  3. 拿不准的地方，答案优先级：本计划 §1 > ui-demo `Canvas.tsx` 对应代码（路径见 §2.7）> 问 Colin。不要自己发明行为。

## 1. 行为规格（唯一真相源）

### 1.1 哪些块响应缩进

| 块 | classify() 返回 | Tab 整块缩进？ |
|---|---|---|
| 段落 `<p>` | `text` | ✅ |
| 标题 `<h1>`–`<h4>` | `heading` | ✅ |
| 引用 `<blockquote>` | `quote` | ✅ |
| callout `<div class="ws-callout">` | `other`（⚠ 注意！） | ✅（**靠 class 判，不能只看 classify**） |
| 列表 `<ul>/<ol>` | `list` | ❌ 走既有的 li 嵌套分支（#367 U1），与本计划无关 |
| 代码 `<pre>`、表格、图片、分隔线、toggle 容器 | 其它 | ❌ 保持现状（Tab 被吞、无动作） |

判定写法：`const k = classify(editingEl); const indentable = k==='text' || k==='heading' || k==='quote' || editingEl.classList.contains('ws-callout')`。
Gate 前提与现状一致：`e.key==='Tab' && editingEl`（**只有文字编辑态响应**；灰选中态 `selectedEl`、跨块选区 `rangeSelEls` 都不进这个分支，保持现状不改）。

### 1.2 档位与封顶（与 ui-demo 逐字一致 + 有限词汇上限）

- 档位存为块上的 class：`ws-indent-1` … `ws-indent-6`（**互斥，一块最多一个**；0 档 = 无 class）。每档 **24px**（整数像素）。**绝对封顶 6 档**——超过 6 的 class 永远不许产生（词汇表是有限的，`ws-indent-7` 没有 CSS，会静默失效）。
- **相对封顶（Notion 约束，ui-demo 原样）**：`maxAllowed = 上一块档位 + 1`；**首块（上面没块）maxAllowed = 0，永远缩不了**。「上一块」= `topBlocks()` 序列里的前一项，**不管它是什么类型**——列表/图片/toggle 没有 ws-indent class，档位按 0 算（所以它们后面的段落最多缩 1 档）。
- **Tab**：`next = min(cur+1, maxAllowed, 6)`。注意 ui-demo 的既有语义：若 `cur` 已超过 `maxAllowed`（比如上方块被删后），Tab 会把块**向下归一化**到 `maxAllowed`——这是有意行为，照抄。
- **Shift+Tab**：`next = max(0, cur-1)`；到 0 档时移除 class；**0 档再按 = 静默 no-op**（无抖动、无 toast）。
- `next === cur` 时**什么都不做**（不打 checkpoint、不 markDirty——别留空 undo 步）。
- 两条边界说明：① **6 档绝对封顶是本计划新增的约束（有限 class 词汇的要求），ui-demo 没有**（inline style 可到任意档）——有意分歧，U6 的 feature spec 里明确记录（≥7 深度的手感 Colin 未验过）；② 外部/AI 文档可能自带违反相对封顶的档位（如首块 `ws-indent-5`）——**照常渲染、不主动纠正**，仅当用户在该块按 Tab 时按归一化规则拉回（与 ui-demo 语义一致）。

### 1.3 键位优先级（toggle 协调，#365 §4.2 拍板）

非 list 块的 Tab/Shift+Tab，按此优先级判定，**前一条命中就 return**：

- **Tab**：① 前一兄弟是 `<details>` → 走**既有** toggle 嵌套（逐字保留），**并在嵌入的 DOM 变更之后、checkpoint 之前剥掉本块全部 `ws-indent-*`**（结构嵌套取代数值缩进，防双偏移；顺序见 U2 顺序铁律）；② 否则，块在顶层（`scopeRootOf(editingEl) === blockRoot`）且 indentable → 整块缩进（§1.2）；③ 否则 no-op。
- **Shift+Tab**：① 块在 toggle 体内（`scope !== blockRoot`）→ 走**既有**出 toggle（逐字保留），**并在移出的 DOM 变更之后、checkpoint 之前剥掉全部 `ws-indent-*`**（出 toggle 归 0 档）；② 否则 indentable 且 cur>0 → 减一档；③ 否则 no-op。
- **toggle 体内不做缩进**（Tab 在体内、前兄弟非 details → 保持现状 no-op）。原因：体内 Shift+Tab 已被「出 toggle」占用，若体内允许 Tab 缩进则减档无键可用（不对称陷阱）；且 ui-demo 无此行为可对齐。这是**有意的范围边界**，不是漏做。

### 1.4 光标/选区（ui-demo 手感的核心，别搞砸）

- **缩进与光标位置完全无关**：段首/段中/段尾按 Tab 一律整块缩，**光标绝不移动**。实现上：缩进路径**只改 classList，不碰 Selection、不调 enterEdit、不重建任何 DOM 节点**——contenteditable 元素本身没动，光标天然原地不动。任何「先存光标再恢复」的代码在这条路径上都是多余且有害的，不许写。
- `e.preventDefault()` 由分支入口既有代码统一做（现状已无条件吞 Tab），不用重复。

### 1.5 生命周期（全部是既有机制的自然结果，零额外代码，但必须锁测试）

| 场景 | 行为 | 来源 |
|---|---|---|
| 段末 Enter | 新块 **0 档**（不继承） | 既有 `insertAfter(editingEl, itemByKey('text'))` 建全新 `<p>`；与 ui-demo 一致 |
| 段中 Enter（劈块） | 后半块**继承同档**（`splitBlock` 有 `nx.className = el.className`） | 既有机制，与 ws-color 同命运；文本延续同视觉层级，合理，照锁 |
| turn-into 转 p/h1–h4/blockquote | ws-indent **保留**（既有「只摘 ws-callout/ws-todo、用户 class 保留」路径） | 既有机制，同 ws-color |
| turn-into 转 callout / 列表 | ws-indent **被清掉**（既有 `next.className = item.cls` 整覆写 / 转列表清 class） | 既有机制，同 ws-color 命运，**不修**（记为已知行为） |
| undo/redo | ⌘Z 精确回滚 class（undo 是 html 全量快照，class 变更天然入栈） | 既有 `undoMgr.checkpoint()`，**在 DOM 变更之后打**（本仓约定，与 ui-demo 的「先 checkpoint 后写」相反，别照抄 ui-demo 顺序） |
| 落盘 | class 原样入盘（serialize 的 `cleanRoot` 只剥 `data-ws2-*` 白名单，从不碰 class） | 既有机制 |
| 外部/旧文档自愈 | 文档带 `ws-indent-*` 但 head 缺缩进 CSS → attach 时 `refreshSemanticStyles` 按 pairs 补注（U1 注册） | 与 ws-color 同管道 |
| 跨文档粘贴 | 把缩进块粘进没开过缩进的文档 → `ensurePastedStyles` 探测补注 CSS（U2 第 4 步，需加一行） | 与 todo/callout/toggle 同管道 |

### 1.6 交互状态矩阵（#365 §4.4 继承，执行后写进 feature spec）

| 状态 | Tab | Shift+Tab |
|---|---|---|
| 编辑态 + 顶层普通块（indentable） | 缩一档（相对+绝对封顶） | 减一档 / 0 档 no-op |
| 编辑态 + 前兄弟是 toggle | 嵌入 toggle + 剥 ws-indent | —（按体内/顶层规则） |
| 编辑态 + toggle 体内 | no-op（前兄弟非 details 时） | 出 toggle + 剥 ws-indent |
| 编辑态 + list 块 | 既有 li 嵌套分支，**不动** | 同 |
| 编辑态 + pre/table 等 | 不缩进（吞键，现状；⚠ 前兄弟是 toggle 时既有代码会嵌入**任何**可编辑块，无类型 gate——既有行为，保持不动，spec 措辞别写成「一律 no-op」） | 同 |
| 灰选中态 / 跨块选区 / 无编辑态 | **不改现状**（handler 的 editingEl gate 天然跳过） | 同 |
| 首块 | 0 档时 no-op；**带残留档位**（外部文档/上方块被删）→ Tab 归一化到 0 | 减档正常 |
| 封顶（相对或 6 档） | 静默 no-op | — |
| Esc（任何编辑态） | 退到块选中态，之后 Tab 正常移焦出编辑区（键盘/屏读退出路径，WCAG 2.1.2——用例 13 看住不回归） | 同 |

## 2. 已核实的代码事实（2026-07-24 实测 origin/main，执行前先自行复核一遍）

以下全部核实过，执行模型**不需要重新推导**，但动手前应 `git show origin/main:<file>` + grep 锚点确认没被并行 session 挪动：

1. **非 list 块 Tab 现状 = `preventDefault` 后纯空转**（除 toggle 嵌套/退出），**不插 tab 字符**。分支入口锚点：`if (e.key === 'Tab' && editingEl) {`，注释锚点 `Tab / Shift-Tab：仅在列表里缩进/反缩进`（`src/editor/blockedit.js`）。ws-indent 正是接管这个空档，与 list/toggle 语义零冲突。
2. **ws-color 四段式模板**（全在 `blockedit.js`，ws-indent 逐段照抄）：
   ① 常量 `TEXT_COLORS`/`COLOR_CSS`——在 attach() 的**语义 CSS 常量区**（锚点 `§0 决策1 固定色板`）；⚠ 常量必须声明在 `refreshSemanticStyles()` 首次调用**之前**（TDZ，锚点注释 `躲 TDZ`）。
   ② `ensureColorStyle()`（锚点 `function ensureColorStyle()`）——注入 `<style id="ws-color-style" data-ws-schema-css="color">` 到**被编辑文档的** `doc.head`，幂等判断按**属性**查重（`style[data-ws-schema-css="color"]`，不按 id），末尾 `markDirty()`。
   ③ `refreshSemanticStyles()` 的 `pairs` 数组（锚点 `function refreshSemanticStyles()`）——四元组 `[kind, css, styleId, 存在性探测选择器]`，attach 时做「升级 + 补注」自愈，**不 markDirty**。
   ④ 块菜单写 class 五步（锚点 `A2/§0决策1：块级上色用 ws-color class`）——遍历全词汇 remove（互斥）→ 非默认才 add + ensureXxxStyle → `undoMgr.checkpoint()` → `markDirty()`。**绝不写 `el.style`**（块 style 被校验器判非合规）。
3. **持久化/undo 通用收尾** = `if (undoMgr) undoMgr.checkpoint(); markDirty();`（20+ 处同款）。undo 是自研 html 快照栈（`src/editor/undo.js`，锚点 `class UndoManager`），class 变更走全量快照路径，**零特判**。
4. **serialize 不剥 class**：`src/editor/serialize.js` 的 `cleanRoot` 只按 `WS2_MARKERS` 白名单剥 `data-ws2-*` 属性（锚点 `if (WS2_MARKERS.has(a.name))`）。
5. **校验器零改动**：`src/lib/schema-validate.js` **无 class 白名单**；`block-style` 规则只咬 `style=` 属性（锚点 `rule: 'block-style'`）；`validateHead` 只查 `<style>` 带 `data-ws-schema-css` 属性、不解析 CSS 内容（锚点 `head-style`）；`STYLE_DANGER` 只扫 inline style 值且不含 `relative`。→ `<p class="ws-indent-3">` + `<style data-ws-schema-css="indent">` **今天就 conform**。只需加回归断言（U3），不改校验器。
6. **md-adapter 零改动**：块上带任何 class（除 ws-todo 特例）→ `hasUnrepresentableAttrs` 判不可表示 → 整块以 **raw HTML island 原样往返**（锚点 `hasUnrepresentableAttrs` + `REPRESENTABLE`，`src/main/md-adapter.js`）。head 的 schema CSS 有意不写进 md、载入时靠自愈再生（既有设计）。
7. **ui-demo 参照代码**：worktree `/Users/ctlandu/Documents/GitHub/wordspace-next-uidemo-indent/ui-demo`，`src/components/Canvas.tsx` 锚点 `if (e.key === 'Tab' && editingId && doc && !rawEdit)`（档位逻辑）、`Canvas.css` 的 `.ws-block { position: relative` 。⚠ `Canvas.css` 里有段**过时注释**说档位用 `marginInlineStart 1.6em`——**是假的，别信**，真相是内联 `left: indent*24px`。
8. **helper**：`topBlocks()`（锚点 `function topBlocks()`，过滤 `data-ws2-ui` 覆盖层）、`scopeRootOf()`、`blocksInScope()`、`classify()`（返回值全集：heading/text/list/quote/divider/image/toggle/other——**没有 callout**，callout 是 `div.ws-callout` 落 other）。⚠ 作用域：`classify()` 在 attach() **外**的模块层；`topBlocks`/`scopeRootOf`/`blocksInScope` 是 attach() **内**局部函数——U1 的新 helper 也必须放 attach() 内（见 U1.4）。
9. **e2e 骨架现成**：`e2e/list-multiselect-indent.spec.js` 的 `launch()/openDoc()/afterEach` + `shiftTab()` helper（锚点 `async function launch()`）——U4 逐字照抄这套（`--no-sandbox` + ROOT、`WS2_LANG/WS2_USERDATA/WS2_NO_CLOSE_DIALOG`、`#doc-frame`、`webContents.send('open-file', p)`）。

## 3. 实施单元（严格按序执行）

> 分支：`git fetch origin && git worktree add <新目录> -b feat/app-block-indent origin/main`（**开独立 worktree**，别在别的 session 的 worktree 里干活），`npm install`。一个 PR 装下 U1–U6（改动面小且互相耦合，拆开反而难 review；e2e 门见 U7）。

### U1 · `ws-indent-*` CSS 原语（照抄 ws-color 四段式）

**Files**：`src/editor/blockedit.js`。

1. 语义 CSS 常量区（紧挨 `TEXT_COLORS`/`COLOR_CSS`，**必须在 `refreshSemanticStyles()` 调用之前声明**，躲 TDZ）加：

```js
// Track2 方案B（2026-07-24 拍板，§1.3 例外）：段落整块缩进 = 有限 class 原语（照 ws-color 四段式）。
// position:relative+left 保文档流不重排；不用 transform（Retina 合成层亚像素抖）、不用 margin/padding（挤动下方块）。
const INDENT_MAX = 6;
const INDENT_STEP = 24; // px/档，整数像素
const INDENT_CSS = Array.from({ length: INDENT_MAX }, (_, i) =>
  '.ws-indent-' + (i + 1) + '{position:relative;left:' + ((i + 1) * INDENT_STEP) + 'px}').join('');
```

2. 挨着 `ensureColorStyle` 加 `ensureIndentStyle()`——**逐字照抄** ensureColorStyle，只把 `color→indent`、`ws-color-style→ws-indent-style`、`COLOR_CSS→INDENT_CSS` 换掉（属性查重 + 末尾 `markDirty()` 一样不能少）。
3. `refreshSemanticStyles()` 的 `pairs` 数组加一行：`['indent', INDENT_CSS, 'ws-indent-style', '[class*="ws-indent-"]'],`——这是外部/AI/md 文档自愈补 CSS 的注册点，**漏了这行，别的浏览器打开就没缩进**。
4. 三个小 helper（⚠ **必须放 attach() 内部**的工具函数区，紧挨 `topBlocks`/`scopeRootOf`（锚点 `function topBlocks()`）。**不能放模块层、也不能照「classify 附近」放**——`classify()` 在 attach() 外的模块层，而 `INDENT_MAX`/`ensureIndentStyle` 都是 attach() 局部量，放模块层一按 Tab 就 ReferenceError）：

```js
function indentLevelOf(el) { for (let n = INDENT_MAX; n >= 1; n--) if (el.classList.contains('ws-indent-' + n)) return n; return 0; }
function stripIndent(el) { for (let n = 1; n <= INDENT_MAX; n++) el.classList.remove('ws-indent-' + n); }
function setIndentLevel(el, n) { stripIndent(el); if (n > 0) { el.classList.add('ws-indent-' + n); ensureIndentStyle(); } }
```

（互斥语义靠 stripIndent 先清全量，照 ws-color 的 forEach-remove 套路。）

### U2 · Tab 处理逻辑（非 list 分支插入缩进）

**Files**：`src/editor/blockedit.js` Tab 分支（锚点 `if (e.key === 'Tab' && editingEl) {`）。

在 `classify(editingEl) !== 'list'` 分支内改造。**既有 toggle 语义逐字保留**，只做三处插入（剥 class 两处 + 缩进逻辑一处）。改造后的分支形状（方向性草图，行为必须一致）：

```js
if (classify(editingEl) !== 'list') {
  const scope = scopeRootOf(editingEl);
  const k = classify(editingEl);
  const indentable = k === 'text' || k === 'heading' || k === 'quote' || editingEl.classList.contains('ws-callout');
  if (e.shiftKey) {
    if (scope !== blockRoot) {
      // 【既有 toggle 退出逻辑，逐字保留】…det.after(editingEl)…
      stripIndent(editingEl); // 插入①：出 toggle 归 0 档（§4.2，防双偏移）
      // 【既有收尾：≥1 体块铁则 / checkpoint / markDirty / enterEdit keep，逐字保留】
      return;
    }
    if (indentable) {
      const cur = indentLevelOf(editingEl);
      const next = Math.max(0, cur - 1);
      if (next !== cur) { setIndentLevel(editingEl, next); if (undoMgr) undoMgr.checkpoint(); markDirty(); }
    }
    return;
  }
  const prev = editingEl.previousElementSibling;
  if (prev && prev.tagName === 'DETAILS') {
    // 【既有 toggle 嵌入逻辑，逐字保留】…prev.appendChild(editingEl)…
    stripIndent(editingEl); // 插入②：进 toggle 剥缩进（结构嵌套取代数值缩进）
    // 【既有收尾，逐字保留】
    return;
  }
  if (scope === blockRoot && indentable) { // 插入③：整块缩进（toggle 体内不缩，§1.3 优先级）
    const bs = topBlocks();
    const i = bs.indexOf(editingEl);
    const cur = indentLevelOf(editingEl);
    const maxAllowed = i > 0 ? indentLevelOf(bs[i - 1]) + 1 : 0; // 首块缩不了；上一块无 class 按 0 算
    const next = Math.min(cur + 1, maxAllowed, INDENT_MAX);
    if (next !== cur) { setIndentLevel(editingEl, next); if (undoMgr) undoMgr.checkpoint(); markDirty(); }
  }
  return;
}
```

**禁止事项**：不碰 Selection / 不调 enterEdit / 不写 `el.style`（§1.4）；`next===cur` 不打 checkpoint。
注意 `Math.min(cur+1, maxAllowed, INDENT_MAX)` 允许 `next < cur`（向下归一化，§1.2 有意行为——**别加 `if (cur > maxAllowed) return` 这类守卫**，M6 变异专打这个）。
**顺序铁律**：插入①②的 `stripIndent` 必须落在 **DOM 变更之后、`undoMgr.checkpoint()` 之前**。origin/main 里 toggle 嵌入/退出的 DOM 变更和收尾（checkpoint/markDirty/enterEdit）是**混写在同一行**的——拆行插入时别把 strip 顺手放到行尾（= checkpoint 之后），否则 undo 快照里块还带着 class，⌘Z 会回滚出「toggle 体内带缩进」的双偏移状态。用例 5 的 undo 断言 + M7 专门看住这个。

**第 4 步（跨文档粘贴自愈）**：`ensurePastedStyles`（锚点 `跨文档粘贴：把待办/callout/toggle 的语义 CSS 注进目标文档`）的探测清单加一行 indent 条目——照它现有 todo/callout/toggle 条目的写法，探测 `[class*="ws-indent-"]` → `ensureIndentStyle()`。漏了这步：把缩进块粘进没开过缩进的文档，class 落地但无 CSS，视觉死到那个文件下次重开（§1.5 粘贴行）。

### U3 · 校验器回归断言（不改校验器）

**Files**：`test/schema-validate.test.js`（照既有用例风格，node --test / CJS）。

加两条断言：① 合规文档 body 含 `<p class="ws-indent-3">x</p>`、head 含 `<style data-ws-schema-css="indent">`（内容随便给一档 CSS）→ `conform === true`；② 同文档**没有** head 缩进 style → 仍 `conform === true`（自愈是编辑器职责，校验器不管）。跑法：`node --test test/schema-validate.test.js`。CI 的 `test` job 就是 `npm test`（`node --test test/*.test.js` 全量 glob）——加进现有文件自动被 CI 覆盖，不用动 CI 配置。

### U4 · e2e 门（强断言 + 变异自检）

**Files**：新建 `e2e/block-indent.spec.js`，骨架逐字照抄 `e2e/list-multiselect-indent.spec.js`（§2.9）。fixture 的 body 换成段落集，如 `<p id="a">甲</p><p id="b">乙</p><p id="c">丙</p>`。

**强断言纪律（S4 教训）**：视觉断言读 `getBoundingClientRect()`，**不许只查 classList**——class 是 JS 直接设的，CSS 全废它照过；坐标断言才证明 CSS 真生效。每个缩进用例都要「class + 坐标」双断言。

| # | 场景 | 关键断言 |
|---|---|---|
| 1 | b 块点入 → Tab | b 有 `ws-indent-1`；b 的 `rect.x` 比按键前 +24（±1）；**c 块 `rect.top` 不变**（不挤下方） |
| 2 | 相对+绝对封顶：**a..h 共 8 个段落**逐块阶梯缩进 | 第 n 块最多 `ws-indent-(n-1)`；第 7、8 块都封 6；**全文档不存在 `[class*="ws-indent-7"]`**；b 在 a 未缩时连按 Tab 两次仍是 1 档（相对封顶）。⚠ **必须 8 块**：7 块时第 7 块的相对封顶恰好=6=绝对封顶，M1 删掉 INDENT_MAX 项测试照绿（门无牙）；第 8 块才能在无绝对封顶时冲到 7、让 M1 翻红 |
| 3 | Shift+Tab 减档到 0 | 2 档→1 档→class 全无、`rect.x` 复原；0 档再按 → DOM 零变化 |
| 4 | 首块 Tab | a 无任何 ws-indent class、`rect.x` 不动 |
| 5 | toggle 协调 | 前兄弟为 `<details>` 时 Tab → 块进 toggle 体、ws-indent 被剥光；预置 `ws-indent-2` 的块进 toggle 后无双偏移（`rect.x` 与体内其它块一致）；体内 Shift+Tab 出来 → 0 档；**嵌入后走菜单路径 undo 一次 → 块回到顶层且 `ws-indent-2` 恢复、`rect.x`=基线+48**（strip 若被误放到 checkpoint 之后，undo 会回滚出「toggle 体内带缩进」的双偏移态，这条断言就翻红） |
| 6 | 光标不动 | 光标放段中（offset=2）→ Tab → `anchorOffset` 仍 2、`anchorNode` 仍在原块 |
| 7 | 类型覆盖 | h2 / blockquote / `div.ws-callout` 各缩 1 档成功；`<pre>` Tab → 无 class（负向断言，**直接断言不折进 poll**） |
| 8 | 自愈 | openDoc 的 fixture 带 `class="ws-indent-2"` 但 head **无** indent style → attach 后 `head style[data-ws-schema-css="indent"]` 存在、块 `rect.x` 偏移 48 |
| 9 | 劈块/新建 | 2 档段中 Enter → 两半都 2 档；2 档段末 Enter → 新块 0 档 |
| 10 | undo | Tab 后走**菜单路径**触发撤销（⚠ 本仓教训：`keyboard.press('Meta+z')` 不触发菜单加速器 = 假 FAIL，照仓里现成 undo e2e 的触发方式 grep 抄）→ class 与 `rect.x` 复原 |
| 11 | 落盘 | 缩进后触发保存，读临时文件字节：含 `ws-indent-1` 与 `data-ws-schema-css="indent"`（保存等待照 `e2e/toggle.spec.js` 现成模式：`waitForTimeout` 越过自动保存 debounce 再 `fs.readFile`，grep 该文件抄） |
| 12 | 向下归一化 | fixture `<p id="x">x</p><p id="y" class="ws-indent-3">y</p>`（模拟外部文档/上方块被删）→ y 点入按 Tab → y 变 `ws-indent-1`（=maxAllowed）、`rect.x`=基线+24——绝不是 no-op、也绝不是加档 |
| 13 | a11y 退出路径 | 编辑态段落按 Esc → 灰选中态；再按 Tab → 焦点移出编辑区（WCAG 2.1.2 既有行为回归门）、块不产生任何 ws-indent class |

**变异自检**（⚠ 铁律：**全部修复 commit 之后**才开始变异，变异验完 `git checkout --` 还原；本仓已两次把未提交修复冲掉）：
- M1 删 `Math.min(..., INDENT_MAX)` 的绝对封顶 → 用例 2 翻红；
- M2 把 `maxAllowed` 改成 `cur + 1`（去相对封顶）→ 用例 2 翻红；
- M3 删 pairs 的 indent 行 → 用例 8 翻红；
- M4 把 `INDENT_CSS` 改成空串 → 用例 1 的坐标断言翻红（class 断言仍绿——这正是坐标断言存在的意义，若不翻红说明门是哑的）;
- M5 删 toggle 嵌入处的 `stripIndent` → 用例 5 翻红；
- M6 在缩进逻辑前插 `if (cur > maxAllowed) return`（貌似合理的「防御式守卫」，恰好杀掉向下归一化）→ 用例 12 翻红；
- M7 把 toggle 嵌入处的 `stripIndent` 挪到 `checkpoint()` 之后 → 用例 5 的 undo 断言翻红。
任何一条变异不翻红 = 门无牙，回去改断言。

### U5 · 文档三面一致性（范式正文 + AI guide 四拷贝）

1. **`docs/schema-1-draft-v0.md` §1 设计原则第 3 条**（锚点 `文档流，绝不绝对定位`）——在该条**末尾追加**（原文一字不删）：

   > **唯一例外（2026-07-24 Colin 拍板，Track 2 方案 B）**：段落/标题/引用/callout 的整块缩进用有限 class 原语 `ws-indent-1..6`（入盘 CSS `.ws-indent-N{position:relative;left:N*24px}`，随文件走）。`position:relative` 的块仍在文档流、能 reflow、可发布，不触本条「绝不绝对定位」的内核；列表/toggle 的层级仍只用 DOM 嵌套；块上仍绝不写 `style` 属性。词汇有限（6 档）、互斥（一块一个）、编辑器打开时自愈补 CSS。

2. **AI authoring guide**：改 canonical `docs/schema-1-ai-authoring.md`——在「块级元素禁止 style 属性」警告段附近的块规则处（参照既有 `ws-al-*` 那行的措辞风格，锚点 `对齐用固定 class`）加一行：

   > `- 段落/标题/引用/callout 的整块缩进用固定 class：<p class="ws-indent-2">（1–6 档、每档 24px、每块最多一个、最多比上一块深一级；不要用 style/margin/嵌套 div 做缩进；缩进 CSS 由编辑器打开时自动入盘，你无需自带 <style>）。`

   然后 **`cp` 同步到全部四份拷贝**并跑防漂移门：
   - `skills/wordspace/references/schema-1.md`（门内）
   - `ui-demo/src/lib/schema-prompt.md`（门内）
   - `src/renderer/ai-guide.md`（门内）
   - `.agents/skills/wordspace/references/schema-1.md`（⚠ **不在防漂移门里**，极易漏，务必手动同步）
   - 门：`node --test test/skill-guide-sync.test.js` 必须绿。
3. **不用动**（已核实，别画蛇添足）：`src/lib/schema-validate.js`（零改动，见 §2.5）、`src/main/md-adapter.js`（零改动，见 §2.6）。

### U6 · Feature spec + #337 Q2 收口

1. 新建 `docs/features/editor-block-indent.md`（模板见 `docs/features/README.md`）：把 §1 全部行为规格 + §1.6 矩阵写成契约；注明 ui-demo 侧实现映射（ui-demo 用 `block.indent` 数字状态 + 内联 `left`，真 app 用 `ws-indent-*` class——行为等价，存储形态不同）；**明确记录与 ui-demo 的有意分歧**：真 app 有 6 档绝对封顶、ui-demo 无（§1.2 边界说明①）；**记一条非阻塞欠账**：普通块 Tab 缩进是零视觉线索的全新手势，后续复用仓库既有「快捷键教学气泡」模式补可发现性（team-memory wendi-feedback-batch2 那套），本 PR 不做；「谁改真 app UI 谁同 PR 更新 spec」铁律，本条就是那个 spec。
2. **#337 Q2 收口**：`gh pr comment 337 --body "..."` 记录：Q2 已拍板 = 选项 (a)（= #365 §4.1 方案 B，ws-indent-* 类原语），Colin 2026-07-24 拍板，实施计划 `docs/plans/2026-07-24-002-feat-app-block-indent-ws-indent-plan.md`，§1.3 例外随实施 PR 落 `docs/schema-1-draft-v0.md`。**别去 checkout / 改 `docs/todo-item-granularity` 分支**（那是别的 session 的分支，评论即可）。

### U7 · 收尾门

1. 开发迭代只跑 `npx playwright test e2e/block-indent.spec.js`（30s–1min）。
2. **blockedit.js 是共享核心** → 推 PR 前本地全量 `npm run test:e2e:dot` 兜跨文件回归（结果用 dot/grep 收窄，别把几百行灌上下文）。
3. PR → main：required checks {test, e2e-all}，**strict 模式**——PR BEHIND 时 `gh pr update-branch <PR>` 再等 CI。PR 描述里 cc Wendi（范式例外知会）+ 链本计划 + feature spec。

## 4. 明确不做（边界，执行模型别自作主张加）

- **toggle 体内缩进**：不做（§1.3 有意边界）。
- **跨块多选缩进**（rangeSelEls 多个顶层块一起缩）：不做，保持现状（#365 §4.4 拍板 no-op；批量缩进单独立项）。
- **块菜单/工具条的缩进按钮**：不做，本期键盘 only（ui-demo 亦无）。
- **新块继承缩进档**：不做（ui-demo 拍板不继承；劈块继承是既有 className 复制的自然结果，不是新特性）。
- **RTL**：不考虑（app 是 LTR 中英文档；`left` 方向写死）。
- **turn-into 转 callout/列表丢缩进**：不修（与 ws-color 同命运的既有机制，记录在 §1.5 即可）。
- **ui-demo 分支 `feat/ui-demo-block-indent` 的合并**：不在本计划（ui-demo 侧另行走自己的 PR 流程）。
- **i18n**：零新增用户可见字符串，不触 i18n 门。

## 5. 风险与回退

| 风险 | 缓解 |
|---|---|
| 动 Tab 共享核心 → 跨文件回归 | 既有 toggle/list 语义逐字保留只做插入；推前全量 `e2e:dot`；CI e2e-all |
| CSS 断言假绿（class 在 CSS 死了照过） | 全部用例坐标双断言 + M4 变异专打这个 |
| 自愈漏注册 → 外部文档无缩进 | pairs 行 + 用例 8 + M3 |
| `.agents/` 第四份 AI guide 拷贝漂移（无门） | U5 清单点名 + PR 自查 |
| 范式正文被并行 session 同期改动 | 提 PR 前 rebase origin/main，冲突手工并 |
| 回退成本 | revert PR 即可：已存文档里的 `ws-indent-*` 变成无 CSS 的死 class——无视觉效果、校验器容忍、不坏文档，**无数据迁移**，安全降级 |

## 6. 流程纪律速查（本仓血泪，违反必翻车）

1. push/PR 用 jizhoutang10thglobal 凭证（`gh auth token --user jizhoutang10thglobal`；默认 CTlandu 凭证 403）。
2. **绝不 `pkill electron`**（并行 session 在跑自己的实例）；手动起 app 验证用一次性 `WS2_USERDATA` scratch 目录，别碰 Colin 真实文档。
3. 变异自检**先 commit 全部修复**再变异（已实踩两次）。
4. e2e 的 undo 走菜单路径，不用 `keyboard.press('Meta+z')`（假 FAIL）。
5. 负向断言（「无 class」「无位移」）直接断言，**绝不折进 poll/waitFor**（折进去必假绿）。
6. 读代码信 grep 锚点不信行号；worktree 可能挂旧文件，权威永远是 `origin/main`。
7. commit 勤打（并行 session 靠 git log 对齐）。

## 7. 相关

- 上游拍板：`docs/plans/2026-07-24-001-align-app-tab-indent-plan.md`（§4.1 三选项、§4.2 toggle 协调、§4.4 矩阵；其 U4/U5/U6 由本计划取代展开）。
- 行为真相源：ui-demo `feat/ui-demo-block-indent @ 72794e3`（`Canvas.tsx` Tab 分支）。
- 代码模板：`origin/main:src/editor/blockedit.js` ws-color 四段式（§2.2 锚点）。
- 决策待收口：brainstorm PR #337 Q2（U6）。
- Track 1 前例：#367（列表多选缩进，e2e 骨架来源）。
