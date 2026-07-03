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

// ---- 对抗审计整改（2026-07-03 review）：保真断层 P1 簇 ----

test('审计A：单元格含块级内容（td>ul，无合并格）→ 整表 HTML 岛，round-trip 结构不碎', async () => {
  const md1 = await htmlToMd(await mdToHtml('# t\n\n<table><tr><td><ul><li>x</li><li>y</li></ul></td><td>z</td></tr></table>\n', { title: 'a' }));
  assert.ok(!md1.includes('| -'), '不该被压成管道表：\n' + md1);
  assert.ok(md1.includes('<table>'), '该走 HTML 岛：\n' + md1);
  const round2 = await mdToHtml(md1, { title: 'a' });
  assert.ok(round2.replace(/\n/g, '').includes('<li>y</li>'), '二轮后列表项不能漏出表外：\n' + round2);
});

test('审计B：管道表单元格里的 <br> 序列化成字面 <br>、不丢换行', async () => {
  const back = await htmlToMd(await mdToHtml('| 甲 | 行1<br>行2 |\n| --- | --- |\n| a | b |\n', { title: 'b' }));
  assert.ok(back.includes('行1<br>行2'), 'br 被压成空格：\n' + back);
  assert.ok(back.includes('| 甲 |'), '仍应是管道表（纯行内内容不必岛化）：\n' + back);
});

test('审计C：带 style 的标准标签 → 整块 HTML 岛，属性不剥', async () => {
  const back = await htmlToMd(await mdToHtml('<h1 style="color:red">红标题</h1>\n\n<p style="background:yellow">黄段</p>\n', { title: 'c' }));
  assert.ok(back.includes('<h1 style="color:red">红标题</h1>'), 'h1 style 被剥：\n' + back);
  assert.ok(back.includes('<p style="background:yellow">黄段</p>'), 'p style 被剥：\n' + back);
  // 无属性的标准标签不受影响（仍走 md 语法）
  const clean = await htmlToMd(await mdToHtml('# 干净标题\n\n干净段落\n', { title: 'c2' }));
  assert.equal(clean, '# 干净标题\n\n干净段落\n');
});

test('审计C2：行内岛（span style）不牵连父段落升级——段落仍走 md 语法', async () => {
  const back = await htmlToMd(await mdToHtml('正文 <span style="color:red">红</span> 继续\n', { title: 'c3' }));
  assert.ok(back.startsWith('正文 <span style="color:red">红</span> 继续'), back);
  assert.ok(!back.includes('<p>'), '父段落不该被岛化：\n' + back);
});

test('审计E：岛内含空行（callout>pre）→ &#10; 单行化，往返稳定、<p> 不钻进 <pre>', async () => {
  const html = '<!DOCTYPE html><html><head><title>x</title></head><body><div class="ws-callout"><pre>line1\n\nline2</pre></div></body></html>';
  const md1 = await htmlToMd(html);
  assert.ok(md1.includes('&#10;'), '空行该被实体化：\n' + md1);
  const h2 = await mdToHtml(md1, { title: 'x' });
  assert.ok(h2.includes('<pre>line1\n\nline2</pre>'), 'pre 内容变异：\n' + h2);
  assert.ok(!h2.replace(/\n/g, '').match(/<pre>[^<]*<p>/), '<p> 钻进了 <pre>：\n' + h2);
  assert.equal(await htmlToMd(h2), md1, '第二轮不稳定（每轮保存都在漂移）');
});

test('审计F：非 ws-todo 列表的 li[data-checked] 不被改造成待办、原样保真', async () => {
  const back = await htmlToMd('<!DOCTYPE html><html><head><title>x</title></head><body><ul><li data-checked="true">普通项</li></ul></body></html>');
  assert.ok(!back.includes('- [x]'), '普通列表被误改造成待办：\n' + back);
  assert.ok(back.includes('data-checked="true"'), 'data-checked 属性被丢：\n' + back);
  // 回归：canonical ws-todo 仍走 GFM checkbox 且往返回 canonical 形态
  const todo = await htmlToMd('<!DOCTYPE html><html><head><title>x</title></head><body><ul class="ws-todo"><li data-checked="true">做完</li></ul></body></html>');
  assert.ok(todo.includes('- [x] 做完'), todo);
  const round = await mdToHtml(todo, { title: 'x' });
  assert.ok(round.includes('class="ws-todo"') && round.includes('data-checked="true"'), round);
});

test('isMdPath：.md 大小写认、别的不认', () => {
  assert.equal(isMdPath('/a/b/笔记.md'), true);
  assert.equal(isMdPath('/a/B.MD'), true);
  assert.equal(isMdPath('/a/b.html'), false);
  assert.equal(isMdPath('/a/b.markdown'), false); // MVP 只认 .md
  assert.equal(isMdPath(null), false);
});
