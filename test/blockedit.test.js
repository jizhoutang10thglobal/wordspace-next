const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const be = require('../src/editor/blockedit.js');

// 取一个顶层元素（jsdom）。classify/isEditableEl 是脱离 Electron 的纯函数，可单测。
function el(html) {
  return new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>').window.document.body.firstElementChild;
}
// 取一份文档的 body，供 pickBlockRoot 测试（穿透包裹容器）。
function bodyOf(html) {
  return new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>').window.document.body;
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

// 透明内容容器：div/section 自己没直接文字、只裹文本型块级内容 → 可编辑里面的文字（Wendi Bug1）。
test('isEditableEl: 透明内容包裹 div（裹 <p>/<h>）可编辑，含表格的结构 div 不可', () => {
  assert.equal(be.isEditableEl(el('<div class="lead"><p>导言段落</p></div>')), true);   // Bug1 根因
  assert.equal(be.isEditableEl(el('<section><h2>小节</h2><p>正文</p></section>')), true);
  assert.equal(be.isEditableEl(el('<div class="card"><h3>卡片</h3><p>内文</p></div>')), true);
  assert.equal(be.isEditableEl(el('<div><div><p>深层文字</p></div></div>')), true);     // 多层透明包裹
  // 含表格 = designed 结构块，仍不可编辑（即便也裹了 <p>）
  assert.equal(be.isEditableEl(el('<div><p>说明</p><table><tbody><tr><td>x</td></tr></tbody></table></div>')), false);
  // 空容器（无文字内容）不算可编辑文本块
  assert.equal(be.isEditableEl(el('<div><p></p></div>')), false);
});

// pickBlockRoot：穿透居中/限宽包裹容器，否则被 <div class="wrap"> 包住的文档会塌成单个不可编辑块（Wendi 实测翻车）。
test('pickBlockRoot: body 直接挂块 → blockRoot 就是 body', () => {
  const body = bodyOf('<h1>标题</h1><p>正文</p><ul><li>项</li></ul>');
  assert.equal(be.pickBlockRoot(body), body);
});

test('pickBlockRoot: 单个包裹 div 包住正文 → 穿透到该 div（Wendi 文件的根因）', () => {
  const body = bodyOf('<div class="wrap"><h1>标题</h1><p>正文</p><h2>章节</h2></div>');
  const root = be.pickBlockRoot(body);
  assert.equal(root.className, 'wrap');
  assert.equal(root.children.length, 3); // h1/p/h2 成为可独立编辑的块
});

test('pickBlockRoot: 多层包裹（div>section>blocks）逐层穿透', () => {
  const body = bodyOf('<div class="outer"><section><h1>t</h1><p>x</p></section></div>');
  const root = be.pickBlockRoot(body);
  assert.equal(root.tagName, 'SECTION');
  assert.equal(root.children.length, 2);
});

test('pickBlockRoot: 单个纯文字 div（无元素孩子）不穿透——它本身就是可编辑块', () => {
  const body = bodyOf('<div style="padding:12px">一段直接挂文字的卡片</div>');
  assert.equal(be.pickBlockRoot(body), body); // 不钻进去钻空
});

test('pickBlockRoot: 独子不是无语义容器（如单个 <ul>）不穿透', () => {
  const body = bodyOf('<ul><li>a</li><li>b</li></ul>');
  assert.equal(be.pickBlockRoot(body), body); // ul 是真块，不是包裹容器
});

test('pickBlockRoot: 包裹层含多个孩子时不再下钻（多块即内容层）', () => {
  const body = bodyOf('<main><h1>t</h1><p>a</p><p>b</p></main>');
  const root = be.pickBlockRoot(body);
  assert.equal(root.tagName, 'MAIN'); // body 独子是 main → 穿透到 main；main 有多个孩子 → 停
  assert.equal(root.children.length, 3);
});
