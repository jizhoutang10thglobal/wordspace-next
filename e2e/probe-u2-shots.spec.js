// U2 收尾截图探针（不入库）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
const CLIP = { x: 180, y: 20, width: 900, height: 330 };
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
const shot = async (name) => { await page.waitForTimeout(200); await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP }); };

test.beforeAll(async () => { await fs.mkdir(SHOTS, { recursive: true }); });
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('U2 截图：拖拽中指示线 + 重排结果', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">第一行待办</li><li id="r2">第二行待办</li><li id="r3">第三行待办</li></ul>');
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  // 拖拽中：dragstart + dragover r1 上半区，保持不 drop
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const r1 = d.getElementById('r1');
    const dt = new DataTransfer();
    window.__dt = dt;
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = r1.getBoundingClientRect();
    r1.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.top + 3 }));
  });
  await shot('u2-drag-mid.png');
  // 完成 drop
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const r1 = d.getElementById('r1');
    const dt = window.__dt;
    const r = r1.getBoundingClientRect();
    r1.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.top + 3 }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await shot('u2-after-reorder.png');
});

test('U2 截图：拆出成独立块', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">第一行待办</li><li id="r2">第二行待办</li></ul><p id="post">下方段落</p>');
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const post = d.getElementById('post');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = post.getBoundingClientRect();
    post.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.bottom - 3 }));
    post.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.bottom - 3 }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await shot('u2-splitout.png');
  console.log('U2 SHOTS DONE');
});
