// 「新建文档」的内置模板（本地，无 AI）。每份是一段独立的标准 HTML，新建时由主进程经
// files.writeDocSafe 原样落盘（字节层，不过编辑器序列化器）。
// 2026-07-23（Wendi）：内置模板收敛为只留「空文档」——现阶段以空白文档为主，会议纪要/项目方案/
// 周计划等成套模板先撤（弹窗外壳 + 范式 tab 保留，将来放用户自定义模板/多范式，见 #194）。
// node:test 可直接 require 校验（i18n 也是纯逻辑、无 electron，不破坏可测性）。
// name/desc 用 getter 走 i18n.t()（选择器显示，随语言实时切换：ws-templates IPC 每次调用时
//   structured-clone 触发 getter 取当前语言）；base（磁盘默认名）与 html 正文豁免不翻（i18n-exempt）。
const i18n = require('./i18n');
const schemaPage = require('./schema-page');
const SHELL = (title, body) =>
  `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
// 分页文档模板（Schema 2）：head 带 wordspace-schema=2 提示 + canonical @page 块（buildPageCss，单一真相源）。
// 归类只认内容——page 块可解析 → schema-2；meta 只是提示。新建即以分页视图打开。
const PAGED_SHELL = (title, body) =>
  '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="wordspace-schema" content="2">\n<title>' + title + '</title>\n' +
  '<style data-ws-schema-css="page">' + schemaPage.buildPageCss(schemaPage.DEFAULT_PAGE) + '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';

// i18n-exempt-start —— 以下 base（磁盘默认名）与 html 模板正文整段豁免不翻；name/desc 走上面的 getter 翻译。
// schema 字段 = 该模板属于哪个范式（新建弹窗按范式过滤模板）：schema-1 流式 / schema-2 分页。
const TEMPLATES = [
  {
    id: 'blank',
    schema: 'schema-1',
    get name() { return i18n.t('template.blankName'); },
    base: '未命名',
    get desc() { return i18n.t('template.blankDesc'); },
    accent: '#1a73e8',
    html: SHELL('未命名', '<h1>未命名</h1>\n<p></p>'),
  },
  {
    id: 'blank-paged',
    schema: 'schema-2',
    get name() { return i18n.t('template.blankPagedName'); },
    base: '未命名',
    get desc() { return i18n.t('template.blankPagedDesc'); },
    accent: '#7c4dff',
    html: PAGED_SHELL('未命名', '<h1>未命名</h1>\n<p></p>'),
  },
];
// i18n-exempt-end

module.exports = { TEMPLATES };
