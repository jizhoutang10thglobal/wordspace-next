# 新建文档弹窗（模板台 / 范式） —— 对齐 spec

> 占位 spec（2026-07-23 补建，随「模板收敛为 blank-only」一起落）。覆盖真 app 的新建文档入口与模板台；ui-demo 侧的完整模板画廊（官方 + 用户自定义模板）作为**有意分歧**记录在案，见下。

## 行为契约

**新建入口。** 真 app 三个入口都走同一个 `openCreateModal`：① 标签页区「+」/ Cmd+T（`temp` 模式，临时文档，不落盘，手动保存时再选文件夹）；② 文件夹 hover「+」；③ 文件夹右键「新建文档」（后两者落点到该文件夹、直接落盘）。

**模板台。** 弹窗里是一格模板卡网格。**内置模板现阶段只有「空文档」一张**（Wendi 2026-07-23：以空白文档为主，会议纪要 / 项目方案 / 周计划 等成套模板先撤）。点卡片 = 按该模板的 HTML 建文档；文件名一律默认「未命名」（Colin 拍板：模板给内容不给名字，保存时用户再改名）。空文档正文 = `<h1>未命名</h1><p></p>`。

**范式（Paradigm）选择。** 仅在 `temp`/omni 模式（Cmd+T / 标签+）显示：「New document」小节标 + Paradigm 1（可用，高亮）/ Paradigm 2 / Paradigm 3（灰态，hover 提示「敬请期待」）。**范式 tab 是给将来多编辑范式留的位，现在只有 Paradigm 1 一档、其余占位**——本次模板收敛不动它（外壳保留）。从文件夹「+」/右键进入（非 omni）不显范式 tab，只显卡片网格。

**omni 地址栏。** 仅 `temp` 模式：弹窗顶部一条地址栏（自动聚焦），输网址/搜索 Enter → 开网页标签并导航、关弹窗。这是「新标签页 + 新建文档」二合一（Arc 式），本次不动。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 新建弹窗渲染 | `ui-demo/src/components/CreateModal.tsx` | `src/renderer/sidebar.js`（`openCreateModal`） |
| 模板数据 | `ui-demo/src/mock/seed.ts`（`seedTemplates`）+ `store.ts` | `src/lib/doc-templates.js`（`TEMPLATES`） |
| 模板名/说明 i18n | （React 内联） | `src/i18n/{zh,en}/template.js` |
| 范式 / 弹窗文案 i18n | （React 内联） | `src/i18n/{zh,en}/sidebar.js`（`paradigm1/2/3`、`newDoc`、`createTabSub`…） |
| 门 | — | `test/doc-templates.test.js`（每个模板产出符合 Schema #1）；`e2e/sidebar.spec.js`（模板台只剩空文档卡 + 新建落盘默认名） |

## 有意分歧

- **模板数量：真 app 只留空文档，ui-demo 保留完整模板画廊。**（Wendi 2026-07-23 拍板真 app 收敛）真 app `TEMPLATES` 只剩 `blank`；ui-demo `CreateModal` 仍是完整画廊——官方模板（会议纪要/项目方案/周计划）+ 用户自定义模板（`origin: 'official' | 'user'`）+ 分类。ui-demo 是设计原型，探索的是**用户自定义模板**那套更完整的未来（Wendi 真要的 feature，见 [[user-defined-template-research]] / #194）；真 app 现阶段先砍到 blank-only。范式 tab 外壳两侧都留着，正是为这套未来占位。**因此本次收敛只动真 app，不动 ui-demo**。
- 模板名措辞两侧本就独立（真 app 走 i18n 字典、ui-demo React 内联），不逐字对齐。

## 对齐锚点

- ui-demo 侧：commit `2178e62`（CreateModal，2026-07-16）/ `9552141`（seed，2026-07-15）——与真 app 模板集**当前为有意分歧态，非对齐态**，锚点仅记录状态。
- app 侧：branch `fix/new-doc-blank-only`（2026-07-23，模板收敛为 blank-only）；基线 `origin/main` `2c02390`。

## 欠账

- **弹窗其余行为（omni 地址栏、范式 tab 交互、临时文档保存流）尚无独立细化 spec**，本份只把新建入口 + 模板台 + 范式外壳记到「够用」的粒度。
- **将来若上用户自定义模板（#194）**：真 app 的 `TEMPLATES` 会从 blank-only 再扩回来，届时更新本 spec 的「行为契约」与「有意分歧」（两侧可能重新收敛）。
