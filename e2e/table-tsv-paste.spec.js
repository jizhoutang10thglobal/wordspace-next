// SW-C（Notion 对齐 sweep）：表格矩形选中态 ⌘V = TSV 按 anchor 铺格（table.md 记录的欠账收账）。
// Notion 行为=grid 选中粘贴 TSV 按 anchor 填充；我们**有意收窄**：越界裁剪不扩表结构（Notion 会加行）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2tsv-'));
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

const T33 = '<p id="a">上。</p><table id="T"><tbody>'
  + '<tr><td id="c11">一甲</td><td id="c12">一乙</td><td id="c13">一丙</td></tr>'
  + '<tr><td id="c21">二甲</td><td id="c22">二乙</td><td id="c23">二丙</td></tr>'
  + '<tr><td id="c31">三甲</td><td id="c32">三乙</td><td id="c33">三丙</td></tr>'
  + '</tbody></table><p id="z">下。</p>';
const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5, button: 'left', buttons: 1 });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(150);
}
const texts = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('#T td')].map((c) => (c.textContent || '').trim()).join('|');
});
// 合成 paste（clipboardData 可写；走 doc paste 监听）
const pasteText = (t) => page.evaluate((txt) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const dt = new DataTransfer();
  dt.setData('text/plain', txt);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  (d.activeElement || d.body).dispatchEvent(ev);
}, t);
const undoIPC = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));

test('P1: 矩形态贴 2×2 TSV → 从 anchor 铺格、选中态盖住覆盖区、一步 undo 全回', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32')); // 矩形 anchor=(1,0)
  await pasteText('A\tB\nC\tD');
  await expect.poll(texts).toBe('一甲|一乙|一丙|A|B|二丙|C|D|三丙');
  const selIds = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('[data-ws2-cellsel]')].map((c) => c.id).sort());
  expect(selIds).toEqual(['c21', 'c22', 'c31', 'c32']); // 选中态=覆盖区
  await undoIPC();
  await expect.poll(texts).toBe('一甲|一乙|一丙|二甲|二乙|二丙|三甲|三乙|三丙'); // 一步全回
});

test('P2: 超尺寸 TSV 越界裁剪——结构一格不多、不加行列（有意收窄，Notion 会扩表）', async () => {
  await launch();
  await openDoc(T33);
  const cc = await center('#c22'); await drag(cc, { x: cc.x + 15, y: cc.y }); // 格内小拖=1×1 矩形（零距离过不了 4px 阈值会走 click→cell 编辑）
  await pasteText('X1\tX2\tX3\nY1\tY2\tY3\nZ1\tZ2\tZ3'); // 3×3 贴进右下 2×2 空间
  await expect.poll(texts).toBe('一甲|一乙|一丙|二甲|X1|X2|三甲|Y1|Y2');
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { rows: d.querySelectorAll('#T tr').length, cols: d.querySelector('#T tr').children.length };
  });
  expect(st).toEqual({ rows: 3, cols: 3 }); // 不扩结构
});

test('P3: 单段无 tab 文本 → 只进 anchor 格；空值清格合规', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c21'), await center('#c32'));
  await pasteText('单值');
  await expect.poll(texts).toBe('一甲|一乙|一丙|单值|二乙|二丙|三甲|三乙|三丙'); // 只 anchor
  await page.mouse.click(60, 60);
  await page.waitForTimeout(150);
  const c1c = await center('#c11'); await drag(c1c, { x: c1c.x + 15, y: c1c.y });
  await pasteText('\tB2'); // 首格空值
  await expect.poll(texts).toBe('|B2|一丙|单值|二乙|二丙|三甲|三乙|三丙');
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  const { validate } = require('../src/lib/schema-validate.js');
  const { JSDOM } = require('jsdom');
  expect(validate(new JSDOM(html).window.document).conform).toBe(true); // 空格 <br> 占位合规
});
