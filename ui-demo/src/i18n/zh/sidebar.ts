// sidebar 命名空间文案：侧栏 / 标签 / 工作区 / 文件树 / toast / 磁盘默认名。
export default {
  // 标签页
  pin: '置顶',
  unpin: '取消置顶',
  unsavedTabHint: '未保存（还没存进文件夹）',
  dragToPinHint: '把标签页拖到这里置顶',
  newTab: '新建标签页',
  newTabTitle: '新标签页',

  // 文件树 / 文件夹
  newDocHere: '在此文件夹新建文档',
  newDoc: '新建文档',
  newSubfolder: '新建子文件夹',
  emptyFolder: '空文件夹',
  moveToTop: '移到最上面',
  removeKeepDisk: '移除（磁盘文件不动）',
  noMatchFiles: '没有匹配的文件',
  rootEmpty: '这个文件夹还没有文件',
  noFolders: '还没有打开任何文件夹。',
  addRootTitle: '再打开一个文件夹，和现有的并排显示',
  addFolderEllipsis: '添加文件夹…',
  filterFiles: '筛选文件',

  // 失联根
  rootMissingTitle: '{path} · 失联（文件夹不可达）',
  missingTag: '失联',
  missingNote: '文件夹不可达（可能被移动、删除，或所在磁盘未连接）',
  relocate: '重新定位',
  relocateEllipsis: '重新定位…',
  remove: '移除',
  rootDragTitle: '{path} · 拖动可调整文件夹顺序',

  // 顶部导航 / 地址栏
  expandSidebar: '展开侧栏',
  collapseSidebar: '收起侧栏',
  resizeHint: '拖拽调整侧栏宽度',
  navBack: '后退',
  navForward: '前进',
  reload: '刷新',
  history: '历史记录',
  findFileHint: '查找文件 {key}',
  searchOrUrl: '搜索,或输入网址',
  localTag: '本地',

  // 收藏区
  favorites: '收藏',
  manageBookmarks: '管理收藏 · 导入导出',
  favEmptyHint: '点地址栏的 ☆ 收藏网页',
  bookmarkedTitle: '已收藏（⌘D 移出）',
  addBookmarkTitle: '加入收藏 ⌘D',
  bookmarkAdded: '已加入收藏',
  bookmarkRemoved: '已移出收藏',

  // 分区标题
  pinnedSection: '置顶',
  tabs: '标签页',
  documents: '文档',
  clear: '清除',

  // 文档右上角浮动操作（TopActions）
  mdSource: 'Markdown 源码',
  mdSourceTitle: '查看 Markdown 源码（后端）',
  saveTitle: '保存（选文件夹）（⌘S）',
  share: '分享',

  // 底部工具
  settings: '设置',
  aiAccess: 'AI 接入',
  shortcutsHint: '快捷键 {key}',
  accountSettings: '{name} · 账户设置',

  // 磁盘默认名（新建时按当前语言生成；查重后缀走数字，不拼死中文名）
  untitledDoc: '无标题文档',
  newFolder: '新建文件夹',
  aiGeneratedDoc: 'AI 生成的文档',
  rootDir: '根目录',

  // toast — 互链 / 增删改
  linksUpdated: '已更新 {count} 篇文档里的链接',
  undoRenameFailed: '文件已被后续操作改动，无法撤销这次链接更新',
  undoMoveFailed: '文件已被后续操作改动，无法撤销移动',
  deletedName: '已删除「{name}」',
  folderDeleted: '已删除文件夹「{name}」',
  folderDeletedWithCount: '已删除文件夹「{name}」({count} 个文件)',
  movedTo: '已移动「{name}」到 {dest}',
  movedLinksSuffix: ' · 已更新 {count} 篇文档里的链接',

  // toast — 根 / 文件夹
  folderOpened: '已打开文件夹「{name}」',
  folderAbsorbed: '「{name}」已并入，含原来的子文件夹',
  rootRemoved: '已移除「{name}」（磁盘文件不受影响）',
  rootReconnected: '「{name}」已重新连接',

  // toast — 保存 / 模板 / AI / 发布 / 导出 / 重置
  saved: '已保存',
  savedTo: '已保存到 {where}',
  createdFromTemplate: '已从模板「{name}」创建',
  aiDraftCreated: 'AI 已生成初稿',
  aiBlockRestyled: 'AI 已重排这一块',
  deploying: '正在部署到 {target} …',
  published: '已发布,链接已生成',
  visibilityUpdated: '可见范围已更新',
  exporting: '正在导出为 {format} …',
  exported: '已导出为 {format}',
  resetDone: '已重置为初始数据',

  // toast — 文档导航（nav.ts）
  docDeleted: '该文档已删除',
  fileMovedOrDeleted: '该文件已移动或删除',

  // 外部文件面板 / 查看器
  kindHtml: 'HTML 文档',
  kindWord: 'Word 文档',
  kindPdf: 'PDF',
  kindImage: '图片',
  kindSheet: '表格',
  kindSlides: '演示文稿',
  kindOther: '文件',
  browserApp: '浏览器',
  notHtmlNote: '这不是 HTML 文档,Wordspace 不能直接编辑它。你可以一键用默认程序打开。',
  openingWith: '正在用 {app} 打开「{name}」',
  openWithApp: '用 {app} 打开',
}
