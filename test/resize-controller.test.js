const test = require('node:test');
const assert = require('node:assert');
const resize = require('../src/editor/resize.js');
const geom = require('../src/editor/resize-geom.js');

const handle = (id) => geom.HANDLES.find((h) => h.id === id);
const START = { left: 100, top: 80, width: 200, height: 120 };

test('originShift: se 手柄（东南，x=1/y=1）→ 不平移原点', () => {
  const size = { width: 240, height: 150 };
  assert.deepEqual(resize.originShift(handle('se'), START, size), { left: 100, top: 80 });
});

test('originShift: e 手柄（东中点）→ 不平移原点', () => {
  const size = { width: 240, height: 120 };
  assert.deepEqual(resize.originShift(handle('e'), START, size), { left: 100, top: 80 });
});

test('originShift: s 手柄（南中点）→ 不平移原点', () => {
  const size = { width: 200, height: 150 };
  assert.deepEqual(resize.originShift(handle('s'), START, size), { left: 100, top: 80 });
});

test('originShift: w 手柄（西中点）宽缩 30 → left += 30、top 不动', () => {
  const size = { width: START.width - 30, height: START.height }; // 170
  const r = resize.originShift(handle('w'), START, size);
  assert.equal(r.left, 130); // 100 + (200 - 170)
  assert.equal(r.top, 80);
});

test('originShift: w 手柄宽增 30 → left -= 30（左边外扩、右边固定）', () => {
  const size = { width: START.width + 30, height: START.height }; // 230
  const r = resize.originShift(handle('w'), START, size);
  assert.equal(r.left, 70); // 100 + (200 - 230)
  assert.equal(r.top, 80);
});

test('originShift: n 手柄（北中点）高缩 20 → top += 20（高 delta）、left 不动', () => {
  const size = { width: START.width, height: START.height - 20 }; // 100
  const r = resize.originShift(handle('n'), START, size);
  assert.equal(r.top, 100); // 80 + (120 - 100)
  assert.equal(r.left, 100);
});

test('originShift: nw 角手柄（西北，x=0/y=0）→ left/top 双轴平移', () => {
  const size = { width: 170, height: 100 }; // 宽缩 30、高缩 20
  const r = resize.originShift(handle('nw'), START, size);
  assert.equal(r.left, 130); // 100 + (200 - 170)
  assert.equal(r.top, 100);  // 80 + (120 - 100)
});
