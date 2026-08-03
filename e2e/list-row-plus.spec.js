// U4 gutter「+」快捷插入钮（粒度对齐 D，plan 2026-08-03-002）：
// 行锚=插同列表新行、块=插空正文块；⌥ 点击插上方；与手柄同显同隐；插入后光标落新块/新行。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2plus-'));
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
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const bodyOrder = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const rowTexts = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelector(s).children].filter((x) => x.tagName === 'LI').map((li) => (li.textContent || '').trim());
}, sel);
const gutterVisible = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip'), p = d.querySelector('.ws-plus');
  return { grip: g && g.style.display !== 'none', plus: p && p.style.display !== 'none' };
});
async function hoverAndPlus(sel, alt) {
  await frame.locator(sel).hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-plus').click(alt ? { modifiers: ['Alt'] } : {});
  await page.waitForTimeout(250);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('「+」与手柄同显同隐、位于手柄左侧', async () => {
  await launch();
  await openDoc('<p id="p1">段落</p>');
  expect(await gutterVisible(), '初始都不显').toEqual({ grip: false, plus: false });
  await frame.locator('#p1').hover();
  await page.waitForTimeout(200);
  expect(await gutterVisible(), '悬停后都显').toEqual({ grip: true, plus: true });
  const geo = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const g = d.querySelector('.ws-grip').getBoundingClientRect();
    const p = d.querySelector('.ws-plus').getBoundingClientRect();
    return { gx: Math.round(g.x), px: Math.round(p.x), gy: Math.round(g.y), py: Math.round(p.y) };
  });
  expect(geo.px, '「+」在手柄左侧').toBeLessThan(geo.gx);
  expect(Math.abs(geo.py - geo.gy), '与手柄同一水平线').toBeLessThanOrEqual(1);
  expect((await serialize()).includes('ws-plus'), '交互态不入盘').toBe(false);
});

test('段落上点「+」：下方插空正文块并进编辑', async () => {
  await launch();
  await openDoc('<p id="p1">上</p><p id="p2">下</p>');
  await hoverAndPlus('#p1');
  expect((await bodyOrder()).join(','), '新段落插在 p1 之后').toBe('P#p1,P,P#p2');
  await page.keyboard.type('新块');
  await expect.poll(async () => (await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children[1].textContent.trim())), { message: '光标落新块' }).toBe('新块');
  expect(await conformOf(await serialize())).toBe(true);
});

test('⌥ 点「+」：插到上方', async () => {
  await launch();
  await openDoc('<p id="p1">上</p><p id="p2">下</p>');
  await hoverAndPlus('#p2', true);
  expect((await bodyOrder()).join(','), '新段落插在 p2 之前').toBe('P#p1,P,P#p2');
  await page.keyboard.type('插上方');
  await expect.poll(async () => (await page.evaluate(() => document.getElementById('doc-frame').contentDocument.body.children[1].textContent.trim()))).toBe('插上方');
});

test('列表行上点「+」：插同列表新行（不是列表后段落）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await hoverAndPlus('#r1');
  expect((await bodyOrder()).join(','), '不新增块').toBe('UL#L');
  const t = await rowTexts('#L');
  expect(t.length, '多一行').toBe(3);
  expect(t[1], '新行在第一行之下且为空').toBe('');
  await page.keyboard.type('插进来的行');
  await expect.poll(async () => (await rowTexts('#L'))[1], { message: '光标落新行' }).toBe('插进来的行');
  expect(await conformOf(await serialize())).toBe(true);
});

test('列表行 ⌥ 点「+」：插到该行上方', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await hoverAndPlus('#r2', true);
  const t = await rowTexts('#L');
  expect(t.length).toBe(3);
  expect(t[1], '新空行在第二行之上').toBe('');
  await page.keyboard.type('夹进来');
  await expect.poll(async () => (await rowTexts('#L')).join('|')).toBe('一|夹进来|二');
  expect(await conformOf(await serialize())).toBe(true);
});

test('嵌套行上点「+」：插进同一层嵌套子列表', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">父项<ul class="ws-todo" id="S"><li id="n1">嵌套甲</li></ul></li><li id="r2">二</li></ul>');
  await hoverAndPlus('#n1');
  const nested = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { sub: d.querySelectorAll('#S > li').length, top: d.querySelectorAll('#L > li').length };
  });
  expect(nested.sub, '嵌套子列表多一行').toBe(2);
  expect(nested.top, '顶层行数不变').toBe(2);
  await page.keyboard.type('嵌套乙');
  await expect.poll(async () => (await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('#S > li')].map((li) => li.textContent.trim()).join('|')))).toBe('嵌套甲|嵌套乙');
  expect(await conformOf(await serialize())).toBe(true);
});

test('Esc 灰选整列表后点「+」：块作用域插列表后的段落', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await frame.locator('#r2').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(250);
  expect((await bodyOrder()).join(','), '列表后新增段落块').toBe('UL#L,P');
  expect((await rowTexts('#L')).length, '列表行数不变').toBe(2);
  expect(await conformOf(await serialize())).toBe(true);
});

test('插入 undo 一步还原（行与块两路）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="L"><li id="r1">一</li></ul>');
  await hoverAndPlus('#r1');
  await expect.poll(async () => (await rowTexts('#L')).length).toBe(2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await expect.poll(async () => (await rowTexts('#L')).length, { message: 'undo 一步撤掉新行' }).toBe(1);
});
