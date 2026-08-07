// A1·U1：iblockOf（交互块解析）纯函数单测（plan 2026-08-07-002）。
// 口径：交互块 = 列表内最深所属 li / 多段容器内直接子 p / 其余 = 存储块；
// 爬升语义与 blockOf 对齐（details 作用域、summary→details、data-ws2-ui→null）。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const be = require('../src/editor/blockedit.js');

function bodyOf(html) {
  return new JSDOM('<!DOCTYPE html><html><body>' + html + '</body></html>').window.document.body;
}
const q = (root, sel) => root.querySelector(sel);

test('iblockOf: 段落/标题 → 块自身（与存储块一致）', () => {
  const b = bodyOf('<p id="p1">正文</p><h2 id="h1">标题</h2>');
  assert.equal(be.iblockOf(b, q(b, '#p1').firstChild), q(b, '#p1')); // 文本节点入口
  assert.equal(be.iblockOf(b, q(b, '#h1')), q(b, '#h1'));
});

test('iblockOf: 列表 → 最深所属 li（顶层行/嵌套行）', () => {
  const b = bodyOf('<ul id="l"><li id="r1">一</li><li id="r2">二<ul><li id="n1">嵌套</li></ul></li></ul>');
  assert.equal(be.iblockOf(b, q(b, '#r1').firstChild), q(b, '#r1'));
  assert.equal(be.iblockOf(b, q(b, '#n1').firstChild), q(b, '#n1')); // 最深，不是宿主 r2
  assert.equal(be.iblockOf(b, q(b, '#r2').firstChild), q(b, '#r2')); // 宿主行自己的文字 → 宿主行
});

test('iblockOf: 事件落在 ul 自身（行间缝隙）→ 整列表兜底', () => {
  const b = bodyOf('<ul id="l"><li>一</li></ul>');
  assert.equal(be.iblockOf(b, q(b, '#l')), q(b, '#l'));
});

test('iblockOf: 行内格式内的文字仍归其行（li 内 b/span 不挡下钻）', () => {
  const b = bodyOf('<ul><li id="r1">前<b id="bb">粗</b>后</li></ul>');
  assert.equal(be.iblockOf(b, q(b, '#bb').firstChild), q(b, '#r1'));
});

test('iblockOf: 引用/callout → 直接子 p（含首段；裸行内区 → 整框兜底）', () => {
  const b = bodyOf('<blockquote id="qt"><p id="q1">第一段</p><p id="q2">第二段</p></blockquote>'
    + '<div class="ws-callout" id="co"><p id="c1">提示<b id="cb">粗</b></p></div>'
    + '<blockquote id="bare">裸行内文字</blockquote>');
  assert.equal(be.iblockOf(b, q(b, '#q1').firstChild), q(b, '#q1')); // 首段也是段（paraOf 的首段=容器域是悬停专属语义）
  assert.equal(be.iblockOf(b, q(b, '#q2').firstChild), q(b, '#q2'));
  assert.equal(be.iblockOf(b, q(b, '#cb').firstChild), q(b, '#c1')); // 行内格式不挡
  assert.equal(be.iblockOf(b, q(b, '#bare').firstChild), q(b, '#bare')); // 裸行内区 → 整框
});

test('iblockOf: toggle 作用域——体内块停在 details 层级、summary 归 details（与 blockOf 一致）', () => {
  const b = bodyOf('<details id="dt"><summary id="sm">头</summary><p id="dp">体段</p><ul><li id="dr">体行</li></ul></details>');
  assert.equal(be.iblockOf(b, q(b, '#dp').firstChild), q(b, '#dp'));
  assert.equal(be.iblockOf(b, q(b, '#sm').firstChild), q(b, '#dt')); // summary → 归属 details
  assert.equal(be.iblockOf(b, q(b, '#dr').firstChild), q(b, '#dr')); // toggle 体内列表也下钻到行
});

test('iblockOf: data-ws2-ui 覆盖层 → null；块外/blockRoot 自身 → null', () => {
  const b = bodyOf('<p id="p1">x</p><div data-ws2-ui id="ov"><span id="os">ui</span></div>');
  assert.equal(be.iblockOf(b, q(b, '#os')), null);
  assert.equal(be.iblockOf(b, b), null);
  assert.equal(be.iblockOf(b, null), null);
});

test('iblockOf: hr/img 整块自身（不可编辑块无行概念）', () => {
  const b = bodyOf('<hr id="d1"><img id="i1">');
  assert.equal(be.iblockOf(b, q(b, '#d1')), q(b, '#d1'));
  assert.equal(be.iblockOf(b, q(b, '#i1')), q(b, '#i1'));
});

test('setRowBlock/rowBlockOn: 默认开（U5a 转正）、可翻回旧路径（真机验收期的回滚阀）', () => {
  // U1 时默认关；U5a（2026-08-08）转正后默认开——本测曾因只改默认没改断言在 CI 上红过一次，
  // 断言必须跟默认值同一次 commit 动。拆开关（验收后）时本测整条删除。
  assert.equal(be.rowBlockOn(), true); // 默认开 = 消费链走 iblockOf 新路径
  be.setRowBlock(false);
  assert.equal(be.rowBlockOn(), false); // 回滚阀可用
  be.setRowBlock(true);
  assert.equal(be.rowBlockOn(), true);
});
