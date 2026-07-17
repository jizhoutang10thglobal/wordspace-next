'use strict';
// 语言偏好存储单测(照 appearance-store.test.js):偏好往返、缺省 system、非法值回落、损坏容错、跨 init 持久化、落盘格式。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-language-'));
}
function loadFresh() {
  delete require.cache[require.resolve('../src/main/language-store')];
  return require('../src/main/language-store');
}

test('缺省(无文件) → system', () => {
  const dir = freshDir();
  const s = loadFresh();
  assert.strictEqual(s.init(dir), 'system');
  assert.strictEqual(s.getPref(), 'system');
});

test('偏好往返:写 en 读 en(同实例 + 重开)', () => {
  const dir = freshDir();
  let s = loadFresh();
  s.init(dir);
  assert.strictEqual(s.setPref('en'), 'en');
  assert.strictEqual(s.getPref(), 'en');
  s = loadFresh();
  assert.strictEqual(s.init(dir), 'en'); // 重启后仍 en
});

test('zh 也能往返', () => {
  const dir = freshDir();
  const s = loadFresh();
  s.init(dir);
  assert.strictEqual(s.setPref('zh'), 'zh');
  assert.strictEqual(s.getPref(), 'zh');
});

test('非法值回落 system', () => {
  const dir = freshDir();
  const s = loadFresh();
  s.init(dir);
  assert.strictEqual(s.setPref('bogus'), 'system');
  assert.strictEqual(s.setPref(null), 'system');
  assert.strictEqual(s.setPref('light'), 'system'); // 外观的值不是语言的合法值
});

test('损坏 JSON → system(不崩)', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'language.json'), '{ not json', 'utf8');
  const s = loadFresh();
  assert.strictEqual(s.init(dir), 'system');
});

test('落盘格式 = { version, pref }，文件名 language.json', () => {
  const dir = freshDir();
  const s = loadFresh();
  s.init(dir);
  s.setPref('en');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'language.json'), 'utf8'));
  assert.deepStrictEqual(onDisk, { version: 1, pref: 'en' });
});
