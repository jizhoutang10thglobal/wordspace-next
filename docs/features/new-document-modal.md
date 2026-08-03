# 新建文档弹窗（范式轨 / 模板台） —— 对齐 spec

> 2026-07-23：真 app 弹窗已按 ui-demo `CreateModal` 布局移植到位（左范式轨 + 右模板 pane），两侧新建入口视觉/交互对齐。模板两侧都收敛为 blank-only。ui-demo 侧另有完整的模板管理页（`/templates`），真 app 尚无——作为**有意分歧**记录在案，见下。

## 行为契约

**新建入口。** 真 app 三个入口都走同一个 `openCreateModal`：① 标签页区「+」/ Cmd+T（`temp` 模式，临时文档，不落盘，手动保存时再选文件夹）；② 文件夹 hover「+」；③ 文件夹右键「新建文档」（后两者落点到该文件夹、直接落盘）。

**布局：左范式轨 + 右模板 pane（两侧一致）。** 弹窗主体是两栏：左边一条竖排「范式」轨，右边是该范式下的内容 pane。

- **顶部**：`temp`/omni 入口 = 全宽地址栏（Arc 式，聚焦时墨线从左划过，X 收在栏内右侧），输网址/搜索 Enter → 开网页标签并导航、关弹窗；非 omni（文件夹新建）= 标题头「新建文档 · 在 {位置}」+ X。
- **范式轨**：`类 Notion`（流式文档 = Schema 1，当前激活，图标+名+「当前」标+描述）/ `分页文档`（= Schema 2，可用，描述「按页排版，像 Word」）/ `范式 3`（灰态、锁图标、描述「敬请期待」）+ 轨底注「未来每个范式有各自的编辑方式与模板」。**范式轨在 omni 与非 omni 两种入口都显示。**（2026-07-23：分页拆分为独立 Schema 2 后，「范式 2」解灰为「分页文档」，见 `docs/features/paged-doc.md`。）
- **点选范式切右侧 pane**：点可用范式（类 Notion / 分页文档）→ pane 是**该范式对应 schema 的**模板卡网格（`makeCard` 按模板的 `schema` 字段过滤：流式范式只显 schema-1 模板、分页范式只显 schema-2）；点未上线范式（范式 3）→ pane 变占位（锁圈 + 「{范式} · 还在路上」+ 说明），无卡片。

**模板台（pane 内）。** **内置模板：流式范式 = 「空文档」一张；分页范式 = 「空白分页文档」一张**（Wendi 2026-07-23：以空白文档为主，成套模板先撤）。分页模板 = 空文档正文 `<h1>未命名</h1><p></p>` + head 带 `<meta name="wordspace-schema" content="2">` 与 canonical `@page` 块（`buildPageCss`），新建即以分页视图打开、磁盘归类 schema-2。卡片 = 图标 + 名 + 说明；点卡片按该模板 HTML 建文档，文件名一律默认「未命名」（Colin 拍板：模板给内容不给名字，保存时用户再改名）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 新建弹窗渲染 | `ui-demo/src/components/CreateModal.tsx` | `src/renderer/sidebar.js`（`openCreateModal`） |
| 弹窗样式 | `ui-demo/src/components/CreateModal.css`（`.cm-*`） | `src/renderer/browser.css`（`.sb-cm-*`）+ `src/renderer/shell.css`（`.sb-card*` / `.sb-modal*`） |
| 模板数据 | `ui-demo/src/mock/seed.ts`（`seedTemplates`）+ `store.ts` | `src/lib/doc-templates.js`（`TEMPLATES`） |
| 模板名/说明 i18n | （React 内联） | `src/i18n/{zh,en}/template.js` |
| 范式 / 弹窗文案 i18n | `ui-demo/src/i18n/*/modals.ts` | `src/i18n/{zh,en}/sidebar.js`（`paradigmLabel`/`paradigmNotion`/`paradigmCurrent`/`paradigmNotionDesc`/`paradigmPaged`/`paradigmPagedDesc`/`paradigm3`/`comingSoon`/`paradigmRailFoot`/`paradigmSoon`/`paradigmSoonDesc`、`newDoc`、`omniPlaceholder`）+ `src/i18n/{zh,en}/template.js`（`blankPagedName`/`blankPagedDesc`） |
| 门 | — | `test/doc-templates.test.js`（每个模板产出符合 Schema #1 + classify 归类 == 声明 schema）；`e2e/sidebar.spec.js`（① 模板台流式范式只剩空文档卡 + 新建落盘默认名；② 左范式轨 3 档 + 类 Notion/分页文档 可用、范式 3 灰态、按范式过滤模板；③ 选分页文档范式新建 → 磁盘 schema-2 + 分页视图） |

## 有意分歧

- **模板管理页：ui-demo 有 `/templates`，真 app 没有。** ui-demo 是设计原型，除了新建弹窗还有一整套模板管理（`TemplatesPage.tsx` 官方/我的模板增删改 + `SaveTemplateModal.tsx` 存为模板 + 侧栏 `/templates` 入口），探索的是**用户自定义模板**那套更完整的未来（Wendi 真要的 feature，见 [[user-defined-template-research]] / #194）。真 app 现阶段没有这个页，新建弹窗也因此 blank-only。**将来上 #194 时，真 app 会补上模板管理、新建弹窗的模板卡也会从 blank 扩回来**——届时两侧模板集重新收敛。
- 范式轨的 `范式 2/3` 是**双方共有**的占位（为多编辑范式留位），不算分歧。
- 文案措辞两侧本就独立（真 app 走 i18n 字典、ui-demo React 内联），不逐字对齐；语义对齐即可（如 `类 Notion`↔`Notion-like`、`当前`↔`Current`）。

## 对齐锚点

- ui-demo 侧：commit `2178e62`（CreateModal，2026-07-16）+ `feat/ui-demo-blank-only`（2026-07-23，弹窗模板卡收敛为 blank-only）。
- app 侧：`feat/real-app-modal-rail`（2026-07-23，弹窗布局移植成左范式轨 + 右 pane、对齐 ui-demo）；模板 blank-only 已随 `fix/new-doc-blank-only`（#334）落 main。
- 上次两侧确认对齐：2026-07-23（本次移植，Colin 真机验过视觉）。

## 欠账

- **omni 地址栏 / 临时文档保存流的细节**尚无独立细化 spec，本份记到「够用」粒度。
- **用户自定义模板 / 模板管理页（#194）** 是真 app 侧最大的未对齐块（ui-demo 已有原型），待排期。
