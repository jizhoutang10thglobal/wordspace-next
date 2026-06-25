const test = require('node:test');
const assert = require('node:assert');
const { TEMPLATES } = require('../src/lib/doc-templates.js');

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
