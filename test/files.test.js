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

test('MD-1 writeDocSafe：allowWhitespaceOnly 放行 "\\n"（md 清空后可存），仍拒真空串', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-md1-'));
  const f = path.join(dir, 'a.md');
  await files.writeDocSafe(f, '\n', { allowWhitespaceOnly: true });
  assert.equal(await fs.readFile(f, 'utf8'), '\n');
  await assert.rejects(files.writeDocSafe(f, '', { allowWhitespaceOnly: true }), /empty/);
  await assert.rejects(files.writeDocSafe(f, '   '), /empty/); // 默认仍拒纯空白
});

test('MD-1/MP-2 writeDocSafe：默认拒空白 + 并发保存不撞（各自 tmp）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-mp2-'));
  const f = path.join(dir, 'a.html');
  // 10 路并发写同一文件，不应有一路因共用 tmp 而 ENOENT/空 tmp 报错
  await Promise.all(Array.from({ length: 10 }, (_, i) => files.writeDocSafe(f, '<p>v' + i + '</p>')));
  const out = await fs.readFile(f, 'utf8');
  assert.ok(/^<p>v\d<\/p>$/.test(out), '最终内容是某一路的完整产物：' + out);
  const leftover = (await fs.readdir(dir)).filter((n) => n.includes('.ws2tmp'));
  assert.equal(leftover.length, 0, '无残留 tmp：' + leftover.join(','));
});
