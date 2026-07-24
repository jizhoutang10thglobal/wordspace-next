// 分页文档 AI 创作文档 ↔ 归类器 一致性门（防漂移，对齐 schema-1-ai-doc-conformance）：
//   ① docs/schema-2-ai-authoring.md 里的完整 <!doctype 样例必须 classify → schema-2（把文档钉在归类器上）；
//   ② 文档里出现的 page 块示例都必须 parsePageCss 成功（写坏 = 教 AI 写坏 = 红）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const registry = require('../src/lib/schema-registry.js');
const P = require('../src/lib/schema-page.js');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'schema-2-ai-authoring.md'), 'utf8');
const fullSamples = [...DOC.matchAll(/```html\n(<!doctype[\s\S]*?)\n```/gi)].map((m) => m[1]);
const pageBlocks = [...DOC.matchAll(/data-ws-schema-css="page">([^<]*)<\/style>/g)].map((m) => m[1]);

test('schema-2 文档里的完整样例 classify → schema-2（doc↔归类器绑定）', () => {
  assert.ok(fullSamples.length >= 1, '没抽到完整 <!doctype 样例（≥1）');
  for (const html of fullSamples) {
    const r = registry.classify(new JSDOM(html).window.document);
    assert.equal(r.schemaId, 'schema-2', 'schema-2 文档样例必须归类 schema-2: ' + JSON.stringify(r.violations));
  }
});

test('文档里的 page 块示例都能 parsePageCss（教 AI 写对的那条不能写坏）', () => {
  assert.ok(pageBlocks.length >= 1, '没抽到 page 块示例');
  for (const css of pageBlocks) {
    assert.ok(P.parsePageCss(css), 'page 块示例应可解析成 canonical @page: ' + css);
  }
});
