'use strict';
// 外观三态纯逻辑单测（有效主题计算 + 偏好归一化）。
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePref, effectiveTheme, PREFS } = require('../src/lib/appearance');

test('normalizePref：合法透传，非法/空/null 回落 system', () => {
  assert.strictEqual(normalizePref('light'), 'light');
  assert.strictEqual(normalizePref('dark'), 'dark');
  assert.strictEqual(normalizePref('system'), 'system');
  assert.strictEqual(normalizePref('bogus'), 'system');
  assert.strictEqual(normalizePref(''), 'system');
  assert.strictEqual(normalizePref(null), 'system');
  assert.strictEqual(normalizePref(undefined), 'system');
});

test('effectiveTheme：六种组合', () => {
  assert.strictEqual(effectiveTheme('system', true), 'dark');   // system + 系统暗 → dark
  assert.strictEqual(effectiveTheme('system', false), 'light'); // system + 系统亮 → light
  assert.strictEqual(effectiveTheme('light', true), 'light');   // 显式 light 无视系统暗
  assert.strictEqual(effectiveTheme('dark', false), 'dark');    // 显式 dark 无视系统亮
  assert.strictEqual(effectiveTheme('bogus', true), 'dark');    // 非法偏好按 system
  assert.strictEqual(effectiveTheme('', false), 'light');       // 空按 system
});

test('PREFS 是三态', () => {
  assert.deepStrictEqual(PREFS, ['system', 'light', 'dark']);
});
