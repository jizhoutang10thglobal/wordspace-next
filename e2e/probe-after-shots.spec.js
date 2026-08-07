// 修复后实机截图（Colin 2026-08-03 拍板：bug 结论必须配实机演示，不接受纯文字断言）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOT_DIR || os.tmpdir();
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2shot-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 720 });
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
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: 150, y: 100, width: 900, height: 190 } }); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; }
});

test('S1 用户原路径：一行 todo → 回车 → 打字（修复后）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="r1">第一行</li></ul>');
  await frame.locator('#r1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('第二行');
  await page.waitForTimeout(350);
  await shot('after-01-editing-row2');
  const h = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, w = d.defaultView;
    for (const el of d.querySelectorAll('*')) {
      const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(w.getComputedStyle(el).backgroundColor);
      if (m && m[1] === '0' && m[4] > 0.005 && m[4] < 0.025) return { tag: el.tagName, h: +el.getBoundingClientRect().height.toFixed(1) };
    }
    return null;
  });
  console.log('=== S1 承载编辑底色的元素:', JSON.stringify(h));
});

test('S2 三行列表逐行编辑（修复后）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>买牛奶</li><li>写周报</li><li>订机票</li></ul>');
  await frame.locator('#lst > li').nth(1).click();
  await page.waitForTimeout(350);
  await shot('after-02-three-rows-edit-middle');
});

test('S3 Esc 行选中：勾选框在框内（修复后）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li data-checked="true">买牛奶</li><li>写周报</li><li>订机票</li></ul>');
  await frame.locator('#lst > li').nth(1).click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await shot('after-03-esc-rowselect-checkbox-inside');
});

test('S4 跨块选区：段落 → 列表第二行（修复后）', async () => {
  await launch();
  await openDoc('<p id="p0">下周要做的事：</p><ul id="lst" class="ws-todo"><li id="r1">买牛奶</li><li id="r2">写周报</li><li id="r3">订机票</li><li id="r4">交房租</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument;
    const first = (el) => d.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const r = d.createRange();
    r.setStart(first(d.querySelector('#p0')), 0);
    const t = first(d.querySelector('#r2')); r.setEnd(t, t.textContent.length);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(400);
  await shot('after-04-rangesel-partial-rows');
});
