// 修复覆盖 + 回归：div/section 含直接文字/内联 → 可编辑文本块（不再误锁）；
// 同时锁定表格/图片的行为不变。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const blocks = require('../src/editor/blocks.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>').window.document;
}

test('div 含直接文字 → 可编辑文本块（修复误锁）', () => {
  const doc = docOf('<div>直接文字内容</div>');
  blocks.applyEditable(doc);
  const div = doc.querySelector('div');
  assert.equal(div.getAttribute('data-ws2-block'), 'text');
  assert.notEqual(div.getAttribute('contenteditable'), 'false');
});

test('div 含内联格式元素 → 可编辑文本块', () => {
  const doc = docOf('<div><span>格式</span> <b>粗</b> <a href="#">链接</a></div>');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('div').getAttribute('data-ws2-block'), 'text');
});

test('section 含直接文字 → 可编辑文本块', () => {
  const doc = docOf('<section>段落文字</section>');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('section').getAttribute('data-ws2-block'), 'text');
});

test('回归：div 含块级子元素 → container，子块可编辑、表格仍锁', () => {
  const doc = docOf('<div class="wrap"><p>正文</p><table><tbody><tr><td>x</td></tr></tbody></table></div>');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('.wrap').hasAttribute('data-ws2-container'), true);
  assert.equal(doc.querySelector('p').getAttribute('data-ws2-block'), 'text');
  assert.equal(doc.querySelector('table').getAttribute('data-ws2-block'), 'locked');
  assert.equal(doc.querySelector('table').getAttribute('contenteditable'), 'false');
});

test('回归：div 只含表格（无文字）→ locked', () => {
  const doc = docOf('<div><table><tbody><tr><td>x</td></tr></tbody></table></div>');
  blocks.applyEditable(doc);
  const div = doc.querySelector('div');
  assert.equal(div.getAttribute('data-ws2-block'), 'locked');
  assert.equal(div.getAttribute('contenteditable'), 'false');
});

test('回归：表格/图片直接在 body → locked', () => {
  const doc = docOf('<table><tbody><tr><td>x</td></tr></tbody></table><img src="a.png">');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('table').getAttribute('data-ws2-block'), 'locked');
  assert.equal(doc.querySelector('img').getAttribute('data-ws2-block'), 'locked');
});
