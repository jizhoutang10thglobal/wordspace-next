// mac-bundle-repair 纯逻辑单测：bundle 路径推导 + 提权命令构造（转义是安全关键——路径进 shell 的唯一通道）。
const { test } = require('node:test');
const assert = require('node:assert');
const repair = require('../src/lib/mac-bundle-repair');

test('bundlePathFromExe: 标准打包路径 → bundle 根', () => {
  assert.strictEqual(
    repair.bundlePathFromExe('/Applications/Wordspace Next.app/Contents/MacOS/Wordspace Next'),
    '/Applications/Wordspace Next.app'
  );
});

test('bundlePathFromExe: Helper 内路径 → 取最外层 .app（chown 目标是整个安装单元）', () => {
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

test('buildRepairArgs: 常规路径（含空格）→ osascript -e "do shell script … with administrator privileges"', () => {
  const args = repair.buildRepairArgs(501, '/Applications/Wordspace Next.app');
  assert.strictEqual(args[0], '-e');
  assert.strictEqual(
    args[1],
    'do shell script "/usr/sbin/chown -R 501 \'/Applications/Wordspace Next.app\'" with administrator privileges'
  );
});

test('buildRepairArgs: 路径含单引号——解开 AppleScript 层后 shell 层逃逸正确，路径不能逃出引号', () => {
  const args = repair.buildRepairArgs(501, "/Applications/It's.app");
  // 双层转义分层验证：先按 AppleScript 字面量规则解转义（\x → x），再核 shell 命令原文
  const m = args[1].match(/^do shell script "([\s\S]*)" with administrator privileges$/);
  assert.ok(m, 'do shell script 外壳完整: ' + args[1]);
  const shellCmd = m[1].replace(/\\([\s\S])/g, '$1');
  assert.strictEqual(shellCmd, "/usr/sbin/chown -R 501 '/Applications/It'\\''s.app'");
});

test('buildRepairArgs: 路径含双引号——AppleScript 字面量层转义，不能截断 do shell script', () => {
  const args = repair.buildRepairArgs(501, '/Applications/a"b.app');
  assert.ok(args[1].includes('a\\"b.app'), args[1]);
  assert.ok(args[1].endsWith('with administrator privileges'), args[1]);
});

test('buildRepairArgs: uid 必须是非负整数——注入面全封死', () => {
  assert.throws(() => repair.buildRepairArgs('501; rm -rf /', '/Applications/X.app'));
  assert.throws(() => repair.buildRepairArgs(1.5, '/Applications/X.app'));
  assert.throws(() => repair.buildRepairArgs(-1, '/Applications/X.app'));
});

test('buildRepairArgs: bundle 路径必须是绝对路径且以 .app 结尾', () => {
  assert.throws(() => repair.buildRepairArgs(501, '/etc'));
  assert.throws(() => repair.buildRepairArgs(501, 'X.app'));
  assert.throws(() => repair.buildRepairArgs(501, null));
});
