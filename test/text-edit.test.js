const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
require('../src/editor/format.js'); // 让 window.WS2Format 存在（text-edit resolveEditTarget 依赖）
const textEdit = require('../src/editor/text-edit.js');
const { serializeDocument } = require('../src/editor/serialize.js');

// text-edit 通过 global.WS2Format 取 isTextEditable/anchorWithin。require('format.js') 在 node 下
// 走 module.exports 分支、不挂 global，所以这里显式把它挂到 globalThis 供 text-edit 读。
global.WS2Format = require('../src/editor/format.js');

function domOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>');
}

test('resolveEditTarget: <p> 内文字 → editable', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  const t = textEdit.resolveEditTarget(p.firstChild);
  assert.equal(t.kind, 'editable');
  assert.equal(t.el, p);
});

test('resolveEditTarget: <a> 内文字 → link', () => {
  const doc = domOf('<p><a id="a1" href="https://x">link</a></p>').window.document;
  const a = doc.getElementById('a1');
  const t = textEdit.resolveEditTarget(a.firstChild);
  assert.equal(t.kind, 'link');
  assert.equal(t.el, a);
});

test('resolveEditTarget: <img>/<hr> → none', () => {
  const doc = domOf('<img id="im" src="x"><hr id="hr">').window.document;
  assert.equal(textEdit.resolveEditTarget(doc.getElementById('im')).kind, 'none');
  assert.equal(textEdit.resolveEditTarget(doc.getElementById('hr')).kind, 'none');
});

test('enter(p): contenteditable=true + data-ws2-editing + data-ws2-ce + onEnter 调用', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  let entered = null;
  const te = textEdit.attach(doc, { onEnter: (el) => { entered = el; } });
  te.enter(p);
  assert.equal(p.getAttribute('contenteditable'), 'true');
  assert.ok(p.hasAttribute('data-ws2-editing'));
  assert.ok(p.hasAttribute('data-ws2-ce'));
  assert.equal(entered, p);
  assert.equal(te.isEditing(), true);
  assert.equal(te.getEditingEl(), p);
});

test('exit(): 摘掉自己加的 contenteditable + 标记，onExit 调用', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  let exited = null;
  const te = textEdit.attach(doc, { onExit: (el) => { exited = el; } });
  te.enter(p);
  te.exit();
  assert.equal(p.hasAttribute('contenteditable'), false);
  assert.equal(p.hasAttribute('data-ws2-ce'), false);
  assert.equal(p.hasAttribute('data-ws2-editing'), false);
  assert.equal(exited, p);
  assert.equal(te.isEditing(), false);
});

test('exit() 不剥预置的 contenteditable（无 data-ws2-ce 的元素 enter+exit 后仍保留）', () => {
  const doc = domOf('<p id="p1" contenteditable="true">hello</p>').window.document;
  const p = doc.getElementById('p1');
  // 文档自带 contenteditable，没有 data-ws2-ce
  const te = textEdit.attach(doc, {});
  te.enter(p);
  // enter 时我们没盖 data-ws2-ce？—— 实际上 enter 永远会盖；关键是 exit 只在 data-ws2-ce 存在时才摘。
  // 模拟「元素本来就有 contenteditable、不是我们加的」：手动去掉我们盖的 ce 标记再 exit。
  p.removeAttribute('data-ws2-ce');
  te.exit();
  assert.equal(p.getAttribute('contenteditable'), 'true'); // 预置的保留
  assert.equal(p.hasAttribute('data-ws2-editing'), false); // editing 标记仍清掉
});

test('serialize-clean: enter()+exit() 后输出无 data-ws2-editing / 无注入的 contenteditable', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  const te = textEdit.attach(doc, {});
  te.enter(p);
  te.exit();
  const out = serializeDocument(doc);
  assert.ok(!out.includes('data-ws2-editing'));
  assert.ok(!out.includes('contenteditable'));
  assert.ok(!out.includes('data-ws2-ce'));
  assert.ok(out.includes('hello'));
});

test('serialize-clean: 编辑中存盘（enter 后未 exit）也无 data-ws2-editing / 无注入 contenteditable', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  const te = textEdit.attach(doc, {});
  te.enter(p);
  // 不 exit，直接序列化（用户编辑中途按 Cmd+S）
  const out = serializeDocument(doc);
  assert.ok(!out.includes('data-ws2-editing'));
  assert.ok(!out.includes('contenteditable')); // data-ws2-ce 让 serialize 剥掉了它
  assert.ok(!out.includes('data-ws2-ce'));
  assert.ok(out.includes('hello'));
});

test('dblclick on <a> 无 openLinkDialog → fall through 编辑 <a> 文本', () => {
  const dom = domOf('<p><a id="a1" href="https://x">link</a></p>');
  const doc = dom.window.document;
  const a = doc.getElementById('a1');
  const te = textEdit.attach(doc, {}); // 无 openLinkDialog
  const ev = new dom.window.Event('dblclick', { bubbles: true });
  Object.defineProperty(ev, 'target', { value: a.firstChild });
  doc.dispatchEvent(ev);
  assert.equal(te.getEditingEl(), a);
  assert.equal(a.getAttribute('contenteditable'), 'true');
});

test('dblclick on <a> 有 openLinkDialog → 调 openLinkDialog、不进编辑', () => {
  const dom = domOf('<p><a id="a1" href="https://x">link</a></p>');
  const doc = dom.window.document;
  const a = doc.getElementById('a1');
  let opened = null;
  const te = textEdit.attach(doc, { openLinkDialog: (el) => { opened = el; } });
  const ev = new dom.window.Event('dblclick', { bubbles: true });
  Object.defineProperty(ev, 'target', { value: a.firstChild });
  doc.dispatchEvent(ev);
  assert.equal(opened, a);
  assert.equal(te.isEditing(), false);
});
