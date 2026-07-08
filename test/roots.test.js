const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/lib/roots.js');

// fold 显式注入保证跨平台确定性（默认值依 process.platform，mac/win 折叠、Linux 不折叠）。
const FOLD = { fold: true };
const NOFOLD = { fold: false };

const roots = [
  { id: 'r1', path: '/Users/me/Projects/品牌' },
  { id: 'r2', path: '/Users/me/Documents/资料' },
];

test('canonPath：去尾斜杠；根目录保留；fold 控制大小写折叠', () => {
  assert.equal(R.canonPath('/a/b/', NOFOLD), '/a/b');
  assert.equal(R.canonPath('/a/b///', NOFOLD), '/a/b');
  assert.equal(R.canonPath('/', NOFOLD), '/');
  assert.equal(R.canonPath('/A/B', FOLD), '/a/b');
  assert.equal(R.canonPath('/A/B', NOFOLD), '/A/B');
});

test('classifyRoot：same / child / parent / independent 四分类', () => {
  assert.deepEqual(R.classifyRoot('/Users/me/Projects/品牌', roots, NOFOLD), { rel: 'same', rootId: 'r1' });
  assert.deepEqual(R.classifyRoot('/Users/me/Projects/品牌/', roots, NOFOLD), { rel: 'same', rootId: 'r1' }); // 尾斜杠不碍事
  assert.deepEqual(R.classifyRoot('/Users/me/Projects/品牌/素材', roots, NOFOLD), { rel: 'child', parentId: 'r1' });
  assert.deepEqual(R.classifyRoot('/Users/me/Projects', roots, NOFOLD), { rel: 'parent', childIds: ['r1'] });
  assert.deepEqual(R.classifyRoot('/Users/me/Desktop', roots, NOFOLD), { rel: 'independent' });
});

test('classifyRoot：parent 能一次包住多个已有根', () => {
  const r = R.classifyRoot('/Users/me', roots, NOFOLD);
  assert.equal(r.rel, 'parent');
  assert.deepEqual(r.childIds, ['r1', 'r2']);
});

test('前缀判定带分隔符边界：/foo/bar 不是 /foo/bar-baz 的父目录', () => {
  const rs = [{ id: 'r1', path: '/foo/bar' }];
  assert.deepEqual(R.classifyRoot('/foo/bar-baz', rs, NOFOLD), { rel: 'independent' });
  assert.deepEqual(R.classifyRoot('/foo/bar2/x', rs, NOFOLD), { rel: 'independent' });
  assert.deepEqual(R.classifyRoot('/foo/bar/x', rs, NOFOLD), { rel: 'child', parentId: 'r1' });
});

test('Unicode NFC/NFD 归一：同一目录的两种分解形态判 same（macOS 磁盘名走 NFD）', () => {
  const nfc = '/Users/me/café'; // é 预组合
  const nfd = '/Users/me/café'; // e + 组合重音
  assert.equal(R.canonPath(nfc, NOFOLD), R.canonPath(nfd, NOFOLD));
  assert.deepEqual(R.classifyRoot(nfd, [{ id: 'r1', path: nfc }], NOFOLD), { rel: 'same', rootId: 'r1' });
  assert.deepEqual(R.classifyRoot(nfd + '/sub', [{ id: 'r1', path: nfc }], NOFOLD), { rel: 'child', parentId: 'r1' });
});

test('fold=true：大小写不同视为相同（mac/win 文件系统语义）', () => {
  const rs = [{ id: 'r1', path: '/Users/Me/Docs' }];
  assert.deepEqual(R.classifyRoot('/users/me/docs', rs, FOLD), { rel: 'same', rootId: 'r1' });
  assert.deepEqual(R.classifyRoot('/users/me/docs/sub', rs, FOLD), { rel: 'child', parentId: 'r1' });
  // Linux 语义下不折叠 → 不同路径
  assert.deepEqual(R.classifyRoot('/users/me/docs', rs, NOFOLD), { rel: 'independent' });
});

test('ownerOf：等于根 → rel=""；在根下 → rel 保留磁盘真实大小写；不在任何根 → null', () => {
  assert.deepEqual(R.ownerOf('/Users/me/Projects/品牌', roots, NOFOLD), { rootId: 'r1', rel: '' });
  assert.deepEqual(R.ownerOf('/Users/me/Projects/品牌/素材/Logo.png', roots, NOFOLD), {
    rootId: 'r1',
    rel: '素材/Logo.png',
  });
  assert.equal(R.ownerOf('/Users/me/Desktop/x.html', roots, NOFOLD), null);
  // fold 下大小写不同也能归属，rel 用原始大小写
  assert.deepEqual(R.ownerOf('/users/me/projects/品牌/A.html', roots, FOLD), { rootId: 'r1', rel: 'A.html' });
});

test('prefixUnder：子根相对父根的 rel 前缀（多级用 / 连）', () => {
  assert.equal(R.prefixUnder('/Users/me', '/Users/me/Projects/品牌'), 'Projects/品牌');
  assert.equal(R.prefixUnder('/Users/me/Projects', '/Users/me/Projects/品牌'), '品牌');
});
