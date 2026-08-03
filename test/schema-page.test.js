// 分页文档页面模型：buildPageCss/parsePageCss 往返 + 严格接受面（解析不出 = 非分页文档）
// + 分页点纯计算（paginateBlocks/computeInnerSplits，语义对齐 ui-demo src/lib/page.ts）。
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/lib/schema-page.js');

test('build→parse 往返：默认 A4', () => {
  const css = P.buildPageCss(P.DEFAULT_PAGE);
  const cfg = P.parsePageCss(css);
  assert.equal(cfg.size, 'A4');
  assert.equal(cfg.orientation, 'portrait');
  assert.deepEqual(cfg.margin, { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 });
});

test('build→parse 往返：全纸张 × 双方向 × 各边距预设', () => {
  for (const size of Object.keys(P.PAGE_SIZES)) {
    for (const orientation of P.ORIENTATIONS) {
      for (const margin of Object.values(P.MARGIN_PRESETS)) {
        const cfg0 = { size, orientation, margin };
        const cfg = P.parsePageCss(P.buildPageCss(cfg0));
        assert.deepEqual(cfg, { size, orientation, margin }, size + '/' + orientation);
      }
    }
  }
});

test('canonical CSS = 恰好一条 @page（分页符已删、body 收窄不入盘）', () => {
  const css = P.buildPageCss(P.DEFAULT_PAGE);
  assert.match(css, /^@page\{size:A4 portrait;margin:25\.4mm 25\.4mm 25\.4mm 25\.4mm\}$/);
  assert.ok(!css.includes('ws-page-break')); // 手动分页符已删（Colin 2026-07-09）
  assert.ok(!css.includes('body'));
});

test('parse：margin 1 值 / 2 值展开', () => {
  assert.deepEqual(P.parsePageCss('@page{size:A4;margin:10mm}').margin, { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(P.parsePageCss('@page{size:A4;margin:10mm 20mm}').margin, { top: 10, right: 20, bottom: 10, left: 20 });
});

test('parse：无 margin → 默认边距；无方向 → portrait', () => {
  const cfg = P.parsePageCss('@page{size:Letter}');
  assert.equal(cfg.size, 'Letter');
  assert.equal(cfg.orientation, 'portrait');
  assert.deepEqual(cfg.margin, P.DEFAULT_PAGE.margin);
});

test('parse 拒绝：纸张不在白名单 / 单位非 mm / 未知 @page 属性', () => {
  assert.equal(P.parsePageCss('@page{size:B5}'), null);
  assert.equal(P.parsePageCss('@page{size:A4;margin:1in}'), null);
  assert.equal(P.parsePageCss('@page{size:A4;margin:10px}'), null);
  assert.equal(P.parsePageCss('@page{size:A4;bleed:3mm}'), null);
  assert.equal(P.parsePageCss('@page{size:A4;margin:10mm 10mm 10mm}'), null); // 3 值不认
});

test('parse 拒绝：@page 以外的任何规则 / 重复 / 语法残渣 / 危险 token', () => {
  assert.equal(P.parsePageCss('@page{size:A4}div{color:red}'), null);
  assert.equal(P.parsePageCss('@page{size:A4}@page{size:A3}'), null);
  assert.equal(P.parsePageCss('@page{size:A4}body{width:100mm}'), null); // 旧 canonical 的 body 规则也不再认
  assert.equal(P.parsePageCss('@page{size:A4}.ws-page-break{break-after:page}'), null); // 分页符规则不再认
  assert.equal(P.parsePageCss('@page{size:A4} 裸文本'), null);
  assert.equal(P.parsePageCss('body{width:100mm}'), null); // 没有 @page
  assert.equal(P.parsePageCss('@page{size:A4;margin:10mm;background:url(http://x)}'), null);
  assert.equal(P.parsePageCss(''), null);
  assert.equal(P.parsePageCss(null), null);
});

test('pageBoxPx：A4 页宽 794px（与 pdf-export A4_WIDTH_PX 锚定）；landscape 宽高互换', () => {
  const box = P.pageBoxPx(P.DEFAULT_PAGE);
  assert.equal(Math.round(box.pageW), 794);
  assert.equal(Math.round(box.pageH), 1123);
  assert.ok(box.contentW < box.pageW && box.contentH < box.pageH);
  const land = P.pageBoxPx({ ...P.DEFAULT_PAGE, orientation: 'landscape' });
  assert.equal(Math.round(land.pageW), 1123);
  assert.equal(Math.round(land.pageH), 794);
});

// ==========================================================================
// paginateBlocks / computeInnerSplits（语义 = ui-demo page.ts；数字全为 px）
// ==========================================================================

test('paginateBlocks：全装得下 → 1 页、无 gap、lastFill = 剩余', () => {
  const r = P.paginateBlocks([100, 200, 300], 1000);
  assert.equal(r.pageCount, 1);
  assert.deepEqual(r.pageOfBlock, [0, 0, 0]);
  assert.deepEqual(r.gapBefore, [null, null, null]);
  assert.equal(r.lastFill, 400);
});

test('paginateBlocks：放不下整块推下页，gap = 上页剩余留白', () => {
  const r = P.paginateBlocks([800, 400], 1000);
  assert.equal(r.pageCount, 2);
  assert.deepEqual(r.pageOfBlock, [0, 1]);
  assert.equal(r.gapBefore[0], null);
  assert.equal(r.gapBefore[1], 200); // 1000 - 800
  assert.deepEqual(r.pageStartBlocks, [0, 1]);
  assert.equal(r.lastFill, 600);
});

test('paginateBlocks：恰好填满不切，下一块自然落新页（gap = 0）', () => {
  const r = P.paginateBlocks([500, 500, 300], 1000);
  assert.equal(r.pageCount, 2);
  assert.deepEqual(r.pageOfBlock, [0, 0, 1]);
  assert.equal(r.gapBefore[2], 0);
});

test('paginateBlocks：超页高块无切分点 → 从新页开始、跨 ceil(h/页高) 页拉长', () => {
  const r = P.paginateBlocks([100, 2500], 1000);
  assert.equal(r.gapBefore[1], 900); // 先推到新页
  assert.deepEqual(r.pageOfBlock, [0, 1]);
  assert.equal(r.pageCount, 4); // 页1=块0，块1 跨 3 页
  assert.deepEqual(r.pageStartBlocks, [0, 1, 1, 1]);
  assert.equal(r.lastFill, 1000 - 500); // 尾段 2500-2000=500
});

test('paginateBlocks：超页高块带切分点 → 每切点一页、块尾从最后切点起算', () => {
  const r = P.paginateBlocks([100, 2500, 200], 1000, [null, [950, 1900], null]);
  assert.equal(r.gapBefore[1], 900);
  assert.equal(r.pageOfBlock[1], 1);
  // 块1 占页 1(起)+2 个切点页；尾段 2500-1900=600，块2 接着放：600+200 ≤ 1000 → 同页
  assert.equal(r.pageOfBlock[2], 3);
  assert.equal(r.gapBefore[2], null);
  assert.equal(r.pageCount, 4);
  assert.equal(r.lastFill, 1000 - 800);
});

test('paginateBlocks：页高非法 → 防御性单页', () => {
  const r = P.paginateBlocks([100, 200], 0);
  assert.equal(r.pageCount, 1);
  assert.deepEqual(r.gapBefore, [null, null]);
});

test('computeInnerSplits：每页装到最后一个装得下的边界，fill = 页尾留白', () => {
  const tops = [];
  for (let t = 100; t <= 2400; t += 100) tops.push(t); // 行高 100 的 24 行
  const cuts = P.computeInnerSplits(tops, 2500, 1000);
  assert.equal(cuts.length, 2);
  assert.equal(cuts[0].top, 1000); assert.equal(cuts[0].fill, 0);
  assert.equal(cuts[1].top, 2000); assert.equal(cuts[1].fill, 0);
});

test('computeInnerSplits：边界不整除 → fill 为正；startOffset 挤掉首页空间', () => {
  const tops = [0, 300, 700, 1100, 1500, 1900, 2300];
  const cuts = P.computeInnerSplits(tops, 2600, 1000);
  assert.deepEqual(cuts.map((c) => c.top), [700, 1500, 2300]);
  assert.deepEqual(cuts.map((c) => c.fill), [300, 200, 200]);
  const cuts2 = P.computeInnerSplits(tops, 2600, 1000, 400); // 首页只剩 600
  assert.equal(cuts2[0].top, 300);
  assert.equal(cuts2[0].fill, 300);
});

test('computeInnerSplits：段内无边界（单张超页高图）→ 停止（空数组/截断）', () => {
  assert.deepEqual(P.computeInnerSplits([], 3000, 1000), []);
  // 首段 1200 内无边界（首个边界在 1500）→ 一个也切不了
  assert.deepEqual(P.computeInnerSplits([1500, 1600], 3000, 1000), []);
});

test('computeInnerSplits：切点严格推进，同点/回退不重切（防死循环）', () => {
  const cuts = P.computeInnerSplits([500, 500.5, 501], 5000, 1000);
  // 每轮从 lastCut+1 之后找：不会在 500/500.5/501 之间打转
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i].top > cuts[i - 1].top + 1);
});
