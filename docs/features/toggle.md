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

**与 Notion 的粒度对拍（2026-08-04，分支 feat/ux-granularity）。** 18 条交互事实实测：**粒度层全部一致**——标题行与每个体内块各有自己的手柄与「+」（锚点随缩进）、折叠态拖拽单位是整个 `<details>`（含隐藏子块）、体内块可独立拖出、标题行菜单作用域=整块、体内块菜单作用域=该块、标题行「+」插在整个 toggle **之后**（不是体内）。以下三条本轮改齐：

- **标题行末尾 Enter = 在体内新建空块并落光标**（对拍 T14）。此前是跳到**已存在**的首个体内块 → 用户按 Enter 想写新东西、光标却神秘落到已有内容上。首块本就是空叶子块时不再多插一个（防连按堆空块）；**折叠态下按 Enter 自动展开**（否则新块看不见）。
- **空 toggle 的可感知性**（对拍 T17）。体内只有一个空叶子块时：编辑器内显示占位提示（`editor.emptyTogglePlaceholder`，zh/en 双词条），且折叠三角**淡一档**与非空区分。判据用 `:has(> :not(summary):only-of-type:empty)`。⚠ **这两条都是编辑器 chrome、绝不入盘**——浏览器直开一个空折叠块不该出现「点这里放东西」的提示。
- **折叠热区 24px**（对拍 T4）。从 summary 左缘起 20px 扩到 24px，对齐 Notion 的 24×24 语义按钮尺寸；热区外点击仍是进标题编辑。

门：`e2e/toggle-align.spec.js`（6 条）。

**标题行首 Backspace = 降级成文本块（对拍 T15 / E2，Colin 2026-08-04 拍板「按 Notion 做」，已落地）。** 旧行为是零反馈死胡同——标题非空或体非空时**什么都不发生**，用户找不到退出这个折叠块的办法。Notion 实证：① 剥掉 toggle 格式变文本块（体内块仍挂在它下面）；② 再退一次才并入上一块、体内块升到顶层。我们的 `<p>` 不能有子块（文法所限）→ **① 一步到位**：标题成段落、体内块按序提升为其后的兄弟，正是现成的 `turnInto(details→text)`（U9/R2）语义，与菜单「转为正文」路径同款；**第二次退格**落进通用合并分支，自动得到 Notion ② 的终态。折叠态下按也降级（内容不会因为收着就丢）。**空 toggle 的逃生路径不变**（解包成空段落，且空产物必带 `<br>` 才装得住光标）。门：`e2e/list-backspace-peel.spec.js` E2-1/E2-2/E2-3。

**有意分歧（不改）**：体内块缩进步长 22px（Notion 32px）；菜单项集差异（我们无 Copy link / Move to / Comment / Ask AI，Notion 无「在下方插入」）；toggle 块暂不给色板（`isEditableEl(details)===false` gate，要放开需先验 `ws-color-*` 挂 `<details>` 的合规性）；「+」点下去我们直接生成空块进编辑、Notion 会立刻弹块类型选择器——**Colin 2026-08-04 拍板按 Notion 做，排在 E5**（全局 gutter 行为、不是 toggle 专属，故单列一个单元、门要覆盖所有块类型）。

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
- **粒度对齐（本 track）**：app 侧 `feat/ux-granularity`（2026-08-04，T14/T17/T4）；ui-demo 侧未跟进（见下）

**⚠ ui-demo 侧漂移（本轮产生，2026-08-04）**：与 Notion 的粒度对齐全部只做在真 app（`src/editor/blockedit.js`），ui-demo 未跟进。按仓库铁律当场进账本、不等审计。要不要回流 ui-demo 由 Colin 定——ui-demo 是「给人讨论 UX 的参考原型」，这批改动的真相源已经是真 app + 本 spec。


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
