// markdown「[] 」建待办后继续打字必须落进项（create-1）。
// 病根：tryMarkdown 清 marker 时 innerHTML='' 抹掉占位 <br>，turnInto 列表分支把空内容包成裸
// <li></li>；ws-todo list-style:none 让空 li 无 line box、高度 0，Blink 落不住 caret、后续输入被吞。
// 修法：turnInto 列表分支包出的空 li 补 <br>（对齐斜杠路径产物）。CI 用 xvfb 真启动 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2mdshort-'));
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
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// 进一个干净的空编辑态正文块：seed 非空 p → 点进 → End → Enter 新建空块（editingEl = 新空 p）。
async function freshEmptyBlock() {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}

test('markdown「[] 」建 todo 后继续打字不丢（死块修复）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('[] '); // 触发转 todo
  await expect.poll(() => frame.locator('ul.ws-todo > li').count(), { message: '「[] 」应转成 ws-todo 列表' }).toBe(1);
  await page.keyboard.type('abc'); // bug：零高死块会把这三个字吞掉
  await expect.poll(() => frame.locator('ul.ws-todo > li').first().textContent(), { message: '转换后打字必须落进待办项' }).toBe('abc');
  expect(await conformOf(await serialize())).toBe(true);
});

test('markdown「[] 」转换产物非零高、含子节点（可落 caret）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('[] ');
  await expect.poll(() => frame.locator('ul.ws-todo > li').count()).toBe(1);
  const info = await frame.locator('ul.ws-todo > li').first().evaluate((li) => ({ kids: li.childNodes.length, h: li.getBoundingClientRect().height }));
  expect(info.kids, '空 li 必须至少有一个子节点（<br> 占位）').toBeGreaterThan(0);
  expect(info.h, '空 todo li 必须有可视高度（否则 Blink 落不住 caret）').toBeGreaterThan(0);
});

test('回归：markdown「- 」建普通 bullet 后打字正常（不误伤既有路径）', async () => {
  await launch();
  await openDoc('<p id="p1">正文</p>');
  await freshEmptyBlock();
  await page.keyboard.type('- ');
  await expect.poll(() => frame.locator('ul:not(.ws-todo) > li').count(), { message: '「- 」应转成普通 bullet' }).toBe(1);
  await page.keyboard.type('xyz');
  await expect.poll(() => frame.locator('ul:not(.ws-todo) > li').first().textContent()).toBe('xyz');
  expect(await conformOf(await serialize())).toBe(true);
});
