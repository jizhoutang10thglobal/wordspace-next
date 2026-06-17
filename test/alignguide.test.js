const test = require('node:test');
const assert = require('node:assert');
const ag = require('../src/editor/alignguide.js');

// 吸附方向约定：把 moving 吸到 target，snapDx = target - movingCoord（movingCoord + snapDx === target）。
// 线 pos 画在 target 坐标。

test('左边 left=100 vs 另一框 left=103、阈值 6 → 竖线 @103 + snapDx=3（moving 吸到 target）', () => {
  const moving = { left: 100, top: 0, width: 50, height: 20 };
  const others = [{ left: 103, top: 200, width: 50, height: 20 }];
  const res = ag.computeGuides(moving, others, 6);
  assert.equal(res.snapDx, 3);
  assert.equal(res.snapDy, 0);
  const vline = res.lines.find((l) => l.orientation === 'v');
  assert.ok(vline, '应有一条竖线');
  assert.equal(vline.pos, 103); // 画在目标坐标
  // 吸附后 moving.left = 100 + 3 = 103 === target
});

test('最近 delta 40、阈值 6 → 无线、无吸附', () => {
  const moving = { left: 100, top: 0, width: 50, height: 20 };
  const others = [{ left: 140, top: 300, width: 50, height: 20 }]; // 任一轴最近差 40
  const res = ag.computeGuides(moving, others, 6);
  assert.deepEqual(res.lines, []);
  assert.equal(res.snapDx, 0);
  assert.equal(res.snapDy, 0);
});

test('并列候选（|delta| 相等）→ 确定性取最小 target 坐标', () => {
  // moving left=100；两个 other 的 left 分别 96、104，对 moving.left 的 |delta| 都是 4。
  const moving = { left: 100, top: 0, width: 10, height: 10 };
  const others = [
    { left: 104, top: 200, width: 10, height: 10 },
    { left: 96, top: 400, width: 10, height: 10 },
  ];
  const res = ag.computeGuides(moving, others, 6);
  const vline = res.lines.find((l) => l.orientation === 'v');
  assert.equal(vline.pos, 96); // 取最小 target
  assert.equal(res.snapDx, -4); // 96 - 100
});

test('中心对齐：水平中心相等 → snapDx=0 的竖线画在中心坐标', () => {
  // moving: left=100,width=50 → hcenter=125。other: left=120,width=10 → hcenter=125。
  const moving = { left: 100, top: 0, width: 50, height: 20 };
  const others = [{ left: 120, top: 200, width: 10, height: 20 }];
  const res = ag.computeGuides(moving, others, 6);
  const vline = res.lines.find((l) => l.orientation === 'v');
  assert.ok(vline);
  assert.equal(vline.pos, 125); // 中心坐标
  assert.equal(res.snapDx, 0); // 已对齐
});

test('每条线带像素距离标注（label）', () => {
  const moving = { left: 100, top: 0, width: 50, height: 20 };
  const others = [{ left: 103, top: 200, width: 50, height: 20 }];
  const res = ag.computeGuides(moving, others, 6);
  assert.ok(res.lines.length > 0);
  for (const l of res.lines) {
    assert.equal(typeof l.label, 'string');
    assert.match(l.label, /^\d+px$/);
  }
});

test('竖线 from/to 跨被拖框与对齐元素的纵向并集', () => {
  const moving = { left: 100, top: 0, width: 50, height: 20 }; // top 0..20
  const others = [{ left: 103, top: 200, width: 50, height: 30 }]; // top 200..230
  const res = ag.computeGuides(moving, others, 6);
  const vline = res.lines.find((l) => l.orientation === 'v');
  assert.equal(vline.from, 0);
  assert.equal(vline.to, 230);
});

test('横向对齐独立：top 对齐 → snapDy + 横线', () => {
  // moving top=50；other top=52、|delta|=2<=6。横向无对齐。
  const moving = { left: 0, top: 50, width: 20, height: 20 };
  const others = [{ left: 500, top: 52, width: 20, height: 20 }];
  const res = ag.computeGuides(moving, others, 6);
  assert.equal(res.snapDy, 2); // 52 - 50
  assert.equal(res.snapDx, 0);
  const hline = res.lines.find((l) => l.orientation === 'h');
  assert.ok(hline);
  assert.equal(hline.pos, 52);
});

test('spacing 暂为空数组 stub（等距检测后续）', () => {
  const res = ag.computeGuides({ left: 100, top: 0, width: 50, height: 20 },
    [{ left: 103, top: 0, width: 50, height: 20 }], 6);
  assert.deepEqual(res.spacing, []);
});

test('接受 right/bottom 形态的 rect（getBoundingClientRect 风格）', () => {
  const moving = { left: 100, top: 0, right: 150, bottom: 20, width: 50, height: 20 };
  const others = [{ left: 103, top: 200, right: 153, bottom: 220, width: 50, height: 20 }];
  const res = ag.computeGuides(moving, others, 6);
  assert.equal(res.snapDx, 3);
});
