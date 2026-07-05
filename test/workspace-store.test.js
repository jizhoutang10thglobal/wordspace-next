const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const store = require('../src/main/workspace-store.js');

test('save then load round-trips the root', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/Users/me/Projects/品牌');
  const loaded = await store.load(f);
  assert.equal(loaded.root, '/Users/me/Projects/品牌');
});

test('load returns null when store missing', async () => {
  assert.equal(await store.load('/nonexistent/workspace.json'), null);
});

test('load tolerates corrupt / non-root JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await fs.writeFile(f, 'not json{', 'utf8');
  assert.equal(await store.load(f), null);
  await fs.writeFile(f, '{"nope":1}', 'utf8');
  assert.equal(await store.load(f), null);
});

test('getTabs/setTabs persist per-root and survive a root re-save', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/w1');
  assert.deepEqual(await store.getTabs(f, '/w1'), { entries: [], activeRel: null }); // 缺省空
  const state = {
    entries: [
      { rel: 'a.html', kind: 'html', title: 'a.html', open: true, pinned: false },
      { rel: '数据/b.html', kind: 'html', title: 'b.html', open: false, pinned: true },
    ],
    activeRel: 'a.html',
  };
  await store.setTabs(f, '/w1', state);
  assert.deepEqual(await store.getTabs(f, '/w1'), state);
  // 另一个根各自保留
  await store.setTabs(f, '/w2', { entries: [{ rel: 'x.html', kind: 'html', title: 'x.html', open: true, pinned: false }], activeRel: 'x.html' });
  assert.equal((await store.getTabs(f, '/w2')).entries[0].rel, 'x.html');
  // 重新 save 根（pick-folder 会做）不能把标签冲掉
  await store.save(f, '/w1');
  assert.deepEqual(await store.getTabs(f, '/w1'), state);
  assert.equal((await store.load(f)).root, '/w1'); // 旧契约不变
});

test('getTabs drops ghost/invalid entries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.setTabs(f, '/w', {
    entries: [
      { rel: 'ok.html', kind: 'html', title: 'ok.html', open: true, pinned: false },
      { rel: 'ghost.html', kind: 'html', title: 'g', open: false, pinned: false }, // 幽灵
      { kind: 'html', open: true }, // 无 rel
    ],
    activeRel: 'ok.html',
  });
  const r = await store.getTabs(f, '/w');
  assert.deepEqual(r.entries.map((e) => e.rel), ['ok.html']);
});

test('外部标签（无 rel、有 abs）能 round-trip；abs/kind/title 字段保留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const state = {
    entries: [
      { rel: 'in.html', kind: 'html', title: 'in.html', open: true, pinned: false },
      { abs: '/Users/x/Downloads/out.pdf', kind: 'pdf', title: 'out.pdf', open: true, pinned: false }, // 外部
      { kind: 'html', open: true }, // 既无 rel 又无 abs → 仍丢
    ],
    activeRel: '/Users/x/Downloads/out.pdf', // 外部激活项的 keyOf 是 abs
  };
  await store.setTabs(f, '/w', state);
  const r = await store.getTabs(f, '/w');
  assert.equal(r.entries.length, 2); // 内部 + 外部，坏项丢掉
  const e = r.entries.find((x) => x.abs === '/Users/x/Downloads/out.pdf');
  assert.ok(e && e.kind === 'pdf' && e.title === 'out.pdf' && !e.rel); // 字段完整保留
  assert.equal(r.activeRel, '/Users/x/Downloads/out.pdf'); // abs 作 activeRel
});

test('getTabs migrates old pinsByRoot to pinned entries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  // 预置 v0.4.0 旧格式：只有 pinsByRoot，没有 tabsByRoot
  await fs.writeFile(f, JSON.stringify({ root: '/w', pinsByRoot: { '/w': ['a.html', '素材/封面.png'] } }), 'utf8');
  const r = await store.getTabs(f, '/w');
  assert.deepEqual(
    r.entries.map((e) => [e.rel, e.kind, e.open, e.pinned]),
    [
      ['a.html', 'html', false, true],
      ['素材/封面.png', 'image', false, true],
    ],
  );
  assert.equal(r.activeRel, null);
});

test('clear removes the store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/x');
  await store.clear(f);
  assert.equal(await store.load(f), null);
});

// ============ web 标签持久化（KD-3）============
test('web 条目 round-trips（url 保留）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const root = '/Users/me/ws';
  await store.setTabs(f, root, {
    entries: [{ abs: 'web:1:x', kind: 'web', title: 'A', url: 'https://a.com', open: true, pinned: false }],
    activeRel: 'web:1:x',
  });
  const got = await store.getTabs(f, root);
  assert.equal(got.entries.length, 1);
  assert.equal(got.entries[0].url, 'https://a.com');
  assert.equal(got.activeRel, 'web:1:x');
});

test('web 条目 url 坏数据（数字/缺失）→ 丢该条', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const root = '/Users/me/ws';
  await store.setTabs(f, root, {
    entries: [
      { abs: 'web:1:x', kind: 'web', title: 'bad', url: 123, open: true, pinned: false }, // url 非法
      { abs: 'web:2:y', kind: 'web', title: 'nourl', open: true, pinned: false }, // url 缺失
      { abs: 'web:3:z', kind: 'web', title: 'ok', url: 'https://ok.com', open: true, pinned: false },
    ],
    activeRel: 'web:3:z',
  });
  const got = await store.getTabs(f, root);
  assert.equal(got.entries.length, 1);
  assert.equal(got.entries[0].abs, 'web:3:z');
});

test('空白新标签页（url=null 未置顶）非激活的落盘被过滤,激活的保留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const root = '/Users/me/ws';
  await store.setTabs(f, root, {
    entries: [
      { abs: 'web:1:x', kind: 'web', title: '新标签页', url: null, open: true, pinned: false }, // 非激活空白→丢
      { abs: 'web:2:y', kind: 'web', title: '新标签页', url: null, open: true, pinned: false }, // 激活空白→留
      { abs: 'web:3:z', kind: 'web', title: '钉住的新标签', url: null, open: false, pinned: true }, // 置顶空白→留
    ],
    activeRel: 'web:2:y',
  });
  const got = await store.getTabs(f, root);
  const keys = got.entries.map((e) => e.abs).sort();
  assert.deepEqual(keys, ['web:2:y', 'web:3:z']);
});

test('web 与 doc 混合持久化互不干扰', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const root = '/Users/me/ws';
  await store.setTabs(f, root, {
    entries: [
      { rel: 'doc.html', kind: 'html', title: 'doc', open: true, pinned: false },
      { abs: 'web:1:x', kind: 'web', title: 'A', url: 'https://a.com', open: true, pinned: false },
    ],
    activeRel: 'doc.html',
  });
  const got = await store.getTabs(f, root);
  assert.equal(got.entries.length, 2);
  assert.ok(got.entries.some((e) => e.rel === 'doc.html'));
  assert.ok(got.entries.some((e) => e.abs === 'web:1:x' && e.url === 'https://a.com'));
});

test('mergeTabsSync：registry 权威 url/title 合并进 web 条目（before-quit）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  const root = '/Users/me/ws';
  await store.setTabs(f, root, {
    entries: [
      { rel: 'doc.html', kind: 'html', title: 'doc', open: true, pinned: false },
      { abs: 'web:1:x', kind: 'web', title: '旧标题', url: 'https://old.com', open: true, pinned: false },
    ],
    activeRel: 'web:1:x',
  });
  // 模拟 registry 里页面已导航到新 URL/标题
  store.mergeTabsSync(f, root, { 'web:1:x': { url: 'https://new.com', title: '新标题' } });
  const got = await store.getTabs(f, root);
  const web = got.entries.find((e) => e.abs === 'web:1:x');
  assert.equal(web.url, 'https://new.com');
  assert.equal(web.title, '新标题');
  assert.ok(got.entries.some((e) => e.rel === 'doc.html')); // doc 不受影响
});

test('mergeTabsSync：无桶/无 root 安静跳过不抛', () => {
  assert.doesNotThrow(() => store.mergeTabsSync('/nonexistent/ws.json', '/r', { 'web:1:x': { url: 'x' } }));
});
