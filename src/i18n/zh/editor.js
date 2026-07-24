// editor 命名空间(zh)：块编辑器 / 工具条 / 插入面板 / slash 菜单 / 基础编辑浮条 / 分页。
module.exports = {
  // 块类型标签（斜杠菜单 / 转为菜单 / 工具条「转为」共用）
  blockText: '正文',
  blockH1: '标题 1',
  blockH2: '标题 2',
  blockH3: '标题 3',
  blockH4: '标题 4',
  blockBulletList: '无序列表',
  blockNumberedList: '编号列表',
  blockOrderedList: '有序列表',
  blockTodoList: '待办列表',
  blockQuote: '引用',
  blockCallout: '提示',
  blockToggle: '折叠',
  blockImage: '图片',
  blockDivider: '分隔线',
  aiGenerate: '✦ AI 生成（开发中）',

  // 拖拽手柄 / 提示
  gripTip: '拖动重排 · 点击打开菜单',
  dragHandleTip: '拖动调整顺序，点击打开菜单',
  blockNotEditable: '此块暂不支持编辑',

  // 新建块 / 插入元素的默认内容（会入盘成用户文档内容）
  listItem: '列表项',
  calloutContent: '提示内容',
  quoteContent: '引用内容',
  newHeading: '新标题',
  defaultTextParagraph: '文本段落',
  heading: '标题',
  button: '按钮',
  linkText: '链接文本',

  // 「+ 插入」面板元素类型
  elContainer: '容器',
  elText: '文本',
  elTable: '表格',
  elList: '列表',
  insertBtn: '+ 插入',
  insertElement: '插入元素',

  // 格式气泡 / 工具条：行内格式
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  boldCmd: '加粗 Cmd+B',
  italicCmd: '斜体 Cmd+I',
  underlineCmd: '下划线 Cmd+U',
  inlineCode: '行内代码',
  textColorShort: '文字色',
  textColor: '文字颜色',
  highlightShort: '高亮',
  highlightBg: '背景高亮',
  clear: '清除',
  clearFormat: '清除格式',
  link: '链接',
  apply: '应用',
  applyLink: '应用链接',
  removeLink: '移除链接',
  turnInto: '转为',
  turnType: '转换类型',
  alignLeft: '左对齐',
  alignCenter: '居中',
  alignRight: '右对齐',
  duplicate: '复制',
  duplicateBlock: '复制块',
  deleteBlock: '删除块',
  radius: '圆角',
  shadow: '阴影',
  opacity: '不透明度',

  // 字体 / 字号下拉
  fontDefault: '默认字体',
  fontSans: '无衬线',
  fontSerif: '衬线',
  fontMono: '等宽',
  fontSystem: '系统',
  sizeDefault: '默认字号',

  // 块菜单
  turnToText: '转为正文',
  turnToHeading: '转为标题',
  turnToQuote: '转为引用',
  addCaption: '加说明',
  insertBelow: '在下方插入',
  noMatch: '无匹配',

  // 基础编辑器
  deleteThisBlock: '删除此块',
  deleteThisBlockKey: '删除此块 (Delete)',
  deleteAlmostWholeDoc: '这一块几乎是整个文档，确定删除？',

  // 图片 / 链接 / 提及 toast
  imageTooLarge: '图片太大：压缩后仍超过 1.5MB 上限',
  imageUnsupported: '不支持的图片格式',
  imageDecodeFailed: '图片无法解码',
  imagePickerUnavailable: '图片选择不可用',
  dropImagesOnly: '只支持拖入图片文件（png / jpg / webp / gif / avif）',
  linkUrlPrompt: '链接地址',
  linkNotAllowed: '不允许的链接地址',
  linkUnsupportedTempDoc: '临时 / 工作区外文档暂不支持拖入链接',
  linkSelfNotAllowed: '不能链接到文档自己',
  noTextBlockForLink: '这篇文档没有可放链接的文字块',
  crossVolumeUnsupported: '这两个文件夹在不同磁盘卷，暂不支持链接',
  crossRootLinkFailed: '无法建立跨文件夹空间的链接',
  mentionUnsupportedTempDoc: '临时 / 工作区外文档暂不支持文档互链',

  // 编辑器内占位文案（空块 / 图片说明）
  emptyBlockPlaceholder: '输入正文,或按 / 插入',
  figcaptionPlaceholder: '图片说明',

  // 分页页码 chip
  pageNumber: '第 {page} 页',
};
