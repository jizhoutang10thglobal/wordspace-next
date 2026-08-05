// 报告 / changelog 配图用的实机截图（非门，CI 不跑）。WS2_SHOTDIR 指定输出目录。
// 主题钉成浅色：宿主是深色主机，不钉的话出来的图跟官网浅色版式打架。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.WS2_SHOTDIR || path.join(os.tmpdir(), 'v0122shots');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  await fs.mkdir(OUT, { recursive: true });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2v0122-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1000, height: 620 });
  await page.evaluate(() => { try { window.ws2.setAppearance('light'); } catch (e) {} });
  await page.waitForTimeout(200);
}
const TODO_HEAD = '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style>';
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title>${TODO_HEAD}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(350);
}
// 裁到内容底边（含浮起的气泡/菜单），别把半屏空白也发到官网上
async function shot(name) {
  const clip = await page.evaluate(() => {
    const f = document.getElementById('doc-frame');
    const fb = f.getBoundingClientRect();
    const d = f.contentDocument;
    let bottom = 0;
    for (const e of d.documentElement.querySelectorAll('*')) { // 浮层挂在 documentElement 上，只扫 body 会把菜单裁掉
      const r = e.getBoundingClientRect();
      if (r.width && r.height) bottom = Math.max(bottom, r.bottom);
    }
    return { x: fb.x, y: fb.y, width: fb.width, height: Math.min(fb.height, Math.ceil(bottom) + 14) };
  });
  // scale:'device'：窗口在 HiDPI 上时出 2 倍图。⚠ 实测本机 Electron 窗口 DPR=1，这里等于空操作，
  // 出图就是 978px 宽（官网正文列宽约 690px，够用）。留着是为了换到 HiDPI 环境时自动变清楚。
  await page.screenshot({ path: path.join(OUT, name + '.png'), clip, scale: 'device' });
}
const selAcross = (a, b) => page.evaluate((q) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const A = d.querySelector(q.a), B = d.querySelector(q.b);
  const r = d.createRange(); r.setStart(A.firstChild || A, 0);
  const last = B.lastChild || B;
  r.setEnd(last, last.nodeType === 3 ? last.nodeValue.length : last.childNodes.length);
  const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  d.dispatchEvent(new Event('selectionchange'));
}, { a, b });

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('多选统一改颜色（含带子项的行）', async () => {
  await launch();
  // 前后各留一个空行给浮起的气泡/菜单腾地方；解释文字不进图，由官网的 figcaption 承担
  await openDoc('<p id="lead">&nbsp;</p>'
    + '<ul id="L"><li id="r2">季度目标</li><li id="r1">交付节奏<ul><li id="n1">每周一次发版</li><li id="n2">发版前真机验一遍</li></ul></li></ul>');
  await frame.locator('#r2').click(); await page.waitForTimeout(200);
  await selAcross('#r2', '#n2'); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const pop = [...d.querySelectorAll('.ws-fmtbar-swatches')][0];
    pop.style.display = 'flex';
    [...pop.querySelectorAll('button.ws-fmtbar-swatch')][2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const d = document.getElementById('doc-frame').contentDocument; d.getSelection().removeAllRanges(); });
  await page.waitForTimeout(300);
  await shot('0122-multi-color');
});

test('多段一起「转为」', async () => {
  await launch();
  await openDoc('<p id="lead">&nbsp;</p>'
    + '<p id="b1">调研竞品的交互粒度</p><p id="b2">对齐我们自己的手感</p><p id="b3">把结论写进 spec</p>'
    + '<p id="tail">&nbsp;</p>');
  await frame.locator('#b1').click(); await page.waitForTimeout(200);
  await selAcross('#b1', '#b3'); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const fb = d.querySelector('.ws-fmtbar');
    [...fb.querySelectorAll('button')].find((x) => /转为/.test(x.textContent || '')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fb.querySelector('.ws-fmtbar-menu').style.display = 'block';
  });
  await page.waitForTimeout(400);
  await shot('0122-multi-turn');
});

test('列表里 Esc 只选中当前这一行', async () => {
  await launch();
  await openDoc('<p id="lead">&nbsp;</p>'
    + '<ul id="L" class="ws-todo"><li id="r1">写发版说明</li><li id="r2">真机验一遍</li><li id="r3">打 tag</li></ul>');
  await frame.locator('#r2').click(); await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await shot('0122-esc-row');
});
