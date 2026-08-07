# 表格块编辑 —— 对齐 spec

> 定稿于 2026-08-03（feat/table-block-editing P1 + feat/table-block-p2）；2026-08-05 行/列手柄批
>（PR-4）；2026-08-06 矩形选区批（PR-5）。plan：docs/plans/2026-08-03-001-feat-table-block-editing-plan.md
> + docs/plans/2026-08-05-001-feat-notion-parity-batch3-plan.md。门：e2e/table.spec.js（33 条）+
> e2e/table-axis-handles.spec.js（12 条）+ e2e/table-rect-selection.spec.js（10 条）+
> test/blockedit-table.test.js（26 条）。

## 行为契约

- **创建**：斜杠菜单「表格」（过滤词 table/biaoge/grid）→ canonical 种子 `<table class="ws-table">` + thead 一行（3×`th[scope=col]`）+ tbody 2×3，空格带 `<br>`。空锚块原地替换（不留空段垃圾）、非空插下方；造出即编辑、光标落首格。
- **磁盘格式**：Schema Table v1 文法——矩形（各行同格数）、禁 `colspan/rowspan`、cell phrasing-only、无 caption/colgroup/tfoot、thead ≤1 行。两种存量形态都可编辑（标签键控不看 class）：AI 生成的 `ws-table`+`ws-al-*` 与 md 转换的无 class+`align` 属性表。边框/内距样式走 baseline 入盘 CSS；对齐走 `<style data-ws-schema-css="align">` 入盘（存量 ws-al 表缺 style 时 attach 补注）。
- **单元格编辑**：点格进入 cell 级 contenteditable（挂 TD/TH、绝不挂 table；`cellEl` 第四状态，generic 块级分支 inert）；悬停 `cursor:text` 提示可编辑；编辑格 inset 蓝环。Esc 上卷灰选整表（永不灰选单格）；点表格边框缝隙/margin = 灰选整表。行内格式（B/I/U/S/链接气泡）在格内可用；「转为」/斜杠/色板在 cell 态禁用。
- **键盘边界**：Enter 跳下一行同列、末行建新行（恒落 tbody 恒产 TD——header-only md 表安全；
  该语义未与 Notion 对拍、保留）；Shift+Enter 软换行 `<br>`；Tab/Shift+Tab 前后移格、
  **末格 Tab 不建行、停留原格**（2026-08-05 改，对拍 T11 Notion 实测；旧「Tab 建行」拍板废除，
  加行走行手柄/「下方插行」）、首格 Shift+Tab 跳出；方向键格内原生、格界跨格、表界跳出（作用域感知，toggle 体内表同样成立）；⌘A 三档（本格→整表灰选→全篇；**第二档落定后不留格内文字选中**——内部已声明格级退出，屏上还标着某格被选中就成了「画的和做的不是同一个对象」；清选区前先把焦点停进 focusCatcher，否则第三档与后续 Backspace 都进不了 keydown）；灰选整表 Enter/↓ 进首格（键盘可达闭环）；空行行首 Backspace 删该行（Tab 误建行的对称逆操作，非空行首 no-op）；全部新分支带 IME 229 guard。
- **选区删除**（2026-08-06 T13/T14 改版，细则见「矩形选区与表界钳制」节）：同表跨格 = 矩形选中态 → Delete 整格清内容不动结构；跨块选区在表界被钳制、表绝不被部分圈选；表格被**完整**罩住（⌘A 全篇/贯穿拖选）仍整块标记整删（ED-A2 语义保留、入口收窄到完整覆盖）；表-only 文档 ⌘A 全篇删 = 整删 + 补空段进编辑。
- **粘贴/复制**：cell 内任何粘贴压单行纯文本（多行 join、内部富 clip 压 textContent、html-only 剪贴板取纯文本兜底）；图片/文件拒收 + cell 锚定墨色小签「单元格只能放文字」（200ms 淡入/1.6s 淡出，Colin 拍板的可感知反馈）。格内选区复制 = 行内载荷（绝不升级整表）；跨格复制 v1 = 纯文本；灰选整表 ⌘C = 完整表块级富 clip（可整表搬运粘贴）。
- **行列增删**（块菜单，cell 编辑态开 grip 菜单）：上/下方插行、左/右侧插列、删除本行/本列。「当前」= 开菜单时正在编辑的格；**菜单开启期间目标行与目标列有底色标出**（`data-ws2-menurow` / `data-ws2-menucol`，纯交互态、serialize 与 PDF 导出两条路径都剥除），标记集合与 `tableEditOp` 真正作用的集合同源（都走 `tableRowsOf`/`rowCellsOf` 的数据行口径，天然继承分页 spacer 过滤）——否则「标出来的行」与「真会被删的行」可能不是同一批，比不标更误导。thead 特判：表头行上下插行都落 tbody 首位、插列在表头产 `th[scope=col]`；新格继承同列 `ws-al-*`；spacer 行（分页产物）不计数不被动。退化收敛：删最后数据行且表头在 → 自动补空行；删光行/删最后一列 → 升级删整表（绝不留 ghost 壳）。操作后焦点显式回落点格。
- **对齐**：块菜单三态钮（左/中/右），per-cell `ws-al-center`/`ws-al-right`（左=清 class 零字节）；CSS 入盘、浏览器直开生效。
- **撤销粒度**：结构操作（建行/行列增删/对齐）= 前后双 checkpoint（先结算 500ms 防抖打字债）——undo 只回滚结构不吞打字，恰一步；跨格清内容同款前置。undo/redo 后按 id/结构路径回原格恢复编辑态（光标精确位置不还原 = 全局 v1 取舍）。
- **发现性**：td/th 悬停 `cursor:text`；无教学气泡（Colin 拍板 2026-08-03 不加）。

- **行/列手柄与按轴菜单**（2026-08-05，对拍 T1/T5/T7，Colin 拍板全按 Notion）：三套手柄并存——
  块手柄（gutter ⋮⋮，恒锚整表）+ 行手柄（表左缘外、y 随悬停行）+ 列手柄（表顶外、x 随悬停列）。
  行菜单 `[上方插行 下方插行 复制本行 清空本行 删除本行]`、列菜单 `[左侧插列 右侧插列 复制本列
  清空本列 删除本列]`，**按轴切干净**（Notion 项集直译）。行列增删从块菜单退役（T7 两种前置状态的
  块菜单随之一致）；cell 对齐组保留在块菜单——Notion simple table 没有对齐概念，这是**有意超集**。
  开轴菜单时焦点停进 focusCatcher（否则 Esc 落宿主窗口、菜单关不掉——键盘可达）。
- **退化守卫**（2026-08-05 改向，对拍 T9 Notion 实测）：**表恒 ≥1 行 ≥1 列**——总行数 ≤1 不给
  「删除本行」、列数 ≤1 不给「删除本列」，退化态从「删完再自动补救」变成「根本删不出来」。
  旧「数据行删光自动补一空行」「删最后一列升级删整表」两条收敛路径废除（Notion：数据行删光后
  表带表头继续立着、不补）。
- **矩形选区与表界钳制**（2026-08-06，对拍 T13/T14 复拍实测，PR-5；Notion 原始读数 = 复拍报告
  notion-t/*.png 共 16 张 + AFTER-DELETE DOM 读数）：
  - 格上按下拖动 = **anchor 格与指针格的行列包围盒**（非编辑格从 4px 阈值起、编辑格出格才升级，
    格内拖动先是原生选词）；高亮 = 单个描边浮件 `.ws-rectsel` 罩住包围盒（Notion 同款：描边不填底），
    语义真相源 = 格上 `data-ws2-cellsel`（入 WS2_MARKERS 存盘剥除）。松手**保持**；点表外/进编辑/
    Esc（上卷整表灰选）解除；undo/redo reset 兜底清。
  - **Delete/Backspace 清矩形内格内容、结构一格不动**（Notion N3：9 格恒 9 格）、一步 undo 整体
    回滚、清后选中态保持；**⌘C = 按行 TSV 纯文本**（tab 分格换行分行，无 HTML 载荷）；**⌘X = TSV
    拷贝 + 清格**；矩形态直接打字 = 清矩形、字落左上格（不蒸发，ADV-R3）；⌘A/开任何菜单/灰选/
    进编辑 = 矩形态让位（单一活动态，ADV-R1/R2/R5）。
  - **出向钳制**：拖出表界，指针坐标四向夹回表内（`cellPosAtPoint`），矩形恒在表内（Notion f3/f3b
    上下对称实测）。**入向钳制**：表外起的选区端点伸进表内 → 端点截到表界、选区夹在段落里（锚进
    相邻块**内部**——body 层锚点会让删除管线判块外死键）。**与 Notion 一致**（f4c 修正读数：入向
    拖到表心，选区=整段段落文字、表格分毫不进；早先「整个不产生选区」系探针假象——CDP mousePressed
    缺 buttons:1 时 Chromium 文字选择控制器不启动，阴性读数无正对照）。旧「端点在表内=整表蓝+整删」
    通道退役。
  - **边缘入口 T2**：贴近表**下缘**悬停出全宽「+」横条（点击=末行下插行）、贴近**右缘**出全高
    「+」竖条（点击=末列右插列），几何判定不依赖悬停命中表块（Notion t2b 实测：条宽=表宽/条高=
    表高，点击 rows 3→4 / cols 3→4）。
  - **行拖拽（T3/T4，2026-08-06 PR-5c 已做）**：行药丸单击=开行菜单不变；**按住越 4px 阈值=拖动
    整行**——指示线横跨表宽落在数据行槽间（指针出表上下界夹到首/末槽），松手移动 `<tr>`（原位槽=
    无操作不标脏；前后双 checkpoint 一步 undo）；**表头行不可拖**（thead ≤1 恒顶是文法硬约束）；
    起手清矩形选中态。Notion 对照=t3f 修正读数（行 2/行 3 真机互换 + 横跨表宽落槽渲染；
    `.notion-simple-table-selector`）。⚠ 教训入账：早先四次「行不可拖」阴性全是 mousePressed 缺
    buttons:1 的探针假象——**阴性结论必须有同通道正对照**才可信。

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
- 跨格格式化（选区罩多格点 B/I）不作用（选区语义归清内容/复制）；跨格复制 = 矩形 TSV 纯文本（2026-08-06 已做；「粘贴 TSV 回表格/子表富复制」仍是后续项）。
- cell 内 @提及/互链菜单不可用（cellEl 态天然 inert，功能缺失非损坏）。
- blockedit.js 已 3400+ 行（pre-existing + 本 feature 增量），拆 table 模块列入下次动此文件前的评估项。

## 欠账

- **中文 IME 在 cell 内组词只能真机验**（容器/CI 都验不了；历史上有真机才炸的先例）——发版前 Colin 真机 checklist 项。
- ~~矩形选中态 ⌘V~~（2026-08-06 已做，sweep 授权收账）：TSV 按 anchor 铺格、整格覆盖、空值清格 <br> 占位、**越界裁剪不扩结构**（有意收窄：Notion 会自动加行列；加行列走边缘条/轴菜单）、铺完选中态移到覆盖区、一步 undo。门 e2e/table-tsv-paste.spec.js 3 条。
- ~~行拖拽（T3/T4）押 PR-5c~~（2026-08-06 已做，见「矩形选区与表界钳制」节；门 e2e/table-row-drag.spec.js 6 条）。
- **方向键只做「收敛」，不做「移动选区」**（2026-08-06 Colin 试玩后定，有意只做一半）。
  现状：矩形态按方向键把选区收敛成一个光标——`←/↑` 落左上格开头、`→/↓` 落右下格末尾，
  照文字选区收敛的老规矩。目的只是堵掉「按一下选区没了、光标也没有」的真空
  （原实现只 `clearRectSel()` 就落 generic 管线，而那儿的方向键导航要求 `selectedEl` 非空、此刻是 null）。
  **Notion 是方向键移动整个矩形**，还配 `Shift+方向键` 扩选、`Shift+点击` 扩选——那是独立 feature，
  要先跟 Notion 对拍再做，本次不假装做完。
  ⚠ 实现坑：收敛后**必须 `return`**，否则同一次按键继续往下走会撞进「格内方向键移格」分支，
  刚落进的光标当场再被挪一格（实测 c23 → c33）。门 `e2e/table-edgebar-arrow.spec.js` E3/E4 钉的是
  **落在哪一格**，不是「有没有光标」——只断言后者的话这个坑完全测不出来。
- .md 文档中造表会被 md-adapter 岛化（class 不在白名单，管道表变 HTML 岛，内容保真但丢 md 可读性）；对 md 来源表格切对齐同账。绕法：.md 少用编辑器造表。等真实反馈再做「.md 造表产无 class + align 形态」分叉。
- ui-demo 侧不追 cell 级交互（demo 定位，见有意分歧）。
