const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const blocks = require('../src/editor/blocks.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>').window.document;
}

test('text blocks marked editable kinds', () => {
  const doc = docOf('<p>a</p><h2>b</h2><ul><li>c</li></ul><hr>');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('p').getAttribute('data-ws2-block'), 'text');
  assert.equal(doc.querySelector('h2').getAttribute('data-ws2-block'), 'text');
  assert.equal(doc.querySelector('ul').getAttribute('data-ws2-block'), 'list');
  assert.equal(doc.querySelector('hr').getAttribute('data-ws2-block'), 'divider');
  assert.equal(doc.body.getAttribute('contenteditable'), 'true');
});

test('wrapper div with blocks inside is a container, descended into', () => {
  const doc = docOf('<div class="wrap"><p>a</p><table><tbody><tr><td>x</td></tr></tbody></table></div>');
  blocks.applyEditable(doc);
  const wrap = doc.querySelector('.wrap');
  assert.equal(wrap.hasAttribute('data-ws2-container'), true);
  assert.equal(wrap.hasAttribute('data-ws2-block'), false);
  assert.equal(doc.querySelector('p').getAttribute('data-ws2-block'), 'text');
});

test('table and unknown structures are locked and non-editable', () => {
  const doc = docOf('<table><tbody><tr><td>x</td></tr></tbody></table><div class="newver"><p>v</p></div><img src="a.png">');
  blocks.applyEditable(doc);
  const table = doc.querySelector('table');
  assert.equal(table.getAttribute('data-ws2-block'), 'locked');
  assert.equal(table.getAttribute('contenteditable'), 'false');
  assert.equal(table.hasAttribute('data-ws2-ce'), true);
  assert.equal(doc.querySelector('.newver p').getAttribute('data-ws2-block'), 'text');
  assert.equal(doc.querySelector('img').getAttribute('data-ws2-block'), 'locked');
});

test('editor ui nodes are skipped', () => {
  const doc = docOf('<p>a</p><div data-ws2-ui></div>');
  blocks.applyEditable(doc);
  assert.equal(doc.querySelector('[data-ws2-ui]').hasAttribute('data-ws2-block'), false);
});
