// 网页标签纯决策逻辑单测（权限白名单 / scheme 守卫 / 失败分类 / favicon 去重 / 缩放步进）。
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../src/lib/web-tabs-policy');

test('permissionAllowed：默认拒，白名单只放 fullscreen/pointerLock/clipboard-sanitized-write', () => {
  assert.ok(P.permissionAllowed('fullscreen'));
  assert.ok(P.permissionAllowed('pointerLock'));
  assert.ok(P.permissionAllowed('clipboard-sanitized-write'));
  for (const deny of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'camera', 'microphone', 'openExternal', 'unknown-future-permission']) {
    assert.ok(!P.permissionAllowed(deny), deny);
  }
});

test('isAllowedNavUrl：只放 http/https；file:/javascript:/data:/相对/非串一律拒', () => {
  assert.ok(P.isAllowedNavUrl('https://a.com/'));
  assert.ok(P.isAllowedNavUrl('http://localhost:3000/x'));
  assert.ok(P.isAllowedNavUrl('HTTPS://UPPER.com/'));
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'wordspace://newtab', '/relative', '', null, undefined, 42]) {
    assert.ok(!P.isAllowedNavUrl(bad), String(bad));
  }
});

test('safeFilename：剥路径分隔/非法字符，空回落 webpage，限长', () => {
  assert.strictEqual(P.safeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.strictEqual(P.safeFilename('  '), 'webpage');
  assert.strictEqual(P.safeFilename(null), 'webpage');
  assert.strictEqual(P.safeFilename('..'), 'webpage');
  assert.ok(P.safeFilename('x'.repeat(200)).length <= 80);
  assert.strictEqual(P.safeFilename('正常 标题'), '正常 标题'); // 空格保留
});

test('classifyLoadFailure：-3 ERR_ABORTED 忽略；子 frame 失败忽略；主 frame 真失败出错误页', () => {
  assert.strictEqual(P.classifyLoadFailure(-3, true), 'ignore');
  assert.strictEqual(P.classifyLoadFailure(-105, false), 'ignore');
  assert.strictEqual(P.classifyLoadFailure(-105, true), 'error-page');
});

test('isRealCrash：clean-exit/killed 不算崩溃', () => {
  assert.ok(!P.isRealCrash('clean-exit'));
  assert.ok(!P.isRealCrash('killed'));
  assert.ok(P.isRealCrash('crashed'));
  assert.ok(P.isRealCrash('oom'));
});

test('pickFavicon：取第一个 + http(s) 白名单 + 同 URL 去重', () => {
  assert.strictEqual(P.pickFavicon(['https://a.com/f.ico', 'https://a.com/g.ico'], null), 'https://a.com/f.ico');
  assert.strictEqual(P.pickFavicon(['https://a.com/f.ico'], 'https://a.com/f.ico'), null); // 没变
  assert.strictEqual(P.pickFavicon(['file:///etc/x.ico'], null), null);
  assert.strictEqual(P.pickFavicon(['data:image/png;base64,x'], null), null);
  assert.strictEqual(P.pickFavicon([], null), null);
  assert.strictEqual(P.pickFavicon(null, null), null);
});

test('nextZoom：±0.1 步进、夹 0.5–2.0、reset 回 1、浮点不漂移', () => {
  assert.strictEqual(P.nextZoom(1, 'in'), 1.1);
  assert.strictEqual(P.nextZoom(1.1, 'in'), 1.2);
  assert.strictEqual(P.nextZoom(1, 'out'), 0.9);
  assert.strictEqual(P.nextZoom(0.5, 'out'), 0.5); // 下限
  assert.strictEqual(P.nextZoom(2, 'in'), 2); // 上限
  assert.strictEqual(P.nextZoom(1.7000000000000002, 'in'), 1.8); // 浮点尾巴收干净
  assert.strictEqual(P.nextZoom(1.6, 'reset'), 1);
  assert.strictEqual(P.nextZoom(undefined, 'in'), 1.1); // 无值当 1
});

test('pickFavicon 取第一个 http(s)(P2-4)：data: 在首位时跳过、取后面的 http', () => {
  assert.strictEqual(P.pickFavicon(['data:image/svg+xml,x', 'https://a.com/f.ico'], null), 'https://a.com/f.ico');
  assert.strictEqual(P.pickFavicon(['data:x', 'file:///y', 'http://b.com/g.png'], null), 'http://b.com/g.png');
  assert.strictEqual(P.pickFavicon(['data:x', 'data:y'], null), null); // 全 data: → null
  assert.strictEqual(P.pickFavicon(['https://a.com/f.ico'], 'https://a.com/f.ico'), null); // 命中的没变 → 去重
});
