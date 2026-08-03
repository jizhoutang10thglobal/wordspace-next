// U1 单测：src/lib/downloads.js（下载纯逻辑）。node:test，纯 Node（不 require electron）。
// 移植保真：ported 段的期望值按 ui-demo/src/lib/downloads.ts 源码手算对拍；
// 真 app 独有段（sanitizeFilename / sanitizeDownloads / capDownloads）按 spec §4.11 语义。
const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../src/lib/downloads');

// ---------- 状态机判定（对齐 spec §4.11 逐状态操作表 + ui-demo lib/downloads.ts）----------
test('状态机判定 isTerminal/canRetry/canReveal/canRemove 逐状态', () => {
  // isTerminal：只有 downloading 非终态
  assert.strictEqual(d.isTerminal('downloading'), false);
  for (const s of ['completed', 'canceled', 'failed', 'interrupted', 'fileMissing']) {
    assert.strictEqual(d.isTerminal(s), true, s);
  }
  // canRetry：failed / canceled / interrupted 可重试
  assert.deepStrictEqual(
    ['downloading', 'completed', 'canceled', 'failed', 'interrupted', 'fileMissing'].map(d.canRetry),
    [false, false, true, true, true, false],
  );
  // canReveal：仅 completed
  assert.deepStrictEqual(
    ['downloading', 'completed', 'canceled', 'failed', 'interrupted', 'fileMissing'].map(d.canReveal),
    [false, true, false, false, false, false],
  );
  // canRemove：非 downloading 都可移除
  assert.deepStrictEqual(
    ['downloading', 'completed', 'canceled', 'failed', 'interrupted', 'fileMissing'].map(d.canRemove),
    [false, true, true, true, true, true],
  );
});

// ---------- uniquify（移植自 ui-demo）----------
test('uniquify：无冲突原样返回', () => {
  assert.strictEqual(d.uniquify('报告.pdf', new Set()), '报告.pdf');
  assert.strictEqual(d.uniquify('report.pdf', new Set(['other.pdf'])), 'report.pdf');
});

test('uniquify：冲突在扩展名前插 (n)，连续递增', () => {
  assert.strictEqual(d.uniquify('报告.pdf', new Set(['报告.pdf'])), '报告 (1).pdf');
  assert.strictEqual(d.uniquify('报告.pdf', new Set(['报告.pdf', '报告 (1).pdf'])), '报告 (2).pdf');
});

test('uniquify：无扩展名', () => {
  assert.strictEqual(d.uniquify('foo', new Set(['foo'])), 'foo (1)');
});

test('uniquify：taken = 磁盘名 ∪ 在途名的组合（调用方组装）', () => {
  const disk = ['a.pdf'];
  const inflight = ['b.pdf'];
  const taken = new Set([...disk, ...inflight]);
  assert.strictEqual(d.uniquify('a.pdf', taken), 'a (1).pdf'); // 撞磁盘
  assert.strictEqual(d.uniquify('b.pdf', taken), 'b (1).pdf'); // 撞在途
  assert.strictEqual(d.uniquify('c.pdf', taken), 'c.pdf'); // 都不撞
});

// ---------- stripUniquifySuffix（移植自 ui-demo）----------
test('stripUniquifySuffix：剥一层 (n) 后缀 / 无后缀原样', () => {
  assert.strictEqual(d.stripUniquifySuffix('报告 (1).pdf'), '报告.pdf');
  assert.strictEqual(d.stripUniquifySuffix('报告 (12).pdf'), '报告.pdf');
  assert.strictEqual(d.stripUniquifySuffix('报告.pdf'), '报告.pdf');
  assert.strictEqual(d.stripUniquifySuffix('foo (1)'), 'foo'); // 无扩展名
});

test('stripUniquifySuffix 后重 uniquify 不叠成 x (1) (1)（重试语义 KTD）', () => {
  // 重试：拿 'report (1).pdf' → 剥回 'report.pdf' → 对磁盘上的 'report.pdf' 重 uniquify → 'report (1).pdf'
  const stripped = d.stripUniquifySuffix('report (1).pdf');
  assert.strictEqual(stripped, 'report.pdf');
  assert.strictEqual(d.uniquify(stripped, new Set(['report.pdf'])), 'report (1).pdf');
  // 对照：若不剥后缀直接重 uniquify，就会叠层（这正是要避免的坏行为）
  assert.strictEqual(d.uniquify('report (1).pdf', new Set(['report (1).pdf'])), 'report (1) (1).pdf');
});

// ---------- truncateMiddle（移植自 ui-demo）----------
test('truncateMiddle：短名原样返回', () => {
  assert.strictEqual(d.truncateMiddle('a.pdf'), 'a.pdf');
  assert.strictEqual(d.truncateMiddle('x'.repeat(34)), 'x'.repeat(34)); // 恰好 max 不截
});

test('truncateMiddle：长名中段截断，头 20 + … + 尾 13（max=34 手算）', () => {
  const name = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // 40 chars
  assert.strictEqual(d.truncateMiddle(name), 'abcdefghijklmnopqrst…123456789ABCD');
});

test('truncateMiddle：按码点切，不切断 emoji', () => {
  const name = '😀'.repeat(40);
  const out = d.truncateMiddle(name);
  assert.strictEqual(Array.from(out).length, 34); // 头20 + … + 尾13
  assert.ok(out.includes('…'));
  assert.ok(!out.includes('�')); // 无替换字符 = 没切断代理对
});

// ---------- aggregateProgress（移植自 ui-demo）----------
test('aggregateProgress：多条在途，pct = Σ已收/Σ总量', () => {
  const r = d.aggregateProgress([
    { state: 'downloading', receivedBytes: 50, sizeBytes: 100 },
    { state: 'downloading', receivedBytes: 0, sizeBytes: 100 },
  ]);
  assert.deepStrictEqual(r, { active: 2, pct: 0.25 });
});

test('aggregateProgress：已完成留在批内撑住分母，环只前进不回退', () => {
  const r = d.aggregateProgress([
    { state: 'completed', receivedBytes: 100, sizeBytes: 100 },
    { state: 'downloading', receivedBytes: 0, sizeBytes: 100 },
  ]);
  assert.deepStrictEqual(r, { active: 1, pct: 0.5 });
});

test('aggregateProgress：无在途 → active 0 / pct 0；总量 0 保护', () => {
  assert.deepStrictEqual(
    d.aggregateProgress([{ state: 'completed', receivedBytes: 100, sizeBytes: 100 }]),
    { active: 0, pct: 0 },
  );
  assert.deepStrictEqual(
    d.aggregateProgress([{ state: 'downloading', receivedBytes: 0, sizeBytes: 0 }]),
    { active: 1, pct: 0 },
  );
});

// ---------- filenameFromUrl（移植自 ui-demo）----------
test('filenameFromUrl：从 path 末段派生 / host 回落 / 非法回落', () => {
  assert.strictEqual(d.filenameFromUrl('https://news.design/img/hero.jpg'), 'hero.jpg');
  assert.strictEqual(d.filenameFromUrl('https://news.design/img/hero', '.png'), 'hero.png');
  assert.strictEqual(d.filenameFromUrl('https://www.example.com/'), 'example.com'); // 无 path，剥 www
  assert.strictEqual(d.filenameFromUrl('https://x.com/a%20b.pdf'), 'a b.pdf'); // decodeURIComponent
  assert.strictEqual(d.filenameFromUrl('not a url', '.bin'), 'download.bin'); // 非法 URL 回落
});

// ---------- formatBytes（移植自 ui-demo）----------
test('formatBytes：各量级', () => {
  assert.strictEqual(d.formatBytes(512), '512 B');
  assert.strictEqual(d.formatBytes(320 * 1024), '320 KB');
  assert.strictEqual(d.formatBytes(2048), '2 KB');
  assert.strictEqual(d.formatBytes(2.5 * 1024 * 1024), '2.5 MB'); // <10 MB 保一位小数
  assert.strictEqual(d.formatBytes(680 * 1024 * 1024), '680 MB'); // >=10 MB 取整
  assert.strictEqual(d.formatBytes(2.1 * 1024 * 1024 * 1024), '2.1 GB');
});

// ---------- sanitizeFilename（真 app 独有，R10）----------
test('sanitizeFilename：剥路径分隔符与 .. 段，防路径穿越', () => {
  assert.strictEqual(d.sanitizeFilename('../../etc/passwd'), 'etcpasswd');
  assert.strictEqual(d.sanitizeFilename('/etc/passwd'), 'etcpasswd');
  assert.strictEqual(d.sanitizeFilename('..\\..\\win.ini'), 'win.ini');
  assert.strictEqual(d.sanitizeFilename('sub/dir/file.txt'), 'subdirfile.txt');
});

test('sanitizeFilename：剥 RTL/LTR override 与控制字符（文件名视觉欺骗）', () => {
  // U+202E RTL override 夹在名字里
  assert.strictEqual(d.sanitizeFilename('a‮gnp.exe'), 'agnp.exe');
  // 覆盖 U+202A-202E 与 U+2066-2069 全段
  assert.strictEqual(
    d.sanitizeFilename('x‪‫‬‭⁦⁧⁨⁩y.txt'),
    'xy.txt',
  );
  // 控制字符 U+0000-001F
  assert.strictEqual(d.sanitizeFilename('report.pdf'), 'report.pdf');
});

test('sanitizeFilename：剥首尾点与空格；空/全非法回落 download', () => {
  assert.strictEqual(d.sanitizeFilename('.hidden'), 'hidden');
  assert.strictEqual(d.sanitizeFilename('  spaced  '), 'spaced');
  assert.strictEqual(d.sanitizeFilename('trail.'), 'trail');
  assert.strictEqual(d.sanitizeFilename(''), 'download');
  assert.strictEqual(d.sanitizeFilename('..'), 'download');
  assert.strictEqual(d.sanitizeFilename('...'), 'download');
  assert.strictEqual(d.sanitizeFilename('   '), 'download');
  assert.strictEqual(d.sanitizeFilename(null), 'download'); // 非字符串
  assert.strictEqual(d.sanitizeFilename(undefined), 'download');
});

test('sanitizeFilename：正常名不被误伤', () => {
  assert.strictEqual(d.sanitizeFilename('报告 (1).pdf'), '报告 (1).pdf');
  assert.strictEqual(d.sanitizeFilename('team-photo_2026.jpg'), 'team-photo_2026.jpg');
});

// ---------- sanitizeDownloads（真 app 独有）----------
test('sanitizeDownloads：非数组 → []', () => {
  assert.deepStrictEqual(d.sanitizeDownloads(null), []);
  assert.deepStrictEqual(d.sanitizeDownloads(undefined), []);
  assert.deepStrictEqual(d.sanitizeDownloads({}), []);
});

test('sanitizeDownloads：load 时 downloading → interrupted 翻转（spec §4.11 退出中断）', () => {
  const out = d.sanitizeDownloads([
    { id: 'd1', filename: 'a.pdf', state: 'downloading', sizeBytes: 100, receivedBytes: 40, sourceUrl: 'https://x/a.pdf', startedAt: 5, savePath: '/dl/a.pdf' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].state, 'interrupted');
  assert.strictEqual(out[0].receivedBytes, 40); // 进度值保留（如实呈现中断点）
});

test('sanitizeDownloads：坏形状条目静默剔除', () => {
  const out = d.sanitizeDownloads([
    { filename: 'noid.pdf', state: 'completed' }, // 缺 id
    { id: 'd2', state: 'completed' }, // 缺 filename
    { id: 'd3', filename: 'badstate.pdf', state: 'bogus' }, // state 不在枚举
    { id: '', filename: 'emptyid.pdf', state: 'completed' }, // 空 id
    null, // 非对象
    'nope', // 非对象
    { id: 'd7', filename: 'good.pdf', state: 'completed' }, // 唯一合法
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'd7');
});

test('sanitizeDownloads：字段强转，缺省补 0 / 空串', () => {
  const out = d.sanitizeDownloads([
    { id: 'd1', filename: 'a.pdf', state: 'completed', sizeBytes: '100', receivedBytes: 'x' },
  ]);
  const e = out[0];
  assert.strictEqual(e.sizeBytes, 100); // 字符串数字 → 数
  assert.strictEqual(e.receivedBytes, 0); // 非数 → 0
  assert.strictEqual(e.startedAt, 0); // 缺省 → 0
  assert.strictEqual(e.sourceUrl, ''); // 缺省 → 空串
  assert.strictEqual(e.savePath, ''); // 缺省 → 空串
});

test('sanitizeDownloads：合法终态条目字段无损、只保留白名单字段', () => {
  const raw = { id: 'd1', filename: 'a.pdf', sourceUrl: 'https://x/a.pdf', sizeBytes: 100, receivedBytes: 100, state: 'completed', startedAt: 7, savePath: '/dl/a.pdf', bogusExtra: 'x' };
  const out = d.sanitizeDownloads([raw]);
  assert.deepStrictEqual(out[0], {
    id: 'd1', filename: 'a.pdf', sourceUrl: 'https://x/a.pdf', sizeBytes: 100, receivedBytes: 100, state: 'completed', startedAt: 7, savePath: '/dl/a.pdf',
  });
});

// ---------- capDownloads（真 app 独有，移植 ui-demo capped 语义）----------
test('capDownloads：未超上限原样返回（同引用）', () => {
  const entries = [{ id: 'a', state: 'completed' }];
  assert.strictEqual(d.capDownloads(entries, 100), entries);
});

test('capDownloads：超上限从最老端挤终态条目', () => {
  const entries = [];
  for (let i = 0; i < 101; i++) entries.push({ id: 'e' + i, state: 'completed' }); // 新在前
  const out = d.capDownloads(entries, 100);
  assert.strictEqual(out.length, 100);
  assert.strictEqual(out[0].id, 'e0'); // 最新保留
  assert.strictEqual(out[99].id, 'e99'); // 挤掉最老的 e100
  assert.ok(!out.some((e) => e.id === 'e100'));
});

test('capDownloads：在途（downloading）绝不挤，哪怕超上限也留', () => {
  // cap=1，两条在途 + 一条终态。只能挤掉终态那条，两条在途都留（结果 2 条 > cap）。
  const entries = [
    { id: 'a', state: 'downloading' },
    { id: 'b', state: 'downloading' },
    { id: 'c', state: 'completed' },
  ];
  const out = d.capDownloads(entries, 1);
  assert.strictEqual(out.length, 2); // 挤不动在途
  assert.deepStrictEqual(out.map((e) => e.id), ['a', 'b']);
});

test('capDownloads：非数组 → []', () => {
  assert.deepStrictEqual(d.capDownloads(null), []);
});
