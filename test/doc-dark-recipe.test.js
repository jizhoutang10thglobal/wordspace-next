'use strict';
// 文档反色滤镜配方纯逻辑单测:recipeCss 形状 + isAlreadyDark 启发式(含透明背景口径)。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { recipeCss, isAlreadyDark, FILTER, MEDIA_SELECTORS } = require('../src/lib/doc-dark-recipe');
const { relativeLuminance } = require('../src/lib/luminance');

test('防漂移：ui-demo docDark.ts 镜像的 FILTER/MEDIA_SELECTORS 与 canonical 逐字一致', () => {
  // ui-demo 因 CJS/ESM 边界镜像了一份配方(U6 搬的是 canonical);两处值必须一致,否则 demo 与真 app 反色不同。
  const mirror = fs.readFileSync(path.join(__dirname, '..', 'ui-demo', 'src', 'docDark.ts'), 'utf8');
  assert.ok(mirror.includes(`'${FILTER}'`), `docDark.ts 的 FILTER 与 canonical 漂移:应含 '${FILTER}'`);
  assert.ok(mirror.includes(MEDIA_SELECTORS), `docDark.ts 的 MEDIA_SELECTORS 与 canonical 漂移`);
});

test('recipeCss：根挂 html、媒体反反色、强制白底', () => {
  const css = recipeCss('html');
  assert.match(css, /html\{filter:invert\(1\) hue-rotate\(180deg\) !important;background-color:#ffffff !important;\}/);
  assert.match(css, /html :is\(img, video, canvas, svg image, picture, \[style\*="background-image"\]\)\{filter:invert\(1\) hue-rotate\(180deg\);\}/);
  assert.strictEqual(FILTER, 'invert(1) hue-rotate(180deg)');
});

test('recipeCss：默认根 = html', () => {
  assert.ok(recipeCss().startsWith('html{filter:'));
});

test('isAlreadyDark：深色背景文档 → true（跳过滤镜）', () => {
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['#1c1917']), true);
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['rgb(20, 20, 20)']), true);
});

test('isAlreadyDark：浅色背景文档 → false（施滤镜）', () => {
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['#ffffff']), false);
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['rgb(245, 245, 244)']), false);
});

test('isAlreadyDark：完全透明 body → 视为浅色（施滤镜，不误判为已暗）', () => {
  // 野生浅色文档大多不设 body 背景 → rgba(0,0,0,0)。naive 算亮度=0 会误判已暗；口径必须跳过透明。
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['rgba(0, 0, 0, 0)']), false);
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['transparent']), false);
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['transparent', 'rgba(0,0,0,0)']), false);
});

test('isAlreadyDark：透明 html 但 body 深色 → 顺延到 body 判 true', () => {
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['rgba(0,0,0,0)', '#111111']), true);
});

test('isAlreadyDark：透明 html 但 body 浅色 → false', () => {
  assert.strictEqual(isAlreadyDark(relativeLuminance, ['transparent', '#fafafa']), false);
});
