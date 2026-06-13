const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const recents = require('../src/main/recents.js');

test('add puts newest first, dedupes, caps at MAX', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const store = path.join(dir, 'recents.json');
  for (let i = 0; i < 12; i++) await recents.add(store, '/doc' + i + '.html');
  await recents.add(store, '/doc5.html');
  const list = await recents.load(store);
  assert.equal(list.length, recents.MAX);
  assert.equal(list[0].path, '/doc5.html');
  assert.equal(list.filter(r => r.path === '/doc5.html').length, 1);
});

test('load returns [] when store missing', async () => {
  const list = await recents.load('/nonexistent/recents.json');
  assert.deepEqual(list, []);
});

test('load tolerates non-array JSON in store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const store = path.join(dir, 'recents.json');
  await fs.writeFile(store, '{"not":"an array"}', 'utf8');
  assert.deepEqual(await recents.load(store), []);
  const list = await recents.add(store, '/x.html');
  assert.equal(list[0].path, '/x.html');
});
