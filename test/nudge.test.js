const test = require('node:test');
const assert = require('node:assert');
const dm = require('../src/editor/dragmove.js');

test('nudgeDelta: ArrowRight 无 shift → {dx:1, dy:0}', () => {
  assert.deepEqual(dm.nudgeDelta('ArrowRight', false), { dx: 1, dy: 0 });
});

test('nudgeDelta: ArrowLeft 无 shift → {dx:-1, dy:0}', () => {
  assert.deepEqual(dm.nudgeDelta('ArrowLeft', false), { dx: -1, dy: 0 });
});

test('nudgeDelta: ArrowUp + shift → {dx:0, dy:-10}', () => {
  assert.deepEqual(dm.nudgeDelta('ArrowUp', true), { dx: 0, dy: -10 });
});

test('nudgeDelta: ArrowDown 无 shift → {dx:0, dy:1}', () => {
  assert.deepEqual(dm.nudgeDelta('ArrowDown', false), { dx: 0, dy: 1 });
});

test('nudgeDelta: ArrowRight + shift → {dx:10, dy:0}', () => {
  assert.deepEqual(dm.nudgeDelta('ArrowRight', true), { dx: 10, dy: 0 });
});

test('nudgeDelta: 非方向键（Enter）→ null', () => {
  assert.equal(dm.nudgeDelta('Enter', false), null);
  assert.equal(dm.nudgeDelta('a', false), null);
  assert.equal(dm.nudgeDelta(' ', true), null);
});

test('连续 3 次 applyDelta(ArrowRight) 在 {100,50} 上累加到 {103,50}', () => {
  let pos = { left: 100, top: 50 };
  const d = dm.nudgeDelta('ArrowRight', false);
  for (let i = 0; i < 3; i++) pos = dm.applyDelta(pos, d.dx, d.dy);
  assert.deepEqual(pos, { left: 103, top: 50 });
});
