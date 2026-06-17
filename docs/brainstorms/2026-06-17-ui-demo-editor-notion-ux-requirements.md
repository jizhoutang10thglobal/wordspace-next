---
date: 2026-06-17
topic: ui-demo-editor-notion-ux
---

# ui-demo 编辑区 UX 重设计：heyhtml 分块内核 + Notion 按需外壳

## Summary

把 ui-demo 编辑区从「顶部常驻工具栏」改成 Notion 式「零常驻 chrome、控件按需召唤」：格式工具只在选中时浮出，空白处走 `＋`/斜杠插入，文档级动作收进右上角 `···`+分享。编辑**内核**保留 heyhtml「分块制」（元素即离散可选块），但**渲染**按 Notion 极简——选中只给淡框 + 按需控件，不要缩放手柄/间距读数。

## Problem Frame

ui-demo 是 Colin + Wendi 讨论编辑器 UX 的设计参考（指导真 app）。此前 parallel session 把编辑区做成 heyhtml 画布版（运行在 localhost:5180），带固定顶部工具栏 + 元素选中后的八向缩放手柄/间距读数。Wendi 通话后 Colin 判断这套 chrome 太重、不够「文档」：常驻顶栏抢注意力，缩放手柄/间距让它像设计工具而非写文档的地方。要的是 Notion 那种——页面干净、写时无常驻 UI、工具按需出现。

但编辑的**内核**要保留 heyhtml 的分块制：把每个元素当成一个可整块选中/操作的对象。这跟 Notion 的纯文本流不同——Notion 里你只有文字光标和文字选区，不会把一个块当对象抓起来。目标是两者的混合：heyhtml 的「元素即对象」选择模型 + Notion 的按需极简外壳。

## Key Decisions

- **内核 = heyhtml 分块制，外壳 = Notion 按需 UX。** 元素是离散可选的「块对象」（点元素 = 选中整块，可对整块操作/转换/让 AI 重排）；但所有控件按 Notion 方式按需召唤，编辑面零常驻 chrome。
- **选中渲染走 Notion 极简，不要画布手柄。** 选中元素只给一个淡高亮框 + 按需浮出的控件；去掉 heyhtml 的八向缩放手柄和间距读数。正面后果：不写 `position`/尺寸 inline 样式 → 不破坏原 HTML 版面（保真）。
- **不做自由画布定位/缩放。** 维持文档式 WYSIWYG；元素留在文档流，不能拖到任意坐标、不能拽角缩放。
- **AI 入口摆位但 stub。** Ask AI（选中控件里）+ `/ai`（斜杠菜单里）都出现，点击 → 「开发中/即将上线」提示；不接真 AI，去掉常驻底部 AI 栏。
- **present 不做。** 维持所见即所得，无演示/阅读模式。
- **comment 不做。** 选中控件不含评论。
- **ui-demo 以本设计为准。** parallel session 的画布版 ui-demo 视为过时；本版做出来后，merge 时若更合需求则以本版为准。内核实现可参考画布版的分块思路，但成品归本分支。

## Requirements

**编辑内核与选中（分块制）**

R1. 点一个元素 → 该元素作为一个离散「块」被选中（整块，不是文字光标）；选中态以一个淡高亮框表示，不含缩放手柄、不含间距读数。
R2. 选中元素后可对整块操作：转换块类型、改格式、删除、复制、上下移、（将来）让 AI 重排该块。
R3. 双击元素进入文字编辑子模式：此时是文字光标 + 可选文字；Esc 或点别处退出，回到块选中态。
R4. 点页面空白处取消选中，不弹格式工具栏。
R5. 元素在文档流内排列；不支持自由坐标拖动或拽角缩放（见 Scope Boundaries）。

**按需控件（选中/格式）**

R6. 选中元素 / 选中文字时，格式控件**按需浮出**（贴近选区），不常驻。集合 = 转块类型 / 加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 链接 / 文字颜色 / 背景高亮 / Ask AI(stub)。**不含评论。**
R7. 控件在取消选中 / 点别处 / Esc 时消失。
R8. 编辑面无固定顶部工具栏、无常驻底部 AI 栏。

**插入（空白/斜杠/＋）**

R9. 空行显示淡提示「按 / 插入」；hover 块时左侧 gutter 出现 `＋`。
R10. 打 `/` 或点 `＋` → 弹「插入块」菜单（标题/列表/引用/分隔线/表格/图片/callout 等），实时筛选 + 键盘导航 + Esc 关。
R11. 斜杠菜单含 `/ai` 项，点击 → 「开发中」提示。

**块级 gutter（hover）**

R12. hover 块时左侧 gutter 出现 `⋮⋮` 拖拽手柄 + `＋`；`⋮⋮` 拖动可在文档流内重排块。
R13. 点 `⋮⋮` → 块操作菜单（转块 / 复制 / 删除 / 颜色），取代当前光秃秃的 `×` 删除按钮。

**文档级动作（右上）**

R14. 文档级动作收在右上角：一个 `···` 菜单（导出 PDF/Word/PPT、复制链接、重命名、删除、页面设置如字体/宽度）+ 一个分享按钮。编辑面内不出现这些。
R15. 导出走 demo 层 mock（不接真后端）。

**AI（stub）**

R16. Ask AI（选中控件）与 `/ai`（斜杠）都呈现为可见入口；点击任一 → 一个「此功能开发中 / 即将上线」的轻量提示 UI（modal 或 popover），不执行任何 AI、不改文档内容。

## Key Flows

F1. **选中并改一块。** Trigger：点一个段落/标题/列表块 → 淡框选中 → 按需浮出控件 → 点「转标题 2」/「加粗」等 → 该块即时变化。
F2. **改文字。** Trigger：双击块 → 进文字编辑 → 选一段文字 → 浮出 inline 控件（粗/斜/色/链接）→ 应用 → Esc 退出回块选中。
F3. **插入块。** Trigger：空行打 `/`（或点 `＋`）→ 弹插入菜单 → 选「表格」→ 表格块插入在当前位置、即可选中。
F4. **点 AI。** Trigger：选中控件点 Ask AI（或斜杠选 `/ai`）→ 弹「开发中」提示 → 关闭，文档不变。
F5. **文档动作。** Trigger：点右上 `···` → 展开导出/设置；点分享 → 分享弹窗。编辑面保持干净。

## Acceptance Examples

AE1. **Covers R1, R2.** 点正文段落 → 出现淡高亮框（无手柄）+ 浮出控件；点「转标题 3」→ 整段变 H3。
AE2. **Covers R4, R8.** 点页面任意空白 → 选中消失、控件消失；页面无任何常驻工具栏。
AE3. **Covers R10.** 空行打 `/标题` → 菜单筛到「标题」项 → Enter → 当前行变标题。
AE4. **Covers R16.** 选中一段文字点 Ask AI → 弹「开发中」提示；关闭后文字一字未变。
AE5. **Covers R5.** 选中一个元素 → 看不到拽角缩放手柄；想挪它只能经 `⋮⋮` 在文档流内重排，不会变成绝对定位漂浮。

## Scope Boundaries

**这次不做（维持文档式）：**
- 画布式自由定位 / 拽角缩放 / 间距读数手柄——元素留在文档流。
- present / 演示 / 阅读模式。
- comment 评论。
- 真 AI（stub 成「开发中」）、真导出后端（demo mock）。

**层级边界：**
- 只动 ui-demo（React 原型），不写真 app（`src/editor`）代码。这是设计探索，产出用来指导真 app。
- 真 app 的 F01 由 parallel session 按画布 plan 推进；本 ui-demo 的 UX 结论反哺其方向（需 Colin 在某点对齐两边）。

## Dependencies / Assumptions

- 内核分块制可参考 parallel session 画布版 ui-demo（localhost:5180 / 分支 `feat/heyhtml-canvas-editor`）的实现思路，但本版在独立分支 `feat/ui-demo-editor-notion-ux` 上做、且为准。
- 假设：「文档感 + 离散块对象」的混合可在**不写定位/尺寸样式**的前提下成立（选中 = 高亮框，而非带手柄的 bounding box）。

## Open Questions

**Deferred to Planning：**
- 选中态高亮框的具体呈现（整块描边 / 左侧条 / 背景），实现时定。
- 斜杠/插入菜单的完整块类型清单（先覆盖现有 + Notion 常见），细目实现时定。
- 块选中时格式控件的作用目标（整块 vs 块内文字），实现时定。

**协调（非阻塞）：**
- merge 时与 parallel session 的画布 ui-demo 二选一：以本版为准（若更合需求），Colin 拍板。

## Sources / Research

- Notion UX 调研提炼：memory `ui-demo-notion-redesign`（选区气泡 / 斜杠 / 左 gutter / 右上 `···`+Share / 零常驻 chrome 原则）。
- heyhtml 分块制内核参考：localhost:5180（画布版 ui-demo）、分支 `feat/heyhtml-canvas-editor`、heyhtml.com guide。
- 当前 ui-demo 现状（main 版，偏文本流）：`ui-demo/src/components/Canvas.tsx`、`ui-demo/src/components/canvas/FormatToolbar.tsx`、`ui-demo/src/components/canvas/DocMenu.tsx`、`ui-demo/src/components/TopActions.tsx`。
