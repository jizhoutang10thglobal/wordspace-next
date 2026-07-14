# [P3-05] 置顶 → 删除 → 撤销:文件回来了,置顶状态丢了

**问题(2/2)**:置顶一个文件 → 删除(置顶随文件消失,对)→ 点撤销 → 文件回到树里,但**置顶不恢复**。
撤销的心智是「回到删除前」,状态少还原了一半。

**根因方向(执行时核实)**:删除时 reconcile 把该 rel 的 entry(含 pinned 标记)整个 remove;
撤销(`wsUndoDelete`)只还原磁盘文件,树 reconcile 把它当新文件——pinned 信息早没了。

**修法**:删除动作发起时(sidebar 的 delete 流,不是 reconcile 里)把被删 rel 涉及的 entry 快照
(pinned/open/rootId,含目录级联的子孙 entry)存进 undo token 对应的闭包;撤销成功后按快照恢复 entry
(walk 新树拿 ino/abs)。只管「app 内删除+撤销」这条线;外部删除没有撤销,不涉及。

**门**:e2e(删除撤销 spec 追加):置顶→删→撤→断言置顶区回来+树行在;目录级联版(置顶的文件在被删目录里)。
变异:去掉快照恢复→翻红。

**spec 记账**:workspace-file-tree.md「撤销恢复置顶/打开状态」一句。
