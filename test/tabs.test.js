const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/lib/tabs.js');

const f = (rel, kind = 'html') => ({ rel, kind, title: rel.split('/').pop() });
const empty = () => ({ entries: [], activeRel: null });
const rels = (arr) => arr.map((e) => e.rel);

// 不变式：没有 !open&&!pinned 的幽灵 entry；置顶区(pinned) 与 标签页区(open&&!pinned) 天然互斥（去重）。
function invariant(state) {
  for (const e of state.entries) {
    assert.ok(e.open || e.pinned, `ghost entry leaked: ${T.keyOf(e)}`);
  }
  // 用 keyOf（rel||abs）而非裸 rel：多个外部 entry 的 rel 都是 undefined，用 rel 会误判「同时在两区」。
  const pinnedSet = new Set(T.pinnedEntries(state.entries).map((e) => T.keyOf(e)));
  const tabSet = new Set(T.tabEntries(state.entries).map((e) => T.keyOf(e)));
  for (const r of pinnedSet) assert.ok(!tabSet.has(r), `entry in both zones: ${r}`);
}
// 外部文件（工作区外，无 rel，用 abs 作身份）。
const ext = (abs, kind = 'html') => ({ abs, kind, title: abs.split('/').pop() });

test('openEntry: 新文件追加到标签页区并激活；重复打开只激活不新增', () => {
  let s = T.openEntry(empty(), f('a.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.equal(s.activeRel, 'a.html');
  s = T.openEntry(s, f('b.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html', 'b.html']);
  assert.equal(s.activeRel, 'b.html');
  const before = s.entries.length;
  s = T.openEntry(s, f('a.html')); // 重复
  assert.equal(s.entries.length, before);
  assert.equal(s.activeRel, 'a.html');
  invariant(s);
});

test('closeEntry: 关激活→激活剩下最后一个；关非激活→激活不变；关到空→null', () => {
  let s = T.openEntry(T.openEntry(T.openEntry(empty(), f('a.html')), f('b.html')), f('c.html'));
  // active=c。关非激活 a → active 仍 c
  s = T.closeEntry(s, 'a.html');
  assert.equal(s.activeRel, 'c.html');
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['b.html', 'c.html']);
  // 关激活 c → 激活剩下最后一个 b
  s = T.closeEntry(s, 'c.html');
  assert.equal(s.activeRel, 'b.html');
  // 关到空 → null
  s = T.closeEntry(s, 'b.html');
  assert.equal(s.activeRel, null);
  assert.deepEqual(s.entries, []);
  invariant(s);
});

test('pinEntry: 打开的标签钉→移出标签页进置顶；树里直接钉未打开的→建 open:false 的置顶项', () => {
  let s = T.openEntry(empty(), f('a.html')); // a 开着
  s = T.pinEntry(s, f('a.html')); // 钉 a
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), []); // 去重：不在标签页
  assert.equal(s.activeRel, 'a.html'); // 钉不抢/丢焦点
  // 树里直接钉一个没打开的 z
  s = T.pinEntry(s, f('z.html'));
  const ez = s.entries.find((e) => e.rel === 'z.html');
  assert.equal(ez.open, false);
  assert.equal(ez.pinned, true);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html', 'z.html']);
  invariant(s);
});

test('unpinEntry: 取消钉且还开着→落回标签页；取消钉且没开过→销毁', () => {
  // a 开着且钉了 → 取消钉 → 落回标签页
  let s = T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html'));
  s = T.unpinEntry(s, 'a.html');
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  // z 从树直接钉、没开 → 取消钉 → 销毁
  s = T.pinEntry(s, f('z.html'));
  s = T.unpinEntry(s, 'z.html');
  assert.ok(!s.entries.some((e) => e.rel === 'z.html'));
  invariant(s);
});

test('既钉又开：openEntry 一个已 pinned 的项仍只在置顶（守去重）', () => {
  let s = T.pinEntry(empty(), f('z.html')); // 钉、未开
  s = T.openEntry(s, f('z.html')); // 打开它
  assert.equal(s.activeRel, 'z.html');
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['z.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), []); // 不重复进标签页
  invariant(s);
});

test('关激活的开标签后只剩纯置顶快捷方式→回 null（不自动开置顶快捷）', () => {
  let s = T.openEntry(empty(), f('a.html')); // a 开着、激活
  s = T.pinEntry(s, f('z.html')); // z 钉、未开
  s = T.closeEntry(s, 'a.html'); // 关激活 a
  assert.equal(s.activeRel, null); // 只剩没开的 z → 回空态，不自动开 z
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['z.html']);
  invariant(s);
});

test('dropEntry: 同区重排到 toIndex；跨区设 pinned + 定位；越界夹紧', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html', 'c.html']) s = T.openEntry(s, f(r));
  // 标签页 [a,b,c]，把 c 拖到 index 0
  s = T.dropEntry(s, 'c.html', false, 0);
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['c.html', 'a.html', 'b.html']);
  // 把 a 跨区拖进置顶 index 0 → a 变 pinned
  s = T.dropEntry(s, 'a.html', true, 0);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['c.html', 'b.html']);
  // 越界 index 夹紧（拖 b 到置顶 index 99 → 末尾）
  s = T.dropEntry(s, 'b.html', true, 99);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html', 'b.html']);
  invariant(s);
});

test('dropEntry: 跨区拖回标签页 = unpin', () => {
  let s = T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')); // a 开+钉（在置顶）
  s = T.dropEntry(s, 'a.html', false, 0); // 拖回标签页
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  invariant(s);
});

test('retargetEntry: 改名/移动跟随 rel+title+kind，open/pinned/激活保持', () => {
  let s = T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')); // a 开+钉+激活
  s = T.retargetEntry(s, 'a.html', '数据/改名.html', '改名.html', 'html');
  const e = s.entries.find((x) => x.rel === '数据/改名.html');
  assert.ok(e);
  assert.equal(e.pinned, true);
  assert.equal(e.open, true);
  assert.equal(e.title, '改名.html');
  assert.equal(s.activeRel, '数据/改名.html'); // 激活跟随
  invariant(s);
});

test('removeEntry: 删除销毁 entry，激活项则回落', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html']) s = T.openEntry(s, f(r)); // active=b
  s = T.removeEntry(s, 'b.html'); // 删激活
  assert.ok(!s.entries.some((e) => e.rel === 'b.html'));
  assert.equal(s.activeRel, 'a.html');
  s = T.removeEntry(s, 'a.html');
  assert.equal(s.activeRel, null);
  invariant(s);
});

test('非 html 文件也进标签页（kind 保留）', () => {
  let s = T.openEntry(empty(), { rel: '数据/c.png', kind: 'image', title: 'c.png' });
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['数据/c.png']);
  assert.equal(s.entries[0].kind, 'image');
  invariant(s);
});

// ===== 对抗审计补的边界（守去重不变式不被破） =====

test('retargetEntry 撞名→合并成一个（open/pinned 取并集），不出现重复 rel', () => {
  // a 开+钉(置顶)，b 开(标签页)；把 b 改名/移成 a → 合并
  let s = T.openEntry(T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')), f('b.html'));
  s = T.retargetEntry(s, 'b.html', 'a.html', 'a.html', 'html');
  assert.equal(s.entries.filter((e) => e.rel === 'a.html').length, 1); // 唯一
  const e = s.entries.find((x) => x.rel === 'a.html');
  assert.equal(e.open, true);
  assert.equal(e.pinned, true); // 并集
  invariant(s); // 不在两区重复
});

test('dropEntry 把没开过的纯置顶快捷方式拖进标签页→变成开着的标签（不销毁）', () => {
  let s = T.pinEntry(empty(), f('z.html')); // {open:false,pinned:true}
  s = T.dropEntry(s, 'z.html', false, 0); // 拖进标签页区
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['z.html']); // 成了开着的标签
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  const e = s.entries.find((x) => x.rel === 'z.html');
  assert.equal(e.open, true);
  invariant(s);
});

test('dropEntry 负 index 夹紧到 0；不存在的 rel 原样返回', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html']) s = T.openEntry(s, f(r));
  s = T.dropEntry(s, 'b.html', false, -5); // 负 → 0
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['b.html', 'a.html']);
  const same = T.dropEntry(s, '不存在.html', true, 0);
  assert.deepEqual(same.entries, s.entries);
  invariant(s);
});

test('关激活的「钉+开」标签：另有开着的标签时落到那个，不落到没开的纯置顶', () => {
  // a 开+钉+激活；b 开；z 钉未开
  let s = T.openEntry(empty(), f('a.html'));
  s = T.pinEntry(s, f('a.html')); // a 钉(仍激活、仍 open)
  s = T.openEntry(s, f('b.html')); // active=b
  s = T.openEntry(s, f('a.html')); // 切回 a，active=a (a 开+钉)
  s = T.pinEntry(s, f('z.html')); // z 钉未开
  s = T.closeEntry(s, 'a.html'); // 关激活 a（a 仍 pinned→留置顶，但 open=false）
  assert.equal(s.activeRel, 'b.html'); // 落到还开着的 b，不落到没开的 z
  assert.equal(s.entries.find((e) => e.rel === 'a.html').open, false);
  assert.equal(s.entries.find((e) => e.rel === 'a.html').pinned, true); // 钉的还在置顶
  invariant(s);
});

test('setActive 只激活已跟踪项；不存在的 rel 不改激活', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.setActive(s, 'ghost.html');
  assert.equal(s.activeRel, 'a.html'); // 没被改成 ghost
  s = T.setActive(s, 'a.html');
  assert.equal(s.activeRel, 'a.html');
});

test('removeEntry 删一个没开的纯置顶项时不动别人的激活', () => {
  let s = T.openEntry(empty(), f('a.html')); // active=a
  s = T.pinEntry(s, f('z.html')); // z 钉未开
  s = T.removeEntry(s, 'z.html'); // 删 z
  assert.equal(s.activeRel, 'a.html'); // a 仍激活
  assert.ok(!s.entries.some((e) => e.rel === 'z.html'));
  invariant(s);
});

// ===== 外部标签（工作区外文件，abs 作身份）=====
test('keyOf：内部 entry 落回 rel，外部 entry 用 abs', () => {
  assert.equal(T.keyOf({ rel: 'a.html' }), 'a.html');
  assert.equal(T.keyOf({ abs: '/x/out.html' }), '/x/out.html');
  assert.equal(T.keyOf({ rel: 'a.html', abs: '/x/a.html' }), 'a.html'); // rel 优先
});

test('openEntry 外部文件：进标签页区、activeRel=abs、重复打开同 abs 不新增', () => {
  let s = T.openEntry(empty(), ext('/Users/x/Downloads/out.html'));
  assert.deepEqual(T.tabEntries(s.entries).map((e) => e.abs), ['/Users/x/Downloads/out.html']);
  assert.equal(s.activeRel, '/Users/x/Downloads/out.html');
  const before = s.entries.length;
  s = T.openEntry(s, ext('/Users/x/Downloads/out.html')); // 重复
  assert.equal(s.entries.length, before);
  invariant(s);
});

test('混合 rel + abs entry：互不串键、各自独立', () => {
  let s = T.openEntry(empty(), f('a.html')); // 内部 rel
  s = T.openEntry(s, ext('/tmp/a.html')); // 外部 abs（basename 同名但不同身份）
  assert.equal(s.entries.length, 2); // 两条独立，不被当成同一文件去重
  assert.equal(s.activeRel, '/tmp/a.html');
  s = T.openEntry(s, f('a.html')); // 切回内部 a
  assert.equal(s.entries.length, 2);
  assert.equal(s.activeRel, 'a.html');
  invariant(s);
});

test('外部 abs entry 走 close/pin/unpin/drop 不变式仍成立', () => {
  let s = T.openEntry(empty(), ext('/tmp/p.html'));
  s = T.openEntry(s, ext('/tmp/q.pdf', 'pdf'));
  s = T.pinEntry(s, ext('/tmp/p.html')); // 钉 p → 进置顶、离开标签页（去重）
  assert.deepEqual(T.pinnedEntries(s.entries).map((e) => e.abs), ['/tmp/p.html']);
  assert.ok(!T.tabEntries(s.entries).some((e) => e.abs === '/tmp/p.html'));
  invariant(s);
  s = T.unpinEntry(s, '/tmp/p.html'); // 取消钉、还开着 → 落回标签页
  assert.ok(T.tabEntries(s.entries).some((e) => e.abs === '/tmp/p.html'));
  s = T.closeEntry(s, '/tmp/q.pdf'); // 关 q
  assert.ok(!s.entries.some((e) => e.abs === '/tmp/q.pdf'));
  invariant(s);
});

test('resolveActive：activeRel 是外部 abs 时正确保留/回落', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.openEntry(s, ext('/tmp/out.html')); // active=/tmp/out.html
  assert.equal(T.resolveActive(s.entries, '/tmp/out.html'), '/tmp/out.html'); // 保留外部激活
  s = T.closeEntry(s, '/tmp/out.html'); // 关外部激活 → 回落到 a
  assert.equal(s.activeRel, 'a.html');
});

test('removeEntry(内部 rel) 不误删外部 abs entry', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.openEntry(s, ext('/tmp/out.html'));
  s = T.removeEntry(s, 'a.html'); // 删内部 a
  assert.ok(s.entries.some((e) => e.abs === '/tmp/out.html')); // 外部纹丝不动
  invariant(s);
});
