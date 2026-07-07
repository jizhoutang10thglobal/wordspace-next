'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { buildMatchRanges } = require('../src/lib/find-ranges');

function bodyOf(html) {
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>');
  return dom.window.document.body;
}

test('单个文本节点里的多处匹配', () => {
  const rs = buildMatchRanges(bodyOf('<p>foo bar foo baz foo</p>'), 'foo');
  assert.equal(rs.length, 3);
  assert.ok(rs.every((r) => r.toString() === 'foo'));
});

test('大小写不敏感', () => {
  assert.equal(buildMatchRanges(bodyOf('<p>Foo FOO foo fOo</p>'), 'foo').length, 4);
});

test('跨标签 / 多段落', () => {
  const rs = buildMatchRanges(bodyOf('<h1>hello world</h1><p>a world here</p><p>none</p>'), 'world');
  assert.equal(rs.length, 2);
});

test('空查询 / 无匹配 → 空数组', () => {
  assert.equal(buildMatchRanges(bodyOf('<p>abc</p>'), '').length, 0);
  assert.equal(buildMatchRanges(bodyOf('<p>abc</p>'), 'zzz').length, 0);
  assert.equal(buildMatchRanges(bodyOf('<p>abc</p>'), null).length, 0);
});

test('range 偏移精确', () => {
  const rs = buildMatchRanges(bodyOf('<p>xxfooxx</p>'), 'foo');
  assert.equal(rs.length, 1);
  assert.equal(rs[0].startOffset, 2);
  assert.equal(rs[0].endOffset, 5);
});

test('连续匹配非重叠', () => {
  const rs = buildMatchRanges(bodyOf('<p>aaaa</p>'), 'aa');
  assert.equal(rs.length, 2); // 位置 0-2 与 2-4，不是 0-2/1-3/2-4
  assert.deepEqual(rs.map((r) => r.startOffset), [0, 2]);
});

test('默认跳过 [data-ws2-ui] 浮层里的文字', () => {
  const rs = buildMatchRanges(
    bodyOf('<p>keep keep</p><div data-ws2-ui="1"><span>keep</span></div>'),
    'keep',
  );
  assert.equal(rs.length, 2); // 浮层里那个 keep 不算
});

test('skipSelector 可关闭（传空串则不跳）', () => {
  const rs = buildMatchRanges(
    bodyOf('<p>keep</p><div data-ws2-ui="1"><span>keep</span></div>'),
    'keep',
    { skipSelector: '' },
  );
  assert.equal(rs.length, 2);
});

test('空白/纯空格文本节点被忽略、不影响计数', () => {
  const rs = buildMatchRanges(bodyOf('<p>hi</p>\n\n   \n<p> hi </p>'), 'hi');
  assert.equal(rs.length, 2);
});

test('中文匹配', () => {
  const rs = buildMatchRanges(bodyOf('<p>查找这个词，再查找一次</p>'), '查找');
  assert.equal(rs.length, 2);
});

// 已知限制（v1）：只在单个文本节点内匹配。显式钉住当前行为，别让它成「被 rig 的绿灯」掩盖的隐性 bug。
test('已知限制：查询词被行内标签切断则跨节点不匹配', () => {
  // "wor" + <b>"ld"</b> —— "world" 横跨两个文本节点，当前实现抓不到。
  const rs = buildMatchRanges(bodyOf('<p>hello wor<b>ld</b> here</p>'), 'world');
  assert.equal(rs.length, 0); // 记录现状=0；将来支持跨节点时把这条改成 1（提醒实现者）
  // 但整词落在同一节点内仍正常
  assert.equal(buildMatchRanges(bodyOf('<p>hello <b>world</b> here</p>'), 'world').length, 1);
});
