# Toggle（可折叠块 / Notion toggle）—— 对齐 spec

Notion 式可折叠块。磁盘 = 原生 `<details><summary>…</summary>…正文…</details>`，折叠态 = `open` 属性。
磁盘契约（`src/lib/schema-validate.js` `validateDetails`）+ AI 生成指南早已 ship；本 feature 补的是**编辑器创作**。
需求 `docs/brainstorms/2026-07-20-toggle-list-block-requirements.md`，计划 `docs/plans/2026-07-20-001-feat-toggle-list-block-plan.md`。

## 行为契约

- **创建**：slash `/折叠`（`/toggle`）——**空块原地变身**（turnInto 同款 `replaceWith`，行几何不动、不留空段落；#347 修，旧 insertAfter 会让光标肉眼下坠一行=Wendi 2026-07-24 视频 bug）；非空块插到下方。产物 `<details open><summary>(<br>)?</summary><p></p></details>`，光标落 summary。默认展开。turn-into 文本↔toggle（段落→summary+空正文；toggle→文本=正文块提到外层、summary→段落，零内容丢失）。
- **磁盘格式**：原生 `<details>`，不走 div+class+JS——产品命题「HTML 文件即真相、随处能开」，原生折叠零 JS、状态自描述在 `open`。校验器已认（`DETAILS ∈ TOP_BLOCKS`，`validateDetails` 管内部结构：恰一个 phrasing-only `<summary>` 作首子 + 正文=递归 flow，`open` 放行）。
- **标题编辑**：summary 是可编辑 phrasing 行（光标/IME/行内格式/链接）。编辑态**拦截原生激活**——点/空格/回车在 summary 上不触发折叠（只 chevron 折叠）。summary 恒 phrasing-only（无块子）。
- **正文=一等嵌套块**（**真 app 独有**，见有意分歧）：正文放任意一等块（段落/列表/图片/表格/乃至嵌套 toggle），每块独立落光标/选中/slash 插入/块菜单/拖拽。可达性模型 = scoped block-root（`<details>` 体是自己的编辑作用域）。
- **精确选区/删除/合并契约（Colin 2026-07-24 二轮拍板，全局规则、不止 toggle）**：①**选区所见即所得**——只有内容完全被选区罩住的行单位（顶层块 / summary 行 / toggle 体内块）才整行标蓝（data-ws2-rangesel）；端点块部分选中保持原生文字高亮，不补全、不上卷（唯一例外：端点落在 table 内 → table 整行蓝预示整删，因部分裁剪表格必产非合规=ED-A2）。②**精确删除**——起块裁尾、末块裁头、完全罩住的单位整删；**summary 整行被罩 = toggle 解散**（壳删、幸存体内块**原样提升**，去壳不转造、内容零丢失）；summary 只被裁一半 = toggle 存活、标题裁剪、**跨壁不并**（外面内容不被吸进 toggle、体内内容不漏出）。③**合并以上块为准**——断口两端同层且可并 → 下块剩余并入上块末尾、继承上块样式（上块是列表 → 并进最后一项，Notion 同款）；光标落接缝。④cut/打字覆盖同契约（三路共用 deleteSelection）；toggle 体内删空补 `<p>` 铁则；删空列表 de-list 成 `<p>`。旧「跨界空操作+flashNope」（a254cb6）与过渡期「端点上卷整块删」（#353）均废除。门：`e2e/block-range-select.spec.js` P1-P4 + U26a-e + `toggle.spec.js` BF-P2(精确)。
- **键盘边界契约**：Enter 正文中→分裂；空的末正文块 Enter→退出到 toggle 后新兄弟；summary 末 Enter→进首正文块（绝不分裂 summary）；首正文块起 Backspace→光标回 summary 末（绝不合并/删 summary）；空 toggle 的空 summary 起 Backspace→toggle 解包成段落（逃生）；Tab 嵌进前一个 `<details>`/Shift-Tab 移出；方向键跨 summary↔正文↔外层；折叠态 toggle 被方向键灰选中，Enter 聚焦其 summary。**≥1 正文块铁则**：summary-only 虽合规但是死胡同，编辑器恒守 ≥1 正文块（删到空则留空 `<p>`）。
- **折叠持久化**：`open` 落盘（`<details open>`=展开）。用户展开/折叠标 dirty + 自动保存，但**不是撤销步**（原生 `toggle` 事件捕获相 → markDirty，不 checkpoint）。
- **撤销解耦**：`open` 从撤销快照剥（`cleanedBodyHtml` 变体，仅 undo 层；`serializeDocument` 存盘保留），undo/redo 重写 DOM 后按 `<details>` 文档序位置索引重贴 fold。文档内容撤销不扰折叠态。已知 v1 局限：结构性 toggle 增删的撤销会让 fold 漂移（内容不丢）。
- **渲染/可移植**：baked `<style data-ws-schema-css="toggle">`（干原生三角双配方 `list-style:none` + `::-webkit-details-marker`）随文件入盘 → app 外任何浏览器零 JS 渲染成折叠块。**chevron=细线「›」**（border 两边 1.5px、#8a8f96、hover 墨色、折叠 -45°/展开 45° 旋转），对齐 ui-demo lucide 视觉——Wendi 2026-07-24 拍死实心大三角（\25B6 已废）；纯 CSS 零资源（文档自带 CSP 拦不到）。旧文档 attach 时 refreshSemanticStyles 按内容 diff 自动升级。强断言门 U25。
- **查找**：app 内查找命中折叠 toggle 内文字时自动展开其祖先 `<details>` 再滚动/高亮。
- **分页/导出**：分页引擎递归进 toggle 体（`collectCutAtoms` 深查已覆盖，加 `details` 选择器让嵌套 toggle 成整块切点）；PDF/打印前把所有 `<details>` 强制 `open`（导出克隆上，不碰实时 DOM），折叠内容绝不丢。

## 文件映射

- 真 app：`src/editor/blockedit.js`（classify/SLASH_ITEMS/newBlock/ensureToggleStyle/TOGGLE_CSS/refreshSemanticStyles/applySlash/scopeRootOf-blocksInScope-summaryOf/blockOf/topBlocks/onKeyDown 边界/deleteSelection/execText/dropFileLink/turnInto/onDrop/onPaste/attach-toggle-event）、`src/editor/serialize.js`（cleanedBodyHtml 剥 open）、`src/editor/undo.js`（undo/redo 重贴 fold）、`src/editor/format.js`（BLOCK_TAGS 加 SUMMARY）、`src/editor/pagination.js`（collectCutAtoms）、`src/renderer/shell.js`（buildWordspacePrintHtml force-expand）、`src/editor/find.js` + `src/lib/find-ranges.js`（折叠自动展开）、`src/i18n/{zh,en}/editor.js`（blockToggle）。
- ui-demo：`ui-demo/src/components/Canvas.tsx`（SLASH_ITEMS/applySlash/ToggleBlockView/isRawEditBlock/collectCutAtoms）、`ui-demo/src/types.ts`（BlockType）、`ui-demo/src/mock/store.ts`（newBlock/setBlockOpen/setBlockType）、`ui-demo/src/components/Canvas.css`、`ui-demo/src/lib/printExport.ts`、`ui-demo/src/i18n/{zh,en}/editor.ts`。

## 有意分歧

- **ui-demo 正文 = 单块 raw-HTML contentEditable 区（非真·一等嵌套块）；真嵌套只在真 app。** ui-demo 无 CI，激进嵌套重构回归只能手测、风险不可控；可达性无论如何都得在真 app 落地并用 CI+xvfb e2e 证。ui-demo 只证 UX 外壳（标题编辑/折叠/chevron/拦截激活）。先例：`editor-select-all.md`（ui-demo 止步块选中态，真 app 走全）。
- **折叠态持久化位置**：真 app = 磁盘 `open`（DOM 即模型）；ui-demo = 会话内（demo docs 不进 persist）。
- **撤销 fold 身份**：真 app = 位置索引（DOM 无稳定 id）；ui-demo = block.id（免漂移）。

## 对齐锚点
- ui-demo 侧：commit `<待 port>`（2026-07-20）
- app 侧：commit `<建设中>`（2026-07-20）

## 已知局限（v1，对抗审查记录在案，未修）

- **撤销的 fold 位置索引会漂移**：内容撤销跨越「增/删/重排一个 toggle」的操作时，_applyFold 按 `<details>` 文档序位置索引重贴 fold，会把折叠态贴到错的 toggle（内容不丢、仅折叠态错，且会随 autosave 落盘）。根因：innerHTML 重写销毁引用、无稳定 id（见 undo.js _captureFold/_applyFold）。KD5 已声明为 v1 接受的取舍；根治需位置映射（ProseMirror 那套），成本不匹配。
- **分页：toggle 体内单个超页高的块**（如一个高过一页的段落，无内部块）会让 collectCutAtoms 只产一个切点 → computeInnerSplits 走 inner-cut 分支、少算页数、内容溢出纸面下方。裸段落（非 toggle 内）走 ceil 拉伸兜底、正常。改分页引擎有风险（动已发版 paged-doc），暂记。多块体内正常。
- **分页：展开的嵌套 toggle 的 summary 可能被内切孤立**（切点落在嵌套 toggle 首块 → summary 单独留在上页底）。collectCutAtoms 的跳过守卫只护折叠的嵌套 toggle。P3。
- **PDF：break-inside:avoid 只覆盖 body 直接子**，嵌套 `<details>` 与「超一页高的顶层 toggle」不保证 summary 与正文同页。force-expand 保证内容在、不保证版面。P3。
- **RTL / summary 左内距下 chevron 命中区错位**：chevron 折叠区硬编码「summary 左缘 20px 内」，RTL 文档 chevron 在右、命中反了。P3。
- **分页态点折叠 toggle 下方页隙可能误折叠它**（onGapClick 合成的 click 落到 summary chevron 区）。P3。

## 欠账

- **ui-demo 未实现精确选区/删除/合并契约（2026-07-24）**：Colin 二轮拍板的全局契约（精确高亮/解散/以上块为准合并）只落在真 app；ui-demo 的跨块选区删除仍是旧简化实现。ui-demo 定位=外壳手感原型（KD3），此漂移暂记欠账，若 ui-demo 要演示删除交互再补。
真 app 13 单元（U4-U13）全实现 + e2e `e2e/toggle.spec.js` 21 绿（16 功能 + 5 对抗回归门）；ui-demo U1-U3。待：port 完成后更新对齐锚点；上面已知局限按优先级择机修。
