const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const blocks = require('../src/editor/blocks.js');
const { serializeDocument, OVERLAY_VAL } = require('../src/editor/serialize.js');

const SAMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>p { color: red; }</style></head><body><div class="wrap"><p>一段文字</p><table><tbody><tr><td>x</td></tr></tbody></table></div><script>var a = 1;</' + 'script></body></html>';

test('roundtrip: applyEditable + injected ui + serialize == original structure', () => {
  const dom = new JSDOM(SAMPLE);
  const doc = dom.window.document;
  blocks.applyEditable(doc);
  const ui = doc.createElement('div');
  ui.setAttribute('data-ws2-ui', OVERLAY_VAL); // 覆盖层用 sentinel 值（F1）
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

// U5：白名单 = 精确集合，不是前缀。用户文档自带的 data-ws2-* 属性必须原样保留（保真红线）；
// 编辑器自己的画布标记（data-ws2-canvas/-eid 等）必须剥掉。
test('whitelist is exact, not prefix: keeps author data-ws2-* but strips editor canvas markers', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' +
    '<div data-ws2-canvas data-ws2-eid="7" data-ws2-foo="keep" style="left:5px;">x</div>' +
    '</body></html>');
  const doc = dom.window.document;
  const out = serializeDocument(doc);
  // 编辑器标记剥掉
  assert.ok(!out.includes('data-ws2-canvas'), 'data-ws2-canvas 应被剥');
  assert.ok(!out.includes('data-ws2-eid'), 'data-ws2-eid 应被剥');
  // 用户自带属性 + 内联样式（拖动/缩放写的几何）保留
  assert.ok(out.includes('data-ws2-foo="keep"'), '用户自带 data-ws2-foo 必须保留（非前缀剥）');
  assert.ok(out.includes('left:'), '内联样式（画布几何）必须保留');
});

// F1（对抗审计）：文档自带 data-ws2-ui 属性的**元素及其内容**必须存盘不丢——它不是编辑器覆盖层。
// 编辑器覆盖层用 sentinel 值（OVERLAY_VAL）区分；用户写的任意值原样保留（保真红线）。
test('F1: 文档自带 data-ws2-ui 的元素及内容存盘不丢（不被当覆盖层整删）', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div data-ws2-ui="user-stuff">重要内容</div><p>正文</p></body></html>');
  const out = serializeDocument(dom.window.document);
  assert.ok(out.includes('重要内容'), '用户带 data-ws2-ui 的内容被误删（F1）');
  assert.ok(out.includes('正文'));
});

// 分页 strip-on-persist（P0）：V4 推挤是运行时视觉产物——块内切分的 paddingTop / 块级切页的
// marginTop（带 data-ws-pushed）必须在序列化前剥净；spacer（表格间隔行 / pre 行间隔 span）带
// OVERLAY_VAL 整删。漏一个 padding-top 进磁盘 = 块级 style 属性 = 文档瞬间非合规（block-style 规则）。
test('paged strip-on-persist: 剥 data-ws-pushed 的推挤样式、整删 spacer、保留用户 style', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' +
    '<ul><li data-ws-pushed="" style="padding-top:217px">推挤行</li><li>普通行</li></ul>' +
    '<p data-ws-pushed="" style="margin-top:333px">块级推挤</p>' +
    '<table><tbody>' +
      '<tr class="ws-page-spacer" data-ws2-ui="__ws2-overlay__" contenteditable="false"><td colspan="99" style="height:217px"></td></tr>' +
      '<tr><td>数据行</td></tr>' +
    '</tbody></table>' +
    '<pre>a\n<span class="ws-page-spacer" data-ws2-ui="__ws2-overlay__" style="display:block;height:217px"></span>b</pre>' +
    '<p style="margin-top:5px" data-ws-pushed="">用户没有的样式只剩我们注的——剥后 style 应整个消失</p>' +
    '</body></html>');
  const out = serializeDocument(dom.window.document);
  assert.ok(!out.includes('data-ws-pushed'), '推挤标记必须剥净');
  assert.ok(!out.includes('padding-top'), '推挤 paddingTop 必须剥净（漏一个 = 非合规）');
  assert.ok(!out.includes('ws-page-spacer'), 'spacer 必须整删');
  assert.ok(out.includes('推挤行') && out.includes('普通行') && out.includes('数据行'), '用户内容不丢');
  assert.ok(out.includes('a\n') && out.includes('b</pre>'), 'pre 文本不丢（spacer span 删除后原文完整）');
  assert.ok(!/style=""/.test(out), '剥空后的 style 属性应整个移除');
});

// 用户自带的 class="ws-page-spacer"（无 OVERLAY sentinel）不是我们的节点——绝不整删（保真红线 F1 同款）。
test('paged strip 保真：用户自带 class=ws-page-spacer 的元素不被误删', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="ws-page-spacer">用户的内容</div></body></html>');
  const out = serializeDocument(dom.window.document);
  assert.ok(out.includes('用户的内容'), '用户元素被误删');
});
