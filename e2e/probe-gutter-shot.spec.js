// 一次性截图探针（不入库）：gutter 修复证据图——红圈=鼠标在嵌套 ul 容器像素带上，手柄留在嵌套行。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
let app, page, frame, tmpDir;

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('gutter 修复证据图', async () => {
  await fs.mkdir(SHOTS, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2probe-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title><style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style></head><body><ul class="ws-todo"><li id="r1">父项带嵌套<ul class="ws-todo"><li id="n1">嵌套子项甲</li><li id="n2">嵌套子项乙</li></ul></li><li id="r2">第二项</li></ul></body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);

  await frame.locator('#n1').hover();
  await page.waitForTimeout(150);
  const frameBox = await page.locator('#doc-frame').boundingBox();
  const pt = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const n1 = d.getElementById('n1');
    const nul = n1.parentElement;
    const r = n1.getBoundingClientRect();
    const ur = nul.getBoundingClientRect();
    const cy = Math.round(r.top + r.height / 2);
    for (let x = Math.round(ur.left) + 1; x < Math.round(r.left); x += 2) {
      if (d.elementFromPoint(x, cy) === nul) return { x, cy };
    }
    return null;
  });
  expect(pt).not.toBeNull();
  await page.mouse.move(frameBox.x + pt.x + 30, frameBox.y + pt.cy);
  await page.mouse.move(frameBox.x + pt.x, frameBox.y + pt.cy);
  await page.waitForTimeout(150);
  await page.evaluate((q) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const m = d.createElement('div');
    m.id = '__probe_cursor';
    m.setAttribute('style', `position:fixed;left:${q.x - 9}px;top:${q.cy - 9}px;width:18px;height:18px;border:3px solid #E5484D;border-radius:50%;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,.85)`);
    d.documentElement.appendChild(m);
  }, pt);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'u1-gutter-fix.png'), clip: { x: 180, y: 20, width: 900, height: 300 } });
  console.log('GUTTER SHOT DONE');
});
