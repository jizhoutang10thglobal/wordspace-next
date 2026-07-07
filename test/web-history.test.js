// 浏览历史纯逻辑单测（U6 尾）。
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/lib/web-history');

test('add:http/https 记录、置顶、带 ts', () => {
  let l = H.add([], { url: 'https://a.com/', title: 'A', ts: 1 });
  l = H.add(l, { url: 'http://b.com/', title: 'B', ts: 2 });
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].url, 'http://b.com/'); // 最近在前
  assert.strictEqual(l[1].title, 'A');
});

test('add:非 http(s) 一律不记(about:blank/file/空/undefined)', () => {
  for (const url of ['about:blank', 'file:///tmp/x.html', '', undefined, 'wordspace://newtab', 'javascript:alert(1)']) {
    assert.strictEqual(H.add([], { url, title: 'x', ts: 1 }).length, 0, String(url));
  }
});

test('add:同 url 去重置顶,标题缺省沿用旧标题', () => {
  let l = H.add([], { url: 'https://a.com/', title: '老标题', ts: 1 });
  l = H.add(l, { url: 'https://b.com/', title: 'B', ts: 2 });
  l = H.add(l, { url: 'https://a.com/', ts: 3 }); // 重访,did-navigate 时还没新标题
  assert.strictEqual(l.length, 2);
  assert.strictEqual(l[0].url, 'https://a.com/');
  assert.strictEqual(l[0].title, '老标题'); // fallback 旧标题,不是裸 url
  assert.strictEqual(l[0].ts, 3);
});

test('add:封顶 CAP,挤掉最旧的', () => {
  let l = [];
  for (let i = 0; i < H.CAP + 20; i++) l = H.add(l, { url: `https://site${i}.com/`, title: `s${i}`, ts: i });
  assert.strictEqual(l.length, H.CAP);
  assert.strictEqual(l[0].url, `https://site${H.CAP + 19}.com/`); // 最新还在
  assert.ok(!l.some((e) => e.url === 'https://site0.com/'));       // 最老被挤掉
});

test('touchTitle:晚到的标题补进同 url 条目;空标题/坏 url 不动', () => {
  let l = H.add([], { url: 'https://a.com/', ts: 1 });
  l = H.touchTitle(l, 'https://a.com/', '真标题');
  assert.strictEqual(l[0].title, '真标题');
  assert.deepStrictEqual(H.touchTitle(l, 'https://a.com/', ''), l);
  assert.deepStrictEqual(H.touchTitle(l, 'about:blank', 'x'), l);
});

test('search:标题和 url 都能命中、大小写不敏感、限量、空词回空', () => {
  let l = [];
  l = H.add(l, { url: 'https://news.example.com/', title: '设计新闻', ts: 1 });
  l = H.add(l, { url: 'https://blog.example.com/', title: 'Engineering Blog', ts: 2 });
  assert.strictEqual(H.search(l, '设计').length, 1);
  assert.strictEqual(H.search(l, 'BLOG').length, 1);          // 标题大小写
  assert.strictEqual(H.search(l, 'example.com').length, 2);   // url 命中
  assert.strictEqual(H.search(l, 'example.com', 1).length, 1); // limit
  assert.strictEqual(H.search(l, '  ').length, 0);
  assert.strictEqual(H.search(l, '不存在的词').length, 0);
});

test('sanitize:坏形状/不可记 url 清掉,缺 title 用 url 顶,超 CAP 截断', () => {
  const dirty = [
    { url: 'https://ok.com/', title: 'OK', ts: 1 },
    { url: 'file:///etc/passwd', title: 'bad' },
    null,
    { url: 'https://untitled.com/' },
    'not-an-object',
    { title: '没 url' },
  ];
  const clean = H.sanitize(dirty);
  assert.strictEqual(clean.length, 2);
  assert.strictEqual(clean[1].title, 'https://untitled.com/');
  assert.strictEqual(H.sanitize(null).length, 0);
  assert.strictEqual(H.sanitize([...Array(H.CAP + 5)].map((_, i) => ({ url: `https://s${i}.com/` }))).length, H.CAP);
});
