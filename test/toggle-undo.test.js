// U10（KD5）纯逻辑门：撤销层剥 <details open>、存盘层保留。node:test + jsdom（真 app 无 vitest）。
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const S = require('../src/editor/serialize.js');

test('cleanedBodyHtml 剥 details open（撤销层）；serializeDocument 保留（存盘层）', () => {
  const dom = new JSDOM('<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"></head><body>'
    + '<details open><summary>标题</summary><p>正文</p></details><p>后段</p></body></html>');
  const doc = dom.window.document;

  const cleaned = S.cleanedBodyHtml(doc.body);
  assert.ok(!/details open/.test(cleaned), 'cleanedBodyHtml 应剥掉 open（折叠态不进撤销）');
  assert.ok(/<details><summary>标题<\/summary>/.test(cleaned), 'cleanedBodyHtml 结构应保留（只剥 open）');

  const full = S.serializeDocument(doc);
  assert.ok(/<details open[^>]*><summary>标题<\/summary>/.test(full), 'serializeDocument 应保留 open（存盘持久化 R7）');
});

test('无 open 的 details：两侧都不加 open（不无中生有）', () => {
  const dom = new JSDOM('<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"></head><body>'
    + '<details><summary>s</summary><p>b</p></details></body></html>');
  const doc = dom.window.document;
  assert.ok(!/details open/.test(S.cleanedBodyHtml(doc.body)));
  assert.ok(!/details open/.test(S.serializeDocument(doc)));
});
