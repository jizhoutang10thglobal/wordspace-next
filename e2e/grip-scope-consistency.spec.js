// I4（Notion 粒度对拍第二批）：手柄「画的对象」与「做的对象」必须是同一个块。
// 病灶：选中不可编辑块（实践中基本只有图片会留常驻灰选）后把鼠标移到别的块 —— onMouseMove 无条件
// 把手柄画到新块旁，而点击/拖拽/「+」取的是 selectedEl||hoverEl（选中优先）→ 视觉锚点在段落、
// 破坏性操作作用在图片上，1.2s 自动保存就落盘。Notion 侧给的是正解：点手柄 halo 当场转移到该块。
// 修法：gripEl/gripRow 由 positionGrip 唯一写入，三个作用点（click / dragstart / 「+」）全读它。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2gripscope-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}

// 1×1 透明 png，避免依赖外部资源（图片必须真解码出尺寸，否则手柄纵坐标断言无意义）
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAAC4wJK5AAAAHElEQVRoge3BAQ0AAADCoPdPbQ43oAAAAAAAAHgaHkAAAcHf9WEAAAAASUVORK5CYII=';
const DOC = `<p id="before">前段</p><img id="pic" src="${PNG}" alt="图"><p id="after">后段</p>`;

const bodyOrder = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const selectedIds = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('[data-ws2-selected]')].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
// 手柄画在谁旁边：按纵向中线判归属（手柄是 22px 高、对块首行居中）
const gripAnchorOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  const t = d.querySelector(s);
  if (!g || !t) return null;
  const gr = g.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  return { gripCy: gr.top + gr.height / 2, top: tr.top, bottom: tr.bottom, visible: getComputedStyle(g).display !== 'none' };
}, sel);

// 选中图片 → 悬停另一个块（复现 I4 的前置状态）
async function selectPicThenHover(hoverSel) {
  await frame.locator('#pic').click();
  await page.waitForTimeout(150);
  expect(await selectedIds()).toEqual(['IMG#pic']); // 前置成立才谈得上后面的断言
  await frame.locator(hoverSel).hover();
  await page.waitForTimeout(200);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('I4-1 前置：选中图片后悬停别的块，手柄确实画到了那个块旁（病灶的视觉前提）', async () => {
  await launch();
  await openDoc(DOC);
  await selectPicThenHover('#after');
  const a = await gripAnchorOf('#after');
  expect(a.visible).toBe(true);
  expect(a.gripCy).toBeGreaterThanOrEqual(a.top - 1);
  expect(a.gripCy).toBeLessThanOrEqual(a.bottom + 1);
});

test('I4-2 点这个手柄：灰选当场转移到手柄所指的块，图片不再是作用对象', async () => {
  await launch();
  await openDoc(DOC);
  await selectPicThenHover('#after');
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  // 结构真相：灰选只剩后段。修前这里是 ['IMG#pic']（菜单开在图片上）。
  expect(await selectedIds()).toEqual(['P#after']);
  // 菜单身份：色板 gated 在 isEditableEl —— 段落菜单有、图片菜单没有。是「这菜单属于谁」的结构证据。
  await expect(frame.locator('.ws-blockmenu-colors')).toHaveCount(1);
});

test('I4-3 拖这个手柄：搬走的是手柄所指的块，图片相对位置不变', async () => {
  await launch();
  await openDoc(DOC);
  expect(await bodyOrder()).toEqual(['P#before', 'IMG#pic', 'P#after']);
  await selectPicThenHover('#after');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#before');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 5), clientY: r.top + 3 };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(250);
  // 修前：搬的是图片 → ['IMG#pic','P#before','P#after']
  expect(await bodyOrder()).toEqual(['P#after', 'P#before', 'IMG#pic']);
});

test('I4-4 「+」同口径：插在手柄所指的块下方，不是插在图片下方', async () => {
  await launch();
  await openDoc(DOC);
  await selectPicThenHover('#after');
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(300);
  const order = await bodyOrder();
  // 新块无 id，落在 P#after 之后；图片位置不动。修前新块会插在 IMG#pic 之后。
  expect(order.slice(0, 3)).toEqual(['P#before', 'IMG#pic', 'P#after']);
  expect(order.length).toBe(4);
});

// —— 不变式的另一半：行锚方向。上面五条全在块锚方向，把 positionGrip 里的 gripRow 变异成恒 null
// （= 废掉全部行作用域）它们照样全绿（对抗审查 ADV-GRIP-T1）。下面两条专治这一半。
const LIST = '<ul id="L"><li id="r1">一</li><li id="r2">二</li><li id="r3">三</li><li id="r4">四</li></ul>';
const liTexts = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const l = d.querySelector('#L');
  return l ? [...l.children].map((li) => (li.textContent || '').trim()) : null;
});

test('I4-6 行锚：悬停第 3 行点手柄，灰选只罩那一行、删除只删那一行', async () => {
  await launch();
  await openDoc(LIST);
  await frame.locator('#r3').hover();
  await page.waitForTimeout(200);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await selectedIds()).toEqual(['LI#r3']); // 罩一行，不是整张 UL
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await liTexts()).toEqual(['一', '二', '四']);
});

test('I4-7 状态搅动后不变式仍成立：悬停第 3 行 → 缩放/收侧栏触发 reposition → 仍是行作用域', async () => {
  await launch();
  await openDoc(LIST);
  await frame.locator('#r3').hover();
  await page.waitForTimeout(200);
  // ⌘\ 收侧栏 / 缩放 / 改窗口大小 / 改页面设置都汇到这一个出口
  await page.evaluate(() => { if (window.__shellReposition) window.__shellReposition(); });
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await selectedIds()).toEqual(['LI#r3']); // 修前：reposition 把 gripRow 清成 null → ['UL#L']
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await liTexts()).toEqual(['一', '二', '四']); // 修前：整张列表被删光
});

test('I4-5 反向不回归：Esc 灰选（无悬停行）仍是块作用域，手柄仍在该块', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await frame.locator('#r2').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['UL#L']); // 整块灰选，不是某一行
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  // 块作用域：删除作用于整张列表
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await bodyOrder()).not.toContain('UL#L');
});
