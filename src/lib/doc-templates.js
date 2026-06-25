// 「新建文档」的内置模板（本地，无 AI）。每份是一段独立的标准 HTML，新建时由主进程经
// files.writeDocSafe 原样落盘（字节层，不过编辑器序列化器）。第一项「空文档」永远在最前、
// 一键直达。内容对齐 ui-demo seedTemplates 的本地可用子集（会议纪要/项目方案/周计划）。
// 纯数据模块（无 require），node:test 可直接 require 校验。
const SHELL = (title, body) =>
  `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

const TEMPLATES = [
  {
    id: 'blank',
    name: '空文档',
    base: '无标题文档',
    desc: '从一张白纸开始',
    accent: '#1a73e8',
    html: SHELL('无标题文档', '<h1>无标题文档</h1>\n<p></p>'),
  },
  {
    id: 'minutes',
    name: '会议纪要',
    base: '会议纪要',
    desc: '主题 / 参会 / 议题 / 决议 / 待办',
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
    name: '项目方案',
    base: '项目方案',
    desc: '背景 / 目标 / 方案 / 里程碑 / 风险',
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
    name: '周计划',
    base: '周计划',
    desc: 'Weekly Plan / 例会节奏 / 周末复盘',
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

module.exports = { TEMPLATES };
