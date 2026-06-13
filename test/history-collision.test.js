// 修复覆盖：同毫秒并发/连续归档不丢版本（不被同名时间戳覆盖）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const history = require('../src/main/history.js');

test('同毫秒并发归档：两版都保留、可读、未覆盖', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wshc-'));
  await Promise.all([
    history.archive(root, '/x/doc.html', 'v1'),
    history.archive(root, '/x/doc.html', 'v2'),
  ]);
  const list = await history.list(root, '/x/doc.html');
  assert.equal(list.length, 2, '同毫秒两版应都在');
  const contents = (await Promise.all(list.map((v) => history.read(root, '/x/doc.html', v.id)))).sort();
  assert.deepEqual(contents, ['v1', 'v2']);
});

test('连续 5 次同步归档全部保留', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wshc-'));
  for (let i = 0; i < 5; i++) await history.archive(root, '/y/doc.html', 'v' + i);
  const list = await history.list(root, '/y/doc.html');
  assert.equal(list.length, 5);
  // 最新（v4）排第一
  assert.equal(await history.read(root, '/y/doc.html', list[0].id), 'v4');
});
