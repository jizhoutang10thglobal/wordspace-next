const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const format = require('../src/editor/format.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>').window.document;
}

test('blockFromNode: 文字节点往上找到带 data-ws2-block 的块', () => {
  const doc = docOf('<p data-ws2-block="text">hello</p>');
  const p = doc.querySelector('p');
  const textNode = p.firstChild;
  assert.equal(format.blockFromNode(textNode, doc.body), p);
});

test('blockFromNode: 容器内的块也能找到它自己（不返回容器）', () => {
  const doc = docOf('<div data-ws2-container><p data-ws2-block="text">x</p></div>');
  const p = doc.querySelector('p');
  assert.equal(format.blockFromNode(p.firstChild, doc.body), p);
});

test('blockFromNode: 没有块祖先返回 null', () => {
  const doc = docOf('<span>裸文字</span>');
  assert.equal(format.blockFromNode(doc.querySelector('span').firstChild, doc.body), null);
});

test('anchorFromNode: 光标在链接内返回该 <a>', () => {
  const doc = docOf('<p data-ws2-block="text">看 <a href="https://x.com">这里</a> 啊</p>');
  const a = doc.querySelector('a');
  assert.equal(format.anchorFromNode(a.firstChild, doc.body), a);
});

test('anchorFromNode: 不在链接内返回 null', () => {
  const doc = docOf('<p data-ws2-block="text">没有链接</p>');
  assert.equal(format.anchorFromNode(doc.querySelector('p').firstChild, doc.body), null);
});

test('duplicateBlock: 克隆并插到原块之后，深拷贝内容', () => {
  const doc = docOf('<p data-ws2-block="text" id="a">原文 <b>粗</b></p><p id="b">下一段</p>');
  const a = doc.getElementById('a');
  const clone = format.duplicateBlock(a);
  assert.equal(a.nextElementSibling, clone);
  assert.equal(clone.querySelector('b').textContent, '粗');
  assert.equal(clone.nextElementSibling.id, 'b');
  // 块总数从 2 变 3
  assert.equal(doc.querySelectorAll('p').length, 3);
});

test('duplicateBlock: 无父元素时安全返回 null', () => {
  const doc = docOf('');
  const orphan = doc.createElement('p');
  assert.equal(format.duplicateBlock(orphan), null);
});

test('moveBlock: 下移与上移换位', () => {
  const doc = docOf('<p id="a">A</p><p id="b">B</p><p id="c">C</p>');
  const b = doc.getElementById('b');
  assert.equal(format.moveBlock(b, 1), true); // b 下移到 c 之后
  let ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'c', 'b']);
  assert.equal(format.moveBlock(b, -1), true); // b 上移回 c 之前
  ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('moveBlock: 到边界不动并返回 false', () => {
  const doc = docOf('<p id="a">A</p><p id="b">B</p>');
  assert.equal(format.moveBlock(doc.getElementById('a'), -1), false); // 已是第一个
  assert.equal(format.moveBlock(doc.getElementById('b'), 1), false);  // 已是最后一个
  const ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('wrapInlineStyle: 把选中文字包进带行内样式的 span', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text">abcdef</p></body></html>');
  const doc = dom.window.document;
  const textNode = doc.querySelector('p').firstChild;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(textNode, 1);
  range.setEnd(textNode, 4); // 选中 "bcd"
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = format.wrapInlineStyle(doc, 'fontSize', '20px');
  assert.equal(ok, true);
  const span = doc.querySelector('p span');
  assert.ok(span, '应生成 span');
  assert.equal(span.style.fontSize, '20px');
  assert.equal(span.textContent, 'bcd');
  assert.equal(doc.querySelector('p').textContent, 'abcdef'); // 文字总量不变
});

test('wrapInlineStyle: 折叠选区不动、返回 false', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text">abc</p></body></html>');
  const doc = dom.window.document;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(doc.querySelector('p').firstChild, 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  assert.equal(format.wrapInlineStyle(doc, 'fontSize', '20px'), false);
  assert.equal(doc.querySelector('span'), null);
});

test('wrapInlineStyle: 跨块选区拒绝（不动文档、返回 false，保真红线）', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text" id="p1">abc</p><p data-ws2-block="text" id="p2">def</p></body></html>');
  const doc = dom.window.document;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(doc.getElementById('p1').firstChild, 1);
  range.setEnd(doc.getElementById('p2').firstChild, 2); // 选区横跨 p1→p2
  sel.removeAllRanges();
  sel.addRange(range);
  const before = doc.body.innerHTML;
  assert.equal(format.wrapInlineStyle(doc, 'fontSize', '24px'), false);
  assert.equal(doc.querySelector('span'), null);   // 没生成 span
  assert.equal(doc.body.innerHTML, before);          // 文档一字未动（不破坏保真）
});

test('duplicateBlock: 剥掉克隆体及后代的 id（不产生重复 id）', () => {
  const doc = docOf('<section data-ws2-block="container" id="sec"><h2 id="h">标题</h2><p id="p">正文</p></section>');
  const clone = format.duplicateBlock(doc.getElementById('sec'));
  assert.equal(clone.id, '');                              // 克隆根无 id
  assert.equal(clone.querySelectorAll('[id]').length, 0);  // 后代也无 id
  assert.equal(clone.querySelector('h2').textContent, '标题'); // 内容仍在
  assert.equal(doc.querySelectorAll('#sec').length, 1);    // 原 id 没被复制成重复
  assert.equal(doc.querySelectorAll('[id]').length, 3);    // 全文 id 仍是原来那 3 个
});

test('safeHref: 放行 http/https/mailto/tel + 相对/锚点；拒绝 javascript/data/vbscript（含绕过）', () => {
  assert.equal(format.safeHref('https://wordspace.ai'), 'https://wordspace.ai');
  assert.equal(format.safeHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(format.safeHref('tel:123'), 'tel:123');
  assert.equal(format.safeHref('/rel/x.html'), '/rel/x.html');
  assert.equal(format.safeHref('#sec'), '#sec');
  assert.equal(format.safeHref('./a.css'), './a.css');
  assert.equal(format.safeHref(''), '');
  assert.equal(format.safeHref('   '), '');
  assert.equal(format.safeHref('javascript:alert(1)'), null);
  assert.equal(format.safeHref('JaVaScript:alert(1)'), null);  // 大小写绕过
  assert.equal(format.safeHref('java\tscript:alert(1)'), null); // 控制字符绕过
  assert.equal(format.safeHref('data:text/html,x'), null);
  assert.equal(format.safeHref('vbscript:msgbox'), null);
});
