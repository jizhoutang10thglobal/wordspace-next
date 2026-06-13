const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { UndoManager } = require('../src/editor/undo.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>').window.document;
}

test('undo/redo restores body states', () => {
  const doc = docOf('<p>one</p>');
  const u = new UndoManager(doc);
  doc.body.innerHTML = '<p>two</p>';
  u.checkpoint();
  doc.body.innerHTML = '<p>three</p>';
  u.checkpoint();
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>two</p>');
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>one</p>');
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>one</p>');
  u.redo();
  assert.equal(doc.body.innerHTML, '<p>two</p>');
});

test('new edit after undo drops redo branch', () => {
  const doc = docOf('<p>one</p>');
  const u = new UndoManager(doc);
  doc.body.innerHTML = '<p>two</p>';
  u.checkpoint();
  u.undo();
  doc.body.innerHTML = '<p>alt</p>';
  u.checkpoint();
  u.redo();
  assert.equal(doc.body.innerHTML, '<p>alt</p>');
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>one</p>');
});

test('identical snapshot is not pushed twice', () => {
  const doc = docOf('<p>one</p>');
  const u = new UndoManager(doc);
  u.checkpoint();
  u.checkpoint();
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>one</p>');
});

test('undo captures pending un-checkpointed edits first', () => {
  const doc = docOf('<p>one</p>');
  const u = new UndoManager(doc);
  doc.body.innerHTML = '<p>two</p>';
  u.undo();
  assert.equal(doc.body.innerHTML, '<p>one</p>');
  u.redo();
  assert.equal(doc.body.innerHTML, '<p>two</p>');
});

test('undo/redo report whether state changed', () => {
  const doc = docOf('<p>one</p>');
  const u = new UndoManager(doc);
  assert.equal(u.undo(), false);
  doc.body.innerHTML = '<p>two</p>';
  u.checkpoint();
  assert.equal(u.undo(), true);
  assert.equal(u.undo(), false);
  assert.equal(u.redo(), true);
  assert.equal(u.redo(), false);
});
