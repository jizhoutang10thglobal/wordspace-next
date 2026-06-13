// 修复覆盖：redo 先 checkpoint 未提交编辑，避免 redo 覆盖丢失它们。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { UndoManager } = require('../src/editor/undo.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>').window.document;
}

test('redo 不丢未提交编辑：undo 后再编辑再 redo，编辑保住', () => {
  const doc = docOf('<p>A</p>');
  const u = new UndoManager(doc);
  doc.body.innerHTML = '<p>B</p>'; u.checkpoint();
  doc.body.innerHTML = '<p>C</p>'; u.checkpoint();   // stack=[A,B,C]
  u.undo(); u.undo();                                 // 回到 A
  doc.body.innerHTML = '<p>NEW</p>';                  // 未 checkpoint 的新编辑
  u.redo();                                           // 修复前会变回 B 丢 NEW
  assert.equal(doc.body.innerHTML, '<p>NEW</p>', 'redo 不应覆盖未提交的编辑');
});

test('正常 redo 仍工作（undo 后直接 redo）', () => {
  const doc = docOf('<p>A</p>');
  const u = new UndoManager(doc);
  doc.body.innerHTML = '<p>B</p>'; u.checkpoint();
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>A</p>');
  assert.equal(u.redo(), true);
  assert.equal(doc.body.innerHTML, '<p>B</p>');
});
