'use strict';
// U5 改名/移动重写「字节保真」核心单测。铁律：只改 href/url 值那几字节，其余逐字节相同。
const { test } = require('node:test');
const assert = require('node:assert');
const { rewriteContent } = require('../src/main/link-rewrite');

const mv = (obj) => new Map(Object.entries(obj));

test('改名目标：<a href="B.html"> → C.html（own 不动，其余字节不变）', async () => {
  const raw = `<!doctype html><body><p>去 <a href="B.html">B</a> 结束</p></body>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.content, `<!doctype html><body><p>去 <a href="C.html">B</a> 结束</p></body>`);
});

test('保留 #锚点 尾缀', async () => {
  const raw = `<a href="B.html#节2">x</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.content, `<a href="C.html#节2">x</a>`);
});

test('保留 ?查询 尾缀', async () => {
  const raw = `<a href="B.html?p=1">x</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.content, `<a href="C.html?p=1">x</a>`);
});

test('单引号风格保留（只换值、不动引号）', async () => {
  const raw = `<a  href='B.html'  class="k">x</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.content, `<a  href='C.html'  class="k">x</a>`); // 引号/多余空格/其它属性全不动
});

test('own 自己被移动（子目录）→ 未动的目标 href 重算成 ../', async () => {
  const raw = `<a href="B.html">B</a>`;
  const r = await rewriteContent(raw, 'A.html', 'sub/A.html', mv({ 'A.html': 'sub/A.html' }), false);
  assert.strictEqual(r.content, `<a href="../B.html">B</a>`);
});

test('文件夹整体移动：子树内部互链 no-op（旧解析+新重算抵消）', async () => {
  const raw = `<a href="b.html">同目录</a>`;
  const moves = mv({ 'docs/a.html': 'arch/docs/a.html', 'docs/b.html': 'arch/docs/b.html' });
  const r = await rewriteContent(raw, 'docs/a.html', 'arch/docs/a.html', moves, false);
  assert.strictEqual(r.changed, false); // b.html 仍是 b.html，不写
  assert.strictEqual(r.content, raw);
});

test('外链 / 锚点 / 越根 一律不动', async () => {
  const raw = `<a href="https://x.com/B.html">web</a><a href="#top">锚</a><a href="mailto:a@b.c">m</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.content, raw);
});

test('非合规野生 HTML（div 套 + 多属性）只 splice href 值', async () => {
  const raw = `<div style="x"><h1>T</h1><p id="p1">看 <a data-x="9" href="notes/B.html" title="t">B</a></p></div>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'notes/B.html': 'notes/C.html' }), false);
  assert.strictEqual(r.content, `<div style="x"><h1>T</h1><p id="p1">看 <a data-x="9" href="notes/C.html" title="t">B</a></p></div>`);
});

test('多条链接混合：部分移动、部分不动，右往左 splice 正确', async () => {
  const raw = `<a href="B.html">1</a> <a href="D.html">2</a> <a href="B.html#a">3</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'X/C.html' }), false);
  assert.strictEqual(r.count, 2); // 两条 B.html 改，D.html 不动
  assert.strictEqual(r.content, `<a href="X/C.html">1</a> <a href="D.html">2</a> <a href="X/C.html#a">3</a>`);
});

test('md inline：[t](B.md) → C.md', async () => {
  const raw = `看 [去B](B.md) 结束\n`;
  const r = await rewriteContent(raw, 'A.md', 'A.md', mv({ 'B.md': 'C.md' }), true);
  assert.strictEqual(r.content, `看 [去B](C.md) 结束\n`);
});

test('md inline 带 title：[t](B.md "标题") → 保留 title', async () => {
  const raw = `[去B](B.md "标题")\n`;
  const r = await rewriteContent(raw, 'A.md', 'A.md', mv({ 'B.md': 'sub/C.md' }), true);
  assert.strictEqual(r.content, `[去B](sub/C.md "标题")\n`);
});

test('md inline 带 #锚 尾缀保留', async () => {
  const raw = `[x](B.md#节)\n`;
  const r = await rewriteContent(raw, 'A.md', 'A.md', mv({ 'B.md': 'C.md' }), true);
  assert.strictEqual(r.content, `[x](C.md#节)\n`);
});

test('两头都没动 → changed=false、内容不变', async () => {
  const raw = `<a href="D.html">d</a>`;
  const r = await rewriteContent(raw, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.content, raw);
});

test('空/畸形内容不炸', async () => {
  const a = await rewriteContent('', 'A.html', 'A.html', mv({}), false);
  assert.strictEqual(a.changed, false);
  const b = await rewriteContent(null, 'A.html', 'A.html', mv({ 'B.html': 'C.html' }), false);
  assert.strictEqual(b.content, '');
});

// ---- C 跨根：abs 域引擎 rewriteContentAbs ----
const { rewriteContentAbs, relHrefSmart } = require('../src/main/link-rewrite');
const ROOTS = ['/vol/空间甲', '/vol/空间乙'];
const mvAbs = (obj) => new Map(Object.entries(obj));

test('relHrefSmart：同根写短形式、跨根写 abs 形式（N5）', () => {
  assert.strictEqual(relHrefSmart('/vol/空间甲/note.html', '/vol/空间甲/deep/x.html', ROOTS), 'deep/x.html'); // 同根短
  assert.strictEqual(relHrefSmart('/vol/空间甲/note.html', '/vol/空间乙/y.html', ROOTS), '../空间乙/y.html');  // 跨根 abs
});

test('rewriteContentAbs：跨根目标被改名（B 内移动）→ A 的跨根 href 重写、其余字节不变', async () => {
  const raw = `<!doctype html><body><p>见 <a href="../空间乙/target.html">报价</a> 完</p></body>`;
  const moves = mvAbs({ '/vol/空间乙/target.html': '/vol/空间乙/存档/target.html' });
  const r = await rewriteContentAbs(raw, '/vol/空间甲/note.html', '/vol/空间甲/note.html', moves, false, ROOTS);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.content, `<!doctype html><body><p>见 <a href="../空间乙/存档/target.html">报价</a> 完</p></body>`);
});

test('rewriteContentAbs：同根链接维持短形式（不被写成绕根顶的长形式，N5）', async () => {
  const raw = `<body><a href="x.html">x</a></body>`;
  const moves = mvAbs({ '/vol/空间甲/x.html': '/vol/空间甲/深/x.html' });
  const r = await rewriteContentAbs(raw, '/vol/空间甲/note.html', '/vol/空间甲/note.html', moves, false, ROOTS);
  assert.strictEqual(r.content, `<body><a href="深/x.html">x</a></body>`); // 短形式，不是 ../空间甲/深/x.html
});

test('rewriteContentAbs：文件自己跨根移动（甲→乙）→ 它的同根出链变跨根 abs 形式', async () => {
  const raw = `<body>去 <a href="sibling.html">兄弟</a></body>`;
  const moves = mvAbs({ '/vol/空间甲/doc.html': '/vol/空间乙/doc.html' });
  const r = await rewriteContentAbs(raw, '/vol/空间甲/doc.html', '/vol/空间乙/doc.html', moves, false, ROOTS);
  assert.strictEqual(r.content, `<body>去 <a href="../空间甲/sibling.html">兄弟</a></body>`); // 移到乙后，指甲的兄弟 → 跨根
});

test('rewriteContentAbs：目标在工作区外（无根）→ 不碰（越界不动语义）', async () => {
  const raw = `<body><a href="../../外面.html">外</a></body>`;
  const moves = mvAbs({ '/vol/空间甲/doc.html': '/vol/空间乙/doc.html' });
  // doc 自己移动了，但那条链接指向 /vol/外面.html（不在任何根下）→ 不重写
  const r = await rewriteContentAbs(raw, '/vol/空间甲/子/doc.html', '/vol/空间乙/doc.html', moves, false, ROOTS);
  assert.strictEqual(r.changed, false);
});

test('rewriteContentAbs 字节保真：只改 href 值，引号风格/其它属性/空白/实体一字不动（跨根 · 变异敏感）', async () => {
  const raw = `<body>\n  <a  data-x='1'   href='../空间乙/t.html'  class="k">t</a>\n  <p>正文 &amp; 保留 <a href="keep.html">同根不动</a></p>\n</body>`;
  const moves = mvAbs({ '/vol/空间乙/t.html': '/vol/空间乙/深/t.html' });
  const r = await rewriteContentAbs(raw, '/vol/空间甲/n.html', '/vol/空间甲/n.html', moves, false, ROOTS);
  // 只有跨根那条 href 的值变了；单引号风格、data-x、class、空白、&amp;、同根 keep.html 全部逐字节保留
  assert.strictEqual(r.content, `<body>\n  <a  data-x='1'   href='../空间乙/深/t.html'  class="k">t</a>\n  <p>正文 &amp; 保留 <a href="keep.html">同根不动</a></p>\n</body>`);
  assert.strictEqual(r.count, 1);
});

test('rewriteContentAbs：.md 跨根链接也字节保真重写（remark 分支，isMd=true）', async () => {
  const raw = `见 [报价](../空间乙/t.md) 与本地 [x](./local.md)。\n`;
  const moves = mvAbs({ '/vol/空间乙/t.md': '/vol/空间乙/归档/t.md' });
  const r = await rewriteContentAbs(raw, '/vol/空间甲/n.md', '/vol/空间甲/n.md', moves, true, ROOTS);
  assert.strictEqual(r.content, `见 [报价](../空间乙/归档/t.md) 与本地 [x](./local.md)。\n`); // 跨根那条改、本地那条不动、其余逐字节保留
});
