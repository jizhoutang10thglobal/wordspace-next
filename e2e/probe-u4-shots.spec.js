// U4 收尾截图探针（不入库）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
const CLIP = { x: 180, y: 20, width: 900, height: 300 };
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2probe-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const shot = async (name) => { await page.waitForTimeout(220); await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP }); };
const FIX = '<ul class="ws-todo" id="L"><li id="r1">第一行待办</li><li id="r2">第二行待办</li><li id="r3">第三行待办</li></ul>';

test.beforeAll(async () => { await fs.mkdir(SHOTS, { recursive: true }); });
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('U4 截图：gutter 双钮（+ 与 ⋮⋮）', async () => {
  await launch();
  await openDoc(FIX);
  await frame.locator('#r2').hover();
  await page.waitForTimeout(200);
  await shot('u4-gutter.png');
});

test('U4 截图：点「+」插同列表新行', async () => {
  await launch();
  await openDoc(FIX);
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(200);
  await page.keyboard.type('这是点 + 插出来的新行');
  await page.waitForTimeout(200);
  await shot('u4-inserted-row.png');
  console.log('U4 SHOTS DONE');
});
