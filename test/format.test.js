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
  const dom = new JSDOM('<!DOCTYPE html><html><body><p>abcdef</p></body></html>');
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
  const dom = new JSDOM('<!DOCTYPE html><html><body><p>abc</p></body></html>');
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
