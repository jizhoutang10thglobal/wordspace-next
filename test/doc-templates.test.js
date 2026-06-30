const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { TEMPLATES } = require('../src/lib/doc-templates.js');
const { validate } = require('../src/lib/schema-validate.js');

test('blank is the first template', () => {
  assert.equal(TEMPLATES[0].id, 'blank');
  assert.equal(TEMPLATES[0].name, '空文档');
});

test('every template is a non-empty standalone HTML doc with the expected fields', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.id && t.name && t.base, `template fields: ${t.id}`);
    assert.equal(typeof t.html, 'string');
    assert.ok(t.html.trim().length > 0, `non-empty html: ${t.id}`);
    assert.match(t.html, /<html[\s>]/i, `has <html>: ${t.id}`);
    assert.match(t.html, /<body[\s>]/i, `has <body>: ${t.id}`);
    assert.match(t.html, /<h1[\s>]/i, `has a heading: ${t.id}`);
  }
});

// 「新建文档」feature 的后端真门：每个内置模板产出的 HTML 必须符合 Schema #1。
// 校验器（schema-validate）= 合规判定唯一权威；reparse 模板字节判（§4.3 铁律③）。
// 保证「新建 → 产出合法 Schema 文档」端到端成立；改模板若破坏 schema，这道门红。
for (const t of TEMPLATES) {
  test(`新建模板「${t.name}」(${t.id}) 产出符合 Schema #1`, () => {
    const doc = new JSDOM(t.html).window.document;
    const r = validate(doc);
    assert.equal(r.conform, true, `${t.id} 不符合 Schema: ` + JSON.stringify(r.violations, null, 2));
  });
}
