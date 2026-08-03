// 回归门（Wendi bug「列表/待办项没法改文字颜色和背景颜色」）：
// 在 <li> 里用键盘选行（Home→Shift+End）/ 三击选行，浏览器会把选区尾端落到**下一个 <li>** 的 offset 0
// （selection.toString() 尾部那个 '\n' 就是块边界）。旧的 wrapInlineStyle / wrapMark 跨块守卫死判
// startBlock(li0)!==endBlock(li1) → 直接拒绝 → 上色/高亮静默无反应（加粗走 execCommand 不受影响，
// 所以现象是「能改粗细却改不了颜色」）。修法 = format.js clampRangeToBlock：尾端只是溢到相邻块的幽灵
// 边界（中间零可见文字/媒体）时夹回起块末尾再上色；真选进了别块的内容才拒绝（保真红线不破，见 fidelity 用例）。
// 有牙实证：修复前本门 T1/T2 的 span/mark count 为 0（li 纹丝不动），修复后 >0。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');

let app, page, frame, tmpDir;

const TODO = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>List</title></head><body>
<h1>List</h1><ul class="ws-todo"><li data-checked="false">我没有办法更改颜色</li><li data-checked="true"><br></li><li data-checked="false"></li></ul></body></html>`;
const PLAINLIST = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>t</title></head><body>
<h1>标题</h1><ul><li>第一项文字内容</li><li>第二项</li></ul></body></html>`;
const TWOITEMS = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="wordspace-schema" content="1"><title>t</title></head><body>
<h1>标题</h1><ul><li id="a">第一项有内容</li><li id="b">第二项也有内容</li></ul></body></html>`;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2color-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
test.afterEach(async () => {
  try { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())); } catch (e) {}
  if (app) await app.close().catch(() => {});
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
  return p;
}
const saveToDisk = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'save'));

// 忠实复现用户手势：点进 <li> → Home → Shift+End（选中该行，尾端溢到下一 li 边界）
async function keyboardSelectLine(liSelector) {
  await frame.locator(liSelector).first().click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(150);
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
}

test('待办项键盘选行 → 文字色 → span 真上色 + 存盘保留', async () => {
  await launch();
  await openDoc(TODO);
  await expect(page.locator('#ws-degrade-notice')).toBeHidden(); // schema=1 走块编辑
  await keyboardSelectLine('ul.ws-todo li');
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click(); // 第二色 #d93025
  await page.waitForTimeout(150);
  const span = frame.locator('ul.ws-todo li').first().locator('span[style*="color"]');
  await expect(span, '待办项文字色没生效（列表 Shift+End 幽灵边界被误判跨块）').toHaveCount(1);
  expect(await span.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(217, 48, 37)');
  // 存盘保留（inline 随文件走）
  await saveToDisk();
  await page.waitForTimeout(300);
  const disk = await fs.readFile(path.join(tmpDir, 'doc.html'), 'utf8');
  expect(disk).toMatch(/<li data-checked="false"><span style="color[^"]*">我没有办法更改颜色<\/span><\/li>/);
});

test('待办项键盘选行 → 高亮（背景色）→ <mark>', async () => {
  await launch();
  await openDoc(TODO);
  await keyboardSelectLine('ul.ws-todo li');
  await frame.locator('.ws-fmtbar [title="高亮"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').first().click();
  await page.waitForTimeout(150);
  await expect(frame.locator('ul.ws-todo li').first().locator('mark'), '待办项高亮没生效').toHaveCount(1);
});

test('普通无序列表项幽灵边界选区 → 文字色（不止待办）', async () => {
  await launch();
  await openDoc(PLAINLIST);
  await frame.locator('ul li').first().click();
  await page.waitForTimeout(120);
  // 确定性设「起点 li0 文字 offset0 → 终点 li1 offset0」的幽灵边界选区（= 待办 Shift+End 天然产生的形状；
  // 普通列表里 Playwright 的 Shift+End 会过度选到 li1 真实文字，那是真跨块另说，这里定向验幽灵边界路径）。
  await frame.locator('body').evaluate(() => {
    const d = document, li0 = d.querySelector('ul li'), li1 = li0.nextElementSibling;
    const r = d.createRange(); r.setStart(li0.firstChild, 0); r.setEnd(li1, 0);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(150);
  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click();
  await page.waitForTimeout(150);
  await expect(frame.locator('ul li').first().locator('span[style*="color"]'), '普通列表项文字色没生效').toHaveCount(1);
});

test('fidelity：真跨两个有内容的 li 选区 → 文字色仍被拒（保真红线未削弱）', async () => {
  await launch();
  await openDoc(TWOITEMS);
  await frame.locator('#a').click();
  await page.waitForTimeout(120);
  // 程序化设「起点 a 文字中段 → 终点 b 文字中段」的真跨块选区（两块都含被选文字）
  await frame.locator('body').evaluate(() => {
    const d = document, a = d.getElementById('a'), b = d.getElementById('b');
    const r = d.createRange(); r.setStart(a.firstChild, 2); r.setEnd(b.firstChild, 2);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(150);
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click();
  await page.waitForTimeout(150);
  // 真跨块（两块各有被选文字）必须被拒绝：不产生任何 color span，文档不被改坏
  await expect(frame.locator('ul li span[style*="color"]'), '真跨块上色应被拒绝，clamp 不该越块上色').toHaveCount(0);
  await expect(frame.locator('#a')).toHaveText('第一项有内容');
  await expect(frame.locator('#b')).toHaveText('第二项也有内容');
});
