// modals 命名空间文案：新建 / 添加文件夹 / 保存 / 关闭确认 / 删除确认 / 发布。
export default {
  // 文档类型标签
  kindPage: '网页',
  kindSlides: '演示',
  kindDoc: '文档',

  // 新建（CreateModal）
  newDoc: '新建文档',
  newTabOrDoc: '新建标签页或文档',
  searchOrUrl: '搜索，或输入网址',
  inLocation: '在 {where}',
  docFallback: '文档',
  paradigm: '范式',
  paradigmNotion: '类 Notion',
  paradigmCurrent: '当前',
  paradigmNotionDesc: '分块编辑的结构化文档',
  paradigm2: '范式 2',
  paradigm3: '范式 3',
  comingSoon: '敬请期待',
  paradigmRailFoot: '未来每个范式有各自的编辑方式与模板',
  paradigmSoon: '{name} · 还在路上',
  paradigmSoonDesc: '每个范式是一套独立的编辑内核与文档结构。这个范式上线后，会在这里列出它自己的模板。',
  templatesOf: '{name} 模板',
  officialTemplates: '官方模板',
  blankDoc: '空白文档',
  blankDocDesc: '从一张白纸开始',

  // 添加文件夹（AddFolderModal）
  addFolder: '添加文件夹',
  addFolderSub: '再打开一个文件夹，和现有的并排显示；随时可以移除，磁盘文件不受影响。',
  noFolderPicked: '还没选择文件夹',
  pickFolder: '选择文件夹…',
  relSame: '这个文件夹已经打开了。',
  // 嵌套关系提示按 zh 语序切成段，名字用 <b> 包裹插在段之间
  bracketL: '「',
  relChildMid: '」已经在「',
  relChildEnd: '」里了——不会重复打开它。想去看它，在那个文件夹里展开即可。',
  relParentMid: '」包含了已打开的「',
  relParentEnd: '」。添加后会把它{plural}并入「{name}」，避免同一批文件出现两次。',
  pluralThem: '们',
  listSep: '、',
  alreadyOpen: '已打开：{names}',
  gotIt: '知道了',
  mergeAndAdd: '并入并添加',
  add: '添加',

  // 保存到哪里（SaveModal）
  rootDirLabel: '{name}（根目录）',
  saveWhere: '保存到哪里',
  saveWhereSub: '「{title}」· 默认存到第一个打开的文件夹，也可以选别的位置',
  saveHere: '保存到这里',

  // 未保存关闭确认（CloseConfirmModal）
  thisFile: '这个文件',
  unsavedChanges: '未保存的更改',
  unsavedTitle: '「{title}」还没保存',
  unsavedDesc: '这是一个还没存进文件夹的临时文档。关掉后未保存的内容会丢失。',
  discardClose: '不保存，直接关闭',
  saveClose: '保存并关闭',

  // 删除被引用文档确认（DeleteLinkedModal）
  deleteLinkedAria: '删除被引用的文档',
  deleteDirLinked: '文件夹「{name}」里的文档被 {count} 篇外部文档链接',
  deleteFileLinked: '「{name}」被 {count} 篇文档链接',
  deleteLinkedDesc: '删除后这些文档里指向它的链接会断开（显示为断链，可在链接上重新指向或撤销删除恢复）：',
  andMore: '… 等 {count} 篇',
  deleteAnyway: '仍要删除',

  // 分享与发布（PublishDialog）
  shareAndPublish: '分享与发布',
  inviteEmailPlaceholder: '输入邮箱邀请协作者',
  invite: '邀请',
  deploying: '正在部署…',
  redeploy: '重新部署',
  publish: '发布',
  deployNote: '部署到 {target} · 可自托管,数据归你',
  linkCopied: '链接已复制',
}
