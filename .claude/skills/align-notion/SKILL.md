---
name: align-notion
description: 把真 app 的某个块/交互维度对齐到 Notion 的精细度（块粒度、悬停手感、菜单作用域这一层，不是功能有无）。双侧自动化取证 → 差异清单给 Colin 逐条 approve → 按单元实现 → 每单元出带双侧实机截图的 HTML 报告。用户说「对齐 Notion 的 X」「X 的粒度/手感跟 Notion 差在哪」「拿这套方法做 Y」时触发。
---

# align-notion — 与 Notion 的交互精细度对齐

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

**鼠标位置要标出来**：截图前往 iframe 里注入一个 `position:fixed` 的红圈标注指针位置、
截完删掉。没有这个标注，读者看不出「鼠标在哪」，截图就说明不了悬停类的事实。

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

## 技术坑清单（照抄可省几小时）

**ego-browser / Notion 侧**
- heredoc 里是 **ESM**：用 `await import('node:fs')`，`require` 会报模块格式冲突。
- `js()` 传含嵌套 `return` 的裸表达式会被自动包裹搞坏 → **一律显式 IIFE** `(() => {...})()`。
- **没有截图 helper**：用 `cdp('Page.captureScreenshot', { format:'png', clip:{...} })` 自己存盘。
- **`dragMouse` 太快，触发不了 Notion 的拖拽**：要裸 CDP `Input.dispatchMouseEvent`
  → `mousePressed` → 分步 `mouseMoved`（每步 ~150-180ms）→ `mouseReleased`。
- **悬停要有真实轨迹**：先移到别处再移入目标，直接跳到目标常常不触发 hover 态。
- **修饰键必须裸 CDP**：`pressKey('Shift+Tab')` 是假键，要
  `Input.dispatchKeyEvent` 带 `modifiers:8`（这条在 ego-browser 上栽过两次）。
- Notion DOM 锚点：todo 行 `.notion-to_do-block`、拖拽手柄 `svg.dragHandle`（浮动 overlay，
  不是每行常驻节点）、gutter 按钮读 `aria-label`（`Click to add below. Option-click…` /
  `Drag to move, click to open menu`——**这是最可靠的语义证据，比截图更硬**）。

**Wordspace 侧 / 通用**
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

## 已完成的样板（拿来当模板读）

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
