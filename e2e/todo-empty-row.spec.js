// 空待办行 0 高归一（2026-08-07 todo 深扫 C1）：磁盘/导入/粘贴来的空 `<li>`（含排版空白形态）在
// `.ws-todo`（list-style:none）下渲染成 0 高——整行隐身、点不到、光标落不进、勾选框叠到下一行字上，
// 且存盘原样保留不自愈。归一（attach + markDirty 两个出口，normalizeHostLi 扩展）：补占位 <br>。
// 对照面：Notion 空待办行是完整一行（h≈35，带勾选框和 To-do 占位）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2er-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(250);
}
async function openDoc(body) {
  const tag = 'er' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'd' + seq + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(400);
}
const heights = (ids) => page.evaluate((list) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const o = {};
  list.forEach((id) => {
    const el = d.getElementById(id);
    o[id] = el ? +el.getBoundingClientRect().height.toFixed(1) : 'MISSING';
  });
  return o;
}, ids);

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); app = null; }
});

test('ER-1 磁盘来的空待办行必须占一行高（紧凑 + 排版空白两种形态）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="t"><li id="ta">甲甲甲</li><li id="te"></li><li id="tw">\n    </li><li id="tc">丙丙丙</li></ul>');
  const h = await heights(['ta', 'te', 'tw', 'tc']);
  expect(h.te, `紧凑空行 <li></li> 应与实行同高，实得 ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(h.ta - 1);
  expect(h.tw, '排版空白空行 <li>\\n  </li> 同样').toBeGreaterThanOrEqual(h.ta - 1);
  // 空行与下一行不再重叠（C1 主症状：top 完全重合 = 隐身 + 勾选框叠字）
  const tops = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { te: d.getElementById('te').getBoundingClientRect().top, tc: d.getElementById('tc').getBoundingClientRect().top };
  });
  expect(tops.tc - tops.te, '空行与后续行必须错开一个行高').toBeGreaterThan(20);
});

test('ER-2 点在空行位置打字，字进空行自己（不再进下一行）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="t"><li id="ta">甲甲甲</li><li id="te"></li><li id="tc">丙丙丙</li></ul>');
  const fb = await page.locator('#doc-frame').boundingBox();
  const pt = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.getElementById('te').getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(fb.x + pt.x, fb.y + pt.y);
  await page.waitForTimeout(250);
  await page.keyboard.type('X');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return ['ta', 'te', 'tc'].map((id) => d.getElementById(id).textContent.trim());
  });
  expect(after, '字必须落进 te 自己').toEqual(['甲甲甲', 'X', '丙丙丙']);
});

test('ER-3 嵌套空行同样归一 + 往返自愈进磁盘', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="t"><li id="pa">父行<ul class="ws-todo" id="sub"><li id="k1">子一</li><li id="k2"></li><li id="k3">子三</li></ul></li></ul>');
  const h = await heights(['k1', 'k2', 'k3']);
  expect(h.k2, `嵌套空行占一行高，实得 ${JSON.stringify(h)}`).toBeGreaterThanOrEqual(h.k1 - 1);
  // 触发一次编辑让自动保存跑起来 → 磁盘上的空行应带占位 <br>（自愈，不再永远隐身）
  await frame.locator('#k1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await page.waitForTimeout(2000);
  const disk = await fs.readFile(docPath, 'utf8');
  expect(/<li id="k2">\s*<br\s*\/?>\s*<\/li>/.test(disk), '磁盘上的空行自愈成 <li><br></li>，实得: ' + (disk.match(/<li id="k2">[\s\S]*?<\/li>/) || ['(没找到)'])[0]).toBe(true);
  // 合规不被破坏
  const v = await page.evaluate((b) => {
    const dm = new DOMParser().parseFromString(b, 'text/html');
    const r = window.WS2SchemaRegistry.classify(dm);
    return { conform: r.conform };
  }, disk);
  expect(v.conform, '归一产物必须仍合规').toBe(true);
});

test('ER-4 回归：空壳宿主行既有归一不受影响（宿主行与嵌套首行纵向错开）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="t"><li id="host"><ul class="ws-todo" id="sub"><li id="k1">子一</li></ul></li><li id="tail">尾行</li></ul>');
  const g = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { host: d.getElementById('host').getBoundingClientRect().top, k1: d.getElementById('k1').getBoundingClientRect().top };
  });
  expect(g.k1 - g.host, '宿主行占自己那一行，嵌套首行在其下方').toBeGreaterThan(20);
});

test('ER-5 回归：图片行不被误判为空（不凭空多一空行）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="t"><li id="ia"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="x" width="20" height="20"></li><li id="ib">乙</li></ul>');
  const hasBr = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return !!d.getElementById('ia').querySelector('br');
  });
  expect(hasBr, '含 <img> 的行不许被补占位 <br>').toBe(false);
});
