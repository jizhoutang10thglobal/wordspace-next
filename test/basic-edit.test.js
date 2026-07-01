// F3-U3 纯逻辑单测：collectBlocks（DOM 结构，jsdom 可测）+ nearestInDir（评分逻辑，注入 getRect 避开 jsdom 无布局）。
// 空间导航的真实几何 + 两模式交互走 e2e（U5）。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { collectBlocks, nearestInDir, serialize } = require('../src/editor/basic-edit.js');

const bodyOf = (html) => new JSDOM('<!doctype html><html><body>' + html + '</body></html>').window.document.body;
const tags = (arr) => arr.map((e) => e.tagName);

// ---- collectBlocks ----
test('collectBlocks：顶层文字块各成块', () => {
  assert.deepEqual(tags(collectBlocks(bodyOf('<h1>a</h1><p>b</p>'))), ['H1', 'P']);
});

test('collectBlocks：img/table/ul/svg 当原子块，其后代不再单独成块', () => {
  const b = collectBlocks(bodyOf('<img src=x><table><tbody><tr><td>c</td></tr></tbody></table><ul><li>x</li></ul>'));
  const t = tags(b);
  assert.ok(t.includes('IMG') && t.includes('TABLE') && t.includes('UL'));
  assert.ok(!t.includes('TD') && !t.includes('LI'), 'td/li 不该单独成块');
});

test('collectBlocks：父有直接文字 → 子不重复成块（取最外层承载文字的）', () => {
  // div 有直接文字 "text"，其内 span 也有文字 → 只取 div
  assert.deepEqual(tags(collectBlocks(bodyOf('<div>text<span>x</span></div>'))), ['DIV']);
});

test('collectBlocks：纯包裹容器（无直接文字）穿透到最内层文字块', () => {
  // section/article 无直接文字 → 落到 p
  assert.deepEqual(tags(collectBlocks(bodyOf('<section><article><p>x</p></article></section>'))), ['P']);
});

test('collectBlocks：整篇文字挂单个大 div → 就一个块（= 破坏性删除风险点，U3 兜底 + U5 验）', () => {
  const b = collectBlocks(bodyOf('<div>全部正文都在这里，没有别的结构</div>'));
  assert.deepEqual(tags(b), ['DIV']);
});

// ---- nearestInDir（注入 getRect，测评分逻辑；plain object 当"块"）----
const R = (top, left, w, h) => ({ top, left, width: w, height: h });
const rectOf = (o) => o.rect;

test('nearestInDir：right 选视觉右侧最近块，不选下方块', () => {
  const cur = { id: 'cur', rect: R(0, 0, 100, 20) };
  const right = { id: 'right', rect: R(0, 200, 100, 20) };
  const below = { id: 'below', rect: R(200, 0, 100, 20) };
  assert.equal(nearestInDir(cur, 'right', [cur, right, below], rectOf).id, 'right');
});

test('nearestInDir：左右分栏 → 从左栏 right 到右栏（视觉对，不靠 DOM 顺序）', () => {
  const leftCol = { id: 'L', rect: R(0, 0, 200, 400) };
  const rightCol = { id: 'Rc', rect: R(0, 240, 200, 400) };
  assert.equal(nearestInDir(leftCol, 'right', [leftCol, rightCol], rectOf).id, 'Rc');
  assert.equal(nearestInDir(rightCol, 'left', [leftCol, rightCol], rectOf).id, 'L');
});

test('nearestInDir：该方向没有块 → null', () => {
  const cur = { id: 'cur', rect: R(0, 0, 100, 20) };
  const up = { id: 'up', rect: R(-200, 0, 100, 20) };
  assert.equal(nearestInDir(cur, 'down', [cur, up], rectOf), null);
});

test('nearestInDir：侧向偏移惩罚（cross*2）→ 正下方优于斜下方', () => {
  const cur = { id: 'cur', rect: R(0, 0, 100, 20) };
  const straight = { id: 'straight', rect: R(100, 0, 100, 20) };   // 正下
  const diagonal = { id: 'diag', rect: R(80, 150, 100, 20) };      // 稍近但偏很多
  assert.equal(nearestInDir(cur, 'down', [cur, straight, diagonal], rectOf).id, 'straight');
});

// ---- serialize：剥除契约 + 结构级保真 + 二次保存幂等（U4，KD-c/KD-d）----
const fullDoc = (html) => new JSDOM(html).window.document;
// 模拟 attach 往 body 打的编辑态属性
function markEditing(doc) {
  doc.body.setAttribute('contenteditable', 'true');
  doc.body.setAttribute('data-ws2-basic-ce', '');
  doc.body.setAttribute('spellcheck', 'true');
  return doc;
}

test('serialize：剥掉 body 的 contenteditable / 编辑标记 / spellcheck（剥除契约）', () => {
  const out = serialize(markEditing(fullDoc('<!doctype html><html><body><p>x</p></body></html>')));
  assert.ok(!/contenteditable/i.test(out), '没剥 contenteditable');
  assert.ok(!/data-ws2-basic-ce/i.test(out), '没剥编辑标记');
  assert.ok(!/spellcheck/i.test(out), '没剥 spellcheck');
});

test('serialize：body 原本无这些属性 → 序列化结果也没有（零编辑不留痕）', () => {
  const doc = markEditing(fullDoc('<!doctype html><html><body><p>x</p></body></html>'));
  const bodyTag = serialize(doc).match(/<body[^>]*>/i)[0];
  assert.equal(bodyTag, '<body>', 'body 上多了编辑态属性: ' + bodyTag);
});

test('serialize：保原 doctype', () => {
  assert.ok(/^<!DOCTYPE html>/i.test(serialize(fullDoc('<!doctype html><html><body><p>x</p></body></html>'))));
});

test('serialize：未触及元素的内联 style/定位/class 逐字保留（结构级保真红线）', () => {
  const doc = markEditing(fullDoc('<!doctype html><html><body><div style="position:absolute;top:5px;color:red" class="card">x</div></body></html>'));
  const div = new JSDOM(serialize(doc)).window.document.querySelector('.card');
  assert.equal(div.getAttribute('style'), 'position:absolute;top:5px;color:red');
  assert.equal(div.getAttribute('class'), 'card');
});

test('serialize：二次保存幂等（首存规范化后 save→reparse→save 稳定，不再漂）', () => {
  // 野生写法（大写标签/无引号/自闭 br）首存会被规范化一次
  const once = serialize(markEditing(fullDoc('<!doctype html><html><body><DIV class=card>Hi<BR>there</DIV></body></html>')));
  const twice = serialize(fullDoc(once));
  assert.equal(twice, once, '二次保存不幂等（还在漂）');
});
