const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ws = require('../src/main/workspace.js');

const HTML = '<!doctype html><html><body><h1>x</h1></body></html>';

async function seed() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wsroot-'));
  const backup = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-trash-'));
  await fs.writeFile(path.join(root, 'a.html'), HTML, 'utf8');
  await fs.mkdir(path.join(root, '数据'), { recursive: true });
  await fs.writeFile(path.join(root, '数据', 'b.html'), HTML, 'utf8');
  await fs.writeFile(path.join(root, '数据', 'c.png'), 'png', 'utf8');
  return { root, backup };
}
const isFile = async (p) => {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
};
const isDir = async (p) => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

test('readTree returns sorted nested tree of the workspace', async () => {
  const { root } = await seed();
  const { tree, name } = await ws.readTree(root);
  assert.equal(name, path.basename(root));
  // 数据(folder) before a.html(file)
  assert.deepEqual(tree.map((n) => [n.name, n.isDir]), [['数据', true], ['a.html', false]]);
  const d = tree.find((n) => n.name === '数据');
  assert.deepEqual(d.children.map((n) => n.name), ['b.html', 'c.png']);
  assert.equal(d.children.find((n) => n.name === 'c.png').kind, 'image');
});

test('newDoc creates a real .html on disk, uniquifies on collision', async () => {
  const { root } = await seed();
  const a = await ws.newDoc(root, '', '无标题文档', HTML);
  assert.ok(await isFile(path.join(root, '无标题文档.html')));
  assert.equal(a.rel, '无标题文档.html');
  const b = await ws.newDoc(root, '', '无标题文档', HTML);
  assert.equal(b.rel, '无标题文档 2.html');
  assert.ok(await isFile(path.join(root, '无标题文档 2.html')));
});

test('newDoc into a subfolder lands there', async () => {
  const { root } = await seed();
  const r = await ws.newDoc(root, '数据', 'x', HTML);
  assert.equal(r.rel, '数据/x.html');
  assert.ok(await isFile(path.join(root, '数据', 'x.html')));
});

test('makeDir creates a directory, uniquifies', async () => {
  const { root } = await seed();
  const a = await ws.makeDir(root, '', '素材');
  assert.ok(await isDir(path.join(root, '素材')));
  const b = await ws.makeDir(root, '', '素材');
  assert.equal(b.rel, '素材 2');
});

test('renamePath keeps extension, dedupes, strips illegal chars', async () => {
  const { root } = await seed();
  // a.html -> b : keeps .html
  const r = await ws.renamePath(root, 'a.html', 'b');
  assert.equal(r.rel, 'b.html');
  assert.ok(await isFile(path.join(root, 'b.html')));
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
  // illegal char stripped (no dir escape): "x/y" -> "xy.html"
  const r2 = await ws.renamePath(root, 'b.html', 'x/y');
  assert.equal(r2.rel, 'xy.html');
  // rename a dir keeps no ext
  const rd = await ws.renamePath(root, '数据', '资料');
  assert.equal(rd.rel, '资料');
  assert.ok(await isDir(path.join(root, '资料')));
});

test('movePath moves a file into another folder via fs.rename', async () => {
  const { root } = await seed();
  const r = await ws.movePath(root, 'a.html', '数据');
  assert.equal(r.rel, '数据/a.html');
  assert.ok(await isFile(path.join(root, '数据', 'a.html')));
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
});

test('movePath rejects moving a folder into its own subtree', async () => {
  const { root } = await seed();
  await fs.mkdir(path.join(root, '数据', 'sub'), { recursive: true });
  await assert.rejects(() => ws.movePath(root, '数据', '数据/sub'));
});

test('deletePath + undoDelete round-trips a file', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, 'a.html', backup);
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
  const r = await ws.undoDelete(root, token, backup);
  assert.equal(r.rel, 'a.html');
  assert.equal(await fs.readFile(path.join(root, 'a.html'), 'utf8'), HTML);
});

test('deletePath + undoDelete round-trips a whole folder', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, '数据', backup);
  assert.ok(!(await isDir(path.join(root, '数据'))));
  await ws.undoDelete(root, token, backup);
  assert.ok(await isDir(path.join(root, '数据')));
  assert.ok(await isFile(path.join(root, '数据', 'b.html')));
});

test('deletePath optionally hands to OS trash via injected trashItem', async () => {
  const { root, backup } = await seed();
  let trashed = null;
  await ws.deletePath(root, 'a.html', backup, { trashItem: (p) => (trashed = p) });
  assert.equal(trashed, path.join(root, 'a.html'));
});

// ---- 去重而非覆盖：数据安全契约（这些分支之前没被测到 → 假覆盖感） ----

test('renamePath onto an existing name dedupes, never overwrites the occupant', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, 'b.html'), '<html>OCCUPANT</html>', 'utf8');
  const r = await ws.renamePath(root, 'a.html', 'b'); // 撞 b.html
  assert.equal(r.rel, 'b 2.html');
  assert.ok(await isFile(path.join(root, 'b 2.html')));
  assert.equal(await fs.readFile(path.join(root, 'b.html'), 'utf8'), '<html>OCCUPANT</html>'); // 原 b.html 没被盖
});

test('movePath into a dir holding a same-name file dedupes, never overwrites', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, '数据', 'a.html'), '<html>OCCUPANT</html>', 'utf8');
  const r = await ws.movePath(root, 'a.html', '数据'); // 数据/ 已有 a.html
  assert.equal(r.rel, '数据/a 2.html');
  assert.ok(await isFile(path.join(root, '数据', 'a 2.html')));
  assert.equal(await fs.readFile(path.join(root, '数据', 'a.html'), 'utf8'), '<html>OCCUPANT</html>'); // 目标没被盖
});

test('undoDelete restores to a deduped name when the original slot is reoccupied', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, 'a.html', backup);
  await fs.writeFile(path.join(root, 'a.html'), '<html>NEW</html>', 'utf8'); // 原位被新文件占了
  const r = await ws.undoDelete(root, token, backup);
  assert.equal(r.rel, 'a 2.html');
  assert.equal(await fs.readFile(path.join(root, 'a 2.html'), 'utf8'), HTML); // 还原的旧内容落到 a 2.html
  assert.equal(await fs.readFile(path.join(root, 'a.html'), 'utf8'), '<html>NEW</html>'); // 占位的新文件没被盖
});

test('renamePath to blank / separators-only rejects and leaves the file untouched', async () => {
  const { root } = await seed();
  await assert.rejects(() => ws.renamePath(root, 'a.html', '   '));
  await assert.rejects(() => ws.renamePath(root, 'a.html', '/'));
  assert.ok(await isFile(path.join(root, 'a.html')));
});

test('all ops reject path traversal outside the workspace root', async () => {
  const { root } = await seed();
  await assert.rejects(() => ws.newDoc(root, '../evil', 'x', HTML));
  await assert.rejects(() => ws.renamePath(root, '../../etc/passwd', 'pwned'));
  await assert.rejects(() => ws.movePath(root, 'a.html', '../..'));
});
