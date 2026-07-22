// 列表内选删后打字，Blink 原生删除/typing-style 会往块上留空 style=""——入盘即中 block-style 规则、
// 整篇非合规、重开永久降级基础编辑（select-1）。修法在 serialize.js cleanRoot 通用剥空 style。
// 门：走完真实「选中列表全文字 → Backspace → 打字」序列后，序列化字节不含 style=""、reparse conform=true。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2selclean-'));
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

test('列表内选删后打字：不残留空 style=""、字节合规（select-1）', async () => {
  await launch();
  await openDoc('<p id="p0">上文</p><ul id="lst" class="ws-todo"><li>甲甲甲甲</li><li data-checked="true">乙乙乙乙</li><li>丙丙丙丙</li></ul><p id="p9">下文</p>');
  await frame.locator('#lst > li').first().click(); // enterEdit(ul)
  await page.waitForTimeout(120);
  // 选中列表内全部文字（li1 起点 → li3 终点），选区在同一编辑块内 → deleteSelection 交原生
  await frame.locator('#lst').evaluate((ul) => {
    const d = ul.ownerDocument;
    const li1 = ul.children[0], li3 = ul.children[2];
    const r = d.createRange();
    r.setStart(li1.firstChild, 0);
    r.setEnd(li3.firstChild, li3.firstChild.textContent.length);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Backspace'); // 原生删空选区 → 留 <li><br></li>
  await page.waitForTimeout(80);
  await page.keyboard.type('x'); // 原生 typing-style 可能往块上留空 style=""
  await page.waitForTimeout(120);
  const html = await serialize();
  expect(/style=""/.test(html), '序列化字节绝不含空 style=""（漏一个 = 块级 style = 整篇降级）').toBe(false);
  expect(await conformOf(html), 'reparse 必须合规（否则重开降级基础编辑）').toBe(true);
});

test('回归：正常勾选态列表序列化合规、data-checked 不丢', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>甲</li><li data-checked="true">乙</li></ul>');
  const html = await serialize();
  expect(html.includes('data-checked="true"'), '勾选态必须保留').toBe(true);
  expect(/style=""/.test(html)).toBe(false);
  expect(await conformOf(html)).toBe(true);
});
