// 用户自定义模板 feature（#205）的文案：模板页 / 存为模板弹窗 / 文档菜单模板项 /
// 新建弹窗模板卡 / store 模板 toast / 模板 CSS 安全门违规消息。
// 通用词（取消/关闭/删除/返回/撤销/改名）复用 common.*，不在这里重复。
export default {
  // 「模板」页（TemplatesPage）
  title: '模板',
  subtitle: '点模板从它新建文档；把喜欢的文档在其 ⋯ 菜单里「存为模板」，就出现在下面「我的」。',
  official: '官方',
  mine: '我的',
  newFromThis: '从此模板新建文档',
  emptyMine: '还没有自己的模板。在任意文档的 ⋯ 菜单里选「存为模板」，它就会出现在这里，以后一键复用。',

  // 存为模板弹窗（SaveTemplateModal）
  saveAsTemplate: '存为模板',
  nameLabel: '模板名称',
  defaultName: '{title} 模板',
  dupWarn: '已有同名模板，保存会新增一个（不覆盖旧的）。',
  includeSkeleton: '包含内容骨架（新建时带上本文档的块结构）',
  saveThemeHint: '将保存当前文档的版式主题',
  saveSkeletonHint: '当前文档为素颜（无版式），存出的是纯骨架模板',
  userTemplateHint: '用户模板会出现在「模板」页与画廊的「我的」分组',

  // 文档 ⋯ 菜单（DocMenu）
  saveDocAsTemplate: '将当前文档存为模板…',
  mdUnsupported: 'Markdown 文档暂不支持模板（头部样式不入盘）',
  nonConformUnsupported: '此文件不符合 Schema、走基础编辑，模板仅适用于合规文档',

  // 新建弹窗模板卡（CreateModal）
  kindStyled: '版式',
  kindSkeleton: '骨架',
  myTemplates: '我的模板',

  // store 模板操作 toast / 派生字段
  untitledTemplate: '未命名模板',
  descHasTheme: '含版式',
  descSkeletonOnly: '纯骨架',
  descWithSkeleton: '含内容骨架',
  savedToast: '已存为模板「{name}」',
  deletedToast: '已删除模板「{name}」',

  // 模板 CSS 安全门违规消息（templateCheck）
  cssNoExternalUrl: '模板 CSS 只允许内嵌资源 url(data:font/*) / url(data:image/*)（拒 svg），禁外链请求（追踪信标 / 外部依赖）。',
  cssNoImport: '禁 @import（会拉取外部样式表，是外链通道）。',
  cssNoExpression: '禁 CSS expression()（旧 IE 里可执行 JS）。',
  cssNoBinding: '禁 -moz-binding（可绑定可执行 XBL/XML）。',
  cssNoBehavior: '禁 behavior: 属性（IE HTC 行为绑定，可执行）。',
  cssNoPositioning: '禁 position:fixed/sticky/absolute（文档区与 app 界面同一 DOM，绝对定位能盖住界面 / 点击劫持）。',
  cssNoImportant: '禁 !important（会覆盖用户的行内手调，破坏「换装保留手调」）。',
  cssNoHideDisplay: '禁 display:none（模板不得隐藏正文内容——藏条款一类的视觉欺骗）。',
  cssNoHideVisibility: '禁 visibility:hidden（模板不得隐藏正文内容）。',
  cssBadAtRule: '禁 @{name}（模板只允许 @font-face / @keyframes / @media / @supports）。',
  cssOverBudget: '模板体积 {size}KB 超过上限 {max}KB（demo 受 localStorage 配额约束）。',
}
