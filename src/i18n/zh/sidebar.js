// sidebar 命名空间(zh)。侧栏：toast、右键菜单、文件树空态、置顶/标签区、并入/删除守卫、性能诊断面板。
// 通用词（取消/关闭/删除/重命名/打开/移除/撤销/未命名/新建文件夹）复用 common.*，不在此重造。
module.exports = {
  // ---- 侧栏骨架 ----
  localFiles: '本地文件',
  noMatchingFiles: '没有匹配的文件',
  addRootTitle: '再打开一个文件夹，和现有的并排显示',
  addFolder: '添加文件夹…',

  // ---- 添加文件夹 / 根管理 toast ----
  folderAlreadyOpen: '「{name}」已经打开了',
  folderIsChild: '「{name}」已经在「{parent}」里了——不会重复打开，去那个文件夹里展开即可',
  folderChildParentStuck: '「{name}」在你打开的「{parent}」里（{mode}）。可以直接在它里面展开找到，或在「管理文件夹」里移除它后单独打开「{name}」',
  folderModeLazy: '简化模式的大文件夹',
  folderModeLoading: '还在加载',
  folderStateChangedRetry: '文件夹状态已变化，请重试',
  folderLimit: '最多同时打开 {max} 个文件夹',
  reconnected: '「{name}」已重新连接',
  folderOpened: '已打开文件夹「{name}」',

  // ---- 并入并添加确认 ----
  absorbTitle: '「{name}」包含了已打开的文件夹',
  absorbDesc: '「{name}」包含了已打开的「{children}」。添加后会把{it}并入「{name}」，避免同一批文件出现两次；打开的标签页会跟过去，不会关闭。',
  absorbConfirm: '并入并添加',
  absorbChanged: '文件夹状态已变化，没有并入',
  absorbedInto: '「{name}」已并入，含原来的子文件夹',
  pronounIt: '它',
  pronounThem: '它们',
  listSep: '、',

  // ---- 移除根 ----
  removeDirtyBlock: '这个文件夹里有没保存成功的修改，先处理再移除',
  rootRemoved: '已移除「{name}」（磁盘文件不受影响）',
  undoRemoveOverlap: '无法撤销：它和现在打开的文件夹有重叠',
  undoRemoveLimit: '无法撤销：文件夹数量已满',
  undoRemoveFailed: '无法撤销',

  // ---- 根标题行 / 失联根 ----
  rootHeadTitle: '{path} · 拖动可调整文件夹顺序',
  rootHeadTitleLazy: '{path} · 简化模式（超大文件夹，按需加载）',
  newDoc: '新建文档',
  moveToTop: '移到最上面',
  removeRoot: '移除（磁盘文件不动）',
  readingFolder: '正在读取文件夹…',
  folderNoFiles: '这个文件夹还没有文件',
  rootMissingTitle: '{path} · 失联（文件夹不可达）',
  missingTag: '失联',
  relocateEllipsis: '重新定位…',
  missingNote: '文件夹不可达（可能被移动、删除，或所在磁盘未连接）',
  relocate: '重新定位',
  relocateOverlap: '选的位置和已打开的文件夹重叠，换一个位置',

  // ---- 病灶路径确认 modal（选了整个用户目录 / 磁盘 / 卷根）----
  hugeTitle: '「{name}」是一个很大的系统文件夹',
  hugeDesc: '你选的是整个用户目录 / 磁盘，通常包含数十万个系统文件，打开会非常慢。建议改选里面具体的工作文件夹（比如某个项目文件夹或「文稿」）。',
  hugePickAnother: '换一个文件夹',
  hugeOpenAnyway: '仍要打开',

  // ---- 简化模式（lazy）大根：徽标 + 逐层加载占位 + 单层截断提示 ----
  lazyTag: '简化模式',
  lazyTagTitle: '这个文件夹很大（超过 15 万个项目），Wordspace 按需逐层加载，筛选/快速打开只覆盖已浏览过的目录',
  readingLevel: '正在读取…',
  dirTruncatedNote: '此文件夹的直接项目过多，仅显示前一部分',
  lazyFilterHint: '简化模式：仅搜索已浏览过的目录',
  lazyFilterHintTitle: '这个文件夹太大、按需加载。展开更多目录后再筛选，或用「移除后打开具体子文件夹」得到完整搜索',
  lazyQuickOpenNote: '简化模式的大文件夹未纳入快速打开（在侧栏里逐层展开查找）',

  // ---- 逃生门：管理文件夹 modal ----
  manageRootsTitle: '管理文件夹',
  manageRootsDesc: '移除只是从 Wordspace 里关掉，磁盘上的文件不受影响。',
  noOpenFolders: '没有打开的文件夹',
  missingSuffix: '（失联）',

  // ---- 快捷键教学气泡（首次鼠标操作后教一次）----
  coachReload: '下次可以用 {key} 刷新',
  coachNewTab: '下次可以用 {key} 新建标签页',
  coachCloseTab: '下次可以用 {key} 关闭当前标签',
  coachToggleSidebar: '下次可以用 {key} 收起 / 展开侧栏',

  // ---- 改名 / 移动 / 链接重写 ----
  renameFailed: '重命名失败：{err}',
  formatKept: '改名不改格式：要转 Markdown 请用「另存为 / 导出」',
  linksUpdated: '已更新 {total} 篇文档里的链接',
  undoLinkFailed: '文件已被后续操作改动，无法撤销这次链接更新',
  quotedName: '「{name}」',
  nFiles: '{n} 个文件',
  externalRenameDetected: '检测到{label}改名/移动，{total} 篇文档的链接指向旧路径',
  updateNow: '一键更新',
  moveFailed: '移动失败：{err}',
  crossDeviceMove: '这两个文件夹在不同的磁盘上，暂不支持直接拖动移动——先在访达里复制过去',

  // ---- 删除守卫 ----
  delGuardTitleDir: '文件夹「{name}」里的文档被 {n} 篇外部文档链接',
  delGuardTitleFile: '「{name}」被 {n} 篇文档链接',
  delGuardDesc: '删除后这些文档里指向它的链接会断开（显示为断链，可在链接上重新指向或撤销删除恢复）：',
  delGuardMore: '… 等 {n} 篇',
  stillDelete: '仍要删除',
  deleteFailed: '删除失败：{err}',
  deleted: '已删除「{name}」',
  newFolderFailed: '新建文件夹失败：{err}',

  // ---- 树节点右键菜单 ----
  addDocHere: '在此文件夹新建文档',
  newSubfolder: '新建子文件夹',
  cantMoveIntoSelf: '不能把文件夹移动到它自己里面',
  emptyFolder: '空文件夹',
  pin: '置顶',
  unpin: '取消置顶',

  // ---- 关闭确认 modal ----
  thisFile: '这个文件',
  unsavedTitle: '「{name}」还没保存',
  unsavedDescTemp: '这是一个还没存进文件夹的临时文档。关掉后未保存的内容会丢失。',
  unsavedDescReal: '这个文档有未保存的修改，关掉后会丢失。',
  closeWithoutSaving: '不保存，直接关闭',
  saveAndClose: '保存并关闭',

  // ---- 保存到哪里 modal ----
  rootDirLabel: '{name}（根目录）',
  fileName: '文件名',
  browse: '浏览…',
  browseTitle: '用系统保存框选任意位置（可存到工作区外）',
  docSwitched: '文档已切换，未保存',
  saveFailed: '保存失败：{err}',
  saveHere: '保存到这里',
  saveModalTitle: '保存到哪里',
  saveModalSub: '「{name}」· 默认存到工作区根目录，也可以选别的文件夹或「浏览…」到其他位置',
  saveFailedShort: '保存失败',
  savedTo: '已保存到 {place}',
  workspace: '工作区',

  // ---- 标签行 ----
  externalFile: '工作区外的文件',
  unsavedDotTemp: '未保存（还没存进文件夹）',
  unsavedDot: '有未保存的修改',
  removePin: '移出置顶',
  closeTab: '关闭标签页 ⌘W',
  rootMissingOpen: '「{name}」失联了，重新定位后才能打开',

  // ---- 置顶 / 标签页两区 ----
  pinnedZone: '置顶',
  pinnedEmptyHint: '把标签页拖到这里置顶',
  tabsZone: '标签页',
  newTabTitle: '新建标签页 ⌘T',
  tabsEmptyHint: '没有打开的标签',

  // ---- 新建文档 / 标签页 modal ----
  newTab: '新建标签页',
  createTabSub: '输入网址直接上网，或在下面新建一个文档（临时文档，保存时再选存到哪）',
  createDocSub: '在 {location}',
  omniPlaceholder: '搜索,或输入网址',
  paradigm1: '范式 1',
  paradigm2: '范式 2',
  paradigm3: '范式 3',
  comingSoon: '敬请期待',

  // ---- 命令面板 ----
  findPlaceholder: '按文件名查找…',
  findHintOpen: '⏎ 打开',

  // ---- 网页标签默认标题 ----
  newWebTab: '新标签页',

  // ---- 性能诊断面板（隐藏开发工具，Cmd+Shift+D）----
  diagTitle: 'Wordspace 性能诊断  v{version}   {date}',
  diagNoRoots: '（还没打开任何文件夹，或还没读过树）',
  diagRootLine: '根{n}「{name}」  {info}',
  diagCloud: '☁ {name} 云盘',
  diagLocal: '本地',
  diagFileStats: '   文件数 {files} / 目录 {dirs}{kb}  ·  readTree 上次 {last}ms / 峰值 {max}ms（全量 {reads} 次 / 子树 {scoped} 次 / 单层 {dirReads} 次）  ·  watcher 触发 {events} 次',
  diagIpcPayload: '  ·  IPC 载荷 ≈{kb}KB',
  diagRenderLine: '渲染：上次 {last}ms · 峰值 {max}ms · 共 {count} 次  ·  当前树 DOM 行数 {rows}',
  diagLongTask: '主线程长任务(>50ms 卡帧)：{count} 次 · 累计 {total}ms · 最长单次 {max}ms   ← 滚动/交互卡顿看这行',
  diagMem: 'JS 内存：{mem}',
  diagCopy: '复制诊断',
  diagRecord: '录制 5 秒 Profile',
  diagCopied: '已复制 ✓',
  diagCopyFailed: '复制失败',
  diagRecording: '录制中… 请现在复现卡顿（滚动/切换）',
  diagSaved: '已保存：{name}（访达已打开）',
  diagRecordFailed: '录制失败',
  diagRecordFailedPkg: '录制失败（需在打包版里用）',
  diagHint: '打开后滚动/切换来复现卡顿，看「长任务」实时涨 · 每 1 秒刷新',
  resizeHint: '拖拽调整侧栏宽度',
  toggleSidebarTitle: '收起侧栏 ⌘\\',
  navBack: '后退',
  navForward: '前进',
  reloadTitle: '刷新 ⌘R',
  findFileTitle: '查找文件 ⌘P',
  addBookmarkTitle: '收藏 ⌘D',
  favorites: '收藏',
  manageBookmarks: '管理收藏',
  filesLabel: '文件',
  filterFiles: '筛选文件',
  clearFilter: '清除',
  emptyNote: '打开一个本地文件夹，把这里当工作区',
  emptyOpenBtn: '打开文件夹',
  aiAccessTitle: 'AI 接入',
  expandSidebarTitle: '展开侧栏 ⌘\\',
};
