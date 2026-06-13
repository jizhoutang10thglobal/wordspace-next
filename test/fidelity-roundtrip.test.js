// 保真往返硬测（交付头号风险）：applyEditable → serialize 后，文档结构必须回到原样，
// 脚本/样式/注释逐字保留，无编辑器残留。覆盖老板真实文档形态 + 对抗输入。
// 纯逻辑层（jsdom）；真实 Chromium 行为另由 e2e/fidelity.spec.js 兜。
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const blocks = require('../src/editor/blocks.js');
const { serializeDocument } = require('../src/editor/serialize.js');

function roundtrip(input) {
  const dom = new JSDOM(input);
  blocks.applyEditable(dom.window.document);
  return serializeDocument(dom.window.document);
}
function structOf(html) {
  return new JSDOM(html).window.document.documentElement.outerHTML;
}

const CASES = [
  { name: '注释（body 内）', html: '<!DOCTYPE html><html><head></head><body><!-- 重要注释 --><p>x</p></body></html>',
    contains: ['<!-- 重要注释 -->'] },
  { name: '脚本逐字保留', html: '<!DOCTYPE html><html><head></head><body><p>x</p><script>var a = 1 < 2 && 3;</' + 'script></body></html>',
    contains: ['var a = 1 < 2 && 3;'] },
  { name: 'head 内 style 逐字保留', html: '<!DOCTYPE html><html><head><style>.c { color: red; background: #f6f6f3; }</style></head><body><p>x</p></body></html>',
    contains: ['.c { color: red; background: #f6f6f3; }'] },
  { name: '嵌套容器 div + 表格（锁定）', html: '<!DOCTYPE html><html><head></head><body><div class="wrap"><p>正文</p><table><tbody><tr><td>格</td></tr></tbody></table></div></body></html>' },
  { name: '自定义色块 div（inline style）', html: '<!DOCTYPE html><html><head></head><body><div class="callout" style="background:#f6f6f3;padding:8px"><p>提示</p></div></body></html>' },
  { name: '文档自带 contenteditable（应保留）', html: '<!DOCTYPE html><html><head></head><body><div contenteditable="true">自带</div><p>x</p></body></html>',
    contains: ['contenteditable="true"'] },
  { name: '合法 data-* 属性不被剥', html: '<!DOCTYPE html><html><head></head><body><p data-foo="bar" data-track="1">x</p></body></html>',
    contains: ['data-foo="bar"', 'data-track="1"'] },
  { name: 'HTML 实体', html: '<!DOCTYPE html><html><head></head><body><p>A &amp; B &lt; C &copy; D</p></body></html>' },
  { name: 'void 元素 br/hr/img', html: '<!DOCTYPE html><html><head></head><body><p>a<br>b</p><hr><img src="x.png" alt="图"></body></html>' },
  { name: '表格 thead/tbody/colspan', html: '<!DOCTYPE html><html><head></head><body><table><thead><tr><th colspan="2">头</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></body></html>' },
  { name: 'pre 空白敏感', html: '<!DOCTYPE html><html><head></head><body><pre>  缩进\n    更深\n</pre></body></html>' },
  { name: '中文 + 列表', html: '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><h1>价值观</h1><ul><li>诚信</li><li>务实</li></ul></body></html>' },
  { name: '文档自带 data-ws2* 属性（含连字符变体，都不应被误剥）', html: '<!DOCTYPE html><html><head></head><body><div data-ws2custom="keep" data-ws2x="y" data-ws2-provider="google" data-ws2-index="3"><p>x</p></div></body></html>',
    contains: ['data-ws2custom="keep"', 'data-ws2x="y"', 'data-ws2-provider="google"', 'data-ws2-index="3"'] },
];

for (const c of CASES) {
  test('保真往返：' + c.name, () => {
    const out = roundtrip(c.html);
    // 1) 结构回到原样（jsdom 规范化两边，只比语义结构，不计空白/引号）
    assert.equal(structOf(out), structOf(c.html), '结构被改变');
    // 2) 无编辑器标记残留（精确检查编辑器自己的标记，不误伤文档自带的 data-ws2-* 用户属性）
    for (const m of ['data-ws2-block=', 'data-ws2-container=', 'data-ws2-ui=', 'data-ws2-ce=', 'data-ws2-sc=']) {
      assert.ok(!out.includes(m), '残留编辑器标记 ' + m);
    }
    // 3) 指定子串逐字保留
    for (const sub of (c.contains || [])) {
      assert.ok(out.includes(sub), '丢失/改写了：' + sub);
    }
  });
}

test('保真往返：doctype legacy publicId/systemId 保留', () => {
  const input = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "x.dtd"><html><head></head><body><p>x</p></body></html>';
  const out = roundtrip(input);
  assert.ok(out.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "x.dtd">'), 'doctype 丢信息：' + out.slice(0, 80));
});
