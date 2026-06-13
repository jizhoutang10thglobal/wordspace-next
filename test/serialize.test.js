const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const blocks = require('../src/editor/blocks.js');
const { serializeDocument } = require('../src/editor/serialize.js');

const SAMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>p { color: red; }</style></head><body><div class="wrap"><p>一段文字</p><table><tbody><tr><td>x</td></tr></tbody></table></div><script>var a = 1;</' + 'script></body></html>';

test('roundtrip: applyEditable + injected ui + serialize == original structure', () => {
  const dom = new JSDOM(SAMPLE);
  const doc = dom.window.document;
  blocks.applyEditable(doc);
  const ui = doc.createElement('div');
  ui.setAttribute('data-ws2-ui', '');
  ui.textContent = 'toolbar';
  doc.documentElement.appendChild(ui);

  const out = serializeDocument(doc);

  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.ok(!out.includes('data-ws2'));
  assert.ok(!out.includes('contenteditable'));
  assert.ok(!out.includes('toolbar'));
  assert.ok(out.includes('var a = 1;'));
  assert.ok(out.includes('p { color: red; }'));

  const expected = new JSDOM(SAMPLE).window.document.documentElement.outerHTML;
  const actual = new JSDOM(out).window.document.documentElement.outerHTML;
  assert.equal(actual, expected);
});

test('does not strip pre-existing contenteditable that document itself had', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div contenteditable="true">own</div></body></html>');
  const doc = dom.window.document;
  blocks.applyEditable(doc);
  const out = serializeDocument(doc);
  assert.ok(out.includes('contenteditable="true"'));
});

test('preserves top-level comments and legacy doctype', () => {
  const src = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><!-- saved from url=(0042)https://example.com --><html><head></head><body><p>a</p></body></html>';
  const dom = new JSDOM(src);
  const doc = dom.window.document;
  blocks.applyEditable(doc);
  const out = serializeDocument(doc);
  assert.ok(out.includes('<!-- saved from url=(0042)https://example.com -->'));
  assert.ok(out.includes('PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'));
  assert.ok(out.includes('"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"'));
  assert.ok(!out.includes('data-ws2'));
});
