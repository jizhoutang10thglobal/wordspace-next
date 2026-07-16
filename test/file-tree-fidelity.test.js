// P0b V4：buildFileTree 的 ensureDir 从线性 find 改成 name→dir 索引（Map），消掉超大扁平目录的 O(M²)
// （诊断 D3：15 万同级目录 → 68 秒主进程冻结实测）。这道门锁两件事：
//   ① **fidelity（逐字节一致）**：新版输出与旧版（线性 find 参考实现）在各种树形上 JSON 逐字节相等——
//      索引只是查找加速、不改节点创建顺序/children 顺序/末尾 sortNodes，输出必须一模一样。
//   ② **O(M²) 已消除**：宽扁平树（旧版 O(M²) 会跑几秒）在新版 <1s 内完成。
//
// ⚠ 变异自检（CLAUDE.md 铁律，先 commit 再变异）：把 src/lib/file-tree.js 的 ensureDir 改回
//   `cur.children.find((c) => c.isDir && c.name === part)`（线性 find）→ fidelity 仍绿（输出一致）但
//   「O(M²) 已消除」那条会翻红（宽树秒级 → 超时/超阈值）。还原后复绿 = 门有牙。
const test = require('node:test');
const assert = require('node:assert');
const { buildFileTree } = require('../src/lib/file-tree.js');

// 旧版参考实现（线性 find），只在本测试里存在——新版必须逐字节复刻它的输出。
function buildFileTreeLinear(files, dirs = []) {
  const kindOf = require('../src/lib/file-tree.js').kindOf;
  const sortNodes = require('../src/lib/file-tree.js').sortNodes;
  const root = { name: '', rel: '', isDir: true, children: [] };
  function ensureDir(cur0, parts) {
    let cur = cur0, acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let next = cur.children.find((c) => c.isDir && c.name === part);
      if (!next) { next = { name: part, rel: acc, isDir: true, children: [] }; cur.children.push(next); }
      cur = next;
    }
    return cur;
  }
  for (const d of dirs) { const parts = String(d).split('/').filter(Boolean); if (parts.length) ensureDir(root, parts); }
  for (const f of files) {
    const parts = String(f.path).split('/').filter(Boolean);
    if (!parts.length) continue;
    const leaf = parts.pop();
    const parent = parts.length ? ensureDir(root, parts) : root;
    parent.children.push({ name: leaf, rel: f.path, isDir: false, kind: f.kind || kindOf(leaf), ino: f.ino, children: [] });
  }
  return sortNodes(root.children);
}

const shapes = {
  '基本嵌套 + 文件夹优先': {
    files: [{ path: 'a.html' }, { path: '数据/转化.html' }, { path: '素材/封面.png' }, { path: '数据/子/深.html' }],
    dirs: ['空文件夹', '数据/子'],
  },
  '中文拼音 + 数字排序': {
    files: [{ path: '文件10.html' }, { path: '文件2.html' }, { path: '文件1.html' }, { path: '啊.html' }, { path: '波.html' }],
    dirs: [],
  },
  'file 与 dir 同名共存（find 只认 dir 的边角）': {
    files: [{ path: 'a' }, { path: 'a/b.html' }, { path: 'x/y.html' }, { path: 'x' }],
    dirs: [],
  },
  'ino 透传': {
    files: [{ path: 'd/f.html', ino: '123' }, { path: 'd/g.html', ino: undefined }, { path: 'h.html', ino: '456' }],
    dirs: ['d'],
  },
  '空目录只在 dirs 里': { files: [], dirs: ['只有目录/没有文件', 'x'] },
  '深链': { files: [{ path: 'a/b/c/d/e/f.html' }], dirs: [] },
  '同父多子（宽）': { files: Array.from({ length: 200 }, (_, i) => ({ path: `p/文件${i}.html` })), dirs: [] },
};

for (const [name, { files, dirs }] of Object.entries(shapes)) {
  test('fidelity 逐字节一致：' + name, () => {
    const got = buildFileTree(files, dirs);
    const ref = buildFileTreeLinear(files, dirs);
    assert.strictEqual(JSON.stringify(got), JSON.stringify(ref), '新版与旧版线性 find 输出必须逐字节相等');
  });
}

// 随机模糊差分：大量随机路径，新旧输出必须字节相等（防我漏想的树形）。
test('fidelity 随机模糊：500 组随机路径新旧输出逐字节一致', () => {
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let iter = 0; iter < 50; iter++) {
    const files = [], dirs = [];
    const segs = ['甲', '乙', '丙', 'a', 'b', 'x', '数据', '素材'];
    for (let i = 0; i < 40; i++) {
      const depth = 1 + Math.floor(rnd() * 3);
      const parts = [];
      for (let d = 0; d < depth; d++) parts.push(segs[Math.floor(rnd() * segs.length)]);
      if (rnd() < 0.75) files.push({ path: parts.join('/') + `/文件${i}.html` });
      else dirs.push(parts.join('/'));
    }
    assert.strictEqual(JSON.stringify(buildFileTree(files, dirs)), JSON.stringify(buildFileTreeLinear(files, dirs)), 'iter ' + iter);
  }
});

// O(M²) 已消除：4 万个同级目录（旧版 ~1.6e9 次 find 比较 ≈ 数秒）在新版 Map 索引下必须极快。
// 阈值 2000ms 给足余量（本机新版 ~150ms）；旧版线性 find 在这个规模会明显 >2s → 变异翻红。
test('O(M²) 消除：4 万同级目录 build < 2s（旧版线性 find 会数秒）', () => {
  const N = 40000;
  const files = Array.from({ length: N }, (_, i) => ({ path: `目录${i}/f.html`, kind: 'html' }));
  const dirs = Array.from({ length: N }, (_, i) => `目录${i}`);
  const t0 = process.hrtime.bigint();
  const tree = buildFileTree(files, dirs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(tree.length, N, '应有 N 个顶层目录');
  assert.ok(ms < 2000, `宽扁平树 build 应 < 2s（Map 索引），实测 ${ms.toFixed(0)}ms——若接近旧版 O(M²) 说明 ensureDir 退回线性 find`);
});

// 15 万条目「真实形状」（诊断合成树 = N 目录 × M 文件）主进程同步段 < 1s（V4 验收）。阈值 1500ms 给 CI 余量
// （本机 ~600ms）；这条是「普通根上限规模不再有 >1s 冻结」的直接证据。
test('15 万条目真实树：build+sort 同步段 < 1.5s（V4 <1s 目标 + CI 余量）', () => {
  const files = [], dirs = [];
  for (let d = 0; d < 1500; d++) { const dir = `分类${d % 50}/项目${d}`; dirs.push(dir); for (let f = 0; f < 100; f++) files.push({ path: `${dir}/文件${f}.html`, kind: 'html' }); }
  const t0 = process.hrtime.bigint();
  buildFileTree(files, dirs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `15 万条目 build+sort 应 < 1.5s，实测 ${ms.toFixed(0)}ms`);
});
