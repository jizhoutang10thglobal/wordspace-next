const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const be = require('../src/editor/blockedit.js');

// 取一个顶层元素（jsdom）。classify/isEditableEl 是脱离 Electron 的纯函数，可单测。
function el(html) {
  return new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>').window.document.body.firstElementChild;
}

test('classify: 标签 → ui-demo 块类型', () => {
  assert.equal(be.classify(el('<h1>x</h1>')), 'heading');
  assert.equal(be.classify(el('<h3>x</h3>')), 'heading');
  assert.equal(be.classify(el('<p>x</p>')), 'text');
  assert.equal(be.classify(el('<ul><li>x</li></ul>')), 'list');
  assert.equal(be.classify(el('<ol><li>x</li></ol>')), 'list');
  assert.equal(be.classify(el('<blockquote>x</blockquote>')), 'quote');
  assert.equal(be.classify(el('<hr>')), 'divider');
  assert.equal(be.classify(el('<img>')), 'image');
  assert.equal(be.classify(el('<div>x</div>')), 'other');
});

test('isEditableEl: 文字块可编辑，图片/分隔线不可', () => {
  assert.equal(be.isEditableEl(el('<p>x</p>')), true);
  assert.equal(be.isEditableEl(el('<h2>x</h2>')), true);
  assert.equal(be.isEditableEl(el('<ul><li>x</li></ul>')), true);
  assert.equal(be.isEditableEl(el('<blockquote>x</blockquote>')), true);
  assert.equal(be.isEditableEl(el('<hr>')), false);
  assert.equal(be.isEditableEl(el('<img>')), false);
});

test('isEditableEl: callout 恒可编辑（含空 callout，防「清空后点不进」死块陷阱）', () => {
  assert.equal(be.isEditableEl(el('<div class="ws-callout">提示内容</div>')), true);
  assert.equal(be.isEditableEl(el('<div class="ws-callout"></div>')), true); // 空 callout 也必须可编辑
});

test('isEditableEl: 含直接文字的 div 可编辑，纯结构 div 不可（designed 整块）', () => {
  assert.equal(be.isEditableEl(el('<div>裸文字段</div>')), true);
  assert.equal(be.isEditableEl(el('<div><table><tbody><tr><td>x</td></tr></tbody></table></div>')), false);
});
