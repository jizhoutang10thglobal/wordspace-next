# 编辑器 ⌘/Ctrl+A 分级全选 —— 对齐 spec

> 王波（Windows 用户）2026-07-17 反馈：「ctrl+A 不太好用，参考 md/Notion——一次选一段、两次选全篇。」
> 修前实锤：块编辑器每块独立 contentEditable，原生 Select All 被 Chromium 钉死在当前块内，
> 第 2/3 次按纹丝不动，**全篇用键盘永远选不到**；菜单「全选」（role selectAll）同样被钉。

## 行为契约（真 app · 块编辑器）

- **第 1 次** ⌘/Ctrl+A（编辑态）：全选**当前块**内文字。
- **第 2 次**（块内已全选，或空块第一次）：**全篇**——放墙退出编辑（同拖选跨块的 exitEdit 机制），
  跨块选区罩住首尾内容块；删除/剪切/复制走既有 homeless 跨块选区管线（Wendi Bug4/5/6 那套）。
- **第 3 次**：保持全篇，不折叠。
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

## 文件映射与门

| 层 | 位置 |
|---|---|
| 分级逻辑 + 全篇选区 + 焦点接盘 | `src/editor/blockedit.js`（onKeyDown mod+A 分支 / `selectWholeDoc` / `focusCatcher`） |
| 跨块选区块级高亮 | `src/editor/blockedit.js`（`refreshRangeSel` / `onSelectionChange` / `data-ws2-rangesel` CSS）+ `src/editor/serialize.js` WS2_MARKERS |
| 菜单去 role 化 | `src/main/main.js` buildMenu 编辑菜单 |
| 门 | `e2e/app.spec.js` ED-SA（四段强断言）；`e2e/block-range-select.spec.js`（块级高亮：读 computed background 真渲染蓝底 + 选区外不标 + 折叠清除 + 单块内不误标）；`test/serialize.test.js`（rangesel 剥除） |

## 欠账

- 全篇选中后的「格式气泡」不弹（拖选跨块会弹）——键盘全选通常接删除/复制，暂不弹；要对齐再补。
- Windows 真机键盘验证（王波是唯一 Windows 用户，CI xvfb 是 Linux；修复对 e.metaKey||e.ctrlKey 双查，理论全平台同路径）。
- ui-demo 跨块选区块级高亮未做（其 Canvas.tsx 也只有单块 `.ws-block-selected`）——后续对齐项。
- 复制粘贴保留块格式（Wendi bug5①）：现 onPaste 刻意只取纯文本（ED-A4 合规红线）；「内部复制保留格式」是产品决策+功能，待拍板，未做。
