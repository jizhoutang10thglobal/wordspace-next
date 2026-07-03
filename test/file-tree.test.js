const test = require('node:test');
const assert = require('node:assert');
const {
  buildFileTree,
  kindOf,
  assertInsideWorkspace,
  cleanLeafName,
} = require('../src/lib/file-tree.js');

test('buildFileTree nests + puts folders before files at each level', () => {
  const tree = buildFileTree([
    { path: 'a.html' },
    { path: '数据/转化.html' },
    { path: '素材/封面.png' },
  ]);
  // 顶层：两个文件夹（数据、素材）在前，文件 a.html 在后
  assert.deepEqual(
    tree.map((n) => [n.name, n.isDir]),
    [['数据', true], ['素材', true], ['a.html', false]],
  );
  const shucai = tree.find((n) => n.name === '素材');
  assert.equal(shucai.children[0].name, '封面.png');
  assert.equal(shucai.children[0].rel, '素材/封面.png');
  assert.equal(shucai.children[0].kind, 'image');
});

test('buildFileTree sorts by pinyin/numeric', () => {
  const tree = buildFileTree([
    { path: '说明.html' },
    { path: '落地页.html' },
    { path: '提案.html' },
  ]);
  // 拼音序：落(luo) < 说(shuo) < 提(ti)
  assert.deepEqual(tree.map((n) => n.name), ['落地页.html', '说明.html', '提案.html']);
});

test('buildFileTree sorts numerically, not lexically (文件2 < 文件10 < 文件100)', () => {
  const tree = buildFileTree([
    { path: '文件100.html' },
    { path: '文件10.html' },
    { path: '文件2.html' },
    { path: '文件1.html' },
  ]);
  assert.deepEqual(tree.map((n) => n.name), ['文件1.html', '文件2.html', '文件10.html', '文件100.html']);
});

test('buildFileTree shows an explicit empty dir', () => {
  const tree = buildFileTree([], ['素材']);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, '素材');
  assert.equal(tree[0].isDir, true);
  assert.deepEqual(tree[0].children, []);
});

test('kindOf maps extensions case-insensitively; no-ext is other', () => {
  assert.equal(kindOf('x.HTML'), 'html');
  assert.equal(kindOf('a.htm'), 'html');
  assert.equal(kindOf('笔记.md'), 'md');
  assert.equal(kindOf('NOTES.MD'), 'md');
  assert.equal(kindOf('cover.PNG'), 'image');
  assert.equal(kindOf('report.pdf'), 'pdf');
  assert.equal(kindOf('plan.docx'), 'word');
  assert.equal(kindOf('data.xlsx'), 'sheet');
  assert.equal(kindOf('deck.pptx'), 'slides');
  assert.equal(kindOf('README'), 'other');
  assert.equal(kindOf('weird.zip'), 'other');
});

test('assertInsideWorkspace accepts paths under root, rejects escapes', () => {
  assert.equal(assertInsideWorkspace('/w', '/w/a/b.html'), '/w/a/b.html');
  assert.equal(assertInsideWorkspace('/w', 'a/b.html'), '/w/a/b.html'); // relative
  assert.equal(assertInsideWorkspace('/w', '/w'), '/w'); // root itself
  assert.throws(() => assertInsideWorkspace('/w', '/w/../etc/passwd'));
  assert.throws(() => assertInsideWorkspace('/w', '/etc/passwd'));
  assert.throws(() => assertInsideWorkspace('/w', '/w/../w2/x'));
  assert.throws(() => assertInsideWorkspace('/w', '../escape'));
});

test('cleanLeafName strips separators and trims', () => {
  assert.equal(cleanLeafName('a/b'), 'ab');
  assert.equal(cleanLeafName('a\\b'), 'ab');
  assert.equal(cleanLeafName('  x  '), 'x');
  assert.equal(cleanLeafName('/'), '');
  assert.equal(cleanLeafName(null), '');
});
