const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { UndoManager } = require('../src/editor/undo.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>').window.document;
}

test('prop op：style before/after 往返', () => {
  const doc = docOf('<div id="a" style="left:10px;"></div>');
  const u = new UndoManager(doc);
  const el = doc.getElementById('a');
  el.setAttribute('style', 'left:200px;');
  u.recordStyleOp(el, 'left:10px;', 'left:200px;');
  assert.equal(el.getAttribute('style'), 'left:200px;');
  assert.equal(u.undo(), true);
  assert.equal(doc.getElementById('a').style.left, '10px'); // CSSOM 属性，对 cssText 归一化稳健
  assert.equal(u.redo(), true);
  assert.equal(doc.getElementById('a').style.left, '200px');
});

test('beginCoalesce + 50 个 prop 更新 + commit → 历史只 +1', () => {
  const doc = docOf('<div id="a" style="left:0px;"></div>');
  const u = new UndoManager(doc);
  const el = doc.getElementById('a');
  const lenBefore = u.stack.length;
  u.beginCoalesce('move:#a');
  for (let i = 1; i <= 50; i++) {
    const after = 'left:' + i + 'px;';
    el.setAttribute('style', after);
    u.recordStyleOp(el, 'left:0px;', after, 'move:#a');
  }
  u.commit();
  assert.equal(u.stack.length, lenBefore + 1, '50 帧应塌成 1 个历史项');
  // 一次 undo 回到首帧 before（0px），证明确实是单个合并 op
  assert.equal(u.undo(), true);
  assert.equal(doc.getElementById('a').style.left, '0px');
  assert.equal(u.redo(), true);
  assert.equal(doc.getElementById('a').style.left, '50px');
});

test('混合 html + prop：undo 两次按 LIFO 各退一步', () => {
  const doc = docOf('<div id="a" style="left:0px;">x</div>');
  const u = new UndoManager(doc);
  // 第一步：html 快照（改文本）
  doc.body.innerHTML = '<div id="a" style="left:0px;">y</div>';
  u.checkpoint();
  // 第二步：prop op（改样式）
  const el = doc.getElementById('a');
  el.setAttribute('style', 'left:99px;');
  u.recordStyleOp(el, 'left:0px;', 'left:99px;');
  // LIFO：先撤 prop
  assert.equal(u.undo(), true);
  assert.equal(doc.getElementById('a').style.left, '0px');
  assert.equal(doc.getElementById('a').textContent, 'y'); // prop undo 只动样式，文本仍是 html 步的 y
  // 再撤 html
  assert.equal(u.undo(), true);
  assert.equal(doc.body.innerHTML, '<div id="a" style="left:0px;">x</div>');
});

test('undo 后产生新 op 砍掉 redo 尾（redo→false）', () => {
  const doc = docOf('<div id="a" style="left:0px;"></div>');
  const u = new UndoManager(doc);
  const el = doc.getElementById('a');
  el.setAttribute('style', 'left:10px;');
  u.recordStyleOp(el, 'left:0px;', 'left:10px;');   // opA
  el.setAttribute('style', 'left:20px;');
  u.recordStyleOp(el, 'left:10px;', 'left:20px;');  // opB
  u.undo();                                          // 撤回 opB
  // 新 op：应砍掉 opB 这条 redo 尾
  el.setAttribute('style', 'left:99px;');
  u.recordStyleOp(el, 'left:10px;', 'left:99px;');  // opC
  assert.equal(u.redo(), false, 'opC 之后没有可重做的尾巴');
  assert.equal(doc.getElementById('a').getAttribute('style'), 'left:99px;');
});

test('250 个 prop op → 上限 200', () => {
  const doc = docOf('<div id="a" style="left:0px;"></div>');
  const u = new UndoManager(doc);
  const el = doc.getElementById('a');
  for (let i = 1; i <= 250; i++) {
    const before = 'left:' + (i - 1) + 'px;';
    const after = 'left:' + i + 'px;';
    el.setAttribute('style', after);
    u.recordStyleOp(el, before, after);
  }
  assert.equal(u.stack.length, 200, '栈封顶 200');
});
