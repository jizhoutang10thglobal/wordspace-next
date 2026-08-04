// U1 收尾截图探针（不入库）：红圈=悬停位置，验证行级手柄跟随的实机效果。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
const CLIP = { x: 180, y: 20, width: 900, height: 360 };
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
const mark = (id) => page.evaluate((tid) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.getElementById(tid); if (!t) return;
  const r = t.getBoundingClientRect();
  const m = d.createElement('div');
  m.id = '__probe_cursor';
  m.setAttribute('style', `position:fixed;left:${Math.round(r.x + 120)}px;top:${Math.round(r.y + r.height / 2 - 9)}px;width:18px;height:18px;border:3px solid #E5484D;border-radius:50%;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,.85)`);
  d.documentElement.appendChild(m);
}, id);
const unmark = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.getElementById('__probe_cursor'); if (m) m.remove();
});
const shot = async (name, id) => {
  if (id) await mark(id);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP });
  if (id) await unmark();
};

test.beforeAll(async () => { await fs.mkdir(SHOTS, { recursive: true }); });
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('U1 效果截图', async () => {
  await launch();
  await openDoc('<p id="pre">上方段落</p><ul class="ws-todo"><li id="r1">第一行待办</li><li id="r2">第二行待办</li><li id="r3">第三行待办</li></ul><p id="post">下方段落</p>');
  await frame.locator('#r1').hover(); await page.waitForTimeout(250); await shot('u1-hover-r1.png', 'r1');
  await frame.locator('#r2').hover(); await page.waitForTimeout(250); await shot('u1-hover-r2.png', 'r2');
  await frame.locator('#r3').hover(); await page.waitForTimeout(250); await shot('u1-hover-r3.png', 'r3');

  await openDoc('<ul class="ws-todo"><li id="r1">父项<ul class="ws-todo"><li id="n1">嵌套子项</li></ul></li><li id="r2">第二项</li></ul>');
  await frame.locator('#n1').hover(); await page.waitForTimeout(250); await shot('u1-hover-nested.png', 'n1');
  console.log('U1 SHOTS DONE');
});
