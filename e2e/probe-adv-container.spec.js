// 对抗审查探针（临时，用完即删）：攻击 callout/quote 容器化（PR-3）的边界
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2adv-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
}
const HEAD = '<style id="ws-callout-style" data-ws-schema-css="callout">.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px}.ws-callout>p{margin:6px 0}</style>';
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title>${HEAD}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
const DOC3 = '<p id="up">上面一段</p><div class="ws-callout" id="C"><p id="c1">框一</p><p id="c2">框二</p><p id="c3">框三</p></div><p id="z">下面一段</p>';
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const rawC = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const c = d.querySelector('#C');
  return c ? c.innerHTML.replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '').replace(/ ?contenteditable="[^"]*"/g, '') : null;
});
const rawBody = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.outerHTML.replace(/ ?data-ws2-[a-z]+(="[^"]*")?/g, '').replace(/ ?contenteditable="[^"]*"/g, '')).join('|');
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('P1 第二段行首 Backspace（交原生）：产出是什么', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  const html = await rawC();
  const ser = await serialize();
  console.log('P1 innerHTML:', html);
  console.log('P1 hasSpan:', /<span/i.test(html), 'hasStyleAttr:', /style=/i.test(html));
  console.log('P1 conform:', await conformOf(ser));
});

test('P2 框内同段选中文字后 Enter：选区该删没删', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight'); // 选中「框」
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log('P2 innerHTML:', await rawC());
  console.log('P2 conform:', await conformOf(await serialize()));
});

test('P3 跨段反向选区（anchor 在 c2、选到 c1）按 Enter', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight'); // 框|二
  await page.keyboard.press('Shift+ArrowUp'); // 反向：focus 进 c1
  const selInfo = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.getSelection();
    const pid = (n) => { const el = n && (n.nodeType === 3 ? n.parentElement : n); return el ? (el.id || el.tagName) : null; };
    return { anchor: pid(s.anchorNode), focus: pid(s.focusNode), collapsed: s.isCollapsed };
  });
  console.log('P3 selection:', JSON.stringify(selInfo));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const ser = await serialize();
  console.log('P3 body:', await rawBody());
  console.log('P3 nestedP:', await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('p p')));
  console.log('P3 conform:', await conformOf(ser));
});

test('P4 框内多行纯文本粘贴：框劈没劈', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer();
    dt.setData('text/plain', '甲行\n乙行\n丙行');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    d.querySelector('#C').dispatchEvent(ev);
  });
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('.ws-callout').length);
  console.log('P4 calloutCount:', n);
  console.log('P4 body:', await rawBody());
  console.log('P4 conform:', await conformOf(await serialize()));
});

test('P5 混排容器（裸文本-P-裸文本）尾部裸文本按 Enter：新段插哪', async () => {
  await launch(); await openDoc('<p id="up">上</p><div class="ws-callout" id="C">头头<p id="m1">中中</p>尾尾</div><p id="z">下</p>');
  await frame.locator('#C').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const c = d.querySelector('#C');
    let t = null;
    for (const n of c.childNodes) { if (n.nodeType === 3 && n.nodeValue.includes('尾尾')) t = n; }
    const r = d.createRange(); r.setStart(t, t.nodeValue.indexOf('尾尾') + 1); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log('P5 innerHTML:', await rawC());
  console.log('P5 conform:', await conformOf(await serialize()));
});

test('P6 Esc 段选中后把该段拖出：data-ws2-selected 残留？', async () => {
  await launch(); await openDoc(DOC3);
  await frame.locator('#c2').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // 第一级：段选中
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#z');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  const ghost = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + (el.id ? '#' + el.id : '') + '@' + (el.parentElement ? el.parentElement.tagName : 'null'));
  });
  console.log('P6 ghost:', JSON.stringify(ghost));
  console.log('P6 order:', await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''))));
  // 拖出后再按 Delete（无 editingEl/selectedEl）：rowSelEl 因父不是容器返回 null → 死键？
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  console.log('P6 afterDelete:', await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''))));
});
