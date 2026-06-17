const test = require('node:test');
const assert = require('node:assert');
const geom = require('../src/editor/resize-geom.js');

const handle = (id) => geom.HANDLES.find((h) => h.id === id);

test('HANDLES: 正好 8 个、id 唯一', () => {
  assert.equal(geom.HANDLES.length, 8);
  const ids = geom.HANDLES.map((h) => h.id);
  assert.equal(new Set(ids).size, 8);
});

test('HANDLES: id 集合恰为 8 方位、x/y/axis/cursor 合法', () => {
  const ids = geom.HANDLES.map((h) => h.id).sort();
  assert.deepEqual(ids, ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  for (const h of geom.HANDLES) {
    assert.ok([0, 0.5, 1].includes(h.x), `x of ${h.id}`);
    assert.ok([0, 0.5, 1].includes(h.y), `y of ${h.id}`);
    assert.ok(['both', 'x', 'y'].includes(h.axis), `axis of ${h.id}`);
    assert.equal(typeof h.cursor, 'string');
  }
});

test('HANDLES: 角 both、左右中点 x、上下中点 y', () => {
  for (const id of ['nw', 'ne', 'se', 'sw']) assert.equal(handle(id).axis, 'both');
  for (const id of ['e', 'w']) assert.equal(handle(id).axis, 'x');
  for (const id of ['n', 's']) assert.equal(handle(id).axis, 'y');
});

test('computeResize: se +(30,20) → {130,70}', () => {
  assert.deepEqual(geom.computeResize(handle('se'), { width: 100, height: 50 }, 30, 20), { width: 130, height: 70 });
});

test('computeResize: e +(30,20) → {130,50}（只动宽）', () => {
  assert.deepEqual(geom.computeResize(handle('e'), { width: 100, height: 50 }, 30, 20), { width: 130, height: 50 });
});

test('computeResize: s +(30,20) → {100,70}（只动高）', () => {
  assert.deepEqual(geom.computeResize(handle('s'), { width: 100, height: 50 }, 30, 20), { width: 100, height: 70 });
});

test('computeResize: w +(30,0) → 宽 70（西边正 dx 缩）', () => {
  assert.deepEqual(geom.computeResize(handle('w'), { width: 100, height: 50 }, 30, 0), { width: 70, height: 50 });
});

test('computeResize: nw +(90,45,{min:8}) → 宽高均钳到 >=8', () => {
  const r = geom.computeResize(handle('nw'), { width: 100, height: 50 }, 90, 45, { min: 8 });
  assert.ok(r.width >= 8, `width=${r.width}`);
  assert.ok(r.height >= 8, `height=${r.height}`);
});
