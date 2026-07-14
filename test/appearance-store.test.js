'use strict';
// 外观偏好存储单测:偏好往返、缺省 system、非法值回落、损坏文件容错、跨 init 持久化。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-appearance-'));
}
function loadFresh() {
  delete require.cache[require.resolve('../src/main/appearance-store')];
  return require('../src/main/appearance-store');
}

test('缺省(无文件) → system', () => {
  const dir = freshDir();
  const s = loadFresh();
  assert.strictEqual(s.init(dir), 'system');
  assert.strictEqual(s.getPref(), 'system');
});

test('偏好往返:写 dark 读 dark(同实例 + 重开)', () => {
  const dir = freshDir();
  let s = loadFresh();
  s.init(dir);
  assert.strictEqual(s.setPref('dark'), 'dark');
  assert.strictEqual(s.getPref(), 'dark');
  // 重新 init(模拟重启) → 仍 dark
  s = loadFresh();
  assert.strictEqual(s.init(dir), 'dark');
});

test('非法值回落 system', () => {
  const dir = freshDir();
  const s = loadFresh();
  s.init(dir);
  assert.strictEqual(s.setPref('bogus'), 'system');
  assert.strictEqual(s.setPref(null), 'system');
});

test('损坏 JSON → system(不崩)', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'appearance.json'), '{ not json', 'utf8');
  const s = loadFresh();
  assert.strictEqual(s.init(dir), 'system');
});

test('落盘格式 = { version, pref }', () => {
  const dir = freshDir();
  const s = loadFresh();
  s.init(dir);
  s.setPref('light');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'appearance.json'), 'utf8'));
  assert.deepStrictEqual(onDisk, { version: 1, pref: 'light' });
});
