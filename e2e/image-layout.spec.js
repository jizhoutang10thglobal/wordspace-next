// 图片块的布局粒度门（对拍 I8）：顶层图片各占一行 / 行内图片保持 inline。
// 强断言纪律（S4）：读 computed display 与 boundingBox 真值，不查 class、不查 CSS 文本。
// 反向门（行内图片不被打成块）比正向门更重要——正向门坏了看得见，反向门坏了是静默的保真损伤。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { JSDOM } = require('jsdom');
const registry = require('../src/lib/schema-registry.js');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, PNG;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2imglayout-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  // 小尺寸 data: PNG——三张并排放得下（若图本身就撑满宽度，"并排"永远复现不了 = 哑门）
  PNG = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = '#1a73e8'; g.fillRect(0, 0, 120, 80);
    return c.toDataURL('image/png');
  });
}
async function openDoc(body, sentinel) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'd-' + sentinel + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#' + sentinel)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(500);
  return p;
}
const rectOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), cy: Math.round(b.y + b.height / 2) };
}, sel);
const displayOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s); if (!el) return null;
  return d.defaultView.getComputedStyle(el).display;
}, sel);

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});

// 正门：三张顶层图各占一行（不是并排一行）
test('顶层图片各占一行 + 手柄锚到被悬停的那一张', async () => {
  await launch();
  await openDoc('<p id="s">哨兵</p><img id="im1" src="' + PNG + '"><img id="im2" src="' + PNG + '"><img id="im3" src="' + PNG + '">', 's');

  const [r1, r2, r3] = [await rectOf('#im1'), await rectOf('#im2'), await rectOf('#im3')];
  expect(await displayOf('#im1')).toBe('block');
  // 三张 y 严格递增、两两不同行——并排时三者 y 相同，这条就是「并排」的可证伪判据
  expect(r2.y).toBeGreaterThan(r1.y + r1.h - 2);
  expect(r3.y).toBeGreaterThan(r2.y + r2.h - 2);
  // 且左缘对齐（各自成块，不是被 inline 排到右边）
  expect(Math.abs(r2.x - r1.x)).toBeLessThan(2);

  // 连带真门（I7 实测的连带问题）：悬停第二张，⋮⋮ 手柄的纵向中心必须落在第二张图的范围内，
  // 而不是画在第一张图的图面上。这条只有在图各自成行之后才可能成立。
  const box = await page.locator('#doc-frame').boundingBox();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + r2.x + r2.w / 2, box.y + r2.cy, { steps: 8 });
  await page.waitForTimeout(300);
  const grip = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const g = d.querySelector('.ws-grip');
    if (!g || g.style.display === 'none') return null;
    const b = g.getBoundingClientRect();
    return { cy: Math.round(b.y + b.height / 2) };
  });
  expect(grip).not.toBeNull();
  expect(grip.cy).toBeGreaterThanOrEqual(r2.y - 4);
  expect(grip.cy).toBeLessThanOrEqual(r2.y + r2.h + 4);
});

// 反向门：行内图片在各类文字容器里必须保持 inline（否则是静默的保真损伤）
test('行内图片在文字容器里保持 inline（p / li / td / blockquote / callout）', async () => {
  await launch();
  await openDoc(
    '<p id="s">哨兵</p>' +
    '<p id="inp">前 <img id="ip" src="' + PNG + '"> 后</p>' +
    '<ul><li id="inli">前 <img id="il" src="' + PNG + '"> 后</li></ul>' +
    '<table class="ws-table"><thead><tr><th scope="col">列</th></tr></thead><tbody><tr><td id="intd">前 <img id="it" src="' + PNG + '"> 后</td></tr></tbody></table>' +
    '<blockquote id="inbq">前 <img id="ib" src="' + PNG + '"> 后</blockquote>' +
    '<div class="ws-callout" id="inco">前 <img id="ic" src="' + PNG + '"> 后</div>', 's');

  for (const id of ['#ip', '#il', '#it', '#ib', '#ic']) {
    expect(await displayOf(id)).toBe('inline');
  }
  // 几何佐证（computed 值对了但行盒被撑开也算坏）：段落里图片与其后文字仍在同一视觉行——
  // 图片纵向中心与所在段落的纵向中心相差不超过半个图高。
  const rp = await rectOf('#inp'); const rip = await rectOf('#ip');
  expect(Math.abs(rip.cy - rp.cy)).toBeLessThan(rip.h);
});

// 入盘门：新 baseline 落盘后磁盘字节仍判合规（BASELINE_CSS 是入盘 CSS，改它波及全语料）
test('新 baseline 入盘后磁盘仍合规', async () => {
  await launch();
  await openDoc('<p id="s">哨兵</p><img id="im1" src="' + PNG + '"><p id="t">尾</p>', 's');
  await frame.locator('#t').click();
  await page.keyboard.press('End');
  await page.keyboard.type('改');
  await page.waitForTimeout(1800); // 过自动保存窗口（1.2s）
  const html = await page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
  // ⚠ 别用 toContain('display:block') 判——`:where(figure>img){display:block}` 本来就在 baseline 里，
  // 那样写在「我这条规则被整条撤掉」时照样绿 = 弱断言（变异自检当场抓到过）。断言两条新规则的完整文本。
  expect(html).toContain(':where(img){max-width:100%;height:auto;display:block}');
  expect(html).toContain('summary,.ws-callout) img){display:inline}');
  const dom = new JSDOM(html);
  expect(registry.classify(dom.window.document).conform).toBe(true);
});
