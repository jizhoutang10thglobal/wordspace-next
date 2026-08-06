// 跨块选区罩到列表的**部分**行时，那些行要有与其他块同款的块级蓝底（U3）。
// 病灶：refreshRangeSel 的 walk 只遍历 blocksInScope（= root.children），<li> 永远进不了集合——
// 「从段落拖到列表第二行」这种部分覆盖一个块级标记都不打，列表是唯一拿不到跨块蓝底的块类型，
// 与 PR #314 定的「跨块选区整行蓝底对齐 Notion」口径不一致。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rsrow-'));
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
// 程序化造跨块选区（page.mouse 在 iframe 里驱动拖选会卡死，PR #395 记过这坑）
const setRange = (a, z) => frame.locator('body').evaluate((b, [s, e]) => {
  const d = b.ownerDocument;
  const first = (el) => d.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  const r = d.createRange();
  r.setStart(first(d.querySelector(s)), 0);
  const t = first(d.querySelector(e)); r.setEnd(t, t.textContent.length);
  const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, [a, z]);

const marked = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument;
  return [...d.querySelectorAll('[data-ws2-rangesel]')].map((e) => e.tagName + (e.id ? '#' + e.id : ''));
});
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; frame = null; }
});

test('RS-1 部分覆盖：从段落选到第 2 行 → 只有第 1、2 行有蓝底', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li><li id="r4">第四行</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#r2');
  await page.waitForTimeout(350);
  const m = await marked();
  expect(m, '段落 + 被罩的两行都有标记，没被罩的行没有').toEqual(['P#p0', 'LI#r1', 'LI#r2']);
});

test('RS-2 完整覆盖不回归：整张列表被罩仍是整个 UL 一个标记', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li></ul><p id="p1">后面段落</p>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#p1');
  await page.waitForTimeout(350);
  const m = await marked();
  expect(m, '整张列表被罩 → 标 UL 本身，不下沉到行（既有行为）').toEqual(['P#p0', 'UL#lst', 'P#p1']);
});

test('RS-3 相邻两行分得开：光晕不得叠成一条', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#r2');
  await page.waitForTimeout(350);
  const g = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument, win = d.defaultView;
    const a = d.querySelector('#r1'), c = d.querySelector('#r2');
    const ar = a.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const sh = win.getComputedStyle(a).boxShadow;
    const m = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(sh);
    return { gap: +(cr.top - ar.bottom).toFixed(2), spread: m ? parseFloat(m[4]) : null, shadow: sh };
  });
  expect(g.spread, '行级蓝底必须有自己的光晕规则').not.toBeNull();
  // 两行各自向外扩 spread，合计 2*spread 必须小于行距，否则中间叠出更深的带、两行糊成一条
  expect(g.spread * 2, `相邻行光晕合计(${g.spread * 2}) 必须小于行距(${g.gap})`).toBeLessThan(g.gap);
});

test('RS-4 嵌套：只罩到子行时标子行，不上卷到宿主行', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="host">宿主行<ul class="ws-todo"><li id="s1">子甲</li><li id="s2">子乙</li></ul></li></ul>');
  await frame.locator('#s1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#s1');
  await page.waitForTimeout(350);
  const m = await marked();
  expect(m, '宿主行只罩到一半 → 不标它，钻进去标被完整罩住的子甲').toEqual(['P#p0', 'LI#s1']);
});

test('RS-6 画的 == 做的：上色作用的行集合，与蓝底标出的行集合逐行一致', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li><li id="r3">第三行</li><li id="r4">第四行</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#r2');
  await page.waitForTimeout(350);

  const painted = (await marked()).filter((x) => x.startsWith('LI#'));
  expect(painted, '前置：蓝底标在第 1、2 行').toEqual(['LI#r1', 'LI#r2']);

  await expect(frame.locator('.ws-fmtbar')).toBeVisible();
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches:visible .ws-fmtbar-swatch').nth(1).click();
  await page.waitForTimeout(350);

  const done = await frame.locator('body').evaluate((b) => {
    const d = b.ownerDocument;
    return ['r1', 'r2', 'r3', 'r4'].filter((id) => d.querySelector('#' + id + ' span[style*="color"]')).map((id) => 'LI#' + id);
  });
  // 这条才是实质：高亮画到哪，操作就必须落到哪——多画一行是误导，少画一行是漏报（PR #395 I4 的教训）
  expect(done, '上色作用的行集合必须与蓝底一致').toEqual(painted);
});

test('RS-5 收得掉 + 零入盘', async () => {
  await launch();
  await openDoc('<p id="p0">前面段落</p><ul id="lst" class="ws-todo"><li id="r1">第一行</li><li id="r2">第二行</li></ul>');
  await frame.locator('#r1').click();
  await page.waitForTimeout(150);
  await setRange('#p0', '#r1');
  await page.waitForTimeout(350);
  expect((await marked()).length).toBeGreaterThan(0);

  await frame.locator('#r2').click(); // 塌缩选区
  await page.waitForTimeout(300);
  expect(await marked(), '选区塌缩后标记全清').toEqual([]);

  const html = await serialize();
  expect(html, '磁盘字节不含跨块选区标记').not.toContain('data-ws2-rangesel');
});
