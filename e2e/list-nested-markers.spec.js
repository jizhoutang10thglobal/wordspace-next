// 嵌套 marker 逐级循环（粒度对齐 · 编号列表 N5 / 无序列表同款）：
// 对拍实测 Notion 编号 1./a./i.、圆点 •/◦/▪ 逐级切换，我们此前各级同款。语义 CSS 入盘 → 浏览器直开同样对。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2marker-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body, head) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${head || ''}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(500);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
const markerOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s);
  return el ? getComputedStyle(el).listStyleType : null;
}, sel);
const TODO_HEAD = '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo ul:not(.ws-todo){list-style:disc}.ws-todo>li{list-style:none}</style>';

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('编号列表四级：decimal → lower-alpha → lower-roman → decimal（回到首档）', async () => {
  await launch();
  await openDoc('<ol id="L1"><li>一级<ol id="L2"><li>二级<ol id="L3"><li>三级<ol id="L4"><li>四级</li></ol></li></ol></li></ol></li></ol>');
  expect(await markerOf('#L1'), '第一级 decimal').toBe('decimal');
  expect(await markerOf('#L2'), '第二级 lower-alpha').toBe('lower-alpha');
  expect(await markerOf('#L3'), '第三级 lower-roman').toBe('lower-roman');
  expect(await markerOf('#L4'), '第四级回到 decimal').toBe('decimal');
  expect(await conformOf(await serialize()), '磁盘合规').toBe(true);
});

test('圆点列表四级：disc → circle → square → disc', async () => {
  await launch();
  await openDoc('<ul id="L1"><li>一级<ul id="L2"><li>二级<ul id="L3"><li>三级<ul id="L4"><li>四级</li></ul></li></ul></li></ul></li></ul>');
  expect(await markerOf('#L1'), '第一级 disc').toBe('disc');
  expect(await markerOf('#L2'), '第二级 circle').toBe('circle');
  expect(await markerOf('#L3'), '第三级 square').toBe('square');
  expect(await markerOf('#L4'), '第四级回到 disc').toBe('disc');
  expect(await conformOf(await serialize())).toBe(true);
});

test('层级样式随语义 CSS 入盘（浏览器直开同样对）', async () => {
  await launch();
  await openDoc('<ol id="L1"><li>一级<ol id="L2"><li>二级</li></ol></li></ol>');
  const html = await serialize();
  expect(html.includes('ol ol'), '入盘 CSS 含嵌套层级规则').toBe(true);
  expect(html.includes('lower-alpha'), '入盘 CSS 含二级样式').toBe(true);
  // 用磁盘字节在纯 DOMParser 里复算（不靠编辑器，模拟浏览器直开）
  const stillThere = await page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    return !!d.querySelector('style[data-ws-schema-css="baseline"]');
  }, html);
  expect(stillThere, '基线语义 CSS 随文件落盘').toBe(true);
});

test('不破坏 ws-todo：待办各级恒无 marker、todo 里的裸嵌套仍 disc（既有 by-design）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo" id="T1"><li>待办一<ul class="ws-todo" id="T2"><li>嵌套待办</li></ul></li><li>待办二<ul id="B"><li>裸嵌套圆点</li></ul></li></ul>', TODO_HEAD);
  expect(await markerOf('#T1'), '顶层待办无 marker').toBe('none');
  expect(await markerOf('#T2'), '嵌套待办仍无 marker（不被新规则改成 circle）').toBe('none');
  expect(await markerOf('#B'), 'todo 里的裸嵌套列表维持 disc（PR-C U11 既有设计）').toBe('disc');
  expect(await conformOf(await serialize())).toBe(true);
});

test('旧文档打开即静默升级到带层级规则的基线', async () => {
  await launch();
  // 造一个带**旧版**基线 CSS 的文档（只有 ul,ol 的 margin 规则、无层级规则）
  const oldBaseline = '<style id="ws-schema-baseline" data-ws-schema-css="baseline">:where(ul,ol){margin:.5em 0;padding-left:1.7em}</style>';
  await openDoc('<ol id="L1"><li>一级<ol id="L2"><li>二级</li></ol></li></ol>', oldBaseline);
  expect(await markerOf('#L2'), '打开后二级即为 lower-alpha（基线被升级）').toBe('lower-alpha');
  expect((await serialize()).includes('lower-alpha'), '升级后的基线随保存入盘').toBe(true);
});

test('深层循环 mod-3：第 5/6 级回到 circle/square（编号同理 lower-alpha/lower-roman）', async () => {
  await launch();
  await openDoc('<ul id="U1"><li>1<ul id="U2"><li>2<ul id="U3"><li>3<ul id="U4"><li>4<ul id="U5"><li>5<ul id="U6"><li>6</li></ul></li></ul></li></ul></li></ul></li></ul></li></ul>');
  expect(await markerOf('#U5'), '第五级 circle（mod-3）').toBe('circle');
  expect(await markerOf('#U6'), '第六级 square').toBe('square');
});

test('markdown「+ 」也触发圆点列表（对拍 F11：Notion 认 - * +，我们原来只认 - *）', async () => {
  await launch();
  await openDoc('<p id="p1"><br></p>');
  await frame.locator('#p1').click();
  await page.keyboard.type('+ ');
  await page.keyboard.type('加号触发');
  await expect.poll(async () => (await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const ul = d.querySelector('ul');
    return ul ? ul.textContent.trim() : null;
  })), { message: '「+ 」转成圆点列表并保留后续文字' }).toBe('加号触发');
  expect(await conformOf(await serialize())).toBe(true);
});
