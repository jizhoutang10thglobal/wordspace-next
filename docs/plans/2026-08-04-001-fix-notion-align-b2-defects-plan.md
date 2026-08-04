# 修复 Notion 粒度对拍第二批的明确缺陷（表格 / 图片 / callout）

- **状态**：draft（待 doc-review）
- **锚点**：`origin/main` @ `523759b`；工作分支 `feat/notion-align-b2`（worktree `wordspace-next-align2`）
- **来源**：对拍报告 artifact `ef0a387e-096f-4863-8464-8edd1d25f3a9`（42 条事实双侧真机实测）
- **证据**：`scratchpad/diff/{table,image,callout}.json`（逐条读数）、`scratchpad/b2shots/`、`scratchpad/notionshots/`
- **Colin 授权**（2026-08-04）：修 7 条明确缺陷，**先做安全区**

---

## 一、范围裁决：为什么这轮只做 4 条 + 2 份 spec

对拍出 7 条明确缺陷。逐条把「修改点落在哪一行」对着 `origin/feat/ux-granularity`
（并行 session 的长期分支）的 diff hunk 核过之后，排序被改写了：

| 缺陷 | 级别 | 修改点（main 行号） | 落在他们的 hunk 里？ | 本轮 |
|---|---|---|---|---|
| T12 ⌘A 第 2 档残留原生蓝底 | P3 | 2141-2150 | 否（夹在 2077-2083 与 2282-2304 之间） | **做** |
| T6 菜单开着时目标行/列无标记 | P2 | 1769-1806 | 否（夹在 1756-1765 与 1808-1816 之间） | **做** |
| C13 空 callout 被斜杠项整框替换 | P3 | 1867-1881 | 否（夹在 1828-1834 与 2017-2023 之间） | **做** |
| I8 多张顶层图片 inline 并排 | P2 | 363（BASELINE_CSS） | 否（他们的 349-354 在其上方） | **做** |
| I10 拖放图片无落点线（spec 漂移） | P3 | 3324 | **是**（3323-3329） | 只回写 spec |
| C8 多段 callout 首行退格死胡同 | P2 | 2747 | **是**（2727-2750，整段重写） | **押后** |
| I4 图片手柄 scope 错位 | **P1** | 2979-2980 | **是** | **押后** |

**押后的三条不是不修，是不该由我在这条分支上并行修。** 理由是硬证据不是保守：
`feat/ux-granularity` 的 merge-base 正是 `9095a4a`（今天合的 #380），它的 `blockedit.js` 基线与
`origin/main` **逐字节相同**——所以那不是「他们没见过这些代码」，而是**同一批函数两个人各改一版**。
其中 `openBlockMenu(el)` 的**签名已被他们改成 `openBlockMenu(el, row)`**。

**C8 尤其要交给他们**：他们在 2734 新加了 `if (!isLeafTextBlock(cur)) return;`（注释写「cur 是容器块
(callout/quote) 时不能把块级 <p> 塞进 <li>」）——这与 C8 是**同一类容器块拦截**，很可能在他们分支上
已经改变了 C8 的行为，甚至在相邻路径引入同类死胡同。我在旧基线上修 C8 = 保证语义冲突。
**建议把 C8 作为一条 finding 转给他们那条分支**（见 §六）。

**I10 本轮只回写 spec**：`docs/features/doc-images.md:18` 写「落点 = 块间插入线（复用内部块拖拽的
插入线视觉）」，代码 3324 对 Files 只设 `dropEffect='copy'` 就 return、从不设 `data-ws2-drop`，实测零反馈。
spec 描述了一个不存在的行为 = 仓库铁律层面的账错了。补实现要动 3324（冲突区），**所以本轮把 spec
改成描述现状 + 明确记欠账**，不替产品决定「永远不做插入线」。

---

## 二、共同纪律（每个单元都要过，少一条不算完成）

来自 `/align-notion` 阶段三 + 仓库铁律：

1. **一个单元一个 commit**，diff 小到可审。
2. **针对性 e2e 强断言**——判定标准：能想出一种「实现全废但断言还过」的情形，它就还是弱的。
   不许用「查 class 存在」当门（S4 教训），要读 computed style / 几何 / 结构真值。
3. **先 commit 再变异自检**（血教训，已实踩两次：变异后 `git checkout --` 会把未提交的修复一起冲掉）。
   变异后要看**失败画像**：只有相关用例翻红才算门有牙，全红或全绿都可疑。
4. **spec 同步**（谁改交互谁在同一 commit 更新 `docs/features/<slug>.md`）。
5. **实机截图**，且**必须自己 Read 过**再放进报告（e2e 全绿 ≠ 视觉正确）。
6. **只跑受影响的 spec**，不在本地跑全量（team-memory 2026-08-03 新规：全量只在发版前跑）。

---

## 三、单元

### U1 · T12：⌘A 第 2 档残留格内原生蓝底（P3）

**现状（实测）**：格内连按 ⌘A，第 2 档内部状态已声明格级选中退出
（`cellsInEdit=0`、`selectedEl` 上卷到 TABLE），但 `sel.toString()` 仍是 `'十二'`，
屏幕上那格文字的原生蓝底还在 —— 画的和做的不是同一个对象。

**目标**：第 2 档落定后，屏幕上不再有格内文字选中残留；第 1 档与第 3 档行为一字不变。

**改动点**：`src/editor/blockedit.js:2148` 附近（cell 态 ⌘A 的第二档分支，
`exitCell(); selectBlock(cTbl); positionGrip(cTbl);` 之前或之后）清掉文档选区。

**必须验证的连带影响**：第 3 档（全篇）走的是非编辑态 generic ⌘A 路径。清空 selection 后
第 3 档**是否还能正常触发**是这条改动最大的风险 —— 门里必须连着测三档，不能只测第 2 档。

**验收门**（新增到 `e2e/table.spec.js` 或独立 spec）：
- 第 1 档：`sel.toString() === '十二'`、`cellsInEdit === 1`、`selectedEl` 为 null
- 第 2 档：`sel.toString() === ''`（**这是新断言**）、`selectedTag === 'TABLE'`、`cellsInEdit === 0`
- 第 3 档：`rangeSelMarked` 含全部顶层块（证明清 selection 没有打断分档链）

**变异自检**：把清 selection 那句删掉 → 第 2 档断言必翻红，第 1/3 档保持绿（画像精准）。

**spec 同步**：`docs/features/table.md` 的 ⌘A 分档段补「第 2 档不留格内文字选中」。

---

### U2 · T6：菜单开着时不标作用对象（P2）

**现状（实测，逐格 computed backgroundColor 读出来的、不是看图）**：
菜单里「删除本行/删除本列」实际作用于 `menuCell` 所在的行/列（T8 已证实参照单元 = 当前编辑格），
而界面此刻唯一标出来的是**整张表**灰选；目标行逐格 `backgroundColor` 全为 `rgba(0,0,0,0)`、
与非目标行完全相同，`outline` 三行皆 `none`。叠加菜单遮掉表格 **48.7%** 面积 → 误删风险实打实。
Notion 对照：行菜单开着时目标行有横跨整行的蓝框、列菜单开着时目标列有贯穿到末行的蓝框。

**目标**：菜单开着的那一刻，`menuCell` 所在的行与列在视觉上可辨；菜单关闭后标记清除；
**标记绝不入盘**。

**改动点**：
1. `blockedit.js:1769-1806` 的 `classify(el)==='table' && menuCell` 分支：开菜单时给
   `menuCell` 所在 `<tr>` 打 `data-ws2-menurow`、给同列各格打 `data-ws2-menucol`。
2. `closeBlockMenu()`：清除这两个标记（**必须在所有关闭路径上**——Esc / 点别处 / 执行菜单项后）。
3. `EDITOR_CSS`：给这两个属性画描边（编辑器运行时 CSS，不入盘）。
4. **⚠ `src/editor/serialize.js` 的剥除白名单必须加这两个属性名。**
   serialize 是**白名单剥除、不是 `data-ws2` 前缀剥除**（故意如此，为保住用户文件自带的
   `data-ws2-*`，见该文件 13-15 行注释）。不加白名单 = 自动保存会把交互标记写进用户文件。

**验收门**：
- 菜单开着：目标行各格与非目标行各格的 computed 视觉值**不同**（读 outline/背景真值，不查 class）
- 菜单关闭后：文档内 `[data-ws2-menurow]`、`[data-ws2-menucol]` 计数为 0
- **入盘门**：开着菜单时 `serializeDocument()`，产物字符串里**不含** `data-ws2-menurow/menucol`，
  且 reparse 走 `WS2SchemaRegistry.classify` 仍判合规
- 目标行/列必须与 `menuCell` 对齐（换一个格开菜单，标记跟着换）

**变异自检**：① 去掉 serialize 白名单条目 → 入盘门必翻红；② 去掉 closeBlockMenu 的清除 →
关闭后计数门必翻红；③ 去掉打标记 → 视觉差异门必翻红。三个探针各自只打红对应那道。

**spec 同步**：`docs/features/table.md` 行为契约补「菜单开启时目标行/列可辨 + 标记不入盘」。

---

### U3 · I8：多张顶层图片 inline 并排（P2）

**现状（实测）**：3 个各自独立的顶层 `<img>`（`parentElement` 都是 BODY）在视觉上并排挤成一行，
因为 `img` 默认 inline。直接后果（I7 实测）：**第二张图的 ⋮⋮ 手柄被画在第一张图的图面上**，
用户无法凭视觉分清手柄属于哪块。编辑器模型里图片是顶层块（选中/拖拽/方向键都按 1 个块处理），
渲染成 inline 与这个模型自相矛盾。

**目标**：顶层图片各占一行；**行内图片（`<p>文字 <img> 文字</p>`）保持 inline 不受影响**。

**⚠ 关键约束（已核实，别按直觉写）**：`IMG` 在 `schema-model.js:11` 的 `PHRASING_TAGS` 里 ——
**图片既是合法顶层块、也是合法行内内容**。所以 `:where(img){display:block}` 一刀切会破坏行内图片。

**改动点**：`blockedit.js:363` 的 BASELINE_CSS，改成一对规则：
```
':where(img){display:block}' +
':where(:is(p,h1,h2,h3,h4,li,td,th,blockquote,figcaption,summary,.ws-callout) img){display:inline}'
```
（`:where(figure>img){display:block}` 已存在于 365，保持不动；`:is()` 里覆盖全部允许 phrasing 的
文字容器，用后代组合子以覆盖 `<p><a><img></a></p>` 这类包一层的情况。）

**⚠ 这是入盘 CSS**：BASELINE_CSS 随文件落盘，旧文件在 attach 时静默升级（既有机制）。
影响面是全语料，**必须跑 `e2e/images.spec.js` 全套**，且要验行内图片没被打成块。

**验收门**：
- 3 个顶层裸 `<img>` 的 boundingBox **y 互不相同**（堆叠），不是同一行
- 第二张图 hover 时 `.ws-grip` 的 y 落在第二张图的纵向范围内（这是 I7 那个连带问题的真门）
- **反向门**：`<p>前 <img> 后</p>` 里的 img，computed `display === 'inline'`，且该段落仍是单行
  （行内图片不被打成块——这道门比正向门更重要，正向门坏了看得见，反向门坏了是静默的保真损伤）
- 入盘：serialize 后 reparse 仍合规

**变异自检**：把 `display:block` 那句删掉 → 堆叠门与手柄门翻红；把豁免规则删掉 → 反向门翻红。

**spec 同步**：`docs/features/doc-images.md` 补「顶层图片各占一行、行内图片保持 inline」的契约。

---

### U4 · C13：空 callout 被斜杠项整框替换（P3）

**现状（实测）**：空 callout 里输入 `/` 选「无序列表」→ `calloutCount 1→0`，
`[p, div#co.ws-callout, p]` 变成 `[p, ul#co, p]`，callout 被整框替换掉，原 id 一并搬到 ul 上。
用户在框内做的是「插入」动作，产物却是**承载它的容器被换掉** = 作用对象错位。
且 C3 已证实没有任何反向入口能把 ul 变回 callout，只能靠 undo。

**根因（已核实）**：`applySlash` 的空块分支判据是 `empty && isEditableEl(el)` → `turnInto`。
而 `isLeafTextBlock` 对空 callout 判 **true**（`schema-model.js:31` 的 `LEAF_TEXT_TAGS` 含 `DIV`，
空 callout 无块级后代）——**所以不能用 `isLeafTextBlock` 当守卫，它拦不住**。

**目标**：斜杠插入不再吞掉 callout 容器；callout 保留，新块落在它**之后**。

**改动点**：`blockedit.js:1867-1881`，把「空块 → turnInto」的判据加一条容器排除：
callout（`el.classList.contains('ws-callout')`）即使为空也走 `insertAfter` 而不是 `turnInto`。

**⚠ 两条边界（写进代码注释，别写成错结论）**：
1. **终态不要照抄 Notion**。Notion 是把列表放进框内当子块，我们 Schema **明令禁止**——
   `schema-validate.js` 的 `childrenAreMultiPara` 只允许 phrasing 或 `<p>`，列表/别的块一律非法。
   所以「插到框后」是 Schema 约束下的合理解，不是「我们不支持嵌套」。
2. **id 不是独立 bug**。`turnInto` 保留 id 是有意设计（块换类型时保住指向它的文档内链）。
   id 看起来搬错了，是因为这次 turnInto 本身不该发生 —— 修掉容器替换，id 问题一并消失。

**范围诚实交代**：对拍只实测了「无序列表」一项，斜杠菜单其他项同走该分支但未实测。
门要覆盖**至少三类产物**（列表 / 表格 / 分隔线）才算真锁住。

**验收门**：
- 空 callout 里 `/` 选无序列表 → callout 仍在（`calloutCount === 1`）、ul 是它的**下一个兄弟**、
  ul 的 `parentElement` 不是 callout、callout 的 id 未被搬走
- 同样断言覆盖表格与分隔线两项
- 非空 callout 与普通空段落的既有行为**一字不变**（回归门）
- serialize 后 reparse 合规

**变异自检**：去掉容器排除 → 三条产物门全红、既有行为门保持绿。

**spec 同步**：`docs/features/callout.md` —— **本仓 `docs/features/` 23 份 spec 里没有 callout.md，
这是既有欠账**。本单元顺带建立（记录现状契约 + 把对拍出的 12 条粒度差异与押后的 C8 列为欠账）。
不是顺手重构，是仓库铁律要求：改 callout 交互就必须有对应 spec。

---

### U5 · I10 + spec 漂移三条（docs only，零代码）

`docs/features/doc-images.md` 三处与代码对不上（对拍实测）：
1. `:18` 写「拖放图片落点 = 块间插入线（复用内部块拖拽的插入线视觉）」→ **代码没有插入线**
   （3324 对 Files 只设 `dropEffect` 就 return）。改成描述现状 + 记欠账「拖放落点无视觉预告，
   补实现要动 onDragOver，与 `feat/ux-granularity` 冲突，待其落地后处理」。
   顺带更正 recon 的一个错猜：落点翻转不在「块上缘 ±5px」，实测在**块的垂直中线**。
2. `:22` 写「点击图片 = 整块选中（对齐现有块选中态样式）」→ 实际是 accent 蓝环专用规则
   （因为暗色文档的双反色滤镜会把通用黑环翻回黑、在暗底隐身；`e2e/images.spec.js:192-206` 守着）。
   spec 那句是被后来的修复推翻却没回写。
3. 未记「图片已有说明后，块菜单里的『加说明』会消失」（`blockedit.js:1808` 的
   `&& !el.querySelector('figcaption')` 条件）。补上这条契约。

**验收**：docs only，无门。但**不许顺手改代码去迎合 spec**——那会把 P3 的账变成冲突区的改动。

---

## 四、单元顺序与理由

`U1（最小、验证分档链不断） → U3（CSS，影响面大但改动最小、先暴露全语料风险）→
U2（新增交互标记 + 入盘白名单，最容易出静默错）→ U4（结构行为 + 新建 spec）→ U5（docs）`

U1 先做是因为它同时充当「本分支 e2e 基建是否跑得通」的探路；U3 排第二是因为它一旦引起
既有 e2e 大面积翻红，越早知道越好。

---

## 五、全局风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| U2 标记漏进用户文件 | serialize 是白名单剥除，忘了加白名单就静默写盘 | 专门一道入盘门 + 变异探针①；这是本 plan 最该被 review 挑的地方 |
| U3 影响全语料 | BASELINE_CSS 入盘、旧文件 attach 静默升级 | 反向门（行内图片保持 inline）+ 跑全套 `images.spec.js` |
| U1 打断 ⌘A 分档链 | 清 selection 可能让第 3 档失效 | 门里连测三档 |
| 与 `feat/ux-granularity` 后续合并 | 四个单元都在 blockedit.js | 全部避开他们的 hunk（已逐行核过）；合并时仍需人工确认 |
| 深色宿主上 3 条既有红 | `align.spec` T1/T2、`nonconform-basic-edit` T5，与本 plan 无关 | 遇到先在基线 commit 上复现确认，别误判成自己弄坏的 |

## 六、不做什么（明确边界）

- **不修 I4 / C8 / I10 的代码**——修改点在 `feat/ux-granularity` 的改动区内（§一）。
  建议把这三条（尤其 C8，含「他们 2734 新加的守卫可能引入同类死胡同」这条观察）转给那条分支。
- **不做 21 条「粒度差异待拍板」**——那些两边都自洽，是产品取舍，等 Colin/Wendi 拍。
- **不动 callout 的容器架构**（12 条差异的总根因）——那是架构级选择，不是缺陷修复。
- **不顺手重构**「callout 判据散在三处」这个已知债——本轮沿用既有 `classList.contains('ws-callout')`
  写法并把债记进 spec，不在缺陷修复里夹带重构。
- **不清理那 746 行死代码 + 37 条假信心单测**——独立议题，单独开。
