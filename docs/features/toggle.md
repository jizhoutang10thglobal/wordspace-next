# Toggle（可折叠块 / Notion toggle）—— 对齐 spec

Notion 式可折叠块。磁盘 = 原生 `<details><summary>…</summary>…正文…</details>`，折叠态 = `open` 属性。
磁盘契约（`src/lib/schema-validate.js` `validateDetails`）+ AI 生成指南早已 ship；本 feature 补的是**编辑器创作**。
需求 `docs/brainstorms/2026-07-20-toggle-list-block-requirements.md`，计划 `docs/plans/2026-07-20-001-feat-toggle-list-block-plan.md`。

## 行为契约

- **创建**：slash `/折叠`（`/toggle`）插入种子 `<details open><summary></summary><p></p></details>`，光标落 summary。默认展开。turn-into 文本↔toggle（段落→summary+空正文；toggle→文本=正文块提到外层、summary→段落，零内容丢失）。
- **磁盘格式**：原生 `<details>`，不走 div+class+JS——产品命题「HTML 文件即真相、随处能开」，原生折叠零 JS、状态自描述在 `open`。校验器已认（`DETAILS ∈ TOP_BLOCKS`，`validateDetails` 管内部结构：恰一个 phrasing-only `<summary>` 作首子 + 正文=递归 flow，`open` 放行）。
- **标题编辑**：summary 是可编辑 phrasing 行（光标/IME/行内格式/链接）。编辑态**拦截原生激活**——点/空格/回车在 summary 上不触发折叠（只 chevron 折叠）。summary 恒 phrasing-only（无块子）。
- **正文=一等嵌套块**（**真 app 独有**，见有意分歧）：正文放任意一等块（段落/列表/图片/表格/乃至嵌套 toggle），每块独立落光标/选中/slash 插入/块菜单/拖拽。可达性模型 = scoped block-root（`<details>` 体是自己的编辑作用域）。
- **键盘边界契约**：Enter 正文中→分裂；空的末正文块 Enter→退出到 toggle 后新兄弟；summary 末 Enter→进首正文块（绝不分裂 summary）；首正文块起 Backspace→光标回 summary 末（绝不合并/删 summary）；空 toggle 的空 summary 起 Backspace→toggle 解包成段落（逃生）；Tab 嵌进前一个 `<details>`/Shift-Tab 移出；方向键跨 summary↔正文↔外层；折叠态 toggle 被方向键灰选中，Enter 聚焦其 summary。**≥1 正文块铁则**：summary-only 虽合规但是死胡同，编辑器恒守 ≥1 正文块（删到空则留空 `<p>`）。
- **折叠持久化**：`open` 落盘（`<details open>`=展开）。用户展开/折叠标 dirty + 自动保存，但**不是撤销步**（原生 `toggle` 事件捕获相 → markDirty，不 checkpoint）。
- **撤销解耦**：`open` 从撤销快照剥（`cleanedBodyHtml` 变体，仅 undo 层；`serializeDocument` 存盘保留），undo/redo 重写 DOM 后按 `<details>` 文档序位置索引重贴 fold。文档内容撤销不扰折叠态。已知 v1 局限：结构性 toggle 增删的撤销会让 fold 漂移（内容不丢）。
- **渲染/可移植**：baked `<style data-ws-schema-css="toggle">`（干原生三角双配方 `list-style:none` + `::-webkit-details-marker`，纸方墨圆旋转 chevron）随文件入盘 → app 外任何浏览器零 JS 渲染成折叠块。
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

## 欠账
建设中（计划 13 单元）。已落：真 app U4（scaffold + baked chevron CSS + slash + i18n），e2e `e2e/toggle.spec.js` U4 绿。待落：U5（summary 编辑+折叠管线）、U6/U7（scoped 可达性+键盘边界，同 PR）、U8（拖拽）、U9（turn-into）、U10（撤销解耦）、U11（分页+PDF）、U12（查找自动展开）、U13（剪贴板）；ui-demo U1-U3。port 完成后更新对齐锚点。
