// 打印/PDF 导出的属性剥除门。
// 两个方向都要守：交互态**必须剥**（否则高亮印进 PDF）、结构标记**必须留**（否则内联 EDITOR_CSS
// 里靠它定位的规则全成死选择器）。本轮就是把「不该入盘」清单照搬成「不该进打印」清单而踩了后者。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2print-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  const p = path.join(tmpDir, 'd.html');
  await fs.writeFile(p, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head>' +
    '<body><p id="a">前文</p><p id="blank"></p><p id="b">后文</p></body></html>', 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#a')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
}

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null;
});

test('结构标记必须留：打印产物里空块仍被 min-height 规则选中', async () => {
  await launch();
  // 编辑器内的基线：空段靠 EDITOR_CSS 的 min-height:1lh 撑出一整行
  const liveH = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return Math.round(d.querySelector('#blank').getBoundingClientRect().height);
  });
  expect(liveH).toBeGreaterThan(10); // 前提：编辑器里空段确实有高度，否则本门空转

  const printHtml = await page.evaluate(() => window.__wsBuildPrintHtml());
  const probe = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    return {
      roots: d.querySelectorAll('[data-ws2-root]').length,
      // 直接问那条规则的选择器**在打印产物里选不选得中**——比断言「属性还在」更贴近后果
      matched: d.querySelectorAll('[data-ws2-root] > p:empty').length,
      hasRule: h.includes('min-height:1lh'),
    };
  }, printHtml);
  expect(probe.hasRule).toBe(true);   // CSS 确实被内联进去了
  expect(probe.roots).toBeGreaterThan(0);
  expect(probe.matched).toBeGreaterThan(0); // 选择器活着 = 空块在 PDF 里不会塌成 0 高
});

test('交互态必须剥：编辑态属性不进打印产物', async () => {
  await launch();
  await frame.locator('#a').click(); // 进编辑态，产生 data-ws2-editing / data-ws2-ce
  await page.waitForTimeout(260);
  const live = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return d.querySelectorAll('[data-ws2-editing],[data-ws2-ce]').length;
  });
  expect(live).toBeGreaterThan(0); // 前提：此刻活 DOM 里确有交互标记

  const printHtml = await page.evaluate(() => window.__wsBuildPrintHtml());
  const leaked = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    // 用属性查，不用子串匹配——EDITOR_CSS 被整份内联进打印 HTML，这些名字作为**选择器文本**就在里面
    return ['data-ws2-editing', 'data-ws2-ce', 'data-ws2-selected', 'data-ws2-rangesel',
      'data-ws2-cell', 'data-ws2-menurow', 'data-ws2-menucol']
      .map((a) => [a, d.querySelectorAll('[' + a + ']').length]).filter(([, n]) => n > 0);
  }, printHtml);
  expect(leaked).toEqual([]);
});
