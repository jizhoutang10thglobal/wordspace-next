// shortcuts 命名空间文案（快捷键面板：shortcutList / ShortcutsPanel）。
export default {
  // 面板外壳
  panelTitle: '快捷键',
  subtitle: '同一个键在不同场景下含义不同：弹层 > 编辑器 > 全局壳，Esc 逐层退出',
  docLink: '完整键位文档（调研 · 裁决 · UseCase · 与真 app 对照）',

  // 分组标题
  grpAppShell: '应用壳 · 全局',
  grpFindSelect: '编辑器 · 查找与选择',
  grpTextMode: '编辑器 · 文本态（光标在块里）',
  grpBlockOps: '编辑器 · 块操作（文本态或块选中态）',
  grpNav: '光标导航 · 系统原生',
  grpMarkdown: 'Markdown 触发（行首输入 + 空格）',

  // 分组提示
  hintTextMode: '格式键作用于选中文字；无选区时放行原生',
  hintNav: '操作系统直接提供，编辑器不拦截',

  // 应用壳 · 全局
  newTab: '新建标签页（新文档）',
  closeTab: '关闭当前标签页',
  nextTab: '下一个标签页（+Shift 上一个）',
  jumpTab: '直达第 N 个标签页',
  lastTab: '最后一个标签页',
  save: '保存（临时文档弹「保存到哪里」）',
  saveAs: '另存为…',
  quickOpen: '快速打开（搜文件名）',
  focusFilter: '聚焦文件筛选框',
  toggleSidebar: '收起 / 展开侧栏',
  settings: '设置',
  thisPanel: '本面板',

  // 编辑器 · 查找与选择
  findInDoc: '在文档中查找（Enter 下一个 · Shift+Enter 上一个）',
  selectAll: '全选块内文字，再按升到块选中态',

  // 编辑器 · 文本态
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  strikethrough: '删除线',
  highlight: '高亮',
  inlineCode: '行内代码',
  insertLink: '插入链接',
  pastePlain: '粘贴为纯文本',
  undoMac: '撤销（+Shift 重做）',
  undoWin: '撤销（+Shift 或 Ctrl+Y 重做）',
  slashMenu: '斜杠插入菜单',
  newBlock: '新块（Shift+Enter 块内换行）',
  listIndent: '列表缩进（Shift+Tab 反缩进）',
  escToBlock: '退到块选中态',

  // 编辑器 · 块操作
  duplicateBlock: '复制当前块',
  deleteBlock: '删除当前块',
  moveBlock: '上移 / 下移当前块',
  toText: '转为正文',
  toHeading: '转为标题 1 / 2 / 3',
  toList: '转为待办 / 无序 / 有序列表',
  bulletedList: '无序列表',
  numberedList: '有序列表',
  toggleTodo: '待办打勾 / 取消',
  blockMove: '块选中态：移动选择',
  blockEnter: '块选中态：进入编辑',
  blockDelete: '块选中态：删除块',

  // 光标导航 · 系统原生
  deleteWord: '按词删除',
  moveWord: '按词左右移动（+Shift 扩选）',
  lineEnds: '到行首 / 行尾',
  docEnds: '跳到文档首 / 尾',

  // Markdown 触发
  mdHeading: '标题 1 / 2 / 3',
  mdTodo: '待办',
  mdQuote: '引用',
}
