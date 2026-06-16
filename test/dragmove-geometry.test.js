const test = require('node:test');
const assert = require('node:assert');
const dm = require('../src/editor/dragmove.js');

test('computeAbsolutePlacement: 冻结当前视觉框（相对 offsetParent）', () => {
  assert.deepEqual(
    dm.computeAbsolutePlacement({ left: 100, top: 50, width: 200, height: 30 }, { left: 0, top: 0 }),
    { left: 100, top: 50, width: 200, height: 30 }
  );
});

test('computeAbsolutePlacement: parentRect 非零时按差值算 left/top', () => {
  assert.deepEqual(
    dm.computeAbsolutePlacement({ left: 100, top: 50, width: 200, height: 30 }, { left: 40, top: 12 }),
    { left: 60, top: 38, width: 200, height: 30 }
  );
});

test('applyDelta: {100,50} + (15,-8) → {115,42}', () => {
  assert.deepEqual(dm.applyDelta({ left: 100, top: 50 }, 15, -8), { left: 115, top: 42 });
});

test('needsConversion: static / "" / relative → true', () => {
  assert.equal(dm.needsConversion('static'), true);
  assert.equal(dm.needsConversion(''), true);
  assert.equal(dm.needsConversion('relative'), true);
});

test('needsConversion: absolute / fixed → false', () => {
  assert.equal(dm.needsConversion('absolute'), false);
  assert.equal(dm.needsConversion('fixed'), false);
});
