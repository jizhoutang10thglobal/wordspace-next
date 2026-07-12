const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ws = require('../src/main/workspace.js');

const HTML = '<!doctype html><html><body><h1>x</h1></body></html>';

// 收集树里所有 file rel + 所有 dir rel
function collect(tree) {
  const files = [];
  const dirs = [];
  (function w(nodes) {
    for (const n of nodes || []) {
      if (n.isDir) { dirs.push(n.rel); w(n.children); } else files.push(n.rel);
    }
  })(tree.tree);
  return { files, dirs };
}

test('readTree：.app 等 macOS 包显示成节点但不递归内部；node_modules/__pycache__/Pods/.DS_Store 完全隐藏', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-ignore-'));
  // 真文档
  await fs.writeFile(path.join(root, 'a.html'), HTML);
  await fs.mkdir(path.join(root, '公司'), { recursive: true });
  await fs.writeFile(path.join(root, '公司', 'b.md'), '# b');
  // A 档：.app 包，内部塞很多文件（模拟 Minecraft.app）
  await fs.mkdir(path.join(root, 'Minecraft.app', 'Contents', 'Resources'), { recursive: true });
  for (let i = 0; i < 30; i++) await fs.writeFile(path.join(root, 'Minecraft.app', 'Contents', 'Resources', `r${i}.txt`), 'x');
  await fs.writeFile(path.join(root, 'Minecraft.app', 'Contents', 'Info.plist'), 'x');
  // .photoslibrary 也是包
  await fs.mkdir(path.join(root, '相册.photoslibrary', 'originals'), { recursive: true });
  await fs.writeFile(path.join(root, '相册.photoslibrary', 'originals', 'p.jpg'), 'x');
  // B 档：依赖/缓存目录
  await fs.mkdir(path.join(root, 'node_modules', 'lodash'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'lodash', 'index.js'), 'x');
  await fs.mkdir(path.join(root, '__pycache__'), { recursive: true });
  await fs.writeFile(path.join(root, '__pycache__', 'm.pyc'), 'x');
  await fs.mkdir(path.join(root, 'Pods'), { recursive: true });
  await fs.writeFile(path.join(root, 'Pods', 'x.h'), 'x');
  // C 档：隐藏垃圾
  await fs.writeFile(path.join(root, '.DS_Store'), 'x');
  await fs.mkdir(path.join(root, '.git', 'objects'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'objects', 'ab'), 'x');

  const tree = await ws.readTree(root);
  const { files, dirs } = collect(tree);

  // 真文档在
  assert.ok(files.includes('a.html'), 'a.html 应在');
  assert.ok(files.includes('公司/b.md'), '公司/b.md 应在');
  assert.ok(dirs.includes('公司'), '公司 目录应在');

  // A 档：包本身作为节点在，但内部一个文件都没进树
  assert.ok(dirs.includes('Minecraft.app'), 'Minecraft.app 应显示成一个节点');
  assert.equal(files.filter((f) => f.startsWith('Minecraft.app/')).length, 0, 'Minecraft.app 内部文件不该进树');
  assert.equal(dirs.filter((d) => d.startsWith('Minecraft.app/')).length, 0, 'Minecraft.app 内部目录不该进树');
  assert.ok(dirs.includes('相册.photoslibrary'), '.photoslibrary 应显示成节点');
  assert.equal(files.filter((f) => f.startsWith('相册.photoslibrary/')).length, 0, '.photoslibrary 内部不该进树');

  // B 档：完全隐藏（连节点都没有）
  for (const junk of ['node_modules', '__pycache__', 'Pods']) {
    assert.equal(dirs.filter((d) => d === junk || d.startsWith(junk + '/')).length, 0, `${junk} 应完全隐藏`);
  }
  assert.equal(files.filter((f) => f.includes('node_modules') || f.includes('__pycache__') || f.includes('Pods')).length, 0);

  // C 档：隐藏垃圾不进树
  assert.equal(files.filter((f) => f.includes('.DS_Store')).length, 0, '.DS_Store 应隐藏');
  assert.equal(dirs.filter((d) => d.startsWith('.git')).length, 0, '.git 应隐藏');

  await fs.rm(root, { recursive: true, force: true });
});

test('isBundle 只认包后缀，普通同名词不误伤（build/dist/target 目录保留）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-ignore2-'));
  // 普通词命名的真文件夹，不该被 B 档误杀
  for (const name of ['build', 'dist', 'target', 'out', '应用']) {
    await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, name, 'doc.html'), HTML);
  }
  const { dirs, files } = collect(await ws.readTree(root));
  for (const name of ['build', 'dist', 'target', 'out', '应用']) {
    assert.ok(dirs.includes(name), `普通文件夹 ${name} 不该被误杀`);
    assert.ok(files.includes(`${name}/doc.html`), `${name}/doc.html 应保留`);
  }
  await fs.rm(root, { recursive: true, force: true });
});
