# Notion ↔ Wordspace 块级操作对齐审计 · todo/斜杠菜单（2026-08-03）

> 背景：前一 session 用双侧浏览器自动化对拍 Notion 与 Wordspace 的块级操作，Notion 侧驱动脆
> （成功率约六成）、中途崩溃。本报告 = 接手后的复核与落盘：斜杠菜单总盘点（更新到当日 main）+
> 三条「疑似对齐 bug」在 **main `cfd9640`（含表格 P1/P2 #379/#381）** 上的实证复核。
> 复核环境：origin/main 干净 worktree + 仓内 e2e 惯用法（真 Electron + 真键事件 + 菜单加速器）。

## 一、斜杠菜单总盘点（已按当日 main 更新）

**Notion 24 项 vs Wordspace 15 项**（前一 session 报 14，当天 #379/#381 合入后斜杠菜单新增
「表格」，缺口收窄一项）。

- **两边都有**：正文、标题 1-4、无序/编号/待办/折叠列表、引用、提示（callout）、图片、分隔线、表格。
- **Wordspace 独有**：AI 生成（入口占位）。
- **Wordspace 缺**（= feature 缺口，建议进 Feature Board 排优先级，不是 bug）：
  代码块、页面/链接到页面、视频、音频、文件、网页书签。
- **排序差异（属实，待修）**：Wordspace 把「引用」插在无序列表和编号列表中间
  （`SLASH_ITEMS`：text→h1..h4→list→**quote**→numbered→todo→…）；Notion 是四种列表连排、
  引用在后。一行重排即可（代码注释已确认下标引用全走 `itemByKey`，重排安全）。
  ⚠ 时机：`blockedit.js` 当前是热点（#380 ws-indent 正在解冲突），排序 PR 等它落地再开，别加剧 merge train。

## 二、三条「疑似 bug」复核结论

| # | 前一 session 的观察 | 复核结论 | 证据 |
|---|---|---|---|
| 1 | 斜杠插 todo 后原空段落 `<p>` 残留 | **不复现（假阳性）** | `applySlash` 空块走 `turnInto` 原地变身（Wendi 07-24 视频反馈后已修）；探针：空 `<p>` 上插 todo → `body > p` 计数 0、磁盘无空段落 ✅ |
| 2 | 空 todo 项回车不退出列表、又生成空 li | **不复现（假阳性）** | 07-23 todo sweep 已成体系：空末项回车→退列表、中间空项→劈列表、嵌套空项→outdent（blockedit.js U12/U15）；既有 e2e `todo-enter-split.spec.js` 8 条 + 探针 2a/2b ✅ |
| 3 | 粘贴三项后 undo 一次整口吞掉 | **行为属实，是否 bug 待 Notion 实证** | 探针：粘贴「甲\n乙\n丙」成三项 → 菜单 undo 一次 → 三项全回退。粘贴=单 checkpoint 是设计使然；Notion 大概率同款粒度（一次 undo 回退整次粘贴），若 Notion 确认同款则**非 bug 结案** |

复核跑的门：既有 `todo-slash-insert` / `todo-enter-split` / `todo-undo` 共 18 条全绿 +
一次性探针 4 条全绿（探针源码见附录）。

## 三、方法论教训（值得广播）

前一 session 的两条假阳性大概率是**取证工具伪迹**：裸浏览器驱动把光标直接塞进 iframe、
不走 app 的进入编辑路径时，`editingEl` 为空 → 键盘 handler 整个被跳过 → 落到 contenteditable
**原生行为**（原生回车正是「再生成一个空 li」= 观察到的症状）。

**规则**：对编辑器行为做对齐审计/取证，必须走仓内 e2e 惯用法（真点击进入编辑态、真键事件、
undo 走菜单加速器），裸驱动的观察只能当线索、不能当结论。这与既有教训「keyboard Meta+z
不触发菜单加速器=假 FAIL」「ego-browser pressKey 假键」同族。

## 四、后续动作清单

1. **undo 粒度 Notion 单点实证**（唯一剩余的 Notion 依赖）：在 Notion 里向 todo 粘贴三行、
   按一次 Cmd+Z，看是否整次粘贴一起回退。人工验证 10 秒即可，无需自动化。
2. **排序对齐一行修**：`SLASH_ITEMS` 里 quote 挪到列表族之后（等 #380 落地后开 PR）。
3. **缺失块类型进 Feature Board**：代码块 / 页面链接 / 视频 / 音频 / 文件 / 网页书签
   （按卡片规范 R1-R6，编号从 F62 起——F61 已被表格块占用）。
4. **全量对拍不追**：维持前一 session 的判断——Notion 侧全自动性价比低；后续对齐以
   「Wordspace 侧 e2e 实证 + Notion 侧人工录屏/点验单点」分工。

## 附录：一次性探针（复核当日在 origin/main worktree 真跑，未入库）

四条用例（全部沿用仓内 e2e 惯用法：`electron.launch` + `WS2_USERDATA` 隔离 + `open-file` IPC
开档 + 菜单加速器 undo）：

1. 空 `<p><br></p>` 上 `/` → 点「待办列表」→ 断言 `ul.ws-todo>li` 计 1、`body>p` 计 0、
   序列化后无空段落。
2. `<li>第一项</li>` 末尾双回车 → 断言空项被移除（li 回到 1）、打字落进列表后的新段落。
3. 整列表仅一个空项时回车 → 断言 `ul.ws-todo` 计 0（整块转正文）、打字落段落。
4. `<li>打头</li>` 末尾粘贴「甲\n乙\n丙」→ 三项 → 菜单 undo 一次 → 断言回到仅「打头」
   （整次粘贴为一个回退单元）。
