const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

// slashmenu 的桥读 global.WS2Format / global.WS2Insert（浏览器里是 window.* 全局）。
// jsdom + CJS 下手动把两模块挂上 global，再 require slashmenu 测纯桥函数。
const format = require('../src/editor/format.js');
const insert = require('../src/editor/insert.js');
global.WS2Format = format;
global.WS2Insert = insert;
const slash = require('../src/editor/slashmenu.js');
const fs = require('fs');
const path = require('path');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + (bodyHtml || '') + '</body></html>').window.document;
}

test('bridge h2: 把当前块原地 retag 成 <h2>（不新插），保留文字', () => {
  const doc = docOf('<p id="p1">hello</p>');
  const block = doc.getElementById('p1');
  const before = doc.body.children.length;
  const out = slash.retagBlock(doc, block, 'h2');
  assert.equal(out.tagName, 'H2');
  assert.equal(out.textContent, 'hello');
  assert.equal(out.id, 'p1'); // retagElement 保留 id
  assert.equal(doc.body.children.length, before); // 替换而非新增
  assert.equal(doc.querySelectorAll('p').length, 0); // 原 <p> 没了
});

test('bridge h2: 空 <p> 也被 retag 成 <h2>（不依赖 data-ws2-block）', () => {
  const doc = docOf('<p id="p1"></p>');
  const out = slash.retagBlock(doc, doc.getElementById('p1'), 'h2');
  assert.equal(out.tagName, 'H2');
});

test('bridge hr: 当前块非空 → 造 <hr> 紧跟当前块（WS2Insert.createElement(divider)+placeFlow）', () => {
  const doc = docOf('<p id="p1">text</p>');
  const block = doc.getElementById('p1');
  const out = slash.insertFlowElement(doc, block, slash.makeHr);
  assert.equal(out.tagName, 'HR');
  assert.equal(block.nextElementSibling, out); // 插在当前块之后
  assert.ok(doc.querySelector('p')); // 原段落还在
  assert.ok(out.style.cssText.length > 0); // 工厂带 inline 样式
});

test('bridge hr: 当前块空 → 用 <hr> 替换空块（不留空 <p>）', () => {
  const doc = docOf('<p id="p1"></p>');
  const block = doc.getElementById('p1');
  const out = slash.insertFlowElement(doc, block, slash.makeHr);
  assert.equal(out.tagName, 'HR');
  assert.equal(doc.querySelectorAll('p').length, 0); // 空块被替换掉
  assert.equal(doc.querySelector('hr'), out);
});

test('bridge ul / ol: 工厂产 <ul>/<ol>，ol 复用 list 样式', () => {
  const doc = docOf('<p id="p1">x</p>');
  const ul = slash.makeUl(doc);
  assert.equal(ul.tagName, 'UL');
  assert.equal(ul.querySelectorAll('li').length, 3);
  const ol = slash.makeOl(doc);
  assert.equal(ol.tagName, 'OL');
  assert.equal(ol.querySelectorAll('li').length, 3);
  assert.equal(ol.style.cssText, ul.style.cssText); // ol 复用 list 工厂样式
});

test('bridge ul 插入: 非空块后插 <ul>', () => {
  const doc = docOf('<p id="p1">text</p>');
  const block = doc.getElementById('p1');
  const out = slash.insertFlowElement(doc, block, slash.makeUl);
  assert.equal(out.tagName, 'UL');
  assert.equal(block.nextElementSibling, out);
});

test('isEmptyBlock: 空串/纯空白 → true，有文字 → false', () => {
  const doc = docOf('<p id="a"></p><p id="b">  </p><p id="c">x</p>');
  assert.equal(slash.isEmptyBlock(doc.getElementById('a')), true);
  assert.equal(slash.isEmptyBlock(doc.getElementById('b')), true);
  assert.equal(slash.isEmptyBlock(doc.getElementById('c')), false);
  assert.equal(slash.isEmptyBlock(null), true);
});

test('slashmenu.js 源码零 execCommand（grep 验证门：插入与删除均退役 execCommand）', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/editor/slashmenu.js'), 'utf8');
  assert.equal(/execCommand/.test(src), false, 'slashmenu.js 不应再出现 execCommand（含注释）');
});
