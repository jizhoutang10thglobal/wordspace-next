---
name: align-notion
description: 把真 app 的某个块/交互维度对齐到 Notion 的精细度（块粒度、悬停手感、菜单作用域这一层，不是功能有无）。双侧自动化取证 → 差异清单给 Colin 逐条 approve → 按单元实现 → 每单元出带双侧实机截图的 HTML 报告。用户说「对齐 Notion 的 X」「X 的粒度/手感跟 Notion 差在哪」「拿这套方法做 Y」时触发。
---

# align-notion — 与 Notion 的交互精细度对齐

> v3（2026-08-04）：新增铁律 9/10（「Notion 是 X」要有原始读数、收尾必须复跑基线 claim），
> **更正了 v2 里关于键盘事件的那条**（CDP 键事件 Notion 根本不收），补齐拖拽的完整可用序列、
> 窗口可见性陷阱、哨兵自证协议，以及 Wordspace 侧六条新坑。

Wendi/Colin 2026-08-03 定的方向：对齐**不是**「Notion 有的功能我们也做一个」，而是
**UI/UX 精细度对齐**——同一个能力，交互的粒度和手感要一致。首个样板（todo 列表的
块粒度，U1-U4）已跑通，本 skill 是那套方法的固化，供后续维度（正文/标题/引用/callout/
toggle/表格/图片…）复用。

**只对拍 Wordspace 已有的能力。**（Colin 拍板）Notion 有而我们没有的块类型不在本 skill
范围内——那是 Feature Board 的排期问题，不是对齐问题。

## 心智模型（先读这段，否则容易做偏）

- **比较单位 = 可观察的交互事实**，不是像素。两边视觉本来就该不一样（我们有自己的
  「纸方墨圆」设计语言）。要对拍的是这种事实：「悬停第 3 行 → 手柄出现在第 3 行旁：是/否」
  「8 行的列表 → 独立手柄数：8 还是 1」「拖第 2 行到第 1 行上方 → 重排生效：是/否」。
  **永远不要做整屏像素 diff**。
- **产出是「差异清单」，不是「改好的代码」**。差异逐条列出 + 双侧截图 → Colin approve
  哪些要改、哪些登记为有意分歧 → 才动手。别自己替产品拍板。
- **Notion 是参照不是圣经**。抄的是粒度与手感，不是菜单项集、不是配色、不是每个默认值。
  拿不准就列成待拍板项。

## 阶段一 · 对拍取证

### Wordspace 侧（Playwright + 真 Electron）

在 `origin/main` 的临时 worktree 里写**探针 spec**（只记录、不断言——取证不是门）：

```bash
git worktree add <scratchpad>/wt-probe origin/main --detach
ln -s <某个已有 worktree>/node_modules <scratchpad>/wt-probe/node_modules   # 省一次 npm i
```

探针照仓内 e2e 惯用法写（`electron.launch` + `WS2_USERDATA` 隔离 + `open-file` IPC 开档），
把每个事实取成结构化 JSON（几何 / DOM 顺序 / 计数 / computed style）**并且截图**。
参考实现：`e2e/list-row-grip.spec.js` 的 `gripCenter()`/`bandOf()` 几何口径。

**鼠标位置要标出来**：截图前画个红圈标注指针位置、截完删掉。没有这个标注，读者看不出「鼠标在哪」，
截图就说明不了悬停类的事实。⚠ **红圈必须画在外层窗口文档，不能注进 iframe**——往 iframe 里注元素
会让编辑器把 `.ws-grip`/`.ws-plus` 藏掉（截出一排空 gutter 的假证据），更阴的是注入之后「+」点击
会变成 no-op，能让你把「功能没生效」当成结论报上去（实证踩过）。正确做法：拿 `#doc-frame` 的
boundingBox 把 iframe 内坐标换算成窗口坐标，在**外层** document 上画。

### Notion 侧（ego-browser + 裸 CDP + Notion MCP）

- **fixture 用 Notion MCP 的 API 造页**（`notion-create-pages`），别用自动化打字造内容——
  上一代 session 就是栽在输入法/斜杠菜单的输入模型上，成功率只有六成。
  已有可复用 fixture：`对拍fixture-todo`（三行 todo + 前后段落）。
- **观察型探针（悬停 / 点击 / 分步拖拽）稳定性 ~100%**，打字型仍脆——设计对拍清单时
  尽量把要验的事实做成观察型。
- 每条事实都要**结构化读数 + 截图**双证据。

## 阶段二 · 差异报告 → Colin approve

出一份 HTML 报告（Artifact 发布，格式见下），核心是一张**事实对照表**：每条事实、两侧
表现、判定（一致 / 差异 / 有意分歧）。然后把差异归成几个候选工作项，标上体量与依赖，
让 Colin 勾。**不要在这一步动代码。**

## 阶段三 · 按单元实现

Colin approve 后走 brainstorm → plan → 逐单元实现：

- **隔离 worktree + 长期分支**（Colin 硬要求）：所有粒度对齐的活在
  `wordspace-next-ux-align`（分支 `feat/ux-granularity`）这类隔离分支上打磨，**整体打磨完
  才谈合 main**；单元之间的中间态（如「手柄已经在行上、但菜单还是整块作用域」）允许存在
  于隔离分支，**绝不允许出现在 main**。
- **一个单元一个 commit + 一份报告**。单元要拆到 diff 小而可审。
- 每单元必做：针对性 e2e（强断言）→ **先 commit 再变异自检** → spec 同步 → 实机截图 →
  报告。少任何一条都不算完成。

## 阶段四 · 每单元的收尾报告（硬性格式）

用 Artifact 发布 HTML 报告，用仓库设计语言（stone 暖灰 + 墨青蓝 `#1D6FBF`，见
`docs/style.md`），截图 base64 内嵌（Artifact 的 CSP 禁外链）。结构：

1. 路线图条（A/B/C/D 哪些做完、这轮是哪个）
2. **效果三联：改前 → 改后 → Notion 目标**（或至少 改后 ↔ Notion 并排）
3. **与 Notion 的逐条对照表**（← 这一节是硬性的，见下方铁律）
4. 行为契约表（落地的语义，与 spec 同文）
5. 实现期踩的坑（给下一个模型看）
6. 验证清单（门数 / 变异画像 / 回归）
7. 下一步 + 待拍板项

## 铁律（血换的，逐条都有来源）

1. **每一个单元的报告都必须有 Notion 对照面。** Colin 2026-08-03 当场抓包：U1/U2 有对照、
   U3/U4 没有 =「你是不是偷懒了」。没有对照面，「对齐了没有」就成了实现者自说自话。
   补做 U4 对照后**当场抓到一处我们做错的语义**（见铁律 2），这就是代价。
2. **plan 里写「按 Notion 对拍结果定」的地方，必须真去对拍。** U4 的「+」在列表行上插什么，
   plan 明写「按对拍结果定」，我却按直觉写了「插同类型新行」——实测 Notion 是**插普通文本块**。
   凭直觉填对拍结论 = 把未验证的猜测当成了对齐结果。
3. **e2e 全绿 ≠ 视觉正确。** U1 首版几何断言全绿，实机截图一看手柄正压在勾选框上
   （勾选框画在行左缘外的 gutter 里，纯数值断言测不出压盖）。**每个单元都要人眼看实机截图**，
   而且截图必须自己 Read 过再放进报告。
4. **实机试玩抓到的 bug，自动化通常抓不到。** U1 两个真问题（手柄压勾选框、手柄「躲鼠标」）
   全是 Colin 手动试出来的。每单元交付后都要请他真机试。
5. **变异自检要看失败画像，不只看红。** 变异后应该**只有相关用例红**：U3 掐掉行来源 → 8 条
   行级红、块作用域那条绿，画像精准才说明门测的是对的东西。全红或全绿都可疑。
6. **门的测试点要选在「确凿命中坏区」的坐标上。** U1 的 gutter 回归门第一版把测试点猜在
   勾选框上，老代码也绿 = 哑门；改成用 `elementFromPoint` 扫描出确凿命中容器的坐标才有牙。
7. **别在本地跑全量 e2e。** 690+ 条真开 Electron 窗口、17-18 分钟闪屏，Colin 明令只在发版前跑。
   日常只跑受影响的 spec，全量交 CI（见 team-memory 2026-08-03 条）。
8. **改交互必同 PR 更新 `docs/features/<slug>.md`**（仓库铁律），并在 spec 里标注中间态。
9. **「Notion 是 X」这句话本身要有实证，不能只写结论。** 2026-08-04 复跑对拍抓到：上一批给嵌套编号
   加了 `ol ol`→lower-alpha / `ol ol ol`→lower-roman 的循环，理由写的是「对齐 Notion 实测的 1./a./i.」，
   但那其实是 **Word/Google Docs 的惯例**——Notion 每一层都是十进制（marker 字面值 `"1."/"2."/"3."`）。
   我们照着一个没量过的「常识」把自己改出了漂移，还写进了 spec 和门（门反着断言，把漂移钉成了正确）。
   **规矩**：凡是「因为 Notion 是 X，所以我们改成 X」的改动，报告里必须附上**那次测量的原始读数**
   （DOM 字面值 / aria-label / 截图），不能只写「实测如此」。审报告的人要能复核这个读数。
10. **收尾必须复跑对拍，而且要回去量「基线 claim」本身。** 直觉会以为「漂移只可能来自我们这侧，
   Notion 不动」——对，但**基线 claim 可能一开始就是错的**。所以复跑不是只验自己新改的，而是把
   本 track 里所有「因为 Notion…」的 claim 逐条重量一遍。2026-08-04 复跑 8 条，抓出 1 条自造漂移
   （见铁律 9）、1 条新分歧（折叠态下 summary 末 Enter：Notion 新建同级 toggle，我们自动展开插体内）。
   控制组很有用：挑几条**这轮没动过**的 claim 一起量，用来确认 Notion 自己没发版改行为。

## 技术坑清单（照抄可省几小时）

**ego-browser / Notion 侧**
- heredoc 里是 **ESM**：用 `await import('node:fs')`，`require` 会报模块格式冲突。
- `js()` 传含嵌套 `return` 的裸表达式会被自动包裹搞坏 → **一律显式 IIFE** `(() => {...})()`。
- **没有截图 helper**：用 `cdp('Page.captureScreenshot', { format:'png', clip:{...} })` 自己存盘。
- **Notion 拖拽的完整可用序列**（2026-08-04 真跑通，缺任一步都静默不触发）：
  ① 先用**无按键的 `mouseMoved`** 一路移向该行（几步），让手柄挂载出来；
  ② 读 `[aria-label^="Drag to move"]` 拿手柄坐标；③ `mousePressed`；
  ④ **先在原地附近走三小步（3px/8px/25px）越过拖拽阈值**，再分段移到落点，每步 ~200ms；
  ⑤ `mouseReleased`。一步到位、或先 `hover()` 再远距 `mousePressed`，都**不会**进入拖拽。
  拖拽中截图能拍到落点指示线（蓝线 + 左端圆点标层级 + 父行淡蓝底），是很好的证据。
- **Notion 落点缩进的参照系是「页面内容列左缘」**（顶层段落文字的起点），**不是列表行文字左缘**——
  列表行本身就比段落缩进一截，那是 marker 不是层级。约 26px 一级，且被「上一行深度+1」钳死
  （右移 220px 理论 8 级，实测仍只嵌 1 级）。这条只能真拖真量，推理推不出来。
- **悬停要有真实轨迹**：先移到别处再移入目标，直接跳到目标常常不触发 hover 态。
- **修饰键必须裸 CDP**：`pressKey('Shift+Tab')` 是假键，要
  `Input.dispatchKeyEvent` 带 `modifiers:8`（这条在 ego-browser 上栽过两次）。
- ⚠ **更正（2026-08-04 实测，推翻上一版这条）：CDP `Input.dispatchKeyEvent` 无论 `rawKeyDown` 还是
  `keyDown`，Notion 都完全无视**（Backspace/Delete 连按零反应）——它只认 ego-browser 的 `pressKey`。
  但 `Input.insertText` 是有效的，所以**「能插字」证明不了「能发键」**，拿插字做连通性探针 = 哑门。
- **Notion 的 caret 定位**：用 JS 设 DOM selection（`ce.focus()` + Range collapse）是有效的，
  但**每个新 tab 要先合成一次 `mousedown/mouseup/click` 把编辑器唤醒**（只做一次，位置无所谓）。
  ⚠ 合成鼠标**不会**移动 Notion 的内部光标，而且有时会让它进**块选中态**——这时 Backspace 删的是
  整块。我据此得出过「Notion 的退格把整行删了」这种完全错误的结论。
- **铁律级：哨兵自证协议。** 真按键前先 `typeText('¶')` 打一个哨兵，回读它落在哪个块、必须等于
  「¶+目标文字」，再退格清掉并确认清干净；**任一步不过就中止、绝不发真按键**。DOM selection 看起来
  对 ≠ Notion 内部光标在那儿（判别式：ArrowRight 推不动 offset、ArrowLeft 直接跳去页面标题）。
  写脚本时注意「中止后接着无条件发按键」这种低级错——我这么写过一次，把 Notion 页面的标题块删了。
- **Notion 首块行首退格 = 并入页面标题**（内容看着像丢了，其实在 title 里，别误报成 bug）。
- **读 marker 真值别靠截图猜**：Notion 的 marker 是 `<span class="pseudoBefore">`，字面值在内联
  自定义属性 `--pseudoBefore--content` 里（如 `"1."` / `"•"` / `"◦"` / `"▪"`）。这是最硬的证据，
  铁律 9 那次翻车就是靠它一锤定音。
- **Notion 块菜单渲染在页面左侧**（x 可能落在侧栏区），按「包含 Delete 的固定定位祖先」找容器会命中
  `body`；直接按菜单项文本命中拿坐标更稳。菜单开启本身约 1/3 失败率，要写重试。
- **打字型探针别把步骤串起来跑**：`End`+`Enter`+`typeText` 连打时 Enter 常来不及生效、文字灌进上一个
  块。每步之后读回状态确认再走下一步，慢但一次过。
- Notion DOM 锚点：todo 行 `.notion-to_do-block`、拖拽手柄 `svg.dragHandle`（浮动 overlay，
  不是每行常驻节点）、gutter 按钮读 `aria-label`（`Click to add below. Option-click…` /
  `Drag to move, click to open menu`——**这是最可靠的语义证据，比截图更硬**）。

**窗口可见性（2026-08-04 血亏半小时）**
- 浏览器窗口在后台（`document.visibilityState === 'hidden'`）时，**`click([x,y])` 静默失败**：
  helper 正常返回、光标一动不动，于是后续按键全落在**上一个**目标上，读出一串看起来完全合理、
  实则彻底错位的结论。`Page.bringToFront()` 拉不起来。
- **`Page.captureScreenshot` 在隐藏时照样能拍**（scale:2/3 都清晰），所以取证不受影响。
- 但**依赖 hover 才出现的 UI**（gutter 六点 / 「+」/ 落点指示线）在隐藏时唤不出——CDP `mouseMoved`、
  JS 合成 `MouseEvent` 都不行。这类必须请人把浏览器拉到前台再做。

**Wordspace 侧 / 通用**
- **别用 Playwright 真鼠标驱动块拖拽**：手柄走 HTML5 原生 DnD，`mouse.down()` 后 `mouse.move()` 会进
  drag loop 不返回、**把 Electron 卡死**（要按 PID 杀）。用合成 `DragEvent`（dragstart on `.ws-grip`
  → dragover/drop on target，带 `clientX/clientY` + `DataTransfer`），打的是同一套 handler。
  **但合成拖拽必须配正对照**（同类拖拽真重排 / 拖到段落旁真拆出），否则「零变更」这种读数分不清是
  真行为还是探针没打出去 = 哑探针。
- **`open-file` IPC 重放约 1/8 概率静默不生效**，后续所有 openDoc 全在旧文档上跑、产出错数据。每份
  fixture 带唯一哨兵 id + `expect(...).toBeVisible()` 校验，失败重发或重启 app。
- **悬停带嵌套子树的行**：元素几何中心落在**子列表**上，`locator.hover()` 会解析到嵌套行。要瞄父行
  自己那一行文字：`hover({ position: { x: 20, y: 8 } })`。
- **`pkill -f <worktree 名>` 不可靠且危险**：worktree 的 `node_modules` 常软链到别的 worktree，
  Electron 进程命令行写的是被软链指向的那个路径 → 按本 worktree 名匹配不到（却会误杀正在跑的
  测试，实测干掉过自己的 e2e）。要按 `node_modules/electron/dist/Electron.app` 真实路径匹配或记 PID。
- **dev 实例被 kill 后再启动秒退**：userData 里残留 `SingletonLock/Cookie/Socket` 指向死 PID，
  `requestSingleInstanceLock` 失败 → `app.quit()`（exit 0 无输出）。`rm Singleton*` 即愈。
- **深色模式主机上全量 e2e 恒有 3 条既有红**（`align.spec` T1/T2、`nonconform-basic-edit` T5）：
  这些 spec 把浅色 computed style 写死却不钉外观偏好，新 userData 默认「跟随系统」→ 深色必红；
  CI 是 Linux 浅色所以一直绿。**不是你改坏的**——遇到先在基线 commit 上复现确认。
- **交互态标记别塞进块级状态变量**：U3 里若把行作用域的目标 `<li>` 赋给 `selectedEl`（块灰选态），
  Delete 键与 `removeBlock` 的顶层块计数会按块语义误伤该行。行级状态要独立。
- **成对 UI 元素的显隐收成单一口子**：手柄的显隐散落 5 处，「+」若各管各的必漏一处 → 幽灵按钮。
  用 `setGutterVisible(show)` 这类单一出入口。
- **新增用户可见文案必须走 i18n 字典**（zh + en 双词条），硬编码中文会被 CJK 扫描门咬。
- **交互态标记：既不能写 inline style，也别写进正文 DOM。** 块级 `style` 属性 = 文档非合规
  （自动保存撞上就把整篇判降级）；写进正文的属性会被 undo 管理器记成**独立一步**，用户要按两次
  撤销才回得去（E5 就这么让既有门当场翻红）。挂到**文档根**上、用后代选择器，并加进 `WS2_MARKERS`。
- **修复/归一化逻辑只挂在「文档变脏」的出口上不够，必须同时挂 attach。** 否则**已经被写坏的老文档
  打开时不自愈**，用户得先敲一下才恢复正常——门会当场抓到（G1 一开始就是这么红的）。
- **别用正则批量替换改代码**：我用批量替换统一九处「关菜单」时，把 `closeSlash` **自己的函数体**
  也替换掉了，变成对自身的递归调用——所有斜杠路径静默全挂（菜单能弹、选完毫无反应）。
  批量替换后**必须跑一遍受影响的既有门**，靠它兜住。
- **断言「磁盘字节里不含某字符串」时只能查 `<body>` 段**：入盘的基线语义 CSS 本身就含 `font-family`
  等词，整篇查会恒真 = 哑断言。
- **Playwright 打中文走 `Input.insertText`、不产生 keydown**：任何依赖 keydown 累积的逻辑
  （斜杠菜单的 query）用中文测出来的都是假象，筛选类测试一律用 ASCII 词。
- **变异自检可能证明某条修复「在当前架构下不可观测」**——这时**如实标注**，别假装门咬得住。
  E5 的 `typed` 标志就是：去掉它七条门全绿（每块是独立 contenteditable，`selection.modify`
  跨不出块边界，多删那一下打在空气上）。留着它是为了架构变化后不变成丢数据 bug，但要写清楚
  「当前没有门能咬住这条」。

## 已完成的样板（拿来当模板读）

已跑过三个维度（都在分支 `feat/ux-granularity`）：**todo A-D**、**编号列表**（11 事实 7 同 4 修、
无待决项）、**无序列表**（14 事实 6 同 4 修 4 待拍板，含一个「行转为吞掉嵌套子项」的丢内容 bug）。
经验：**同类块常走同一套代码路径**（编号/无序与 todo 都是 `classify(el)==='list'`），先做的维度会自动
惠及后面的——但**必须实测确认、不能假设**，报告里写明「继承自 X 维度、已实测」。

todo 列表块粒度 A-D（2026-08-03，分支 `feat/ux-granularity`）：
- 对拍报告（7 条事实、2 同 5 异）：artifact `8b630c70`
- U1 行级手柄悬停跟随：`e2e/list-row-grip.spec.js`（7 条）
- U2 行级拖拽重排：`e2e/list-row-drag.spec.js`（9 条）
- U3 菜单行级作用域：`e2e/list-row-menu.spec.js`（9 条）
- U4 gutter「+」：`e2e/list-row-plus.spec.js`（8 条）
- 需求与计划：`docs/brainstorms/2026-08-03-ux-granularity-align-requirements.md`、
  `docs/plans/2026-08-03-002-feat-todo-row-granularity-plan.md`
- 契约落点：`docs/features/todo-list.md` 的「行级交互」各段

下一个维度照这套走：挑维度 → 建同构 fixture → 列事实清单 → 双侧取证 → 差异报告 →
Colin approve → 分单元实现 → 每单元报告（**带 Notion 对照面**）。
