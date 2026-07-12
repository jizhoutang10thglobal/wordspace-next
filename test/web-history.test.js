// 浏览历史纯逻辑单测（spec §4.8：60s 合并 / cap 500 / 范围清除 / 补全搜索去重）。
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/lib/web-history');

const T0 = 1_800_000_000_000;

test('recordable：只认 http(s)', () => {
  assert.ok(H.recordable('https://a.com/'));
  assert.ok(H.recordable('http://a.com/'));
  for (const bad of ['file:///x', 'about:blank', 'wordspace://newtab', 'javascript:1', '', null]) {
    assert.ok(!H.recordable(bad), String(bad));
  }
});

test('record：新条目置顶，带 id/url/title/visitedAt；不可记 url 原样返回', () => {
  let l = H.record([], { url: 'https://a.com/', title: 'A', ts: T0 });
  assert.strictEqual(l.length, 1);
  assert.ok(l[0].id);
  assert.strictEqual(l[0].title, 'A');
  assert.strictEqual(l[0].visitedAt, T0);
  const same = H.record(l, { url: 'file:///x', ts: T0 });
  assert.strictEqual(same, l);
  l = H.record(l, { url: 'https://b.com/', title: 'B', ts: T0 + 1000 });
  assert.strictEqual(l[0].url, 'https://b.com/'); // 新的在前
});

test('record：同 url 60s 内连续访问合并为一条（刷时间补标题，id 不变）；超 60s 记新条', () => {
  let l = H.record([], { url: 'https://a.com/', title: 'https://a.com/', ts: T0 });
  const id0 = l[0].id;
  l = H.record(l, { url: 'https://a.com/', title: 'A 真标题', ts: T0 + 30_000 });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].id, id0);
  assert.strictEqual(l[0].title, 'A 真标题');
  assert.strictEqual(l[0].visitedAt, T0 + 30_000);
  l = H.record(l, { url: 'https://a.com/', ts: T0 + 30_000 + 60_000 });
  assert.strictEqual(l.length, 2); // 超窗 → 新条目（浏览器历史保留多次访问）
});

test('record：合并只看头部条目——中间夹了别的站，同 url 60s 内也记新条', () => {
  let l = H.record([], { url: 'https://a.com/', ts: T0 });
  l = H.record(l, { url: 'https://b.com/', ts: T0 + 1000 });
  l = H.record(l, { url: 'https://a.com/', ts: T0 + 2000 });
  assert.strictEqual(l.length, 3);
});

test('record：cap 500 FIFO 淘汰最老', () => {
  let l = [];
  for (let i = 0; i < 505; i++) l = H.record(l, { url: 'https://s.com/' + i, ts: T0 + i * 100_000 });
  assert.strictEqual(l.length, H.CAP);
  assert.strictEqual(l[0].url, 'https://s.com/504');
  assert.ok(!l.some((e) => e.url === 'https://s.com/0')); // 最老的被挤掉
});

test('touchTitle：头部同 url 且 60s 内 → 补写标题；超窗/非头部不动', () => {
  let l = H.record([], { url: 'https://a.com/', ts: T0 }); // title = url
  l = H.touchTitle(l, 'https://a.com/', '真标题', T0 + 500);
  assert.strictEqual(l[0].title, '真标题');
  const stale = H.touchTitle(l, 'https://a.com/', '晚到', T0 + 70_000);
  assert.strictEqual(stale[0].title, '真标题');
  l = H.record(l, { url: 'https://b.com/', ts: T0 + 1000 });
  const nonHead = H.touchTitle(l, 'https://a.com/', '不是头部', T0 + 1500);
  assert.strictEqual(nonHead.find((e) => e.url === 'https://a.com/').title, '真标题');
});

test('removeOne 按 id 删单条', () => {
  let l = H.record([], { url: 'https://a.com/', ts: T0 });
  l = H.record(l, { url: 'https://b.com/', ts: T0 + 100_000 });
  const l2 = H.removeOne(l, l[1].id);
  assert.strictEqual(l2.length, 1);
  assert.strictEqual(l2[0].url, 'https://b.com/');
});

test('clearRange：删「比 cutoff 新」的记录，更老的保留；all 清空；未知 range 不动', () => {
  const now = T0 + 10 * 24 * 3600e3;
  let l = [];
  l = H.record(l, { url: 'https://old.com/', ts: now - 8 * 24 * 3600e3 }); // 8 天前
  l = H.record(l, { url: 'https://mid.com/', ts: now - 2 * 24 * 3600e3 }); // 2 天前
  l = H.record(l, { url: 'https://new.com/', ts: now - 600e3 }); // 10 分钟前
  const h1 = H.clearRange(l, '1h', now);
  assert.deepStrictEqual(h1.map((e) => e.url), ['https://mid.com/', 'https://old.com/']);
  const d1 = H.clearRange(l, '24h', now);
  assert.deepStrictEqual(d1.map((e) => e.url), ['https://mid.com/', 'https://old.com/']);
  const d7 = H.clearRange(l, '7d', now);
  assert.deepStrictEqual(d7.map((e) => e.url), ['https://old.com/']);
  assert.deepStrictEqual(H.clearRange(l, 'all', now), []);
  assert.strictEqual(H.clearRange(l, 'bogus', now), l);
});

test('search：标题/URL 不分大小写包含，最近优先，同 url 去重只出最近一条，limit 生效', () => {
  let l = [];
  l = H.record(l, { url: 'https://news.site/1', title: '早间新闻', ts: T0 });
  l = H.record(l, { url: 'https://other.com/', title: '别的', ts: T0 + 100_000 });
  l = H.record(l, { url: 'https://news.site/1', title: '晚间新闻', ts: T0 + 200_000 });
  const hits = H.search(l, 'NEWS');
  assert.strictEqual(hits.length, 1); // 同 url 去重
  assert.strictEqual(hits[0].title, '晚间新闻'); // 最近那条
  assert.deepStrictEqual(H.search(l, ''), []); // 空词不回
  let many = [];
  for (let i = 0; i < 10; i++) many = H.record(many, { url: 'https://m.com/' + i, title: 'hit', ts: T0 + i * 100_000 });
  assert.strictEqual(H.search(many, 'hit', 3).length, 3);
});

test('sanitize：坏形状丢弃、缺 id 补齐、cap 生效', () => {
  const l = H.sanitize([
    { url: 'https://a.com/', title: 'A', visitedAt: T0 },
    { url: 'file:///bad' },
    null,
    { url: 'https://b.com/' }, // 缺 title/visitedAt/id
  ]);
  assert.strictEqual(l.length, 2);
  assert.ok(l.every((e) => e.id && typeof e.visitedAt === 'number' && e.title));
  assert.strictEqual(l[1].title, 'https://b.com/');
  assert.deepStrictEqual(H.sanitize('garbage'), []);
});
