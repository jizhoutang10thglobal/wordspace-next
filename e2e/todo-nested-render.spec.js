// 嵌套 bullet「转为」todo：裸嵌套子列表在 ws-todo list-style:none 继承下无 marker、浏览器直开显圆点（两侧不一致，create-4）。
// 修法：CSS 从 descendant-scoped 改 class-scoped——todo 语义只按 class 生效，裸嵌套非 todo 列表显式恢复圆点；
// Tab 缩进产生的 ws-todo 子列表（D3）保持无圆点 + 可勾。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2nested-'));
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
async function clickGutter(liSel) {
  const box = await frame.locator(liSel).boundingBox();
  await page.mouse.click(box.x - 10, box.y + box.height / 2);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('裸嵌套非 todo 子列表：编辑器内恢复圆点、不可勾（create-4）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="top">顶<ul><li id="sub">子项</li></ul></li></ul>');
  const nestedLST = await frame.locator('#top > ul').evaluate((ul) => getComputedStyle(ul).listStyleType);
  expect(nestedLST, '裸嵌套 ul 恢复圆点 disc（不再继承 none 成无 marker）').toBe('disc');
  await clickGutter('#sub'); // 点裸嵌套子项左侧
  await page.waitForTimeout(80);
  expect(await frame.locator('#sub').getAttribute('data-checked'), '裸嵌套子项不可勾（拍板）').toBeNull();
  expect(await conformOf(await serialize())).toBe(true);
});

test('D3 防回归：Tab 缩进产生的嵌套 ws-todo 子项仍无圆点、可勾', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a">第一项</li><li id="b">第二项</li></ul>');
  await frame.locator('#b').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab'); // 缩进 #b → 嵌套 ws-todo 子列表
  await page.waitForTimeout(120);
  const nested = await frame.locator('#a > ul').evaluate((ul) => ({ isTodo: ul.classList.contains('ws-todo'), lst: getComputedStyle(ul).listStyleType }));
  expect(nested.isTodo, 'Tab 产的嵌套子列表继承 ws-todo（D3）').toBe(true);
  expect(nested.lst, 'Tab 产的嵌套 ws-todo 仍无圆点').toBe('none');
  await clickGutter('#b'); // 嵌套 ws-todo 项 gutter 点击
  await expect.poll(() => frame.locator('#b').getAttribute('data-checked'), { message: '嵌套 ws-todo 项可勾（D3 不回归）' }).toBe('true');
  expect(await conformOf(await serialize())).toBe(true);
});

test('入盘 CSS 含嵌套非 todo 规则、老文档打开后被升级', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>顶<ul><li>子</li></ul></li></ul>');
  // 触发一次真实编辑 → 语义 CSS 落盘
  await frame.locator('#lst > li').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await page.waitForTimeout(200);
  const html = await serialize();
  expect(html.includes(':not(.ws-todo)'), '入盘 ws-todo CSS 含嵌套非 todo 恢复圆点规则').toBe(true);
  expect(await conformOf(html)).toBe(true);
});
