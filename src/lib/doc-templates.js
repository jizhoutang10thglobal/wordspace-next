// 「新建文档」的内置模板（本地，无 AI）。每份是一段独立的标准 HTML，新建时由主进程经
// files.writeDocSafe 原样落盘（字节层，不过编辑器序列化器）。第一项「空文档」永远在最前、
// 一键直达。内容对齐 ui-demo seedTemplates 的本地可用子集（会议纪要/项目方案/周计划）。
// node:test 可直接 require 校验（i18n 也是纯逻辑、无 electron，不破坏可测性）。
// name/desc 用 getter 走 i18n.t()（选择器显示，随语言实时切换：ws-templates IPC 每次调用时
//   structured-clone 触发 getter 取当前语言）；base（磁盘默认名）与 html 正文豁免不翻（i18n-exempt）。
const i18n = require('./i18n');
const SHELL = (title, body) =>
  `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

// i18n-exempt-start —— 以下 base（磁盘默认名）与 html 模板正文整段豁免不翻；name/desc 走上面的 getter 翻译。
const TEMPLATES = [
  {
    id: 'blank',
    get name() { return i18n.t('template.blankName'); },
    base: '未命名',
    get desc() { return i18n.t('template.blankDesc'); },
    accent: '#1a73e8',
    html: SHELL('未命名', '<h1>未命名</h1>\n<p></p>'),
  },
  {
    id: 'minutes',
    get name() { return i18n.t('template.minutesName'); },
    base: '会议纪要',
    get desc() { return i18n.t('template.minutesDesc'); },
    accent: '#1a73e8',
    html: SHELL(
      '会议纪要',
      [
        '<h1>会议纪要</h1>',
        '<p>主题：______　·　日期：2026-00-00　·　主持：______　·　记录：______</p>',
        '<h2>参会人</h2>',
        '<ul><li>______</li><li>______</li></ul>',
        '<h2>议题与讨论</h2>',
        '<ol><li><b>议题一</b>：______</li><li><b>议题二</b>：______</li></ol>',
        '<h2>决议</h2>',
        '<p>✅ ______</p>',
        '<h2>待办事项</h2>',
        '<ul><li>______（负责人 __，截止 00-00）</li><li>______</li></ul>',
      ].join('\n'),
    ),
  },
  {
    id: 'proposal',
    get name() { return i18n.t('template.proposalName'); },
    base: '项目方案',
    get desc() { return i18n.t('template.proposalDesc'); },
    accent: '#e8710a',
    html: SHELL(
      '项目方案',
      [
        '<h1>项目方案：______</h1>',
        '<p>一句话目标：______</p>',
        '<h2>背景</h2>',
        '<p>当前 ______ 存在 ______ 问题，需要 ______。</p>',
        '<h2>目标</h2>',
        '<ul><li>______</li><li>______</li></ul>',
        '<h2>方案概述</h2>',
        '<p>______</p>',
        '<h2>里程碑</h2>',
        '<ol><li>第一阶段（00-00）：______</li><li>第二阶段（00-00）：______</li></ol>',
        '<h2>风险与对策</h2>',
        '<p>⚠ ______</p>',
      ].join('\n'),
    ),
  },
  {
    id: 'weekly',
    get name() { return i18n.t('template.weeklyName'); },
    base: '周计划',
    get desc() { return i18n.t('template.weeklyDesc'); },
    accent: '#d4356b',
    html: SHELL(
      '周计划',
      [
        '<h1>Weekly Plan　MM/DD – MM/DD</h1>',
        '<p>注：Deliverable 需是明确、可衡量、可验证的「结果」，不是推进的「动作」。</p>',
        '<h2>A. Deliverable</h2>',
        '<ul><li>Deliverable 1</li><li>Deliverable 2</li><li>Deliverable 3</li></ul>',
        '<h2>B. Need Support / Review</h2>',
        '<ul><li>Item 1</li><li>Item 2</li></ul>',
        '<h2>C. Risks / Uncertainties</h2>',
        '<ul><li>Item 1</li><li>Item 2</li></ul>',
        '<h2>End of Week Update　MM/DD – MM/DD</h2>',
        '<h3>A. Deliverable Update</h3>',
        '<ul><li>Deliverable 1 — ______</li><li>Deliverable 2 — ______</li></ul>',
        '<h3>B. Items to note</h3>',
        '<ul><li>______</li></ul>',
      ].join('\n'),
    ),
  },
];
// i18n-exempt-end

module.exports = { TEMPLATES };
