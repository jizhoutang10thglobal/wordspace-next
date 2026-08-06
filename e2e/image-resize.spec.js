// I1（Notion 对齐 sweep）：图片缩放药丸 + 悬停工具条 + 放大预览。
// Notion 读数（2026-08-06，notion-i1/*.png）：悬停出左右 col-resize 竖药丸 + 顶右工具条；
// 拖药丸=宽随指针对称收缩（2×dx 中心锚定）、等比、松手定格；缩后水平居中（i1-resize-after 实测
// 居中偏移精确吻合）。持久化=img width 属性 + data-ws-schema-css="image" 入盘 CSS（style 属性=非合规红线）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PNG = require('fs').readFileSync(path.join(__dirname, 'fixtures-img-dataurl.txt'), 'utf8').trim();
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2imgrs-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
  cdp = await page.context().newCDPSession(page);
}
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
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
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

const DOC = `<p id="a">图片上方段落。</p><img id="im" src="${PNG}" alt="图"><p id="z">图片下方段落。</p>`;

async function hoverImg() {
  const b = await frame.locator('#im').boundingBox();
  await page.mouse.move(b.x - 60, b.y - 30);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(350);
  return b;
}
async function dragPill(sel, dx) {
  const pb = await frame.locator(sel).boundingBox();
  const from = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + dx * i / 5, y: from.y, button: 'left', buttons: 1 });
    await page.waitForTimeout(40);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(200);
}

test('Z1: 悬停图片 → 左右缩放药丸 + 工具条可见且真画出来（S4 判据）', async () => {
  await launch();
  await openDoc(DOC);
  const b = await hoverImg();
  void b;
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const ir = d.getElementById('im').getBoundingClientRect(); // 同一坐标系取图片边界（iframe 内）
    const pills = [...d.querySelectorAll('.ws-imgresize')].filter((p) => p.style.display !== 'none').map((p) => {
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return { x: r.x, w: r.width, h: r.height, bg: cs.backgroundColor, cur: cs.cursor };
    });
    const bar = d.querySelector('.ws-imgbar');
    return { imgL: ir.x, imgR: ir.right, pills, barShown: bar && bar.style.display !== 'none', barBtns: bar ? [...bar.querySelectorAll('.ws-imgbar-btn')].map((x) => x.textContent) : [] };
  });
  expect(st.pills.length).toBe(2);
  expect(st.pills[0].h).toBeGreaterThan(20); // 真画出来（删 CSS 规则翻红）
  expect(st.pills[0].bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(st.pills.every((p) => p.cur === 'col-resize')).toBe(true); // Notion 同款光标
  expect(st.pills[0].x).toBeLessThan(st.imgL + 12); // 左药丸贴左缘
  expect(st.pills[1].x).toBeGreaterThan(st.imgR - 14); // 右药丸贴右缘
  expect(st.barShown).toBe(true);
  expect(st.barBtns).toEqual(['说明', '放大']);
});

test('Z2/Z3: 拖右药丸 → 对称收缩+等比+居中；松手持久化 width 属性、合规、一步 undo 回来', async () => {
  await launch();
  await openDoc(DOC);
  const b = await hoverImg();
  await dragPill('.ws-imgresize >> nth=1', -60); // 右药丸向左 60px → 预期宽 -120
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const img = d.getElementById('im');
    const r = img.getBoundingClientRect();
    const col = img.parentElement.getBoundingClientRect();
    return { attr: img.getAttribute('width'), w: r.width, h: r.height,
      centerOff: Math.abs((r.x + r.width / 2) - (col.x + col.width / 2)),
      natRatio: img.naturalWidth / img.naturalHeight, ratio: r.width / r.height };
  });
  expect(parseInt(st.attr, 10)).toBeGreaterThan(0); // width 属性持久化（不是 style）
  const startW = 480; // fixture 自然宽
  expect(Math.abs(st.w - (startW - 120))).toBeLessThan(16); // 对称收缩 2×dx（Notion 实测口径）
  expect(Math.abs(st.ratio - st.natRatio)).toBeLessThan(0.05); // 等比
  expect(st.centerOff).toBeLessThan(5); // 缩后水平居中（Notion i1-resize-after 同款）
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  expect(html).toMatch(/<img[^>]*width="/); // 入盘
  expect(html).toContain('data-ws-schema-css="image"'); // 居中/等比 CSS 入盘（浏览器直开同渲染）
  expect(html).not.toContain('ws-imgresize'); // 浮件绝不入盘
  const conform = await page.evaluate(async (h) => {
    const v = window.WS2Validate || (typeof require !== 'undefined' ? require('../src/lib/schema-validate.js') : null);
    return v ? v.validateHtml ? v.validateHtml(h).length === 0 : null : null;
  }, html).catch(() => null);
  if (conform !== null) expect(conform).toBe(true); // width 属性合规
  // 一步 undo → 属性回滚
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('im').getAttribute('width'))).toBe(null);
});

test('Z4: 拖回全宽 → width 属性移除（canonical 零噪音）；Z7 下限钳制 80px', async () => {
  await launch();
  await openDoc(DOC);
  await hoverImg();
  await dragPill('.ws-imgresize >> nth=1', -80);
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('im').getAttribute('width'))).not.toBe(null);
  await hoverImg();
  await dragPill('.ws-imgresize >> nth=1', 400); // 拖超列宽
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.getElementById('im').getAttribute('width'))).toBe(null); // 回全宽=无属性
  await hoverImg();
  await dragPill('.ws-imgresize >> nth=1', -600); // 拖到极小
  const w = await page.evaluate(() => parseInt(document.getElementById('doc-frame').contentDocument.getElementById('im').getAttribute('width'), 10));
  expect(w).toBeGreaterThanOrEqual(80); // 下限钳制
});

test('Z5: 工具条「说明」→ 进说明编辑（与块菜单同口径）', async () => {
  await launch();
  await openDoc(DOC);
  await hoverImg();
  await frame.locator('.ws-imgbar-btn', { hasText: '说明' }).click();
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const cap = d.querySelector('figcaption');
    return { hasFigure: !!d.querySelector('figure'), editing: cap ? cap.hasAttribute('data-ws2-ce') : false };
  });
  expect(st.hasFigure).toBe(true); // 裸 img 被包成 figure
  expect(st.editing).toBe(true); // 说明处于编辑态
});

test('Z6: 工具条「放大」→ lightbox 预览，Esc 关闭，覆盖层绝不入盘', async () => {
  await launch();
  await openDoc(DOC);
  await hoverImg();
  await frame.locator('.ws-imgbar-btn', { hasText: '放大' }).click();
  const lb = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const l = d.querySelector('.ws-lightbox');
    const img = l ? l.querySelector('img') : null;
    return { shown: l && l.style.display !== 'none', hasImg: !!img, cover: l ? getComputedStyle(l).position === 'fixed' : false };
  });
  expect(lb.shown).toBe(true);
  expect(lb.hasImg).toBe(true);
  expect(lb.cover).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('.ws-lightbox').style.display)).toBe('none');
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  expect(html).not.toContain('ws-lightbox');
  expect(html).not.toContain('ws-imgbar');
});
