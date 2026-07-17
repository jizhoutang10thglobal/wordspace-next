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

## 文件映射与门

| 层 | 位置 |
|---|---|
| 分级逻辑 + 全篇选区 + 焦点接盘 | `src/editor/blockedit.js`（onKeyDown mod+A 分支 / `selectWholeDoc` / `focusCatcher`） |
| 菜单去 role 化 | `src/main/main.js` buildMenu 编辑菜单 |
| 门 | `e2e/app.spec.js` ED-SA（四段强断言：1 次=当前块文字、2 次=首尾块全进选区+已放墙、3 次=保持、全篇退格=内容真消失） |

## 欠账

- 全篇选中后的「格式气泡」不弹（拖选跨块会弹）——键盘全选通常接删除/复制，暂不弹；要对齐再补。
- Windows 真机键盘验证（王波是唯一 Windows 用户，CI xvfb 是 Linux；修复对 e.metaKey||e.ctrlKey 双查，理论全平台同路径）。
