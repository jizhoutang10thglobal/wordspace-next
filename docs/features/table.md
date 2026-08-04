# 表格块编辑 —— 对齐 spec

> 定稿于 2026-08-03（feat/table-block-editing P1 + feat/table-block-p2）。plan：
> docs/plans/2026-08-03-001-feat-table-block-editing-plan.md。门：e2e/table.spec.js（33 条）+
> test/blockedit-table.test.js（23 条）。

## 行为契约

- **创建**：斜杠菜单「表格」（过滤词 table/biaoge/grid）→ canonical 种子 `<table class="ws-table">` + thead 一行（3×`th[scope=col]`）+ tbody 2×3，空格带 `<br>`。空锚块原地替换（不留空段垃圾）、非空插下方；造出即编辑、光标落首格。
- **磁盘格式**：Schema Table v1 文法——矩形（各行同格数）、禁 `colspan/rowspan`、cell phrasing-only、无 caption/colgroup/tfoot、thead ≤1 行。两种存量形态都可编辑（标签键控不看 class）：AI 生成的 `ws-table`+`ws-al-*` 与 md 转换的无 class+`align` 属性表。边框/内距样式走 baseline 入盘 CSS；对齐走 `<style data-ws-schema-css="align">` 入盘（存量 ws-al 表缺 style 时 attach 补注）。
- **单元格编辑**：点格进入 cell 级 contenteditable（挂 TD/TH、绝不挂 table；`cellEl` 第四状态，generic 块级分支 inert）；悬停 `cursor:text` 提示可编辑；编辑格 inset 蓝环。Esc 上卷灰选整表（永不灰选单格）；点表格边框缝隙/margin = 灰选整表。行内格式（B/I/U/S/链接气泡）在格内可用；「转为」/斜杠/色板在 cell 态禁用。
- **键盘边界**：Enter 跳下一行同列、末行建新行（恒落 tbody 恒产 TD——header-only md 表安全）；Shift+Enter 软换行 `<br>`；Tab/Shift+Tab 前后移格、末格 Tab 建行、首格 Shift+Tab 跳出；方向键格内原生、格界跨格、表界跳出（作用域感知，toggle 体内表同样成立）；⌘A 三档（本格→整表灰选→全篇；**第二档落定后不留格内文字选中**——内部已声明格级退出，屏上还标着某格被选中就成了「画的和做的不是同一个对象」；清选区前先把焦点停进 focusCatcher，否则第三档与后续 Backspace 都进不了 keydown）；灰选整表 Enter/↓ 进首格（键盘可达闭环）；空行行首 Backspace 删该行（Tab 误建行的对称逆操作，非空行首 no-op）；全部新分支带 IME 229 guard。
- **选区删除**：同表跨格拖选 = 全罩格整格蓝预示 + 清内容不动结构（线性被罩集，高亮与删除同源=所见即所删；端点格按 range 裁剪）；跨块选区端点落表内 = 整表蓝 + 整删（ED-A2 全局契约唯一例外，双向 e2e 钉死）；表-only 文档 ⌘A 全篇删 = 整删 + 补空段进编辑。
- **粘贴/复制**：cell 内任何粘贴压单行纯文本（多行 join、内部富 clip 压 textContent、html-only 剪贴板取纯文本兜底）；图片/文件拒收 + cell 锚定墨色小签「单元格只能放文字」（200ms 淡入/1.6s 淡出，Colin 拍板的可感知反馈）。格内选区复制 = 行内载荷（绝不升级整表）；跨格复制 v1 = 纯文本；灰选整表 ⌘C = 完整表块级富 clip（可整表搬运粘贴）。
- **行列增删**（块菜单，cell 编辑态开 grip 菜单）：上/下方插行、左/右侧插列、删除本行/本列。「当前」= 开菜单时正在编辑的格；**菜单开启期间目标行与目标列有底色标出**（`data-ws2-menurow` / `data-ws2-menucol`，纯交互态、serialize 与 PDF 导出两条路径都剥除），标记集合与 `tableEditOp` 真正作用的集合同源（都走 `tableRowsOf`/`rowCellsOf` 的数据行口径，天然继承分页 spacer 过滤）——否则「标出来的行」与「真会被删的行」可能不是同一批，比不标更误导。thead 特判：表头行上下插行都落 tbody 首位、插列在表头产 `th[scope=col]`；新格继承同列 `ws-al-*`；spacer 行（分页产物）不计数不被动。退化收敛：删最后数据行且表头在 → 自动补空行；删光行/删最后一列 → 升级删整表（绝不留 ghost 壳）。操作后焦点显式回落点格。
- **对齐**：块菜单三态钮（左/中/右），per-cell `ws-al-center`/`ws-al-right`（左=清 class 零字节）；CSS 入盘、浏览器直开生效。
- **撤销粒度**：结构操作（建行/行列增删/对齐）= 前后双 checkpoint（先结算 500ms 防抖打字债）——undo 只回滚结构不吞打字，恰一步；跨格清内容同款前置。undo/redo 后按 id/结构路径回原格恢复编辑态（光标精确位置不还原 = 全局 v1 取舍）。
- **发现性**：td/th 悬停 `cursor:text`；无教学气泡（Colin 拍板 2026-08-03 不加）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 表格块 | src/components/Canvas.tsx（table 分支，wrapper 级 CE + 按钮条） | src/editor/blockedit.js（cellEl 第四状态 + tableEditOp + 块菜单） |
| 校验 | src/lib/schemaCheck.ts | src/lib/schema-validate.js validateTable |
| 序列化 | persist() 回写 store | src/editor/serialize.js（data-ws2-cell 已登记 WS2_MARKERS） |
| 门 | — | e2e/table.spec.js + test/blockedit-table.test.js |

## 有意分歧

- ui-demo 表格是 demo 级「整个 wrapper contentEditable + 加/删行文字按钮条」；真 app 为 cell 级 contenteditable + 块菜单行列操作 + 键盘契约（plan KTD1，Colin 拍板 2026-08-03）。ui-demo 定位 = 外壳原型，此分歧长期成立。
- ui-demo 无对齐/列操作/选区语义；真 app 全量。不回流（demo 定位）。

## 对齐锚点

- 真 app：feat/table-block-editing（P1）+ feat/table-block-p2（P2），2026-08-03。ui-demo 侧未动。

## 已知局限（v1，对抗审查记录在案，未修）

- **图片 resize → 表内立即打字 → 立即行列操作 → undo**：undo.js 的 prop-top 早退（image resize 的 LIFO 保护，有意设计）会让前置 checkpoint 空转，undo 粒度有瑕疵（可能连字带行回滚）。不丢内容不破合规；根治要动共享 undo 核，成本不匹配。P3。
- undo 后光标精确位置不还原（回格末）——沿用全局 v1 取舍。
- 跨格格式化（选区罩多格点 B/I）不作用（选区语义归清内容/复制）；跨格复制是纯文本（矩形区域 TSV/子表复制 = 后续项）。
- cell 内 @提及/互链菜单不可用（cellEl 态天然 inert，功能缺失非损坏）。
- blockedit.js 已 3400+ 行（pre-existing + 本 feature 增量），拆 table 模块列入下次动此文件前的评估项。

## 欠账

- **中文 IME 在 cell 内组词只能真机验**（容器/CI 都验不了；历史上有真机才炸的先例）——发版前 Colin 真机 checklist 项。
- .md 文档中造表会被 md-adapter 岛化（class 不在白名单，管道表变 HTML 岛，内容保真但丢 md 可读性）；对 md 来源表格切对齐同账。绕法：.md 少用编辑器造表。等真实反馈再做「.md 造表产无 class + align 形态」分叉。
- ui-demo 侧不追 cell 级交互（demo 定位，见有意分歧）。
