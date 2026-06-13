const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const files = require('../src/main/files.js');

test('writeDocSafe writes content', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const f = path.join(dir, 'a.html');
  await files.writeDocSafe(f, '<html>hi</html>');
  assert.equal(await fs.readFile(f, 'utf8'), '<html>hi</html>');
});

test('writeDocSafe refuses empty content and keeps original', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const f = path.join(dir, 'a.html');
  await fs.writeFile(f, 'original', 'utf8');
  await assert.rejects(() => files.writeDocSafe(f, ''));
  await assert.rejects(() => files.writeDocSafe(f, '   \n'));
  assert.equal(await fs.readFile(f, 'utf8'), 'original');
});

test('readDoc reads utf8', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const f = path.join(dir, 'a.html');
  await fs.writeFile(f, '中文', 'utf8');
  assert.equal(await files.readDoc(f), '中文');
});

test('writeDocSafe cleans up tmp file when rename fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const target = path.join(dir, 'adir');
  await fs.mkdir(target);
  await assert.rejects(() => files.writeDocSafe(target, 'content'));
  const leftovers = (await fs.readdir(dir)).filter(f => f.endsWith('.ws2tmp'));
  assert.deepEqual(leftovers, []);
});

test('readDocBuffer returns raw bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-'));
  const f = path.join(dir, 'a.html');
  const bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // GBK 编码的「中文」
  await fs.writeFile(f, bytes);
  const buf = await files.readDocBuffer(f);
  assert.ok(buf.equals(bytes));
});
