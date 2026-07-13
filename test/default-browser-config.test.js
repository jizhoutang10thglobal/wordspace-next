const test = require('node:test');
const assert = require('node:assert');
const pkg = require('../package.json');

// macOS「设为默认浏览器」的前提是打包 Info.plist 声明 http/https URL scheme（CFBundleURLTypes,
// electron-builder 由 build.protocols 生成）。这份声明只在打包产物里生效、e2e 摸不到,
// 所以在这里锁配置：谁删了 protocols,macOS 默认浏览器候选列表里就再也没有 Wordspace(Wendi 案)。

test('build.protocols 声明 http + https（默认浏览器候选资格）', () => {
  const schemes = (pkg.build.protocols || []).flatMap((p) => p.schemes || []);
  assert.ok(schemes.includes('http'), 'protocols 缺 http scheme');
  assert.ok(schemes.includes('https'), 'protocols 缺 https scheme');
});

test('build.fileAssociations 声明 html/htm（Finder「打开方式」候选）', () => {
  const exts = (pkg.build.fileAssociations || []).flatMap((a) => a.ext || []);
  assert.ok(exts.includes('html') && exts.includes('htm'), 'fileAssociations 缺 html/htm');
});
