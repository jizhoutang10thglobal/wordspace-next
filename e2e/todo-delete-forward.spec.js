// 块末 Delete 前向合并撞上列表全 no-op，与 Backspace 侧（bug3 #319）不对称（select-3）。
// 病根：Delete 分支两处显式排除列表 + 原生跨不出独立块边界。修法：镜像 Backspace 三场景
// （末项尾并下一块 / 段末吞列表首项 / 空 li 并下一项）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2delfwd-'));
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

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('末项尾 Delete 吞下一段落：内容并入末项、光标在接合点（select-3 a）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li id="last">丙</li></ul><p id="p9">尾段</p>');
  await frame.locator('#last').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#p9').count(), { message: '下一段落应被吞掉' }).toBe(0);
  expect(await frame.locator('#last').textContent(), '内容并入末项').toBe('丙尾段');
  await page.keyboard.type('x'); // 光标应在接合点（丙 与 尾段 之间）
  await expect.poll(() => frame.locator('#last').textContent(), { message: '光标在接合点，x 落中间' }).toBe('丙x尾段');
  expect(await conformOf(await serialize())).toBe(true);
});

test('段末 Delete 吞列表首项：首项并入段落、列表剩余保留、光标在接合点（select-3 b）', async () => {
  await launch();
  await openDoc('<p id="p0">前段</p><ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li><li>丙</li></ul>');
  await frame.locator('#p0').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '首项行内内容并入段落' }).toBe('前段甲');
  expect(await frame.locator('#lst > li').count(), '列表剩 2 项').toBe(2);
  await page.keyboard.type('x');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '光标在接合点' }).toBe('前段x甲');
  expect(await conformOf(await serialize())).toBe(true);
});

test('空 li Delete：下一项并上来（select-3 c）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="e"><br></li><li>乙</li></ul>');
  await frame.locator('#e').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => frame.locator('#lst > li').count(), { message: '空项吞下一项 → 剩 1 项' }).toBe(1);
  expect(await frame.locator('#lst > li').first().textContent()).toBe('乙');
  expect(await conformOf(await serialize())).toBe(true);
});

test('末项尾 Delete 遇不可并块（图片）：安全 no-op、不崩', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="last">丙</li></ul><figure id="fig"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></figure>');
  await frame.locator('#last').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  expect(await frame.locator('#lst > li').count(), '不可并 → 列表不变').toBe(1);
  expect(await frame.locator('#fig').count(), '图片块保留').toBe(1);
  expect(await conformOf(await serialize())).toBe(true);
});

test('回归：首项行首 Backspace 并入上一段落（#319 未回归）', async () => {
  await launch();
  await openDoc('<p id="p0">上</p><ul id="lst" class="ws-todo"><li id="f">甲</li></ul>');
  await frame.locator('#f').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => frame.locator('#p0').textContent(), { message: '#319：首项行首 Backspace 并入上块' }).toBe('上甲');
  expect(await conformOf(await serialize())).toBe(true);
});
