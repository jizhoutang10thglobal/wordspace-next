const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/lib/tabs.js');

// 多根身份模型：工作区内 entry 带 rootId，keyOf = `rootId:rel`；外部 entry 用 abs。
const f = (rel, kind = 'html', rootId = 'r1') => ({ rootId, rel, kind, title: rel.split('/').pop() });
const k = (rel, rootId = 'r1') => rootId + ':' + rel;
const empty = () => ({ entries: [], activeRel: null });
const rels = (arr) => arr.map((e) => e.rel);

// 不变式：没有 !open&&!pinned 的幽灵 entry；置顶区(pinned) 与 标签页区(open&&!pinned) 天然互斥（去重）。
function invariant(state) {
  for (const e of state.entries) {
    assert.ok(e.open || e.pinned, `ghost entry leaked: ${T.keyOf(e)}`);
  }
  // 用 keyOf 而非裸 rel：多个外部 entry 的 rel 都是 undefined，用 rel 会误判「同时在两区」。
  const pinnedSet = new Set(T.pinnedEntries(state.entries).map((e) => T.keyOf(e)));
  const tabSet = new Set(T.tabEntries(state.entries).map((e) => T.keyOf(e)));
  for (const r of pinnedSet) assert.ok(!tabSet.has(r), `entry in both zones: ${r}`);
}
// 外部文件（工作区外，无 rel，用 abs 作身份）。
const ext = (abs, kind = 'html') => ({ abs, kind, title: abs.split('/').pop() });

test('openEntry: 新文件追加到标签页区并激活；重复打开只激活不新增', () => {
  let s = T.openEntry(empty(), f('a.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.equal(s.activeRel, k('a.html'));
  s = T.openEntry(s, f('b.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html', 'b.html']);
  assert.equal(s.activeRel, k('b.html'));
  const before = s.entries.length;
  s = T.openEntry(s, f('a.html')); // 重复
  assert.equal(s.entries.length, before);
  assert.equal(s.activeRel, k('a.html'));
  invariant(s);
});

test('closeEntry: 关激活→激活剩下最后一个；关非激活→激活不变；关到空→null', () => {
  let s = T.openEntry(T.openEntry(T.openEntry(empty(), f('a.html')), f('b.html')), f('c.html'));
  // active=c。关非激活 a → active 仍 c
  s = T.closeEntry(s, k('a.html'));
  assert.equal(s.activeRel, k('c.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['b.html', 'c.html']);
  // 关激活 c → 激活剩下最后一个 b
  s = T.closeEntry(s, k('c.html'));
  assert.equal(s.activeRel, k('b.html'));
  // 关到空 → null
  s = T.closeEntry(s, k('b.html'));
  assert.equal(s.activeRel, null);
  assert.deepEqual(s.entries, []);
  invariant(s);
});

test('closeEntry 关激活的中间标签 → 激活相邻(下一个;末尾则上一个)，不是最后一个（Colin 2026-07-09 报的关标签跳转）', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html', 'c.html', 'd.html']) s = T.openEntry(s, f(r));
  s = T.setActive(s, k('b.html')); // active=b（中间）
  s = T.closeEntry(s, k('b.html')); // 关激活 b → 相邻的下一个 c（旧行为=跳到最后的 d）
  assert.equal(s.activeRel, k('c.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html', 'c.html', 'd.html']);
  s = T.setActive(s, k('d.html')); // active=d（末尾）
  s = T.closeEntry(s, k('d.html')); // 末尾没有下一个 → 相邻的上一个 c
  assert.equal(s.activeRel, k('c.html'));
  invariant(s);
});

test('pinEntry: 打开的标签钉→移出标签页进置顶；树里直接钉未打开的→建 open:false 的置顶项', () => {
  let s = T.openEntry(empty(), f('a.html')); // a 开着
  s = T.pinEntry(s, f('a.html')); // 钉 a
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), []); // 去重：不在标签页
  assert.equal(s.activeRel, k('a.html')); // 钉不抢/丢焦点
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
  s = T.unpinEntry(s, k('a.html'));
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  // z 从树直接钉、没开 → 取消钉 → 销毁
  s = T.pinEntry(s, f('z.html'));
  s = T.unpinEntry(s, k('z.html'));
  assert.ok(!s.entries.some((e) => e.rel === 'z.html'));
  invariant(s);
});

test('既钉又开：openEntry 一个已 pinned 的项仍只在置顶（守去重）', () => {
  let s = T.pinEntry(empty(), f('z.html')); // 钉、未开
  s = T.openEntry(s, f('z.html')); // 打开它
  assert.equal(s.activeRel, k('z.html'));
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['z.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), []); // 不重复进标签页
  invariant(s);
});

test('关激活的开标签后只剩纯置顶快捷方式→回 null（不自动开置顶快捷）', () => {
  let s = T.openEntry(empty(), f('a.html')); // a 开着、激活
  s = T.pinEntry(s, f('z.html')); // z 钉、未开
  s = T.closeEntry(s, k('a.html')); // 关激活 a
  assert.equal(s.activeRel, null); // 只剩没开的 z → 回空态，不自动开 z
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['z.html']);
  invariant(s);
});

test('dropEntry: 同区重排到 toIndex；跨区设 pinned + 定位；越界夹紧', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html', 'c.html']) s = T.openEntry(s, f(r));
  // 标签页 [a,b,c]，把 c 拖到 index 0
  s = T.dropEntry(s, k('c.html'), false, 0);
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['c.html', 'a.html', 'b.html']);
  // 把 a 跨区拖进置顶 index 0 → a 变 pinned
  s = T.dropEntry(s, k('a.html'), true, 0);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['c.html', 'b.html']);
  // 越界 index 夹紧（拖 b 到置顶 index 99 → 末尾）
  s = T.dropEntry(s, k('b.html'), true, 99);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), ['a.html', 'b.html']);
  invariant(s);
});

test('dropEntry: 跨区拖回标签页 = unpin', () => {
  let s = T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')); // a 开+钉（在置顶）
  s = T.dropEntry(s, k('a.html'), false, 0); // 拖回标签页
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['a.html']);
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  invariant(s);
});

test('retargetEntry: 改名/移动跟随 rel+title+kind，open/pinned/激活保持', () => {
  let s = T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')); // a 开+钉+激活
  s = T.retargetEntry(s, 'r1', 'a.html', '数据/改名.html', '改名.html', 'html');
  const e = s.entries.find((x) => x.rel === '数据/改名.html');
  assert.ok(e);
  assert.equal(e.pinned, true);
  assert.equal(e.open, true);
  assert.equal(e.title, '改名.html');
  assert.equal(s.activeRel, k('数据/改名.html')); // 激活跟随
  invariant(s);
});

test('removeEntry: 删除销毁 entry，激活项则回落', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html']) s = T.openEntry(s, f(r)); // active=b
  s = T.removeEntry(s, k('b.html')); // 删激活
  assert.ok(!s.entries.some((e) => e.rel === 'b.html'));
  assert.equal(s.activeRel, k('a.html'));
  s = T.removeEntry(s, k('a.html'));
  assert.equal(s.activeRel, null);
  invariant(s);
});

test('非 html 文件也进标签页（kind 保留）', () => {
  let s = T.openEntry(empty(), { rootId: 'r1', rel: '数据/c.png', kind: 'image', title: 'c.png' });
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['数据/c.png']);
  assert.equal(s.entries[0].kind, 'image');
  invariant(s);
});

// ===== 对抗审计补的边界（守去重不变式不被破） =====

test('retargetEntry 撞名→合并成一个（open/pinned 取并集），不出现重复 rel', () => {
  // a 开+钉(置顶)，b 开(标签页)；把 b 改名/移成 a → 合并
  let s = T.openEntry(T.pinEntry(T.openEntry(empty(), f('a.html')), f('a.html')), f('b.html'));
  s = T.retargetEntry(s, 'r1', 'b.html', 'a.html', 'a.html', 'html');
  assert.equal(s.entries.filter((e) => e.rel === 'a.html').length, 1); // 唯一
  const e = s.entries.find((x) => x.rel === 'a.html');
  assert.equal(e.open, true);
  assert.equal(e.pinned, true); // 并集
  invariant(s); // 不在两区重复
});

test('dropEntry 把没开过的纯置顶快捷方式拖进标签页→变成开着的标签（不销毁）', () => {
  let s = T.pinEntry(empty(), f('z.html')); // {open:false,pinned:true}
  s = T.dropEntry(s, k('z.html'), false, 0); // 拖进标签页区
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['z.html']); // 成了开着的标签
  assert.deepEqual(rels(T.pinnedEntries(s.entries)), []);
  const e = s.entries.find((x) => x.rel === 'z.html');
  assert.equal(e.open, true);
  invariant(s);
});

test('dropEntry 负 index 夹紧到 0；不存在的 key 原样返回', () => {
  let s = empty();
  for (const r of ['a.html', 'b.html']) s = T.openEntry(s, f(r));
  s = T.dropEntry(s, k('b.html'), false, -5); // 负 → 0
  assert.deepEqual(rels(T.tabEntries(s.entries)), ['b.html', 'a.html']);
  const same = T.dropEntry(s, k('不存在.html'), true, 0);
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
  s = T.closeEntry(s, k('a.html')); // 关激活 a（a 仍 pinned→留置顶，但 open=false）
  assert.equal(s.activeRel, k('b.html')); // 落到还开着的 b，不落到没开的 z
  assert.equal(s.entries.find((e) => e.rel === 'a.html').open, false);
  assert.equal(s.entries.find((e) => e.rel === 'a.html').pinned, true); // 钉的还在置顶
  invariant(s);
});

test('setActive 只激活已跟踪项；不存在的 key 不改激活', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.setActive(s, k('ghost.html'));
  assert.equal(s.activeRel, k('a.html')); // 没被改成 ghost
  s = T.setActive(s, k('a.html'));
  assert.equal(s.activeRel, k('a.html'));
});

test('removeEntry 删一个没开的纯置顶项时不动别人的激活', () => {
  let s = T.openEntry(empty(), f('a.html')); // active=a
  s = T.pinEntry(s, f('z.html')); // z 钉未开
  s = T.removeEntry(s, k('z.html')); // 删 z
  assert.equal(s.activeRel, k('a.html')); // a 仍激活
  assert.ok(!s.entries.some((e) => e.rel === 'z.html'));
  invariant(s);
});

// ===== 外部标签（工作区外文件，abs 作身份）=====
test('keyOf：内部 entry = rootId:rel，外部 entry 用 abs；无 rootId 的 rel 回落裸 rel（迁移过渡态）', () => {
  assert.equal(T.keyOf({ rootId: 'r1', rel: 'a.html' }), 'r1:a.html');
  assert.equal(T.keyOf({ abs: '/x/out.html' }), '/x/out.html');
  assert.equal(T.keyOf({ rootId: 'r1', rel: 'a.html', abs: '/x/a.html' }), 'r1:a.html'); // rel 优先
  assert.equal(T.keyOf({ rel: 'a.html' }), 'a.html'); // 迁移途中短暂存在
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
  assert.equal(s.activeRel, k('a.html'));
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
  assert.equal(s.activeRel, k('a.html'));
});

test('removeEntry(内部 key) 不误删外部 abs entry', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.openEntry(s, ext('/tmp/out.html'));
  s = T.removeEntry(s, k('a.html')); // 删内部 a
  assert.ok(s.entries.some((e) => e.abs === '/tmp/out.html')); // 外部纹丝不动
  invariant(s);
});

test('removeEntry(abs) 能按绝对路径删外部 entry（置顶区 × 关闭外部 pinned）', () => {
  let s = T.pinEntry(empty(), ext('/tmp/out.html')); // 钉一个外部文件（没开）
  s = T.openEntry(s, f('a.html')); // 另开一个内部
  s = T.removeEntry(s, '/tmp/out.html'); // 按 abs 删外部
  assert.ok(!s.entries.some((e) => e.abs === '/tmp/out.html')); // 外部被删掉
  assert.ok(s.entries.some((e) => e.rel === 'a.html')); // 内部不受影响
  invariant(s);
});

// ===== 多根：同 rel 不同根是不同文件 =====
test('两个根里同 rel 的文件互不撞键：各自打开、各自关闭', () => {
  let s = T.openEntry(empty(), f('素材/a.html', 'html', 'r1'));
  s = T.openEntry(s, f('素材/a.html', 'html', 'r2')); // 另一个根里同 rel
  assert.equal(s.entries.length, 2); // 两条独立
  assert.equal(s.activeRel, 'r2:素材/a.html');
  s = T.closeEntry(s, 'r2:素材/a.html'); // 关 r2 的
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].rootId, 'r1'); // r1 的还在
  assert.equal(s.activeRel, 'r1:素材/a.html');
  invariant(s);
});

test('retargetEntry 限定在根内：不误伤别的根里同 rel 的 entry', () => {
  let s = T.openEntry(empty(), f('a.html', 'html', 'r1'));
  s = T.openEntry(s, f('a.html', 'html', 'r2'));
  s = T.retargetEntry(s, 'r1', 'a.html', '改名.html', '改名.html');
  assert.ok(s.entries.some((e) => e.rootId === 'r1' && e.rel === '改名.html')); // r1 跟了
  assert.ok(s.entries.some((e) => e.rootId === 'r2' && e.rel === 'a.html')); // r2 纹丝不动
  invariant(s);
});

test('reconcileTree 只对账指定根：别的根的文件不在 relSet 里也不被误删', () => {
  let s = T.openEntry(empty(), f('a.html', 'html', 'r1'));
  s = T.openEntry(s, f('b.html', 'html', 'r2'));
  // r1 的新树只有 a.html；r2 的 b.html 自然不在这个 relSet 里
  const r = T.reconcileTree(s, 'r1', new Set(['a.html']), new Map());
  assert.ok(r.entries.some((e) => e.rootId === 'r2' && e.rel === 'b.html')); // r2 不被误删
  invariant(r);
});

test('dropRootEntries：撤走该根全部 entries（含置顶），激活回落；removed 原序可撤销', () => {
  let s = T.openEntry(empty(), f('a.html', 'html', 'r1'));
  s = T.pinEntry(s, f('钉.html', 'html', 'r1'));
  s = T.openEntry(s, f('x.html', 'html', 'r2'));
  s = T.openEntry(s, f('b.html', 'html', 'r1')); // active=r1:b.html
  const prevActive = s.activeRel;
  const { state: after, removed } = T.dropRootEntries(s, 'r1');
  assert.deepEqual(rels(removed), ['a.html', '钉.html', 'b.html']); // 原序
  assert.equal(after.entries.length, 1);
  assert.equal(after.entries[0].rootId, 'r2');
  assert.equal(after.activeRel, 'r2:x.html'); // 激活回落到别的根
  invariant(after);
  // 撤销：原样放回 + 激活恢复
  const undone = T.undoDropRoot(after, removed, prevActive);
  assert.equal(undone.entries.length, 4);
  assert.equal(undone.activeRel, prevActive);
  invariant(undone);
});

test('dropRootEntries 撤走非激活根：激活不变', () => {
  let s = T.openEntry(empty(), f('a.html', 'html', 'r1'));
  s = T.openEntry(s, f('x.html', 'html', 'r2')); // active=r2:x.html
  const { state: after } = T.dropRootEntries(s, 'r1');
  assert.equal(after.activeRel, 'r2:x.html');
  invariant(after);
});

test('undoDropRoot 期间同 key 又被打开：不重复、保留现有', () => {
  let s = T.openEntry(empty(), f('a.html', 'html', 'r1'));
  const { state: after, removed } = T.dropRootEntries(s, 'r1');
  // 撤销前用户又打开了同一个文件（根被重新加回同 id 的场景）
  const reopened = T.openEntry(after, f('a.html', 'html', 'r1'));
  const undone = T.undoDropRoot(reopened, removed, 'r1:a.html');
  assert.equal(undone.entries.filter((e) => T.keyOf(e) === 'r1:a.html').length, 1); // 不重复
  invariant(undone);
});

// ===== rebaseRoot（父根吸收子根：标签不关、整体换归属）=====
test('rebaseRoot：子根 entries 换到父根、rel 加前缀，open/pinned/激活跟随', () => {
  let s = T.openEntry(empty(), f('doc.html', 'html', 'r2')); // 子根里开着
  s = T.pinEntry(s, f('素材/图.png', 'image', 'r2')); // 子根里钉着
  s = T.rebaseRoot(s, 'r2', 'r3', '子目录');
  assert.ok(s.entries.some((e) => e.rootId === 'r3' && e.rel === '子目录/doc.html' && e.open));
  assert.ok(s.entries.some((e) => e.rootId === 'r3' && e.rel === '子目录/素材/图.png' && e.pinned));
  assert.ok(!s.entries.some((e) => e.rootId === 'r2')); // 子根 entries 清空
  assert.equal(s.activeRel, 'r3:子目录/doc.html'); // 激活跟随换 key
  invariant(s);
});

test('rebaseRoot 撞 key（父根已有同位置 entry）→ open/pinned 取并集合并、不重复', () => {
  let s = T.openEntry(empty(), f('子/doc.html', 'html', 'r3')); // 父根里已经开着这个文件
  s = T.pinEntry(s, f('doc.html', 'html', 'r2')); // 子根里钉着同一个磁盘文件
  s = T.rebaseRoot(s, 'r2', 'r3', '子');
  const hits = s.entries.filter((e) => T.keyOf(e) === 'r3:子/doc.html');
  assert.equal(hits.length, 1); // 合并成一条
  assert.equal(hits[0].open, true);
  assert.equal(hits[0].pinned, true); // 并集
  invariant(s);
});

test('rebaseRoot 不动外部 abs entries 和别的根', () => {
  let s = T.openEntry(empty(), ext('/tmp/out.html'));
  s = T.openEntry(s, f('a.html', 'html', 'r1'));
  s = T.openEntry(s, f('b.html', 'html', 'r2'));
  s = T.rebaseRoot(s, 'r2', 'r3', '子');
  assert.ok(s.entries.some((e) => e.abs === '/tmp/out.html'));
  assert.ok(s.entries.some((e) => e.rootId === 'r1' && e.rel === 'a.html'));
  invariant(s);
});

// ===== retargetSubtreeAcross（跨根移动文件/目录：标签换根+rel 前缀替换）=====
test('retargetSubtreeAcross 文件：换 rootId+rel，open/pinned/激活/title 跟随', () => {
  let s = T.pinEntry(T.openEntry(empty(), f('a.html', 'html', 'r1')), f('a.html', 'html', 'r1')); // r1:a.html 开+钉+激活
  s = T.retargetSubtreeAcross(s, 'r1', 'a.html', 'r2', '素材/a.html', false);
  assert.ok(!s.entries.some((e) => e.rootId === 'r1')); // r1 那条走了
  const e = s.entries.find((x) => x.rootId === 'r2' && x.rel === '素材/a.html');
  assert.ok(e);
  assert.equal(e.open, true);
  assert.equal(e.pinned, true);
  assert.equal(e.title, 'a.html'); // 叶名（跨目录不变）
  assert.equal(s.activeRel, 'r2:素材/a.html'); // 激活跟随换 key
  invariant(s);
});

test('retargetSubtreeAcross 目标撞名去重：title 取去重后的新叶名', () => {
  // 目标根 r2 已有 a.html；把 r1:a.html 移到 r2 根目录，movePathAcross 去重成 'a 2.html'
  let s = T.openEntry(empty(), f('a.html', 'html', 'r2'));
  s = T.openEntry(s, f('a.html', 'html', 'r1')); // active=r1:a.html
  s = T.retargetSubtreeAcross(s, 'r1', 'a.html', 'r2', 'a 2.html', false);
  const moved = s.entries.find((x) => x.rootId === 'r2' && x.rel === 'a 2.html');
  assert.ok(moved && moved.title === 'a 2.html'); // 去重后的叶名
  assert.ok(s.entries.some((x) => x.rootId === 'r2' && x.rel === 'a.html')); // 原来的 r2:a.html 没被动
  assert.equal(s.activeRel, 'r2:a 2.html');
  invariant(s);
});

test('retargetSubtreeAcross 目录：整棵子树换根+前缀替换，各文件叶名不变', () => {
  let s = T.openEntry(empty(), f('docs/a.html', 'html', 'r1'));
  s = T.pinEntry(s, f('docs/图/封面.png', 'image', 'r1')); // 深层置顶
  s = T.openEntry(s, f('别的.html', 'html', 'r1')); // 不在 docs 下 → 不该动
  s = T.retargetSubtreeAcross(s, 'r1', 'docs', 'r2', '归档/docs', true);
  assert.ok(s.entries.some((e) => e.rootId === 'r2' && e.rel === '归档/docs/a.html'));
  const cover = s.entries.find((e) => e.rootId === 'r2' && e.rel === '归档/docs/图/封面.png');
  assert.ok(cover && cover.pinned && cover.title === '封面.png');
  assert.ok(s.entries.some((e) => e.rootId === 'r1' && e.rel === '别的.html')); // docs 外的没动
  assert.ok(!s.entries.some((e) => e.rootId === 'r1' && e.rel.indexOf('docs') === 0)); // docs 子树全走了
  invariant(s);
});

test('retargetSubtreeAcross 撞 key 合并：目标已有同位置 entry → open/pinned 并集、唯一', () => {
  // r2 已开着 sub/a.html；把 r1:a.html 移到 r2 的 sub 下（同名 → movePathAcross 本应去重，但测纯逻辑撞 key 合并）
  let s = T.pinEntry(empty(), f('sub/a.html', 'html', 'r2')); // r2 钉着
  s = T.openEntry(s, f('a.html', 'html', 'r1')); // r1 开着
  s = T.retargetSubtreeAcross(s, 'r1', 'a.html', 'r2', 'sub/a.html', false);
  const hits = s.entries.filter((e) => T.keyOf(e) === 'r2:sub/a.html');
  assert.equal(hits.length, 1); // 合并成一条
  assert.equal(hits[0].open, true); // r1 带来的
  assert.equal(hits[0].pinned, true); // r2 原有的
  invariant(s);
});

test('retargetSubtreeAcross 不动外部 abs / 临时文档 / 别的根', () => {
  let s = T.openEntry(empty(), ext('/tmp/out.html'));
  s = T.openEntry(s, { rootId: undefined, abs: 'temp:1', kind: 'html', title: '未命名', open: true }); // 临时(temp: 前缀 abs)
  s = T.openEntry(s, f('a.html', 'html', 'r1'));
  s = T.openEntry(s, f('a.html', 'html', 'r3')); // 第三个根同 rel
  s = T.retargetSubtreeAcross(s, 'r1', 'a.html', 'r2', 'a.html', false);
  assert.ok(s.entries.some((e) => e.abs === '/tmp/out.html' && !e.rel)); // 外部标签不动
  assert.ok(s.entries.some((e) => e.abs === 'temp:1')); // 临时文档不动
  assert.ok(s.entries.some((e) => e.rootId === 'r3' && e.rel === 'a.html')); // 第三个根不动
  assert.ok(s.entries.some((e) => e.rootId === 'r2' && e.rel === 'a.html')); // 只有 r1 那条搬到 r2
  assert.ok(!s.entries.some((e) => e.rootId === 'r1')); // r1 空了
  invariant(s);
});

// ===== reconcileTree（外部磁盘变化对账：inode 匹配做改名/移动跟随）=====
test('reconcileTree：文件原位→保留；ino 匹配新位置→改名/移动跟随；无匹配→删除；外部标签不动', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.openEntry(s, f('b.html'));
  s = T.openEntry(s, f('gone.html'));
  s = T.openEntry(s, ext('/tmp/x.html'));
  s.entries.find((e) => e.rel === 'a.html').ino = '1';
  s.entries.find((e) => e.rel === 'b.html').ino = '2';
  s.entries.find((e) => e.rel === 'gone.html').ino = '3';
  // 新树：a 原位(ino1)；b 改名成 sub/c.html(ino2 不变)；gone 真删了(ino3 不在新树)
  const relSet = new Set(['a.html', 'sub/c.html']);
  const inoToRel = new Map([['1', 'a.html'], ['2', 'sub/c.html']]);
  const r = T.reconcileTree(s, 'r1', relSet, inoToRel);
  assert.ok(r.entries.some((e) => e.rel === 'a.html')); // 原位保留
  assert.ok(!r.entries.some((e) => e.rel === 'b.html')); // b 改名走了
  assert.ok(r.entries.some((e) => e.rel === 'sub/c.html')); // 跟到新位置
  assert.ok(!r.entries.some((e) => e.rel === 'gone.html')); // 真删了
  assert.ok(r.entries.some((e) => e.abs === '/tmp/x.html')); // 外部标签不动
  invariant(r);
});

test('reconcileTree：激活文档被外部删除→activeRel 回落到还在的标签', () => {
  let s = T.openEntry(empty(), f('a.html'));
  s = T.openEntry(s, f('b.html')); // active=b
  s.entries.find((e) => e.rel === 'a.html').ino = '1';
  s.entries.find((e) => e.rel === 'b.html').ino = '2';
  const r = T.reconcileTree(s, 'r1', new Set(['a.html']), new Map([['1', 'a.html']])); // b(ino2) 删了
  assert.ok(!r.entries.some((e) => e.rel === 'b.html'));
  assert.equal(r.activeRel, k('a.html'));
  invariant(r);
});

test('reconcileTree：激活文档被外部改名→activeRel 跟到新名', () => {
  let s = T.openEntry(empty(), f('a.html')); // active=a
  s.entries.find((e) => e.rel === 'a.html').ino = '7';
  const r = T.reconcileTree(s, 'r1', new Set(['renamed.html']), new Map([['7', 'renamed.html']]));
  assert.equal(r.activeRel, k('renamed.html'));
  assert.ok(r.entries.some((e) => e.rel === 'renamed.html'));
  invariant(r);
});

test('reconcileTree：没 ino 的标签文件消失→当删除处理（不乱跟）', () => {
  let s = T.openEntry(empty(), f('a.html')); // 没设 ino
  const r = T.reconcileTree(s, 'r1', new Set(['b.html']), new Map([['9', 'b.html']]));
  assert.ok(!r.entries.some((e) => e.rel === 'a.html')); // 删掉，不会乱认成 b
  assert.ok(!r.entries.some((e) => e.rel === 'b.html'));
});
