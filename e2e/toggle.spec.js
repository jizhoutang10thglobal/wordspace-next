// Toggle（<details>）可折叠块 e2e 真门：CI 用 xvfb 真启动 Electron。
// 覆盖：创建（slash 插入种子 + 光标落 summary）、入盘语义 CSS（chevron/marker-kill，data-ws-schema-css）、
// 合规往返、折叠持久化、嵌套可达、键盘边界、撤销解耦、分页/PDF 强制展开、查找自动展开、剪贴板。
// 强断言纪律（S4）：查 computed-style/几何 + 磁盘字节 reparse，绝不查 class-contains。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2toggle-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_PDF_OUT: path.join(tmpDir, 'export.pdf') },
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
const editingTag = () => frame.locator('body').evaluate(() => { const e = document.querySelector('[data-ws2-editing]'); return e ? e.tagName : null; });
// 校验器判磁盘字节是否合规（reparse，不信 meta 自称）
const conformOf = (html) => page.evaluate((h) => {
  const doc = new DOMParser().parseFromString(h, 'text/html');
  return WS2SchemaRegistry.classify(doc).conform;
}, html);

const SIMPLE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="p1">正文一段</p></body></html>';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

// U4: slash /折叠 插入合规种子 <details open><summary></summary><p></p></details>，光标落 summary；
// 入盘 chevron/marker-kill CSS（data-ws-schema-css="toggle"）；chevron 用 computed-style 强断言。
test('U4: slash 插入 toggle 种子 + 光标落 summary + 入盘 chevron CSS', async () => {
  await launch();
  await openDoc(SIMPLE);
  // 在 #p1 后新建空块，slash 插入 toggle
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await frame.locator('.ws-slashmenu-item', { hasText: '折叠' }).click();
  await page.waitForTimeout(250);

  // 结构：恰一个 details，含 open + 首子 summary + 一个 p 正文
  const shape = await frame.locator('body').evaluate(() => {
    const d = document.querySelector('details');
    if (!d) return { ok: false };
    const kids = [...d.children];
    return {
      ok: true, open: d.hasAttribute('open'),
      firstIsSummary: kids[0] && kids[0].tagName === 'SUMMARY',
      summaryCount: kids.filter((k) => k.tagName === 'SUMMARY').length,
      hasBodyP: kids.some((k) => k.tagName === 'P'),
    };
  });
  expect(shape.ok).toBe(true);
  expect(shape.open).toBe(true);
  expect(shape.firstIsSummary).toBe(true);
  expect(shape.summaryCount).toBe(1);
  expect(shape.hasBodyP).toBe(true);

  // 光标落 summary（R1/KD7）
  expect(await editingTag()).toBe('SUMMARY');

  // chevron 强断言：原生三角被干掉（list-style none）+ 自定义 chevron ::before 有内容
  const chev = await frame.locator('body').evaluate(() => {
    const s = document.querySelector('details > summary');
    const cs = getComputedStyle(s);
    const before = getComputedStyle(s, '::before');
    return { listStyle: cs.listStyleType, beforeContent: before.content, beforeDisplay: before.display };
  });
  expect(chev.listStyle).toBe('none');                 // 原生 marker 关
  expect(chev.beforeContent).not.toBe('none');         // 自定义 chevron 在
  expect(chev.beforeContent).not.toBe('normal');

  // 入盘：baked toggle CSS + 合规往返 + 无覆盖层泄漏
  const html = await serialize();
  expect(html).toMatch(/data-ws-schema-css="toggle"/);       // 语义 CSS 入盘（校验器 head 白名单认）
  expect(html).toMatch(/summary::-webkit-details-marker\{display:none\}/); // marker-kill 双配方之一入盘
  expect(html).toMatch(/<details open[^>]*><summary><\/summary><p><\/p><\/details>/); // 种子形态入盘（open 可能序列化成 open=""）
  expect(html).not.toMatch(/ws-grip|ws-fmtbar|ws-slashmenu|data-ws2-ce|contenteditable/); // 覆盖层/编辑态不泄漏
  expect(await conformOf(html), 'toggle 文档必须合规（走块编辑器，非基础编辑器）').toBe(true);
});
