# A1 调用点分账清单（U0 手术图）

- 生成：2026-08-07，七路并行盘点（workflow wf_25e5f60d-f44），基线 = feat/row-block-identity @ 288fcbf 的 src/editor/blockedit.js（6168 行）
- 口径：plan 2026-08-07-002 §核心设计——存储块（A1 后仍走 blockOf）vs 交互块（A1 后走 iblockOf）
- ⚠ 行号锚定在上述基线；U1 起动刀后行号会漂，按 context（函数/分支名）对位

## 统计

| symbol | 分类分布 |
|---|---|
| blockOf | storage:21 · interaction:9 · dual:6 |
| editingEl | interaction:131 · ce-host:71 · storage:21 · guard:4 · dual:1 |
| selectedEl | graysel-agnostic:28 · guard:14 · graysel-assumes-top:13 |

共 319 条分账 + 83 条结构假设（extras）。

## Open 决策点（migration 标 open 的，动刀前逐条过）

- **:879** `editingEl` @ tabLineHostOf（Tab 分派 helper，函数体在 883 起）的头注，本行第 1 处「不能相对 editingEl 算」 — open: A1 后 tabLineHostOf 的取行逻辑与 iblockOf 高度重叠（list→li、多段容器→行宿主），应统一口径或让 Tab 分支改走 iblockOf。
- **:1117** `selectedEl` @ positionFmtbar 分支②（第 2 处：喂 isEditableEl） — open: A1 若行可灰选，classify/isEditableEl 要认 LI 与容器直接子 P（或行走独立分支）
- **:1124** `editingEl` @ positionFmtbar 分支③（粘住锚几何） — open: A1 后可改锚行（editRowEl/iblock），是否对齐 Notion 待对拍
- **:1477** `editingEl` @ scrollCaretIntoViewIfNeeded 回退几何（第 2 处） — open: A1 可优先回退行盒（editRowEl/iblock）更准；现状仅影响滚动幅度非正确性
- **:2330** `editingEl` @ deleteSelection 单块分支（sBlk === eBlk） — open: 取决于 A1 后 ce 宿主挂哪层——若行级挂载，改成 editingEl.contains(r.startContainer) 或与 iblockOf 比对。
- **:2491** `editingEl` @ splitBlock 手术对象捕获 — open: A1 后若 li 成为 ce 宿主，本函数会产 li 兄弟——语义恰好对，但需确认列表 Enter 仍走专用路径、不撞车。
- **:2684** `editingEl` @ turnMenuActiveKey —「转为」菜单当前项高亮 — open: A1 后列表内高亮应反映 caret 所在行——改取 caret 处 iblockOf，li 时按宿主列表类型映射 key
- **:2711** `editingEl` @ openTurnMenu — 菜单项 click handler — open: A1 后转换目标应走交互块口径；列表部分行已有 turnIntoLines 特判，可用 iblockOf 统一收编
- **:2826** `selectedEl` @ openBlockMenu — rowMode 分支（行锚手柄开菜单） — open: A1 若把行灰选并入 selectedEl=li，menuRow 通道可合并——前提是 Delete/removeBlock 改走交互块口径（2825 注释点名的正是这个坑）
- **:3994** `editingEl` @ onKeyDown 斜杠触发 — open: A1 斜杠作用块是否改 iblockOf(光标)，列表内 slash 插入/转换粒度按对拍定
- **:4012** `editingEl` @ onKeyDown ⌘⌥0-3 转块 — open: A1 后 tgt 应取交互块（光标行/段）做转换，语义按对拍定
- **:4012** `selectedEl` @ onKeyDown ⌘⌥0-3 转块 — open: A1 行级灰选后需定义 li 的 turn-into（Notion=行级转换出列表）或 classify 门显式排 li
- **:4050** `editingEl` @ onKeyDown ⌘A 通用两档 — open: callout/quote 是否补 段→框→全篇 三档按对拍定
- **:4054** `editingEl` @ onKeyDown ⌘A 通用两档 ① — open: 同上，第一档可改 iblock 内容
- **:4325** `editingEl` @ onKeyDown Tab 非列表 indentable 判定 — open: callout 内 Tab 缩整框还是框内行，按对拍定
- **:4472** `editingEl` @ onKeyDown Backspace 列表分支入口 — open: 保留宿主分派，或改判 iblockOf(光标) 是否 li
- **:4689** `editingEl` @ onKeyDown Delete 列表分支 U7 — open: 同 4472，可改判 iblockOf(光标) 是否 li
- **:5032** `editingEl` @ tryMarkdown 入口（同行第2处） — open: A1 后 li 内敲 marker 是否按 iblockOf 扩展行级触发，待对拍 Notion
- **:5181** `selectedEl` @ onCopy ① 灰选整块复制 — open: LI 时应打包成携带列表 tagName/class 的单项列表（对齐 U3/clip-1 的行级打包）
- **:5321** `editingEl` @ insertBlocksAtCaret 块首判定（第 1 处） — open: 列表编辑态中块级粘贴是否要按光标行劈列表落位（现按整 ul 块首/块末），按 plan 拍板
- **:5722** `blockOf` @ onDragOver 通用块拖拽（非行拖）指示线目标 — open: 拆开——iblockOf 定线+行级落点，块落进列表需劈容器（存储手术）；必须与 5780 同改（画=做同源铁律）
- **:5780** `blockOf` @ onDrop 通用块拖拽落点 — open: 与 5722 同拆——列表目标行级落点+劈容器，按 plan 拍板

## 逐条账本

| 行 | symbol | 分类 | 位置 | 依据 | A1 迁移 |
|---|---|---|---|---|---|
| 617 | selectedEl | graysel-agnostic | attach() 状态区声明 | 声明本身对粒度无假设；现行不变量「行模式绝不设 selectedEl」（恒为顶层块）落在别处的赋值点，不在这行。 | 声明不改；open: A1 后 selectedEl 是否允许存交互块（li）需拍板，注释「块」措辞届时应明确指哪种块。 |
| 618 | editingEl | ce-host | attach() 状态区声明 | 声明的就是 contenteditable 宿主状态；列表时它是整个 <ul>（879 行注释自证）。 | A1 不改——editingEl 保持存储级 ce 宿主语义，行级作用单元另走 iblockOf。 |
| 622 | selectedEl | graysel-agnostic | gripEl 单一真相源注释（状态区，gripEl 声明上方） | 纯注释（I4 历史 bug 的说明），无代码语义，对 selectedEl 粒度无假设。 | 不改。 |
| 636 | editingEl | ce-host | captionEl 声明的行尾注释 | 纯注释，引用 editingEl 作为「编辑态」对照来定义 captionEl，无代码语义。 | 不改。 |
| 636 | selectedEl | graysel-agnostic | captionEl 声明的行尾注释 | 纯注释，同上，无粒度假设。 | 不改。 |
| 879 | editingEl | ce-host | tabLineHostOf（Tab 分派 helper，函数体在 883 起）的头注，本行第 1 处「不能相对 editingEl 算」 | 注释明言 editingEl 是宿主粒度、不能当行用——正是 A1 要拆的两种语义的现成书面证据。 | open: A1 后 tabLineHostOf 的取行逻辑与 iblockOf 高度重叠（list→li、多段容器→行宿主），应统一口径或让 Tab 分支改走 iblockOf。 |
| 879 | editingEl | ce-host | 同一头注，本行第 2 处「列表的 editingEl 是整个 <ul>」 | 注释陈述事实：列表的 ce 宿主是整个 ul，即 A1 保留给 editingEl 的存储/宿主语义。 | 不改；A1 后该注释仍成立（iblockOf 只下沉交互层，editingEl 不动，与 #406 容器化同款处理）。 |
| 1061 | selectedEl | graysel-agnostic | rowSelEl（Esc 段选真相源） | 只判真值定优先级（灰选/menuRow 压段选），不涉 selectedEl 形态 | A1 若行升一等选中对象（selectedEl 可为行），rowSelEl 的 attr 真相源可并回 selectedEl、整函数退役 |
| 1072 | selectedEl | graysel-agnostic | gutterAnchor（P2-3 锚点单一出口） | 锚点透传，下游 positionGrip 自带 isRowAnchor 分派 | 不改 |
| 1081 | selectedEl | guard | positionGrip 灰选上卷分支（本行第 1 处：真值判） | null 守卫（灰选在场才启用上卷） | 不改 |
| 1081 | selectedEl | graysel-agnostic | positionGrip 灰选上卷分支（第 2 处：同一性比较） | el !== selectedEl 对 li 或顶层块皆成立 | 不改 |
| 1081 | selectedEl | graysel-agnostic | positionGrip 灰选上卷分支（第 3 处：contains） | 「灰选=作用域，gutter 不下沉到其内部行」按 contains 判，与形态无关 | 不改；A1 后 selectedEl 若可为行，嵌套 li 场景语义仍成立 |
| 1081 | selectedEl | graysel-agnostic | positionGrip 灰选上卷分支（第 4 处：赋值上卷） | 把手柄锚上卷到灰选块，对任意粒度的选中对象都对 | 不改 |
| 1096 | blockOf | storage | positionGrip 行锚分支（U1 行级手柄） | gripRow 已持有行（交互块），blockOf 取行的宿主存储容器给劈列表手术/块级菜单用 | 不改——A1 后交互块语义由 gripRow(=iblockOf 产物)承担，gripEl 继续用 blockOf 取存储容器 |
| 1112 | editingEl | ce-host | positionFmtbar 分支①（编辑态选区跟随） | 判「在编辑中」的存在性守卫，矩形来自选区不来自块 | 不改 |
| 1117 | editingEl | ce-host | positionFmtbar 分支②（块选中非编辑） | 非编辑态存在性守卫 | 不改 |
| 1117 | selectedEl | guard | positionFmtbar 分支②（本行第 1 处：真值判） | null 守卫 | 不改 |
| 1117 | selectedEl | graysel-assumes-top | positionFmtbar 分支②（第 2 处：喂 isEditableEl） | classify 词表只认顶层块标签（LI→'other'），selectedEl=行时会误判不可编辑、气泡不弹 | open: A1 若行可灰选，classify/isEditableEl 要认 LI 与容器直接子 P（或行走独立分支） |
| 1118 | selectedEl | graysel-agnostic | positionFmtbar 分支②（气泡锚几何） | getBoundingClientRect 对任意元素成立 | 不改 |
| 1123 | editingEl | ce-host | positionFmtbar 分支③（气泡粘住） | 「仍在编辑中」存在性守卫 | 不改 |
| 1124 | editingEl | interaction | positionFmtbar 分支③（粘住锚几何） | 拿 CE 宿主盒当气泡锚——编辑列表时锚整个 ul 顶部而非所编辑那行，宿主盒≠交互块盒 | open: A1 后可改锚行（editRowEl/iblock），是否对齐 Notion 待对拍 |
| 1129 | editingEl | ce-host | positionFmtbar 分支④（homeless 跨块选区） | 非编辑态存在性守卫 | 不改 |
| 1175 | editingEl | ce-host | refreshEditRow 入口 | 「在编辑中」存在性守卫 | 不改 |
| 1176 | editingEl | interaction | refreshEditRow 容器判据（本行第 1 处：UL 判） | 按 tagName 判「CE 宿主是存储容器」才下沉行底色——正是 blockOf 双语义病灶的补丁层（1146 注释自证） | A1 后行身份由 iblockOf 承担，此白名单判据退役；CE 若也下沉到行，refreshEditRow 整层可删 |
| 1176 | editingEl | interaction | refreshEditRow 容器判据（第 2 处：OL 判） | 同上，OL 半边 | 同上 |
| 1177 | editingEl | interaction | refreshEditRow 行解析 | 拿 CE 宿主（存储容器）当行解析作用域，产物 li 才是真交互块 | A1 改为 iblockOf(光标) 直接得行，caretRowOf 并入 iblockOf |
| 1198 | blockOf | storage | refreshRangeSel 端块解析（本行第 1 处：起点） | 选区端点上卷到顶层存储块，用于同块早退/跨表钳制/作用域行走；行级蓝底另由 walkListRows 下沉 | 不改——端块=存储块正确，A1 无需换 iblockOf |
| 1198 | blockOf | storage | refreshRangeSel 端块解析（第 2 处：终点） | 同上 | 不改 |
| 1233 | blockOf | storage | refreshRangeSel T14 表界钳制（本行第 1 处：起点格→表） | cell 上卷到所属 TABLE 顶层块，表界钳制是存储级手术 | 不改 |
| 1233 | blockOf | storage | refreshRangeSel T14 表界钳制（第 2 处：终点格→表） | 同上 | 不改 |
| 1299 | selectedEl | graysel-agnostic | selectBlock（唯一写入点） | 赋值本身无形态假设；现行调用方恒传顶层块（「行模式不设 selectedEl」原则） | A1 拍板行是否可成为 selectedEl；若可，要改的是消费方（isEditableEl/removeBlock 等），不是这行 |
| 1318 | selectedEl | graysel-agnostic | deselect 状态清空 | 清空，无块语义 | 不改 |
| 1325 | editingEl | ce-host | enterEdit 切宿主（本行第 1 处：真值判） | 挂新 CE 前判有无旧宿主 | 不改 |
| 1325 | editingEl | ce-host | enterEdit 切宿主（第 2 处：同一性比较） | 换宿主才卸旧 CE | 不改；A1 若 CE 下沉到行，el 变行、逻辑不变 |
| 1328 | selectedEl | graysel-agnostic | enterEdit 态互斥清空 | 进编辑清灰选，无形态假设 | 不改 |
| 1329 | editingEl | ce-host | enterEdit 挂载 | CE 宿主挂载赋值（contenteditable/data-ws2-editing 随后挂 el） | 不改；但 A1 需拍板 CE 挂存储容器还是行——挂行则此处赋的就是 iblock |
| 1342 | editingEl | ce-host | exitEdit 入口 | 卸载前存在性守卫 | 不改 |
| 1343 | editingEl | ce-host | exitEdit 卸载（本行第 1 处：暂存引用） | CE 卸载序列（先置空再摘属性） | 不改 |
| 1343 | editingEl | ce-host | exitEdit 卸载（第 2 处：置空） | CE 宿主卸载 | 不改 |
| 1357 | editingEl | ce-host | enterCell 四态互斥 | 进 cell 编辑先卸块编辑 CE | 不改 |
| 1359 | selectedEl | graysel-agnostic | enterCell 态互斥清空 | 清空，无块语义（注释明言 selectedEl 永不允许是 TD/TH） | 不改 |
| 1429 | editingEl | ce-host | selectWholeDoc（⌘A 第二级） | 设全篇选区前退出编辑（放墙） | 不改 |
| 1431 | selectedEl | graysel-agnostic | selectWholeDoc 态互斥清空 | 清空，无块语义 | 不改 |
| 1477 | editingEl | guard | scrollCaretIntoViewIfNeeded 回退条件（本行第 1 处） | null 守卫（deref 前） | 不改 |
| 1477 | editingEl | interaction | scrollCaretIntoViewIfNeeded 回退几何（第 2 处） | 光标矩形取不到时拿整个 CE 宿主盒当替身——列表时是整 ul 盒，滚动量按块不按行 | open: A1 可优先回退行盒（editRowEl/iblock）更准；现状仅影响滚动幅度非正确性 |
| 1810 | selectedEl | graysel-agnostic | enterCaptionEdit（进图片说明编辑前清态） | 纯清空，对 selectedEl 是 li 还是顶层块零假设。 | 不改。 |
| 2060 | blockOf | storage | selectedTopBlocks（「转为」跨块入口的块跨度计算） | 算选区覆盖的作用域级块跨度，消费方 turnIntoMany 做容器级 turnInto/turnIntoLines 手术；列表行粒度已由下游 selectedListLines 单独承接。 | 不改，继续 blockOf——行粒度由 selectedListLines/turnIntoLines 分层处理，本层就要容器单位。 |
| 2060 | blockOf | storage | selectedTopBlocks（同上，end 端） | 同上一条，end 端点上卷进 blocksInScope 列表做 indexOf，容器级跨度。 | 不改，继续 blockOf。 |
| 2161 | blockOf | interaction | execText cell 分支（U4/R1：同 cell 选区格式化） | 上卷 cell 找宿主块并按 classify(blk2)==='table' 决定行为——是格式化交互的作用块识别；若表格嵌在 blockquote/callout 内 blockOf 会返回容器导致死按钮。 | 改 iblockOf（顺带修容器内表格 fmtbar 失效；若 schema 不允许容器内 table 则两者等价，open: 需查 schema）。 |
| 2180 | blockOf | storage | execText 跨块管线（B/I/U/S 逐块 execCommand） | 顶层块在这只当「临时 contenteditable 宿主」的切分单位，execCommand 在整 ul 宿主上作用子 range 是安全的（2515 注释实证顶层粒度对 bold 够用）。 | 不改——ce 宿主切分保持存储块粒度即可，行粒度非必需。 |
| 2180 | blockOf | storage | execText 跨块管线（同上，end 端） | 同上一条。 | 不改。 |
| 2198 | editingEl | ce-host | execText 收尾（跨块格式化后归还焦点） | 「在编辑中」存在性守卫，决定要不要归还焦点。 | 不改——ce 宿主职责，A1 不动。 |
| 2198 | editingEl | ce-host | execText 收尾（同一行第二处：存活检查） | 同一守卫的 DOM 存活检查，仍是编辑宿主管理。 | 不改。 |
| 2198 | editingEl | ce-host | execText 收尾（同一行第三处：focus） | 焦点归还给 ce 宿主，典型 ce-host。 | 不改。 |
| 2225 | blockOf | storage | deleteSelection U26 同 toggle 跨 summary↔正文删除分支 | end 端上卷成 toggle 体内作用域块，indexOf 进 blocksInScope(sDet) 后做整删/裁头手术——跨块整删+合并落点是存储语义；端点行级精度由 Range 裁剪保证。 | 不改，继续 blockOf（scoped 版已返回体内块）。 |
| 2285 | blockOf | storage | deleteSelection 主管线端点上卷 | 喂给表格 ED-A2 整删、跨/同作用域整删+裁剪+canMerge 合并落点——全是存储块手术；端点内精度靠 Range，不需要行身份。 | 不改；但单块分支的 enterEdit(sBlk) 与 2330 的 editingEl 比对要跟 ce 宿主层级连动（见 2330 条）。 |
| 2285 | blockOf | storage | deleteSelection 主管线端点上卷（end 端，同一行第二次调用） | 同上一条。 | 不改。 |
| 2330 | editingEl | dual | deleteSelection 单块分支（sBlk === eBlk） | 既是「在编辑中」判定，又把 editingEl 当块身份与 blockOf 产物（存储块）恒等比对；若 A1 后 ce 宿主挂行级（li），列表内选区会恒不等、误入接管路径。 | open: 取决于 A1 后 ce 宿主挂哪层——若行级挂载，改成 editingEl.contains(r.startContainer) 或与 iblockOf 比对。 |
| 2486 | editingEl | ce-host | splitBlock 入口守卫 | 「在编辑中」存在性守卫，门住整个劈块路径。 | 不改。 |
| 2487 | editingEl | interaction | splitBlock U13 防御（拒劈 summary） | 按 editingEl 的块类型决定行为——把编辑宿主当劈分作用块分类。 | 不改（summary 在 A1 后仍是 ce 宿主候选，判据继续成立）。 |
| 2488 | editingEl | interaction | splitBlock 防御（details 容器不可劈） | 同上，按类型分类决定行为。 | 不改。 |
| 2491 | editingEl | interaction | splitBlock 手术对象捕获 | editingEl 直接当劈分手术的作用块（extractContents 后 el.after(nx) 产同类型兄弟）。 | open: A1 后若 li 成为 ce 宿主，本函数会产 li 兄弟——语义恰好对，但需确认列表 Enter 仍走专用路径、不撞车。 |
| 2577 | blockOf | interaction | addLink（气泡「链接」→ openMention wrap 模式） | blk 是提及菜单的块上下文——菜单作用单元属交互语义；列表内选文字加链接时现在拿到整个 ul。 | 倾向改 iblockOf；open: 先查 openMention 对 blk 的实际用途（仅定位/上下文则两可）。 |
| 2577 | editingEl | interaction | addLink（openMention 的块上下文首选来源） | editingEl 当交互作用块（提及菜单上下文）用，不是 ce 管理。 | 与同行 blockOf 条一致：倾向行级（iblockOf 语义），open 同前。 |
| 2684 | editingEl | interaction | turnMenuActiveKey —「转为」菜单当前项高亮 | 拿 editingEl 的 tagName 定菜单高亮 key——把 CE 宿主当「当前作用块」用 | open: A1 后列表内高亮应反映 caret 所在行——改取 caret 处 iblockOf，li 时按宿主列表类型映射 key |
| 2684 | selectedEl | graysel-assumes-top | turnMenuActiveKey —「转为」菜单当前项高亮 | 后续 tagName 分支只认 P/H1-4/BLOCKQUOTE/UL/OL/DETAILS/callout DIV 等顶层块标签，无 LI 分支（li 会落 null=无高亮） | A1 若灰选下沉到行，需加 LI（看宿主列表）与容器内 P 分支 |
| 2711 | editingEl | interaction | openTurnMenu — 菜单项 click handler | target 直接喂 turnInto/turnIntoLines/selectedListLines——editingEl 当转换对象块用 | open: A1 后转换目标应走交互块口径；列表部分行已有 turnIntoLines 特判，可用 iblockOf 统一收编 |
| 2711 | selectedEl | graysel-assumes-top | openTurnMenu — 菜单项 click handler | target.tagName==='UL'/'OL' 分支与整块 turnInto(target) 都按顶层块口径消费 | 若 selectedEl 允许为 li，此处需分流到行级 turnIntoLines；否则维持顶层块契约 |
| 2728 | editingEl | ce-host | openTurnMenu click handler — 转换后恢复编辑/灰选态 | 判「转换前是否在编辑中」的存在性守卫，决定恢复路径 | 不改 |
| 2803 | blockOf | storage | removeRow — 嵌套子列表被掏空、宿主 li 收敛分支 | 找顶层列表当 enterEdit 的 CE 挂载宿主（随后 caretAtLiTextEnd(hostLi) 定位到行），CE 挂载单元 A1 不动 | 不改——enterEdit 宿主仍是顶层块，行内光标已由 caretAtLiTextEnd 兜着 |
| 2826 | selectedEl | graysel-agnostic | openBlockMenu — rowMode 分支（行锚手柄开菜单） | 仅清空灰选态、行选走独立 menuRow 通道，对 selectedEl 型别零假设 | open: A1 若把行灰选并入 selectedEl=li，menuRow 通道可合并——前提是 Delete/removeBlock 改走交互块口径（2825 注释点名的正是这个坑） |
| 3161 | blockOf | storage | armImgDrag — 图片缩放起手快照（I1） | 只为取 blk.parentElement.clientWidth 当缩放列宽上限——顶层块几何查询，与交互作用单元无关 | 不改；列宽=顶层块父容器宽，行块化不影响此语义 |
| 3384 | editingEl | ce-host | maybeMentionTrigger — @/[[ 触发前置守卫 | 判「在编辑中」的存在性守卫 | 不改 |
| 3385 | editingEl | ce-host | maybeMentionTrigger — 读触发符 | 在 CE 宿主内读 caret 前两字符，纯宿主内定位 | 不改 |
| 3391 | editingEl | ce-host | maybeMentionTrigger → openMention | 作 blockEl 传给提及系统算 caretOffset 锚点——提及偏移锚定在 CE 宿主上 | 不改（提及锚点与 CE 挂载单元绑定，A1 不动挂载） |
| 3455 | blockOf | interaction | onMouseDown — 表格格 mousedown 矩形选区待命（T13） | 找 td 所属表格做矩形选区/cellPosOf 的作用单元；表格的交互块=整表，storage/interaction 两原语在此同值 | 建议改 iblockOf 求语义一致（表非列表/多段容器，行为不变）；不改也安全 |
| 3478 | editingEl | ce-host | onMouseMove — rowDrag（表格行拖拽）越阈起手（ADV-RD3） | 行摘挂重插前卸编辑态，防聚焦 contenteditable 被打悬空；存在性判+卸载 | 不改 |
| 3516 | editingEl | ce-host | onMouseMove — 跨块拖选摘墙分支（wallDropped） | 摘 contenteditable 墙让选区跨块前卸编辑态 | 不改 |
| 3521 | blockOf | interaction | onMouseMove 悬停手柄锚定 | 命中块只喂悬停手柄/轴柄/图片UI，紧接 rowOf/paraOf 手写行级细化，纯交互锚 | 改 iblockOf(e.target)，rowOf/paraOf 行级推导并入 iblockOf；表格/图片两义重合无行为差 |
| 3562 | blockOf | interaction | onMouseUp 同 cell 拖选恢复分支 | 上卷到表块 classify 校验后 enterCell；表格存储块=交互块恒重合 | 不改或换 iblockOf 等价（表格无行级交互块） |
| 3571 | blockOf | storage | onMouseUp 单块选区恢复（第1处 sBlk） | 结果直接喂 enterEdit——ce 宿主是顶层存储块（列表=整 ul 一堵墙），A1 不动宿主粒度 | 继续用 blockOf（enterEdit 收存储块） |
| 3571 | blockOf | storage | onMouseUp 单块选区恢复（第2处 eBlk） | 与 sBlk 比对『选区是否同一 ce 宿主』；改 iblockOf 会把同 ul 跨 li 选区误判跨块、不再恢复编辑 | 继续用 blockOf |
| 3586 | editingEl | ce-host | onDocLeave | 编辑态存在性守卫（在编辑就不收悬停浮件） | 不改 |
| 3586 | selectedEl | guard | onDocLeave | null 守卫 | 不改 |
| 3617 | editingEl | ce-host | onClick summary chevron 折叠分支 | 宿主身份比对：非编辑态才 blur summary | 不改 |
| 3618 | editingEl | ce-host | onClick summary 文字区分支 | 宿主身份比对决定是否进编辑 | 不改 |
| 3626 | blockOf | interaction | onClick td/th 进格分支 | 上卷校验该格属于真表块再 enterCell；表格两义重合 | 不改或换 iblockOf 等价 |
| 3633 | blockOf | dual | onClick generic | 同一结果既当 enterEdit 的 ce 宿主（存储）又当 selectBlock/positionGrip 灰选对象（交互） | 拆：可编辑分支保 blockOf 进编辑；灰选分支改 iblockOf（现灰选对象仅 img/hr/table，两义暂重合） |
| 3651 | editingEl | ce-host | onClick generic 可编辑分支 | 已编辑此宿主的纯点击交原生移光标，比较基准=ce 宿主（存储块） | 不改（该分支 el 仍取 blockOf） |
| 3676 | blockOf | dual | onKeyDown captionEl ↑↓ 导航分支 | 锚既喂 topBlocks/blocksInScope 的 indexOf（存储序）又服务键盘导航停靠（交互） | A1 导航粒度下沉时改 iblockOf+交互块序列；导航不动则保持 blockOf（图片两义重合） |
| 3708 | editingEl | ce-host | onKeyDown rectSel 键盘分支 gate | 编辑态存在性守卫 | 不改 |
| 3888 | editingEl | guard | onKeyDown summary 编辑分支 gate（第1处） | null 守卫 | 不改 |
| 3888 | editingEl | interaction | onKeyDown summary 编辑分支 gate（第2处） | 按宿主类型路由键盘行为；summary 的交互块=宿主本身 | 不改 |
| 3897 | editingEl | ce-host | onKeyDown summary U26 跨界选区（第1处） | 判选区是否跨出 ce 宿主边界 | 不改 |
| 3897 | editingEl | ce-host | onKeyDown summary U26 跨界选区（第2处） | 同上端点边界判定 | 不改 |
| 3916 | editingEl | interaction | onKeyDown summary Enter 分支 | 从 summary 取宿主 details 做新建/插入手术锚 | 不改（toggle 层级 A1 不动） |
| 3927 | editingEl | interaction | onKeyDown summary Enter 折叠态标题末 | 标题末判定决定新建平级 toggle；summary 无行级子单元 | 不改 |
| 3955 | editingEl | interaction | onKeyDown summary Tab 分支 | 行首判定（行中 Tab=两空格）；summary 即其行 | 不改 |
| 3964 | editingEl | interaction | onKeyDown summary Backspace 行首 E2 降级 | 行首判定触发 toggle 降级 | 不改 |
| 3972 | editingEl | interaction | onKeyDown summary Backspace E2 | 取宿主 details 做 turnInto/解包手术锚 | 不改 |
| 3976 | editingEl | interaction | onKeyDown summary Backspace 空 toggle 逃生 | 标题空判定走整块解包 | 不改 |
| 3993 | editingEl | ce-host | onKeyDown 斜杠触发 gate | 编辑态存在性守卫 | 不改 |
| 3994 | editingEl | interaction | onKeyDown 斜杠触发 | 斜杠菜单作用块=编辑宿主——列表内应是光标行 li，交互语义 | open: A1 斜杠作用块是否改 iblockOf(光标)，列表内 slash 插入/转换粒度按对拍定 |
| 3996 | editingEl | ce-host | onKeyDown 斜杠触发 setTimeout 回调 | 宿主身份未变才开菜单（陈旧性守卫） | 不改 |
| 4003 | editingEl | ce-host | onKeyDown ⌘E 行内代码 | 编辑态存在性守卫 | 不改 |
| 4012 | editingEl | interaction | onKeyDown ⌘⌥0-3 转块 | 编辑宿主当 turnInto 对象；列表被 classify 门排除，但多段容器粒度=整块 | open: A1 后 tgt 应取交互块（光标行/段）做转换，语义按对拍定 |
| 4012 | selectedEl | graysel-assumes-top | onKeyDown ⌘⌥0-3 转块 | turnInto 就地替换成 p/h1-3——若 selectedEl 是 li 会产出 ul>h1 非法嵌套，隐含 scope 级块假设（今天恒顶层所以安全） | open: A1 行级灰选后需定义 li 的 turn-into（Notion=行级转换出列表）或 classify 门显式排 li |
| 4028 | editingEl | ce-host | onKeyDown ⌘A 分级 gate | 编辑态存在性守卫（分编辑/非编辑两路） | 不改 |
| 4035 | editingEl | interaction | onKeyDown ⌘A 列表三档 gate（第1处 UL） | 按宿主类型开列表分档——手写行级(li)逻辑的入口 | A1 可改判 iblockOf(anchor) 是否 li：三档=iblock→存储块→全篇 |
| 4035 | editingEl | interaction | onKeyDown ⌘A 列表三档 gate（第2处 OL） | 同上 OL 半边 | 同上 |
| 4038 | editingEl | interaction | onKeyDown ⌘A 列表三档 ① | 行归属校验：li 在本列表容器内 | A1 改比 storage(iblock)===editingEl 或由 iblockOf 直接给行免校验 |
| 4043 | editingEl | interaction | onKeyDown ⌘A 列表三档 ② | 第二档基准=整个存储块文本，editingEl 恰=存储块 | 不改（第二档语义就是整列表） |
| 4046 | editingEl | interaction | onKeyDown ⌘A 列表三档 ② | 第二档选整列表（存储块） | 不改 |
| 4050 | editingEl | interaction | onKeyDown ⌘A 通用两档 | 『块内已全选』按整块判——多段容器(callout)缺行级第一档 | open: callout/quote 是否补 段→框→全篇 三档按对拍定 |
| 4054 | editingEl | interaction | onKeyDown ⌘A 通用两档 ① | 第一档选整块内容；多段容器粒度偏粗 | open: 同上，第一档可改 iblock 内容 |
| 4098 | editingEl | ce-host | onKeyDown ⌘X 灰选整块分支 | 非编辑态守卫 | 不改 |
| 4098 | selectedEl | guard | onKeyDown ⌘X 灰选分支 gate | null 守卫 | 不改 |
| 4101 | selectedEl | graysel-assumes-top | onKeyDown ⌘X 灰选分支 | 喂 removeBlock——口径钦定的顶层假设样本；行级灰选的 li 不能走整块删 | A1 需 removeBlock 支持行（删 li+空列表清理）或分派行级删除；onCopy 灰选分支同步行级 |
| 4106 | editingEl | ce-host | onKeyDown Enter gate | 编辑态存在性守卫 | 不改 |
| 4108 | editingEl | interaction | onKeyDown Enter 列表路由 | 按宿主类型路由——列表 Enter 行级逻辑的总闸 | A1 保留宿主 classify 或改由 iblockOf(光标).tagName==='LI' 驱动 |
| 4118 | editingEl | interaction | onKeyDown Enter 空项 U12 嵌套判定 | 以 editingEl 当顶层列表容器判嵌套层级——存储容器锚 | 不改（劈列表手术锚存储块，A1 后 editingEl 仍=存储块） |
| 4134 | editingEl | interaction | onKeyDown Enter 空项 U15 中间项劈列表 | 劈 ul 容器手术的存储锚 | 不改（存储手术继续锚 editingEl） |
| 4154 | editingEl | interaction | onKeyDown Enter 空末项退出列表 | 退出列表/整块转正文的存储锚 | 不改 |
| 4186 | editingEl | interaction | onKeyDown Enter 多段容器 C6/C7 路由 | 按宿主类型路由容器内切行——手写段级(p)逻辑入口 | A1 行宿主推导换 iblockOf，路由判据可保留 |
| 4200 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第1处） | 手写向上爬找容器直接子 <p>——正是 iblockOf 的内联实现 | A1 换 iblockOf(rg.startContainer) |
| 4200 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第2处） | 直接子判定终止条件 | 同上 |
| 4201 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第1处） | 行宿主=子 p 分支判定 | A1 由 iblockOf 取代整段三态推导 |
| 4201 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第2处） | 行宿主=容器本体（裸行内区）分支判定 | 同上 |
| 4201 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第3处） | 裸行内区取容器本体当行宿主 | 同上 |
| 4201 | editingEl | interaction | onKeyDown Enter 容器切行 lh 推导（第4处） | 兜底行宿主推导（又一手写行级原语） | 同上 |
| 4204 | editingEl | interaction | onKeyDown Enter 容器空末行跳出 | 容器内末行宿主推导（行级枚举） | A1 由『存储块→交互块列表』原语供给 |
| 4205 | editingEl | interaction | onKeyDown Enter 容器空末行跳出 | 判行宿主非容器本体（裸行内区例外） | iblockOf 化后随之简化 |
| 4207 | editingEl | interaction | onKeyDown Enter 容器空末行跳出（第1处） | 掏空容器判定 | 不改（容器占位手术在存储块上） |
| 4207 | editingEl | interaction | onKeyDown Enter 容器空末行跳出（第2处） | 掏空容器补占位 <br> | 不改 |
| 4208 | editingEl | interaction | onKeyDown Enter 容器空末行跳出 | 跳出框在存储块后插同级新块——存储落点 | 不改（落点=存储兄弟位） |
| 4219 | editingEl | interaction | onKeyDown Enter 容器光标切行 | 裸行内区（行宿主=容器本体）分支判定 | iblockOf 化后简化 |
| 4223 | editingEl | interaction | onKeyDown Enter 容器裸行内区切行 | 扫容器直接子找光标后首个 <p>（行级手术） | 随 iblock 重写也兼容，不改亦可 |
| 4224 | editingEl | interaction | onKeyDown Enter 容器裸行内区切行（第1处） | 切行 Range 兜底到容器末 | 不改 |
| 4224 | editingEl | interaction | onKeyDown Enter 容器裸行内区切行（第2处） | 同上端点计算 | 不改 |
| 4226 | editingEl | interaction | onKeyDown Enter 容器裸行内区切行（第1处） | 新行宿主插进容器（行级手术） | 不改 |
| 4226 | editingEl | interaction | onKeyDown Enter 容器裸行内区切行（第2处） | 同上兜底追加 | 不改 |
| 4236 | editingEl | interaction | onKeyDown Enter 容器切行收尾 | 非容器本体的行宿主补占位 | 不改 |
| 4242 | editingEl | interaction | onKeyDown Enter 叶块中间/块首 | 块末判定路由劈块；此处必为叶块，交互块=存储块重合 | 不改（列表/容器已被前面分支截走） |
| 4249 | editingEl | interaction | onKeyDown Enter toggle 体内末块退出 U7 | 存储作用域推导（details 域） | 不改 |
| 4252 | editingEl | interaction | onKeyDown Enter U7 末块判定（第1处） | editingEl 当 blocksInScope 成员做末块判定——存储序成员 | 不改 |
| 4252 | editingEl | interaction | onKeyDown Enter U7 末块判定（第2处） | 空块判定 | 不改 |
| 4254 | editingEl | interaction | onKeyDown Enter U7 删空末块 | 整块删除对象（存储级，此处必为叶块） | 不改 |
| 4263 | editingEl | interaction | onKeyDown Enter 段末新建 | 段末回车在存储块后插新块——存储落点（列表已被截走） | 不改 |
| 4269 | editingEl | ce-host | onKeyDown 灰选表 Enter/↓ gate | 非编辑态守卫 | 不改 |
| 4269 | selectedEl | guard | onKeyDown 灰选表 Enter/↓（第1处） | null 守卫 | 不改 |
| 4269 | selectedEl | graysel-agnostic | onKeyDown 灰选表 Enter/↓（第2处） | 就地类型判定，不依赖父级/顶层身份 | 不改 |
| 4272 | selectedEl | graysel-agnostic | onKeyDown 灰选表 Enter/↓ 进首格 | 对表块取首格，无顶层假设 | 不改 |
| 4278 | editingEl | ce-host | onKeyDown 灰选 Enter 插段 gate | 非编辑态守卫 | 不改 |
| 4278 | selectedEl | guard | onKeyDown 灰选 Enter 插段 gate | null 守卫 | 不改 |
| 4281 | selectedEl | graysel-assumes-top | onKeyDown 灰选 Enter 插段 | 在其后插 <p>——selectedEl 若是 li 会把 p 塞进 ul 非法嵌套，隐含 scope 级块假设 | A1 行级灰选时 Enter 应插同级新 li（或按对拍定），插段逻辑需按 iblock 类型分派 |
| 4287 | editingEl | ce-host | onKeyDown Tab gate | 编辑态存在性守卫 | 不改 |
| 4308 | editingEl | interaction | onKeyDown 行中 Tab=两空格 gate | 行宿主推导——tabLineHostOf 是又一个手写行级原语 | A1 由 iblockOf 吸收 tabLineHostOf |
| 4320 | editingEl | interaction | onKeyDown Tab 非列表路由 | 按宿主类型路由缩进语义 | 保留宿主判或改 iblock 判——列表侧已行级实现 |
| 4323 | editingEl | interaction | onKeyDown Tab 非列表·toggle 协调 | 存储作用域推导 | 不改 |
| 4324 | editingEl | interaction | onKeyDown Tab 非列表 indentable 判定 | 类型定 indentable——整块缩进语义作用于存储块 | 不改（ws-indent 是顶层块属性） |
| 4325 | editingEl | interaction | onKeyDown Tab 非列表 indentable 判定 | callout 判 indentable（整块） | open: callout 内 Tab 缩整框还是框内行，按对拍定 |
| 4330 | editingEl | interaction | onKeyDown Shift-Tab 出 toggle | 整块移出 details——存储级 reparent | 不改 |
| 4332 | editingEl | interaction | onKeyDown Shift-Tab 出 toggle | 缩进档剥除作用于存储块 | 不改 |
| 4335 | editingEl | ce-host | onKeyDown Shift-Tab 出 toggle | reparent 后重挂 ce 宿主 | 不改 |
| 4339 | editingEl | interaction | onKeyDown Shift-Tab 顶层减档 | 整块缩进档位读取（存储块属性） | 不改 |
| 4341 | editingEl | interaction | onKeyDown Shift-Tab 顶层减档 | 整块缩进写档 | 不改 |
| 4345 | editingEl | interaction | onKeyDown Tab 进前一 toggle | 存储兄弟导航找前一 details（嵌入手术） | 不改 |
| 4349 | editingEl | interaction | onKeyDown Tab 进前一 toggle | 整块嵌入 details 体——存储级 reparent | 不改 |
| 4350 | editingEl | interaction | onKeyDown Tab 进前一 toggle | 进 toggle 剥缩进（存储块属性） | 不改 |
| 4353 | editingEl | ce-host | onKeyDown Tab 进前一 toggle | 重挂 ce 宿主 | 不改 |
| 4358 | editingEl | interaction | onKeyDown Tab 顶层整块缩进 | topBlocks 索引算缩进上限——存储序成员 | 不改（缩进上限本就按顶层序） |
| 4359 | editingEl | interaction | onKeyDown Tab 顶层整块缩进 | 整块档位读取 | 不改 |
| 4362 | editingEl | interaction | onKeyDown Tab 顶层整块缩进 | 整块写档 | 不改 |
| 4370 | editingEl | interaction | onKeyDown Tab 列表 U1 多选 | 以存储容器枚举全部行（含嵌套）做目标行筛选 | A1 可由『存储块→交互块列表』原语供给，语义不变 |
| 4375 | editingEl | interaction | onKeyDown Tab 列表折叠光标 | 行归属校验（li 在本列表内） | A1 改 iblockOf(光标) 直接取行+比 storage 块 |
| 4439 | editingEl | ce-host | onKeyDown Backspace 块首分支入口 | 判「在编辑中」的存在性守卫 | 不改 |
| 4444 | editingEl | interaction | onKeyDown Backspace 容器段间合并 ADV-C2 | 按 ce 宿主类型分派行级（段间）合并行为 | 宿主类型分派保留；其后的行解析交给 iblockOf |
| 4445 | editingEl | interaction | onKeyDown Backspace 容器段间合并 ADV-C2 | 从 ce 宿主手工解析光标行宿主＝交互块 | A1 改 iblockOf(光标) 直取行块 |
| 4446 | editingEl | interaction | onKeyDown Backspace 容器段间合并 ADV-C2 | 判真落在子段（行宿主≠宿主本体） | iblockOf 后改判 iblock !== blockOf（或直接非空判） |
| 4463 | editingEl | storage | onKeyDown Backspace 容器段间合并·前行是裸行内 | 容器当父节点做段并入的结构手术 | 不改，存储容器手术 |
| 4472 | editingEl | interaction | onKeyDown Backspace 列表分支入口 | classify(editingEl) 决定行级（E1 剥离/嵌套合并）处理路径 | open: 保留宿主分派，或改判 iblockOf(光标) 是否 li |
| 4484 | editingEl | interaction | onKeyDown Backspace E1 顶层行剥离 | 「顶层行=ul 直接子」判据，是交互块=li 的手工实现 | A1 用 iblockOf 层级判据表达同一语义（iblockOf(cli)===cli 且 blockOf(cli)===editingEl） |
| 4486 | editingEl | storage | onKeyDown Backspace E1 顶层行剥离 | 劈列表容器手术的宿主参数（storage 侧） | 不改，turnIntoLines 继续吃存储块+行 |
| 4494 | editingEl | interaction | onKeyDown Backspace 空嵌套项分支 | 行归属校验（行落在本列表块内） | iblockOf 携带宿主关系后可收编 |
| 4494 | editingEl | interaction | onKeyDown Backspace 空嵌套项分支（同行第2处） | 嵌套行判据：非直接子＝非顶层行 | A1 后改用 blockOf/iblockOf 层级关系表达 |
| 4503 | editingEl | ce-host | onKeyDown Backspace 空嵌套项·有 prevLi | 重挂编辑态到宿主（ce 仍挂存储块） | 不改 |
| 4509 | editingEl | ce-host | onKeyDown Backspace 空嵌套项·U12 嵌套首空项 | 重挂编辑态到宿主 | 不改 |
| 4523 | editingEl | interaction | onKeyDown Backspace 嵌套非空行行首 | 行归属校验 | iblockOf 收编 |
| 4523 | editingEl | interaction | onKeyDown Backspace 嵌套非空行行首（同行第2处） | 嵌套行判据（非直接子） | A1 后用层级 API 表达 |
| 4538 | editingEl | ce-host | onKeyDown Backspace 嵌套非空行合并收尾 | 重挂编辑态（enterEdit 会重置选区） | 不改 |
| 4544 | editingEl | storage | onKeyDown Backspace 通用块合并 | 对存储块整体判块首，是跨块合并的前置条件 | 不改，合并落点=存储语义 |
| 4545 | editingEl | storage | onKeyDown Backspace 通用块合并 U6 | 求作用域根、定合并用的存储块表 | 不改 |
| 4547 | editingEl | storage | onKeyDown Backspace 通用块合并 | 在存储块表定位当前块（合并落点计算） | 不改 |
| 4553 | editingEl | storage | onKeyDown Backspace 通用块合并 | 当前存储块作为合并 donor／整删对象 | 不改 |
| 4685 | editingEl | ce-host | onKeyDown Delete 块末分支入口 | 判「在编辑中」的存在性守卫 | 不改 |
| 4689 | editingEl | interaction | onKeyDown Delete 列表分支 U7 | classify 决定行级前向合并路径 | open: 同 4472，可改判 iblockOf(光标) 是否 li |
| 4694 | editingEl | interaction | onKeyDown Delete 列表分支 U7 | 顶层 li 判据（行=ul 直接子），嵌套行交原生 | A1 用 iblockOf 层级判据表达 |
| 4712 | editingEl | storage | onKeyDown Delete 列表末项尾并下块 | 求作用域定存储块表 | 不改 |
| 4714 | editingEl | storage | onKeyDown Delete 列表末项尾并下块 | 取下一存储块作前向合并源 | 不改 |
| 4732 | editingEl | interaction | onKeyDown Delete 容器分支 | 宿主类型分派（容器末行/段间 Delete 自管） | 分派保留；行解析走 iblockOf |
| 4732 | editingEl | interaction | onKeyDown Delete 容器分支（同行第2处） | 同一类型分派的补判（排除单段叶子 callout） | 同上 |
| 4733 | editingEl | interaction | onKeyDown Delete 容器分支 | 求容器末行宿主（交互行） | A1 行级原语可直接给容器末 iblock |
| 4736 | editingEl | interaction | onKeyDown Delete 容器段间 ADV-C2 镜像 | 从宿主手工解析光标行宿主 | A1 改 iblockOf(光标) |
| 4737 | editingEl | interaction | onKeyDown Delete 容器段间 ADV-C2 镜像 | 行宿主≠宿主本体判据 | iblockOf 后改判 iblock !== blockOf |
| 4753 | editingEl | storage | onKeyDown Delete 容器末行并下块 | 求作用域定存储块表 | 不改 |
| 4755 | editingEl | storage | onKeyDown Delete 容器末行并下块 | 取下一存储块作合并源 | 不改 |
| 4759 | editingEl | storage | onKeyDown Delete 容器末行并下块 | 容器作为合并落点吃下一叶子块 | 不改 |
| 4766 | editingEl | storage | onKeyDown Delete 通用前向合并 | 对存储块整体判块末（合并前置条件） | 不改 |
| 4767 | editingEl | storage | onKeyDown Delete 通用前向合并 P1 | 作用域感知的存储块表 | 不改 |
| 4769 | editingEl | storage | onKeyDown Delete 通用前向合并 | 存储块表定位下一块 | 不改 |
| 4771 | editingEl | storage | onKeyDown Delete 通用前向合并 | 合并落点（next 并入 cur） | 不改 |
| 4818 | editingEl | ce-host | onKeyDown ←→ 跨块分支入口 | 在编辑中存在性守卫 | 不改 |
| 4822 | editingEl | storage | onKeyDown ←→ 跨块导航 | 跨 ce 宿主导航按存储块序；行内移动由原生光标覆盖 | 不改（A1 后 li 间移动仍在单宿主内原生完成） |
| 4824 | editingEl | storage | onKeyDown ←→ 跨块导航 | 存储块表定位 | 不改 |
| 4826 | editingEl | storage | onKeyDown ←→ 跨块导航 ArrowRight | 只在存储块边界接管，块内交原生 | 不改 |
| 4834 | editingEl | storage | onKeyDown ←→ 跨块导航 ArrowLeft | 存储块首判据 | 不改 |
| 4845 | editingEl | ce-host | onKeyDown ↑↓ 跨块分支入口 | 在编辑中存在性守卫 | 不改 |
| 4849 | editingEl | ce-host | onKeyDown ↑↓ 跨块导航 | 量编辑宿主几何判光标在首/末行 | 不改 |
| 4854 | editingEl | storage | onKeyDown ↑↓ 跨块导航 P2 | 作用域感知的存储块表 | 不改 |
| 4856 | editingEl | storage | onKeyDown ↑↓ 跨块导航 | 存储块表定位 | 不改 |
| 4897 | editingEl | ce-host | onKeyDown 灰选态方向键分支入口 | 非编辑态判定 | 不改 |
| 4897 | selectedEl | guard | onKeyDown 灰选态方向键分支入口 | null 守卫 | 不改 |
| 4901 | selectedEl | graysel-assumes-top | onKeyDown 灰选态方向键穿行 | topBlocks 里找 selectedEl；Esc① 灰选 LI 后按 ↓/→ 得 idx=-1，blocks[idx+1]=blocks[0] 跳回文档首块，↑/← 变 no-op | A1 必修：selectedEl 为 LI 时先按行序导航（前后兄弟 li）或 blockOf 上卷再走块序 |
| 4913 | editingEl | ce-host | onKeyDown Escape U3 行菜单退场 | 非编辑态判定 | 不改 |
| 4913 | selectedEl | guard | onKeyDown Escape U3 行菜单退场 | null 守卫 | 不改 |
| 4916 | editingEl | ce-host | onKeyDown Escape C9 第二级·段选中上卷 | 非编辑态判定 | 不改 |
| 4922 | editingEl | ce-host | onKeyDown Escape 编辑态分级 | 判「在编辑中」进入 Esc 第一级 | 不改 |
| 4925 | editingEl | interaction | onKeyDown Escape C9 第一级·容器段选中 | 宿主类型分派（容器内 Esc 选中当段） | 分派保留；行解析走 iblockOf |
| 4926 | editingEl | interaction | onKeyDown Escape C9 第一级·容器段选中 | 手工解析光标所在段＝交互块 | A1 改 iblockOf(光标) |
| 4927 | editingEl | interaction | onKeyDown Escape C9 第一级·容器段选中 | 首行域划分（首行给整框而非段选） | iblockOf 需携带「是否首行」域信息或保留此辅助 |
| 4928 | editingEl | interaction | onKeyDown Escape C9 第一级·容器段选中 | 行宿主≠宿主本体判据 | iblockOf 后简化 |
| 4929 | selectedEl | graysel-agnostic | onKeyDown Escape C9 段选中进场 | 清选中态赋值，无块形态假设（行模式不设 selectedEl 的既有原则） | 不改 |
| 4939 | editingEl | interaction | onKeyDown Escape 列表下钻当前行 | 以宿主为候选作用块再手工下钻——存储/交互错位病灶本灶（注释自证） | A1 改 el = iblockOf(光标)，整段下钻逻辑删除 |
| 4940 | editingEl | interaction | onKeyDown Escape 列表下钻当前行 | 列表宿主 tagName 硬编码判定 | iblockOf 收编后删除 |
| 4940 | editingEl | interaction | onKeyDown Escape 列表下钻当前行（同行第2处） | 同上 | 同上 |
| 4944 | editingEl | interaction | onKeyDown Escape 列表下钻当前行 | 行归属校验并选当前行为作用块 | iblockOf 收编 |
| 4948 | selectedEl | guard | onKeyDown Escape 灰选态分级 | null 守卫 | 不改 |
| 4950 | selectedEl | graysel-agnostic | onKeyDown Escape ② 行上卷整列表 | 显式分辨行/块，两形态都处理 | 不改 |
| 4950 | selectedEl | graysel-agnostic | onKeyDown Escape ② 行上卷整列表（同行第2处，blockOf 实参） | 已确认是 LI 才喂 blockOf 上卷，无顶层假设 | 不改 |
| 4950 | blockOf | storage | onKeyDown Escape ② 行上卷整列表 | 从交互行上卷到所属存储块（Esc 第二档=灰选整列表），求的就是顶层结构单元 | 不改，A1 后这正是 blockOf 的本职 |
| 4951 | selectedEl | graysel-agnostic | onKeyDown Escape ② 行上卷整列表 | 引用比较，无顶层假设 | 不改 |
| 4956 | selectedEl | guard | onKeyDown 段选中删除分支（rowSelEl 态） | null 守卫（确认无灰选） | 不改 |
| 4956 | editingEl | ce-host | onKeyDown 段选中删除分支（rowSelEl 态） | 非编辑态判定 | 不改 |
| 4962 | selectedEl | guard | onKeyDown 灰选删除分支 | null 守卫 | 不改 |
| 4962 | editingEl | ce-host | onKeyDown 灰选删除分支 | 非编辑态判定 | 不改 |
| 4964 | selectedEl | graysel-agnostic | onKeyDown 灰选删除分支 | 显式分辨行/块（注释点名 removeBlock 只认顶层块） | 不改 |
| 4964 | selectedEl | graysel-agnostic | onKeyDown 灰选删除分支（同行第2处） | 行走行级删除原语 | 不改 |
| 4964 | selectedEl | graysel-assumes-top | onKeyDown 灰选删除分支（同行第3处） | removeBlock 只认顶层块，当前靠 LI 分支挡住行；若来日交互块扩到容器子段进 selectedEl 会击穿 | A1 统一成按 iblockOf/blockOf 分派的单一删除原语，或给 removeBlock 加顶层断言 |
| 5032 | editingEl | ce-host | tryMarkdown 入口 | 在编辑中存在性守卫 | 不改 |
| 5032 | editingEl | interaction | tryMarkdown 入口（同行第2处） | 只在正文块触发的类型分派 | open: A1 后 li 内敲 marker 是否按 iblockOf 扩展行级触发，待对拍 Notion |
| 5033 | editingEl | interaction | tryMarkdown marker 匹配 | 读作用块内容匹配 marker（叶子 p：storage==interaction 重合） | 不改 |
| 5038 | editingEl | interaction | tryMarkdown SW-A --- 转 hr | 块首文本节点守卫（防误转） | 不改 |
| 5045 | editingEl | interaction | tryMarkdown SW-A --- 转 hr | 整块替换（turnInto 同族；叶子块两义重合） | 不改 |
| 5064 | editingEl | interaction | tryMarkdown U18 守卫 | marker 须在块首文本节点的守卫 | 不改 |
| 5078 | editingEl | interaction | tryMarkdown 转换执行 | 清 marker（作用块内容手术） | 不改 |
| 5080 | editingEl | interaction | tryMarkdown 转换执行 | turnInto 对象（叶子 p 两义重合） | 不改 |
| 5180 | selectedEl | guard | onCopy ① 灰选整块复制 | null 守卫 | 不改 |
| 5181 | selectedEl | graysel-assumes-top | onCopy ① 灰选整块复制 | 块级 CLIP 载荷隐含 selectedEl 是自足顶层块；Esc① 灰选 LI 后 ⌘C 载荷是裸 <li>，丢列表类型/勾选语义，块粘路径能否兜住未证 | open: LI 时应打包成携带列表 tagName/class 的单项列表（对齐 U3/clip-1 的行级打包） |
| 5183 | selectedEl | graysel-agnostic | onCopy ① 灰选整块复制·纯文本 | 标签分派，LI 走 else 文本分支无碍 | 不改 |
| 5184 | selectedEl | graysel-agnostic | onCopy ① 灰选整块复制·TSV | 仅 TABLE 分支内使用 | 不改 |
| 5185 | selectedEl | graysel-agnostic | onCopy ① 灰选整块复制·纯文本兜底 | textContent 对 LI 同样正确 | 不改 |
| 5190 | blockOf | dual | onCopy 选区端点解析 | 同一结果既做行内/块级分派与 sameBlock 判定（交互义，UL 时还得 5208-5225 手工 topLiIn 下钻补行层）又做 ③ 顶层打包定位（存储义） | 拆两层：iblockOf 判 sameBlock/行内（单 li 内=行内、跨 li=块级打包），blockOf/topScopeOf 只管 ③ 打包边界；手工 UL 下钻可删 |
| 5190 | blockOf | dual | onCopy 选区端点解析（同行第2处） | 同 sBlk：一次调用同时服务交互分派与存储打包 | 同上 |
| 5318 | editingEl | ce-host | insertBlocksAtCaret 落点分支（第 1 处：存在性判定） | 判「在编辑中」选粘贴落点分支 | 不改 |
| 5318 | editingEl | interaction | insertBlocksAtCaret 空正文块分支（第 2 处：classify） | classify 决定空块整换行为；editingEl 恒为存储块（CE 宿主），A1 不变 | 不改——空块整换语义针对宿主块本身 |
| 5318 | editingEl | interaction | insertBlocksAtCaret 空正文块分支（第 3 处：textContent） | 读宿主块内容判空，决定整换 | 不改 |
| 5319 | editingEl | interaction | insertBlocksAtCaret 空正文块整换 | editingEl 当被整块替换的对象（作用块） | 不改——替换对象就是 CE 宿主 |
| 5320 | editingEl | ce-host | insertBlocksAtCaret 非空编辑块分支入口 | 判「在编辑中」 | 不改 |
| 5321 | editingEl | interaction | insertBlocksAtCaret 块首判定（第 1 处） | 光标在宿主块首→整批插前；判定锚在存储块 | open: 列表编辑态中块级粘贴是否要按光标行劈列表落位（现按整 ul 块首/块末），按 plan 拍板 |
| 5321 | editingEl | interaction | insertBlocksAtCaret 块首插入 anchor（第 2 处） | 存储级兄弟插入 anchor；editingEl 恒为顶层/作用域块，before 合法 | 不改（与 5321 第 1 处的 open 联动） |
| 5322 | editingEl | interaction | insertBlocksAtCaret 块末判定（第 1 处） | 光标在宿主块末→整批插后 | 不改（同 5321 open） |
| 5322 | editingEl | interaction | insertBlocksAtCaret 块末插入 anchor（第 2 处） | 存储级兄弟插入 anchor | 不改 |
| 5323 | editingEl | interaction | insertBlocksAtCaret 块中劈开分支 | splitBlock（存储手术）后前半当落点 anchor | 不改——劈块是存储级操作 |
| 5324 | selectedEl | guard | insertBlocksAtCaret 灰选落点分支（第 1 处：存在判） | null 守卫 | 不改 |
| 5324 | selectedEl | graysel-assumes-top | insertBlocksAtCaret 灰选落点分支（第 2 处：after） | 把顶层块 frag 插为 selectedEl 兄弟——隐含它是顶层槽位；A1 行灰选 selectedEl=li 时会把 p/ul 塞进 ul 内=非法嵌套→整篇降级 | A1 后分流：selectedEl 是行（li/框内 p）时上卷所属存储块再 after，或按行劈列表插入 |
| 5336 | editingEl | ce-host | onPaste 矩形 TSV 铺格前置门 | 判「不在编辑中」才走矩形铺格 | 不改 |
| 5407 | editingEl | ce-host | onPaste 内部富粘贴 行内模式门（第 1 处） | 行内粘贴需在编辑态 | 不改 |
| 5407 | editingEl | interaction | onPaste 内部富粘贴 行内模式门（第 2 处） | 按宿主块类型分流（details 不接行内粘贴） | 不改——判定针对 CE 宿主本身 |
| 5417 | editingEl | guard | onPaste 同类列表并入判定 sameListType（第 1 处） | null 守卫 | 不改 |
| 5417 | editingEl | interaction | onPaste sameListType（第 2 处：tagName 比对） | 容器级类型比对决定逐项并入；A1 后仍是容器级判定 | 不改 |
| 5417 | editingEl | interaction | onPaste sameListType（第 3 处：ws-todo 比对） | todo 语义一致性判定（容器级） | 不改 |
| 5418 | editingEl | guard | onPaste 列表并入总门（第 1 处） | null 守卫（与 5417 重复） | 不改 |
| 5418 | editingEl | interaction | onPaste 列表并入总门（第 2 处：classify） | classify 决定走「逐项并入」还是块级插入 | 不改——并入手术本就在容器上做 |
| 5423 | editingEl | interaction | onPaste 列表并入 光标行归属校验 | 校验 closest('li') 取到的行属于编辑容器（行单元契约形态②豁免） | A1 后可换 iblockOf 直取光标行，contains 校验可并入原语 |
| 5425 | editingEl | interaction | onPaste 列表并入后注样式 | 对编辑容器判 todo/callout 等语义样式注入（容器级） | 不改 |
| 5433 | editingEl | ce-host | onPaste 行内哨兵兜底 | 判在编辑态才行内插入 | 不改 |
| 5451 | editingEl | interaction | onPaste 纯图剪贴板 图片插入 anchor | editingEl 当 insertImages 落点 anchor；恒为存储块，anchor.after(figure) 合法 | 不改（selectedEl 半边另账，见同行） |
| 5451 | selectedEl | graysel-assumes-top | onPaste 纯图剪贴板 图片插入 anchor | anchor 喂 insertImages 后 anchor.after(figure)——隐含顶层兄弟位；A1 行灰选 li 当 anchor 会把 figure 插进 ul 内=非法 | A1 后 selectedEl 是行时上卷存储块（或劈列表）再当 anchor |
| 5463 | editingEl | ce-host | onPaste 纯文本多行 bug2 分支入口 | 无编辑态先设法 enterEdit | 不改 |
| 5465 | blockOf | storage | onPaste 纯文本多行 bug2 分支（从选区推目标块） | 结果经 isEditableEl 后喂 enterEdit 当 CE 宿主——宿主恒为存储块（列表=整 ul），A1 后不变 | 不改，继续 blockOf；行内光标定位由 enterEdit 的 caret 逻辑管 |
| 5466 | selectedEl | guard | onPaste bug2 分支 目标块推导（第 1 处：存在判） | null 守卫 | 不改 |
| 5466 | selectedEl | graysel-assumes-top | onPaste bug2 分支 目标块推导（第 2 处：isEditableEl） | isEditableEl 只认块级标签（classify(LI)='other'→false）：A1 行灰选下该分支恒失效，多行粘贴退化到 fromSel 兜底甚至静默无操作（灰选态常无选区） | A1 后行灰选时 enterEdit(所属存储块) 并把光标定位到该行，或让 isEditableEl/enterEdit 认行单元 |
| 5466 | selectedEl | graysel-assumes-top | onPaste bug2 分支 目标块推导（第 3 处：当 tgt 值） | 值直接当 enterEdit(tgt) 宿主——enterEdit 会把 contenteditable 挂上去，隐含它是可挂 CE 的存储块 | 同上：行→上卷存储块再 enterEdit |
| 5470 | editingEl | ce-host | onPaste 无宿主/summary 合成单行门（第 1 处） | 判 enterEdit 是否成功（在编辑中） | 不改 |
| 5470 | editingEl | interaction | onPaste 无宿主/summary 合成单行门（第 2 处） | 按宿主类型分流：summary 放不下多行 | 不改——宿主级判定 |
| 5477 | editingEl | interaction | onPaste U22 todo 识别 目标类型判定 | classify 决定 todo 粘贴路径（容器级） | 不改 |
| 5478 | editingEl | interaction | onPaste U22 todo 识别 目标类型判定 | todo 语义判定（容器级） | 不改 |
| 5486 | editingEl | interaction | onPaste U22 todo 逐行建 li 光标行归属校验 | closest('li') 行归属编辑容器校验（形态②豁免） | A1 后可换 iblockOf 直取光标行 |
| 5512 | editingEl | interaction | onPaste bug2 列表逐行建 li 路径门 | classify 决定「同 ul 内逐行建 li、绝不建新 ul」路径 | 不改——手术在容器内做，行由 closest 解析 |
| 5516 | editingEl | interaction | onPaste bug2 列表逐行建 li 光标行归属校验 | 行归属编辑容器校验（形态②豁免） | A1 后可换 iblockOf 直取光标行 |
| 5529 | editingEl | interaction | onPaste ADV-C3 多段容器逐行建 p 路径门 | 容器级分流；行级由 caretLineHostIn 承担——已是 A1 行单元层形态 | 不改 |
| 5532 | editingEl | interaction | onPaste 多段容器分支 光标行宿主解析 | 容器内行解析（行单元层原语）——A1 后此类 helper 大半并入 iblockOf | A1 落地后 caretLineHostIn 语义并入行块身份，此处随原语收编 |
| 5533 | editingEl | interaction | onPaste 多段容器分支 裸行内区判定 | 行宿主=容器本身 → 裸行内区（无 p 包装） | 不改 |
| 5541 | editingEl | interaction | onPaste 多段容器分支 裸行内区找首个 p | 容器直接子枚举（容器的行单元遍历，非 blockRoot.children） | 不改 |
| 5542 | editingEl | interaction | onPaste 多段容器分支 框内插段（第 1 处） | 在容器内按行插 p | 不改 |
| 5542 | editingEl | interaction | onPaste 多段容器分支 框内插段（第 2 处） | 容器末追加行 | 不改 |
| 5659 | blockOf | storage | rowDragOver 行拖拽目标解析 | 拿的是列表容器供 resolveDrop 枚举行/算深度/劈容器；行级已由 rowOf 内部承担。非列表目标整块指示线也正确（列表行不能进 callout 体） | 不改——保持容器级 blockOf |
| 5679 | blockOf | storage | rowDrop 行拖拽落点解析 | 同 5659：placeRow/dropAtDepth 的劈列表容器手术在容器上做；非列表旁拆单行列表也是存储级 before/after | 不改 |
| 5700 | blockOf | interaction | rowDrop 落位后重挂 hover 态 | hover/手柄锚定是交互层；现在靠 hoverEl(容器)+hoverRow(li) 双记账过渡 | A1 后 hover 交互单元统一为 iblockOf(dragFrom)=li 本身，hoverEl/hoverRow 双轨可合并 |
| 5722 | blockOf | dual | onDragOver 通用块拖拽（非行拖）指示线目标 | 同一结果既定指示线（交互：画在哪个单元）又是 drop 落点参照（存储：before/after 顶层插入）；目标是列表时 A1 语义应行级 | open: 拆开——iblockOf 定线+行级落点，块落进列表需劈容器（存储手术）；必须与 5780 同改（画=做同源铁律） |
| 5751 | blockOf | interaction | onImageDragStart 起拖源解析 | 拖拽作用单元解析；图片块交互单元≡存储单元（img/figure 恒顶层） | 语义归 iblockOf，但对 image 两者恒等——改不改无行为差 |
| 5780 | blockOf | dual | onDrop 通用块拖拽落点 | 同 5722：既是命中单元又是 el.before/el.after 的存储级插入参照；C11 已对多段容器手工下沉到框内 p（行级先例） | open: 与 5722 同拆——列表目标行级落点+劈容器，按 plan 拍板 |
| 5818 | blockOf | interaction | dropFileLink 链接落点宿主解析 | 落点=光标所在单元；列表时拿整 ul，还要 5833-5836 手工把落点收敛到末 li——正是行粒度缺失的补丁 | A1 后改 iblockOf 直接拿行（li/框内 p），5833 的 UL/OL 收敛补丁可删；需让 isEditableEl 认行单元（open） |
| 5916 | editingEl | ce-host | reset（undo/redo 重写 body 后清态） | 编辑态引用清理 | 不改 |
| 5916 | selectedEl | graysel-agnostic | reset（undo/redo 重写 body 后清态） | 清引用，对 selectedEl 是 li 还是顶层块无假设 | 不改 |
| 5941 | editingEl | ce-host | snapshotEdit（第 1 处：存在判） | 判在编辑中才产快照 | 不改 |
| 5941 | editingEl | ce-host | snapshotEdit（第 2 处：blockPathOf） | 记录 CE 宿主结构路径供 undo 后 restoreEdit；blockPathOf 是全层级下标路径，无顶层假设 | 不改；open: A1 若要恢复到行粒度需另记行路径（现 v1 取舍只到宿主+mode:end） |
| 5941 | editingEl | ce-host | snapshotEdit（第 3 处：id） | 宿主 id 锚点（跨 innerHTML 重写稳定） | 不改 |
| 5951 | blockOf | storage | restoreEdit cell 分支 TD 归属校验 | 校验候选 TD/TH 归属的顶层块确为 table（结构归属校验），随后 enterCell 管 cell 级 | 不改 |

## 结构假设（块=顶层直接子 的其他落点）

- **:620** hoverRow 声明：「块+行」双轨状态第一例——hoverEl 存 blockOf 产物、行级语义靠额外补一个 li 变量（非列表恒 null）。这是 iblockOf 缺位时的手工 workaround 模式；A1 落地后可评估让 hover 态直接存交互块、双轨合并。
- **:626** gripRow 声明（627 menuRow 同款）：手柄/菜单各自再补一个行作用域变量，与 gripEl/块菜单目标构成双轨。iblockOf 后是候选退役面——gripEl 直接锚交互块则 gripRow/menuRow 可消。
- **:826** setGutterVisible(false) 同清 gripEl+gripRow：双轨记账的配套清理点（「手柄不可见=没有作用对象」）。若 A1 合并双轨，此处随之简化为清单一变量。
- **:871** topBlocks() 定义本身：[...blockRoot.children].filter(非 data-ws2-ui) —— 「块=顶层直接子」的唯一权威枚举器，纯存储语义。A1 保留为存储层原语不动；它的消费点全在 880 行之后，由各段分账。
- **:879** 邻段提示：tabLineHostOf（883-892，在下一行段内）是 caret 驱动的 proto-iblockOf——classify==='list' 取 closest li、isMultiParaContainer 走 caretLineHostIn。A1 实现 iblockOf 时必须与它对表，避免仓里出现两套「交互行」推导口径。
- **:880** 注释提及 editingEl ×2（#406 容器化只下沉交互单元、editingEl 没动）——非代码引用，但它是 A1 的动机陈述
- **:881** 注释提及 editingEl ×1（拿 editingEl 判行首会失能）——非代码引用
- **:953** blocksInScope 定义：块=作用域根的直接元素子（排 UI/summary）——「块=直接子」的作用域版结构假设
- **:956** topScopeOf：parentElement===blockRoot 上卷到顶层块，跨作用域整删/顶层操作用——纯 storage 原语，A1 不动
- **:957** blockOf 定义本身（961-971：无 details 走 parentElement===blockRoot 扁平上卷；有 toggle 停在作用域根；summary→归属 details）。A1 保留为存储原语，iblockOf 另立
- **:974** 974-986 行单元解析层自我声明：rowOf/caretRowOf/topLiIn/tabLineHostOf/containerFirstLineHost/caretLineHostIn/paraOf/isRowAnchor/rowSelEl 是 A1 动工前的过渡垫层，A1 后大半并入块身份——本段的迁移地图正本
- **:1058** 注释提及 selectedEl ×1（行模式不设 selectedEl 原则）——非代码引用
- **:1059** 注释提及 selectedEl ×1（同上）——非代码引用
- **:1078** 注释提及 selectedEl ×1（键盘读 selectedEl 动整块 vs 手柄动一行的分家风险）——非代码引用
- **:1127** 注释提及 editingEl ×1（无 editingEl 的 homeless 选区）——非代码引用
- **:1146** 注释提及 editingEl ×1（列表的 editingEl 是整个 ul=存储单元）——非代码引用，editrow 层的病因陈述
- **:1176** 行尾注释提及 editingEl ×1（只有列表的 editingEl 是容器）——该行另有 2 处代码引用已入账
- **:1272** refreshRangeSel walk 遍历 blocksInScope(root)：块=作用域直接子，列表/toggle 部分覆盖再各自手工下沉（walkListRows/递归）——A1 后这套「容器命中再下钻」模式可由 iblock 遍历统一，但现行为已对齐 Notion
- **:1304** 注释提及 selectedEl ×1（gutterAnchor 排序）——非代码引用
- **:1349** 注释提及 editingEl ×1 + selectedEl ×1（cell 第四状态不设二者）——非代码引用
- **:1351** 注释提及 selectedEl ×1（永不允许是 TD/TH）——非代码引用
- **:1415** exitToNeighbor 用 topBlocks()/blocksInScope 做表界跳出导航：邻块是列表时 enterEdit(整列表)+placeCaret 下钻——A1 下落点语义应是「最近的行」，open
- **:1433** selectWholeDoc 用 [...body.children].filter(...) 手写一份顶层块集合（topBlocks 的重复实现，含 data-ws2-ui 过滤但无 SUMMARY 过滤）——顶层直接子假设 + 副本漂移风险
- **:1436** 注释提及 blockOf ×1（deleteSelection 用 blockOf(锚点) 找端块，body 层锚点=死键）——selectWholeDoc 锚点契约，A1 若 deleteSelection 改读行需同步这条不变式
- **:1456** placeCaret 对 UL/OL 下钻 querySelector('li')：「CE 宿主是容器、光标要进行」的补偿逻辑——A1 若编辑目标即行可直落，此分支收缩
- **:1683** insertAfter：refEl.after(el) 假设 refEl 是块级插入位；refEl 若是 li 会把 <p> 插进 ul=非合规。回退 blockRoot.appendChild 假设顶层。A1 需「行→存储插入位」换算（insertParaAtRow 是现成范本）
- **:1691** insertParaAtRow：行/存储双层各就其位的正面范本（交互按行定切点、存储劈 [前列表][p][后列表]）——A1 目标形态参考
- **:1713** insertBeforeBlock：同 1683，blockRoot.insertBefore(el, firstChild) 顶层假设
- **:1745** dropAnchor 遍历 topBlocks()：OS 拖放落点只认顶层块间缝，不能落列表行间——A1 下是否行级落点按 Notion 对拍定，open
- **:1806** 注释（非引用，grep 会命中）：「不设 editingEl/selectedEl——让块级破坏性键盘分支保持 inert」。这是刻意的第三种编辑态（captionEl 独立于 editingEl/cellEl），A1 改 ce 宿主层级时这套互斥前奏（exitCell/清 selectedEl）要一并核对。
- **:2103** turnIntoMany：`[...b.children].filter((c) => c.tagName === 'LI')` 数行——已是行粒度（li 级），A1 兼容，可作 iblockOf 落地后的对照样板。
- **:2122** removeBlock：`(scope === blockRoot) ? topBlocks() : blocksInScope(scope)` + L2123 `blocks.length <= 1` + L2130 `blocks.indexOf(el)`——整个函数假设入参 el 是作用域直接子块。A1 后若菜单删除传入 li，≤1 计数和 indexOf 全错（indexOf 得 -1；单行列表会被误判「只剩一块」retag 成 p 拍平整棵列表）。removeBlock 是 selectedEl 的典型消费方，A1 必须在入口把行单元与存储块分流。
- **:2311** deleteSelection 表格 ED-A2 分支：`blocksInScope(blockRoot).length === 0` 顶层计数消费（删空补 <p> 铁则）——块=顶层直接子假设，A1 后语义不变，不改。
- **:2348** deleteSelection 跨作用域分支：`tops = blocksInScope(blockRoot)` + topScopeOf 上卷 + indexOf——显式顶层化（storage 语义），配套 L2350。A1 不改。
- **:2356** 注释（非调用，grep 会命中）：「blockOf(summary)=details」——文档化了 blockOf 对 summary 的上卷契约（def 在 L970），A1 的 iblockOf 需明确 summary 的归属语义是否沿用。
- **:2380** 跨作用域中段整删：`if (m && m.parentElement === blockRoot) m.remove()`——parentElement===blockRoot 防御判据，块=顶层直接子假设（storage，删除手术，A1 不改）。
- **:2444** 同作用域管线整段（2444-2480）：blocksInScope + indexOf + canMerge 合并 + L2462 `sB.parentElement === eB.parentElement` + L2471 体内≥1 铁则 + L2475 rest 兜底锚——全部按作用域直接子块运算，是 storage 手术的主体；端点行级精度由 Range 裁剪与 fixEmptyList 保证。A1 整段不改。
- **:2454** 同作用域管线中段整删：`if (m && m.parentElement === scopeRoot) m.remove()`——同 2380 的 scoped 版。A1 不改。
- **:2519** selectedLeafBlocks/eachLeafBlockRange（2519-2565）用 fmt.nearestBlock 取 LI/P/TD 层叶子块——这是仓里已存在的一套「交互粒度」平行原语（2515 注释明说不能用顶层块）。A1 的 iblockOf 应考虑与 fmt.nearestBlock 收敛成一个正本，否则行单元判据出现两套。
- **:2554** eachLeafBlockRange：`[...b.children].find((c) => NESTED_BLOCK.has(c.tagName))`——把嵌套子块夹出内容区（行自己的内容 vs 肚子里的子列表），正是 A1「交互块 ≠ 存储块」要解决的形状，iblockOf 落地后此手工夹取可能收敛掉。
- **:2712** 注释行含 editingEl×2、selectedEl×1（「跨顶层块无条件逐块转」的历史说明），非代码引用；已计入符号总数对账（editingEl 11=8码+3注、selectedEl 5=3码+2注）
- **:2716** selectedTopBlocks() 消费点——跨块「转为」按顶层块集合逐块 turnIntoMany。「块=顶层直接子」口径；A1 下跨块转换的粒度（存储块整转 vs 逐交互行转，Notion 是逐行）待拍板
- **:2724** [...target.children].filter(c=>c.tagName==='LI') 以列表直接子 li 数判「整列表选中 vs 部分行」——行粒度判据内嵌在块路径里，A1 的 iblockOf/行集合原语可收编此特判
- **:2822** rowMode 判据 (row.tagName==='LI'&&classify(el)==='list')\|\|(row.tagName==='P'&&isMultiParaContainer(el)) 就是手写版「交互块定义」，与 A1 iblockOf 的定义逐字重合——首选收编点
- **:2825** 注释明文「塞 li 进 selectedEl 会让 Delete/removeBlock 的 topBlocks 计数按块语义误伤」——graysel-assumes-top 消费端的作者自证，正是 A1 要拆的两语义冲突现场（selectedEl 注释提及在 2824）
- **:2983** 注释提及 editingEl：cell 编辑态设计上不设 editingEl、exitEdit 对它空转，exitCell 才是收口——A1 迁移时 cell 通道与 editingEl 通道的互斥关系必须保持
- **:3162** blk.parentElement.clientWidth 隐含「顶层块的 parentElement=blockRoot 列容器」假设，拿它当图片缩放列宽上限
- **:3525** rowOf/paraOf（3525-3526）是 iblockOf 的手写前身（列表行/容器段推导）；3533 hoverEl(整块)/hoverRow(行) 双轨悬停态就是两种语义分裂的现场证据，A1 后可归一为单一 iblock 悬停锚。3522-3524 注释自证：拖拽/菜单仍以整块 hoverEl 为作用对象=A 阶段中间态
- **:3637** onClick 空白区文末续写消费 topBlocks()+末块 bottom+blockRoot 边界（3637-3644），『块=顶层直接子』——存储语义，A1 不改；3639 空文档 blockRoot.appendChild(p) 同属存储层
- **:3679** captionEl ↑↓ 导航：bs = topBlocks()/blocksInScope(3679) + indexOf±1(3680) + nextElementSibling/previousElementSibling DOM 步进(3681/3685)——键盘停靠按存储序走；A1 导航粒度下沉（列表逐行停靠）时要换成交互块序列
- **:3698** captionEl 空说明 Backspace 用 topBlocks()/blocksInScope + indexOf(fig)-1 找上一块（3698-3699）——同上存储序导航
- **:3729** selectedEl 注释提及（rectSel 方向键病灶说明）；3765 行尾注释『selectedEl 永不为 TD』同——selectedEl 计数 11 = 9 代码 + 这 2 处注释
- **:3935** summary Enter 用 [...det.children].find(≠SUMMARY) 取 details 首个体内块——『块=容器直接子』假设（scope 级），A1 不改
- **:3975** summary Backspace 用 blocksInScope(det) 枚举体内块判空 toggle——存储域消费，A1 不改
- **:4034** editingEl 注释提及（⌘A 列表三档说明），非代码引用；同类注释提及还有 4073/4114/4164——editingEl 计数 85 = 81 代码 + 这 4 处注释
- **:4251** U7 末块判定 blocksInScope(escScope) + bs[bs.length-1]——存储域序消费，A1 不改；4255 insertAfter(escScope,…) 落 details 外层同属存储层
- **:4357** 整块缩进上限：topBlocks() + indexOf + 前块 indentLevelOf（4357-4360）——缩进语义钉在顶层序上，A1 不改
- **:4416** 注释提及 editingEl（Tab 缩进 D3 注释「不是顶层 editingEl 的」），非代码引用，仅对账用
- **:4546** topBlocks()/blocksInScope 消费（Backspace 合并块表）——存储语义，A1 不改；同族还有 4713/4754/4768/4823/4855
- **:4828** aScope.nextElementSibling（toggle 体末跨界 fallback）：「下一块=details 的兄弟元素」假设——存储层成立，A1 不受影响；4860 同款
- **:4900** const blocks = topBlocks(); 灰选导航块表——与 4901 连坐：selectedEl=LI 不在此表内，是 graysel-assumes-top 雷的另一半
- **:4911** 注释提及 editingEl+selectedEl 各 1 次（Esc U3 注释），非代码引用，仅对账用
- **:4917** const co = rs0.parentElement; Esc C9 段选中上卷假设「段的父元素=容器块」——容器直接子 p 下成立；A1 若扩交互行形态需复查
- **:4924** 注释提及 selectedEl：「行模式不设 selectedEl（既有原则）」——A1 交互块选中态设计的关键既有约束，容器段选中走 data-ws2-selected 属性而非 selectedEl
- **:4936** 注释提及 editingEl：「列表的 editingEl 是整个 <ul>——那是存储单元」——A1 立论在代码里的原文出处
- **:5116** if (list === el)（plus「+」行插入）：「顶层行=父列表即宿主 ul」判据，与 4484/4694 同族的手工层级判据，iblockOf 层级 API 可收编
- **:5208** onCopy UL 分支 [...sBlk.children].filter(LI) + topLiIn 归一（5208-5214）：手工实现的交互层（行=直接子 li），正是 5190 blockOf dual 的补丁，A1 由 iblockOf 收编
- **:5245** onCopy ③ blocksInScope + topScopeOf + tops.indexOf（5245-5247）：纯存储打包路径，A1 不改
- **:5325** insertBlocksAtCaret 无 anchor 兜底 blockRoot.appendChild(frag)——顶层追加，存储级，A1 不改。
- **:5326** 粘贴收尾 selectBlock(last)：灰选最后插入的顶层块。A1 后若产物是列表，灰选整表还是末行待拍（selectBlock 机械挂 data-ws2-selected，接 li 也能跑，但语义要拍板）。
- **:5511** 注释里的 editingEl（「通用 splitBlock 按 editingEl.tagName=UL 建块」）——非代码引用，计数对账用：editingEl 42 处中 2 处为注释（5511/5526）。
- **:5526** 注释里的 editingEl（「splitBlock 会按 editingEl.tagName 克隆容器」）——非代码引用。
- **:5583** rowDepth 用 p !== blockRoot 当上界数 LI 祖先——行深度定义锚顶层，行级已建模，A1 友好，不改。
- **:5698** rowDrop 源列表掏空后 blocksInScope(srcScope).length===0 补空 p——作用域块计数（存储级），不改。
- **:5715** onDragOver OS 文件拖入走 dropAnchor(clientY)（5767 drop 同源）——dropAnchor 内部遍历 topBlocks() 几何，块=顶层直接子假设；图片块不能进 ul，大概率维持顶层粒度，open 记录即可。
- **:5726** C11 [...el.children].filter(tagName==='P')（5788 drop 侧同款）——多段容器直接子 p 枚举=容器行单元遍历，已是 A1 目标形态的先例。
- **:5821** dropFileLink 兜底 for (const b of topBlocks())——只扫顶层找最近可编辑块；列表命中整 ul 后靠 5833 收敛到末 li。A1 后可改行粒度扫描（与 5818 条目联动），open。
- **:5833** 落点落在 UL/OL 层时手工收敛到最后一个 li（5833-5836）——行粒度缺失的手工补丁，iblockOf 落地后应删（见 5818 条目）。
- **:5918** reset 里 blockRoot = pickBlockRoot(body) 重算存储根+重打 data-ws2-root——存储层自身，不涉块粒度。
- **:5961** restoreEdit 兜底 topBlocks().find(isEditableEl)——首个可编辑顶层块当打字宿主；enterEdit 宿主=存储块，A1 不改。
- **:5966** 注释里的 selectedEl（「原本手写 selectedEl \|\| hoverEl」漏迁史）——非代码引用，计数对账：selectedEl 8 处中 1 处为注释。
- **:6009** CSS [data-ws2-selected] 通用灰选描边：A1 行灰选若把该属性挂 li，规则直接生效，但外扩 6px 光晕在 4.8px 行距下会糊（rangesel 已在 6090 为 li 收窄到 1px）——li 灰选需同款收窄规则，open。
- **:6019** CSS 编辑底色已按双层拆好：data-ws2-editing 挂存储单元、行由 data-ws2-editrow 承载（6015-6030 注释即 A1 思想的 CSS 先行样板），A1 灰选/选中层可照此模式扩。

## 七段段评

**段1**：行段 1-879 是文件序幕（CSS 常量、attach() 状态声明、覆盖层节点、底层 helper），三个符号均无行为性调用点：blockOf( 出现 0 次（函数定义在 957），editingEl 4 处、selectedEl 3 处且全部是声明或注释。行段内 A1 真正相关的资产有二：①topBlocks() 定义（871）= 存储块唯一枚举器，A1 保留；②hoverRow/gripRow/menuRow「块+行」双轨状态变量群（620/626/627，配套清理点 826）——它们正是 iblockOf 缺位时的手工补丁模式，A1 后的候选合并/退役面。另外 879 行头注（tabLineHostOf）是「editingEl 粒度≠行」的现成书面证据，且 tabLineHostOf 本身是 proto-iblockOf，实现 A1 时需与其统一口径。grep 计数与逐条报告一致（0+4+3=7 条）。

**段2**：行段 880-1759 对账：blockOf( 共 7 处（5 处真实调用全部入账：1096 / 1198×2 / 1233×2，全为 storage 语义，A1 无需换 iblockOf；957 是定义、1436 是注释，入 extras）。editingEl 共 26 处（19 处代码入账：13 处 ce-host + 1 处 guard + 5 处 interaction；7 处注释入 extras）。interaction 类集中在两个补丁层：refreshEditRow（1175-1177，按 tagName 判「宿主是列表容器」再下沉行底色——正是 A1 要消灭的双语义补偿，A1 后可由 iblockOf 承担或整层退役）和两处几何回退（1124 fmtbar 粘住锚整 ul 盒、1477 滚动回退整 ul 盒，列表时块盒≠行盒）。selectedEl 共 20 处（14 处代码入账：11 处 graysel-agnostic + 2 处 guard + 1 处 graysel-assumes-top；6 处注释入 extras）。唯一 assumes-top 是 1117 的 isEditableEl(selectedEl)：classify 词表 LI→'other'，A1 若让行可灰选会误判不可编辑、气泡不弹。本段还含行单元解析层（974-1064）= A1 的过渡垫层自我声明，以及 6 处「块=顶层直接子」结构假设（walk/exitToNeighbor/selectWholeDoc/insertAfter/insertBeforeBlock/dropAnchor）入 extras。

**段3**：行段 1760-2640 对账完成：blockOf 9 处调用（另 1 处注释提及）、editingEl 9 处引用（另 1 处注释）、selectedEl 1 处引用（另 1 处注释），共 19 条入账，与 grep 计数一致。格局清晰：本行段是 deleteSelection/execText/turnIntoMany 等「跨块手术管线」腹地，blockOf 9 处中 7 处是纯 storage（块跨度枚举、整删、合并落点、ce 宿主切分），A1 后原样保留；只有 2 处 interaction（2161 表格格式化作用块识别、2577 openMention 菜单上下文）应改走 iblockOf。editingEl 大头是 ce-host（焦点/存在性守卫），真正要小心的是 2330 `editingEl === sBlk` 的 dual——ce 宿主身份与存储块身份恒等比对，A1 若把 ce 宿主下沉到行级这里会静默改变删除分流。selectedEl 仅 1 处清空（agnostic）。extras 里最重的是 2122 removeBlock：它按「入参=作用域直接子」计数/索引，A1 后喂 li 进去会把单行列表误判成末块 retag 拍平；以及 2519/2554 已存在的 nearestBlock 叶子块平行原语，iblockOf 应与之收敛避免两套行判据。文件未做任何修改。

**段4**：行段 2640–3519（文件 /Users/ctlandu/Documents/GitHub/wordspace-next-rowblock/src/editor/blockedit.js）对账：blockOf( 3 处、editingEl 11 处（代码 8+注释 3）、selectedEl 5 处（代码 3+注释 2），grep -o 计数与逐条清单一致、零漏。blockOf：2 storage（removeRow 收敛回编 2803、图片列宽 3161）+1 interaction（表格矩形选区 3455，表上两原语同值可平移 iblockOf）。editingEl：6 ce-host（守卫/卸载/提及锚点）+2 interaction（turn 菜单把它当作用块，2684/2711，A1 需改走 iblockOf 口径）。selectedEl：2 graysel-assumes-top（同在 turn 菜单路径，tagName 分支无 LI）+1 graysel-agnostic（openBlockMenu rowMode 清态 2826）。行段内没有 dual/unclear。重点发现：2822 的 rowMode 判据就是手写版交互块定义（iblockOf 首选收编点）；2825 注释作者自证了 selectedEl 塞 li 会被 removeBlock/topBlocks 块语义误伤——A1 拆分动机的现场证据；跨块「转为」粒度（2716 selectedTopBlocks 逐顶层块）是 A1 后的 open question。

**段5**：行段 3520-4400（onMouseMove 尾部/onMouseUp/onDocLeave/onClick/onKeyDown 至列表 Tab 缩进收尾）逐条分账完毕，与 grep 对账一致：blockOf( 7 处（3571 一行两处）、editingEl 85 处=81 代码引用+4 注释提及、selectedEl 11 处=9 代码引用+2 注释提及，代码引用全部入账（97 条）。blockOf：2 storage（3571 两处，enterEdit 宿主恢复必须继续 blockOf）、3 interaction（3521 悬停锚应改 iblockOf；3562/3626 表格校验两义重合）、2 dual 要拆（3633 onClick 同一结果既当 ce 宿主又当灰选对象；3676 caption 导航锚既喂存储序 indexOf 又服务键盘停靠）。editingEl：18 ce-host、1 guard、62 interaction——其中真正的 A1 改造点是三个手写行级原语（4200-4201 容器 lh 向上爬、4308 tabLineHostOf、3525 rowOf/paraOf 悬停侧）应并入 iblockOf，及 4 个 open 拍板点（3994 斜杠作用块、4012 ⌘⌥0-3 目标、4050/4054 callout ⌘A 分档、4325 callout Tab 粒度）；列表 Enter/Tab/⌘A 三档已是行级实现、以 editingEl 当存储容器锚，A1 语义不变。selectedEl：4 guard、2 graysel-agnostic、3 graysel-assumes-top（4101 removeBlock、4281 insertAfter 插 p、4012 turnInto 就地替换——行级灰选落地前这三处必须先给 li 分派行级语义）。

**段6**：行段 [4400,5280) 对账齐：blockOf( 3 处（4950 storage 行上卷、5190×2 dual 需拆）；editingEl 70 处=67 代码+3 注释；selectedEl 20 处=18 代码+2 注释，注释入 extras。格局：Backspace/Delete 合并路径的 editingEl 大头是存储义（scopeRootOf/indexOf/合并落点，A1 不动），列表/容器分支里的手工行解析（caretLineHostIn、cli.parentElement===editingEl、Esc 4939-4944 下钻段）是 iblockOf 的直接收编面。两颗真雷：① 4901 graysel-assumes-top——Esc① 灰选 LI 后按 ↓/→，blocks.indexOf(selectedEl)=-1 回卷 blocks[0] 跳文档首块（现状即可复现）；② 5181 灰选 LI ⌘C 打包出裸 <li> 的 CLIP 块载荷，丢列表类型/勾选语义（open）。5190 的 blockOf dual 已有 5208-5225 手工 UL 下钻当补丁，拆分后可删。4964 removeBlock 喂 selectedEl 靠 LI 分支挡住、暂安全但假设未设防。

**段7**：行段 5280-6168（至文件尾）对账完毕：blockOf( 共 9 处（全代码）、editingEl 共 42 处（40 代码 + 2 注释：5511/5526）、selectedEl 共 8 处（7 代码 + 1 注释：5966），代码引用 56 条全部入账。覆盖范围：insertBlocksAtCaret / onPaste（内部富粘贴、TSV、图片、纯文本多行、todo 识别、列表逐行、多段容器逐行）/ 行拖拽（rowDragOver/rowDrop/resolveDrop/placeRow）/ 通用块拖拽（onDragOver/onDrop）/ dropFileLink / reset / snapshotEdit / restoreEdit / EDITOR_CSS。要点：① blockOf 9 处里 4 处 storage（enterEdit 宿主推导 5465、行拖拽容器解析 5659/5679、restoreEdit 表归属 5951）可原样保留；2 处 dual（通用块拖拽 5722/5780——同一调用既定指示线又定落点，列表目标 A1 要行级+劈容器，两处必须同改）；5818 dropFileLink 是行粒度缺失的活证据（5833 手工收敛末 li 补丁）。② editingEl 无一处需要换成行单元——它恒为 CE 宿主（存储块），列表/容器分支的行级都已由 closest('li')/caretLineHostIn 内联解析（行单元契约形态②）；A1 主要收编这些内联解析而不动 editingEl 本身。③ selectedEl 是本段最大雷区：5324（selectedEl.after 插顶层块）、5451（图片 anchor）、5466×2（isEditableEl+enterEdit 链，classify(LI)='other' 会让分支恒失效→多行粘贴静默退化）共 4 处 graysel-assumes-top，A1 行灰选落地前必须逐处分流（行→上卷存储块或劈列表）。文件：/Users/ctlandu/Documents/GitHub/wordspace-next-rowblock/src/editor/blockedit.js（只读，未改动）。

