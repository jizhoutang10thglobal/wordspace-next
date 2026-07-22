// 斜杠菜单在非空块插块，种的是 i18n 占位文本（「列表项」/「引用内容」/「新标题」/「提示内容」），
// 且光标折叠到占位**之前** → 打字前插「买菜列表项」、占位随自动保存入盘（create-2）。
// 修法：newBlock 四分支改种空产物（补 <br> 保 caret）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2slash-'));
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
// 在非空块末尾打 / 开斜杠菜单，选指定项 → 非空块分支 insertAfter 新块。
async function slashInsert(label) {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('斜杠插待办：不种占位文本、打字即落进项（create-2）', async () => {
  await launch();
  await openDoc('<p id="p1">前面有内容</p>');
  await slashInsert('待办列表');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '插出一个 ws-todo 项' }).toBe(1);
  await page.keyboard.type('买菜');
  await expect.poll(() => frame.locator('ul.ws-todo > li').first().textContent(), { message: '打字直接落进项、不前插占位' }).toBe('买菜');
  const html = await serialize();
  expect(html.includes('列表项'), '磁盘不含占位词「列表项」').toBe(false);
  expect(await conformOf(html)).toBe(true);
});

test('斜杠插引用：不种「引用内容」占位、打字即落', async () => {
  await launch();
  await openDoc('<p id="p1">前面有内容</p>');
  await slashInsert('引用');
  await expect.poll(() => frame.locator('blockquote').count()).toBe(1);
  await page.keyboard.type('名言');
  await expect.poll(() => frame.locator('blockquote').first().textContent()).toBe('名言');
  const html = await serialize();
  expect(html.includes('引用内容'), '磁盘不含占位词「引用内容」').toBe(false);
  expect(await conformOf(html)).toBe(true);
});

test('斜杠插标题：不种「新标题」占位、打字即落', async () => {
  await launch();
  await openDoc('<p id="p1">前面有内容</p>');
  await slashInsert('标题 2');
  await expect.poll(() => frame.locator('h2').count()).toBe(1);
  await page.keyboard.type('章节');
  await expect.poll(() => frame.locator('h2').first().textContent()).toBe('章节');
  const html = await serialize();
  expect(html.includes('新标题'), '磁盘不含占位词「新标题」').toBe(false);
  expect(await conformOf(html)).toBe(true);
});

test('斜杠插提示（callout）：不种「提示内容」占位、打字即落', async () => {
  await launch();
  await openDoc('<p id="p1">前面有内容</p>');
  await slashInsert('提示');
  await expect.poll(() => frame.locator('.ws-callout').count()).toBe(1);
  await page.keyboard.type('注意');
  await expect.poll(() => frame.locator('.ws-callout').first().textContent()).toBe('注意');
  const html = await serialize();
  expect(html.includes('提示内容'), '磁盘不含占位词「提示内容」').toBe(false);
  expect(await conformOf(html)).toBe(true);
});
