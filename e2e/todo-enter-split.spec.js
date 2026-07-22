// list 项内 Enter 交原生分裂：原生 li split 克隆源 li 全部属性（id/data-checked），无 post-split 清理
// → 已勾项回车产「天生已勾」的新项 + 重复 id 入盘坏锚点（keys-2）。修法：一次性 input 后按内容判定，
// 剥「空项（都非空则文档序更后者）」的 id/data-checked。undo 走菜单路径（keyboard Meta+z 不触发菜单加速器）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2entersplit-'));
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
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const liInfo = () => frame.locator('#lst > li').evaluateAll((els) => els.map((l) => ({ text: l.textContent.trim(), id: l.id || null, checked: l.getAttribute('data-checked') })));
const dupIds = (lis) => { const ids = lis.map((l) => l.id).filter(Boolean); return ids.length - new Set(ids).size; };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('已勾项末尾 Enter：新项无 id/无勾选/无划线，源项保留（keys-2）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a1" data-checked="true">已完成的事</li></ul>');
  await frame.locator('#a1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const lis = await liInfo();
  expect(lis.length, '应分裂成 2 项').toBe(2);
  const content = lis.find((l) => l.text === '已完成的事');
  const empty = lis.find((l) => l.text === '');
  expect(content, '内容项保留 id + 勾选').toEqual({ text: '已完成的事', id: 'a1', checked: 'true' });
  expect(empty.id, '新空项无 id（不复制锚点）').toBe(null);
  expect(empty.checked, '新空项无 data-checked（Notion：新项永远未勾）').toBe(null);
  expect(dupIds(lis), '不许重复 id').toBe(0);
  // 新空项无划线（computed）
  const deco = await frame.locator('#lst > li').last().evaluate((l) => getComputedStyle(l).textDecorationLine);
  expect(deco, '未勾新项不该有划线').not.toContain('line-through');
  expect(await conformOf(await serialize())).toBe(true);
});

test('光标中间 Enter 劈半：前半保 id+勾选，后半两者皆无', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a1" data-checked="true">已完成的事</li></ul>');
  await frame.locator('#a1').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // 光标在「已完|成的事」
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const lis = await liInfo();
  expect(lis.length).toBe(2);
  const first = lis.find((l) => l.text === '已完');
  const second = lis.find((l) => l.text === '成的事');
  expect(first, '前半保 id+勾选').toEqual({ text: '已完', id: 'a1', checked: 'true' });
  expect(second.id, '后半无 id').toBe(null);
  expect(second.checked, '后半无 data-checked').toBe(null);
  expect(dupIds(lis)).toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

test('行首 Enter：上方新空项无 id/无勾选，内容项保留（属性跟内容走）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a1" data-checked="true">已完成的事</li></ul>');
  await frame.locator('#a1').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const lis = await liInfo();
  expect(lis.length).toBe(2);
  const content = lis.find((l) => l.text === '已完成的事');
  const empty = lis.find((l) => l.text === '');
  expect(content.checked, '内容项保留勾选').toBe('true');
  expect(content.id, '内容项保留 id').toBe('a1');
  expect(empty.id, '空项无 id').toBe(null);
  expect(empty.checked, '空项无 data-checked').toBe(null);
  expect(dupIds(lis)).toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

test('普通列表 li 带 id 末尾 Enter：新项无 id（两类列表都兜）', async () => {
  await launch();
  await openDoc('<ul id="lst"><li id="b1">项目</li></ul>');
  await frame.locator('#b1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const lis = await liInfo();
  expect(lis.length).toBe(2);
  expect(dupIds(lis), '普通列表也不许重复 id').toBe(0);
  const empty = lis.find((l) => l.text === '');
  expect(empty.id, '新空项无 id').toBe(null);
  expect(await conformOf(await serialize())).toBe(true);
});

test('回归：分裂后菜单 undo 一步 → 还原单项原状（含 id/勾选）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="a1" data-checked="true">已完成的事</li></ul>');
  await frame.locator('#a1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect((await liInfo()).length, '分裂成 2 项').toBe(2);
  await menu('undo');
  await expect.poll(async () => (await liInfo()).length, { message: 'undo 应还原成单项' }).toBe(1);
  const lis = await liInfo();
  expect(lis[0], 'undo 后单项 id/勾选/内容原样').toEqual({ text: '已完成的事', id: 'a1', checked: 'true' });
  expect(await conformOf(await serialize())).toBe(true);
});
