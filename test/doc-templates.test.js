const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
// i18n Phase 2：模板 name/desc 改走 t() getter，配 zh 让下面的中文断言继续成立。
const _i18n = require('../src/lib/i18n');
_i18n.configureI18n(require('../src/i18n').ZH, require('../src/i18n').EN);
_i18n.setActiveLang('zh');
const { TEMPLATES } = require('../src/lib/doc-templates.js');
const { validate } = require('../src/lib/schema-validate.js');
const registry = require('../src/lib/schema-registry.js');

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

// 模板按范式归类：blank → schema-1(流式) / blank-paged → schema-2(分页)。
// 每个模板声明的 schema 字段必须与磁盘字节 classify 的结果一致（新建弹窗按 schema 过滤模板，错了会归错范式）。
test('每个模板产出的 HTML classify 结果 == 声明的 schema 字段', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.schema, `${t.id} 缺 schema 字段`);
    const id = registry.classify(new JSDOM(t.html).window.document).schemaId;
    assert.equal(id, t.schema, `${t.id} 应归类 ${t.schema}，实际 ${id}`);
  }
});

test('存在分页文档模板（schema-2），新建弹窗「分页文档」范式有卡可选', () => {
  const paged = TEMPLATES.filter((t) => t.schema === 'schema-2');
  assert.ok(paged.length >= 1, '至少一张 schema-2 分页模板');
  assert.match(paged[0].html, /data-ws-schema-css="page"/, '分页模板 head 带 page 块');
});
