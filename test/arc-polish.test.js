// Arc 润滑批(P1-P4)纯逻辑单测:关闭栈 / MRU / 分享链接清洗。
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/lib/tabs');
const U = require('../src/lib/url-input');

// —— pushClosed / popClosed(Cmd+Shift+T 重开) ——
test('pushClosed:入栈在前、同 key 去重只留最新、封顶', () => {
  let s = T.pushClosed([], { rel: 'a.html', open: true, pinned: false });
  s = T.pushClosed(s, { rel: 'b.html', open: true, pinned: false });
  assert.strictEqual(s[0].rel, 'b.html');
  s = T.pushClosed(s, { rel: 'a.html', open: true, pinned: true }); // 再关 a(这次是置顶态)
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].rel, 'a.html');
  assert.strictEqual(s[0].pinned, true); // 留的是最新快照
  for (let i = 0; i < 30; i++) s = T.pushClosed(s, { rel: `f${i}.html`, open: true, pinned: false });
  assert.strictEqual(s.length, 20); // 默认封顶 20
  assert.strictEqual(T.pushClosed(s, null), s); // 空 entry no-op
});

test('popClosed:弹最新、返回剩余;空栈安全', () => {
  const s = T.pushClosed(T.pushClosed([], { rel: 'a.html' }), { rel: 'b.html' });
  const { entry, rest } = T.popClosed(s);
  assert.strictEqual(entry.rel, 'b.html');
  assert.strictEqual(rest.length, 1);
  assert.deepStrictEqual(T.popClosed([]), { entry: null, rest: [] });
});

test('pushClosed:web 条目按 abs 键去重(keyOf 口径一致)', () => {
  let s = T.pushClosed([], { abs: 'web:1:x', kind: 'web', url: 'https://a.com/', open: true, pinned: false });
  s = T.pushClosed(s, { abs: 'web:1:x', kind: 'web', url: 'https://a.com/page2', open: true, pinned: false });
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].url, 'https://a.com/page2');
});

// —— mruBump(Ctrl+Tab 切换器) ——
test('mruBump:激活置顶、去重、空 key no-op', () => {
  let m = T.mruBump([], 'a');
  m = T.mruBump(m, 'b');
  m = T.mruBump(m, 'c');
  assert.deepStrictEqual(m, ['c', 'b', 'a']);
  m = T.mruBump(m, 'a'); // 回到 a
  assert.deepStrictEqual(m, ['a', 'c', 'b']);
  assert.deepStrictEqual(T.mruBump(m, null), m);
});

// —— cleanShareUrl(Cmd+Shift+C 拷链接) ——
test('cleanShareUrl:剥 utm/fbclid/gclid,保留功能参数,顺序无关', () => {
  assert.strictEqual(
    U.cleanShareUrl('https://a.com/p?utm_source=x&id=42&utm_campaign=y&fbclid=abc'),
    'https://a.com/p?id=42',
  );
  assert.strictEqual(U.cleanShareUrl('https://a.com/p?gclid=1&msclkid=2&spm=3'), 'https://a.com/p');
});

test('cleanShareUrl:无追踪参数原样(含 hash);非 URL/空值安全返回', () => {
  assert.strictEqual(U.cleanShareUrl('https://a.com/p?id=1#sec'), 'https://a.com/p?id=1#sec');
  assert.strictEqual(U.cleanShareUrl('not a url'), 'not a url');
  assert.strictEqual(U.cleanShareUrl(''), '');
  assert.strictEqual(U.cleanShareUrl(undefined), undefined);
});
