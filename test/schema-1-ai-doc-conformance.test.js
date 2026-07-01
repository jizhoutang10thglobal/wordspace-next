// U3：AI 创作文档 ↔ 校验器 一致性门（防漂移，KD-b）。
//   ① U2 文档里的完整样例必须全 conform（把文档钉在校验器上）；
//   ② 每个 canonical 块 conform；
//   ③ 反例覆盖校验器全部 rule、各命中期望 rule；
//   ④ 元测试：反例命中的 rule 集合 ⊇ 校验器源码里的 rule 全集（校验器新增 rule 没补反例就红）。
// 注：fixtures 用内联数组（非散落 .html 文件）——把「html+期望 rule」放一起更不易错，
//     元测试给的防漂移保证与文件式等价。断言一律用「violations 含期望 rule」（一个反例可命中多条）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { validate } = require('../src/lib/schema-validate.js');

const docOf = (html) => new JSDOM(html).window.document;
const SK = (body) => '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="wordspace-schema" content="1"><title>t</title></head><body>' + body + '</body></html>';
const SKH = (head) => '<!DOCTYPE html><html><head><meta charset="utf-8">' + head + '</head><body><p>ok</p></body></html>';
const v = (html) => validate(docOf(html));
const rulesOf = (r) => r.violations.map((x) => x.rule);

// ---- 正例①：U2 文档里每个完整 <!doctype 样例都必须 conform（doc↔校验器直接绑定）----
const AUTHORING = fs.readFileSync(path.join(__dirname, '..', 'docs', 'schema-1-ai-authoring.md'), 'utf8');
const docFences = [...AUTHORING.matchAll(/```html\n(<!doctype[\s\S]*?)\n```/gi)].map((m) => m[1]);
test('U2 文档里的完整样例全部 conform（doc↔校验器绑定）', () => {
  assert.ok(docFences.length >= 2, '没抽到文档样例（≥2）');
  for (const html of docFences) {
    const r = v(html);
    assert.equal(r.conform, true, '文档样例不合规: ' + JSON.stringify(r.violations));
  }
});

// ---- 正例②：每个 canonical 块 conform ----
const OK_BLOCKS = {
  paragraph: '<p>文字 <b>粗</b> <i>斜</i> <code>c</code> <a href="https://x.com">链</a></p>',
  headings: '<h1>一</h1><h2>二</h2><h3>三</h3><h4>四</h4>',
  ul: '<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul>',
  ol: '<ol start="3"><li>a</li></ol>',
  todo: '<ul class="ws-todo"><li data-checked="true">x</li><li data-checked="false">y</li></ul>',
  blockquote: '<blockquote><p>引用</p><p>多段</p></blockquote>',
  callout: '<div class="ws-callout"><p>提示</p></div>',
  hr: '<hr>',
  table: '<table class="ws-table"><thead><tr><th>a</th><th class="ws-al-right">b</th></tr></thead>' +
    '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
  toggle: '<details open><summary>t</summary><p>正文</p><ul><li>x</li></ul></details>',
  img: '<img src="data:image/png;base64,AAAA">',
  figure: '<figure><img src="x"><figcaption>说明</figcaption></figure>',
  inline: '<p><b><i>叠</i></b> <mark>高亮</mark> <span style="color:#c00">红</span><br>换行</p>',
};
for (const [name, body] of Object.entries(OK_BLOCKS)) {
  test('canonical 块 conform: ' + name, () => {
    const r = v(SK(body));
    assert.equal(r.conform, true, JSON.stringify(r.violations));
  });
}

// ---- 反例：每条 rule 至少一个被拒例子（key = 期望命中的 rule；触发形态均已实测）----
const BAD_BODY = {
  'script': '<p>x</p><script>steal()</' + 'script>',
  'event-attr': '<p onclick="x()">hi</p>',
  'unsafe-href': '<p><a href="javascript:alert(1)">z</a></p>',
  'nested-block': '<blockquote><ul><li>x</li></ul></blockquote>', // 容器嵌块（不用 p 嵌 div，那会被 reparse 拆成 block-tag）
  'list-child': '<ul><div>x</div></ul>',
  'todo-checked': '<ul class="ws-todo"><li data-checked="maybe">x</li></ul>',
  'li-content': '<ul><li><p>x</p></li></ul>',
  'table-merge': '<table class="ws-table"><tbody><tr><td colspan="2">m</td></tr></tbody></table>',
  'cell-content': '<table class="ws-table"><tbody><tr><td><p>x</p></td></tr></tbody></table>',
  'table-structure': '<table class="ws-table"><caption>t</caption><tbody><tr><td>a</td></tr></tbody></table>',
  'table-ragged': '<table class="ws-table"><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>',
  'figure-content': '<figure><img src="x"><p>y</p></figure>',
  'figcaption-content': '<figure><img src="x"><figcaption><p>y</p></figcaption></figure>',
  'block-style': '<p style="color:red">x</p>',
  'block-tag': '<h5>五级</h5>',
  'details-summary': '<details><p>x</p></details>',
  'details-summary-content': '<details><summary>t<p>x</p></summary></details>',
};
const BAD_HEAD = {
  'head-meta-http-equiv': '<meta http-equiv="refresh" content="0;url=https://e">',
  'head-style': '<style>p{color:red}</style>',
  'head-base': '<base href="https://e/">',
  'head-link': '<link rel="stylesheet" href="https://e/x.css">',
  'head-tag': '<noscript>x</noscript>',
};
for (const [rule, body] of Object.entries(BAD_BODY)) {
  test('反例被拒 + 命中 ' + rule, () => {
    const r = v(SK(body));
    assert.equal(r.conform, false);
    assert.ok(rulesOf(r).includes(rule), '期望命中 ' + rule + '，实际: ' + rulesOf(r).join(','));
  });
}
for (const [rule, head] of Object.entries(BAD_HEAD)) {
  test('反例被拒 + 命中 ' + rule + '（head）', () => {
    const r = v(SKH(head));
    assert.equal(r.conform, false);
    assert.ok(rulesOf(r).includes(rule), '期望命中 ' + rule + '，实际: ' + rulesOf(r).join(','));
  });
}

// ---- 元测试（防漏钉）：反例命中的 rule 集合 ⊇ 校验器源码里的 rule 全集 ----
test('元测试：反例覆盖校验器全部 rule（校验器新增 rule 没补反例就红）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'schema-validate.js'), 'utf8');
  const srcRules = new Set();
  for (const m of src.matchAll(/rule:\s*'([a-z-]+)'/g)) srcRules.add(m[1]);           // 直接 push 的 rule 字面量
  for (const m of src.matchAll(/phrasingOnly\([^,]+,[^,]+,\s*'([a-z-]+)'/g)) srcRules.add(m[1]); // phrasingOnly 第三参
  const hit = new Set();
  for (const body of Object.values(BAD_BODY)) v(SK(body)).violations.forEach((x) => hit.add(x.rule));
  for (const head of Object.values(BAD_HEAD)) v(SKH(head)).violations.forEach((x) => hit.add(x.rule));
  const missing = [...srcRules].filter((r) => !hit.has(r));
  assert.deepEqual(missing, [], '这些校验器 rule 没有反例覆盖: ' + missing.join(', '));
});
