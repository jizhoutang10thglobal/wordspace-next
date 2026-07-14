'use strict';
// 链接索引（主进程可丢弃缓存）单测：真文件（tmpdir）驱动。索引永远从属磁盘。
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const idx = require('../src/main/link-index');

const DOC = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

async function mkRoot(files) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ws2-lidx-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  }
  return dir;
}

test('extractDocMeta：title 取首个 h1，抽 a[href] + 块 snippet', async () => {
  const { title, links } = await idx.extractDocMeta(
    DOC('文档标题', '<p>前言 <a href="b.html">去B</a> 尾</p><p>外 <a href="https://x.com">站</a></p>'));
  assert.equal(title, '文档标题');
  assert.equal(links.length, 2);
  assert.equal(links[0].href, 'b.html');
  assert.ok(links[0].snippet.includes('前言') && links[0].snippet.includes('去B'));
});

test('extractDocMeta：script/style 源码不混进 title/snippet（审查 #4）', async () => {
  const { title, links } = await idx.extractDocMeta(
    '<html><head><title>T</title></head><body><h1>标题<style>.x{color:red}</style></h1><p>正文<script>var s=1;alert(9)</script> <a href="b.html">L</a></p></body></html>');
  assert.equal(title, '标题'); // h1 里的 <style> 文本不进标题
  assert.ok(!links[0].snippet.includes('var s') && !links[0].snippet.includes('alert'), 'snippet 不含 script 源码');
  assert.ok(links[0].snippet.includes('正文') && links[0].snippet.includes('L'));
});

test('extractDocMeta：无 h1 时回退 <title>，都无 → 空', async () => {
  assert.equal((await idx.extractDocMeta('<html><head><title>T</title></head><body><p>x</p></body></html>')).title, 'T');
  assert.equal((await idx.extractDocMeta('<html><body><p>x</p></body></html>')).title, '');
});

test('readDocMeta：同根 rel + 越界存跨根边(targetAbs)，外链/锚点丢弃（A）', async () => {
  const dir = await mkRoot({
    'docs/a.html': DOC('A', '<p><a href="b.html">B</a> <a href="../top.html">Top</a> <a href="#sec">锚</a> <a href="https://x.com">外</a> <a href="../../escape.html">越界</a></p>'),
  });
  const meta = await idx.readDocMeta(path.join(dir, 'docs/a.html'), 'docs/a.html');
  assert.equal(meta.title, 'A');
  const rels = meta.outLinks.filter((l) => l.rel != null).map((l) => l.rel).sort();
  assert.deepEqual(rels, ['docs/b.html', 'top.html']); // 同根 rel：#锚/外链 丢
  // 越界 ../../escape.html：不再丢，存成跨根边（rel:null + 词法绝对 targetAbs）；查询时 fan-out 判归属
  const cross = meta.outLinks.filter((l) => l.rel == null);
  assert.equal(cross.length, 1);
  assert.ok(cross[0].targetAbs.endsWith('/escape.html') && cross[0].targetAbs[0] === '/');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('refreshRoot：全量建 + 增量（只重读变过的文件，未变的对象不动）', async () => {
  const rootId = 101;
  const dir = await mkRoot({
    'a.html': DOC('文档A', '<p><a href="b.html">去B</a></p>'),
    'b.html': DOC('文档B', '<p>B 正文</p>'),
    'sub/c.html': DOC('文档C', '<p><a href="../a.html">回A</a></p>'),
  });
  assert.equal(await idx.refreshRoot(rootId, dir), true);
  assert.deepEqual(idx.query(rootId).map((d) => d.rel).sort(), ['a.html', 'b.html', 'sub/c.html']);
  assert.equal(idx.titleOf(rootId, 'a.html'), '文档A');

  const bRef = idx._index.get(rootId).docs.get('b.html');
  // 改 a.html（内容变长 → size 变，必被检出）；b.html/c.html 不动
  await fsp.writeFile(path.join(dir, 'a.html'), DOC('文档A改', '<p><a href="b.html">去B</a> 加长内容确保 size 改变</p>'), 'utf8');
  assert.equal(await idx.refreshRoot(rootId, dir), true);
  assert.equal(idx.titleOf(rootId, 'a.html'), '文档A改');
  assert.strictEqual(idx._index.get(rootId).docs.get('b.html'), bRef, 'b.html 未变 → 同一对象（没被重读）');

  // 删 b.html → 从索引移除
  await fsp.rm(path.join(dir, 'b.html'));
  assert.equal(await idx.refreshRoot(rootId, dir), true);
  assert.equal(idx.titleOf(rootId, 'b.html'), null);
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('backlinks：根内反查正确（自链不算）', async () => {
  const rootId = 102;
  const dir = await mkRoot({
    'a.html': DOC('A', '<p><a href="target.html">链到目标</a></p>'),
    'sub/b.html': DOC('B', '<p><a href="../target.html">也链目标</a></p>'),
    'target.html': DOC('目标', '<p><a href="target.html">自链</a></p>'),
    'none.html': DOC('无关', '<p>没链接</p>'),
  });
  await idx.refreshRoot(rootId, dir);
  const bl = idx.backlinks(rootId, 'target.html').map((e) => e.rel).sort();
  assert.deepEqual(bl, ['a.html', 'sub/b.html']); // target 自链不计，none 无链
  const aEntry = idx.backlinks(rootId, 'target.html').find((e) => e.rel === 'a.html');
  assert.ok(aEntry.snippet.includes('链到目标'));
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

const DOCID = (title, id, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="wordspace-doc-id" content="${id}">${'<title>' + title + '</title>'}</head><body><h1>${title}</h1>${body}</body></html>`;

test('movedTarget：目标改名（保留 doc-id）→ 靠 doc-id 快照 carry-forward 反查现址（U7）', async () => {
  const rootId = 104;
  const dir = await mkRoot({
    'A.html': DOCID('A', 'id-A', '<p><a href="B.html">去B</a></p>'),
    'B.html': DOCID('B', 'id-B', '<p>B</p>'),
  });
  await idx.refreshRoot(rootId, dir); // A→B 出链快照 targetDocId=id-B
  await fsp.rename(path.join(dir, 'B.html'), path.join(dir, 'C.html')); // 外部改名，doc-id 随字节不变
  await idx.refreshRoot(rootId, dir);
  assert.strictEqual(idx.relOfDocId(rootId, 'id-B'), 'C.html'); // C.html 现在带 id-B
  assert.strictEqual(idx.movedTarget(rootId, 'A.html', 'B.html'), 'C.html'); // A 的断链靠 carry-forward 反查到 C
  assert.strictEqual(idx.movedTarget(rootId, 'A.html', 'nope.html'), null); // 没这条出链 → null
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('dirBacklinks：文件夹夹外反链（夹内互链不算，U6 删除守卫）', async () => {
  const rootId = 103;
  const dir = await mkRoot({
    'docs/a.html': DOC('A', '<p><a href="b.html">夹内互链</a></p>'), // 夹内 → 不算
    'docs/b.html': DOC('B', '<p>无外链</p>'),
    'outside.html': DOC('外部', '<p><a href="docs/a.html">链进夹内</a></p>'), // 夹外 → 算
    'other.html': DOC('无关', '<p>没链接</p>'),
  });
  await idx.refreshRoot(rootId, dir);
  const bl = idx.dirBacklinks(rootId, 'docs').map((e) => e.rel).sort();
  assert.deepEqual(bl, ['outside.html']); // 只有夹外的 outside.html；docs/a.html 夹内互链不计
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('ownOutlinks：文件=全部出链数；文件夹=夹内文档指向夹外的链接数（U-CR0 跨根移动守卫）', async () => {
  const rootId = 113;
  const dir = await mkRoot({
    'notes/plan.html': DOC('计划', '<p><a href="draft.html">同夹草稿</a> 与 <a href="../top.html">夹外总纲</a> 和 <a href="https://x.com">站外</a></p>'),
    'notes/draft.html': DOC('草稿', '<p><a href="../top.html">又指夹外</a></p>'),
    'top.html': DOC('总纲', '<p>无出链</p>'),
    'lonely.html': DOC('孤岛', '<p>没有任何链接</p>'),
  });
  await idx.refreshRoot(rootId, dir);
  // 文件：plan.html 有 2 条根内出链（draft.html + ../top.html；站外链不入索引）
  assert.equal(idx.ownOutlinks(rootId, 'notes/plan.html', false), 2);
  assert.equal(idx.ownOutlinks(rootId, 'lonely.html', false), 0);       // 无出链
  assert.equal(idx.ownOutlinks(rootId, 'notes/missing.html', false), 0); // 不存在的条目
  // 文件夹 notes/：plan→draft 是夹内互链（一起搬、不算）；plan→top 和 draft→top 各一条夹外 = 2
  assert.equal(idx.ownOutlinks(rootId, 'notes', true), 2);
  assert.equal(idx.ownOutlinks(rootId, 'notes', false), 0); // 目录当文件查 → docs 里没有该 rel 键 → 0
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

// 两个并列「文件夹空间」（同父目录 → '../空间乙/x' 可词法解析）：跨根链接的 fan-out。
async function mkTwoRoots(filesA, filesB, nameA, nameB) {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'ws2-xroot-'));
  const A = path.join(parent, nameA || '空间甲'), B = path.join(parent, nameB || '空间乙');
  for (const [rel, c] of Object.entries(filesA)) { const abs = path.join(A, rel); await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, c, 'utf8'); }
  for (const [rel, c] of Object.entries(filesB)) { const abs = path.join(B, rel); await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, c, 'utf8'); }
  return { parent, A, B };
}

test('跨根反链 fan-out：根 A 文档链到根 B 文件 → B 侧反链看到 A 来源，带 rootId（A）', async () => {
  const rA = 301, rB = 302;
  const { parent, A, B } = await mkTwoRoots(
    { 'note.html': DOC('笔记', '<p>见 <a href="../空间乙/target.html">目标</a></p>') },
    { 'target.html': DOC('目标', '<p>被指向</p>') });
  await idx.refreshRoot(rA, A);
  await idx.refreshRoot(rB, B);
  const bl = idx.backlinks(rB, 'target.html');
  assert.equal(bl.length, 1, '跨根来源应命中');
  assert.equal(bl[0].rootId, rA); // 来源在根 A，带 rootId 供 renderer 跳转/标空间名
  assert.equal(bl[0].rel, 'note.html');
  assert.deepEqual(idx.backlinks(rA, 'note.html'), []); // 反向无链接
  // 只建了 A、没建 B 时（模拟未 ensureAll）：跨根反链会漏——证明 fan-out 依赖调用方 ensureAll（ipc 侧保证）
  idx.removeRoot(rB);
  assert.deepEqual(idx.backlinks(rB, 'target.html'), []); // 目标根未建 → path 拿不到 → []
  idx.removeRoot(rA);
  await fsp.rm(parent, { recursive: true, force: true });
});

test('跨根删除守卫 dirBacklinks fan-out：跨根链进「文件夹」→ 夹外来源算，跨根 rel:null 不炸（A）', async () => {
  const rA = 311, rB = 312;
  const { parent, A, B } = await mkTwoRoots(
    { 'ref.html': DOC('引用', '<p><a href="../资料/子/inner.html">链进 B 的子夹</a></p>') },
    { '子/inner.html': DOC('内部', '<p>x</p>'), 'other.html': DOC('无关', '<p>没链接</p>') },
    '文档', '资料');
  await idx.refreshRoot(rA, A);
  await idx.refreshRoot(rB, B);
  // 删 B 的「子」文件夹：夹外引用来自根 A 的 ref.html（跨根）
  const dbl = idx.dirBacklinks(rB, '子');
  assert.equal(dbl.length, 1);
  assert.equal(dbl[0].rootId, rA);
  assert.equal(dbl[0].rel, 'ref.html');
  idx.removeRoot(rA); idx.removeRoot(rB);
  await fsp.rm(parent, { recursive: true, force: true });
});

test('索引 version 2：v1 旧缓存（无 targetAbs 字段）不命中 hydrate → 丢弃重建', async () => {
  const store = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ws2-idxv-')), 'link-index.json');
  await fsp.writeFile(store, JSON.stringify({ version: 1, byPath: { '/x': { docs: [] } } }), 'utf8');
  assert.equal(await idx.hydrate(store, 401, '/x'), false); // 版本不符 → 不命中（调用方全量重建）
  await fsp.rm(path.dirname(store), { recursive: true, force: true });
});

test('.md 文档：转 HTML 后同口径抽 title + 出链', async () => {
  const rootId = 103;
  const dir = await mkRoot({
    'note.md': '# 笔记标题\n\n正文 [去A](a.html) 结束。\n',
    'a.html': DOC('A', '<p>a</p>'),
  });
  await idx.refreshRoot(rootId, dir);
  assert.equal(idx.titleOf(rootId, 'note.md'), '笔记标题');
  assert.deepEqual(idx.backlinks(rootId, 'a.html').map((e) => e.rel), ['note.md']);
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('readDocMeta 读失败 → null（不毒化成空条目，审查 A）', async () => {
  const dir = await mkRoot({ 'a.html': DOC('A', '<p>a</p>') });
  assert.equal(await idx.readDocMeta(path.join(dir, '不存在.html'), '不存在.html'), null); // ENOENT → null
  await fsp.rm(dir, { recursive: true, force: true });
});

test('refreshRoot：读失败不覆盖旧有效条目（审查 A）', async () => {
  const rootId = 106;
  const dir = await mkRoot({ 'a.html': DOC('A', '<p><a href="b.html">L</a></p>'), 'b.html': DOC('B', '<p>b</p>') });
  await idx.refreshRoot(rootId, dir);
  assert.deepEqual(idx.backlinks(rootId, 'b.html').map((e) => e.rel), ['a.html']);
  // 改 a 内容（size 变 → 触发重读）+ 变不可读 → 重读应失败
  await fsp.writeFile(path.join(dir, 'a.html'), DOC('A', '<p><a href="b.html">L 更长内容触发 size 改变</a></p>'), 'utf8');
  await fsp.chmod(path.join(dir, 'a.html'), 0o000);
  let canRead = true; try { await fsp.readFile(path.join(dir, 'a.html'), 'utf8'); } catch { canRead = false; }
  await idx.refreshRoot(rootId, dir);
  if (!canRead) assert.deepEqual(idx.backlinks(rootId, 'b.html').map((e) => e.rel), ['a.html'], '读失败必须保留旧条目、不抹成空'); // root 下 chmod 无效 → 跳过断言
  await fsp.chmod(path.join(dir, 'a.html'), 0o644);
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('save 合并：不抹掉本会话未加载根的缓存 + keepPaths 剪枝（审查 B）', async () => {
  const dirA = await mkRoot({ 'a.html': DOC('A', '<p>a</p>') });
  const dirB = await mkRoot({ 'b.html': DOC('B', '<p>b</p>') });
  const store = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ws2-lidxmerge-')), 'links.json');
  await idx.refreshRoot(201, dirA); await idx.refreshRoot(202, dirB);
  await idx.save(store); // 会话1：A、B 都入盘
  idx.removeRoot(201); idx.removeRoot(202); // 模拟重启清内存
  await idx.refreshRoot(201, dirA); // 会话2：只加载 A
  await idx.save(store, new Set([dirA, dirB])); // keepPaths 含两根 → 合并保留 B
  assert.equal(await idx.hydrate(store, 202, dirB), true, 'B 缓存不该被全量覆盖抹掉');
  idx.removeRoot(202);
  await idx.save(store, new Set([dirA])); // B 不在 keepPaths → 剪掉
  assert.equal(await idx.hydrate(store, 202, dirB), false, 'keepPaths 剪掉已移除根');
  idx.removeRoot(201); idx.removeRoot(202);
  await fsp.rm(dirA, { recursive: true, force: true }); await fsp.rm(dirB, { recursive: true, force: true });
});

test('listNonDocFiles：列非文档文件（pdf/图片），带 kind + 去扩展 title', async () => {
  const dir = await mkRoot({ 'a.html': DOC('A', '<p>a</p>'), 'sub/图.png': 'png', '报告.pdf': 'pdf', 'note.md': '# n' });
  const others = await idx.listNonDocFiles(dir);
  const rels = others.map((o) => o.rel).sort();
  assert.deepEqual(rels, ['sub/图.png', '报告.pdf']); // .html/.md 不算（走 docs）
  const pdf = others.find((o) => o.rel === '报告.pdf');
  assert.equal(pdf.kind, 'pdf');
  assert.equal(pdf.title, '报告');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('持久化：save → hydrate 往返；损坏/版本不符 → 不命中', async () => {
  const rootId = 104;
  const dir = await mkRoot({ 'a.html': DOC('A', '<p><a href="b.html">B</a></p>'), 'b.html': DOC('B', '<p>b</p>') });
  const store = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ws2-lidxstore-')), 'links.json');
  await idx.refreshRoot(rootId, dir);
  await idx.save(store);
  idx.removeRoot(rootId);
  assert.equal(idx.titleOf(rootId, 'a.html'), null); // 清了
  const hit = await idx.hydrate(store, rootId, dir);
  assert.equal(hit, true);
  assert.equal(idx.titleOf(rootId, 'a.html'), 'A'); // 从缓存回来
  assert.deepEqual(idx.backlinks(rootId, 'b.html').map((e) => e.rel), ['a.html']);
  // 损坏 / 不同 path → 不命中
  await fsp.writeFile(store, '{bad json', 'utf8');
  assert.equal(await idx.hydrate(store, 999, dir), false);
  idx.removeRoot(rootId);
  await fsp.rm(dir, { recursive: true, force: true });
});
