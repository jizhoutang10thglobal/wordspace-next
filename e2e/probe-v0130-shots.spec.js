// changelog 配图用的实机截图（非门，CI 不跑；WS2_PROBES=1 才收集）。WS2_SHOTDIR 指定输出目录。
// 主题钉浅色：宿主是深色主机，不钉出来的图跟官网浅色版式打架。
// 按住拖动只能走裸 CDP——Playwright mouse.down+move 在 Electron 进 drag loop 卡死（照抄 table-rect-selection.spec.js）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOTDIR || path.join(os.tmpdir(), 'v0130shots');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  await fs.mkdir(OUT, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2v0130-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.evaluate(() => { try { window.ws2.setAppearance('light'); } catch (e) {} });
  await page.waitForTimeout(200);
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
  await page.waitForTimeout(350);
}
// 裁到真实内容的四边（含浮件），别把半屏空白发到官网。表格这类窄内容横向也要收，
// 否则一张 978px 宽的图里三分之二是白的。浮件（手柄 / 「+」）挂在 documentElement 上，
// 只扫 body 会把它们裁掉——所以扫 documentElement。
async function shot(name) {
  const clip = await page.evaluate(() => {
    const f = document.getElementById('doc-frame');
    const fb = f.getBoundingClientRect();
    const d = f.contentDocument;
    let l = Infinity, r = 0, b = 0;
    for (const e of d.documentElement.querySelectorAll('*')) {
      // 跳过 <body> 这类撑满整列的容器：算进去横向就永远收不窄（body 有 max-width:820px）
      if (e.tagName === 'BODY' || e.tagName === 'HEAD' || e.tagName === 'STYLE') continue;
      const q = e.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      l = Math.min(l, q.left); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    if (!isFinite(l)) { l = 0; r = fb.width; b = fb.height; }
    const pad = 16;
    const x0 = Math.max(0, Math.floor(l) - pad);
    const x1 = Math.min(fb.width, Math.ceil(r) + pad);
    return { x: fb.x + x0, y: fb.y, width: x1 - x0, height: Math.min(fb.height, Math.ceil(b) + pad) };
  });
  await page.screenshot({ path: path.join(OUT, name + '.png'), clip, scale: 'device' });
}
const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: 'left', buttons: 1 });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(150);
}

// 文档里只放表格：多一个空段落就会把横向包围盒撑到整列宽，图上全是白
const TBL = '<table id="T"><tbody>'
  + '<tr><td id="c11">一月</td><td id="c12">二月</td><td id="c13">三月</td></tr>'
  + '<tr><td id="c21">12</td><td id="c22">18</td><td id="c23">9</td></tr>'
  + '<tr><td id="c31">7</td><td id="c32">21</td><td id="c33">15</td></tr>'
  + '</tbody></table>';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('表格矩形选区', async () => {
  await launch();
  await openDoc(TBL);
  // c12→c23 的包围盒 = 第 1-2 行 × 第 2-3 列 = 2×2；四周留着没选中的格子，图上一眼看得出是「一块矩形」
  await drag(await center('#c12'), await center('#c23'));
  // 前置断言：真的选出 4 格，否则拍到的是一张「什么都没发生」的图
  const ids = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument
    .querySelectorAll('[data-ws2-cellsel]')].map((c) => c.id).sort());
  expect(ids, '矩形选区必须罩住且只罩住这 4 格，不然这张图没意义').toEqual(['c12', 'c13', 'c22', 'c23']);
  await shot('0130-table-rectsel');
});

test('表格边缘加行条', async () => {
  await launch();
  await openDoc(TBL);
  const b = await frame.locator('#T').boundingBox();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.width / 2, y: b.y + b.height - 2 });
  await page.waitForTimeout(300);
  // 前置断言：加行条真的浮出来了
  const bar = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const e = [...d.querySelectorAll('[data-ws2-ui]')].find((x) => (x.title || '').includes('加一行'));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  expect(bar, '「下方加一行」那条必须真的出现').not.toBeNull();
  await shot('0130-table-edgeadd');
});
