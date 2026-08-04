// 空 callout 不被斜杠插入吞掉（对拍 C13）。
// applySlash 有**四个替换站点、三种机制**：图片(insertImages 把锚块 remove) / details(turnInto) /
// table(newBlock+replaceWith) / generic(turnInto)。四条各测一遍——只测一条会漏掉其余机制。
// ⚠ 分隔线（hr）不在门内：它本来就是无条件 insertAfter，修前修后行为恒等，拿它当门是空门。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2coslash-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function openDoc(body, sentinel) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>' + body + '</body></html>';
  const p = path.join(tmpDir, 'd-' + sentinel + '-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('#' + sentinel)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(450);
}
// 空 callout（编辑器新建出来就是裸 <br>，不是 <p>）
const EMPTY_CALLOUT = '<p id="s">哨兵</p><div class="ws-callout" id="co"><br></div><p id="tail">尾段</p>';

async function slashInEmptyCallout(itemText) {
  await frame.locator('#co').click();
  await page.waitForTimeout(220);
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible({ timeout: 4000 });
  await frame.locator('.ws-slashmenu-item', { hasText: itemText }).first().click();
  await page.waitForTimeout(420);
}
// 顶层块序列（id + 标签），判「callout 还在不在、产物落在哪」
const topOrder = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((n) => !n.hasAttribute('data-ws2-ui'))
    .map((n) => n.tagName + (n.id ? '#' + n.id : '') + (n.classList.contains('ws-callout') ? '.callout' : ''));
});

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close().catch(() => {});
  }
  app = null; page = null; frame = null;
});

// 机制一：generic turnInto（列表）
test('空 callout + /无序列表 → callout 保留，列表插在它之后', async () => {
  await launch();
  await openDoc(EMPTY_CALLOUT, 's');
  await slashInEmptyCallout('无序列表');
  const order = await topOrder();
  expect(order).toContain('DIV#co.callout');           // 容器没被吞
  const i = order.indexOf('DIV#co.callout');
  expect(order[i + 1]).toMatch(/^UL/);                  // 产物落在框后，不是取代它
  expect(order.filter((x) => x.includes('#co')).length).toBe(1); // id 没被搬到产物上
});

// 机制二：table 走 newBlock + el.replaceWith（不经 turnInto，最容易被漏）
test('空 callout + /表格 → callout 保留，表格插在它之后', async () => {
  await launch();
  await openDoc(EMPTY_CALLOUT, 's');
  await slashInEmptyCallout('表格');
  const order = await topOrder();
  expect(order).toContain('DIV#co.callout');
  expect(order[order.indexOf('DIV#co.callout') + 1]).toMatch(/^TABLE/);
});

// 机制三：details 走三元里的 turnInto
test('空 callout + /折叠 → callout 保留，折叠块插在它之后', async () => {
  await launch();
  await openDoc(EMPTY_CALLOUT, 's');
  await slashInEmptyCallout('折叠');
  const order = await topOrder();
  expect(order).toContain('DIV#co.callout');
  expect(order[order.indexOf('DIV#co.callout') + 1]).toMatch(/^DETAILS/);
});

// 机制四：图片走 insertImages，replaceEmpty 为真时 anchorEl.remove() —— callout 连壳都不剩，最狠的一条
test('空 callout + /图片 → callout 保留（不被 remove 掉），图片插在它之后', async () => {
  await launch();
  await openDoc(EMPTY_CALLOUT, 's');
  // ⚠ 不能在 renderer 里改 window.ws2.pickImages：ws2 是 contextBridge 暴露的**冻结对象**，
  // 赋值静默失效 → 会真的弹出原生选图框、测试挂死（实测踩过）。从主进程替换 IPC handler，
  // 这样走的还是 preload → ipcRenderer.invoke → shell → blockedit 的完整真实路径。
  await app.evaluate(({ ipcMain }) => {
    const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    try { ipcMain.removeHandler('ws-pick-images'); } catch (e) {}
    ipcMain.handle('ws-pick-images', () => [{ name: 'x.png', mime: 'image/png', base64: PNG1x1 }]);
  });
  await slashInEmptyCallout('图片');
  await page.waitForTimeout(600); // 插图是异步（picker → base64 → insertImages）
  const order = await topOrder();
  expect(order).toContain('DIV#co.callout'); // 容器没被 remove
  expect(order.some((x) => x.startsWith('IMG') || x.startsWith('FIGURE'))).toBe(true);
});

// 回归门：非空 callout 与普通空段落的既有行为一字不变（改动只该影响「空 callout」这一格）
test('回归：普通空段落仍原地变身；非空 callout 仍插到下方', async () => {
  await launch();
  await openDoc('<p id="s">哨兵</p><p id="ep"><br></p><div class="ws-callout" id="co2">有字</div><p id="t">尾</p>', 's');

  await frame.locator('#ep').click();
  await page.waitForTimeout(200);
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible({ timeout: 4000 });
  await frame.locator('.ws-slashmenu-item', { hasText: '无序列表' }).first().click();
  await page.waitForTimeout(400);
  let order = await topOrder();
  expect(order.some((x) => x === 'P#ep')).toBe(false); // 空段落被原地替换掉（既有行为，不许改）
  expect(order.some((x) => x.startsWith('UL'))).toBe(true);

  await frame.locator('#co2').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(180);
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible({ timeout: 4000 });
  await frame.locator('.ws-slashmenu-item', { hasText: '表格' }).first().click();
  await page.waitForTimeout(420);
  order = await topOrder();
  expect(order).toContain('DIV#co2.callout'); // 非空 callout 本来就不会被吞
  expect(order[order.indexOf('DIV#co2.callout') + 1]).toMatch(/^TABLE/);
});
