// 报告用实机截图（非门，CI 不跑；WS2_PROBES=1 才被 playwright 认领）：PR-5 三个最可见的新交互。
// WS2_SHOTDIR 指定输出目录。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOTDIR || path.join(os.tmpdir(), 'b5shots');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  await fs.mkdir(OUT, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2shot5-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 700 });
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
const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, button: 'left', buttons: 1 });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(200);
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

const T33 = '<p id="a">拖过格子，选中的是一个矩形区域，蓝色描边圈住它。</p><table id="T"><tbody>'
  + '<tr><td id="c11">一甲</td><td>一乙</td><td>一丙</td></tr>'
  + '<tr><td id="c21">二甲</td><td id="c22">二乙</td><td>二丙</td></tr>'
  + '<tr><td>三甲</td><td id="c32">三乙</td><td>三丙</td></tr>'
  + '</tbody></table><p id="z">丙列在框外，不会被选进来。</p>';

test('矩形选区描边', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await page.waitForTimeout(200);
  await shot('b5-rect-selection');
});

test('出向钳制', async () => {
  await launch();
  await openDoc('<p id="a">从第一行的格子往下拖、拖出表格：</p><table id="T"><tbody>'
    + '<tr><td>一甲</td><td id="c12">一乙</td><td>一丙</td></tr>'
    + '<tr><td>二甲</td><td>二乙</td><td>二丙</td></tr>'
    + '<tr><td>三甲</td><td>三乙</td><td>三丙</td></tr>'
    + '</tbody></table><p id="z">指针已经在这段上，但选区被夹在表内——乙列一整列。</p>');
  const c12 = await center('#c12'), z = await center('#z');
  await drag(c12, { x: c12.x, y: z.y });
  await page.waitForTimeout(200);
  await shot('b5-outward-clamp');
});

test('边缘加行条', async () => {
  await launch();
  await openDoc('<p id="a">鼠标贴近表格下缘，全宽「+」条出现，点一下加一行。</p><table id="T"><tbody>'
    + '<tr><td>一甲</td><td>一乙</td><td>一丙</td></tr>'
    + '<tr><td>二甲</td><td>二乙</td><td>二丙</td></tr>'
    + '</tbody></table><p id="z">右缘同理是加列条。</p>');
  const tb = await frame.locator('#T').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height + 8);
  await expect(frame.locator('.ws-tbladdrow')).toBeVisible();
  await page.waitForTimeout(200);
  await shot('b5-edge-rowbar');
});

test('行拖拽指示线', async () => {
  await launch();
  await openDoc('<p id="a">按住行药丸往下拖：整行跟着走，蓝色指示线标出落点行槽。</p><table id="T"><thead><tr><th scope="col">甲头</th><th scope="col">乙头</th><th scope="col">丙头</th></tr></thead><tbody>'
    + '<tr id="r1"><td id="c11">一甲</td><td>一乙</td><td>一丙</td></tr>'
    + '<tr id="r2"><td>二甲</td><td>二乙</td><td>二丙</td></tr>'
    + '<tr id="r3"><td>三甲</td><td>三乙</td><td>三丙</td></tr>'
    + '</tbody></table><p id="z">松手后行落到线的位置。</p>');
  const c = await frame.locator('#r1 td').first().boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.waitForTimeout(350);
  const pb = await frame.locator('.ws-rowsel').boundingBox();
  const from = { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 };
  const r3 = await frame.locator('#r3').boundingBox();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  const toY = r3.y + r3.height + 2;
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 30 * i / 6, y: from.y + (toY - from.y) * i / 6, button: 'left', buttons: 1 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
  await shot('b5-row-drag-line'); // 拖拽定格：指示线在行 3 下缘
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + 30, y: toY, button: 'left', buttons: 1, clickCount: 1 });
});
