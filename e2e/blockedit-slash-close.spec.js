// Wendi 2026-07-22 视频：打「/」弹出块类型菜单后，点别的地方菜单不关——只有把「/」删掉才关。
// 理论上点菜单外任何地方都该关。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..'); let app, page, frame, tmpDir;
async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2sc-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const p = path.join(tmpDir, 'doc.html'); await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
  frame = page.frameLocator('#doc-frame'); await expect(frame.locator('body')).toBeVisible(); await page.waitForTimeout(400); return p;
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

const DOC = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>'
  + '<h1 id="h">标题</h1><p id="p1">正文一。</p><p id="p2">正文二。</p></body></html>';

test('斜杠菜单：点别的块 → 关闭', async () => {
  await launch(); await openDoc(DOC);
  await frame.locator('#p1').click(); await page.keyboard.press('End');
  await page.keyboard.type('/');
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu'), '打 / 后菜单应打开').toBeVisible();
  await frame.locator('#p2').click();               // 点别的块
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu'), '点别的块后斜杠菜单应关闭').toBeHidden();
});

test('斜杠菜单：点同块别处（不点菜单项）→ 关闭', async () => {
  await launch(); await openDoc(DOC);
  await frame.locator('#p1').click(); await page.keyboard.press('End');
  await page.keyboard.type('/');
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('#h').click();                // 点标题
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu'), '点菜单外任何地方都应关').toBeHidden();
});

test('斜杠菜单：点菜单项本身仍能选中（别被关闭逻辑误伤）', async () => {
  await launch(); await openDoc(DOC);
  await frame.locator('#p2').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); // 新建空块
  await page.keyboard.type('/');
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '引用' }).click();   // 选「引用」
  await page.waitForTimeout(180);
  await expect(frame.locator('.ws-slashmenu'), '选完项菜单关').toBeHidden();
  expect(await frame.locator('body').evaluate(() => !!document.querySelector('blockquote')), '应真转成引用块').toBe(true);
});
