---
type: feat
title: 真 app Tab/缩进逻辑对齐 ui-demo（列表多选 + 段落整块缩进）
date: 2026-07-24
status: active（Track 1 可直接开工；Track 2 阻塞于 Schema/范式拍板，且拍板前不写代码）
origin: docs/brainstorms/2026-07-23-todo-item-granularity-requirements.md（Q2）
      ⚠ 此 brainstorm 仅在分支 docs/todo-item-granularity（PR #337 open），**尚未合入 main**——从 main 读不到，
      执行时靠本计划 §4 的转述。
source-of-truth: 分支 feat/ui-demo-block-indent @ 72794e3（ui-demo 侧定稿，Colin 2026-07-24 真机验收「Tab 逻辑没问题」）
authoritative-code: git show origin/main:src/editor/blockedit.js（2901 行；⚠ 见 §0）
reviewed: 2026-07-24 ce-doc-review 六 persona（coherence/feasibility/adversarial/scope/product/design）已过一轮，findings 已吸收进本版
---

# 真 app Tab/缩进逻辑对齐 ui-demo — 实施计划（v2，已过 ce-doc-review）

## 0. 开工前必读的陷阱

1. **`src/editor/blockedit.js` 的权威版是 `origin/main`（2901 行），不是当前 worktree 里那份。**
   本仓有些 worktree（如 `docs/doc-linking-app-plan`）checkout 的是一个**旧的精简变体（约 1353 行）**，
   缺 `absorbTrailingSiblings` / `caretAtLiTextEnd` / U19 光标保留 / toggle 嵌套。**必须从 `origin/main` 切分支**，
   读代码用 `git show origin/main:src/editor/blockedit.js`。
2. **本计划一律按符号名/grep 锚点定位代码，不给绝对行号**（v1 的行号是对着 1353 行旧变体取的、全错，已删）。
   grep 锚点：Tab 处理 `if (e.key === 'Tab' && editingEl)`；`function absorbTrailingSiblings`；
   `function caretAtLiTextEnd`；`function refreshSemanticStyles`；`function ensureColorStyle`；
   `function ensureSchemaBaseline`；`const COLOR_CSS`；`const TEXT_COLORS`；`const BASELINE_CSS`；
   嵌套列表 margin 那行 `:where(li>ul,li>ol){margin`。校验器在 `src/lib/schema-validate.js`：`function validate`、
   `block-style`、`validateHead`、`validateList`。
3. **校验器在 `src/lib/schema-validate.js`，不在 `src/editor/`。**

## 1. 目标与范围

把真 app 块编辑器（`src/editor/blockedit.js`）的 Tab / Shift+Tab 缩进逻辑对齐到 ui-demo
（分支 `feat/ui-demo-block-indent`，Colin 2026-07-24 真机验收）。分两条轨：

- **Track 1 · 列表 Tab 对齐** —— 交互逻辑纯 DOM、范式安全（容器嵌套是 §1.3 认可的缩进表达）。
  但注意 **U2（嵌套 margin）不是低风险**：它改的是随每篇文档入盘的 baseline CSS = 全语料库渲染迁移（见 §4.3）。
  所以 Track 1 = 「U1 窄半径交互修复 + U2 全语料 CSS 迁移」两个风险画像**不同**的单元，拆两个 PR（§6）。
- **Track 2 · 段落/标题整块缩进** —— 真 app 完全没有此概念，且触及 Schema-1 范式（§1.3），
  是一次需要 **Colin + Wendi 拍板的产品/范式决策**（§4.1）。**拍板前只出决策物料、不写 U4–U6 代码。**

**Colin 诉求的演进（要写清，否则 Track 1 看着像在做 Colin 嫌弃的事）**：origin brainstorm 记的痛点是
「列表 Tab 是嵌套、Colin 想要整行文本缩进」。**Colin 2026-07-24 真机验收 ui-demo「Tab 逻辑没问题」，
已覆盖那条旧抱怨**——他的「文本缩进」诉求现在只落在**段落**（Track 2），列表按嵌套走他已接受。Track 1 的
真正驱动 = 这次验收 + ui-demo 分支，不是借 origin 的权威。

**范围外**：不重构块模型（`blockOf`/`classify`/`topBlocks`）；不动 ui-demo（真相源、已定稿）。
⚠「不重构块模型」这条**恰好排除了一条 §1.3 合规的段落缩进路径**（把缩进段落表示成无样式嵌套容器）——
这是**主动 scope out、不是不可能**，§4.1 会把它当 Wendi 的一个正式选项摆出来。

## 2. 真相源：ui-demo 侧最终逻辑（分支 feat/ui-demo-block-indent @ 72794e3）

要对齐过来的目标行为，已在 ui-demo 实测通过（`ui-demo/src/components/Canvas.tsx`/`Canvas.css`/`mock/store.ts`/`types.ts`）：

**列表块 Tab / Shift+Tab：**
- 折叠光标 → 光标所在 li；跨行选区 → 选区覆盖的所有**最外层** li（多选整体缩进/出列）。
- 目标 li 判定用 **li「自身内容」范围**（`setStart(li,0)`；有子列表则 `setEndBefore(子ul/ol)`，否则 `setEnd(li,childNodes.length)`），
  做内容非零交集（`compareBoundaryPoints(END_TO_START)<0 && compareBoundaryPoints(START_TO_END)>0`），
  再滤掉「被其他命中 li 包含」的。⚠ **不能用 `selectNodeContents(li)`**（含子列表 → 子项被选中时父项误命中，ego-browser 探针实锤）。
- Tab：移入「组首上一项」的子列表，子列表继承直接父列表 tag/class（D3）。
- Shift+Tab：出列前 `absorbTrailingSiblings`（收编后继非选中兄弟保序），各组 li 依序移到 hostLi 之后，空子列表删除。
- **光标/选区操作后原样恢复**（记 range 起止端点 → li reparent 后文本节点引用不变 → 精确复位）。缩进绝不动光标。
- 嵌套子列表 margin 归零 → 无下方位移。

**普通块（text/heading）Tab / Shift+Tab：**
- Tab 整块缩进一档、Shift+Tab 减一档，与光标位置无关（Notion 同款）。Notion 约束：最多比上一块深一级；第一块不能缩进。
- ui-demo 存 `block.indent`（数字），渲染成 `position:relative; left: indent*24px`。**关键**：ui-demo 选 `position:relative;left`
  **正是因为它保留文档流**（不改块宽、不重排、下方块不动）——这满足 §1 范式核心「块留文档流、可 reflow、可发布」。
  真正与 §1.3 有张力的**只是「固定 left」那窄一句**，不是文档流本身（§4.1 会精确区分）。**⚠ 真 app 不能照抄内联 style（§4.1）。**

（辅助）grip 图标纯 opacity 淡入不做位移——属 chrome 打磨，**明确列为 Tab 目标之外的可选 freebie U9，不阻塞主线**。

## 3. 现状对比（真 app origin/main vs ui-demo）— 缺口账本

| 能力 | 真 app 现状（grep 锚点） | ui-demo 目标 | 缺口 | 单元 |
|---|---|---|---|---|
| 列表 Tab 嵌套 | ✅ 有（Tab 处理器内）；D3 继承直接父列表 tag/class | 同 | 无 | — |
| 列表 Shift+Tab 出列 | ✅ 有；`absorbTrailingSiblings` 保序 | 同 | 无 | — |
| 出列后光标 | ✅ 原位保留（U19，单锚点恢复） | 原位保留（全 range 恢复） | 泛化到多选 | U1 |
| **列表多选行整体缩进** | ❌ 只处理 `sel.anchorNode.closest('li')` 单个 | ✅ 选区覆盖所有 li 分组 | **新增** | U1 |
| **跨块选区（rangeSelEls）按 Tab** | ❓ 未定义（handler 门控 editingEl；跨块态无 editingEl） | ui-demo 单 contenteditable 无此态 | **需显式定范围** | §4.4 |
| **嵌套子列表垂直 margin** | `:where(li>ul,li>ol){margin:.15em 0}`（BASELINE_CSS）→ 嵌套下移 | margin 0 → 零位移 | **改 baseline（全语料迁移）** | U2 |
| 普通块 Tab | 嵌进前一个 `<details>`；否则 no-op。**无整块缩进** | Tab 整块缩进一档 | **全新 + 范式决策** | U3–U6 |
| 块级缩进入盘表达 | 无 | 合规容器嵌套 或 `ws-indent-*` class 原语（待 Wendi 选） | **待拍板** | U3–U4 |

真 app 已有的「有限 class 视觉原语」四段式模板 = **`ws-color-*`**（grep：`TEXT_COLORS`/`COLOR_CSS` →
`refreshSemanticStyles` 的 `pairs` 数组 → `ensureColorStyle`（注入带 `data-ws-schema-css`）→ 块菜单色板 click 用
`el.classList.add` 不用 `el.style`），是 U4 若走 class 路线要照抄的样板。（`ws-al-*` 只在文档里画了、代码没实现，别当模板。）

## 4. 关键决策 & 阻塞依赖

### 4.1 【阻塞 Track 2·核心决策】段落缩进怎么表达 —— 给 Wendi/Colin 的三个诚实选项

⚠ 本节 v1 有个假二分（「段落无法嵌套→任何实现都违背 §1.3」），ce-doc-review adversarial 纠正：§1.3 的「用 DOM
嵌套」指**容器嵌套**（list-item/wrapper），真 app 列表就是这么做、Notion 段落缩进也是这么做。所以**存在合规路径**，
只是被「不重构块模型」scope out 了。给 Wendi 的问题必须摆成对等三选项，别手感优先偏向 yes：

- **选项 A · 合规容器嵌套**（§1.3 preferred）：把缩进段落表示成**无样式的嵌套容器**（如复用 Track-1 列表机制、
  把段落当 style-less 嵌套项，或受限 wrapper）。**范式安全、无新词汇**。代价：要动块模型/引入受限容器
  （本计划范围外），且要解决「无 bullet、无 `style=`、仍合规」的 HTML 表达（`list-style:none` 是 style、`<div>` 非法，
  需专门设计）。**这条 v1 漏了，是 Wendi 真正该优先考虑的路径。**
- **选项 B · `ws-indent-*` class 原语**（ui-demo 手感）：有限档 class + 入盘 CSS（照抄 ws-color 四段式）。
  诚实拆两层张力：① **文档流**——若用 `position:relative;left`，块**留在文档流、可 reflow、可发布**，满足 §1.3 核心，
  真正冲突的只是「固定 left」这窄措辞（若用 `padding-left` 则撞「数值缩进」更硬、且重排）；
  ② **词汇表承诺**——这不是「一次性豁免」，而是**永久把位置式缩进纳入 Schema-1 词汇**：`refreshSemanticStyles`
  自愈会让 **AI 生成 / md 导入**的文档也吐 `ws-indent-N`，三个面（编辑器 / AI-gen / md-adapter）都要长期维护一致
  （谁 own 要定）。North Star 是「干净嵌套式 HTML 对标取代 Notion」，引入数值/位置缩进是**方向性偏离**，要与手感收益等重量权衡。
- **选项 C · 不做段落缩进**：诚实承认。**⚠ toggle 嵌套不是替代品**——它加折叠框 + summary 行、且只在「前一个块已是
  `<details>`」时能嵌，孤立段落根本嵌不进去。所以「顶回 → 用 toggle 表达」是错的（v1 的锅），顶回的诚实结果是
  「段落缩进暂不提供」或转选项 A。

**产物 = 一次拍板结论。** 拍板前 U4–U6 不写代码。**「是否手感好」Colin 已答（好）；「范式该不该纳入位置缩进」
是 Wendi 的开放题**——两件事分开问，别用「Colin 已验收的原型」给范式题加砝码。两个上游视角（#337）预判 Wendi
大概率选 A/C（缩进=嵌套）。⚠ U3 这道门是**流程门、非技术门**（校验器天然容忍 `ws-indent` class，见 U6）——
靠纪律守，别让人抢跑。

### 4.2 【Track 2 设计点】Tab 在普通块上：toggle 嵌套 vs 整块缩进 + ws-indent class 命运

真 app 普通块 Tab 现在会「嵌进前一个 `<details>`」。若加整块缩进，同一 Tab 键要协调（随 U5 定、写进 spec）：
- 前一兄弟是 `<details>` → 保留 toggle 嵌套；否则整块缩进。Shift+Tab：在 toggle 体内先出 toggle，否则减档。
- **块带 `ws-indent-N` 进/出 toggle 时的 class 命运**（design-lens 抓的 P1，别让两种缩进叠加成双偏移）：
  **进 toggle 时剥掉 `ws-indent-*`**（结构嵌套取代数值缩进）；**出 toggle 时归 0 档**（或按新位置封顶）。带测试。

### 4.3 【Track 1 提醒】U2 是全语料库 CSS 迁移，不是低风险
U2 改 `BASELINE_CSS`（随每篇文档入盘的 `:where()` baseline）→ **所有已存文档**的嵌套列表间距都变。
`ensureSchemaBaseline` 靠 `existing.textContent !== BASELINE_CSS` 内容 diff 自动覆写旧文档（**没有版本号字段可 bump**，
v1 的「bump 版本」是幻影步骤，直接改 margin 值即触发）。但它**不 markDirty**——升级只在内存、**磁盘字节到下次保存才更新**，
故外部浏览器/已发布渲染在 re-save 前仍是旧间距（display-vs-disk 短暂分叉）。→ 独立 PR、跑视觉回归、别动 820/48 e2e 锚点。

### 4.4 【交互状态矩阵】Tab 在各选中态的行为（design/adversarial 抓的缺口，写进 spec）
| 状态 | Tab | Shift+Tab |
|---|---|---|
| editingEl + 折叠光标（列表） | 缩当前 li | 出当前 li（absorb 后继） |
| editingEl + 块内选区（列表，多 li） | 缩所有覆盖 li（分组） | 出所有覆盖 li（分组） |
| editingEl + 普通块（Track 2） | 整块缩进一档 | 减一档 |
| **跨块选区（rangeSelEls，无 editingEl，跨多个顶层块/多个列表块）** | **本计划显式定为 no-op**（不误动、不吞焦点异常）；批量跨块缩进单独立项，不塞进 U1/U5 | 同 no-op |
| 到封顶（列表出到顶层 / 首块 / 普通块 6 档或相对上一块+1） | **静默 no-op**（对齐 Notion，不加抖动/toast——明确定这个，别让实现各造反馈） | 同 |
- **键盘可达性（WCAG 2.1.2）**：Tab 拦截从「仅列表」扩到「所有块」后，键盘/屏读用户退出编辑区的路径 = **Esc 退到块选中态，再 Tab 正常移焦**（写进 U5 spec + 测）。
- **可发现性**：普通块 Tab 缩进是全新手势，复用仓库既有「快捷键教学气泡」模式（team-memory wendi-feedback-batch2）在 U8 spec 记一笔，非阻塞。

## 5. 实施单元

> 纪律：从 `origin/main` 切分支；PR + required checks {test, e2e-all}；动 `blockedit.js`（共享核心）推 PR 前本地
> `npm run test:e2e:dot`；新门配变异自检（先 commit 再变异）；谁改真 app 交互谁同 PR 更新 feature spec（U8）。
> **e2e 发 Shift+Tab 用仓库现成 pattern** `keyboard.down('Shift'); keyboard.press('Tab'); keyboard.up('Shift')`
> （`e2e/todo-nested-keys.spec.js` 已在 CI 跑绿）或 `keyboard.press('Shift+Tab')`（`e2e/toggle.spec.js`）——
> **不需要 CDP**（那是 ego-browser 的坑，不迁移到真 app Playwright/Electron；CDP 仅留作某用例实测失败时的 fallback）。

### Track 1 —— 列表 Tab 对齐（可直接开工，无 Schema 依赖）

#### U1 · 列表 Tab/Shift+Tab 支持多选行 + 光标/选区不跳
- **Goal**：真 app 列表分支从「单 li（anchor）」泛化到「选区覆盖的所有最外层 li，分组整体缩进/出列」；U19 单锚点恢复泛化为全 range 恢复。
- **Files**：`src/editor/blockedit.js`（Tab 处理器列表分支）；`e2e/`（扩充列表缩进 spec）。
- **Approach**：移植 ui-demo `Canvas.tsx` 的 targets 逻辑，用真 app 的 `doc.getSelection()`/`doc.createRange()`：
  1. 折叠 → `anchor.closest('li')`（且 `editingEl.contains`）；非折叠 → 遍历 `editingEl.querySelectorAll('li')`，
     用 **li 自身内容范围**（见 §2）做内容非零交集，再滤最外层。**precondition：多选只在单个列表块（editingEl）内**——
     跨列表块选区落 §4.4 的 no-op，别半应用。
  2. 记 range 四端点。3. 按 `li.parentElement` 分组（保 DOM 顺序）。
  4. Shift+Tab：逐组 `hostLi=parentList.parentElement`，非 LI 跳过；`absorbTrailingSiblings(组末项)`；`ref=hostLi; for(li of 组){ref.after(li);ref=li}`；空子列表删。**复用现成 `absorbTrailingSiblings`**。
  5. Tab：逐组 `prev=组首.previousElementSibling`，非 LI 跳过；取/建 prev 尾随子列表（tag/class 继承 `parentList`，D3）；组内各 li 依序 `sub.appendChild`。
  6. `undoMgr.checkpoint()`+`markDirty()`；**恢复 range**（端点 `isConnected` 才重建，offset clamp）；失败回退 `caretAtLiTextEnd`。
- **保留复用**：`absorbTrailingSiblings`、`caretAtLiTextEnd`、D3、U19 思路，别重写。
- **Test scenarios**（e2e，keyboard 真键）：
  1. 嵌套两兄弟子项 → 多选两行 Shift+Tab → 两行一起回顶层、保序（修前只退首行）。
  2. 多选两行 Tab → 两行一起嵌回同一父项。
  3. 单行 Shift+Tab（有后继兄弟）→ 本行原地降级、后继跟随（回归 absorb）。
  4. 光标在行中间 Tab → 光标 offset 不变（不跳行末）。
  5. 多选 Shift+Tab 后选区仍覆盖那两行（全 range 恢复，非折叠成单点）。
  6. 顶层项 Shift+Tab / 首项 Tab → no-op（§4.4）。
  7. 跨两个相邻列表块选区 Tab → §4.4 定义的 no-op（不半应用、不异常）。
  8. todo 列表嵌套 → 子列表仍 `ws-todo`（D3）。
  9. **undo**：单次 ⌘Z 复原一次缩进的结构 + 光标；连按 Tab 3 档是否合并成一步 undo —— 定并测（建议不合并，每次 checkpoint 一步）。
- **变异自检**：判定改回 `selectNodeContents` → 用例 1 翻红；删 range 恢复 → 用例 4/5 翻红。破坏后仍绿=哑门。
- **Regression risk**：动共享核心 Tab 分支 → 推 PR 前全量 `e2e:dot`；回归既有 keys-* / toggle e2e。
  ⚠ 残险（adversarial）：多选 surgery 后端点可能 `isConnected` 却落进**别的 li** = 选区视觉上错但静默——用例 5 要断言选区**文本**而非只断言 collapsed，兜住这个。
- **Deps**：无。**独立 PR**（与 U2 分开，风险画像不同）。

#### U2 · 嵌套子列表垂直 margin 归零（全语料 CSS 迁移，独立 PR）
- **Goal**：嵌套列表项时下方内容零位移。
- **Files**：`src/editor/blockedit.js` 的 `BASELINE_CSS`（grep `:where(li>ul,li>ol){margin`）。
- **Approach**：把该行 margin 从 `.15em 0` 改 `0`（子项仍留 `:where(li){margin:.3em 0}`，与顶层项一致 → 嵌套不增减垂直空间）。
  **不需要 bump 版本号**（§4.3：内容 diff 自动覆写）。
- **Test**：e2e 量化——嵌套一列表项前后，「列表块下方锚点 `getBoundingClientRect().top` 不变」；再嵌一层仍不变。
- **变异自检**：margin 改回 `.15em 0` → 断言翻红。
- **Regression risk**：**全语料库渲染迁移**（§4.3），display-vs-disk 到 re-save 才一致。跑视觉回归，别动 820/48 锚点。
- **Deps**：无。**独立 PR**（可先于/后于 U1）。

### Track 2 —— 段落/标题整块缩进（阻塞于 §4.1 拍板，拍板前不写代码）

#### U3 · 【拍板门】段落缩进走哪条路（选项 A/B/C，Colin + Wendi）
- **Goal**：拿到「段落缩进是否做、走 A 合规嵌套 / B ws-indent 原语 / C 不做」的明确结论（§4.1）。**产物是决策，不是代码。**
- **Approach**：把 §4.1 三选项 + ui-demo 手感原型（Colin 已验收）当物料给 Colin + Wendi。**手感题与范式题分开问。** 结论记进 #337（Q2 resolved）。
- **Deps**：**U4–U6 全阻塞于此。** 选 A → 另立块模型/容器计划；选 B → 下走 U4–U6；选 C → Track 2 关闭。

#### U4 · （仅当选 B）`ws-indent-*` 有限 class 原语（照抄 ws-color 四段式）
- **前置**：U3=选 B。
- **Files**：`src/editor/blockedit.js`（新 `INDENT_LEVELS`/`INDENT_CSS`/`ensureIndentStyle` + 注册进 `refreshSemanticStyles` 的 `pairs`）。
- **Approach**（照 grep 锚点找 ws-color 四处：`TEXT_COLORS`/`COLOR_CSS` 定义、`refreshSemanticStyles` 的 `pairs`、`ensureColorStyle`、块菜单色板 click）：
  1. **有限档** `const INDENT_LEVELS = [1,2,3,4,5,6];`（封顶 6，别开放任意数——U5 必须夹这个上限）。
  2. `INDENT_CSS = INDENT_LEVELS.map(n=>':where(.ws-indent-'+n+'){<位移>}').join('')`。`<位移>` **由 U3 定**：
     选 B 且 Wendi 认「固定 left」→ `position:relative;left:<n*24>px`（保流、无位移、对齐 ui-demo）；
     否则退 `padding-left:<n*24>px`（撞数值缩进 + 重排，最不推荐）。
  3. `ensureIndentStyle`：注入 `<style id="ws-indent-style" data-ws-schema-css="indent">`（过 `validateHead` + 存活 serialize 的关键）。
  4. `pairs` 加 `['indent', INDENT_CSS, 'ws-indent-style', '[class*="ws-indent-"]']`（自愈补 CSS）。⚠ 这一步意味着 AI-gen/md 文档也会带 `ws-indent`——三面一致性（§4.1 选项 B②）。
- **Test**（vitest 纯逻辑 + e2e 渲染）：档位 class → 位移生效；清零复原；含 class 但无 `<style>` 的文档自愈补 CSS。
- **变异自检**：删 `pairs` 里 indent 条目 → 自愈用例翻红。
- **Deps**：U3=B。

#### U5 · （仅当选 B）blockedit.js 普通块 Tab → 整块缩进（协调 toggle + 封顶 + a11y）
- **前置**：U3=B、U4。
- **Files**：`src/editor/blockedit.js` Tab 处理器非列表分支（grep `classify(editingEl) !== 'list'`）。
- **Approach**：
  1. 非列表分支先判 toggle（§4.2）：`prev` 是 `<details>` → 走既有 toggle 嵌套（且**剥掉本块 `ws-indent-*`**）；toggle 体内 Shift+Tab → 既有出 toggle（归 0 档）。
  2. 否则整块缩进：读本块当前档（解析 `ws-indent-N` class，无则 0）；
     `next = shift ? max(0,cur-1) : min(cur+1, (上一顶层块档)+1)`，**再夹绝对上限** `next = min(next, 6)`（design-lens P1：不夹会算出无 CSS 的 ws-indent-7 静默失效）；无上块封 0。
     `next!==cur` 时移旧 `ws-indent-*`、按 next 加新 class（next>0）、`ensureIndentStyle()`、`checkpoint()`/`markDirty()`。**绝不 `el.style`**（块 style 被校验器判非法，照 ws-color 注释）。
  3. 光标：`enterEdit(editingEl,{mode:'keep'})` 保光标。
  4. **a11y 退出路径**（§4.4）：确认 Esc 退块选中态后 Tab 能正常移焦（既有行为，测一条兜住不回归）。
- **Test**（e2e，keyboard 真键）：
  1. 段落 Tab → 带 `ws-indent-1`、右移一档、**下方块 top 不变**。
  2. 连按 Tab → 封顶不超上一块+1；**7 连块各深一级、第 8 次不越 6 档**（不产 ws-indent-7）。
  3. Shift+Tab → 减档 / 到 0 移 class。 4. 首块 Tab → no-op。
  5. 前一块是 toggle → Tab 仍嵌 toggle 且剥 ws-indent；带 ws-indent-2 的块 Tab 进 toggle 再 Shift-Tab 出 → 不双偏移、出来 0 档。
  6. 光标中间 Tab → 光标不跳、整块缩进。
  7. 缩进后 serialize→reparse 跑 `schema-validate` **conform 恒真**。
  8. Esc → 块选中态 → Tab 能移焦出编辑区（a11y 不回归）。
- **变异自检**：改成 `el.style.paddingLeft=` → 用例 7 conform 翻红；去 `min(next,6)` → 用例 2 翻红；去封顶 `min(...,prev+1)` → 用例 2 翻红。
- **Deps**：U3=B、U4。

#### U6 · （仅当选 B）校验器确认（大概率零改动）
- **前置**：U3=B。
- **Approach**：`src/lib/schema-validate.js` 无 class 白名单、只黑名单块级 `style=` → `ws-indent-N` 天然容忍（同 ws-color）。
  加断言测试（`test/schema-validate.test.js`）：带 `ws-indent-3` 的合规 `<p>` → `validate().conform===true`。
  想升级为显式白名单（防错拼）另议、非必需。
- **Deps**：U3=B。

### 跨轨

#### U7 · e2e 全量 + 变异自检落门
各单元 e2e 汇总进 `e2e/`。Shift+Tab 用 keyboard 真键（非 CDP）。每门配变异自检。required check {test, e2e-all}；动 blockedit.js 推前本地 `e2e:dot`。

#### U8 · Feature spec + 范式文档 + #337 收口
- 更新/新建 `docs/features/`（Tab 缩进契约：§4.4 交互矩阵、列表多选、普通块整块缩进、toggle 优先级+ws-indent 剥离、嵌套零位移、a11y 退出、可发现性）。
- **若 U3 选 B 落地**：`docs/schema-1-draft-v0.md` §1.3 的「不用数值/不写 left 铁律」需记一条正式例外（不能只改 docs/features/，否则范式正文与实现矛盾）。
- brainstorm #337 Q2 随 U3 收口。

#### U9 · （可选、Tab 目标之外）grip 淡入去位移
真 app grip 若有同款滑入动画，顺带对齐纯 opacity 淡入。**明确非本计划 Tab 目标、不阻塞**——picked up 才做。

## 6. 排期与依赖
```
Track 1（无依赖，先做）:  U1（独立 PR，窄半径）
                         U2（独立 PR，全语料 CSS 迁移，跑视觉回归）
                         └─ 各带 e2e/变异(U7) + spec(U8 对应段) → 分别合并
Track 2（阻塞拍板）: U3[Colin+Wendi 选 A/B/C] ─(仅 B)─► U4 ─► U5 ─► U6 ─► e2e/变异(U7) ─► spec+范式文档(U8) ─► PR
```
- **立即做**：U1（+ U2 独立）—— 列表 Tab 对齐，Colin 反复踩的场景，价值最高、交互半径最小。
- **Track 2 挂起**：等 U3 三选一。选 B 才排 U4→U5→U6，且不合 main 直到范式拍板落地。

## 7. 风险清单
| 风险 | 缓解 |
|---|---|
| 读错文件（worktree 旧 blockedit.js） | §0：从 origin/main 切、按 grep 锚点定位（不信绝对行号） |
| 动 Tab 核心跨文件回归 | 推 PR 前全量 `e2e:dot`；回归 keys/toggle e2e |
| U2 全语料渲染迁移 + display/disk 分叉 | 独立 PR；视觉回归；别动 820/48；知悉 re-save 前磁盘旧值 |
| 多选 range 恢复落错 li（静默） | 用例断言选区文本、非仅 collapsed |
| Track 2 撞范式/框架被摆歪 | §4.1 三选项诚实呈现；U3 手感题范式题分开问；不拍不写 |
| U3 是流程门、可抢跑 | 纪律守；PR 不合直到范式拍板落 docs |
| 普通块 6 档溢出静默失效 | U5 `min(next,6)` + 7 连块用例 |
| block 级 style 混入 | U5 强制走 class，变异自检 conform 断言兜底 |

## 8. 相关
- 真相源：`feat/ui-demo-block-indent @ 72794e3`。
- 权威代码：`git show origin/main:src/editor/blockedit.js`（2901 行；grep：Tab `if (e.key === 'Tab' && editingEl)`、`function absorbTrailingSiblings`、`function caretAtLiTextEnd`、`const BASELINE_CSS` / `:where(li>ul,li>ol){margin`、ws-color 四段 `TEXT_COLORS`/`COLOR_CSS`/`refreshSemanticStyles`/`ensureColorStyle`）。
- 校验器：`src/lib/schema-validate.js`（`function validate`、`block-style`、`validateHead`、`validateList`）。
- Schema 范式：`docs/schema-1-draft-v0.md`（§1.3 缩进铁律；§2.3 ws-al 意图；§0 决策5 heading h4 封顶）。
- 决策源：brainstorm #337（分支 docs/todo-item-granularity，未入 main）。
- 评审：2026-07-24 ce-doc-review 六 persona findings 已吸收（行号→grep 锚点、CDP→keyboard、去幻影版本 bump、6 档封顶、跨块 no-op、toggle+indent 剥离、§4.1 三选项诚实化、U2 拆 PR）。
