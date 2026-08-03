// 表格块编辑（feat/table-block-editing）单测：classify/门控语义 + tableSeed 种子合规。
// 纯函数 jsdom 直测（真 app 无 vitest，node:test）；e2e 真门在 e2e/table.spec.js。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const be = require('../src/editor/blockedit.js');
const sv = require('../src/lib/schema-validate.js');

function el(html) {
  return new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>').window.document.body.firstElementChild;
}
function docOf(html) {
  return new JSDOM(html).window.document;
}

test('classify: TABLE → table（不再落 other）', () => {
  assert.equal(be.classify(el('<table><tbody><tr><td>x</td></tr></tbody></table>')), 'table');
  // 两种存量形态同判（标签键控，不看 class）：AI 生成 ws-table / md 转换无 class + align 属性
  assert.equal(be.classify(el('<table class="ws-table"><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')), 'table');
  assert.equal(be.classify(el('<table><thead><tr><th align="center">B</th></tr></thead><tbody><tr><td align="center">2</td></tr></tbody></table>')), 'table');
});

test('isEditableEl: 表格容器仍不可整块文字编辑（双层模型——编辑能力在 TD/TH，不在 TABLE）', () => {
  assert.equal(be.isEditableEl(el('<table><tbody><tr><td>x</td></tr></tbody></table>')), false);
  assert.equal(be.isEditableEl(el('<table class="ws-table"><tbody><tr><td>x</td></tr></tbody></table>')), false);
});

test('tableSeed: 默认种子 = ws-table + thead 1×3 th[scope=col] + tbody 2×3 td，空格带 <br>', () => {
  const d = docOf('<!DOCTYPE html><html><body></body></html>');
  const t = be.tableSeed(d);
  assert.equal(t.tagName, 'TABLE');
  assert.equal(t.className, 'ws-table');
  const theads = [...t.children].filter((c) => c.tagName === 'THEAD');
  const tbodies = [...t.children].filter((c) => c.tagName === 'TBODY');
  assert.equal(theads.length, 1);
  assert.equal(tbodies.length, 1);
  const hrows = theads[0].querySelectorAll('tr');
  assert.equal(hrows.length, 1); // 表头至多一行（这里恰一行）
  const ths = hrows[0].querySelectorAll('th');
  assert.equal(ths.length, 3);
  for (const th of ths) {
    assert.equal(th.getAttribute('scope'), 'col');
    assert.equal(th.querySelectorAll('br').length, 1); // 空格占位 <br>（光标落得进）
  }
  const brows = tbodies[0].querySelectorAll('tr');
  assert.equal(brows.length, 2);
  for (const tr of brows) {
    const tds = tr.querySelectorAll('td');
    assert.equal(tds.length, 3); // 矩形：每行同格数
    for (const td of tds) assert.equal(td.querySelectorAll('br').length, 1);
  }
});

test('tableSeed: 自定义行列数仍矩形（5 列 1 行——长度非对称 fixture，防同长巧合哑门）', () => {
  const d = docOf('<!DOCTYPE html><html><body></body></html>');
  const t = be.tableSeed(d, 5, 1);
  const rows = [...t.querySelectorAll('tr')];
  assert.equal(rows.length, 2); // thead 1 + tbody 1
  for (const tr of rows) {
    assert.equal([...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').length, 5);
  }
});

test('tableRowsOf: 过滤分页 spacer 行（data-ws2-ui / .ws-page-spacer 双保险，长度非对称 fixture）', () => {
  const t = el('<table><thead><tr><th>表头甲</th></tr></thead><tbody>'
    + '<tr class="ws-page-spacer" data-ws2-ui="__ws2-overlay__"><td colspan="99">推</td></tr>'
    + '<tr><td>数据行内容较长一号</td></tr>'
    + '<tr class="ws-page-spacer"><td>又一个间隔</td></tr>'
    + '<tr><td>短</td></tr></tbody></table>');
  const rows = require('../src/editor/blockedit.js').tableRowsOf(t);
  assert.equal(rows.length, 3); // thead 1 + tbody 数据行 2（两个 spacer 都被滤掉）
  assert.ok(rows.every((r) => !r.classList.contains('ws-page-spacer')));
});

test('firstCellOf: thead 优先取 R1C1；无 thead 时取 tbody 首格；空壳表返 null', () => {
  assert.equal(be.firstCellOf(el('<table><thead><tr><th>首</th><th>次</th></tr></thead><tbody><tr><td>体</td><td>体二</td></tr></tbody></table>')).textContent, '首');
  assert.equal(be.firstCellOf(el('<table><tbody><tr><td>无表头首格</td></tr></tbody></table>')).textContent, '无表头首格');
  assert.equal(be.firstCellOf(el('<table></table>')), null);
});

test('tableSeed 产物 reparse 后过校验器（conform，含在完整合规文档中）', () => {
  const d = docOf('<!DOCTYPE html><html><body></body></html>');
  const t = be.tableSeed(d);
  const full = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p>前文段落甲</p>' + t.outerHTML + '</body></html>';
  const reparsed = docOf(full); // 校验器铁律：判 reparse DOM，不判活 DOM
  const res = sv.validate(reparsed);
  assert.equal(res.conform, true, 'violations: ' + JSON.stringify(res.violations));
});

test('变异探针（种子矩形有牙）：削掉一格的表格必被校验器抓 table-ragged', () => {
  // 不是测实现、是测「这套断言真的能翻红」：坏种子（3/3/2 列）过校验器必不 conform。
  const bad = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
    + '<table class="ws-table"><thead><tr><th scope="col">a</th><th scope="col">b</th><th scope="col">c</th></tr></thead>'
    + '<tbody><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td></tr></tbody></table></body></html>';
  const res = sv.validate(docOf(bad));
  assert.equal(res.conform, false);
  assert.ok(res.violations.some((v) => v.rule === 'table-ragged'));
});
