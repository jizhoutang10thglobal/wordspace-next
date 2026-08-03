# 编辑器 ⌘/Ctrl+A 分级全选 —— 对齐 spec

> 王波（Windows 用户）2026-07-17 反馈：「ctrl+A 不太好用，参考 md/Notion——一次选一段、两次选全篇。」
> 修前实锤：块编辑器每块独立 contentEditable，原生 Select All 被 Chromium 钉死在当前块内，
> 第 2/3 次按纹丝不动，**全篇用键盘永远选不到**；菜单「全选」（role selectAll）同样被钉。

## 行为契约（真 app · 块编辑器）

- **第 1 次** ⌘/Ctrl+A（编辑态）：全选**当前块**内文字。
- **第 2 次**（块内已全选，或空块第一次）：**全篇**——放墙退出编辑（同拖选跨块的 exitEdit 机制），
  跨块选区罩住首尾内容块；删除/剪切/复制走既有 homeless 跨块选区管线（Wendi Bug4/5/6 那套）。
- **第 3 次**：保持全篇，不折叠。
- **列表内多一档**（Colin 2026-07-23）：编辑列表时 `editingEl` = 整个 `<ul>/<ol>`，若直接套「一次选整块」，⌘A 一次就选中**全列表**、随手打字覆盖整份 checklist（丢数据级）。故列表内分三档——**① 选当前行 `<li>` 内容**（收缩到嵌套子列表之前，子列表各自独立、不算本行）→ **② 选整个 `<ul>/<ol>`** → **③ 全篇**。光标在嵌套子项时 ① 选该子项本行；行内容 = 整列表时（单项列表）跳过冗余的 ② 直接到全篇。非列表块维持两档。这是「存储单元（磁盘一个 canonical `<ul>`）与交互单元（编辑器 per-li）解耦」方案 B 的第 1 步（见 `docs/brainstorms/2026-07-23-todo-item-granularity-requirements.md`）。
- **非编辑态**（块选中/无输入焦点）按 ⌘A：直接全篇（Notion 同款）。
- 「块内已全选」判定剥空白比较（表格/列表 `sel.toString()` 带 `\t\n` 分隔而 textContent 没有，
  逐字比对会把第二级堵死）；IME 组字（`isComposing`/keyCode 229）不拦。
- **基础编辑器（非合规文档）不分级**：整篇单 contentEditable，原生 ⌘A 本来就是全篇，语义正确。

## 三个实现硬点（都实测踩过）

1. **菜单加速器吃键**：`role: 'selectAll'` 的默认加速器把 ⌘/Ctrl+A 吃在菜单层（mac/Win 同），编辑器
   keydown 永远收不到（U4 ⌘\ 同款血教训）。修：菜单项去 role 化——click 走
   `webContents.getFocusedWebContents().selectAll()`（行为等价，作用聚焦上下文：omnibox/网页 view/编辑器），
   **mac 不设 accelerator**（mac 忽略 `registerAccelerator:false`，设了必吃键 → 菜单项不显示 ⌘A，小代价）；
   Win/Linux `registerAccelerator:false` 保显示不注册。
2. **放墙甩焦点**：exitEdit 摘 contenteditable 会把键盘焦点甩出 iframe，全篇选完 Backspace 进不了
   编辑器 keydown（e2e 实锤）。修：焦点接盘 `focusCatcher`（sentinel `data-ws2-ui` 隐形 span，
   serialize 整删零入盘污染），**先 focus 再设 range**（顺序反了选区被 focus 冲掉）。
3. **全篇 range 的锚点形状**：`setStartBefore/After`（body 层锚点）会被 `deleteSelection` 的
   `blockOf(锚点)` 判「块外选区」直接 return false（全篇退格纹丝不动）。锚点必须放**首尾块内**
   （`setStart(首块,0)` / `setEnd(末块,childNodes.length)`），与拖选选区同形。

## ui-demo 有意分歧

ui-demo（`Canvas.tsx` ⌘A 分级）第二级到**块选中态**为止（单块），不到全篇——mock 每块孤立、无
homeless 跨块选区管线（当年注释明说「全文多块选中需多选基建，本期到块选中态为止」）。真 app 有
完整跨块基建，直达全篇（王波语义）。**记有意分歧、不算漂移**；ui-demo 若日后建多选基建再对齐。

## 跨块选区的块级高亮（Wendi 2026-07-22 bug5②）

拖选/⌘A 全篇跨 **≥2 个顶层块**时，选区罩住的每个块整行给蓝底（`data-ws2-rangesel` + CSS），并隐掉这些块内的
原生 `::selection`——对齐 Notion「哪几行都选中」，一眼看清选中范围。**单块内选区不标**（维持原生文字高亮）。
判定用 `onSelectionChange → refreshRangeSel`，块枚举与 `deleteSelection` 同套作用域感知逻辑
（`blockOf`/`scopeRootOf`/`topScopeOf`/`blocksInScope`）。纯 background/box-shadow、不用 padding/margin（不推文字）；
`data-ws2-rangesel` 进 `serialize.js` WS2_MARKERS 剥除，仅交互态、绝不入盘。⌘A 第二级全篇选中也走这条 → 全篇块整片蓝。

## 内部富复制粘贴（Wendi bug5①，Colin 2026-07-22 拍板）

复制粘贴保留格式，**但只对「本编辑器内部复制的内容」**——安全模型靠一个隐形哨兵 `data-ws2-clip`：

- **复制/剪切**（`onCopy`，挂 `copy` 事件；⌘X 经 keydown 里 `execCommand('copy')` 也走它）：把选中内容
  **清成本编辑器自己的、已合规 HTML**（复用 `serialize.cleanRoot` 剥编辑器标记，与存盘同一套白名单），
  打 `data-ws2-clip` 哨兵进剪贴板。三态：**行内**（选一段字，`="i"`，逐层裹回所在行内格式祖先 B/I/U/链接/颜色，
  否则 `cloneContents` 会丢 `<b>`）/ **块级**（跨块或整块选中，`="b"`，取选区罩住的**完整**顶层块，不部分裁剪 →
  每个剪贴板块都完整合规）/ **灰选中块**（图片等）。
- **粘贴**（`onPaste`）：剪贴板 HTML **带哨兵** → 保留格式；**不带哨兵**（Word/Notion/网页）→ **仍走原纯文本兜底**
  （ED-A4 合规红线不破，绝不让外部富文本污染文档）。内部内容粘贴时**再过一遍 `cleanRoot`**（纵深防御，不盲信剪贴板；
  ⚠ 先读哨兵值再清，因 `data-ws2-clip` 已进剥除白名单、cleanRoot 会把哨兵本身剥掉）。
- **落点语义**（Colin 拍板）：空正文块→整块替换；光标块首/块末→插前/插后；块中→`splitBlock` 劈开插中间；
  灰选中块→插其后。行内粘贴用手动 `range.insertNode`（`execCommand('insertHTML')` 在本 contenteditable 是哑 no-op）。
- 跨文档粘贴 `ensurePastedStyles` 把待办/callout/toggle 语义 CSS 注进目标文档 head（否则勾选框/折叠不渲染）。

## 文件映射与门

| 层 | 位置 |
|---|---|
| 分级逻辑 + 全篇选区 + 焦点接盘 | `src/editor/blockedit.js`（onKeyDown mod+A 分支 / `selectWholeDoc` / `focusCatcher`） |
| 跨块选区块级高亮 | `src/editor/blockedit.js`（`refreshRangeSel` / `onSelectionChange` / `data-ws2-rangesel` CSS）+ `src/editor/serialize.js` WS2_MARKERS |
| 内部富复制粘贴 | `src/editor/blockedit.js`（`onCopy` / `onPaste` 富分支 / `insertBlocksAtCaret` / `insertInlineAtCaret` / `ensurePastedStyles` / `data-ws2-clip`）+ `src/editor/serialize.js`（导出 `cleanRoot` + WS2_MARKERS 加 `data-ws2-clip`） |
| 菜单去 role 化 | `src/main/main.js` buildMenu 编辑菜单 |
| 门 | `e2e/app.spec.js` ED-SA（四段强断言）；`e2e/block-range-select.spec.js`（块级高亮）；`e2e/rich-paste.spec.js`（内部块/行内保留格式 + 外部无哨兵走纯文本[ED-A4] + 块中劈开 + 落盘无哨兵；合成 copy/paste 事件驱动，不赌 OS 剪贴板/xvfb）；`test/serialize.test.js`（rangesel + clip 剥除、cleanRoot 导出） |

## 欠账

- 全篇选中后的「格式气泡」不弹（拖选跨块会弹）——键盘全选通常接删除/复制，暂不弹；要对齐再补。
- Windows 真机键盘验证（王波是唯一 Windows 用户，CI xvfb 是 Linux；修复对 e.metaKey||e.ctrlKey 双查，理论全平台同路径）。
- ui-demo 跨块选区块级高亮 + 内部富复制粘贴均未做（其 Canvas.tsx 只有单块 `.ws-block-selected`、粘贴另一套）——后续对齐项。
- 内部富粘贴的图片/复杂结构块跨文档粘贴只注了待办/callout/toggle 样式；其它语义 CSS（颜色类等）依赖目标文档已有——极少数跨文档场景可能缺样式，后续可扩 `ensurePastedStyles`。
- 内部粘贴的 undo 粒度：splitBlock 自带一次 checkpoint + 外层再一次，块中粘贴可能是两步 undo（非阻塞，后续可收敛）。
