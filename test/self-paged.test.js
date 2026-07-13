const test = require('node:test');
const assert = require('node:assert');
const { isSelfPaged } = require('../src/lib/self-paged.js');

const wrap = (css) => `<!doctype html><html><head><style>${css}</style></head><body><p>x</p></body></html>`;

test('命中：<style> 里的 @page（含嵌在 @media print 里的，Wendi 文档同构）', () => {
  assert.equal(isSelfPaged(wrap('@page { size: A4; margin: 0 }')), true);
  assert.equal(isSelfPaged(wrap('@media print { .page { break-after: page } @page { size: A4; margin: 0 } }')), true);
});

test('命中：<style> 里的强制分页符（现代 + 传统写法，大小写不敏感）', () => {
  assert.equal(isSelfPaged(wrap('.page { break-after: page }')), true);
  assert.equal(isSelfPaged(wrap('.sheet { PAGE-BREAK-AFTER: always }')), true);
  assert.equal(isSelfPaged(wrap('h1 { break-before: right }')), true);
});

test('命中：内联 style 属性里的分页符（Word/WPS 导出惯用）', () => {
  assert.equal(isSelfPaged('<html><body><p>a</p><br style="page-break-before:always"><p>b</p></body></html>'), true);
  assert.equal(isSelfPaged("<div style='break-after: page'>x</div>"), true);
});

test('不命中：普通文档 / 排版微调（break-inside、avoid）不算分页版式', () => {
  assert.equal(isSelfPaged(wrap('body { margin: 0; padding: 24px }')), false);
  assert.equal(isSelfPaged(wrap('body>*{break-inside:avoid} tr,li{break-inside:avoid}')), false); // PAGED_PRINT_CSS 同款
  assert.equal(isSelfPaged(wrap('p { break-after: avoid } h2 { page-break-inside: avoid }')), false);
  assert.equal(isSelfPaged(wrap('.col { break-after: column }')), false);
});

test('不命中：正文/注释里提到 @page 或 page-break（教程类文档不误触发）', () => {
  assert.equal(isSelfPaged('<html><body><p>CSS 的 @page 规则可以设置纸张，page-break-after: always 强制分页。</p></body></html>'), false);
  assert.equal(isSelfPaged(wrap('/* 这里以前用过 @page 和 break-after: page，已删 */ body { margin: 0 }')), false);
});

test('不命中：空/非字符串输入', () => {
  assert.equal(isSelfPaged(''), false);
  assert.equal(isSelfPaged(null), false);
  assert.equal(isSelfPaged(undefined), false);
});

test('多个 <style> 块：任一命中即命中（正则 lastIndex 复位，连续调用结果稳定）', () => {
  const html = '<style>body{margin:0}</style><style>@page{size:A4}</style>';
  assert.equal(isSelfPaged(html), true);
  assert.equal(isSelfPaged(html), true); // 再调一次结果一致（全局正则状态没泄漏）
  assert.equal(isSelfPaged(wrap('body{margin:0}')), false);
});
