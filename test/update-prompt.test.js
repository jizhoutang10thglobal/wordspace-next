const test = require('node:test');
const assert = require('node:assert');
const {
  buildUpdateDialogOptions, shouldInstall,
  buildAvailableDialogOptions, shouldDownload,
  buildUpToDateDialogOptions, buildCheckErrorDialogOptions, buildDevDialogOptions,
} = require('../src/lib/update-prompt');

test('弹窗选项：版本号入 message、两按钮、默认立即重启、Esc 落稍后', () => {
  const opts = buildUpdateDialogOptions('0.1.0');
  assert.ok(opts.message.includes('v0.1.0'));
  assert.deepEqual(opts.buttons, ['立即重启', '稍后']);
  assert.equal(opts.buttons[opts.defaultId], '立即重启');
  assert.equal(opts.buttons[opts.cancelId], '稍后');
});

test('拿不到版本号不显示 undefined', () => {
  const opts = buildUpdateDialogOptions(undefined);
  assert.ok(!opts.message.includes('undefined'));
  assert.ok(opts.message.includes('已下载'));
});

test('选立即重启判装、稍后判不装', () => {
  const opts = buildUpdateDialogOptions('0.1.0');
  assert.equal(shouldInstall(opts.defaultId), true);
  assert.equal(shouldInstall(opts.cancelId), false);
});

// 手动检查更新的弹窗逻辑（U1）-----------------------------------------------------

test('发现新版本弹窗：版本入 message、两按钮、默认下载、Esc 落以后', () => {
  const opts = buildAvailableDialogOptions('0.3.0');
  assert.ok(opts.message.includes('v0.3.0'));
  assert.deepEqual(opts.buttons, ['下载并安装', '以后']);
  assert.equal(opts.buttons[opts.defaultId], '下载并安装');
  assert.equal(opts.buttons[opts.cancelId], '以后');
});

test('发现新版本弹窗：拿不到版本号不显示 undefined / 多余空格', () => {
  const opts = buildAvailableDialogOptions(undefined);
  assert.ok(!opts.message.includes('undefined'));
  assert.equal(opts.message, '发现新版本');
});

test('选下载判下、选以后判不下', () => {
  const opts = buildAvailableDialogOptions('0.3.0');
  assert.equal(shouldDownload(opts.defaultId), true);
  assert.equal(shouldDownload(opts.cancelId), false);
});

test('已是最新弹窗：含当前版本号、单确认钮', () => {
  const opts = buildUpToDateDialogOptions('0.2.0');
  assert.ok(opts.message.includes('最新'));
  assert.ok(opts.detail.includes('v0.2.0'));
  assert.deepEqual(opts.buttons, ['好']);
});

test('已是最新弹窗：拿不到版本号不显示 undefined', () => {
  const opts = buildUpToDateDialogOptions(undefined);
  assert.ok(!opts.detail.includes('undefined'));
});

test('检查失败弹窗 = error 类型、单确认钮', () => {
  const opts = buildCheckErrorDialogOptions();
  assert.equal(opts.type, 'error');
  assert.deepEqual(opts.buttons, ['好']);
});

test('开发模式弹窗：提示无法检查更新、单确认钮', () => {
  const opts = buildDevDialogOptions();
  assert.ok(opts.message.includes('开发模式'));
  assert.deepEqual(opts.buttons, ['好']);
});
