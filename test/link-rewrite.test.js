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
