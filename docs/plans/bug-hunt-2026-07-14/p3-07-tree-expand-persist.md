# [P3-07] 树的展开/折叠状态重启不记忆

**问题(2/2)**:展开了几个子文件夹/折叠了某个根 → 重启 → 全回默认(根展开、子文件夹收起)。
workspace.json 只存 roots+tabs,没有折叠字段。浏览器侧收藏区折叠态**有**持久化(spec 拍板#4),文件树没有。

**修法**:collapsed 集合(rel 键)+根折叠态一并进持久化:
- 存:`workspace-store` 加 `treeState` 字段(`{ collapsedByRoot: { [rootId]: [rel...] }, collapsedRoots: [rootId] }`),
  写入走既有防抖原子写;折叠/展开动作后 schedule 保存。
- 读:启动恢复根后、首次渲染前灌回 collapsed 集合;rel 已不存在的条目丢弃(树是真相,状态是缓存)。
- 上限:每根 collapsed 条目 cap(如 500),超出丢最旧——防几年积累的死 rel 膨胀文件。
- 注意根移除/吸收 rebase 时同步清/迁移对应条目(对照 tabs 在这两处的既有处理,同款跟着做)。

**门**:e2e(multi-root 或新 spec):展开子夹+折叠一根→重启(同 WS2_USERDATA)→断言状态保持;
删掉磁盘上已展开的目录→重启→无残留报错。变异:去掉恢复灌入→翻红。

**spec 记账**:workspace-file-tree.md「树展开态跨重启持久化(缓存语义,rel 失效即弃)」。
