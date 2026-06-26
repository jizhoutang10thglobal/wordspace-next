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
