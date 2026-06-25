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

test('getPins/setPins persist per-root and survive a root re-save', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/w1');
  assert.deepEqual(await store.getPins(f, '/w1'), []); // 缺省空
  await store.setPins(f, '/w1', ['a.html', '数据/b.html']);
  assert.deepEqual(await store.getPins(f, '/w1'), ['a.html', '数据/b.html']);
  // 另一个根各自保留
  await store.setPins(f, '/w2', ['x.html']);
  assert.deepEqual(await store.getPins(f, '/w2'), ['x.html']);
  // 重新 save 根（pick-folder 会做）不能把置顶冲掉
  await store.save(f, '/w1');
  assert.deepEqual(await store.getPins(f, '/w1'), ['a.html', '数据/b.html']);
  assert.equal((await store.load(f)).root, '/w1'); // 旧契约不变
});

test('clear removes the store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/x');
  await store.clear(f);
  assert.equal(await store.load(f), null);
});
