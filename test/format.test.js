const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const format = require('../src/editor/format.js');

function docOf(bodyHtml) {
  return new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>').window.document;
}

test('blockFromNode: 文字节点往上找到带 data-ws2-block 的块', () => {
  const doc = docOf('<p data-ws2-block="text">hello</p>');
  const p = doc.querySelector('p');
  const textNode = p.firstChild;
  assert.equal(format.blockFromNode(textNode, doc.body), p);
});

test('blockFromNode: 容器内的块也能找到它自己（不返回容器）', () => {
  const doc = docOf('<div data-ws2-container><p data-ws2-block="text">x</p></div>');
  const p = doc.querySelector('p');
  assert.equal(format.blockFromNode(p.firstChild, doc.body), p);
});

test('blockFromNode: 没有块祖先返回 null', () => {
  const doc = docOf('<span>裸文字</span>');
  assert.equal(format.blockFromNode(doc.querySelector('span').firstChild, doc.body), null);
});

test('anchorFromNode: 光标在链接内返回该 <a>', () => {
  const doc = docOf('<p data-ws2-block="text">看 <a href="https://x.com">这里</a> 啊</p>');
  const a = doc.querySelector('a');
  assert.equal(format.anchorFromNode(a.firstChild, doc.body), a);
});

test('anchorFromNode: 不在链接内返回 null', () => {
  const doc = docOf('<p data-ws2-block="text">没有链接</p>');
  assert.equal(format.anchorFromNode(doc.querySelector('p').firstChild, doc.body), null);
});

test('duplicateBlock: 克隆并插到原块之后，深拷贝内容', () => {
  const doc = docOf('<p data-ws2-block="text" id="a">原文 <b>粗</b></p><p id="b">下一段</p>');
  const a = doc.getElementById('a');
  const clone = format.duplicateBlock(a);
  assert.equal(a.nextElementSibling, clone);
  assert.equal(clone.querySelector('b').textContent, '粗');
  assert.equal(clone.nextElementSibling.id, 'b');
  // 块总数从 2 变 3
  assert.equal(doc.querySelectorAll('p').length, 3);
});

test('duplicateBlock: 无父元素时安全返回 null', () => {
  const doc = docOf('');
  const orphan = doc.createElement('p');
  assert.equal(format.duplicateBlock(orphan), null);
});

test('moveBlock: 下移与上移换位', () => {
  const doc = docOf('<p id="a">A</p><p id="b">B</p><p id="c">C</p>');
  const b = doc.getElementById('b');
  assert.equal(format.moveBlock(b, 1), true); // b 下移到 c 之后
  let ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'c', 'b']);
  assert.equal(format.moveBlock(b, -1), true); // b 上移回 c 之前
  ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('moveBlock: 到边界不动并返回 false', () => {
  const doc = docOf('<p id="a">A</p><p id="b">B</p>');
  assert.equal(format.moveBlock(doc.getElementById('a'), -1), false); // 已是第一个
  assert.equal(format.moveBlock(doc.getElementById('b'), 1), false);  // 已是最后一个
  const ids = [...doc.querySelectorAll('p')].map(e => e.id);
  assert.deepEqual(ids, ['a', 'b']);
});

test('wrapInlineStyle: 把选中文字包进带行内样式的 span', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text">abcdef</p></body></html>');
  const doc = dom.window.document;
  const textNode = doc.querySelector('p').firstChild;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(textNode, 1);
  range.setEnd(textNode, 4); // 选中 "bcd"
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = format.wrapInlineStyle(doc, 'fontSize', '20px');
  assert.equal(ok, true);
  const span = doc.querySelector('p span');
  assert.ok(span, '应生成 span');
  assert.equal(span.style.fontSize, '20px');
  assert.equal(span.textContent, 'bcd');
  assert.equal(doc.querySelector('p').textContent, 'abcdef'); // 文字总量不变
});

test('wrapInlineStyle: 折叠选区不动、返回 false', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text">abc</p></body></html>');
  const doc = dom.window.document;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(doc.querySelector('p').firstChild, 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  assert.equal(format.wrapInlineStyle(doc, 'fontSize', '20px'), false);
  assert.equal(doc.querySelector('span'), null);
});

test('wrapInlineStyle: 跨块选区拒绝（不动文档、返回 false，保真红线）', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p data-ws2-block="text" id="p1">abc</p><p data-ws2-block="text" id="p2">def</p></body></html>');
  const doc = dom.window.document;
  const sel = dom.window.getSelection();
  const range = doc.createRange();
  range.setStart(doc.getElementById('p1').firstChild, 1);
  range.setEnd(doc.getElementById('p2').firstChild, 2); // 选区横跨 p1→p2
  sel.removeAllRanges();
  sel.addRange(range);
  const before = doc.body.innerHTML;
  assert.equal(format.wrapInlineStyle(doc, 'fontSize', '24px'), false);
  assert.equal(doc.querySelector('span'), null);   // 没生成 span
  assert.equal(doc.body.innerHTML, before);          // 文档一字未动（不破坏保真）
});

test('duplicateBlock: 剥掉克隆体及后代的 id（不产生重复 id）', () => {
  const doc = docOf('<section data-ws2-block="container" id="sec"><h2 id="h">标题</h2><p id="p">正文</p></section>');
  const clone = format.duplicateBlock(doc.getElementById('sec'));
  assert.equal(clone.id, '');                              // 克隆根无 id
  assert.equal(clone.querySelectorAll('[id]').length, 0);  // 后代也无 id
  assert.equal(clone.querySelector('h2').textContent, '标题'); // 内容仍在
  assert.equal(doc.querySelectorAll('#sec').length, 1);    // 原 id 没被复制成重复
  assert.equal(doc.querySelectorAll('[id]').length, 3);    // 全文 id 仍是原来那 3 个
});

test('isTextEditable: 白名单标签恒真', () => {
  const doc = docOf('<p>x</p><a href="#">y</a>');
  assert.equal(format.isTextEditable(doc.querySelector('p')), true);
  assert.equal(format.isTextEditable(doc.querySelector('a')), true);
});

test('isTextEditable: IMG/HR / 只含结构的 div 为假；直接含文字的 div 为真', () => {
  const doc = docOf('<img src="x"><hr><div><table></table></div><div>raw</div>');
  assert.equal(format.isTextEditable(doc.querySelector('img')), false);
  assert.equal(format.isTextEditable(doc.querySelector('hr')), false);
  assert.equal(format.isTextEditable(doc.querySelector('div:nth-of-type(1)')), false); // 只含 <table>
  assert.equal(format.isTextEditable(doc.querySelector('div:nth-of-type(2)')), true);  // 直接含文字
});

test('isTextEditable: 非元素 / null 为假', () => {
  const doc = docOf('<p>x</p>');
  assert.equal(format.isTextEditable(doc.querySelector('p').firstChild), false); // 文本节点
  assert.equal(format.isTextEditable(null), false);
});

test('anchorWithin: 选中含链接的 p 返回内部 a；选中 a 返回自身；无链接返回 null', () => {
  const doc = docOf('<p data-ws2-block="text">看 <a href="https://x.com">这里</a> 啊</p><p>无链接</p>');
  const ps = doc.querySelectorAll('p');
  const a = doc.querySelector('a');
  assert.equal(format.anchorWithin(ps[0]), a);  // p 内的 a
  assert.equal(format.anchorWithin(a), a);       // a 自身
  assert.equal(format.anchorWithin(ps[1]), null); // 无链接
});

test('applyBlockStyle: 设样式并返回 before/after delta', () => {
  const doc = docOf('<p>x</p>');
  const p = doc.querySelector('p');
  const d1 = format.applyBlockStyle(p, 'fontSize', '24px');
  assert.deepEqual(d1, { prop: 'fontSize', before: '', after: '24px' });
  assert.equal(p.style.fontSize, '24px');
  const d2 = format.applyBlockStyle(p, 'fontSize', '12px'); // 二次改：before 是上次的值
  assert.deepEqual(d2, { prop: 'fontSize', before: '24px', after: '12px' });
});

test('retagElement: 换标签保留 id/class/style 与全部子节点', () => {
  const doc = docOf('<p id="t" class="lead" style="color: red;">原文 <b>粗</b></p>');
  const p = doc.querySelector('p');
  const next = format.retagElement(p, 'h2');
  assert.equal(next.tagName, 'H2');
  assert.equal(next.id, 't');
  assert.equal(next.className, 'lead');
  assert.equal(next.style.color, 'red');
  assert.equal(next.querySelector('b').textContent, '粗'); // 子节点搬过来了
  assert.equal(doc.querySelectorAll('p').length, 0);        // 旧 <p> 已被替换
  assert.equal(doc.querySelectorAll('h2').length, 1);
});

test('retagElement: 保留用户全部属性（title/lang/dir/data-*/role/aria-*），不只 id/class/style', () => {
  const doc = docOf('<p id="t" class="c" style="color: red;" title="hi" lang="en" dir="rtl" data-foo="bar" role="note" aria-label="x">内容</p>');
  const next = format.retagElement(doc.querySelector('p'), 'h2');
  assert.equal(next.tagName, 'H2');
  assert.equal(next.id, 't');
  assert.equal(next.className, 'c');
  assert.equal(next.style.color, 'red');
  assert.equal(next.getAttribute('title'), 'hi');
  assert.equal(next.getAttribute('lang'), 'en');
  assert.equal(next.getAttribute('dir'), 'rtl');
  assert.equal(next.getAttribute('data-foo'), 'bar');
  assert.equal(next.getAttribute('role'), 'note');
  assert.equal(next.getAttribute('aria-label'), 'x');
});

test('retagElement: 无父元素时原样返回（no-op safe）', () => {
  const doc = docOf('');
  const orphan = doc.createElement('p');
  orphan.textContent = 'x';
  assert.equal(format.retagElement(orphan, 'h2'), orphan); // 返回 el 本身、不变标签
  assert.equal(orphan.tagName, 'P');
});

test('safeHref: 放行 http/https/mailto/tel + 相对/锚点；拒绝 javascript/data/vbscript（含绕过）', () => {
  assert.equal(format.safeHref('https://wordspace.ai'), 'https://wordspace.ai');
  assert.equal(format.safeHref('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(format.safeHref('tel:123'), 'tel:123');
  assert.equal(format.safeHref('/rel/x.html'), '/rel/x.html');
  assert.equal(format.safeHref('#sec'), '#sec');
  assert.equal(format.safeHref('./a.css'), './a.css');
  assert.equal(format.safeHref(''), '');
  assert.equal(format.safeHref('   '), '');
  assert.equal(format.safeHref('javascript:alert(1)'), null);
  assert.equal(format.safeHref('JaVaScript:alert(1)'), null);  // 大小写绕过
  assert.equal(format.safeHref('java\tscript:alert(1)'), null); // 控制字符绕过
  assert.equal(format.safeHref('data:text/html,x'), null);
  assert.equal(format.safeHref('vbscript:msgbox'), null);
});

// 回归守卫：nearestBlock 必须导出在 WS2Format 上——slashmenu 的 caretBlock 调 fmt.nearestBlock，
// 没导出时它恒抛错（slash 转换全废），而 bridge 单测直接传 block、走不到 caretBlock 故测不出。
test('nearestBlock 已导出且按标签找最近块级祖先', () => {
  assert.equal(typeof format.nearestBlock, 'function', 'nearestBlock 必须导出在 WS2Format');
  const doc = docOf('<div class="wrap"><p id="p"><span id="s">x</span></p></div>');
  const span = doc.getElementById('s');
  assert.equal(format.nearestBlock(span.firstChild, doc.body), doc.getElementById('p'));
  assert.equal(format.nearestBlock(doc.body, doc.body), null); // body 自身无块级祖先
});
