# 块模型对齐 Notion「每行一块」——架构调研

- **Date**: 2026-08-07
- **Status**: needs-decision（Wendi 拍方向，Colin 拍排期）
- **Origin**: Colin 2026-08-07 派活（「这么多 bug 风风补补不是办法，是不是要把 Schema 1 的块逻辑改一下」）。本文接替并覆盖 `docs/brainstorms/2026-08-06-todo-row-independent-block-costing.md` 挂着等 Wendi 拍的题——那份成本单的问题是本文的子集。
- **方法**: 六路并行调研（本仓代码盘点 / 17 单元 bug 归因 / Notion API+工程博客 / 业界五家先例含源码实证 / 五方案推演 / 既有拍板盘点），全部结论带 file:line 或 URL 证据，关键 claim 已抽查核实。

---

## 0. 三句话结论

1. **「对齐 Notion」必须拆成两层**：交互层（编辑器把每行当一个块来高亮/选中/拖拽/转换）和存储层（磁盘上每行独立成块）。调研结论是**交互层走到底、存储层不动**——用户感知层面这已经是完整的 Notion 手感，磁盘上仍是一张语义完整的 `<ul>`。
2. **这不是妥协，是 HTML-native 产品的正解**：Notion 自己的存储不是 HTML（专有块树，导出时才拼 HTML，且它导出的 HTML 正是我们产品愿景里的反面教材）；全球唯一「存储格式就是 HTML」的大规模块编辑器 WordPress Gutenberg，2018-2022 花四年把列表迁成「每行一个块」，**磁盘上却始终保持 li 嵌在语义 ul 里**。业界规律：持久化格式决定选择——块树产品按行存，HTML 产品按行编、按语义存。
3. **Colin 的前提检验结果：一半对一半**。17 个归因单元里约一半的 bug/补偿工程是「交互想按行、存储按整列表」的错配税（per-row 下结构性消失），但另一半是通用编辑器难题（跨块合并/选区/IME/剪贴板），**per-row 会把这一半放大**——每个行边界都变成块边界，#319/#324 那类跨块 bug 从「列表与邻块的交界」扩散到「每一对相邻行之间」。所以该拍的不是「要不要 per-row」，而是「以哪种方式 per-row、先付哪笔钱」。

---

## 1. 背景

Wendi 2026-08-05 反馈 todo 第二行「和上一行连成一起」并拍板「看 Notion 怎么搞的我们就怎么搞」。PR #421 已把编辑态高亮/勾选框/跨块蓝底修到行级（v0.12.x 待发版），但那是逐点下沉的补丁。Colin 2026-08-07 提出根本性问题：现状是「好几行是一块」，Notion 是「每一行都是一块」，要不要把 Schema 1 的底层逻辑整个改掉。

现状架构 = 方案 B（Colin 2026-07-23 拍板，`docs/brainstorms/2026-07-23-todo-item-granularity-requirements.md`）：**存储单元**（磁盘一张 canonical `<ul>`）与**交互单元**（per-`<li>`）解耦，交互层逐个行为向行级下沉。

## 2. 事实底座

### 2.1 Notion 的真实数据模型（权威源核实）

- 列表每一行（`bulleted_list_item` / `numbered_list_item` / `to_do`）在 API 里**各是一个有独立 UUID 的 block**；block 类型枚举里**不存在任何「列表容器」类型**（无 ul/ol wrapper）。[developers.notion.com/reference/block]
- 嵌套 = `has_children` + 子块挂在行块自己的 children 下（缩进是结构性操作：改父子关系，不是样式属性）。[官方工程博客 data-model-behind-notion]
- **有序编号不存储**：`numbered_list_item` 无任何逐项序号字段（仅一段列表的首项有可选 `list_start_index`/`list_format`），1/2/3 由渲染端对「连续同类兄弟」分组计数，被其他块打断即重新起算。
- **官方 HTML 导出不合并**：每个编号项独占一个 `<ol id="<块UUID>" start="N">`、每个无序项独占一个 `<ul id="<块UUID>">`（GitHub 多份真实导出文件实证）——这正是 `docs/product-vision.md` 拿来当反面教材的那种 HTML。Markdown 导出则是连续真实递增的 `1. 2. 3.` 行，天然构成标准 md 列表。
- ⚠ 待真机复核的小冲突：嵌套编号样式，第三方渲染器文档称 1/a/i 循环，本仓 team memory 真机对拍记录是每层十进制；权威源无定论。

### 2.2 业界先例：持久化格式决定选择（五家源码级实证）

| 产品 | 持久化格式 | 列表块粒度 | 磁盘/导出形态 |
|---|---|---|---|
| **Gutenberg**（WP 6.1+） | **HTML** | 每 li 一个 `core/list-item` inner block | **磁盘 ul 语义完整**，块注释「插缝」在 li 之间；编号挂父 list 块映射原生 ol 属性，浏览器算数字 |
| Notion | 专有块树 | 每行一块，无容器 | 导出时 HTML 不合并（单项 ol+start）、md 合并 |
| Anytype | protobuf 块树 | 每行一个 text 块（Style=Marked/Numbered/…），proto 全文无列表容器 | 导出 md 时状态机把连续同型行合并、编号导出时算 |
| BlockSuite/AFFiNE | 专有块树 | 每行一个 `affine:list` 块 | adapter walker 导出时合并连续同型块回语义列表 |
| Editor.js（反例） | JSON | 整列表一块（items 递归数组） | ——正是 Gutenberg 2018 年放弃的形态 |

**Gutenberg 为什么迁**（issue #6394，2018 提案→2022 落地）：单行无法用块工具重排、嵌套不能混类型、multiline RichText 是列表独占的特化复杂度——跟我们今天的痛一字不差。**它踩的坑**：迁移要走 block deprecation 机制、无效嵌套让迁移崩（#44822）、拆分/合并语义复杂到单独立项（#39519）、生态白名单没加 list-item 导致「列表只能打一行」大面积中招。

**两条横切规律**：① 凡行级化的地方都必须有「相邻同型列表自动合并」机制（ProseMirror 被用户逼出 autoJoin、Lexical mergeLists、BlockSuite/Anytype 导出层合并）；② **没有任何一家逐项存死编号**——要么原生 ol 算、要么模型内重算、要么导出时算。

**没有找到任何「把 HTML 当存储格式且按行拆存、不合并」的产品。**

### 2.3 我们代码里的现状：三层落点

- **块定义链（根）**：`classify` 整 UL/OL 判 'list'（`src/editor/blockedit.js:60`）、`blockOf` 永远上卷到 blockRoot 直接子（:957-972）、`enterEdit` 把 contenteditable 挂整个 ul（:1302）。li 从来不是块。
- **交互层：已经大半行级化**（方案 B 的成果）——行手柄、行拖拽、gutter「+」、行级菜单、turn-into 行级、跨块选区行级蓝底、编辑底色 editrow、多行上色、Tab 多选缩进、removeRow。但它们全是绕着「blockOf 返回 ul」写的**补偿层**：blockedit.js 里 84 处 UL/OL/LI 特判就是这层补偿的账本，⌘A/Esc 因此比别的块多一档，copy/paste 各有列表专判。
- **存储/文法层**：`schema-validate.js:20` TOP_BLOCKS 闭集（LI 不在）、validateList（:72-89）规定 li 只装 phrasing+嵌套列表；`coalesceLists`（blockedit.js:2039，注释原话「磁盘正本是**一张** canonical 列表」）专门维护这个不变式；md-adapter 双向以整张列表为单位。
- **一个关键技术事实**：列表内行间编辑（Enter 原生 li 分裂、行间拖选、跨行 IME）今天是靠「多行共存一个 contenteditable」**从浏览器原生免费拿到的**（blockedit.js:4109-4130）。这笔红利在任何 per-row 方案里都要重新买单。

### 2.4 bug 归因：错配税 vs 通用税（17 单元）

**错配税（8 条纯错配 + 2 条 mixed 的大头，per-row 下结构性不存在）**：⌘A 三档（#339）、单行 turn-into 及劈 ul 机器（#346）、#421 三条全部、空项脱列/todo→toggle 的容器手术（#331 一半）、以及**行手柄/行拖拽两整套 feature 本身**——它们在 per-row 模型下不是「修好了」而是「根本不用写」。这层补偿还在自产二阶 bug（#346 的 HIGH 误多抽行、行手柄七条对抗审查 findings、turnIntoLines 中间态 undo 写盘丢数据）——**错配税最硬的证据**。

**通用税（7 条，per-row 下照样存在甚至放大）**：#319 跨块退格合并、#324 跨块打字无主态（含中文 IME 欠账）、#314 跨块高亮、#317 剪贴板策略、勾选框对比度/深色 emoji 等。**反直觉的净账**：per-row 后选两行就是跨块选区，「无主态」出现频率大增，跨块 bug 家族的暴露面反而变大。

**结论**：per-row 能消灭约一半 bug 面和几乎全部行级补偿工程，**前提是先把跨块编辑内核（合并/选区/打字/IME/undo）做到 Notion 那个扎实度**——否则是把错配税换成放大了的通用税。

## 3. 方案空间（五案矩阵）

| 方案 | 一句话 | 三笔成本¹ | 迁移 | 量级 | 判定 |
|---|---|---|---|---|---|
| **A1 编辑器级**：li 升为一等交互块，磁盘不动 | 把 #421 式逐点下沉一次性系统化，「块」的语义指针从 ul 换成 li | **全躲** | **零** | 4-6 人週 | **推荐主路** |
| A2 磁盘级：每行独立单项 ul 落盘 | canonical 从一张 ul 改为相邻单项 ul 序列 | 全付 | 两难² | 3-5 人週+拍板链 | 不建议 |
| C 弃语义列表：自定义 div 行 | 彻底 Notion 化 | 全付且 md 岛化 | 全量不可逆 | 8-12+ 人週 | **排除**³ |
| D IO 边界拆合：load 炸行、save 合并 | 内存 per-row、磁盘 canonical（= A2-in-memory，不是 A1 彻底版） | 磁盘侧躲两笔 | 零 | 5-8 人週 | 仅作 A1 失败的止损备胎⁴ |
| **E 现状制度化**：行级契约成文 + 完备性门 | 「交互必须下沉到行」从口口相传变有牙制度 | 全不碰 | 无 | **1-2 人週** | **无悔投入，先做** |

¹ 三笔成本 = 成本单算过的：ol 编号连续性（全仓零 counter-reset/start 接管机制）、嵌套撞 Schema §1.3「层级只用 DOM 嵌套」拍板（Colin 2026-07-24）、md 往返塌缩（外部工具统一 marker 后 N 行静默合一，正面冲突「本地文件随便什么工具打开」承诺）。
² A2 迁移两难：打开即重写存量文档 = 违反保真红线 + git diff 爆炸；不迁移 = 两种 canonical 永久并存。没有干净的第三条路，本身即否决级证据。
³ C 的真实代价在账外：div 行的文件离了烘焙 CSS 就是无列表语义的裸段落，读屏器/爬虫/Agent 全部失明——恰好是 Notion 导出 HTML 那个被我们当反面教材的形态。且 Schema 1 块表直接挡死（bareDivNotBlock，`schema-validate.js:145-148`），要做等于开 Schema 2 的列表模型，不是在 Schema 1 上动刀。
⁴ D 击穿本编辑器「DOM 即模型」地基（undo 快照/判脏/自动保存/分页/PDF 全押在活 DOM≈磁盘字节上），且运行时要用 CSS counter 补编号视觉，违背「显示=按 .html 原生渲染」冻结（schema-1-draft-v0.md §0）。往返幂等是生命线（md-adapter 往返漂移史是前车之鉴）。

**A1 的三个关键设计约束**（调研中确认的）：
- **保住单 ce 宿主**：per-li contenteditable 会让「列表内跨行原生编辑」的免费红利消失、跨块 IME 欠账扩大到所有列表。A1 = 只换「块」的语义指针（blockOf 认 li），不动 ce 挂载。
- **行级 shim 层是最大折扣项**：rowOf/paraOf/isRowAnchor 和全套行级交互已存在，A1 不是从零做行级，是把 shim 换成正统身份、把 84 处特判砍掉约一半。
- **回归半径全仓最大**：blockedit.js 6100 行里「块=顶层直接子」的隐含假设散布各处，200+ e2e 大量断言顶层块数。需隔离 worktree 打磨完整体才合 main（Wendi「半成品不进 main」原则），可借 details 门控先例做灰度。

## 4. 要重开的拍板

**A1（编辑器级）需要重开的只有一条**：7-23 brainstorm 对「方案 A=li 升块=动脊椎」的否决。当时的否决理由（块身份不变式/topBlocks/合并/序列化全重写）在今天已部分贬值——行级交互层已全部建成，脊椎手术的病人比当时健康得多。连带微调：⌘A/Esc 三档是否收敛回 Notion 两档、手柄菜单「两入口两作用域」是否合一。

**A2（磁盘级）需要重开一串**（按代价从高到低）：① Schema §1.3「层级只用 DOM 嵌套」铁律（范式级、刚拍两周、牵 AI guide 四份拷贝）；② md 往返承诺（塌缩单向且无提示，需 Wendi 明确接受）；③ 方案 B 存储前提（即成本单待拍题本身）；④ 「ol start 不重算」取舍（要新建全列重编引擎）；⑤ 列表 Tab=嵌套 两次拍板；⑥ ⌘A/Esc 三档。另必须一并拍 Q4（只 todo vs 三种列表一视同仁——成本单建议：要拆就全量，别只拆 todo）。

**澄清（两方向都不用碰的）**：Schema I2 与 validateList 对「每行一张 ul」零障碍（逐 ul 独立校验、100% 合规）；7-23 否决的是 Notion 式 body 层游离 `<li>`，不是单项 ul 序列。

## 5. 建议

**推荐路径：E → A1，磁盘格式一个字节不动。**

1. **立即做 E**（1-2 人週，无悔）：行单元解析收拢成显式入口 + 写进 `docs/features/todo-list.md` 契约 + 「行为×块型」完备性 e2e 矩阵（每个块级交互对 li 行 fixture 各一条，新交互不进矩阵不许合）。无论最终拍哪个方向，它都是 A1 动工前的回归安全网，且直接消灭 #421 式漏点的复发条件。
2. **排期 A1**（4-6 人週，隔离 worktree）：li 升为一等交互块。这是「每行一块」在 HTML-native 产品里的正确形态——Gutenberg 已用四年替我们验证过这条路。做完后：⌘A/Esc 多档补偿、copy/paste 列表特判、行级 shim 约一半特判可删；「看起来一样的两行，一个是块一个是行」的分裂模型消失。
3. **A2/C 不做**；D 仅当 A1 的操作面改造被实证不可控时再评估。

**给 Wendi 的三个决策问题**：
- **Q1**：接受「每行一块活在编辑体验层，磁盘保持一张语义 ul」吗？用户能感知的行为与 Notion 无差；差异只在文件内容——而我们的文件形态恰恰是产品身份。（推荐：是）
- **Q2**：A1 排不排、什么优先级？它前置于跨块编辑内核加固（bug 归因里那「另一半」），两者可以合并成一个「编辑内核 Notion 化」轨道。
- **Q3**：若你的答案是「磁盘也必须每行独立」（A2），需要你明确接受：md 静默塌缩 + 重开 §1.3 + 存量文档迁移两难。调研证据不支持这条路，但这是产品身份判断，归你拍。

（本文覆盖 2026-08-06 成本单的 U4 待拍题：成本单的「选项 3=维持方案 B」对应本文 E，「选项 2=全量拆」对应 A2；本文新增的 A1 是当时没充分展开的第三条路——成本单否决的「动脊椎」在行级交互层建成后已显著降价。）

---

## 附录：证据索引

- Notion API block reference：developers.notion.com/reference/block（无列表容器、行块独立 UUID、编号不存储）
- Notion 工程博客：notion.com/blog/data-model-behind-notion（content 指针物化树、缩进=结构操作）
- Notion 官方 HTML 导出实测：GitHub kpatel427/YouTubeTutorials Conda-commands.html（5 连续编号项=5 个独立 `<ol start=N>`）
- Gutenberg：issue #6394（迁移动机）、PR #42711（落地）、trunk list-item/block.json（parent 锁 core/list）、fixture core__list__ul.serialized.html（磁盘 ul 完整）、#39799/#44822/#39519/#61457（迁移坑）
- ProseMirror autoJoin 讨论：discuss.prosemirror.net/t/automatic-joining-of-lists-blockquotes-and-similar/480
- Lexical mergeLists/updateChildrenListItemValue：facebook/lexical packages/lexical-list/src/formatList.ts
- BlockSuite 导出合并状态机：toeverything/blocksuite packages/affine/blocks/list/src/adapters/markdown.ts
- Anytype 无容器块模型：anyproto/anytype-heart models.proto + core/converter/md/md.go
- 本仓代码锚点：`src/editor/blockedit.js`（classify:60 / blockOf:957 / enterEdit:1302 / coalesceLists:2039 / Enter 原生分裂:4109 / 84 处列表特判）、`src/lib/schema-validate.js`（TOP_BLOCKS:20 / validateList:72 / bareDivNotBlock:145）、`src/main/md-adapter.js`（REPRESENTABLE:174）
- bug 账本归因明细：本文 §2.4；原始 17 单元逐条归因存于调研工作流记录（session d180f6ea，run wf_009d42e6-c6d）
