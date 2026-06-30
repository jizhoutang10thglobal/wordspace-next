const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const M = require('../src/lib/schema-model.js');

// 取 body 第一个元素子（构造测试节点用）
function el(html) {
  const doc = new JSDOM('<!DOCTYPE html><body>' + html + '</body>').window.document;
  return doc.body.firstElementChild;
}
// fragment → 容器，方便断 innerHTML
function wrap(frag) {
  const d = frag.ownerDocument ? frag.ownerDocument.createElement('div')
    : new JSDOM('<!DOCTYPE html><body>').window.document.createElement('div');
  d.appendChild(frag);
  return d;
}

test('isLeafTextBlock: 纯行内内容 = 叶子', () => {
  assert.equal(M.isLeafTextBlock(el('<p>hello <b>x</b> <a href="#">y</a></p>')), true);
  assert.equal(M.isLeafTextBlock(el('<h2>标题</h2>')), true);
  assert.equal(M.isLeafTextBlock(el('<p></p>')), true);
});

test('isLeafTextBlock: 含块级子 = 非叶子', () => {
  assert.equal(M.isLeafTextBlock(el('<div><p>a</p><p>b</p></div>')), false);
  assert.equal(M.isLeafTextBlock(el('<div class="lead"><p>x</p></div>')), false); // B1/B2 透明包裹块
  assert.equal(M.isLeafTextBlock(el('<li>x<ul><li>y</li></ul></li>')), false);     // 含嵌套列表
});

test('isLeafTextBlock S1: 块的直接子是行内 <a>、但 <a> 里藏块级 = 非叶子（递归）', () => {
  // <div> 是 flow 容器、<a> 透明可含 <h2>：直接子是行内 <a>（旧版只查直接子会误判叶子），递归才发现块级
  const div = el('<div><a href="#"><h2>x</h2></a></div>');
  assert.ok(div.querySelector('a > h2'), 'precondition: a>h2 真嵌进去了（否则测的不是 S1）');
  assert.equal(M.isLeafTextBlock(div), false);
});

test('isLeafTextBlock: 跳过 data-ws2-ui 覆盖层', () => {
  assert.equal(M.isLeafTextBlock(el('<p>txt<span data-ws2-ui="">overlay</span></p>')), true);
});

test('canMerge: 两叶子可合并、含包裹块拒绝（B1/B2）', () => {
  assert.equal(M.canMerge(el('<p>a</p>'), el('<h2>b</h2>')), true);
  assert.equal(M.canMerge(el('<p>a</p>'), el('<div class="lead"><p>b</p></div>')), false);
});

// 对抗验证攻破：空结构容器 / void 块原被误判叶子
test('P1-1 空结构容器不是叶子、不可合并（防产 <ul>text</ul> 非法落盘）', () => {
  const emptyUl = el('<ul></ul>'); // §7 D1 可达中间态：嵌套子项 Enter 退出留空 ul
  assert.equal(M.isLeafTextBlock(emptyUl), false);
  assert.equal(M.canMerge(emptyUl, el('<p>x</p>')), false);
  assert.equal(M.canMerge(el('<ol></ol>'), el('<p>x</p>')), false);
  assert.equal(M.isLeafTextBlock(el('<table><tbody><tr><td>x</td></tr></tbody></table>')), false);
  assert.equal(M.isLeafTextBlock(el('<details><summary>s</summary></details>')), false);
});

test('P2-5 void 块（hr/img）不是叶子、不可合并（防静默吞文字）', () => {
  assert.equal(M.isLeafTextBlock(el('<hr>')), false);
  assert.equal(M.isLeafTextBlock(el('<img src="x">')), false);
  assert.equal(M.canMerge(el('<hr>'), el('<p>abc</p>')), false);
});

test('isLeafTextBlock fail-closed：未知/结构容器一律非叶子（正向白名单非黑名单）', () => {
  assert.equal(M.isLeafTextBlock(el('<section></section>')), false);
  assert.equal(M.isLeafTextBlock(el('<custom-widget></custom-widget>')), false);
});

test('flattenListToPhrasing A1: ul → <br> 分隔 phrasing，无 <li>', () => {
  const ul = el('<ul><li>a<b>1</b></li><li>b</li></ul>');
  const d = wrap(M.flattenListToPhrasing(ul));
  assert.equal(d.querySelector('li'), null, '不应有 <li>');
  assert.ok(/a<b>1<\/b><br>b/.test(d.innerHTML), d.innerHTML);
});

test('flattenListToPhrasing: 嵌套子列表各成一行、无 <ul>', () => {
  const ul = el('<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>');
  const d = wrap(M.flattenListToPhrasing(ul));
  assert.equal(d.querySelector('ul,ol,li'), null);
  assert.ok(/a<br>a1<br>b/.test(d.innerHTML), d.innerHTML);
});

test('wrapInlineAsLi: 块 inline 内容裹进 <li>', () => {
  const p = el('<p>hi <b>x</b></p>');
  const li = M.wrapInlineAsLi(p);
  assert.equal(li.tagName, 'LI');
  assert.ok(/hi <b>x<\/b>/.test(li.innerHTML), li.innerHTML);
});
