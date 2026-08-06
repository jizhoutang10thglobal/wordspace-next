// toggle 维度报告截图探针（不入库）。红圈画外层窗口。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises'); const path = require('path'); const os = require('os');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
const CLIP = { x: 180, y: 20, width: 900, height: 330 };
let app, page, frame, tmpDir;
async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2tgshot-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'd-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible(); await page.waitForTimeout(450);
}
const shot = async (n) => { await page.waitForTimeout(220); await page.screenshot({ path: path.join(SHOTS, n), clip: CLIP }); };
test.beforeAll(async () => { await fs.mkdir(SHOTS, { recursive: true }); });
test.afterEach(async () => { if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); } });

const D = '<details open id="D"><summary>项目周报</summary><p id="b1">已有的第一段</p><p>第二段</p></details>';

test('toggle：标题 Enter 改前效果（模拟旧行为=光标跳到已有块）', async () => {
  await launch(); await openDoc(D);
  await frame.locator('#b1').click();
  await page.keyboard.press('Home');
  await shot('tg-enter-before.png');
});
test('toggle：标题 Enter 改后（新建空块）', async () => {
  await launch(); await openDoc(D);
  await frame.locator('#D summary').click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('按 Enter 之后直接写的新内容');
  await shot('tg-enter-after.png');
});
test('toggle：空态占位 + 淡三角', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>空的折叠块</summary><p></p></details><details open id="E"><summary>有内容的折叠块</summary><p>里面有东西</p></details>');
  await shot('tg-empty-after.png');
  console.log('TG SHOTS DONE');
});
