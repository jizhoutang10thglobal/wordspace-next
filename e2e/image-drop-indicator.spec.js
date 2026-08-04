// I10（Notion 粒度对拍第二批）：从 Finder 拖图片进来，此前 dragover 只设 dropEffect 就 return ——
// 全程零落点反馈，用户松手前不知道图会落在哪；而 docs/features/doc-images.md 早写了「落点 = 块间插入线」。
// 铁则（I4 刚用血换的）：指示线必须由 dropAnchor 本人算 —— 复制一份坐标逻辑就是又一个「画的≠做的」。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2dropind-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
const DOC = '<p id="p1">第一段</p><p id="p2">第二段</p><p id="p3">第三段</p>';

// 合成一次「OS 图片文件」dragover：真造 File 进 DataTransfer，dt.types 才含 'Files'。
// where: 'upper'|'lower' —— 目标块的上半/下半（dropAnchor 的翻转点是块的垂直中线）
const fileDragOver = (sel, where) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const t = d.querySelector(q.sel);
  const r = t.getBoundingClientRect();
  const y = q.where === 'upper' ? r.top + r.height * 0.25 : r.bottom - r.height * 0.25;
  const c = d.createElement('canvas'); c.width = 8; c.height = 8;
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
  d.body.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 20), clientY: Math.round(y) }));
  const marked = d.querySelector('[data-ws2-drop]');
  // 强断言：不查属性存在，查那条线**真被画出来**（::after 的 background 是渐变，无线时为 none）
  const bg = marked ? getComputedStyle(marked, '::after').backgroundImage : null;
  return { markedId: marked ? marked.id : null, place: marked ? marked.getAttribute('data-ws2-drop') : null, hasLine: !!bg && bg !== 'none' && bg.indexOf('gradient') !== -1, dropY: Math.round(y) };
}, { sel, where });

const dropFileAt = (dropY) => page.evaluate((y) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const c = d.createElement('canvas'); c.width = 8; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = '#1e8e3e'; g.fillRect(0, 0, 8, 8);
  const bin = atob(c.toDataURL('image/png').split(',')[1]);
  const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'drop.png', { type: 'image/png' }));
  d.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: y }));
}, dropY);

const order = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const dropMarks = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('[data-ws2-drop]')].map((el) => (el.id || el.tagName) + ':' + el.getAttribute('data-ws2-drop'));
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('I10-1 拖文件经过时出现落点插入线（此前全程零反馈）', async () => {
  await launch();
  await openDoc(DOC);
  const r = await fileDragOver('#p2', 'lower');
  expect(r.markedId).toBe('p2');
  expect(r.place).toBe('bottom');
  expect(r.hasLine).toBe(true);
});

test('I10-2 翻转点在块的垂直中线：上半区落到上一块之后', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'upper')).markedId).toBe('p1'); // 插在 p1 之后 = p1 与 p2 之间
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
});

test('I10-3 画的就是做的：线画在谁下面，图就落在谁后面', async () => {
  await launch();
  await openDoc(DOC);
  const r = await fileDragOver('#p2', 'upper');
  expect(r.markedId).toBe('p1');
  await dropFileAt(r.dropY);
  await expect.poll(async () => (await order()).length, { timeout: 8000 }).toBe(4);
  expect(await order()).toEqual(['P#p1', 'IMG', 'P#p2', 'P#p3']); // 线在 p1 下 → 图落 p1 之后
  expect(await dropMarks()).toEqual([]); // 落完线要收
});

test('I10-4 拖出窗口不松手：幽灵线自己收', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    d.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: null }));
  });
  expect(await dropMarks()).toEqual([]);
});

test('I10-5 非图片文件被拒时不留线', async () => {
  await launch();
  await openDoc(DOC);
  expect((await fileDragOver('#p2', 'lower')).markedId).toBe('p2');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' }));
    const r = d.querySelector('#p2').getBoundingClientRect();
    d.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: Math.round(r.bottom - 4) }));
  });
  await page.waitForTimeout(300);
  expect(await dropMarks()).toEqual([]);
  expect(await order()).toEqual(['P#p1', 'P#p2', 'P#p3']); // 非图片不插东西
});
