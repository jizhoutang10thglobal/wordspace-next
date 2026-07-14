// 大根性能修复（Wendi 卡顿）三块纯逻辑的单测：
// ① isNoisePath——watcher 层噪音事件过滤（扫描根本看不见的路径，事件直接丢弃）；
// ② affectedDirsOf——变化路径 → 受影响目录归并（子树级重扫的范围判定）；
// ③ workspace.readSubtrees——子树级重扫本体（节点形状必须与 readTree 完全一致，renderer 直接 patch 进树）。
// fs.watch 本体（pending 收集/去抖/flush）不在这测——真事件管线由 e2e/live-tree.spec.js 在真 app 里守。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { isNoisePath, affectedDirsOf } = require('../src/lib/file-tree.js');
const ws = require('../src/main/workspace.js');

const HTML = '<!doctype html><html><body><h1>x</h1></body></html>';

test('isNoisePath：扫描看不见的路径 = 噪音；bundle 自身的事件不算（父目录列表会变）', () => {
  assert.equal(isNoisePath('.DS_Store'), true);
  assert.equal(isNoisePath('公司/.DS_Store'), true);
  assert.equal(isNoisePath('node_modules/lodash/index.js'), true);
  assert.equal(isNoisePath('.git/objects/ab'), true);
  assert.equal(isNoisePath('a/b/x.html.ws2tmp-123-4'), true);
  assert.equal(isNoisePath('Minecraft.app/Contents/Info.plist'), true); // 包内部 churn：树上只有包节点
  assert.equal(isNoisePath('Minecraft.app'), false); // 包自身增删/改名 → 父目录列表变，要重扫
  assert.equal(isNoisePath('公司/b.md'), false);
  assert.equal(isNoisePath('正常.html'), false);
});

test('affectedDirsOf：取父目录 + 祖先归并；根层变化/太散/空输入回落 null（= 全量）', () => {
  assert.deepEqual(affectedDirsOf(['公司/b.md', '公司/c.md']), ['公司']);
  assert.deepEqual(affectedDirsOf(['a/b/c/f.html', 'a/b/g.md']), ['a/b']); // a/b/c 被祖先 a/b 吸收
  assert.deepEqual(affectedDirsOf(['x/f.html', 'y/g.html']).sort(), ['x', 'y']);
  assert.equal(affectedDirsOf(['top.html']), null); // 根层文件 → 父目录是根 → 全量
  assert.equal(affectedDirsOf(['a/x.html', 'top.html']), null); // 任一条波及根层就全量
  assert.equal(affectedDirsOf(Array.from({ length: 9 }, (_, i) => `d${i}/f.html`)), null); // 超 cap(8)
  assert.equal(affectedDirsOf([]), null);
});

test('suggestDebounceMs：跟上次扫描耗时自适应，200ms floor / 3s cap', () => {
  const perfDiag = require('../src/main/perf-diag.js');
  const p = '/tmp/ws2-debounce-test-' + process.pid;
  assert.equal(perfDiag.suggestDebounceMs(p), 200); // 没扫过 → 默认
  perfDiag.recordRead(p, 5000, 1); // 全量扫一次 5s → 去抖 2 倍但封顶 3s
  assert.equal(perfDiag.suggestDebounceMs(p), 3000);
  perfDiag.recordScoped(p, 30); // 子树扫便宜 → 回落 floor,灵敏度回来
  assert.equal(perfDiag.suggestDebounceMs(p), 200);
  perfDiag.recordScoped(p, 400);
  assert.equal(perfDiag.suggestDebounceMs(p), 800);
});

test('readSubtrees：子树 children 形状与 readTree 完全一致（rel/abs/ino/kind）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-scoped-'));
  await fs.mkdir(path.join(root, '公司', '合同'), { recursive: true });
  await fs.writeFile(path.join(root, 'top.html'), HTML);
  await fs.writeFile(path.join(root, '公司', 'b.md'), '# b');
  await fs.writeFile(path.join(root, '公司', '合同', 'c.html'), HTML);

  const res = await ws.readSubtrees(root, ['公司/合同']);
  assert.equal(res.subtrees.length, 1);
  assert.equal(res.subtrees[0].dir, '公司/合同');
  const kids = res.subtrees[0].children;
  assert.equal(kids.length, 1);
  assert.equal(kids[0].rel, '公司/合同/c.html');
  assert.equal(kids[0].abs, path.join(root, '公司', '合同', 'c.html'));
  assert.equal(typeof kids[0].ino, 'string'); // ino 必须在：标签跟随改名的身份
  assert.equal(kids[0].kind, 'html');

  const full = await ws.readTree(root);
  const dirNode = full.tree.find((n) => n.name === '公司').children.find((n) => n.name === '合同');
  assert.deepEqual(
    kids.map((k) => ({ rel: k.rel, abs: k.abs, ino: k.ino, kind: k.kind })),
    dirNode.children.map((k) => ({ rel: k.rel, abs: k.abs, ino: k.ino, kind: k.kind })),
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('readSubtrees：目录被删上移最近祖先；波及根层回落 null；噪音目录略过；空目录 children=[]', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-scoped2-'));
  await fs.mkdir(path.join(root, '公司', '合同'), { recursive: true });
  await fs.mkdir(path.join(root, '空夹'), { recursive: true });
  await fs.writeFile(path.join(root, '公司', 'b.md'), '# b');

  // 空目录
  const r0 = await ws.readSubtrees(root, ['空夹']);
  assert.deepEqual(r0.subtrees, [{ dir: '空夹', children: [] }]);

  // 目录在事件与扫描之间被删 → 上移到最近还存在的祖先
  await fs.rm(path.join(root, '公司', '合同'), { recursive: true });
  const r1 = await ws.readSubtrees(root, ['公司/合同']);
  assert.equal(r1.subtrees[0].dir, '公司');
  assert.deepEqual(r1.subtrees[0].children.map((c) => c.rel), ['公司/b.md']);

  // 祖先归并：解析后 a 与 a/b 只扫 a（不重复、不重叠）
  await fs.mkdir(path.join(root, '公司', '合同'), { recursive: true });
  const r2 = await ws.readSubtrees(root, ['公司', '公司/合同']);
  assert.equal(r2.subtrees.length, 1);
  assert.equal(r2.subtrees[0].dir, '公司');

  // 整棵祖先链没了 → 波及根层 → null（调用方回落全量 readTree）
  await fs.rm(path.join(root, '公司'), { recursive: true });
  assert.equal(await ws.readSubtrees(root, ['公司/合同']), null);

  // 噪音目录（node_modules 内部）直接略过：不产 subtree、也不整单回落
  const r3 = await ws.readSubtrees(root, ['node_modules/lodash']);
  assert.deepEqual(r3.subtrees, []);

  // 越权路径拒绝（既有威胁模型：渲染层传来的路径不可信）
  await assert.rejects(() => ws.readSubtrees(root, ['../外面']));
  await fs.rm(root, { recursive: true, force: true });
});
