// md-adapter（Markdown ↔ HTML 磁盘适配器）单测。
// 断言口径：语义不变（关键行/关键元素在），不逐字节比对——规范化是特性不是 bug（origin 决策 3）。
// 「转换产物过校验器」是 R5 的地基：md 的合规判定 = mdToHtml 产物过 schema-validate，跟 html 同一道门。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { mdToHtml, htmlToMd, isMdPath } = require('../src/main/md-adapter.js');
const { validate } = require('../src/lib/schema-validate.js');

const docOf = (html) => new JSDOM(html).window.document;
const conformOf = (html) => validate(docOf(html));

test('干净映射往返：语义层全家桶 md → html → md 语义不变', async () => {
  const md = [
    '# 一级标题',
    '',
    '## 二级标题',
    '',
    '正文 **加粗** *斜体* ~~删除~~ `行内代码` [链接](https://example.com)。',
    '',
    '- 无序一',
    '- 无序二',
    '  - 嵌套子项',
    '',
    '1. 有序一',
    '2. 有序二',
    '',
    '- [x] 做完的事',
    '- [ ] 没做的事',
    '',
    '| 甲 | 乙 |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '> 引用内容',
    '',
    '---',
    '',
    '```',
    'const x = 1;',
    '```',
  ].join('\n');

  const html = await mdToHtml(md, { title: '笔记' });
  // html 侧关键元素在
  for (const frag of ['<h1>一级标题</h1>', '<h2>二级标题</h2>', '<strong>加粗</strong>', '<em>斜体</em>',
    '<del>删除</del>', '<code>行内代码</code>', 'href="https://example.com"',
    '<ul class="ws-todo">', 'data-checked="true"', 'data-checked="false"',
    '<table>', '<blockquote>', '<hr>', '<pre><code>const x = 1;']) {
    assert.ok(html.includes(frag), '缺 ' + frag + '\n' + html);
  }
  // 嵌套列表结构在（li 内尾随子列表）
  assert.match(html.replace(/\n/g, ''), /<li>无序二<ul><li>嵌套子项<\/li><\/ul><\/li>/);

  const back = await htmlToMd(html);
  for (const line of ['# 一级标题', '## 二级标题', '**加粗**', '*斜体*', '~~删除~~', '`行内代码`',
    '[链接](https://example.com)', '- 无序一', '1. 有序一', '- [x] 做完的事', '- [ ] 没做的事',
    '| 甲 | 乙 |', '> 引用内容', '---', '```\nconst x = 1;\n```']) {
    assert.ok(back.includes(line), '回程缺 ' + JSON.stringify(line) + '\n' + back);
  }
});

test('HTML 岛保真：mark/span 色/u/callout 两个方向原样穿透', async () => {
  const md = [
    '正文里有 <mark>高亮</mark>、<span style="color:#e03e3e">文字色</span>、<u>下划线</u>。',
    '',
    '<div class="ws-callout"><p>提示：这是 callout 块</p></div>',
  ].join('\n');
  const html = await mdToHtml(md, { title: '岛' });
  for (const frag of ['<mark>高亮</mark>', '<span style="color:#e03e3e">文字色</span>', '<u>下划线</u>',
    '<div class="ws-callout"><p>提示：这是 callout 块</p></div>']) {
    assert.ok(html.includes(frag), '缺 ' + frag + '\n' + html);
  }
  const back = await htmlToMd(html);
  for (const frag of ['<mark>高亮</mark>', '<span style="color:#e03e3e">文字色</span>', '<u>下划线</u>',
    '<div class="ws-callout"><p>提示：这是 callout 块</p></div>']) {
    assert.ok(back.includes(frag), '回程缺 ' + frag + '\n' + back);
  }
});

test('R5 地基：合规样例 md 的转换产物过校验器 conform=true', async () => {
  const md = [
    '# 标题',
    '',
    '正文 **粗** <mark>亮</mark> <span style="color:red">红</span>',
    '',
    '- [x] 完成',
    '- [ ] 未完成',
    '',
    '- 普通项',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '> 引用',
    '',
    '---',
    '',
    '<div class="ws-callout"><p>提示</p></div>',
  ].join('\n');
  const r = conformOf(await mdToHtml(md, { title: '合规' }));
  assert.equal(r.conform, true, JSON.stringify(r.violations));
});

test('危险 md：<script> 岛直通（不 sanitize）→ 校验器判非合规（分流靠校验器）', async () => {
  const html = await mdToHtml('# t\n\n<script>alert(1)</' + 'script>\n\n正文\n', { title: '野' });
  assert.ok(html.includes('<script>alert(1)</' + 'script>'), '转换器不该吞 script（保真给基础编辑）');
  const r = conformOf(html);
  assert.equal(r.conform, false);
  assert.ok(r.violations.some((v) => v.rule === 'script'), JSON.stringify(r.violations));
  // 基础编辑保存同走 htmlToMd：script 岛必须存回 .md、不能静默丢
  const back = await htmlToMd(html);
  assert.ok(back.includes('<script>alert(1)</' + 'script>'), '保存回 md 时 script 岛被丢了：\n' + back);
});

test('序列化风格固定：* 项存回 - 项（规范化）', async () => {
  const back = await htmlToMd(await mdToHtml('* 甲\n* 乙\n', { title: 'x' }));
  assert.equal(back, '- 甲\n- 乙\n');
});

test('松散列表规范化：项间空行的 li>p 拆成行内 → 仍 conform', async () => {
  const html = await mdToHtml('- 一\n\n- 二\n', { title: 'l' });
  assert.ok(!/<li>\s*<p>/.test(html), 'li 里不该残留 <p>：\n' + html);
  const r = conformOf(html);
  assert.equal(r.conform, true, JSON.stringify(r.violations));
});

test('松散 li 多段落 → <br> 连接、内容不丢', async () => {
  const html = await mdToHtml('- 第一段\n\n  第二段\n', { title: 'l2' });
  const flat = html.replace(/\n/g, '');
  assert.match(flat, /<li>第一段<br>第二段<\/li>/, html);
  const r = conformOf(html);
  assert.equal(r.conform, true, JSON.stringify(r.violations));
});

test('合并格野表：GFM 表达不了 → 整表 HTML 岛保真', async () => {
  const wild = '<table><tr><td colspan="2">跨两列</td></tr><tr><td>a</td><td>b</td></tr></table>';
  const html = await mdToHtml('# t\n\n' + wild + '\n', { title: 'tbl' });
  const back = await htmlToMd(html);
  assert.ok(back.includes('colspan="2"'), '合并格信息被丢了：\n' + back);
  assert.ok(!back.includes('| 跨两列'), '合并格表不该被压成管道表：\n' + back);
});

test('完整文档形态：doctype/charset/schema meta/title=文件名', async () => {
  const html = await mdToHtml('段落\n', { title: '我的笔记' });
  assert.ok(/^<!DOCTYPE html>/i.test(html));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<meta name="wordspace-schema" content="1">'));
  assert.ok(html.includes('<title>我的笔记</title>'));
  assert.match(html, /<body>[\s\S]*<p>段落<\/p>[\s\S]*<\/body>/);
  // title 缺省 + XSS 转义
  const noTitle = await mdToHtml('x\n');
  assert.ok(noTitle.includes('<title>未命名</title>'));
  const esc = await mdToHtml('x\n', { title: '<b>&' });
  assert.ok(esc.includes('<title>&lt;b&gt;&amp;</title>'), esc);
});

test('htmlToMd 只吃 body：head（title/编辑器注入的 schema 样式）不进 .md', async () => {
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>标</title>'
    + '<style data-ws-schema-css="baseline">body{max-width:720px}</style></head>'
    + '<body><h1>正文标题</h1><p>内容</p></body></html>';
  const back = await htmlToMd(html);
  assert.equal(back, '# 正文标题\n\n内容\n');
});

test('isMdPath：.md 大小写认、别的不认', () => {
  assert.equal(isMdPath('/a/b/笔记.md'), true);
  assert.equal(isMdPath('/a/B.MD'), true);
  assert.equal(isMdPath('/a/b.html'), false);
  assert.equal(isMdPath('/a/b.markdown'), false); // MVP 只认 .md
  assert.equal(isMdPath(null), false);
});
