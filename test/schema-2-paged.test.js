// Schema #2「分页文档」归类：descriptor 单测 + 经 registry.classify 的四行归类矩阵。
// 口径 = 对磁盘字节 reparse 的 DOM（JSDOM），归类只认内容、不看 <meta>。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const reg = require('../src/lib/schema-registry.js');
const s2 = require('../src/lib/schema-2-paged.js');
const P = require('../src/lib/schema-page.js');

const CANON = P.buildPageCss(P.DEFAULT_PAGE); // 合法 canonical @page（A4 默认）
const CANON_A3 = P.buildPageCss({ size: 'A3', orientation: 'landscape', margin: P.MARGIN_PRESETS.wide });

// 组一份文档：可选 meta 自称、可选一串 page <style>、body 内容。
function docOf({ schemaMeta, pageBlocks = [], body = '<h1>标题</h1><p>正文</p>' } = {}) {
  const metaTag = schemaMeta != null ? `<meta name="wordspace-schema" content="${schemaMeta}">` : '';
  const styles = pageBlocks.map((css) => `<style data-ws-schema-css="page">${css}</style>`).join('');
  return new JSDOM(
    `<!DOCTYPE html><html><head><meta charset="utf-8">${metaTag}<title>t</title>${styles}</head><body>${body}</body></html>`
  ).window.document;
}

// ---- 归类矩阵四行 ----

test('矩阵①：结构合规 + page 块可解析 → schema-2', () => {
  const r = reg.classify(docOf({ pageBlocks: [CANON] }));
  assert.equal(r.schemaId, 'schema-2');
  assert.equal(r.conform, true);
  assert.deepEqual(r.violations, []);
});

test('矩阵②:结构合规 + 无 page 块 → schema-1（流式）', () => {
  const r = reg.classify(docOf({ pageBlocks: [] }));
  assert.equal(r.schemaId, 'schema-1');
  assert.equal(r.conform, true);
});

test('矩阵③:结构合规 + page 块写坏 → schema-1（宽容回退，不降级）', () => {
  for (const bad of ['@page{}', '@page{size:Banana portrait}', 'not css at all', '@page{margin:3cm}', '.x{color:red}']) {
    const r = reg.classify(docOf({ pageBlocks: [bad] }));
    assert.equal(r.schemaId, 'schema-1', `写坏样本应回退 schema-1: ${bad}`);
    assert.equal(r.conform, true, `写坏但结构合规仍可块编辑: ${bad}`);
  }
});

test('矩阵④:结构不合规 → schemaId=null（含带 page 块的情形）', () => {
  const bad = '<p>x</p><script>steal()</' + 'script>';
  assert.equal(reg.classify(docOf({ body: bad })).schemaId, null);
  // 带一个合法 page 块但 body 不合规 → 仍 null（结构优先，schema-2 的 validate 先过结构关）
  const r = reg.classify(docOf({ pageBlocks: [CANON], body: bad }));
  assert.equal(r.schemaId, null);
  assert.equal(r.conform, false);
  assert.ok(r.violations.length > 0, '带上结构违规明细');
});

// ---- 多 page 块：一律取首个 ----

test('多 page 块：双合法不同值 → schema-2（按首个）', () => {
  const r = reg.classify(docOf({ pageBlocks: [CANON, CANON_A3] }));
  assert.equal(r.schemaId, 'schema-2');
});

test('多 page 块:首坏次好 → schema-1（首个写坏=写坏回退，不看第二块）', () => {
  const r = reg.classify(docOf({ pageBlocks: ['@page{}', CANON] }));
  assert.equal(r.schemaId, 'schema-1', '首块写坏就回退，不许被第二块救活');
});

// ---- 归类只认内容，不看 meta（铁律①）----

test('meta 自称 content="2" 但无 page 块 → schema-1', () => {
  assert.equal(reg.classify(docOf({ schemaMeta: '2', pageBlocks: [] })).schemaId, 'schema-1');
});

test('meta 自称 content="1" 但有合法 page 块 → schema-2（内容优先）', () => {
  assert.equal(reg.classify(docOf({ schemaMeta: '1', pageBlocks: [CANON] })).schemaId, 'schema-2');
});

// ---- descriptor 直测 ----

test('descriptor: detect 只看 page 块存在，validate 才判可解析', () => {
  assert.equal(s2.id, 'schema-2');
  assert.equal(s2.detect(docOf({ pageBlocks: [CANON] })), true);
  assert.equal(s2.detect(docOf({ pageBlocks: [] })), false);
  assert.equal(s2.detect(docOf({ pageBlocks: ['@page{}'] })), true, 'detect 宽容：写坏的块也命中候选');
  assert.equal(s2.validate(docOf({ pageBlocks: ['@page{}'] })).conform, false, 'validate 权威：写坏不认');
  assert.equal(s2.validate(docOf({ pageBlocks: [CANON] })).conform, true);
});

// ---- 注册顺序 = 归类优先级（前两位锁死 schema-2, schema-1）----

test('schemas(): 前两位序列 = [schema-2, schema-1]（顺序即归类优先级）', () => {
  const ids = reg.schemas().map((s) => s.id);
  assert.equal(ids[0], 'schema-2', 'schema-2 必须先试');
  assert.equal(ids[1], 'schema-1', 'schema-1 兜底在后');
});

test('require(registry) 即拿到满员注册表（护住 e2e node 侧 classify 消费方）', () => {
  const fresh = require('../src/lib/schema-registry.js'); // 已缓存的同实例即可；关键是 require 后 classify 立刻可用
  assert.equal(fresh.classify(docOf({ pageBlocks: [CANON] })).schemaId, 'schema-2');
  assert.equal(fresh.classify(docOf({ pageBlocks: [] })).schemaId, 'schema-1');
});
