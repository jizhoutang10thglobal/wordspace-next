const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const selection = require('../src/editor/selection.js');
const canvas = require('../src/editor/canvas.js');
const { serializeDocument } = require('../src/editor/serialize.js');

function domOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>');
}

test('hitTest: 跳过 [data-ws2-ui] 覆盖节点，返回其下真实元素', () => {
  const doc = domOf('<p id="p1">hello</p>').window.document;
  const p = doc.getElementById('p1');
  const overlay = doc.createElement('div');
  overlay.setAttribute('data-ws2-ui', '');
  doc.documentElement.appendChild(overlay);
  // elementFromPoint 在 jsdom 里恒返 null，stub 成「点命中覆盖节点」
  doc.elementFromPoint = () => overlay;
  // 覆盖节点 parentElement 是 documentElement → climb 到 body 下最近可选元素拿不到 → null；
  // 这里把覆盖节点的 parent 改成 p1 模拟「覆盖框叠在 p1 上、点穿过去」
  p.appendChild(overlay);
  doc.elementFromPoint = () => overlay;
  assert.equal(selection.hitTest(doc, 5, 5), p);
});

test('hitTest: 命中空白（elementFromPoint 返 body）返回 null', () => {
  const doc = domOf('<p id="p1">x</p>').window.document;
  doc.elementFromPoint = () => doc.body;
  assert.equal(selection.hitTest(doc, 1, 1), null);
});

test('parentOf: span → p → div → null（选父到顶取消）', () => {
  const doc = domOf('<div id="wrap"><p id="para"><span id="sp">x</span></p></div>').window.document;
  const body = doc.body;
  const sp = doc.getElementById('sp');
  const para = doc.getElementById('para');
  const wrap = doc.getElementById('wrap');
  assert.equal(selection.parentOf(sp, body), para);
  assert.equal(selection.parentOf(para, body), wrap);
  assert.equal(selection.parentOf(wrap, body), null); // wrap 的父是 body → null
});

test('select(el): el 上不留持久属性，覆盖框是独立 data-ws2-ui 节点，序列化干净', () => {
  const dom = domOf('<p id="p1">hello</p>');
  const doc = dom.window.document;
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  const sel = selection.attach(doc, ctrl, {});
  const p = doc.getElementById('p1');
  sel.select(p);
  assert.equal(ctrl.getState().selectedEl, p);
  // 被选元素只剩自己的 id，没有任何 selection 加的持久属性（无 data-ws2-selected 之类）
  assert.deepEqual([...p.attributes].map(a => a.name), ['id']);
  // 覆盖框是独立的 [data-ws2-ui] 节点
  assert.ok(doc.querySelectorAll('[data-ws2-ui]').length >= 1);
  // 序列化干净：无任何 data-ws2 痕迹、用户内容在
  const out = serializeDocument(doc);
  assert.ok(!out.includes('data-ws2-ui'));
  assert.ok(!out.includes('data-ws2-canvas'));
  assert.ok(out.includes('hello'));
  assert.ok(out.includes('id="p1"'));
});

test('deselect(): current() === null', () => {
  const dom = domOf('<p id="p1">x</p>');
  const doc = dom.window.document;
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  const sel = selection.attach(doc, ctrl, {});
  sel.select(doc.getElementById('p1'));
  assert.notEqual(sel.current(), null);
  sel.deselect();
  assert.equal(sel.current(), null);
});

test('selectParent: 选中 span 后逐层选父，到顶取消', () => {
  const dom = domOf('<div id="wrap"><p id="para"><span id="sp">x</span></p></div>');
  const doc = dom.window.document;
  const ctrl = canvas.create(doc, {});
  ctrl.enable();
  const sel = selection.attach(doc, ctrl, {});
  sel.select(doc.getElementById('sp'));
  sel.selectParent();
  assert.equal(sel.current(), doc.getElementById('para'));
  sel.selectParent();
  assert.equal(sel.current(), doc.getElementById('wrap'));
  sel.selectParent(); // wrap 的父是 body → 取消
  assert.equal(sel.current(), null);
});
