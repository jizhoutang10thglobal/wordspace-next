# 块编辑器 · 待办列表（todo list）—— 对齐 spec

> 建档 2026-07-23（随 todo-list UX sweep 修复 PR-A）。此前 `docs/features/` 无任何 spec 拥有 todo 行为——仓库铁律要求改 todo 交互的 PR 同 PR 更新本 spec。本份覆盖 `<ul class="ws-todo">` 待办列表的创建、勾选、键盘流、剪贴板、转换、视觉。行为契约以 todo-list 修复计划各单元的「期望行为」为准，随 PR-A→E 逐批补全（当前只落地了 PR-A 的三条，其余待各 PR 移入契约）。

## 行为契约

**是什么。** 待办列表 = `<ul class="ws-todo">`，每个 `<li>` 前有一个可点的勾选框；勾选态存在 `<li data-checked="true">`（未勾选**不写** `data-checked`）。勾选框、划线、蓝底✓的视觉由入盘语义 CSS（`data-ws-schema-css="todo"`）承载，随文件落盘，浏览器直开即真 checklist。

**创建。** 两条路：① 空正文块打 markdown 快捷 `[] `（或 `[ ] `）+ 空格 → 转成待办；② 斜杠菜单选「待办」。两条路产出的空项都必须**可继续打字**——空 `<li>` 必带占位内容（`<br>`），否则 `list-style:none` 让空 li 高度为 0、光标落不进、输入被吞（create-1，PR-A 已修）。行中间打 `[] ` 不转换（负例，保持）。

**勾选。** 点勾选框（gutter，条目内容左缘左侧）只切 `data-checked`、不进编辑态、不放光标、后续按键不改条目文字（check-1，PR-B 已修）。在编辑该项文字时点勾选框：勾选翻转、光标留原位、继续打字落原处。勾选视觉：文字变灰 + 划线、框变蓝底白✓；取消勾选完全还原。勾选态落盘、关开重开保留、不触发降级。

**键盘流。** 项内 Enter 分裂产出的新项永远未勾选、不复制源项 id（doc-linking 锚点不重复）——属性跟内容走（劈半时后段剥、行首回车时上方空项剥）（keys-2，PR-B 已修）。块末 Delete 与 Backspace 对称：末项尾 Delete 并入下一叶子块、段末 Delete 吞列表首项、空项 Delete 并入下一项，光标均落接合点；不可并块（图片等）安全无反应（select-3，PR-B 已修）。

**undo/redo 后可继续打字。** 撤销/重做后立刻打字必须落进文档（不被吞）——重写编辑区后按结构路径重进编辑，路径失效则落首个可编辑块；光标精确位置不还原（v1 取舍）（clip-3，不限 todo，PR-B 已修）。

**编辑流不得损坏文档。** 列表内选删后打字，绝不把空 `style=""` 残留写进磁盘——否则整篇判非合规、重开永久降级基础编辑（select-1，PR-A 已修，兜底在 `serialize.js` cleanRoot 通用剥空 style）。

**剪贴板。** 复制/剪切**部分**待办项（跨 li 但非整列表）→ 剪贴板打包成**块级 `ws-todo` 列表片段**（保留待办类型 + `data-checked`），绝不携带裸 `<li>`；粘进段落成合规待办块、绝不产生 `<p>…<li>` 非法嵌套（clip-1，PR-A 已修）。同一 `<li>` 内选一段字复制 → 仍走行内、并入目标段落纯文本。部分待办项粘进另一个同类列表 → 逐项并入当前项之后、保留勾选、**仍是单个 `<ul>`**（绝不劈成多个相邻 ul，对齐 bug2 纪律）。

**创建（斜杠/转换）产物不留占位。** 斜杠菜单在非空块插块产出**空产物**（补 `<br>` 保 caret），不种「列表项/引用内容/新标题/提示内容」等占位文本（否则前插入盘，create-2，PR-C 已修）。

**转换往返不塌缩。** 多项 todo「转为」文本再转回：按 `<br>` 拆行还原多项、不塌成单项（create-3，PR-C 已修）；勾选态经文本往返不保留（见有意分歧）。

**嵌套渲染两侧一致。** 裸嵌套非 todo 子列表（转换路径产物）编辑器内与浏览器直开都显圆点/编号、不可勾；Tab 缩进产生的 `ws-todo` 子列表保持无圆点 + 可勾（D3）（create-4，PR-C 已修，CSS class-scoped）。

**嵌套键盘。** 嵌套空项 Enter → outdent 成宿主下一兄弟（后继兄弟留在宿主嵌套里——空项当子列表父项时 Chromium 无法在块级 ul 前打字，故 Enter 空项不收编）、Backspace → 光标落宿主末尾，均不留幽灵空 ul（keys-3，PR-C 已修）；Shift-Tab 反缩进**非空**中间子项时收编后继兄弟为其子项、顺序不乱（keys-5，PR-C 已修）。

**勾选视觉不污染子项。** 勾选父项不划穿/不变灰未勾的嵌套子项——含子列表的勾选项只变灰不划线（避免 CSS 装饰传播），叶子勾选项照常灰+划线（check-2，PR-C 已修）。

**markdown 快捷覆盖扩展。** 空正文块（或块首前缀）打 marker+空格转换，覆盖：`[x] `/`[X] ` → 首项已勾待办；块首 marker+空格 + 后面已有文字 → 转换且保留后缀文字（前缀触发）；非 1 起始序号 `3. ` → `ol[start=3]`。转换**只在敲下补全 marker 的那个空格、且该空格紧邻块首文本节点里的 marker 末**这一击发生（绑 `insertText`+space + caret 恰停 `marker` 末的守卫）——① 删字到 caret 停 marker 末（如「- x」删 x 剩「- 」）走 `deleteContentBackward`，不误转；② 既有段落（磁盘/粘贴的「- 文本」）在任意位置敲空格，caret 不紧邻 marker，不误转、不吞 marker；③ 内容裹在行内元素里（`<b>…</b>`）时 marker 被打进行内元素、块首非文本节点，直接不转换（绝不清空整块丢内容）（create-7，PR-D 已修；②③ 由对抗审查补漏）。

**空项 Enter 脱离列表。** 顶层空项（不止末项，中间/首位同样）Enter → 脱离列表：删空项、按位置劈 `ul`（首位段落插列表前 / 中间后继项移到新同类列表、段落夹中间），光标落空段落。源空项的 `id`/`data-checked` 不迁移到脱列段落（段落带 `data-checked` 即非合规）（keys-7，PR-D 已修）。

**Tab 缩进保光标。** Tab 缩进列表项后光标保留在项内原位、不甩到项末（缩进重挂 DOM 后按记录的 anchorNode/offset 还原，失效才回退项末）（keys-8，PR-D 已修）。

**勾选与打字各自成步。** 打字后立刻点勾选框：`data-checked` 翻转前先 `checkpoint` 把 pending 打字冲成独立快照，一次 undo 只回退勾选、打字仍在（check-3，PR-D 已修）。

**转换保锚点 / 不塌缩。** todo「转为」文本：产物剥掉遗留的 `ws-todo`/`ws-callout` 语义 class，用户自定义 class 保留（create-5，PR-D 已修）；todo「转为」toggle：保留源块 `id`（doc-linking 锚点不断）、首项行内进 `<summary>`、其余项各成一个正文 `<p>`（create-6，PR-D 已修）；首项行内为空（仅嵌套子列表 / 空 li）时 `<summary>` 补 `<br>`、不留不可见空标题（对抗审查补漏）。

**「转为」只作用于选中的行（方案 B 第 2 步，Colin 2026-07-23）。** 选中**单个/部分** `<li>`（格式条「转为」）→ 只把那几行从列表**抽出去**转成目标块，前后剩余项仍是原列表；选中**整列表**（⌘A 两次）→ 维持整块转换（既有）。实现:把 `<ul>/<ol>` 在选中 li 跨度处劈成 `[前列表][选中行]([后列表])`、让选中 li 独占原 ul，再复用整块 `turnInto`（产物 / class 迁移 / `data-checked` 清理 / conform 全走既有逻辑）。⋮⋮ 块菜单的「转为」仍整块（作用于选中的整块）。与 ⌘A 分级（`editor-select-all.md`）配套:⌘A 一次选当前行 → 「转为」抽这一行。

**剪贴板 id 去重。** 块级复制粘贴到**同文档**：粘贴份剥掉与文档已存在块重复的 `id`（含后代、同批次内也去重），锚点/互链不被重复 id 破坏；跨文档粘贴不撞 id 则保留 id（护住互链锚点价值）（clip-4，PR-E 已修）。

**外部「- [ ] 」纯文本转 todo。** 外部纯文本多行粘贴，**全部非空行**都匹配 `- [ ] ` / `- [x] ` → 识别成待办：目标非列表则构造 `ul.ws-todo` 插块，目标是 todo 列表则逐行追加 li（仍单个 ul）；`[x]`/`[X]` 置勾选，marker 剥除。任一行不匹配 → 整段回落既有纯文本粘贴（不做混合解析）；目标是普通 bullet/numbered 列表维持字面（不扩）。只认纯文本模式、不引入外部富 HTML（不违反 ED-A4）（clip-5，PR-E 已修）。

**勾选热区几何。** X 命中带贴合勾选框体 ±4px 缓冲（右缘距文字左缘留 ≥4px 非勾选区，消「文字左缘零缓冲误触」）；Y 吸附最近直接子 li（±6px 容差，消项间 margin 死区、缝隙等距吸附上方项）；勾选框 `cursor:pointer`（check-4，PR-E 已修）。

**取消勾选删属性。** 取消勾选 `removeAttribute('data-checked')`、不写 `data-checked="false"` 脏字节；CSS/判定只认 `"true"`、`"false"` 与无属性等价，存量老文档下次翻转自然清洗（visual-5，PR-E 已修）。

**勾选框对比度（浅色）。** 未勾选边框对纸底 ≥ WCAG 3:1（`#cfccc6` 1.60:1 → `#8a857c` ~3.66:1）；已勾蓝底/✓ 字形本已 ≥3:1（visual-3，PR-E 浅色已修；深色见欠账）。

**跨 toggle 边界删除**见 `editor-cross-block-selection.md`（U23/select-4：部分跨界一致化为空操作 + 反馈动画）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 编辑器架构 | `ui-demo/src/components/Canvas.tsx` + `canvas/`（受控 React 块模型） | `src/editor/blockedit.js`（每个块独立 contenteditable，改真实 DOM） |
| 创建（markdown/斜杠）| —（架构不同，见有意分歧） | `src/editor/blockedit.js`（`tryMarkdown` / `turnInto` / `newBlock` / `applySlash`） |
| 勾选交互 | — | `src/editor/blockedit.js`（`onMouseDown`/`onClick` gutter 分支、`TODO_CSS`/`EDITOR_CSS`） |
| 入盘语义 CSS | — | `src/editor/blockedit.js`（`TODO_CSS`、`ensureTodoStyle`/`refreshSemanticStyles`） |
| 剪贴板 | — | `src/editor/blockedit.js`（`onCopy`/`onPaste`/`insertInlineAtCaret`/`insertBlocksAtCaret`，哨兵 `data-ws2-clip`） |
| 交互态标记 / 空 style 剥除 | — | `src/editor/serialize.js`（`cleanRoot`：空 style 通用剥除、WS2_MARKERS） |
| 门 | — | `e2e/todo-markdown-shortcut.spec.js`、`e2e/todo-select-clean.spec.js`、`e2e/todo-clipboard.spec.js`、`test/serialize.test.js`（U2 空 style 单测） |

## 有意分歧

- **编辑器架构本质不同**（历史形成，两侧独立演进）：ui-demo 是受控 React 块模型，真 app 是每个块独立 contenteditable、直接改真实 DOM。**本 spec 的行为契约主要约束真 app 侧**；ui-demo 侧 todo 行为**尚未审计**（见欠账）。谁拍板/日期：架构分歧属既有事实，本 spec 首次记录在案（2026-07-23）。
- **⌘A 分级选中的粒度是整个 `<ul>`（不是单个待办项）**——有意设计，见 `docs/features/editor-select-all.md`，与 Notion 的 item 粒度是拍过板的分歧。
- **嵌套子项保持圆点子列表、不可勾选**（Colin 2026-07-22 拍板，PR-C U11 已落地）：`bullet「转为」todo` 只作用于顶层列表，裸嵌套子列表保持自身类型显圆点、不可勾；**Tab 缩进产生的 `ws-todo` 子列表保持 todo 行为**（D3 既有设计，子项有勾选框、可勾选）。
- **多项列表↔文本转换往返不保留勾选态**（Colin 2026-07-22 拍板，PR-C U10 已落地）：todo→文本→todo 回程只恢复列表结构，勾选态丢失。
- **含子列表的勾选项不划线、只变灰**（PR-C U14）：CSS 装饰传播规则下 line-through 无法从后代取消，为不划穿未勾子项，含子列表的勾选父项退而只变灰（叶子勾选项照常灰+划线）。

## 对齐锚点

- ui-demo 侧：commit `5970bf5`（2026-07-22，最近 ui-demo 改动；todo 行为**从未与真 app 做过一次对齐**，本锚点仅为记录当前状态）
- app 侧：todo-list UX sweep 修复计划 PR-A~E 全量（2026-07-23）。本 PR = **PR-E**（剪贴板与视觉 P3：U21 块粘贴 id 去重 / U22 外部 todo 文本转换 / U23 跨 toggle 删除一致化 / U24 热区几何 / U25 勾选框对比度 / U26 removeAttribute / U27 深色 emoji 记录制）。

## 欠账

- **ui-demo 侧 todo 行为未审计**——本 spec 行为契约先按真 app 定稿，ui-demo 是否一致待专门对齐（记账不阻塞）。
- **行为契约已落地 PR-A~E 全量**（数据安全 / 高频交互 / 转换与嵌套 / 键盘与转换 P3 / 剪贴板与视觉 P3）。sweep 26 条 confirmed 全部修完；余下为下列 by-design / 记录制的固有局限。
- **undo 后光标落点 v1 局限**：撤销/重做后按 id（锚点块）或结构路径重进编辑。**无 id 的块**在「编辑块上方发生结构增删 + 未产 checkpoint 就导航到下方块 + 撤销」这一特定序列下，光标可能落到相邻块（下标语义随 body 重写变化）。**永不吞字**（总有编辑宿主），且可再撤销恢复——精确落点的完整修复需 undo 追踪变更点，属独立设计改动，留作后续。
- **多级裸嵌套 marker 层级不区分**（PR-C U11，P3 纯视觉）：todo 里的裸嵌套非 todo 列表统一 disc/decimal，不逐级切换 UA 的 disc→circle→square。非回归（改前完全无 marker），深层裸嵌套罕见。
- **整表上色的 todo 里勾选父项的子列表被重置回正文色**（PR-C U14，P3 纯视觉）：给整个 ul.ws-todo 上 ws-color 主题后勾选带子列表的父项，子列表文字被 `color:#37352f` 重置、脱离主题色。非回归（改前继承成灰更糟），CSS 无法既反制灰色下渗又保留任意祖先主题色，属固有局限。
- **`<ol>` 中段空项脱列后，后半段序号从 1 重启、不续接**（PR-D U15，by-design）：`ol[start=5]` 在中间空项 Enter 脱列后，后半 `<ol>` 只带 `class`、不带 `start`，C/D 显示为 1/2 而非 6/7。对齐 Notion/Docs（也重启），conform 不破；`ws-todo` 是 `<ul>` 无编号、不受影响。续接需按拆分位置重算 start（还要扣掉被删空项），复杂度不匹配收益，留作后续。
- **深色模式下勾选框「已勾蓝底」对比压缩**（PR-E U25，记录制 / R8 时间盒）：文档反色配方 `invert(1) hue-rotate(180deg)` 是根滤镜，对饱和蓝的亮度/色相变换非线性，已勾蓝底在深色下对比被压到 ~1.25:1（浅色侧 4.5:1）。**浅色已达标**（本 PR 修）；深色侧无低成本 CSS 解——伪元素勾选框无法像 `img` 那样进反色豁免（豁免按「元素」选择，`::before` 选不中），改配方会动全局深色观感。加深的**未勾灰边框**经反色仍高对比、不受影响。建议：接受现状或排 backlog 专项深色勾选框配方，待 Colin/Wendi 拍板。
- **深色模式下文本 emoji 被反色滤镜扭曲**（PR-E U27，记录制 / R8 时间盒；非 todo 专属，todo 场景最显眼）：根滤镜把 emoji 字形当普通彩色像素处理 → 颜色乱移、亮度不均。**实测**（canvas 复刻 `invert(1) hue-rotate(180deg)` 对字形像素）：🙂 亮度降到 37%、🔥 57%、✅ 71%、🎉 80%，而 📌 反被提亮到 160%——不是均匀压暗、是逐 emoji 色彩畸变，无法用单一参数调平。`img` 有双反豁免、字体 emoji 不在豁免名单，且 **CSS 无法按「字符是 emoji」选中文本节点**（本单元真难点）。唯一有效解是 JS 遍历文本把每个 emoji 裹进双反 span——需跑全文档 + 每次编辑重跑，超低成本预算。建议：接受现状（emoji 仍可辨认）或排 backlog JS-wrap 方案，待 Colin/Wendi 拍板。
