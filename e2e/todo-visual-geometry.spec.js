// todo 视觉几何门（2026-08-08 todo 深扫视觉批）：
// G-C6 三种列表嵌套步长一致（修前 todo 每层多 4px：li 的 padding-left 逐层累加）；
// G-C4 行灰选环罩住勾选框（U2 border-left 改造后的现状，钉住防回归——旧结构里勾选框在环外）；
// G-HIT 勾选框命中区对称 ±4（同上，钉现状）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2vg-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.evaluate(() => { try { window.ws2.setAppearance('light'); } catch (e) {} });
  await page.waitForTimeout(300);
}
async function openDoc(body) {
  const tag = 'vg' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => { const f = document.getElementById('doc-frame'); return !!(f && f.contentDocument && f.contentDocument.title === t); }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
test.afterEach(async () => { if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; } });

test('G-C6 三种列表的嵌套步长一致（±0.5px；修前 todo 每层多 4px）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="t1">一<ul class="ws-todo"><li id="t2">二<ul class="ws-todo"><li id="t3">三</li></ul></li></ul></li></ul>'
    + '<ul><li id="u1">一<ul><li id="u2">二<ul><li id="u3">三</li></ul></li></ul></li></ul>'
    + '<ol><li id="o1">一<ol><li id="o2">二<ol><li id="o3">三</li></ol></li></ol></li></ol>');
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const L = (id) => { const el = d.getElementById(id); const r = el.getBoundingClientRect(); const cs = d.defaultView.getComputedStyle(el); return r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0); };
    return { todo: [L('t1'), L('t2'), L('t3')], ul: [L('u1'), L('u2'), L('u3')], ol: [L('o1'), L('o2'), L('o3')] };
  });
  const step = (a, i) => a[i + 1] - a[i];
  for (const i of [0, 1]) {
    expect(Math.abs(step(g.todo, i) - step(g.ul, i)), `todo 第${i + 1}层步长(${step(g.todo, i).toFixed(1)}) vs ul(${step(g.ul, i).toFixed(1)})`).toBeLessThan(0.5);
    expect(Math.abs(step(g.todo, i) - step(g.ol, i)), `todo 第${i + 1}层步长 vs ol`).toBeLessThan(0.5);
  }
});

test('G-C4 行灰选环罩住勾选框（几何 + 像素双证）', async () => {
  await launch();
  await openDoc('<p>段落</p><ul class="ws-todo" id="L"><li id="r1">待办一</li><li id="r2">待办二</li></ul>');
  await frame.locator('#r1').click(); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const geo = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const li = d.getElementById('r1');
    const r = li.getBoundingClientRect();
    const cs = d.defaultView.getComputedStyle(li);
    const cb = d.defaultView.getComputedStyle(li, '::before');
    const cbL = r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cb.left) || 0);
    return { sel: !!li.hasAttribute('data-ws2-selected'), boxL: r.left, cbL, midY: (r.top + r.bottom) / 2 };
  });
  expect(geo.sel, '前置：r1 灰选').toBe(true);
  expect(geo.boxL, '几何：环的盒左缘在勾选框左侧').toBeLessThanOrEqual(geo.cbL - 1);
  // 像素：勾选框左外 3px 应是环底色（非纸白）——防「几何对但 CSS 全废」
  const shot = await page.screenshot();
  const fb = await page.locator('#doc-frame').boundingBox();
  const px = await page.evaluate(async ([sx, sy, b64]) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    return [...ctx.getImageData(Math.round(sx * scale), Math.round(sy * scale), 1, 1).data.slice(0, 3)];
  }, [fb.x + geo.cbL - 3, fb.y + geo.midY, shot.toString('base64')]);
  expect(px[0], `像素非纸白（实得 ${JSON.stringify(px)}）`).toBeLessThan(252);
});

test('G-HIT 勾选框命中区对称（左外3/右外3 都算勾选，右外6 进编辑）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">待办一</li><li id="r2">待办二</li></ul>');
  const fb = await page.locator('#doc-frame').boundingBox();
  const cb = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const li = d.getElementById('r1');
    const r = li.getBoundingClientRect();
    const cs = d.defaultView.getComputedStyle(li);
    const b = d.defaultView.getComputedStyle(li, '::before');
    const L = r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(b.left) || 0);
    return { L, R: L + (parseFloat(b.width) || 16), y: Math.round(r.top + r.height / 2) };
  });
  const probe = async (x) => {
    await page.mouse.click(fb.x + x, fb.y + cb.y);
    await page.waitForTimeout(220);
    const st = await page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      return { checked: d.getElementById('r1').getAttribute('data-checked') === 'true', editing: !!d.querySelector('[data-ws2-editing]') };
    });
    await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; d.getElementById('r1').removeAttribute('data-checked'); });
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    return st;
  };
  expect((await probe(cb.L - 3)).checked, '左外 3px 算勾选（修历史：左侧曾掉进编辑）').toBe(true);
  expect((await probe(cb.R + 3)).checked, '右外 3px 算勾选').toBe(true);
  const far = await probe(cb.R + 7);
  expect(far.checked, '右外 7px 超出容差=不勾').toBe(false);
});
