const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

// toolbar.js 裸引用 WS2Format（非 global. 前缀），node:test 下要先挂到 globalThis 再 require。
global.WS2Format = require('../src/editor/format.js');
const toolbar = require('../src/editor/toolbar.js');

// 建一个 jsdom 容器 + 一份「被编辑文档」doc，返回 { tb, container, doc, body }。
function setup(bodyHtml) {
  const chrome = new JSDOM('<!DOCTYPE html><html><body><div id="toolbar"></div></body></html>');
  const container = chrome.window.document.getElementById('toolbar');
  const docDom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>');
  const doc = docDom.window.document;
  const tb = toolbar.create(container, { markDirty() {} });
  return { tb, container, doc, body: doc.body, win: docDom.window };
}

// 点工具栏里 title=xxx 的按钮 / 改 select。
function clickBtn(container, title) {
  const b = [...container.querySelectorAll('button')].find(x => x.title === title);
  assert.ok(b, '找不到按钮 title=' + title);
  b.click();
}
function pickTurn(container, label) {
  // 「转为」菜单：点「转换类型」开菜单，再点对应 .tb-menu-item（取代旧 heading <select>）。
  const trigger = [...container.querySelectorAll('button')].find(x => x.title === '转换类型');
  assert.ok(trigger, '找不到转换类型按钮');
  trigger.click();
  const item = [...container.querySelectorAll('.tb-menu-item')].find(x => x.textContent === label);
  assert.ok(item, '找不到转为菜单项 ' + label);
  item.click();
}
function pickByOptionValue(container, optionValue) {
  // 找到含该 value 的 select，设值并触发 change。
  for (const s of container.querySelectorAll('select')) {
    if ([...s.options].some(o => o.value === optionValue)) {
      s.value = optionValue;
      s.dispatchEvent(new container.ownerDocument.defaultView.Event('change'));
      return true;
    }
  }
  return false;
}

test('非编辑态：转为「标题 2」把被选 <p> retag 成 <h2>，并刷新选中', () => {
  const { tb, container, doc } = setup('<p id="p1">hello</p>');
  let selectedEl = doc.getElementById('p1');
  const canvasStub = { select: (el) => { selectedEl = el; return el; } };
  tb.setContext({
    doc, getSelectedEl: () => selectedEl, isTextEditing: () => false,
    undoMgr: { checkpoint() {} }, canvas: canvasStub
  });
  pickTurn(container, '标题 2');
  const h2 = doc.querySelector('h2');
  assert.ok(h2, '<p> 应被 retag 成 <h2>');
  assert.equal(h2.id, 'p1');
  assert.equal(h2.textContent, 'hello');
  assert.equal(doc.querySelector('p'), null);
  assert.equal(selectedEl, h2, '选中应跟随新元素');
});

test('非编辑态：字号 24 通过 applyBlockStyle 设 el.style.fontSize=24px（非 wrapInlineStyle）', () => {
  const { tb, container, doc } = setup('<p id="p1">hi</p>');
  const p = doc.getElementById('p1');
  tb.setContext({
    doc, getSelectedEl: () => p, isTextEditing: () => false, undoMgr: { checkpoint() {} }
  });
  assert.ok(pickByOptionValue(container, '24'), '应有字号 24 选项');
  assert.equal(p.style.fontSize, '24px');
  assert.equal(doc.querySelector('p span'), null, '不该走 wrapInlineStyle 生成 span');
});

test('非编辑态：对齐居中设 el.style.textAlign=center', () => {
  const { tb, container, doc } = setup('<p id="p1">hi</p>');
  const p = doc.getElementById('p1');
  tb.setContext({ doc, getSelectedEl: () => p, isTextEditing: () => false, undoMgr: { checkpoint() {} } });
  clickBtn(container, '居中');
  assert.equal(p.style.textAlign, 'center');
});

test('非编辑态：文字色作用于被选元素 el.style.color', () => {
  const { tb, container, doc } = setup('<p id="p1">hi</p>');
  const p = doc.getElementById('p1');
  tb.setContext({ doc, getSelectedEl: () => p, isTextEditing: () => false, undoMgr: { checkpoint() {} } });
  // 打开文字颜色弹窗再点第一个色块
  clickBtn(container, '文字颜色');
  const sw = container.querySelector('.tb-pop.open .tb-swatch');
  assert.ok(sw, '应有颜色块');
  sw.click();
  assert.ok(p.style.color, '应设了 color');
});

test('视觉效果：圆角循环 0→8→16，阴影开关，不透明度循环', () => {
  const { tb, container, doc } = setup('<p id="p1">hi</p>');
  const p = doc.getElementById('p1');
  tb.setContext({ doc, getSelectedEl: () => p, isTextEditing: () => false, undoMgr: { checkpoint() {} } });
  clickBtn(container, '圆角');
  assert.equal(p.style.borderRadius, '8px');
  clickBtn(container, '圆角');
  assert.equal(p.style.borderRadius, '16px');
  clickBtn(container, '阴影');
  assert.ok(p.style.boxShadow, '阴影应打开');
  clickBtn(container, '阴影');
  assert.equal(p.style.boxShadow, '', '再点关闭阴影');
  clickBtn(container, '不透明度');
  assert.equal(p.style.opacity, '0.75');
});

test('文字编辑态：字号走 wrapInlineStyle（range span），不走 applyBlockStyle', () => {
  // wrapInlineStyle 要求选区在同一个 [data-ws2-block] 内（保真红线，跨块拒绝），
  // 这里给块挂上该标记以走文字编辑 range 路径。
  const { tb, container, doc, win } = setup('<p id="p1" data-ws2-block="text">abcdef</p>');
  const p = doc.getElementById('p1');
  // 造一个真实 range 选区（wrapInlineStyle 要非折叠选区）
  const sel = win.getSelection();
  const range = doc.createRange();
  range.setStart(p.firstChild, 1);
  range.setEnd(p.firstChild, 4);
  sel.removeAllRanges();
  sel.addRange(range);
  tb.setContext({
    doc, win, getRange: () => range, getSelectedEl: () => p,
    isTextEditing: () => true, undoMgr: { checkpoint() {} }
  });
  assert.ok(pickByOptionValue(container, '24'), '应有字号 24 选项');
  const span = doc.querySelector('p span');
  assert.ok(span, '编辑态应走 wrapInlineStyle 生成 span');
  assert.equal(span.style.fontSize, '24px');
  assert.equal(p.style.fontSize, '', '被选元素本身不应被 applyBlockStyle 改');
});

// 注：旧「heading 下拉反映当前块类型」用例已随设计移除——「转为」改成 Notion 式静态标签
// （不再回显当前类型），与平行 session ui-demo 的 FormatToolbar 一致。
