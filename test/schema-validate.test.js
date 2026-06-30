const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { validate } = require('../src/lib/schema-validate.js');

// 把磁盘字节 reparse 成 Document（§4.3 铁律③：判 reparse 出的 DOM、不判活 DOM）
function docOf(html) { return new JSDOM(html).window.document; }
const HEAD = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="wordspace-schema" content="1"></head><body>';
const FOOT = '</body></html>';
const v = (bodyHtml) => validate(docOf(HEAD + bodyHtml + FOOT));
const rules = (r) => r.violations.map((x) => x.rule);

test('合规文档 → conform', () => {
  const r = v('<h1>标题</h1><p>正文 <b>粗</b> <a href="https://x.com">链</a></p>' +
    '<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul>' +
    '<ul class="ws-todo"><li data-checked="true">x</li><li data-checked="false">y</li></ul>' +
    '<blockquote>引用</blockquote><div class="ws-callout"><p>提示</p></div><hr>');
  assert.equal(r.conform, true, JSON.stringify(r.violations));
});

test('铁律①：伪造 meta=1 + 内嵌 <script> → 仍 non-conform（不被 meta 骗）', () => {
  const r = v('<p>ok</p><script>steal()</' + 'script>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('script'));
});

test('on* 事件属性 → non-conform', () => {
  const r = v('<p onclick="x()">hi</p>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('event-attr'));
});

test('顶层非法块（section/任意 div/h5/h6）→ non-conform', () => {
  assert.equal(v('<section><p>x</p></section>').conform, false);
  assert.equal(v('<div>裸 div</div>').conform, false);
  const r = v('<h5>五级</h5>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('block-tag'));
});

test('ul/ol 直接子非 <li> → non-conform', () => {
  // 程序化塞 <p> 进 ul（绕过 parser 的内容模型纠正，确切构造违规）
  const doc = docOf(HEAD + '<ul><li>ok</li></ul>' + FOOT);
  doc.querySelector('ul').appendChild(doc.createElement('p'));
  const r = validate(doc);
  assert.equal(r.conform, false);
  assert.ok(r.violations.map((x) => x.rule).includes('list-child'));
});

test('叶子块/容器里含块级 → non-conform（callout 决策4：多段 <p> 可，列表/别的块不可）', () => {
  assert.equal(v('<div class="ws-callout"><p>a</p><p>b</p></div>').conform, true);
  assert.equal(v('<div class="ws-callout"><ul><li>x</li></ul></div>').conform, false);
});

test('表格：合并格 colspan/rowspan → non-conform；规整表 → conform', () => {
  assert.equal(v('<table class="ws-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>').conform, true);
  const r = v('<table class="ws-table"><tbody><tr><td colspan="2">m</td></tr></tbody></table>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('table-merge'));
});

test('to-do data-checked 值域 {true,false}，越界 → non-conform', () => {
  assert.equal(v('<ul class="ws-todo"><li data-checked="maybe">x</li></ul>').conform, false);
});

test('缺 schema meta 的合法文档仍 conform（marker 非必需）', () => {
  const r = validate(docOf('<!DOCTYPE html><html><head></head><body><p>手写</p></body></html>'));
  assert.equal(r.conform, true, JSON.stringify(r.violations));
});

test('行内 javascript: 链接 → non-conform', () => {
  const r = v('<p><a href="javascript:alert(1)">x</a></p>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('unsafe-href'));
});
