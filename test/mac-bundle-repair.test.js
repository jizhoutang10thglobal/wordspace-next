// mac-bundle-repair 纯逻辑单测：bundle 路径推导。
// （buildRepairArgs 及其转义测试已随 chown 修复方案一并删除——TCC 证死，见 lib 头注释。）
const { test } = require('node:test');
const assert = require('node:assert');
const repair = require('../src/lib/mac-bundle-repair');

test('bundlePathFromExe: 标准打包路径 → bundle 根', () => {
  assert.strictEqual(
    repair.bundlePathFromExe('/Applications/Wordspace Next.app/Contents/MacOS/Wordspace Next'),
    '/Applications/Wordspace Next.app'
  );
});

test('bundlePathFromExe: Helper 内路径 → 取最外层 .app（检测目标是整个安装单元）', () => {
  assert.strictEqual(
    repair.bundlePathFromExe('/Applications/A.app/Contents/Frameworks/B Helper.app/Contents/MacOS/B'),
    '/Applications/A.app'
  );
});

test('bundlePathFromExe: 非 .app / 非绝对路径 / 非字符串 → null', () => {
  assert.strictEqual(repair.bundlePathFromExe('/usr/local/bin/node'), null);
  assert.strictEqual(repair.bundlePathFromExe('relative/x.app/Contents/MacOS/x'), null);
  assert.strictEqual(repair.bundlePathFromExe(null), null);
});

test('bundlePathFromExe: 末段本身是 .app 不算（bundle 必须是可执行文件的祖先目录）', () => {
  assert.strictEqual(repair.bundlePathFromExe('/Applications/X.app'), null);
});
