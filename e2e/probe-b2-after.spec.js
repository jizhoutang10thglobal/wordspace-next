// 修复后的实机截图（报告用，不入库门）。红圈标注走 CSSOM setProperty——CSP style-src 无 unsafe-inline，
// setAttribute('style') 会被整条拦掉 = 哑标注（本轮实证）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'b2after');
let app, page, frame, tmpDir, PNG;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2after-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  PNG = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 120, 80); gr.addColorStop(0, '#1a73e8'); gr.addColorStop(1, '#8430ce');
    g.fillStyle = gr; g.fillRect(0, 0, 120, 80);
    return c.toDataURL('image/png');
  });
  await fs.mkdir(SHOTS, { recursive: true });
}
async function openDoc(body, sentinel) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'd-' + sentinel + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#' + sentinel)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
}
async function mark(pt) {
  const d = await page.evaluate(({ x, y }) => {
    const m = document.createElement('div'); m.id = '__pc';
    const S = { position: 'fixed', left: Math.round(x - 9) + 'px', top: Math.round(y - 9) + 'px',
      width: '18px', height: '18px', border: '3px solid #E5484D', 'border-radius': '50%',
      'z-index': '2147483647', 'pointer-events': 'none', 'box-shadow': '0 0 0 2px rgba(255,255,255,.85)',
      'box-sizing': 'border-box', margin: '0', flex: 'none' };
    for (const k in S) m.style.setProperty(k, S[k]);
    document.body.appendChild(m);
    const b = m.getBoundingClientRect(); return { w: Math.round(b.width) };
  }, pt);
  if (d.w !== 18) throw new Error('哑标注');
}
const unmark = () => page.evaluate(() => { const m = document.getElementById('__pc'); if (m) m.remove(); });
async function shot(name, pt, clip) {
  if (pt) await mark(pt);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, name), clip: clip || { x: 180, y: 20, width: 940, height: 460 } });
  if (pt) await unmark();
}
const outerPt = async (sel, dx) => {
  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate((s) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.querySelector(s).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
  return { x: box.x + r.x + (dx == null ? r.w / 2 : dx), y: box.y + r.y + r.h / 2 };
};

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null;
});

test('shot: 表格菜单作用对象（U2 修后）', async () => {
  await launch();
  // 六列宽表：菜单本身会遮掉左侧近半张表（这正是 T6 记录的问题之一），加宽才能在菜单外
  // 看见行/列标记贯穿的效果——否则截图只能证明「菜单挡住了」。
  const th = ['列一', '列二', '列三', '列四', '列五', '列六'].map((t) => '<th scope="col">' + t + '</th>').join('');
  const row = (p, ids) => '<tr>' + ids.map((id, i) => '<td' + (id ? ' id="' + id + '"' : '') + '>' + p + (i + 1) + '</td>').join('') + '</tr>';
  await openDoc('<p id="p1">前文</p><table class="ws-table"><thead><tr>' + th + '</tr></thead><tbody>' +
    row('甲', [null, null, null, null, null, null]) +
    row('乙', ['c21', 'c22', null, null, null, null]) +
    row('丙', [null, null, null, null, null, null]) +
    '</tbody></table><p id="p2">后文</p>', 'p1');
  await frame.locator('#c22').click();
  await page.waitForTimeout(240);
  const pt = await outerPt('#c22', 20);
  await page.mouse.move(5, 5); await page.waitForTimeout(60);
  await page.mouse.move(pt.x, pt.y, { steps: 6 });
  await page.waitForTimeout(300);
  const box = await page.locator('#doc-frame').boundingBox();
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.querySelector('.ws-grip').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x + g.x, box.y + g.y);
  await frame.locator('.ws-blockmenu-item').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(260);
  await shot('after-table-menuscope.png', pt, { x: 180, y: 20, width: 940, height: 520 });
});

test('shot: 顶层图片各占一行（U3 修后）', async () => {
  await launch();
  await openDoc('<p id="p1">三张顶层图片：</p><img src="' + PNG + '"><img src="' + PNG + '"><img src="' + PNG + '"><p id="p2">下面是行内图片（应保持同一行）：</p><p id="inl">前文 <img src="' + PNG + '" style="width:40px"> 后文</p>', 'p1');
  await shot('after-image-stack.png', null, { x: 180, y: 20, width: 940, height: 560 });
});

test('shot: 空 callout 斜杠插入不吞容器（U4 修后）', async () => {
  await launch();
  await openDoc('<p id="p1">前文</p><div class="ws-callout" id="co"><br></div><p id="p2">后文</p>', 'p1');
  await frame.locator('#co').click();
  await page.waitForTimeout(200);
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible({ timeout: 4000 });
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).first().click();
  await page.waitForTimeout(500);
  await shot('after-callout-keep.png', null, { x: 180, y: 20, width: 940, height: 460 });
});
