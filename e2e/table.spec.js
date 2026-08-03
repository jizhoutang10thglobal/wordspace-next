// 表格块编辑（Schema Table v1）e2e 真门：CI 用 xvfb 真启动 Electron。
// U1：斜杠造表（canonical 种子 + 磁盘合规 + 灰选）+ 别名过滤。后续单元（cell 编辑/键盘/输入闸）逐个追加。
// 强断言纪律（S4）：查磁盘字节 reparse conform / 结构真值，绝不 class-contains 当门。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2table-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}
async function openDoc(html) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
// 校验器判磁盘字节是否合规（reparse，不信 meta 自称）
const conformOf = (html) => page.evaluate((h) => {
  const doc = new DOMParser().parseFromString(h, 'text/html');
  return WS2SchemaRegistry.classify(doc).conform;
}, html);

const SIMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">正文一段</p></body></html>';

// 在 #p1 后新建空块，斜杠造表（query 可指定，验别名过滤）。
async function insertTable(query) {
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible(); // 菜单经父层 setTimeout(0) 打开——先等它开，再打过滤词（否则字母落进段落）
  if (query) await page.keyboard.type(query);
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).click();
  await page.waitForTimeout(250);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// U1-1：slash 造表 → canonical 种子结构真值 + 空锚块被原地替换（不留空段垃圾）+ 整表灰选。
test('U1: slash 造表 → canonical 种子 + 空块原地替换 + 灰选整表', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertTable();
  const shape = await frame.locator('body').evaluate(() => {
    const t = document.querySelector('table');
    if (!t) return { ok: false };
    const theadRows = t.querySelectorAll('thead tr');
    const ths = t.querySelectorAll('thead th');
    const bodyRows = t.querySelectorAll('tbody tr');
    const cellCounts = [...t.querySelectorAll('tr')].map((r) => [...r.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').length);
    return {
      ok: true,
      cls: t.className,
      theadRows: theadRows.length,
      ths: ths.length,
      scopes: [...ths].every((th) => th.getAttribute('scope') === 'col'),
      bodyRows: bodyRows.length,
      rect: cellCounts.every((n) => n === cellCounts[0]),
      cols: cellCounts[0],
      brs: [...t.querySelectorAll('td,th')].every((c) => c.querySelector('br')),
      // 灰选态落在 TABLE 元素本身（绝不在 TD 上）
      selectedTag: (document.querySelector('[data-ws2-selected]') || {}).tagName || null,
      // 空锚块原地替换：#p1 之后不残留空段落（表格紧跟 #p1）
      afterP1: document.getElementById('p1').nextElementSibling ? document.getElementById('p1').nextElementSibling.tagName : null,
    };
  });
  expect(shape.ok).toBe(true);
  expect(shape.cls).toBe('ws-table');
  expect(shape.theadRows).toBe(1);
  expect(shape.ths).toBe(3);
  expect(shape.scopes).toBe(true);
  expect(shape.bodyRows).toBe(2);
  expect(shape.rect).toBe(true);
  expect(shape.cols).toBe(3);
  expect(shape.brs).toBe(true);
  expect(shape.selectedTag).toBe('TABLE');
  expect(shape.afterP1).toBe('TABLE');
});

// U1-2：磁盘字节 reparse 合规 + 编辑器标记零残留（serialize 剥净）。
test('U1: 造表后磁盘字节 reparse conform、无编辑器标记残留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await insertTable();
  const html = await serialize();
  expect(await conformOf(html)).toBe(true);
  expect(html).toContain('ws-table');
  expect(html).toContain('<thead>');
  expect(html).toContain('scope="col"');
  expect(html).not.toMatch(/data-ws2-(ce|editing|selected|rangesel|root)/);
  expect(html).not.toContain('contenteditable');
});

// U1-3：斜杠别名过滤——「/biaoge」也能搜到表格项（filterSlash 吃 kw 字段）。
test('U1: 斜杠过滤词 biaoge 能搜到表格项', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible(); // 先等菜单开（父层 setTimeout(0)），再打过滤词
  await page.keyboard.type('biaoge');
  await expect(frame.locator('.ws-slashmenu-item', { hasText: '表格' })).toBeVisible();
  // 别名命中的不是别的项：过滤结果里恰含表格
  const count = await frame.locator('.ws-slashmenu-item').count();
  expect(count).toBe(1);
});

// U1-4：非空锚块造表 → 插到锚块下方（锚块保留），undo 一步撤掉整个造表。
test('U1: 非空块造表插下方 + undo 一步还原', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).click();
  await page.waitForTimeout(250);
  const order = await frame.locator('body').evaluate(() => {
    const p = document.getElementById('p1');
    return { pText: p.textContent, next: p.nextElementSibling ? p.nextElementSibling.tagName : null };
  });
  expect(order.pText).toContain('正文一段'); // 锚块文字保留（/query 已删）
  expect(order.next).toBe('TABLE');
  await menu('undo');
  await page.waitForTimeout(250);
  const after = await frame.locator('body').evaluate(() => ({ tables: document.querySelectorAll('table').length }));
  expect(after.tables).toBe(0);
});
