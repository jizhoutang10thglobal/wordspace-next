'use strict';
// U1 暗色 palette 自检:遍历 test/appearance-contrast-pairs.js 配对清单,
// 对 tokens.css 暗色块的实际 hex 跑 WCAG 对比度,body≥4.5、large≥3、exempt 跳过。
// 这是 palette 初稿的可复现底线(正式门在 U7 e2e,读 rendered getComputedStyle)。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { contrastRatio } = require('../src/lib/luminance');
const pairs = require('./appearance-contrast-pairs');

// tokens.css 是 palette 的唯一正本;解析暗色块 --name: value; 成 map。
const cssPath = path.join(__dirname, '..', 'ui-demo', 'src', 'styles', 'tokens.css');
const css = fs.readFileSync(cssPath, 'utf8');
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
assert.ok(darkBlock, 'tokens.css 没有 :root[data-theme="dark"] 暗色块');
const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
assert.ok(lightBlock, 'tokens.css 没有 :root 亮色块');

function parseVars(block) {
  const map = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) map[m[1]] = m[2].trim();
  return map;
}
const dark = parseVars(darkBlock[1]);
const light = parseVars(lightBlock[1]);
const THRESH = { body: 4.5, large: 3 };

test('暗色块每个 color token 在亮色块有同名对应(不增不删 color/shadow)', () => {
  // 亮色块里 color + shadow 组的变量,暗色块必须全部覆盖到(type/radius/motion 主题无关,不算)。
  const isColorish = (k) => /^--c-/.test(k) || /^--shadow-/.test(k);
  const lightColor = Object.keys(light).filter(isColorish);
  const missing = lightColor.filter((k) => !(k in dark));
  const extra = Object.keys(dark).filter((k) => !(k in light));
  assert.deepStrictEqual(missing, [], `暗色块缺这些 color/shadow token: ${missing.join(', ')}`);
  assert.deepStrictEqual(extra, [], `暗色块多了亮色块没有的 token: ${extra.join(', ')}`);
});

for (const p of pairs) {
  test(`对比度 ${p.text} on ${p.bg} (${p.level})`, () => {
    const fg = dark[p.text];
    const bg = dark[p.bg];
    assert.ok(fg, `暗色块缺 ${p.text}`);
    assert.ok(bg, `暗色块缺 ${p.bg}`);
    if (p.level === 'exempt') return;
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio != null, `无法算 ${p.text}/${p.bg} 对比度(${fg} / ${bg})`);
    assert.ok(
      ratio >= THRESH[p.level],
      `${p.text}(${fg}) on ${p.bg}(${bg}) = ${ratio.toFixed(2)}:1，低于 ${p.level} 阈值 ${THRESH[p.level]}:1`,
    );
  });
}
