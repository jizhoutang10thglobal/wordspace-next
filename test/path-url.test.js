// 跨平台路径→URL 的纯逻辑单测。宿主是 POSIX（mac/CI），所以这里验 POSIX 输出，
// 并锚定「委托给 Node url.pathToFileURL」这条不变式——它保证 Windows 上靠 Node 的 win32 语义
// 正确处理盘符 C:\ 与反斜杠（Node stdlib 自己已充分测试，我们不重测 stdlib，只验自己确实委托）。
const test = require('node:test');
const assert = require('node:assert');
const { pathToFileURL } = require('url');
const { pathInfo, withTrailingSlash, htmlPathFromArgv } = require('../src/lib/path-url');

test('POSIX 绝对路径 → 正确 file:/// URL + 文件名 + 目录URL带尾斜杠', () => {
  const info = pathInfo('/Users/foo/docs/report.html');
  assert.equal(info.fileUrl, 'file:///Users/foo/docs/report.html');
  assert.equal(info.name, 'report.html');
  assert.equal(info.dirUrl, 'file:///Users/foo/docs/');
});

test('空格/中文/# 按 RFC 编码（委托 pathToFileURL，不手搓字符串）', () => {
  const p = '/Users/foo/我的 文档/价值观#1.html';
  const info = pathInfo(p);
  assert.equal(info.fileUrl, pathToFileURL(p).href, 'fileUrl 必须等于 Node pathToFileURL');
  assert.ok(info.fileUrl.includes('%20'), '空格应编码为 %20');
  assert.ok(!info.fileUrl.includes('#1.html'), '# 应被编码、不能当作 URL fragment');
  assert.equal(info.name, '价值观#1.html');
});

test('委托不变式：任意路径的 fileUrl 恒等于 Node pathToFileURL（跨平台正确性的保证）', () => {
  for (const p of ['/x.html', '/a/b/c.html', '/with space/y.html', '/中文/z.htm']) {
    assert.equal(pathInfo(p).fileUrl, pathToFileURL(p).href);
  }
});

test('dirUrl 始终带尾斜杠（<base> 解析相对资源所需）', () => {
  assert.ok(pathInfo('/a/b/c.html').dirUrl.endsWith('/'));
});

test('withTrailingSlash 幂等', () => {
  assert.equal(withTrailingSlash('file:///a/b'), 'file:///a/b/');
  assert.equal(withTrailingSlash('file:///a/b/'), 'file:///a/b/');
});

// Windows 文件关联流的纯逻辑覆盖（无 Windows 机器，这里替代手测一部分）
test('htmlPathFromArgv：取出绝对 .html 参数', () => {
  assert.equal(htmlPathFromArgv(['app.exe', '/abs/report.html'], '/cwd'), '/abs/report.html');
});
test('htmlPathFromArgv：相对路径按传入的 cwd 解析（second-instance 用第二次启动的 cwd）', () => {
  assert.equal(htmlPathFromArgv(['app.exe', 'doc.HTM'], '/work'), '/work/doc.HTM'); // 大小写不敏感
});
test('htmlPathFromArgv：无文件参数 / 只有 flags / dev 的 "." → null（不误开）', () => {
  assert.equal(htmlPathFromArgv(['app.exe'], '/cwd'), null);
  assert.equal(htmlPathFromArgv(['electron', '.', '--inspect'], '/cwd'), null);
  assert.equal(htmlPathFromArgv(['app.exe', '--flag', '--x=1'], '/cwd'), null);
});
test('htmlPathFromArgv：取第一个匹配项 + 空 argv 安全', () => {
  assert.equal(htmlPathFromArgv(['app.exe', 'a.html', 'b.html'], '/c'), '/c/a.html');
  assert.equal(htmlPathFromArgv([], '/c'), null);
  assert.equal(htmlPathFromArgv(undefined, '/c'), null);
});
