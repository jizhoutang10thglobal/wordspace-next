// 网页右键菜单纯逻辑 builder 单测（U1）。
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../src/lib/web-context-menu');

const ids = (tpl) => tpl.filter((i) => i.type !== 'separator').map((i) => i.id);
const byId = (tpl, id) => tpl.find((i) => i.id === id);

// 分隔符不变式：无前导/尾随/连续分隔符。
function sepInvariantOk(tpl) {
  if (!tpl.length) return true;
  if (tpl[0].type === 'separator' || tpl[tpl.length - 1].type === 'separator') return false;
  for (let i = 1; i < tpl.length; i++) if (tpl[i].type === 'separator' && tpl[i - 1].type === 'separator') return false;
  return true;
}

test('空 params（网页空白处右键）→ 只有导航节 + 页面节，顺序正确、恰一条分隔符', () => {
  const tpl = M.buildCtxTemplate({}, { pageUrl: 'https://x.com/' });
  assert.deepStrictEqual(ids(tpl), ['nav-back', 'nav-forward', 'reload', 'copy-page-url', 'clip-page', 'export-pdf']);
  assert.strictEqual(tpl.filter((i) => i.type === 'separator').length, 1);
  assert.ok(sepInvariantOk(tpl));
});

test('http 链接 → 链接节三条在最前；危险 scheme 链接整节消失', () => {
  const tpl = M.buildCtxTemplate({ linkURL: 'https://a.com/p?utm_source=x&id=1' }, {});
  assert.deepStrictEqual(ids(tpl).slice(0, 3), ['open-link', 'open-link-bg', 'copy-link']);
  assert.strictEqual(byId(tpl, 'copy-link').args.url, 'https://a.com/p?utm_source=x&id=1');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'about:blank']) {
    const t = M.buildCtxTemplate({ linkURL: bad }, {});
    assert.strictEqual(byId(t, 'open-link'), undefined, bad);
    assert.strictEqual(byId(t, 'copy-link'), undefined, bad);
  }
});

test('注入 isAllowedUrl 过滤器：返回 false 时 http 链接节也消失（证明是注入判定，不是硬编码）', () => {
  const tpl = M.buildCtxTemplate({ linkURL: 'https://a.com/' }, { isAllowedUrl: () => false });
  assert.strictEqual(byId(tpl, 'open-link'), undefined);
});

test('图片：http srcURL 三条全出；data: srcURL 只留「拷贝图片」', () => {
  const http = M.buildCtxTemplate({ mediaType: 'image', srcURL: 'https://a.com/pic.png', x: 10, y: 20 }, {});
  assert.deepStrictEqual(ids(http).filter((i) => i.startsWith('copy-image') || i === 'save-image'), ['copy-image', 'copy-image-url', 'save-image']);
  assert.deepStrictEqual(byId(http, 'copy-image').args, { x: 10, y: 20 });
  const data = M.buildCtxTemplate({ mediaType: 'image', srcURL: 'data:image/png;base64,AAAA', x: 1, y: 2 }, {});
  assert.ok(byId(data, 'copy-image'));
  assert.strictEqual(byId(data, 'copy-image-url'), undefined);
  assert.strictEqual(byId(data, 'save-image'), undefined);
});

test('选中文字 → 拷贝 + 搜索；label 截断：21 字补 …，20 字不截；原文进 args', () => {
  const short = M.buildCtxTemplate({ selectionText: 'a'.repeat(20) }, {});
  assert.deepStrictEqual(ids(short).filter((i) => i.indexOf('selection') !== -1), ['copy-selection', 'search-selection']);
  assert.ok(!byId(short, 'search-selection').label.includes('…'));
  assert.ok(byId(short, 'search-selection').label.includes('a'.repeat(20)));
  const long = M.buildCtxTemplate({ selectionText: 'a'.repeat(21) }, {});
  assert.ok(byId(long, 'search-selection').label.includes('…'));
  assert.ok(!byId(long, 'search-selection').label.includes('a'.repeat(21)));
  assert.strictEqual(byId(long, 'search-selection').args.text, 'a'.repeat(21)); // 搜索用原文，不用截断的
  assert.strictEqual(byId(long, 'copy-selection').args.text, 'a'.repeat(21));
});

test('truncForLabel：折叠空白', () => {
  assert.strictEqual(M.truncForLabel('  hello\n\tworld  '), 'hello world');
  assert.strictEqual(M.truncForLabel(''), '');
});

test('isEditable → 剪切/拷贝/粘贴/全选四条', () => {
  const tpl = M.buildCtxTemplate({ isEditable: true }, {});
  assert.deepStrictEqual(ids(tpl).slice(0, 4), ['cut', 'copy', 'paste', 'select-all']);
});

test('导航节 enabled 随 canGoBack/canGoForward', () => {
  const t1 = M.buildCtxTemplate({}, { canGoBack: false, canGoForward: true });
  assert.strictEqual(byId(t1, 'nav-back').enabled, false);
  assert.strictEqual(byId(t1, 'nav-forward').enabled, true);
  const t2 = M.buildCtxTemplate({}, { canGoBack: true, canGoForward: false });
  assert.strictEqual(byId(t2, 'nav-back').enabled, true);
  assert.strictEqual(byId(t2, 'nav-forward').enabled, false);
});

test('组合（链接 + 选中）→ 两节都出、分隔符不变式成立', () => {
  const tpl = M.buildCtxTemplate({ linkURL: 'https://a.com/', selectionText: 'hi' }, { pageUrl: 'https://a.com/' });
  assert.ok(byId(tpl, 'open-link'));
  assert.ok(byId(tpl, 'copy-selection'));
  assert.ok(sepInvariantOk(tpl));
  // 链接节在选中节之前
  assert.ok(ids(tpl).indexOf('open-link') < ids(tpl).indexOf('copy-selection'));
});

test('全六节同时出现 → 完整顺序 + 5 条分隔符 + 不变式 + 非导航项不被禁用', () => {
  const tpl = M.buildCtxTemplate(
    { linkURL: 'https://a.com/', mediaType: 'image', srcURL: 'https://a.com/p.png', selectionText: 'hi', isEditable: true, x: 5, y: 6 },
    { canGoBack: true, canGoForward: true, pageUrl: 'https://a.com/' },
  );
  assert.deepStrictEqual(ids(tpl), [
    'open-link', 'open-link-bg', 'copy-link',
    'copy-image', 'copy-image-url', 'save-image',
    'copy-selection', 'search-selection',
    'cut', 'copy', 'paste', 'select-all',
    'nav-back', 'nav-forward', 'reload',
    'copy-page-url', 'clip-page', 'export-pdf',
  ]);
  assert.strictEqual(tpl.filter((i) => i.type === 'separator').length, 5);
  assert.ok(sepInvariantOk(tpl));
  // 非导航项必须不带 enabled:false（映射层是 enabled!==false 才可点；防误加 enabled:false 让条目变灰失效）
  for (const id of ['reload', 'copy-page-url', 'clip-page', 'export-pdf', 'open-link', 'copy-image', 'copy-selection', 'cut']) {
    assert.notStrictEqual(byId(tpl, id).enabled, false, id + ' 不该被禁用');
  }
});

test('truncForLabel：按码点截断，不切断 emoji（surrogate pair 完整）', () => {
  const s = 'a' + '😀'.repeat(30);
  const out = M.truncForLabel(s);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out.replace(/…$/, ''))); // 结尾(去省略号)不留孤立高位代理
  assert.ok(out.endsWith('…'));
});

test('变异自检：不同 params 产出的 template 必不相等（防恒返回同一菜单的哑实现）', () => {
  const a = M.buildCtxTemplate({}, {});
  const b = M.buildCtxTemplate({ linkURL: 'https://a.com/' }, {});
  const c = M.buildCtxTemplate({ isEditable: true }, {});
  assert.notDeepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.notDeepStrictEqual(b, c);
});
