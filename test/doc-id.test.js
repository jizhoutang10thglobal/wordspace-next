'use strict';
// U7 doc-id 注入/读取纯逻辑单测。
const { test } = require('node:test');
const assert = require('node:assert');
const { readDocId, ensureHtmlDocId } = require('../src/lib/doc-id');

const HEAD = (extra) => `<!doctype html><html><head><meta charset="utf-8">${extra || ''}</head><body><p>x</p></body></html>`;

test('readDocId：读到 / 读不到', () => {
  assert.strictEqual(readDocId(HEAD('<meta name="wordspace-doc-id" content="abc-123">')), 'abc-123');
  assert.strictEqual(readDocId(HEAD()), null);
  assert.strictEqual(readDocId(''), null);
});

test('ensureHtmlDocId：缺失 → 用 gen() 生成并插到 <head> 后', () => {
  const r = ensureHtmlDocId(HEAD(), { gen: () => 'GEN-ID' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.id, 'GEN-ID');
  assert.match(r.html, /<head[^>]*>\n<meta name="wordspace-doc-id" content="GEN-ID">/);
  assert.strictEqual(readDocId(r.html), 'GEN-ID');
});

test('ensureHtmlDocId：已有 → 原样不动（幂等）', () => {
  const src = HEAD('<meta name="wordspace-doc-id" content="keep-me">');
  const r = ensureHtmlDocId(src, { gen: () => 'NEW' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.id, 'keep-me'); // 绝不换 id
  assert.strictEqual(r.html, src);
});

test('ensureHtmlDocId：缺失但给了 opts.id（磁盘旧 id）→ 复用它、不 gen', () => {
  const r = ensureHtmlDocId(HEAD(), { id: 'disk-id', gen: () => 'SHOULD-NOT-USE' });
  assert.strictEqual(r.id, 'disk-id');
  assert.strictEqual(readDocId(r.html), 'disk-id');
});

test('ensureHtmlDocId：无 <head> → 不硬塞（changed=false）', () => {
  const r = ensureHtmlDocId('<body><p>野生无 head</p></body>', { gen: () => 'X' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.id, null);
});

test('ensureHtmlDocId：只加一行、其余字节不动', () => {
  const src = HEAD();
  const r = ensureHtmlDocId(src, { gen: () => 'ID' });
  // 去掉注入的那行应还原
  assert.strictEqual(r.html.replace('\n<meta name="wordspace-doc-id" content="ID">', ''), src);
});
