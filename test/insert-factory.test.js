const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const insert = require('../src/editor/insert.js');
const { serializeDocument } = require('../src/editor/serialize.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + (bodyHtml || '') + '</body></html>').window.document;
}

test('createElement(button): <button> 文本非空 + inline 样式含 padding/border-radius', () => {
  const doc = docOf();
  const el = insert.createElement(doc, 'button');
  assert.equal(el.tagName, 'BUTTON');
  assert.ok(el.textContent.trim().length > 0);
  assert.ok(/padding/.test(el.style.cssText));
  assert.ok(/border-radius/.test(el.style.cssText));
});

test('createElement: 10 种类型各产出对应标签且无 data-ws2-* 标记', () => {
  const doc = docOf();
  const expect = {
    container: 'DIV', text: 'P', heading: 'H2', table: 'TABLE', image: 'IMG',
    button: 'BUTTON', divider: 'HR', link: 'A', list: 'UL', quote: 'BLOCKQUOTE',
  };
  for (const [type, tag] of Object.entries(expect)) {
    const el = insert.createElement(doc, type);
    assert.equal(el.tagName, tag, type + ' → ' + tag);
    // 插入内容不带任何编辑器标记（KTD4）
    for (const a of el.attributes) assert.ok(!a.name.startsWith('data-ws2-'), type + ' 不应有 ' + a.name);
  }
});

test('createElement(table): 2x2 <table> 带 tbody/tr/td', () => {
  const doc = docOf();
  const el = insert.createElement(doc, 'table');
  assert.equal(el.querySelectorAll('tbody').length, 1);
  assert.equal(el.querySelectorAll('tr').length, 2);
  assert.equal(el.querySelectorAll('td').length, 4);
});

test('createElement(未知类型) → null', () => {
  assert.equal(insert.createElement(docOf(), 'nope'), null);
});

test('placeFloat: position absolute、left/top 含 scroll 偏移', () => {
  const doc = docOf();
  const el = insert.createElement(doc, 'text');
  insert.placeFloat(doc, el, 120, 200, { scrollX: 0, scrollY: 50 });
  assert.equal(el.style.position, 'absolute');
  assert.equal(el.style.left, '120px');
  assert.equal(el.style.top, '250px');
  assert.equal(el.parentElement, doc.body);
});

test('placeFlow(selectedP): 插在被选元素之后', () => {
  const doc = docOf('<p id="p1">a</p><p id="p2">b</p>');
  const p1 = doc.getElementById('p1');
  const el = insert.createElement(doc, 'heading');
  insert.placeFlow(doc, el, p1);
  assert.equal(p1.nextElementSibling, el);
});

test('placeFlow(null): 插到 body 首位', () => {
  const doc = docOf('<p id="p1">a</p>');
  const el = insert.createElement(doc, 'heading');
  insert.placeFlow(doc, el, null);
  assert.equal(doc.body.firstElementChild, el);
});

test('serialize-clean: placeFloat 后存盘含 inline position/left/top，无 data-ws2-*', () => {
  const doc = docOf();
  const el = insert.createElement(doc, 'button');
  insert.placeFloat(doc, el, 120, 200, { scrollX: 0, scrollY: 50 });
  const out = serializeDocument(doc);
  assert.ok(/position:\s*absolute/.test(out));
  assert.ok(/left:\s*120px/.test(out));
  assert.ok(/top:\s*250px/.test(out));
  assert.ok(!out.includes('data-ws2-'));
});
