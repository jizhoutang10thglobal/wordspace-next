const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const store = require('../src/main/workspace-store.js');

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  return path.join(dir, 'workspace.json');
}

test('saveRoots then loadState round-trips roots + nextRootId', async () => {
  const f = await tmpStore();
  await store.saveRoots(f, [{ id: 'r1', path: '/Users/me/Projects/品牌' }, { id: 'r2', path: '/w2' }], 3);
  const s = await store.loadState(f);
  assert.deepEqual(s.roots, [
    { id: 'r1', path: '/Users/me/Projects/品牌' },
    { id: 'r2', path: '/w2' },
  ]);
  assert.equal(s.nextRootId, 3);
});

test('loadState on missing file → 空工作区（不抛）', async () => {
  const s = await store.loadState('/nonexistent/workspace.json');
  assert.deepEqual(s, { roots: [], nextRootId: 1, tabs: { entries: [], activeRel: null } });
});

test('loadState tolerates corrupt JSON / 坏 roots 条目', async () => {
  const f = await tmpStore();
  await fs.writeFile(f, 'not json{', 'utf8');
  assert.deepEqual((await store.loadState(f)).roots, []);
  await fs.writeFile(f, JSON.stringify({ version: 2, roots: [{ id: 'r1', path: '/w' }, { id: 7 }, 'junk'] }), 'utf8');
  assert.deepEqual((await store.loadState(f)).roots, [{ id: 'r1', path: '/w' }]);
});

test('getTabs/setTabs 全局单一集合 round-trip；saveRoots 不冲掉标签', async () => {
  const f = await tmpStore();
  await store.saveRoots(f, [{ id: 'r1', path: '/w1' }], 2);
  assert.deepEqual(await store.getTabs(f), { entries: [], activeRel: null }); // 缺省空
  const state = {
    entries: [
      { rootId: 'r1', rel: 'a.html', kind: 'html', title: 'a.html', open: true, pinned: false },
      { rootId: 'r2', rel: '数据/b.html', kind: 'html', title: 'b.html', open: false, pinned: true },
    ],
    activeRel: 'r1:a.html',
  };
  await store.setTabs(f, state);
  assert.deepEqual(await store.getTabs(f), state);
  // 重新 saveRoots（加根/减根会做）不能把标签冲掉
  await store.saveRoots(f, [{ id: 'r1', path: '/w1' }, { id: 'r2', path: '/w2' }], 3);
  assert.deepEqual(await store.getTabs(f), state);
});

test('setTabs drops ghost/invalid entries（rel 无 rootId 也算坏数据）', async () => {
  const f = await tmpStore();
  await store.setTabs(f, {
    entries: [
      { rootId: 'r1', rel: 'ok.html', kind: 'html', title: 'ok.html', open: true, pinned: false },
      { rootId: 'r1', rel: 'ghost.html', kind: 'html', title: 'g', open: false, pinned: false }, // 幽灵
      { rel: 'no-root.html', kind: 'html', title: 'n', open: true }, // rel 无 rootId
      { kind: 'html', open: true }, // 无 rel 无 abs
    ],
    activeRel: 'r1:ok.html',
  });
  const r = await store.getTabs(f);
  assert.deepEqual(r.entries.map((e) => e.rel), ['ok.html']);
});

test('外部标签（无 rel、有 abs、无 rootId）能 round-trip；abs/kind/title 字段保留', async () => {
  const f = await tmpStore();
  const state = {
    entries: [
      { rootId: 'r1', rel: 'in.html', kind: 'html', title: 'in.html', open: true, pinned: false },
      { abs: '/Users/x/Downloads/out.pdf', kind: 'pdf', title: 'out.pdf', open: true, pinned: false }, // 外部
    ],
    activeRel: '/Users/x/Downloads/out.pdf', // 外部激活项的 keyOf 是 abs
  };
  await store.setTabs(f, state);
  const r = await store.getTabs(f);
  assert.equal(r.entries.length, 2);
  const e = r.entries.find((x) => x.abs === '/Users/x/Downloads/out.pdf');
  assert.ok(e && e.kind === 'pdf' && e.title === 'out.pdf' && !e.rel);
  assert.equal(r.activeRel, '/Users/x/Downloads/out.pdf');
});

// ===== v1 → v2 迁移 =====

test('v1 迁移：root+tabsByRoot → roots=[r1]、entries 补 rootId、activeRel 裸 rel 升 r1:rel', async () => {
  const f = await tmpStore();
  await fs.writeFile(
    f,
    JSON.stringify({
      root: '/w',
      savedAt: 123,
      tabsByRoot: {
        '/w': {
          entries: [
            { rel: 'a.html', kind: 'html', title: 'a.html', open: true, pinned: false },
            { abs: '/tmp/out.html', kind: 'html', title: 'out.html', open: true, pinned: false },
          ],
          activeRel: 'a.html',
        },
        '/other': { entries: [{ rel: 'x.html', kind: 'html', title: 'x', open: true, pinned: false }], activeRel: null },
      },
    }),
    'utf8',
  );
  const s = await store.loadState(f);
  assert.deepEqual(s.roots, [{ id: 'r1', path: '/w' }]);
  assert.equal(s.nextRootId, 2);
  const a = s.tabs.entries.find((e) => e.rel === 'a.html');
  assert.equal(a.rootId, 'r1'); // rel entry 补了 rootId
  assert.ok(s.tabs.entries.some((e) => e.abs === '/tmp/out.html' && !e.rootId)); // 外部原样
  assert.equal(s.tabs.activeRel, 'r1:a.html'); // 裸 rel 升格
});

test('v1 迁移：activeRel 是外部 abs 时原样保留', async () => {
  const f = await tmpStore();
  await fs.writeFile(
    f,
    JSON.stringify({
      root: '/w',
      tabsByRoot: {
        '/w': {
          entries: [{ abs: '/tmp/out.html', kind: 'html', title: 'out', open: true, pinned: false }],
          activeRel: '/tmp/out.html',
        },
      },
    }),
    'utf8',
  );
  const s = await store.loadState(f);
  assert.equal(s.tabs.activeRel, '/tmp/out.html');
});

test('v0.4.0 pinsByRoot 迁移：rel 列表 → r1 的 pinned entries', async () => {
  const f = await tmpStore();
  await fs.writeFile(f, JSON.stringify({ root: '/w', pinsByRoot: { '/w': ['a.html', '素材/封面.png'] } }), 'utf8');
  const s = await store.loadState(f);
  assert.deepEqual(
    s.tabs.entries.map((e) => [e.rootId, e.rel, e.kind, e.open, e.pinned]),
    [
      ['r1', 'a.html', 'html', false, true],
      ['r1', '素材/封面.png', 'image', false, true],
    ],
  );
  assert.equal(s.tabs.activeRel, null);
});

test('v1 文件上先 saveRoots：迁移的标签被固化，不因写根丢失', async () => {
  const f = await tmpStore();
  await fs.writeFile(
    f,
    JSON.stringify({
      root: '/w',
      tabsByRoot: { '/w': { entries: [{ rel: 'a.html', kind: 'html', title: 'a', open: true, pinned: false }], activeRel: 'a.html' } },
    }),
    'utf8',
  );
  // 启动恢复后第一次写盘（比如用户加了第二个根）
  await store.saveRoots(f, [{ id: 'r1', path: '/w' }, { id: 'r2', path: '/w2' }], 3);
  const r = await store.getTabs(f);
  assert.equal(r.entries.length, 1); // 旧标签还在
  assert.equal(r.entries[0].rootId, 'r1');
  assert.equal(r.activeRel, 'r1:a.html');
});

test('并发 saveRoots + setTabs 不互相 clobber（rmw 串行化）', async () => {
  const f = await tmpStore();
  await Promise.all([
    store.saveRoots(f, [{ id: 'r1', path: '/w1' }], 2),
    store.setTabs(f, {
      entries: [{ rootId: 'r1', rel: 'a.html', kind: 'html', title: 'a', open: true, pinned: false }],
      activeRel: 'r1:a.html',
    }),
    store.saveRoots(f, [{ id: 'r1', path: '/w1' }, { id: 'r2', path: '/w2' }], 3),
  ]);
  const s = await store.loadState(f);
  assert.equal(s.roots.length, 2); // 最后一次 saveRoots 生效
  assert.equal(s.tabs.entries.length, 1); // setTabs 没被冲掉
});

test('clear removes the store', async () => {
  const f = await tmpStore();
  await store.saveRoots(f, [{ id: 'r1', path: '/x' }], 2);
  await store.clear(f);
  assert.deepEqual((await store.loadState(f)).roots, []);
});
