'use strict';
// 图片摄入纯逻辑单测（node:test）：降采样数学 / 预算边界 / 类型白名单 / canonical 构造解析双向。
// 摄入管线 ingestImage（canvas/createImageBitmap）留给 e2e（e2e/images.spec.js），此处不碰。
const { test } = require('node:test');
const assert = require('node:assert');
const II = require('../src/lib/image-ingest');

test('acceptsImageType：白名单认位图、拒 svg / 空 / 大小写不敏感', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
    assert.equal(II.acceptsImageType(t), true, t);
  }
  assert.equal(II.acceptsImageType('IMAGE/PNG'), true, '大小写不敏感');
  assert.equal(II.acceptsImageType('image/svg+xml'), false, 'svg 拒');
  assert.equal(II.acceptsImageType('image/bmp'), false, 'bmp 不在白名单');
  assert.equal(II.acceptsImageType(''), false);
  assert.equal(II.acceptsImageType(undefined), false);
});

test('planResize：长边≤上限不缩、超限等比缩到 1600、恰好 1600 不缩', () => {
  assert.deepEqual(II.planResize(800, 600), { w: 800, h: 600, scaled: false });
  assert.deepEqual(II.planResize(1600, 1000), { w: 1600, h: 1000, scaled: false }, '恰好上限不缩');
  // 横图 2400×1500 → 1600×1000
  assert.deepEqual(II.planResize(2400, 1500), { w: 1600, h: 1000, scaled: true });
  // 竖图 1500×3000 → 800×1600（长边是高）
  assert.deepEqual(II.planResize(1500, 3000), { w: 800, h: 1600, scaled: true });
  // 自定义上限
  assert.deepEqual(II.planResize(1000, 500, 500), { w: 500, h: 250, scaled: true });
  // 退化尺寸不炸、不缩
  assert.deepEqual(II.planResize(0, 0), { w: 0, h: 0, scaled: false });
  // 缩放后最小 1px（不产生 0 宽）
  const r = II.planResize(3200, 1, 1600);
  assert.equal(r.w, 1600);
  assert.equal(r.h, 1, '极扁图高钳到 1px 不为 0');
});

test('fitsBudget：逗号后长度即 base64 字节，恰好上限算过、超一字节算超', () => {
  const head = 'data:image/webp;base64,';
  const atLimit = head + 'a'.repeat(II.MAX_BASE64_BYTES);
  const overLimit = head + 'a'.repeat(II.MAX_BASE64_BYTES + 1);
  assert.equal(II.fitsBudget(atLimit), true, '恰好上限算过');
  assert.equal(II.fitsBudget(overLimit), false, '超一字节算超');
  assert.equal(II.fitsBudget('nodataurl'), false, '无逗号 = 非法 = 不过');
  assert.equal(II.fitsBudget('x,', 0), true, '空 payload、上限 0');
  assert.equal(II.fitsBudget('x,ab', 1), false, '2 字节 payload 超 1 上限');
});

test('escape / unescape：& < > " 双向且 &amp; 不被提前解', () => {
  const raw = 'a<b>&"c" \' d';
  const esc = II.escapeHtml(raw);
  assert.ok(!/[<>]/.test(esc) && esc.includes('&lt;') && esc.includes('&amp;') && esc.includes('&quot;'));
  assert.equal(II.unescapeHtml(esc), raw, 'escape∘unescape = id');
  // &amp;lt; 必须解成 &lt;（字面）而非 <
  assert.equal(II.unescapeHtml('&amp;lt;'), '&lt;');
});

test('imageBlockHtml：无说明=裸 img、有说明=figure，属性顺序 src→alt，说明 trim', () => {
  assert.equal(
    II.imageBlockHtml('data:image/webp;base64,AAA', '照片'),
    '<img src="data:image/webp;base64,AAA" alt="照片">',
  );
  assert.equal(
    II.imageBlockHtml('data:x', 'a', '  说明  '),
    '<figure><img src="data:x" alt="a"><figcaption>说明</figcaption></figure>',
    '说明两端空白 trim',
  );
  assert.equal(II.imageBlockHtml('data:x', 'a', '   '), '<img src="data:x" alt="a">', '纯空白说明=无说明');
  // alt/caption 里的危险字符被转义（不产生标签注入）
  const h = II.imageBlockHtml('data:x', '<script>', 'a"&<b>');
  assert.ok(!/<script>/.test(h), 'alt 里的 <script> 被转义');
  assert.ok(h.includes('&quot;') && h.includes('&amp;'));
});

test('parseImageBlockHtml：裸 img / figure 都解、无 img 返 null、属性顺序无关', () => {
  assert.equal(II.parseImageBlockHtml('<p>不是图</p>'), null);
  const a = II.parseImageBlockHtml('<img src="data:x" alt="猫">');
  assert.deepEqual(a, { src: 'data:x', alt: '猫', caption: '' });
  const b = II.parseImageBlockHtml('<figure><img src="data:y" alt="狗"><figcaption>一只狗</figcaption></figure>');
  assert.deepEqual(b, { src: 'data:y', alt: '狗', caption: '一只狗' });
  // 属性顺序 alt 在前也要认
  const c = II.parseImageBlockHtml('<img alt="鸟" src="data:z">');
  assert.deepEqual(c, { src: 'data:z', alt: '鸟', caption: '' });
  // figcaption 内联标签剥成纯文本
  const d = II.parseImageBlockHtml('<figure><img src="data:x" alt=""><figcaption>看 <b>这</b> 里</figcaption></figure>');
  assert.equal(d.caption, '看 这 里');
});

test('canonical 双向：parse ∘ build = id（含转义字符往返）', () => {
  const cases = [
    ['data:image/webp;base64,ZZZ', '', ''],
    ['data:x', '普通 alt', ''],
    ['data:x', 'a<b&"c" \' 引号', '带 <标签> & "引号" 的说明'],
    ['../notes/图 2.html', '相对路径图', ''],
  ];
  for (const [src, alt, cap] of cases) {
    const html = II.imageBlockHtml(src, alt, cap);
    const p = II.parseImageBlockHtml(html);
    assert.equal(p.src, src, 'src 往返: ' + src);
    assert.equal(p.alt, alt, 'alt 往返: ' + alt);
    assert.equal(p.caption, String(cap).trim(), 'caption 往返: ' + cap);
  }
});

test('pickImageFiles：从 files 列表按白名单过滤，非图剔除', () => {
  const mk = (type) => ({ type: type });
  const list = { files: [mk('image/png'), mk('application/pdf'), mk('image/svg+xml'), mk('image/jpeg')] };
  const out = II.pickImageFiles(list);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((f) => f.type), ['image/png', 'image/jpeg']);
  assert.deepEqual(II.pickImageFiles(null), []);
  assert.deepEqual(II.pickImageFiles({}), []);
});
