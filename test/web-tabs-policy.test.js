const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const P = require('../src/lib/web-tabs-policy.js');

test('权限默认拒绝,白名单放行', () => {
  assert.ok(P.permissionAllowed('fullscreen'));
  assert.ok(P.permissionAllowed('pointerLock'));
  assert.ok(P.permissionAllowed('clipboard-sanitized-write'));
  for (const p of ['media', 'geolocation', 'notifications', 'midi', 'clipboard-read', 'openExternal', 'display-capture', 'usb', 'hid', 'serial', 'unknown']) {
    assert.ok(!P.permissionAllowed(p), p + ' 应被拒');
  }
});

test('导航 scheme 守卫：只放 http/https', () => {
  assert.ok(P.isAllowedNavUrl('http://a.com'));
  assert.ok(P.isAllowedNavUrl('https://a.com/x'));
  assert.ok(!P.isAllowedNavUrl('file:///etc/passwd'));
  assert.ok(!P.isAllowedNavUrl('javascript:alert(1)'));
  assert.ok(!P.isAllowedNavUrl('data:text/html,x'));
  assert.ok(!P.isAllowedNavUrl('chrome://settings'));
  assert.ok(!P.isAllowedNavUrl('ftp://a.com'));
  assert.ok(!P.isAllowedNavUrl('mailto:a@b.com'));
  assert.ok(!P.isAllowedNavUrl('/relative/path'));
  assert.ok(!P.isAllowedNavUrl(null));
});

test('下载文件名清洗：剥路径穿越', () => {
  assert.equal(P.safeFilename('report.pdf'), 'report.pdf');
  assert.equal(P.safeFilename('../../../.ssh/authorized_keys'), 'authorized_keys');
  assert.equal(P.safeFilename('/etc/passwd'), 'passwd');
  assert.equal(P.safeFilename('..'), 'download');
  assert.equal(P.safeFilename(''), 'download');
  assert.equal(P.safeFilename('   '), 'download');
  assert.equal(P.safeFilename(null), 'download');
  assert.equal(P.safeFilename('a/b/c.zip'), 'c.zip');
});

test('isInsideDir：越界拒绝', () => {
  assert.ok(P.isInsideDir('/home/u/Downloads', '/home/u/Downloads/a.pdf'));
  assert.ok(!P.isInsideDir('/home/u/Downloads', '/home/u/.ssh/key'));
  assert.ok(!P.isInsideDir('/home/u/Downloads', '/home/u/Downloads/../secret'));
  assert.ok(!P.isInsideDir('/home/u/Downloads', '/home/u/Downloads')); // 目录自身不算文件
});

test('uniqueName：同名追加 (n)', () => {
  const existing = new Set(['/d/a.pdf', '/d/a (1).pdf']);
  const existsFn = (p) => existing.has(p);
  assert.equal(P.uniqueName('/d', 'a.pdf', existsFn), path.join('/d', 'a (2).pdf'));
  assert.equal(P.uniqueName('/d', 'new.zip', existsFn), path.join('/d', 'new.zip'));
});

test('classifyLoadFailure：ERR_ABORTED 与子 frame 忽略', () => {
  assert.equal(P.classifyLoadFailure(-3, true), 'ignore'); // ERR_ABORTED
  assert.equal(P.classifyLoadFailure(-105, false), 'ignore'); // 子 frame
  assert.equal(P.classifyLoadFailure(-105, true), 'error-page'); // 主 frame DNS 失败
  assert.equal(P.classifyLoadFailure(-106, true), 'error-page');
});

test('isRealCrash：自己的销毁不算崩溃', () => {
  assert.ok(P.isRealCrash('crashed'));
  assert.ok(P.isRealCrash('oom'));
  assert.ok(!P.isRealCrash('clean-exit'));
  assert.ok(!P.isRealCrash('killed'));
});

test('pickFavicon：去重 + scheme 过滤', () => {
  assert.equal(P.pickFavicon(['https://a.com/f.ico'], null), 'https://a.com/f.ico');
  assert.equal(P.pickFavicon(['https://a.com/f.ico'], 'https://a.com/f.ico'), null); // 没变
  assert.equal(P.pickFavicon(['file:///Users/x/secret'], null), null); // file: 拒绝
  assert.equal(P.pickFavicon([], null), null);
  assert.equal(P.pickFavicon(null, null), null);
});

test('routeMenuCmd：(activeKind × viewState × cmd) 全表', () => {
  // 非 web → null（走 doc 路由）
  assert.equal(P.routeMenuCmd('doc', 'live', 'save'), null);
  // web live
  assert.equal(P.routeMenuCmd('web', 'live', 'save'), 'noop');
  assert.equal(P.routeMenuCmd('web', 'live', 'export-pdf'), 'web-pdf');
  assert.equal(P.routeMenuCmd('web', 'live', 'undo'), 'web-undo'); // 转发 view,不能 no-op
  assert.equal(P.routeMenuCmd('web', 'live', 'redo'), 'web-redo');
  assert.equal(P.routeMenuCmd('web', 'live', 'find-in-doc'), 'web-find'); // Cmd+F 新名(main #124)
  assert.equal(P.routeMenuCmd('web', 'live', 'find-file'), null);        // Cmd+Shift+F 筛选:web 不拦,放行侧栏
  assert.equal(P.routeMenuCmd('web', 'live', 'reload'), 'web-reload');
  // web placeholder（恢复未加载）
  assert.equal(P.routeMenuCmd('web', 'placeholder', 'reload'), 'web-first-load');
  assert.equal(P.routeMenuCmd('web', 'placeholder', 'export-pdf'), 'disabled');
  assert.equal(P.routeMenuCmd('web', 'placeholder', 'find-in-doc'), 'disabled');
  // web newtab（url=null）
  assert.equal(P.routeMenuCmd('web', 'newtab', 'export-pdf'), 'noop');
  assert.equal(P.routeMenuCmd('web', 'newtab', 'reload'), 'noop');
});
