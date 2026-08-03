# 表格块编辑 —— 对齐 spec

> 占位 spec（2026-08-03 随 feat/table-block-editing U1 建）。实现推进中，定稿随 P2 收官
> （plan：docs/plans/2026-08-03-001-feat-table-block-editing-plan.md）。

## 行为契约

- 创建：斜杠菜单「表格」→ canonical 种子 `<table class="ws-table">` + thead 一行（3×th[scope=col]）+ tbody 2×3，空格带 `<br>`。空锚块原地替换、非空插下方。
- 磁盘格式：Schema Table v1 文法（矩形、禁 colspan/rowspan、cell phrasing-only、无 caption/colgroup/tfoot、thead ≤1 行）；边框样式走 baseline 入盘 CSS，无独立 style pair。
- 单元格编辑 / 键盘契约 / 选区删除 / 行列增删 / 对齐：实现中，逐单元落地后补记。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 表格块 | src/components/Canvas.tsx（table 分支） | src/editor/blockedit.js（classify 'table' + tableSeed + cell 级编辑） |
| 校验 | src/lib/schemaCheck.ts | src/lib/schema-validate.js validateTable |
| e2e | — | e2e/table.spec.js |

## 有意分歧

- ui-demo 表格是 demo 级「整个 wrapper contentEditable + 加/删行按钮条」；真 app 做 cell 级 contenteditable + 块菜单行列操作（plan KTD1，Colin 拍板 2026-08-03）。ui-demo 定位=外壳原型，此分歧长期成立。

## 对齐锚点

- 尚未对齐（真 app 实现中）。

## 欠账

- 真 app 表格编辑 P1/P2 实现中（feat/table-block-editing），完成前真 app 表格能力落后于本 spec 行为契约的目标态。
- ui-demo 侧未升级 cell 级交互（demo 定位，暂不追）。
- .md 文档中造表会被 md-adapter 岛化（class 不在白名单）；对 md 来源表格切对齐同账。绕法：.md 文档少用编辑器造表，或接受 HTML 岛。
- cell 内 @提及/互链菜单 v1 不可用（天然 inert，功能缺失非损坏）。
- 中文 IME 在 cell 内的组词只能真机验收（历史教训），发版前 checklist 项。
