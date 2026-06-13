const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const history = require('../src/main/history.js');

test('archive + list + read roundtrip', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  await history.archive(root, '/x/doc.html', 'v1');
  await new Promise(r => setTimeout(r, 5));
  await history.archive(root, '/x/doc.html', 'v2');
  const list = await history.list(root, '/x/doc.html');
  assert.equal(list.length, 2);
  assert.equal(await history.read(root, '/x/doc.html', list[0].id), 'v2');
  assert.equal(await history.read(root, '/x/doc.html', list[1].id), 'v1');
});

test('prunes beyond MAX_VERSIONS', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  for (let i = 0; i < history.MAX_VERSIONS + 5; i++) {
    await history.archive(root, '/x/doc.html', 'v' + i);
    await new Promise(r => setTimeout(r, 3));
  }
  const list = await history.list(root, '/x/doc.html');
  assert.equal(list.length, history.MAX_VERSIONS);
  assert.equal(await history.read(root, '/x/doc.html', list[0].id), 'v' + (history.MAX_VERSIONS + 4));
});

test('list returns [] for unknown file; read rejects bad id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  assert.deepEqual(await history.list(root, '/nope.html'), []);
  await assert.rejects(() => history.read(root, '/nope.html', '../../etc/passwd'));
});
