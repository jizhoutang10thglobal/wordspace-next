// 内部富复制粘贴真门（Wendi bug5①，Colin 2026-07-22 拍板）：本编辑器内部复制 → 保留块/行内格式；
// 外部来源(无哨兵) → 仍走纯文本(ED-A4 合规红线不破)。
// 驱动用**合成 copy/paste 事件 + DataTransfer**(不赌 OS 剪贴板/xvfb，确定性、CI 稳)——真 ⌘C/⌘V 端到端
// 已在宿主 probe 验过一致。合成 copy 让 onCopy 写哨兵 HTML，合成 paste 让 onPaste 读它，驱动的是真 handler。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-richpaste-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
});
test.afterAll(async () => {
  try { if (app) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())); } catch {}
  try { if (app) await app.close(); } catch {}
  try { if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
});

async function openDoc(bodyHtml, name) {
  const dst = path.join(tmpDir, (name || 'd') + '.html');
  await fs.writeFile(dst, '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>' + bodyHtml + '</body></html>', 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, dst);
  frame = page.frameLocator('#doc-frame');
  await frame.locator('body :is(p,h1,h2,ul,li)').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(1600);
  return dst;
}
// 设选区(起止块选择器 + 是否 selectNodeContents)后合成 copy → 返回 onCopy 写进剪贴板的 {html,text}
const synCopy = (setup) => frame.locator('body').evaluate((body, s) => {
  const d = body.ownerDocument; const g = d.getSelection(); const r = d.createRange();
  if (s.whole) { r.selectNodeContents(body.querySelector(s.a)); }
  else { const a = body.querySelector(s.a), b = body.querySelector(s.b || s.a); r.setStart(a.firstChild, 0); r.setEnd(b.firstChild, b.firstChild.length); }
  g.removeAllRanges(); g.addRange(r);
  const dt = new DataTransfer();
  d.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  return { html: dt.getData('text/html'), text: dt.getData('text/plain') };
}, setup);
// 真点击目标块进编辑态(editingEl 由编辑器自己设)→ 设精确光标 → 合成 paste 该 clip
async function synPasteInto(targetSel, pos, clip) {
  await frame.locator(targetSel).last().click();
  await page.waitForTimeout(120);
  await frame.locator('body').evaluate((body, { pos, clip }) => {
    const d = body.ownerDocument;
    const el = body.querySelector('[data-ws2-editing]') || [...body.querySelectorAll('p,h1,h2,h3,blockquote,ul,li')].pop();
    const g = d.getSelection(); const r = d.createRange();
    const tn = el.firstChild || el;
    if (pos === 'end') r.setStart(el, el.childNodes.length);
    else r.setStart(tn, Math.min(pos, (tn.textContent || '').length));
    r.collapse(true); g.removeAllRanges(); g.addRange(r);
    const dt = new DataTransfer(); dt.setData('text/html', clip.html); dt.setData('text/plain', clip.text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { pos, clip });
}
const blockDump = () => frame.locator('body').evaluate((body) => [...body.children].filter((c) => c.nodeType === 1 && !(c.hasAttribute && c.hasAttribute('data-ws2-ui'))).map((b) => ({ tag: b.tagName.toLowerCase(), cls: b.className || '', text: (b.textContent || '').replace(/\s+/g, ''), hasB: /<(b|strong)\b/i.test(b.innerHTML) })));

test('内部：复制待办 → 粘到段末 → 得到第二个待办块(保留块格式)', async () => {
  await openDoc('<ul class="ws-todo"><li>测试bug</li></ul><p>目标段</p>', 'block');
  const clip = await synCopy({ a: 'ul.ws-todo li', whole: true });
  expect(clip.html).toContain('data-ws2-clip="b"');
  await synPasteInto('p', 'end', clip);
  await page.waitForTimeout(300);
  expect(await frame.locator('ul.ws-todo').count(), '应有 2 个待办块').toBe(2);
});

test('内部：复制行内加粗字 → 粘进另一段末 → 保留 <b>', async () => {
  await openDoc('<p>前缀<b>粗字</b>后缀</p><p>空段</p>', 'inline');
  const clip = await synCopy({ a: 'p b', whole: true });
  expect(clip.html).toContain('data-ws2-clip="i"');
  expect(clip.html).toContain('<b>');
  await synPasteInto('p', 'end', clip);
  await page.waitForTimeout(300);
  const bs = await blockDump();
  const last = bs[bs.length - 1];
  expect(last.text, '目标段应含粘入的字').toContain('粗字');
  expect(last.hasB, '目标段应保留 <b>').toBe(true);
});

test('外部安全：HTML 无哨兵(模拟 Word/网页) → 仍走纯文本,不造格式块(ED-A4)', async () => {
  await openDoc('<p>目标</p>', 'ext');
  await synPasteInto('p', 'end', { html: '<h1>外部大标题</h1><b>外部粗字</b>', text: '外部大标题 外部粗字' });
  await page.waitForTimeout(300);
  const bs = await blockDump();
  expect(bs.some((b) => b.tag === 'h1'), '外部 HTML 不该造出 h1 块').toBe(false);
  expect(bs.some((b) => b.hasB), '外部 HTML 不该保留 <b>').toBe(false);
  expect(bs.map((b) => b.text).join(''), '外部内容应作为纯文本进来').toContain('外部大标题');
});

test('内部：复制两个块(标题+段) → 粘贴 → 两块都在', async () => {
  await openDoc('<h2>标题块</h2><p>段落块</p><p>落点</p>', 'multi');
  const clip = await synCopy({ a: 'h2', b: 'p' }); // 跨 h2 与第一个 p
  await synPasteInto('p', 'end', clip);
  await page.waitForTimeout(300);
  const bs = await blockDump();
  expect(bs.filter((b) => b.tag === 'h2').length, '应有 2 个 h2').toBe(2);
  expect(bs.filter((b) => b.text === '段落块').length, '粘贴的段落块也在').toBe(2);
});

test('内部：块中粘贴 → 光标处劈开、块插中间(Colin 拍板落点)', async () => {
  await openDoc('<ul class="ws-todo"><li>待办</li></ul><p>前后</p>', 'mid');
  const clip = await synCopy({ a: 'ul.ws-todo li', whole: true });
  await synPasteInto('p', 1, clip); // 光标在"前|后"中间
  await page.waitForTimeout(300);
  const bs = await blockDump();
  expect(bs.filter((b) => b.cls.includes('ws-todo')).length, '应有 2 个待办块').toBe(2);
  expect(bs.some((b) => b.tag === 'p' && b.text === '前'), '前半劈出').toBe(true);
  expect(bs.some((b) => b.tag === 'p' && b.text === '后'), '后半劈出').toBe(true);
});

test('落盘干净：内部粘贴后保存到磁盘 → 无 data-ws2-clip，待办块合规入盘', async () => {
  const dst = await openDoc('<ul class="ws-todo"><li>待办甲</li></ul><p>末段</p>', 'disk');
  const clip = await synCopy({ a: 'ul.ws-todo li', whole: true });
  await synPasteInto('p', 'end', clip);
  await page.waitForTimeout(1800); // 等自动保存(1.2s)落盘
  const bytes = await fs.readFile(dst, 'utf8');
  expect(bytes.includes('data-ws2-clip'), '磁盘绝不能有剪贴板哨兵').toBe(false);
  expect((bytes.match(/ws-todo/g) || []).length, '磁盘应有待办块').toBeGreaterThanOrEqual(2);
});
