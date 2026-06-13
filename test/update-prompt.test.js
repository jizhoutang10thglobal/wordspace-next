const test = require('node:test');
const assert = require('node:assert');
const { buildUpdateDialogOptions, shouldInstall } = require('../src/lib/update-prompt');

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
