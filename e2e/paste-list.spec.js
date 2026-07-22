// 多行粘贴进列表：每行必须成为独立 <li>，绝不并成一行 / 丢行（bug2，Wendi 2026-07-22 报）。
// 旧逻辑：onPaste 对列表调通用 splitBlock（按 editingEl.tagName=UL 建新 <ul>）→ 首行并进当前 li、
// 后续行灌进空 ul 丢失；灰选态（!editingEl）更是 lines.join(' ') 空格拼成一行。CI 用 xvfb 真启动 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2paste-'));
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
// 粘贴键跨平台：mac=Cmd+V / Linux CI=Ctrl+V（原生 CmdOrCtrl+V accelerator）。
async function pasteMultiline(t) {
  await app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
  await page.keyboard.press('ControlOrMeta+v');
}
const liTexts = (ulSel) => frame.locator('body').evaluate((body, sel) => [...document.querySelectorAll(sel + ' > li')].map((li) => li.textContent), ulSel);

const TWO = '第一个bullet point\n第二个bullet point，注意，它应该新起一个点才对';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('多行粘贴进 todo（编辑态）：每行成独立 <li>，同一 ul、不丢行', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="li1">打头</li></ul>');
  await frame.locator('#li1').click();
  await page.keyboard.press('End');
  await pasteMultiline(TWO);
  // poll 等粘贴落 DOM（慢 CI 固定睡会读到粘贴前）
  await expect.poll(async () => (await liTexts('ul.ws-todo')).join('｜'), { message: '多行应成 2 个独立 li（首行接当前项、次行新起一项）' })
    .toBe('打头第一个bullet point｜第二个bullet point，注意，它应该新起一个点才对');
  // 只有一个 ul（没被劈成多个 ul）+ 没有空格拼接（无 li 同时含两个 bullet）
  expect(await frame.locator('ul.ws-todo').count(), '不许劈成多个 ul').toBe(1);
  const merged = await frame.locator('body').evaluate(() => [...document.querySelectorAll('li')].some((li) => /第一个bullet point 第二个/.test(li.textContent)));
  expect(merged, '不许把两个 bullet 空格拼进同一行').toBe(false);
  // 磁盘字节合规（reparse 判，不信 meta）
  expect(await conformOf(await serialize())).toBe(true);
});

test('多行粘贴进 todo（灰选态 !editingEl）：不再空格拼成一行', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="li1">打头</li></ul>');
  await frame.locator('#li1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape'); // 灰选整块 → editingEl=null
  await page.waitForTimeout(150);
  await pasteMultiline(TWO);
  await expect.poll(async () => (await liTexts('ul.ws-todo')).length, { message: '灰选态多行粘贴也应成多个 li' }).toBe(2);
  const merged = await frame.locator('body').evaluate(() => [...document.querySelectorAll('li')].some((li) => /第一个bullet point 第二个/.test(li.textContent)));
  expect(merged, '灰选态也不许空格拼接').toBe(false);
  expect(await conformOf(await serialize())).toBe(true);
});

test('回归：多行粘贴进普通文本块 → 仍分成多个段落块', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // 空文本块，编辑态
  await page.waitForTimeout(120);
  await pasteMultiline(TWO);
  await expect.poll(async () => frame.locator('p').count(), { message: '文本块多行粘贴应分成多段' }).toBe(3);
  expect(await conformOf(await serialize())).toBe(true);
});
