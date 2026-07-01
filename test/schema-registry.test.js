// Schema 注册表 + 分类器：多 Schema 就绪（不写死单一 schema）。classify 遍历已注册 schema 认出属于哪个。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const reg = require('../src/lib/schema-registry.js');

const docOf = (b) => new JSDOM(
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>' + b + '</body></html>'
).window.document;

test('classify: 合规文档 → schemaId=schema-1, conform=true', () => {
  const r = reg.classify(docOf('<h1>标题</h1><p>正文</p><ul><li>a</li></ul>'));
  assert.equal(r.schemaId, 'schema-1');
  assert.equal(r.conform, true);
  assert.deepEqual(r.violations, []);
});

test('classify: 非合规文档 → schemaId=null, conform=false, 带 violations', () => {
  const r = reg.classify(docOf('<p>x</p><script>steal()</' + 'script>'));
  assert.equal(r.schemaId, null);
  assert.equal(r.conform, false);
  assert.ok(r.violations.length > 0, '应带上 schema-1 的违规明细');
});

test('schemas(): 至少注册了 schema-1', () => {
  assert.ok(reg.schemas().some((s) => s.id === 'schema-1'));
});

test('register + classify：detect 命中但 validate 不过 → 继续试下一个 schema（多 schema 分派）', () => {
  // 注册一个只在有 <marker-x> 时 detect 命中、且恒 conform 的测试 schema。
  // schema-1 detect 恒真但对 <marker-x> validate 不过（block-tag）→ 遍历继续 → test-only 命中。
  reg.register({ id: 'test-only', detect: (d) => d.querySelector('marker-x') != null, validate: () => ({ conform: true, violations: [] }) });
  const r = reg.classify(docOf('<marker-x></marker-x>'));
  assert.equal(r.schemaId, 'test-only');
  assert.equal(r.conform, true);
  // 加了新 schema 不影响原有分派：合规文档仍认 schema-1（先注册先试）
  assert.equal(reg.classify(docOf('<p>ok</p>')).schemaId, 'schema-1');
});
