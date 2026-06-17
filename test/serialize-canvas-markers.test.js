const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { serializeDocument } = require('../src/editor/serialize.js');

// U15 —— Phase-1 收尾审计 + FileManager/Serializer 复用确认。
//
// FileManager/Serializer 复用（零新代码）：heyhtml 的 FileManager（open / save / Save-As）和
// Serializer（干净 HTML 输出）在 wordspace 已被现有代码满足——
//   · preload.js 暴露 window.ws2.{pickFile,readDoc,pathInfo,saveDoc,recents,recentsAdd,
//     historyList,historyRead,setDirty,onOpenFile,onMenu}
//   · src/main/{files,history,recents,ipc}.js：原子写（temp+rename）+ 20 版本历史 + recents + 路径守卫
//   · shell.js 已接 open / save（serializeDocument → ws2.saveDoc）/ history-restore
//   · heyhtml 的 WebBridge ≈ 现有 window.ws2 IPC（N/A，已覆盖）
// 故本单元无新文件 IO 代码；真正的文件 IO 属 Electron 集成（e2e / 宿主验证），非 node:test 可测。
// 本文件做的是「序列化白名单 = 所有 Phase-1 画布标记都被剥、用户内容零损伤」的最终审计。

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>').window.document;
}

test('审计：所有 Phase-1 画布标记被剥、覆盖节点删除、用户 data-ws2-* 与几何内联样式保留', () => {
  const doc = docOf(
    '<div data-ws2-canvas>' +
    '<p data-ws2-eid="3" data-ws2-editing data-ws2-ce contenteditable="true" data-ws2-sc spellcheck="false" ' +
    'data-ws2-foo="keep" style="position:absolute;left:200px;top:40px;width:120px;color:red;">x</p>' +
    '<div data-ws2-ui>选中框/手柄/对齐线覆盖节点</div>' +
    '</div>'
  );
  const out = serializeDocument(doc);

  // ① 所有编辑器标记被剥
  for (const m of ['data-ws2-canvas', 'data-ws2-eid', 'data-ws2-editing', 'data-ws2-ce', 'data-ws2-sc']) {
    assert.ok(!out.includes(m), m + ' 应被剥');
  }
  // ② 编辑器加的 contenteditable / spellcheck 被摘（带 data-ws2-ce / -sc 标记的）
  assert.ok(!out.includes('contenteditable'), 'contenteditable 应被摘');
  assert.ok(!out.includes('spellcheck'), 'spellcheck 应被摘');
  // ③ data-ws2-ui 覆盖节点整个删除
  assert.ok(!out.includes('选中框'), 'data-ws2-ui 覆盖节点应被删');
  // ④ 白名单是精确集合（非前缀）：用户自带 data-ws2-foo 必须原样保留
  assert.ok(out.includes('data-ws2-foo="keep"'), '用户自带 data-ws2-foo 必须保留');
  // ⑤ 画布几何内联样式（拖动/缩放写的 position/left/top/width）+ 用户样式保留
  assert.ok(/position:\s*absolute/.test(out), '几何 position 保留');
  assert.ok(/left:\s*200px/.test(out), '几何 left 保留');
  assert.ok(/color:\s*red/.test(out), '用户样式保留');
});

test('审计：未操作的文档零损伤（无标记时序列化与原文档结构一致）', () => {
  const SRC = '<div class="wrap"><p>一段文字</p><table><tbody><tr><td>x</td></tr></tbody></table></div>';
  const doc = docOf(SRC);
  const out = serializeDocument(doc);
  const expected = new JSDOM('<!DOCTYPE html><html><head></head><body>' + SRC + '</body></html>')
    .window.document.documentElement.outerHTML;
  const actual = new JSDOM(out).window.document.documentElement.outerHTML;
  assert.equal(actual, expected, '没有任何编辑器标记时，序列化应与原文档结构逐字一致');
});
