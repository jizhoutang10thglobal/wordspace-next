// U1（真 app 对齐 ui-demo）：列表 Tab/Shift+Tab 支持多选行整体缩进/出列 + 光标/选区操作后原样恢复。
// 单 li 行为由 todo-nested-keys.spec.js 覆盖；本 spec 专测「多选」与「光标不跳」两处新增。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2msel-'));
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
// 顶层项按 DOM 顺序取 id
const topIds = () => frame.locator('#lst > li').evaluateAll((els) => els.map((l) => l.id));
// 某 li 直接子里嵌套子列表内的项 id
const subIds = (liSel) => frame.locator(`${liSel} > ul > li, ${liSel} > ol > li`).evaluateAll((els) => els.map((l) => l.id));
// 设选区：从 aSel 首文本节点起点 到 bSel 末文本节点终点（跨两 li）
async function selectAcross(aSel, bSel) {
  await frame.locator('#lst').evaluate((ul, sels) => {
    const la = ul.querySelector(sels.a), lb = ul.querySelector(sels.b);
    const an = [...la.childNodes].find((n) => n.nodeType === 3) || la.firstChild;
    const bns = [...lb.childNodes].filter((n) => n.nodeType === 3);
    const bn = bns.length ? bns[bns.length - 1] : lb.lastChild;
    const d = ul.ownerDocument;
    const r = d.createRange();
    r.setStart(an, 0);
    r.setEnd(bn, bn.nodeType === 3 ? bn.textContent.length : bn.childNodes.length);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, { a: aSel, b: bSel });
}
async function shiftTab() { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); }

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('多选两个嵌套子项 Shift+Tab → 两行一起回顶层、保序', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父<ul class="ws-todo"><li id="a">甲</li><li id="b">乙</li></ul></li><li id="t">尾</li></ul>');
  await frame.locator('#a').click(); // 进编辑态
  await page.waitForTimeout(80);
  await selectAcross('#a', '#b');
  await shiftTab();
  await page.waitForTimeout(120);
  expect(await topIds(), '甲乙一起出列到顶层、夹在父与尾之间').toEqual(['p', 'a', 'b', 't']);
  expect(await frame.locator('#p > ul').count(), '父的空嵌套子列表被删').toBe(0);
});

test('多选两行 Tab → 两行一起嵌回上一项下', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父</li><li id="a">甲</li><li id="b">乙</li></ul>');
  await frame.locator('#a').click();
  await page.waitForTimeout(80);
  await selectAcross('#a', '#b');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  expect(await topIds(), '甲乙从顶层消失、只剩父').toEqual(['p']);
  expect(await subIds('#p'), '甲乙一起嵌进父的子列表').toEqual(['a', 'b']);
});

test('光标在行中间按 Tab → 光标 offset 不变（不跳行末）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父</li><li id="a">甲乙丙丁</li></ul>');
  await frame.locator('#a').click();
  await page.waitForTimeout(80);
  // 光标放 #a 文本 offset 2（甲乙|丙丁）
  await frame.locator('#a').evaluate((li) => {
    const tn = [...li.childNodes].find((n) => n.nodeType === 3);
    const d = li.ownerDocument; const r = d.createRange(); r.setStart(tn, 2); r.collapse(true);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(120);
  await page.keyboard.type('X'); // 若光标保原位应插在 offset 2：甲乙X丙丁
  await expect.poll(() => frame.locator('#a').evaluate((li) => (li.childNodes[0] && li.childNodes[0].textContent) || li.textContent)).toContain('甲乙X丙丁');
});

test('一个 li 带两个子列表、选区跨两个 → Shift+Tab 保持阅读顺序（对抗审查错序修复）', async () => {
  await launch();
  // 合规文档允许一个 li 带多个直接子列表；选区跨两个子列表出列不能错序（H,y,x）
  await openDoc('<ul id="lst"><li id="H">H<ul><li id="x">x</li></ul><ol><li id="y">y</li></ol></li></ul>');
  await frame.locator('#x').click();
  await page.waitForTimeout(80);
  await selectAcross('#x', '#y');
  await shiftTab();
  await page.waitForTimeout(120);
  expect(await topIds(), 'x 与 y 出列后阅读顺序 H,x,y（非 H,y,x）').toEqual(['H', 'x', 'y']);
});

test('多选 Shift+Tab 后选区仍覆盖那两行（全 range 恢复，非折叠成单点）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="p">父<ul class="ws-todo"><li id="a">甲</li><li id="b">乙</li></ul></li></ul>');
  await frame.locator('#a').click();
  await page.waitForTimeout(80);
  await selectAcross('#a', '#b');
  await shiftTab();
  await page.waitForTimeout(120);
  const selText = await frame.locator('#lst').evaluate((ul) => { const s = ul.ownerDocument.getSelection(); return { collapsed: s.isCollapsed, text: s.toString() }; });
  expect(selText.collapsed, '选区不该折叠成光标').toBe(false);
  expect(selText.text.replace(/\s+/g, ''), '选区仍覆盖甲和乙').toContain('甲');
  expect(selText.text.replace(/\s+/g, '')).toContain('乙');
});
