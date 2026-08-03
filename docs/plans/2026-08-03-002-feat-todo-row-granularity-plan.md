# todo/列表 行级粒度对齐（A-D）实施计划 — 2026-08-03

> 需求定稿：`docs/brainstorms/2026-08-03-ux-granularity-align-requirements.md`
> 基线：main `9095a4a`（含 #380 ws-indent / #379+#381 表格）· 分支 `feat/ux-granularity`
> （常驻 worktree `wordspace-next-ux-align`）· 状态：**U1 进行中**

## 总体架构决定

1. **行悬停态独立于块悬停态**：新增模块级 `hoverRow`（当前悬停的 `<li>`，非列表块恒 null），
   与既有 `hoverEl`（顶层/scoped 块）并存。A 阶段只有 grip 定位读 `hoverRow`；B/C 逐步把
   拖拽（dragFrom）与菜单（作用对象）下沉到行。这样每个单元的 diff 都小而可审。
2. **中间态封在隔离分支**：A 合入后手柄在行上、拖拽/菜单还是块级——这种「手柄指行、操作
   却是整列表」的不一致只允许存在于 `feat/ux-granularity`，进 main 的门槛是 A+B+C 整体打磨完。
3. **行解析规则**（`rowOf`）：悬停目标在列表块内 → `closest('li')`（嵌套取最深，对齐 Notion
   嵌套行有自己的手柄）；落在 ul padding/行间隙 → 按 clientY 找最近 li。手柄 x 锚 li 左缘
   （嵌套行随缩进右移，Notion 同款）。
4. **存储不动**：所有行级操作落盘仍是 canonical ul 结构变换；每个单元的 e2e 必须含
   「序列化后 reparse 合规」断言。

## 单元拆解

### U1 = A · 行级手柄悬停跟随（本单元先行）
- `onMouseMove`：`blockOf` 后，若 `classify(el)==='list'` 则 `hoverRow = rowOf(...)`，
  否则 `hoverRow = null`；重定位条件从 `el !== hoverEl` 扩成 `el !== hoverEl || row 变化`；
  grip 锚 `hoverRow || el`。`onDocLeave` 连带清 `hoverRow`。
- 其余 `positionGrip(...)` 调用点（selectBlock/applySlash 等）不动——那些是块级操作路径。
- e2e 新 `e2e/list-row-grip.spec.js`：①悬停 r1/r2/r3 → grip 垂直中心落在对应行 band 内
  （几何强断言，anchor 判定同对拍探针）；②非列表块锚块不变；③嵌套 li 锚嵌套行且 x 右移；
  ④ws-todo 与普通 ul/ol 同覆盖；⑤A 阶段不变式：grip 拖拽仍整列表移动、菜单仍可开（B/C 改）。
- 变异自检：把 grip 锚点还原成 `el` → ①③必须红。

### U2 = B · 行级拖拽重排
- dragstart 从手柄起 → `dragFrom = hoverRow || hoverEl`；dragover 对行级拖拽显示**行间**
  指示线（复用 data-ws2-drop 机制下沉到 li）；drop 语义：同列表内移动 li；拖入其他同类列表
  = li 迁移；拖到列表外 = 劈出成独立单行列表块（含 todo 勾选态保真）。
- **嵌套语义不做**（落点水平位移 = 嵌套，等 #337 拍板）；跨列表类型（todo→普通 ul）暂拒。
- undo：每次 drop 一个 checkpoint；拖拽被 Esc/无效落点取消 = 零变更。
- e2e：行序 DOM 断言 + 磁盘合规 + undo 一步还原 + 勾选态/id 保真（todo sweep 的坑）。

### U3 = C · 手柄菜单行级作用域
- 手柄从行起点开菜单时，作用对象 = 该行：转为（行级 turn-into，底子 #346）/ 在下方插入
  （插同列表新行）/ 复制（复制该行）/ 删除（删该行，列表空则 de-list 成段落）。
- 从块选中态（Esc 灰选）开菜单仍是块作用域——两种入口两种作用域，菜单头标注作用对象。
- 菜单项集不扩（Color/Move to 等另议）。

### U4 = D · gutter「+」快捷插入
- grip 旁增「+」钮（同 data-ws2-ui overlay）：点击在当前行/块下方插空段落并 enterEdit；
  ⌥ 点击插上方。列表行上下文插的是**新行**还是**列表后段落**——按 Notion 对拍结果定（行内
  「+」插新行）。

## 风险与纪律

- `blockedit.js` 热点：每单元开工前 `/sync-main`；分支长期存活，每周至少 merge 一次 main。
- 每单元完成即 commit（并行 session 靠 git log 对齐）；变异自检**先 commit 再变异**。
- spec 铁律：每单元同步更新 `docs/features/todo-list.md` 的「行级交互」节。
- 收尾报告：每单元跑对拍探针（WS 侧新行为 vs Notion 基线截图）出 HTML 报告给 Colin。
- 合 main 前整体走对抗审查 + 全量 e2e（改的是共享核心，适用本地全量例外条款）。

## 完成度

- [x] U1 = A 行级手柄悬停跟随（2026-08-03 完成：`4304dec`+手柄横锚父列表修复；6 e2e 绿/变异 3 红还原绿/定向回归 135 绿）
- [x] U2 = B 行级拖拽重排（平级）（2026-08-03 完成：行拖三分支+源清理+undo 单步；门 list-row-drag 9 条 + grip spec 整块拖拽改走灰选路径）
- [ ] U3 = C 菜单行级作用域
- [ ] U4 = D gutter「+」
- [ ] 整体打磨 + 对抗审查 → 合 main
