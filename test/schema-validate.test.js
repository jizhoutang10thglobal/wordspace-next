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

// ===== 对抗验证攻破：安全绕过 + 校验盲区（全部 node 真跑确认过）=====

test('P0-1 href 控制字符/空白绕过 → unsafe-href（浏览器导航会剥 tab/newline/前导控制字符再执行）', () => {
  assert.equal(v('<p><a href="java\tscript:alert(1)">x</a></p>').conform, false);
  assert.equal(v('<p><a href="java\nscript:alert(1)">x</a></p>').conform, false);
  assert.equal(v('<p><a href="\x01javascript:alert(1)">x</a></p>').conform, false);
  assert.equal(v('<p><a href="https://ok.com">x</a></p>').conform, true); // 不误杀正常 https
});

test('P0-2 SVG 命名空间 <script> → script（命名空间无关，不被小写 tagName 绕过）', () => {
  const r = v('<table class="ws-table"><tbody><tr><td><svg><script>alert(1)</' + 'script></svg></td></tr></tbody></table>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('script'));
});

test('P1-2 表格单元格只能 phrasing：iframe/object/块 → non-conform；纯行内 cell 仍 conform', () => {
  assert.equal(v('<table class="ws-table"><tbody><tr><td><iframe src="https://evil"></iframe></td></tr></tbody></table>').conform, false);
  assert.equal(v('<table class="ws-table"><tbody><tr><td><p>x</p></td></tr></tbody></table>').conform, false);
  assert.equal(v('<table class="ws-table"><tbody><tr><td><ul><li>x</li></ul></td></tr></tbody></table>').conform, false);
  assert.equal(v('<table class="ws-table"><tbody><tr><td>x <b>粗</b></td></tr></tbody></table>').conform, true);
});

test('P1-3 head 白名单：base/meta-refresh/外联 link/作者 style → non-conform；schema-css 合法', () => {
  const mk = (headExtra) => validate(docOf('<!DOCTYPE html><html><head>' + headExtra + '</head><body><p>x</p></body></html>'));
  assert.equal(mk('<base href="https://evil/">').conform, false);
  assert.equal(mk('<meta http-equiv="refresh" content="0;url=https://evil">').conform, false);
  assert.equal(mk('<link rel="stylesheet" href="https://evil/x.css">').conform, false);
  assert.equal(mk('<style>@import url(https://evil/x.css)</style>').conform, false);
  assert.equal(mk('<style data-ws-schema-css="baseline">p{margin:0}</style>').conform, true);
});

test('P2-1 表格不变式：非矩形 / caption / 多行 thead → non-conform', () => {
  assert.equal(v('<table class="ws-table"><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>').conform, false);
  assert.equal(v('<table class="ws-table"><caption>t</caption><tbody><tr><td>a</td></tr></tbody></table>').conform, false);
});

test('P2-2 块级 style → non-conform（带 style 块走基础编辑，显示仍原生）；行内 span style 仍合法', () => {
  assert.equal(v('<p style="color:red">x</p>').conform, false);
  assert.equal(v('<p><span style="color:red">x</span></p>').conform, true);
});

test('P2-3 figure+figcaption 合法（§5 captioned image canonical）', () => {
  assert.equal(v('<figure><img src="data:image/png;base64,AAAA"><figcaption>说明</figcaption></figure>').conform, true);
  assert.equal(v('<figure><img src="x"><p>不该有块</p></figure>').conform, false);
});
