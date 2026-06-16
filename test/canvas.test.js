const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const canvas = require('../src/editor/canvas.js');
const { serializeDocument } = require('../src/editor/serialize.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>').window.document;
}

test('enable: 盖 data-ws2-canvas + data-ws2-sc，body 不是 contenteditable', () => {
  const doc = docOf('<p id="p1">hello</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  assert.ok(doc.body.hasAttribute('data-ws2-canvas'));
  assert.ok(doc.body.hasAttribute('data-ws2-sc'));
  assert.equal(doc.body.getAttribute('spellcheck'), 'false');
  // body 级 contenteditable 模型已退役：绝不设 contenteditable=true
  assert.notEqual(doc.body.getAttribute('contenteditable'), 'true');
  assert.equal(doc.body.hasAttribute('contenteditable'), false);
});

test('enable: 幂等（重复调用不变）', () => {
  const doc = docOf('<p>x</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  ctrl.enable();
  assert.ok(doc.body.hasAttribute('data-ws2-canvas'));
  assert.equal(ctrl.getState().enabled, true);
});

test('ensureId: 只盖被传元素，不动兄弟', () => {
  const doc = docOf('<p id="a">A</p><p id="b">B</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  const a = doc.getElementById('a');
  const b = doc.getElementById('b');
  const id = ctrl.ensureId(a);
  assert.ok(id);
  assert.equal(a.getAttribute('data-ws2-eid'), id);
  assert.equal(b.hasAttribute('data-ws2-eid'), false); // 兄弟不被盖
  // 同元素再调返回同一 id（复用，不重盖）
  assert.equal(ctrl.ensureId(a), id);
});

test('disable: 清状态、摘 data-ws2-canvas', () => {
  const doc = docOf('<p id="p1">x</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  ctrl.select(doc.getElementById('p1'));
  ctrl.hover(doc.getElementById('p1'));
  ctrl.disable();
  assert.equal(doc.body.hasAttribute('data-ws2-canvas'), false);
  const st = ctrl.getState();
  assert.equal(st.enabled, false);
  assert.equal(st.selectedEl, null);
  assert.equal(st.hoverEl, null);
});

test('select/hover/deselect: 状态存闭包、指真实元素 ref', () => {
  const doc = docOf('<p id="p1">x</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  const p = doc.getElementById('p1');
  ctrl.select(p);
  assert.equal(ctrl.getState().selectedEl, p);
  ctrl.deselect();
  assert.equal(ctrl.getState().selectedEl, null);
});

test('serialize-clean: enable + ensureId 后存盘不含 data-ws2-canvas / -eid', () => {
  const doc = docOf('<p id="p1">hello</p>');
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  ctrl.ensureId(doc.getElementById('p1'));
  const out = serializeDocument(doc);
  assert.ok(!out.includes('data-ws2-canvas'));
  assert.ok(!out.includes('data-ws2-eid'));
  assert.ok(!out.includes('data-ws2-sc'));
  assert.ok(out.includes('hello')); // 用户内容仍在
});
