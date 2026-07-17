// 更新状态机 + 展示模型单测（替代旧 update-prompt.test.js——dialog 链已被应用内面板取代）。
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../src/lib/update-status');
// i18n Phase 2：面板/pill 文案改走 t()，配 zh 让下面的中文断言继续成立。
const _i18n = require('../src/lib/i18n');
_i18n.configureI18n(require('../src/i18n').ZH, require('../src/i18n').EN);
_i18n.setActiveLang('zh');

const step = (evts) => evts.reduce((s, e) => U.nextStatus(s, e), U.initialStatus());

test('自动路径：checking→available 直落 downloading（静默下载策略）且 shouldStartDownload 判真', () => {
  const checking = U.nextStatus(U.initialStatus(), { type: 'checking', manual: false });
  assert.strictEqual(checking.state, 'checking');
  assert.strictEqual(checking.manual, false);
  const next = U.nextStatus(checking, { type: 'available', version: '9.9.9', notes: [{ t: 'p', text: 'x' }] });
  assert.strictEqual(next.state, 'downloading');
  assert.strictEqual(next.version, '9.9.9');
  assert.ok(U.shouldStartDownload(checking, next));
});

test('手动路径：available 停住等用户；download-started 才进 downloading', () => {
  const s1 = step([{ type: 'checking', manual: true }, { type: 'available', version: '1.2.3' }]);
  assert.strictEqual(s1.state, 'available');
  assert.strictEqual(s1.manual, true); // manual 从 checking 继承
  assert.ok(!U.shouldStartDownload(U.nextStatus(U.initialStatus(), { type: 'checking', manual: true }), s1));
  const s2 = U.nextStatus(s1, { type: 'download-started' });
  assert.strictEqual(s2.state, 'downloading');
  assert.ok(U.shouldStartDownload(s1, s2));
});

test('progress 更新进度但不再次触发 shouldStartDownload；downloaded → ready', () => {
  const dl = step([{ type: 'checking', manual: false }, { type: 'available', version: '2.0.0' }]);
  const p1 = U.nextStatus(dl, { type: 'progress', percent: 42.4, transferred: 50e6, total: 130e6, bytesPerSecond: 3e6 });
  assert.strictEqual(p1.state, 'downloading');
  assert.strictEqual(p1.percent, 42.4);
  assert.ok(!U.shouldStartDownload(dl, p1));
  const ready = U.nextStatus(p1, { type: 'downloaded' });
  assert.strictEqual(ready.state, 'ready');
  assert.strictEqual(ready.version, '2.0.0'); // downloaded 没带版本时保留 available 的
  assert.strictEqual(ready.percent, 100);
});

test('错误分流：静默自动检查失败回 idle 不打扰；下载中失败进 error 且 retry=download；手动检查失败 retry=check', () => {
  const silent = step([{ type: 'checking', manual: false }, { type: 'error', message: 'net down' }]);
  assert.strictEqual(silent.state, 'idle');
  const dlErr = step([
    { type: 'checking', manual: false },
    { type: 'available', version: '2.0.0' },
    { type: 'error', message: 'ETIMEDOUT' },
  ]);
  assert.strictEqual(dlErr.state, 'error');
  assert.strictEqual(dlErr.retry, 'download');
  assert.strictEqual(dlErr.message, 'ETIMEDOUT');
  const chkErr = step([{ type: 'checking', manual: true }, { type: 'error', message: 'x' }]);
  assert.strictEqual(chkErr.state, 'error');
  assert.strictEqual(chkErr.retry, 'check');
});

test('error 重试下载：download-started 清掉 message/retry 并重新判真', () => {
  const err = step([
    { type: 'checking', manual: true },
    { type: 'available', version: '1.0.1' },
    { type: 'download-started' },
    { type: 'error', message: 'boom' },
  ]);
  const retried = U.nextStatus(err, { type: 'download-started' });
  assert.strictEqual(retried.state, 'downloading');
  assert.strictEqual(retried.message, null);
  assert.ok(U.shouldStartDownload(err, retried));
});

test('not-available：手动 → uptodate，自动 → idle；dev-check → dev', () => {
  assert.strictEqual(step([{ type: 'checking', manual: true }, { type: 'not-available' }]).state, 'uptodate');
  assert.strictEqual(step([{ type: 'checking', manual: false }, { type: 'not-available' }]).state, 'idle');
  assert.strictEqual(U.nextStatus(null, { type: 'dev-check' }).state, 'dev');
});

test('parseReleaseNotes：剥 ws-note 注释、切 --- 分隔线、markdown 归一成行', () => {
  const body = '<!-- ws-note -->\n## Wordspace 现在也是一个浏览器\n\n### 新功能\n- **地址栏上网**：直接打开\n- 收藏夹见 [文档](https://x.y)\n\n---\n\n## What\'s Changed\n* PR #160';
  const lines = U.parseReleaseNotes(body);
  assert.deepStrictEqual(lines[0], { t: 'h', text: 'Wordspace 现在也是一个浏览器' });
  assert.deepStrictEqual(lines[1], { t: 'h', text: '新功能' });
  assert.deepStrictEqual(lines[2], { t: 'li', text: '地址栏上网：直接打开' });
  assert.deepStrictEqual(lines[3], { t: 'li', text: '收藏夹见 文档' });
  assert.ok(!lines.some((l) => l.text.includes("What's Changed"))); // --- 以下的 PR 列表不进面板
});

test('parseReleaseNotes：HTML 剥标签、数组输入合并、空输入回空数组、超长截断', () => {
  assert.deepStrictEqual(U.parseReleaseNotes('<p>修复了<b>丢数据</b></p>'), [{ t: 'p', text: '修复了丢数据' }]);
  assert.deepStrictEqual(U.parseReleaseNotes([{ version: '1', note: 'a' }, { version: '2', note: 'b' }]), [
    { t: 'p', text: 'a' },
    { t: 'p', text: 'b' },
  ]);
  assert.deepStrictEqual(U.parseReleaseNotes(null), []);
  assert.deepStrictEqual(U.parseReleaseNotes(''), []);
  const long = Array.from({ length: 40 }, (_, i) => '- 条目' + i).join('\n');
  assert.strictEqual(U.parseReleaseNotes(long).length, 24);
});

test('formatBytes/formatSpeed/clampPercent', () => {
  assert.strictEqual(U.formatBytes(140123678), '133.6 MB');
  assert.strictEqual(U.formatBytes(1500), '1 KB');
  assert.strictEqual(U.formatBytes(2 * 1024 * 1024 * 1024), '2.00 GB');
  assert.strictEqual(U.formatBytes(null), '');
  assert.strictEqual(U.formatSpeed(3 * 1024 * 1024), '3.0 MB/s');
  assert.strictEqual(U.clampPercent(42.4), 42);
  assert.strictEqual(U.clampPercent(120), 100);
  assert.strictEqual(U.clampPercent(undefined), null);
});

test('pillModel：只在 downloading/ready 出现', () => {
  assert.strictEqual(U.pillModel(U.initialStatus()), null);
  const dl = step([{ type: 'checking', manual: false }, { type: 'available', version: '2.0.0' }, { type: 'progress', percent: 55 }]);
  const pill = U.pillModel(dl);
  assert.strictEqual(pill.kind, 'downloading');
  assert.strictEqual(pill.percent, 55);
  assert.ok(pill.text.includes('v2.0.0'));
  const ready = U.pillModel(U.nextStatus(dl, { type: 'downloaded' }));
  assert.strictEqual(ready.kind, 'ready');
  assert.strictEqual(U.pillModel(step([{ type: 'checking', manual: true }, { type: 'not-available' }])), null);
});

test('panelModel：各状态的标题/按钮语义', () => {
  const avail = step([{ type: 'checking', manual: true }, { type: 'available', version: '1.2.3' }]);
  const m = U.panelModel(avail, '1.0.0');
  assert.strictEqual(m.title, '发现新版本 v1.2.3');
  assert.deepStrictEqual(m.buttons.map((b) => b.id), ['download', 'changelog', 'close']); // 更新日志入口常驻
  assert.ok(m.body.length >= 1); // notes 为空时有兜底文案

  const dl = U.nextStatus(avail, { type: 'download-started' });
  const withProg = U.nextStatus(dl, { type: 'progress', percent: 30, transferred: 40e6, total: 130e6, bytesPerSecond: 2e6 });
  const md = U.panelModel(withProg, '1.0.0');
  assert.strictEqual(md.progress.percent, 30);
  assert.ok(md.progress.detail.includes('/')); // 已下 / 总量
  assert.deepStrictEqual(md.buttons.map((b) => b.id), ['close']);

  const noProg = U.panelModel(dl, '1.0.0');
  assert.strictEqual(noProg.progress.percent, null);
  assert.strictEqual(noProg.progress.detail, '正在开始下载…');

  const ready = U.panelModel(U.nextStatus(withProg, { type: 'downloaded' }), '1.0.0');
  assert.deepStrictEqual(ready.buttons.map((b) => b.id), ['install', 'changelog', 'close']);

  const err = U.panelModel(U.nextStatus(withProg, { type: 'error', message: 'x' }), '1.0.0');
  assert.strictEqual(err.buttons[0].id, 'download'); // 下载中失败 → 重试=再下载

  const upt = U.panelModel(step([{ type: 'checking', manual: true }, { type: 'not-available' }]), '1.0.0');
  assert.ok(upt.body[0].text.includes('v1.0.0'));
  assert.deepStrictEqual(upt.buttons.map((b) => b.id), ['changelog', 'close']); // 已最新 → 「最近更新了什么」
  assert.strictEqual(U.panelModel(U.initialStatus(), '1.0.0'), null);
});
