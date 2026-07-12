const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/lib/url-input.js');
const Tld = require('../src/lib/tld-set.js');

// ---- 判定：URL vs 搜索 vs 拒绝 ----
test('真域名补 https', () => {
  const r = U.parse('baidu.com');
  assert.equal(r.kind, 'url');
  assert.equal(r.url, 'https://baidu.com');
});

test('长尾真 gTLD 也认（doc review：不能用手挑常见集）', () => {
  assert.equal(U.parse('shop.pizza').kind, 'url'); // .pizza 是真 gTLD
  assert.equal(U.parse('a.bar').kind, 'url'); // .bar 2014 入根区,是真 gTLD,不是假 TLD
});

test('未分配 TLD → 搜索（别拿 .bar 当假 TLD）', () => {
  const r = U.parse('foo.notatld');
  assert.equal(r.kind, 'search');
  assert.ok(r.url.indexOf('bing.com') !== -1);
  assert.ok(r.url.indexOf('foo.notatld') !== -1);
});

test('localhost / IP / 端口 → URL 补 http', () => {
  assert.deepEqual(U.parse('localhost:3000'), { kind: 'url', url: 'http://localhost:3000' });
  assert.deepEqual(U.parse('192.168.1.1'), { kind: 'url', url: 'http://192.168.1.1' });
  assert.deepEqual(U.parse('127.0.0.1:8080'), { kind: 'url', url: 'http://127.0.0.1:8080' });
});

test('IPv6 字面量 → URL', () => {
  assert.equal(U.parse('[::1]').kind, 'url');
  assert.equal(U.parse('http://[::1]:8080').kind, 'url');
});

test('非法 IPv4（>255）不当 IP，走域名判定 → 搜索', () => {
  assert.equal(U.parse('999.1.1.1').kind, 'search');
});

test('含空格一定是搜索', () => {
  const r = U.parse('how to center a div');
  assert.equal(r.kind, 'search');
  assert.ok(r.url.indexOf('how%20to') !== -1 || r.url.indexOf('how+to') !== -1 || r.url.indexOf('how%20to%20center') !== -1);
});

test('单词无点 → 搜索', () => {
  assert.equal(U.parse('wordspace').kind, 'search');
});

test('带 http/https scheme → 原样放行', () => {
  assert.deepEqual(U.parse('https://example.com/x?a=1'), { kind: 'url', url: 'https://example.com/x?a=1' });
  assert.deepEqual(U.parse('http://a.com'), { kind: 'url', url: 'http://a.com' });
});

test('file: / javascript: / data: / 自定义 scheme → blocked（KD-4 安全红线）', () => {
  assert.equal(U.parse('file:///etc/passwd').kind, 'blocked');
  assert.equal(U.parse('file:///Users/x/.ssh/id_rsa').kind, 'blocked');
  assert.equal(U.parse('javascript:alert(1)').kind, 'blocked');
  assert.equal(U.parse('data:text/html,<script>').kind, 'blocked');
  assert.equal(U.parse('chrome://settings').kind, 'blocked');
  assert.equal(U.parse('wordspace://newtab').kind, 'blocked');
});

test('空输入 → blocked（什么都不做）', () => {
  assert.equal(U.parse('').kind, 'blocked');
  assert.equal(U.parse('   ').kind, 'blocked');
  assert.equal(U.parse(null).kind, 'blocked');
  assert.equal(U.parse(undefined).kind, 'blocked');
});

test('带路径的真域名 → URL 补 https 保留路径', () => {
  assert.deepEqual(U.parse('github.com/electron/electron'), {
    kind: 'url',
    url: 'https://github.com/electron/electron',
  });
});

test('空标签域名（a..b / .a / a.）→ 搜索,不误当域名', () => {
  assert.equal(U.parse('a..b').kind, 'search');
  assert.equal(U.parse('.com').kind, 'search');
});

test('自定义搜索模板', () => {
  const r = U.parse('rust traits', { searchTemplate: 'https://duckduckgo.com/?q=%s' });
  assert.ok(r.url.indexOf('duckduckgo.com') !== -1);
});

// ---- 显示美化 ----
test('pretty 去 scheme/www/纯域名尾斜杠', () => {
  assert.equal(U.pretty('https://www.example.com/'), 'example.com');
  assert.equal(U.pretty('http://example.com'), 'example.com');
  assert.equal(U.pretty('https://github.com/a/b'), 'github.com/a/b'); // 有路径不去尾斜杠
  assert.equal(U.pretty(''), '');
  assert.equal(U.pretty(null), '');
});

// ---- TLD 快照本身 ----
test('TLD 快照非空且认得常见 + 长尾 + punycode', () => {
  assert.ok(Tld._size > 200, 'TLD 集应含数百条,不是手挑几条');
  assert.ok(Tld.isKnownTld('com') && Tld.isKnownTld('cn') && Tld.isKnownTld('io'));
  assert.ok(Tld.isKnownTld('pizza') && Tld.isKnownTld('bar') && Tld.isKnownTld('ai'));
  assert.ok(Tld.isKnownTld('xn--fiqs8s'), 'punycode TLD 靠 xn-- 形状放行');
  assert.ok(!Tld.isKnownTld('notatld'));
  assert.ok(Tld.isKnownTld('COM'), '大小写不敏感');
});
