# [P2-1] 文件夹在 app 内完全无法移动(拖拽没接、右键也没有)

## 问题与复现(2/2)

树里把**文件夹**拖向任何目标(根/别的文件夹/跨根)→ 静默无效,无任何提示;右键菜单也没有「移动」项。
文件(file 行)拖拽是好的。用户要重组目录结构只能去 Finder 改,再靠外部跟随同步回来。

## 根因(已核实,src/renderer/sidebar.js)

`draggable = true` 只设在三处:根标题行(≈:480,根排序用)、**文件行**(≈:1143)、标签行(≈:1717)。
目录行(renderRootSection 里建 `.sb-dir` 行的分支)从来没设 draggable、没挂 dragstart。
而后端 `workspace.movePath` 支持移动目录,**连「禁止移进自己子树」的守卫都写好了**——是从未被前端调到的死代码
(文件行的 drop 逻辑只对 file 生效)。

## 修法

1. 目录行设 `row.draggable = true` + dragstart 记录 `dragNode`(照文件行的写法,dragNode 已有全局,≈:722 起的拖拽区)。
2. drop 目标侧(dir 行 / 根标题 / 树空白区=根)现有 handler 里放行「源是目录」的情况,落到既有
   `wsMove(rootId, relPath, destDirRel)` / 跨根 `wsMoveAcross`——IPC 面已存在,不用新增。
3. 非法目标就地拒绝 + toast:拖进自己/自己的子孙(前端先判,后端守卫兜底)、拖到自己父目录(no-op)。
4. 顺手把右键菜单加「移动到…」?**不做**——本计划只接通拖拽;右键移动是新交互,要单独过 Wendi,别夹带。
5. 注意联动:目录移动后,子树里打开的标签/置顶要跟随——`wsMove` 返回后走的既有 rename/move 收尾
  (`wsRewriteMoves`/reconcile)对目录已有处理(外部 mv 目录时标签跟随是好的,复用同一条收尾路径),实测确认别重复造。

## 门

- 单测:无新纯逻辑(复用后端)。
- e2e(树相关 spec,建议新文件 `e2e/tree-dir-move.spec.js`):目录拖进兄弟目录成功(树+盘上都对)、
  拖进自己子孙被拒、目录里有打开标签时移动后标签 rel 更新、跨根移动目录。
- 变异自检:去掉 dragstart 挂接 → e2e 翻红。

## 影响面/回归

sidebar.js 共享核心 → 推 PR 前本地 `npm run test:e2e:dot` 全量。回归重点:文件拖拽不被弄坏、
吸顶行(见 p2-5,若两条都做,注意别在克隆行为上互踩——先合谁都行,后合的 rebase 时对一下)。

## spec 记账

`docs/features/workspace-file-tree.md` 行为契约加「文件夹可拖拽移动(同根/跨根),禁入自身子树」。
