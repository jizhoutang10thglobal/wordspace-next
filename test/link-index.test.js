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

test('readDocMeta：出链解析成同根 rel，外链/锚点/越界丢弃', async () => {
  const dir = await mkRoot({
    'docs/a.html': DOC('A', '<p><a href="b.html">B</a> <a href="../top.html">Top</a> <a href="#sec">锚</a> <a href="https://x.com">外</a> <a href="../../escape.html">越界</a></p>'),
  });
  const meta = await idx.readDocMeta(path.join(dir, 'docs/a.html'), 'docs/a.html');
  assert.equal(meta.title, 'A');
  const rels = meta.outLinks.map((l) => l.rel).sort();
  assert.deepEqual(rels, ['docs/b.html', 'top.html']); // #锚/外链/越界(../../)全丢
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
