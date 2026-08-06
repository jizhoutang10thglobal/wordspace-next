# 块编辑器 markdown 触发与键盘快捷键 —— 对齐 spec

> 建于 2026-08-06（Notion 对齐 sweep，Colin 全权授权「能还原 Notion 就直接还原」）。此前
> 「斜杠菜单/转为/格式气泡/markdown 触发」整个面没有 spec（editor-cross-block-selection.md
> 记录在案的空白），本份先把 markdown 触发集与键盘快捷键两块立起来，其余面欠账仍在。
> 门：e2e/kb-md-parity.spec.js（6 条）+ e2e/app.spec.js 的 markdown 组。

## 行为契约

### markdown 行首触发（正文块内）

| 输入 | 产物 | 触发时机 | 证据 |
|---|---|---|---|
| `# ` ~ `#### ` | H1-H4 | 敲**空格**那一击 | 既有（U7/U18），未与 Notion 逐项对拍 |
| `- ` / `* ` / `+ ` | 无序列表 | 同上 | 既有；`+ ` 为对拍补齐（F11） |
| `1. `（任意起始数字） | 编号列表（ol[start]） | 同上 | 既有 |
| `[] ` / `[x] ` | 待办列表（勾选态随 x） | 同上 | 既有 |
| `> ` | 引用 | 同上 | 既有 |
| `---` | **分隔线 hr**（2026-08-06 新增） | 敲**第三个 `-`** 立即转、不等空格；光标落 hr 后新空正文块 | Notion 实测（notion-base/md-hr 探针：dividers 1→2） |

- 统一守卫（U18 血案换的，`---` 同构沿用）：只在「刚敲下触发字符那一击」转换（绑 inputType/data）、
  marker 必须在块首文本节点、caret 恰停 marker 末——磁盘/粘贴来的既有文本绝不被误转。
- **未对齐记录**：Notion 的 ` ``` `（代码块）、`| `（表格）触发我们无对应块类型/入口，制度性排除
  （skill 范围规则：只对拍已有能力）。

### 键盘快捷键（2026-08-06 新增）

| 键 | 行为 | 作用域 |
|---|---|---|
| ⌘E | **开关**：选中文字包 `<code>`；选区已在 code 内再按=解包（Notion toggle 语义，ADV-KB-4） | editing / cell 态，有非折叠选区且可作用才吞键（跨 li 拒绝时放行原生，不做零反馈死键） |
| ⌘⌥0 | 当前块转正文 | editing/灰选块，限 text/heading/quote；cell 态禁用 |
| ⌘⌥1/2/3 | 当前块转 H1/H2/H3（turnInto 既有管线，内容/合规全走既有逻辑） | 同上 |

- **证据类别声明（铁律 9 变体）**：⌘ 组合键经 CDP `Input.dispatchKeyEvent` 与 ego-browser pressKey
  都打不进 Notion（2026-08-06 实证，Meta+z 同款），无法真机对拍；本组键位依据 **Notion 官方
  keyboard shortcuts 文档**（⌘E inline code、⌘⌥0-3 text/headings），非实测读数。
- ⌥ 在 mac 会改写 `e.key`（⌥0='º'）——实现用 `e.code`（Digit0-3）判定。
- ⌘⌥4（Notion=to-do）暂未做：列表行级语义与「当前块」口径需先定（行还是整列表），记欠账。
- **AltGr 豁免**（ADV-KB-1）：Windows 上 AltGr=ctrl+alt，法语/德语键盘 AltGr+数字打 @/#/² 会命中
  ⌘⌥ 判据——`getModifierState('AltGraph')` 豁免。待王波 Windows 真机装欧洲布局各敲一遍验证。
- **toggle 标题（summary）内 ⌘E/⌘⌥ 不可达**（summary keydown 分支整段截流）——欠账（ADV-KB-7）。
- 自动转换的 **undo 逃生舱**：`---` 转 hr 后一步 undo=还原字面 `---`（Notion 同款，前置 checkpoint
  结算防抖打字债）；既有空格触发一族（`# ` 等）同病未修，存量欠账记录在案。

### hr 分隔线既有交互（本轮钉门，行为未改）

点击 = 灰选（data-ws2-selected）；灰选后 Backspace/Delete = 删除（undo 一步回来）；
斜杠菜单「分隔线」= 无条件 insertAfter。**Notion 对拍欠账**：hr 的键盘停靠位语义
（↑↓ 经过时跳过还是停留）未对拍未定，现状=既有行为不动。

## 文件映射

| 维度 | 真 app |
|---|---|
| markdown 触发 | src/editor/blockedit.js tryMarkdown |
| 快捷键 | src/editor/blockedit.js onKeyDown（SW-B 段） |
| 门 | e2e/kb-md-parity.spec.js |

## 欠账

- 斜杠菜单本体（项集顺序/分组）与格式气泡（fmtbar）项集仍无 spec——本轮对拍结论：Notion 新版
  选中工具条已改为 AI 优先紧凑条（翻译/AI 改写/⋮，经典格式键折进 ⋮），我们的 fmtbar 更接近
  经典 Notion，**不抄新版**（AI/翻译无对应能力）。观察项，暂不动。
- ⌘⌥4 todo、⌘⇧ 系列（Notion 的 move-block ⌘⇧↑↓）未做。
- ui-demo 侧全部未跟进（真 app 先行，惯例同粒度对齐 track）。
