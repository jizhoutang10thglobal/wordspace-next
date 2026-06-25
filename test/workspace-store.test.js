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

test('clear removes the store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wstore-'));
  const f = path.join(dir, 'workspace.json');
  await store.save(f, '/x');
  await store.clear(f);
  assert.equal(await store.load(f), null);
});
