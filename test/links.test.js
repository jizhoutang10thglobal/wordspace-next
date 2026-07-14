'use strict';
// 文档互链路径代数的 property 测试（对抗审查 L1 定的门，移植自 ui-demo/scripts/test-links.mjs 的 50 断言）。
// 核心不变式：resolveHref(from, relHref(from, to)) === to —— 对任意合法文件名（含 URL 特殊字符 : % # ?）成立。
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveHref, relHref, splitHrefSuffix, normalizePath, linkTarget, classifyScheme, invertMoves, relHrefAbs, resolveHrefAbs } = require('../src/lib/links');

test('往返对称 resolveHref(from, relHref(from,to)) === to（含刁钻文件名全组合）', () => {
  const froms = ['a.html', 'docs/a.html', 'a/bc/x.html', '深/层/子/目录/x.html'];
  const tos = [
    'b.html', 'docs/spec.html', 'a/b/y.html', 'a/bc/z.html',
    'draft:v2.html',       // 冒号撞 scheme
    '规格/涨幅100%.html',   // % 撞转义
    'C# 笔记.html',         // # 撞 URL 分隔符
    '去哪?.html',           // ? 撞查询
    '子目录/100%完成#终版?.html', // 三合一
    '深/层/别处/y.md',
  ];
  for (const f of froms) {
    for (const t of tos) {
      const href = relHref(f, t);
      assert.equal(resolveHref(f, href), t, `roundtrip ${f} → ${t} (href=${href})`);
    }
  }
});

test('跨根往返对称 resolveHrefAbs(from, relHrefAbs(from,to)) === to（绝对路径域，含刁钻文件名）', () => {
  // 两个「文件夹空间」的绝对路径（同盘）：不同根、不同深度、共同祖先深浅不一
  const froms = [
    '/tmp/工作笔记/周报.html',
    '/tmp/工作笔记/子/深/x.html',
    '/Users/me/Docs/甲方/a.html',
    '/vol/根一/n.md',
  ];
  const tos = [
    '/tmp/项目资料/报价单.html',
    '/tmp/项目资料/存档/2026/y.html',
    '/Users/me/Other/draft:v2.html',   // 冒号撞 scheme
    '/vol/根二/涨幅100%.html',          // % 撞转义
    '/tmp/资料/C# 笔记.html',           // # 撞分隔
    '/tmp/资料/去哪?.html',             // ? 撞查询
    '/srv/库/子/100%完成#终版?.html',   // 三合一
    '/Users/me/别处/y.md',
  ];
  for (const f of froms) {
    for (const t of tos) {
      const href = relHrefAbs(f, t);
      assert.ok(href != null, `relHrefAbs 非空 ${f} → ${t}`);
      assert.ok(!/^\//.test(href) && !/^[a-z]+:/i.test(href), `跨根 href 是纯相对路径（非绝对/scheme）：${href}`);
      assert.equal(resolveHrefAbs(f, href), t, `abs roundtrip ${f} → ${t} (href=${href})`);
    }
  }
});

test('relHrefAbs/resolveHrefAbs 边界：非绝对/非法输入 → null；scheme/根绝对 href 拒绝', () => {
  assert.equal(relHrefAbs('相对/x.html', '/tmp/y.html'), null); // from 非绝对
  assert.equal(relHrefAbs('/tmp/x.html', 'relB/y.html'), null); // to 非绝对
  assert.equal(relHrefAbs(null, '/a'), null);
  assert.equal(resolveHrefAbs('相对/x.html', '../y.html'), null); // from 非绝对
  assert.equal(resolveHrefAbs('/tmp/a/x.html', 'https://x.com'), null); // 外链
  assert.equal(resolveHrefAbs('/tmp/a/x.html', '/etc/passwd'), null);   // 根绝对 href → 拒
  assert.equal(resolveHrefAbs('/tmp/a/x.html', '#锚'), null);           // 锚点
  // 同根内目标（虽然 A/B/C 里同根走 relHref 短形式，abs 版也要能正确算）
  assert.equal(resolveHrefAbs('/tmp/根/a.html', relHrefAbs('/tmp/根/a.html', '/tmp/根/子/b.html')), '/tmp/根/子/b.html');
});

test('段边界：a/bc 不是 a/b 的前缀（逐段比较，非逐字符）', () => {
  assert.equal(relHref('a/bc/x.html', 'a/b/y.html'), '../b/y.html');
  assert.equal(relHref('a/b/x.html', 'a/bc/y.html'), '../bc/y.html');
});

test('尾缀拆分 + resolve 忽略尾缀', () => {
  assert.deepEqual(splitHrefSuffix('a.html#sec'), ['a.html', '#sec']);
  assert.deepEqual(splitHrefSuffix('a.html?q=1#x'), ['a.html', '?q=1#x']);
  assert.deepEqual(splitHrefSuffix('a.html'), ['a.html', '']);
  assert.equal(resolveHref('docs/a.html', 'spec.html#chapter-2'), 'docs/spec.html');
});

test('边界拒绝：越根 / 外链 / 锚点 / 根绝对 → null', () => {
  assert.equal(resolveHref('a.html', '../escape.html'), null);
  assert.equal(resolveHref('a.html', 'https://x.com'), null);
  assert.equal(resolveHref('a.html', '#sec'), null);
  assert.equal(resolveHref('a.html', 'mailto:x@y.com'), null);
  assert.equal(resolveHref('a.html', '/abs.html'), null);
});

test('首段含冒号 → ./ 消歧（不被读端误判 scheme）', () => {
  const h = relHref('a.html', 'draft:v2.html');
  assert.ok(h.startsWith('./'), `expected ./ prefix, got ${h}`);
  assert.equal(resolveHref('a.html', h), 'draft:v2.html');
});

test('normalizePath 解 ./ 与 ..', () => {
  assert.equal(normalizePath('a/./b/../c.html'), 'a/c.html');
  assert.equal(normalizePath('../x'), null);
});

test('linkTarget 分类（U0 点击守卫用）', () => {
  assert.deepEqual(linkTarget('docs/a.html', 'https://x.com'), { kind: 'web', url: 'https://x.com' });
  assert.deepEqual(linkTarget('docs/a.html', 'mailto:x@y.com'), { kind: 'web', url: 'mailto:x@y.com' });
  assert.deepEqual(linkTarget('docs/a.html', '#sec'), { kind: 'anchor', id: 'sec' });
  assert.deepEqual(linkTarget('docs/a.html', 'file:///x.html'), { kind: 'ignore' }); // file: 不导航
  assert.deepEqual(linkTarget('docs/a.html', '/abs.html'), { kind: 'ignore' });       // 根绝对
  assert.deepEqual(linkTarget('docs/a.html', ''), { kind: 'ignore' });
  assert.deepEqual(linkTarget('a.html', '../escape.html'), { kind: 'ignore' });        // 根级再 .. = 越根
  assert.deepEqual(linkTarget('docs/a.html', '../escape.html'), { kind: 'doc', path: 'escape.html', suffix: '' }); // docs 上跳一级 = 根级，仍同根
  // 相对文档 → doc，含尾缀保留
  assert.deepEqual(linkTarget('docs/a.html', 'b.html'), { kind: 'doc', path: 'docs/b.html', suffix: '' });
  assert.deepEqual(linkTarget('docs/a.html', '../notes/c.html#sec'), { kind: 'doc', path: 'notes/c.html', suffix: '#sec' });
});

test('classifyScheme（U0 renderer 快速分流，不需 fromPath）', () => {
  assert.equal(classifyScheme('https://x.com'), 'web');
  assert.equal(classifyScheme('http://x.com'), 'web');
  assert.equal(classifyScheme('mailto:a@b.com'), 'web');
  assert.equal(classifyScheme('tel:123'), 'web');
  assert.equal(classifyScheme('#sec'), 'anchor');
  assert.equal(classifyScheme('/abs.html'), 'ignore');
  assert.equal(classifyScheme('\\\\evil.com\\share\\x.html'), 'ignore'); // Windows UNC 不当相对链接（防 NTLM 泄漏）
  assert.equal(classifyScheme('\\x.html'), 'ignore');
  assert.equal(classifyScheme('file:///x'), 'ignore');
  assert.equal(classifyScheme(''), 'ignore');
  assert.equal(classifyScheme('  '), 'ignore');
  assert.equal(classifyScheme('b.html'), 'relative');
  assert.equal(classifyScheme('../notes/c.html#sec'), 'relative');
  assert.equal(classifyScheme('子目录/去哪?.html'), 'relative');
});

test('invertMoves 反转映射', () => {
  const m = new Map([['a.html', 'b.html'], ['x/y.html', 'x/z.html']]);
  const inv = invertMoves(m);
  assert.equal(inv.get('b.html'), 'a.html');
  assert.equal(inv.get('x/z.html'), 'x/y.html');
});
