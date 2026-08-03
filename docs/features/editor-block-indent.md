# 段落/标题整块缩进（Tab / Shift+Tab）—— 对齐 spec

> Track 2 方案 B（ws-indent-* 类原语），Colin 2026-07-24 拍板。
> 计划正本：`docs/plans/2026-07-24-002-feat-app-block-indent-ws-indent-plan.md`（§1 = 行为唯一真相源）。

## 行为契约

### 哪些块响应

- 响应整块缩进：段落 `<p>`、标题 `<h1>`–`<h4>`、引用 `<blockquote>`、callout `<div class="ws-callout">`。
- 不响应：列表（走既有 li 嵌套分支）、代码 `<pre>`、表格、图片、分隔线、toggle 容器（Tab 被吞、无动作——但⚠ 前兄弟是 toggle 时既有代码会嵌入**任何**可编辑块，无类型 gate，既有行为保持，别写成「一律 no-op」）。
- 只有**文字编辑态**响应；灰选中态、跨块选区、无编辑态不进此分支。

### 档位与封顶

- 档位 = 块上 class `ws-indent-1..6`，互斥（一块最多一个），0 档 = 无 class。每档 24px（整数像素）。
- **绝对封顶 6 档**（有限词汇上限，超过 6 的 class 永远不许产生）。
- **相对封顶（Notion 约束）**：`maxAllowed = 上一块档位 + 1`；首块 maxAllowed=0 永远缩不了；上一块是列表/图片/toggle 等无 class 块按 0 算。
- Tab：`next = min(cur+1, maxAllowed, 6)`——允许**向下归一化**（残留档位超 maxAllowed 时 Tab 拉回，非 no-op 非加档）。
- Shift+Tab：`next = max(0, cur-1)`；到 0 移除 class；0 档再按 = 静默 no-op。
- `next === cur` 时什么都不做（不打 checkpoint、不 markDirty）。
- 外部/AI 文档自带违反相对封顶的档位 → 照常渲染不主动纠正，仅当用户在该块按 Tab 时归一化。

### 键位优先级（toggle 协调）

- Tab：① 前兄弟是 `<details>` → 走既有 toggle 嵌套，并剥掉本块全部 ws-indent-*（结构嵌套取代数值缩进，防双偏移）；② 否则顶层 + indentable → 整块缩进；③ 否则 no-op。
- Shift+Tab：① 块在 toggle 体内 → 走既有出 toggle，并剥全部 ws-indent-*（出 toggle 归 0 档）；② 否则 indentable 且 cur>0 → 减一档；③ 否则 no-op。
- **toggle 体内不做缩进**（有意范围边界：体内 Shift+Tab 已被「出 toggle」占用，允许体内 Tab 缩进则减档无键可用）。

### 光标/选区

缩进与光标位置完全无关：段首/段中/段尾按 Tab 一律整块缩，光标绝不移动（实现只改 classList，不碰 Selection、不重建 DOM）。

### 生命周期

- 段末 Enter → 新块 0 档（不继承）；段中 Enter 劈块 → 后半继承同档。
- turn-into 转 p/h1–h4/blockquote → ws-indent 保留；转 callout/列表 → 被清掉（与 ws-color 同命运的既有机制，不修）。
- undo/redo 精确回滚 class；落盘 class 原样入盘 + `<style data-ws-schema-css="indent">` 随文件走。
- 外部/旧文档带 ws-indent-* 但 head 缺 CSS → attach 时自愈补注；跨文档粘贴 → ensurePastedStyles 探测补注。

### 交互状态矩阵

| 状态 | Tab | Shift+Tab |
|---|---|---|
| 编辑态 + 顶层普通块（indentable） | 缩一档（相对+绝对封顶） | 减一档 / 0 档 no-op |
| 编辑态 + 前兄弟是 toggle | 嵌入 toggle + 剥 ws-indent | —（按体内/顶层规则） |
| 编辑态 + toggle 体内 | no-op（前兄弟非 details 时） | 出 toggle + 剥 ws-indent |
| 编辑态 + list 块 | 既有 li 嵌套分支，不动 | 同 |
| 编辑态 + pre/table 等 | 不缩进（吞键，现状） | 同 |
| 灰选中态 / 跨块选区 / 无编辑态 | 不改现状（editingEl gate 天然跳过） | 同 |
| 首块 | 0 档 no-op；带残留档位 → Tab 归一化到 0 | 减档正常 |
| 封顶（相对或 6 档） | 静默 no-op | — |
| Esc（任何编辑态） | 退到块选中态，之后 Tab 正常移焦出编辑区（WCAG 2.1.2） | 同 |

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 档位状态 | `ui-demo/src/components/Canvas.tsx`（`block.indent` 数字状态 + 内联 `left: indent*24px`） | `src/editor/blockedit.js`（`ws-indent-1..6` class + 入盘 CSS `position:relative;left`） |
| Tab 分支 | `Canvas.tsx` 锚点 `if (e.key === 'Tab' && editingId && doc && !rawEdit)` | `blockedit.js` 锚点 `if (e.key === 'Tab' && editingEl) {` 非 list 分支 |
| CSS 自愈 | —（内联样式无需自愈） | `refreshSemanticStyles` pairs `['indent', ...]` + `ensurePastedStyles` |
| e2e | — | `e2e/block-indent.spec.js`（15 条，class+坐标双断言） |

行为等价，存储形态不同：ui-demo 是内存数字状态，真 app 是有限 class 词汇 + 入盘 CSS（文件在任何浏览器直开同样有缩进）。

## 有意分歧

- **真 app 有 6 档绝对封顶、ui-demo 无**（inline style 可到任意档）。有限 class 词汇的要求（`ws-indent-7` 没有 CSS 会静默失效）。Colin 2026-07-24 拍板方案 B 时随计划确认；≥7 深度的手感 Colin 未验过。
- **toggle 协调（进/出 toggle 剥 ws-indent）真 app 有、ui-demo 无**——ui-demo 没有 toggle 嵌套交互可对齐（#365 §4.2 拍板，2026-07-24）。

## 对齐锚点

- ui-demo 侧：分支 `feat/ui-demo-block-indent` @ `72794e3`（2026-07-24，Colin 真机验收「手感没问题」；未合 main，合并走 ui-demo 自己的 PR 流程）
- app 侧：本 spec 随实现 PR 落地（feat/app-block-indent-ws-indent，2026-08-03）

## 欠账

- **可发现性**：普通块 Tab 缩进是零视觉线索的全新手势，后续复用仓库既有「快捷键教学气泡」模式补（team-memory wendi-feedback-batch2 那套）。本 PR 不做，非阻塞。
- 跨块多选批量缩进：拍板 no-op（#365 §4.4），批量缩进单独立项。
- 块菜单/工具条缩进按钮：本期键盘 only（ui-demo 亦无）。
