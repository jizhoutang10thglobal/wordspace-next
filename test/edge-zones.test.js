// 收起态 peek 触发区纯几何(src/lib/edge-zones.js)——主进程光标轮询的判定核。
// 语义:trigger=唤出区(左缘带[x-OUT,x+IN]全高 ∪ 左上角[x,x+80]×[y,y+48]);
//       dwell=驻留区(trigger ∪ 卡区+右缘缓冲)。Wendi 2026-07-22「必须精确停在缝上」的修。
const { test } = require('node:test');
const assert = require('node:assert');
const Z = require('../src/lib/edge-zones');

const B = { x: 100, y: 50, width: 800, height: 600 }; // 窗口不贴屏缘(浮动窗,复现「甩出窗外」场景)

test('左缘带:窗内 IN px 内触发(不用精确停在 10px 缝)', () => {
  assert.equal(Z.inTriggerZone(B, { x: 100 + Z.IN, y: 300 }), true);   // 带内缘
  assert.equal(Z.inTriggerZone(B, { x: 100 + Z.IN + 1, y: 300 }), false); // 过了就不算
});

test('左缘带:甩出窗外 OUT px 内也触发(Arc 式宽容,DOM 永远做不到这条)', () => {
  assert.equal(Z.inTriggerZone(B, { x: 100 - Z.OUT, y: 300 }), true);  // 窗外宽容带
  assert.equal(Z.inTriggerZone(B, { x: 100 - Z.OUT - 1, y: 300 }), false); // 太远不算
});

test('左上角唤出区:80×48(灯那片),右下越界不算', () => {
  assert.equal(Z.inTriggerZone(B, { x: 100 + 79, y: 50 + 47 }), true);
  assert.equal(Z.inTriggerZone(B, { x: 100 + 81, y: 50 + 20 }), false); // x 越界(也不在左缘带)
  assert.equal(Z.inTriggerZone(B, { x: 100 + 60, y: 50 + 49 }), false); // y 越界
});

test('垂直越界:窗口上下沿之外的左缘不触发', () => {
  assert.equal(Z.inTriggerZone(B, { x: 100, y: 49 }), false);
  assert.equal(Z.inTriggerZone(B, { x: 100, y: 50 + 600 + 1 }), false);
});

test('驻留区:peek 开着时光标在卡上/卡右缓冲内不算离开;越过缓冲算', () => {
  const cardW = 260;
  assert.equal(Z.inDwellZone(B, { x: 100 + 260 + Z.CARD_PAD, y: 300 }, cardW), true);
  assert.equal(Z.inDwellZone(B, { x: 100 + 260 + Z.CARD_PAD + 1, y: 300 }, cardW), false);
});

test('驻留区包含触发区(光标退回左缘带不算离开)', () => {
  assert.equal(Z.inDwellZone(B, { x: 100 - Z.OUT, y: 300 }, 260), true);
});

test('cardWidth 非法时退 260 默认', () => {
  assert.equal(Z.inDwellZone(B, { x: 100 + 260 + Z.CARD_PAD, y: 300 }, 0), true);
  assert.equal(Z.inDwellZone(B, { x: 100 + 260 + Z.CARD_PAD, y: 300 }, undefined), true);
});

test('空参防御:bounds/pt 缺失返回 false 不抛', () => {
  assert.equal(Z.inTriggerZone(null, { x: 0, y: 0 }), false);
  assert.equal(Z.inTriggerZone(B, null), false);
  assert.equal(Z.inDwellZone(null, null, 260), false);
});
