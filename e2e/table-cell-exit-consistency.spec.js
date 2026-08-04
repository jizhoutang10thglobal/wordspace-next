// 「从格内上卷到整表灰选」的三条路径必须同解（对抗审查抓出：原修法只堵了 ⌘A 二档一个入口）。
// 三条路径：⌘A 第二档 / Esc / 从格内点 ⋮⋮ 开块菜单。
// 强断言纪律：不查属性，查**用户能观察到的后果**——残留选中文本、⌘C 实际拿到什么、⌘X 是否兑现。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

const DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' +
  '<p id="p1">前文</p><table class="ws-table"><thead><tr><th scope="col">甲</th><th scope="col">乙</th></tr></thead>' +
  '<tbody><tr><td id="c11">十一</td><td id="c12">十二</td></tr>' +
  '<tr><td id="c21">廿一</td><td id="c22">廿二格文字</td></tr></tbody></table><p id="p2">后文</p></body></html>';

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2exit-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  const p = path.join(tmpDir, 'd.html');
  await fs.writeFile(p, DOC, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#p1')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
}
const state = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.getSelection();
  return {
    selText: String(s || '').replace(/\s+/g, ''),
    rangeCount: s ? s.rangeCount : 0,
    selected: (d.querySelector('[data-ws2-selected]') || {}).tagName || null,
    cells: d.querySelectorAll('[data-ws2-cell]').length,
  };
});
async function enterCell() {
  await frame.locator('#c22').click();
  await page.waitForTimeout(240);
  await page.keyboard.press('Meta+a'); // 一档：选中本格文字（制造「残留选中」的前提）
  await page.waitForTimeout(140);
}
async function openMenuFromGrip() {
  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.querySelector('#c22').getBoundingClientRect();
    return { x: b.x + 20, y: b.y + b.height / 2 };
  });
  await page.mouse.move(5, 5); await page.waitForTimeout(60);
  await page.mouse.move(box.x + r.x, box.y + r.y, { steps: 6 });
  const g = await page.waitForFunction(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('.ws-grip');
    if (!el || el.style.display === 'none') return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }, null, { timeout: 5000 }).then((h) => h.jsonValue());
  await page.mouse.click(box.x + g.x, box.y + g.y);
  await frame.locator('.ws-blockmenu-item').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
}

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null;
});

test('三条路径到达整表灰选时状态一致：都不留格内残留选中', async () => {
  await launch();
  const got = {};

  await enterCell(); await page.keyboard.press('Meta+a'); await page.waitForTimeout(160);
  got.cmdA = await state();

  await frame.locator('#p1').click(); await page.waitForTimeout(160); // 复位
  await enterCell(); await page.keyboard.press('Escape'); await page.waitForTimeout(180);
  got.esc = await state();

  await frame.locator('#p1').click(); await page.waitForTimeout(160);
  await enterCell(); await openMenuFromGrip();
  got.menu = await state();

  for (const k of ['cmdA', 'esc', 'menu']) {
    expect(got[k].selected, k).toBe('TABLE');
    expect(got[k].cells, k).toBe(0);
    expect(got[k].selText, k).toBe(''); // ← 三条路径都不许留格内那段蓝底
  }
});

test('灰选整块态 ⌘X 兑现（复制整块 + 删掉它），不是静默空转', async () => {
  await launch();
  await enterCell();
  await page.keyboard.press('Meta+a'); // 二档：整表灰选
  await page.waitForTimeout(180);
  const before = await state();
  expect(before.selected).toBe('TABLE');

  await page.keyboard.press('Meta+x');
  await page.waitForTimeout(360);
  const after = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { tables: d.querySelectorAll('table').length, body: d.body.textContent.replace(/\s+/g, '') };
  });
  expect(after.tables).toBe(0);            // 表真被剪走（此前是静默空转、表原地不动）
  expect(after.body).toContain('前文');    // 相邻块没被误伤
  expect(after.body).toContain('后文');
  // 剪贴板拿到的是整表内容（而不是上一次的旧剪贴板残留）
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.replace(/\s+/g, '')).toContain('廿二格文字');
});
