// U1 行级手柄悬停跟随（粒度对齐 A，plan 2026-08-03-002）：
// 列表块内 ⋮⋮ 手柄逐行跟随（几何强断言，anchor 判定与对拍探针同口径）；非列表块锚整块不回归；
// A 阶段不变式：拖拽仍整列表、菜单仍可开（U2/U3 下沉后改写这两条）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rowgrip-'));
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
// 手柄几何 + 目标元素 band 判定（对拍探针同口径）
const gripCenter = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g || g.style.display === 'none') return null;
  const r = g.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
const bandOf = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const el = d.querySelector(s);
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
}, sel);
async function hoverAndGrip(sel) {
  await frame.locator(sel).hover();
  await page.waitForTimeout(150);
  const g = await gripCenter();
  expect(g, `悬停 ${sel} 后手柄应可见`).not.toBeNull();
  return g;
}
const inBand = (g, band) => g.y >= band.top && g.y <= band.bottom;

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('todo 三行：手柄逐行跟随（几何强断言）', async () => {
  await launch();
  await openDoc('<p id="pre">上方段落</p><ul class="ws-todo"><li id="r1">第一行待办</li><li id="r2">第二行待办</li><li id="r3">第三行待办</li></ul><p id="post">下方段落</p>');
  const g1 = await hoverAndGrip('#r1');
  const g2 = await hoverAndGrip('#r2');
  const g3 = await hoverAndGrip('#r3');
  expect(inBand(g1, await bandOf('#r1')), '悬停 r1 手柄在 r1 行内').toBe(true);
  expect(inBand(g2, await bandOf('#r2')), '悬停 r2 手柄在 r2 行内').toBe(true);
  expect(inBand(g3, await bandOf('#r3')), '悬停 r3 手柄在 r3 行内').toBe(true);
  expect(g2.y, '手柄 y 随行下移').toBeGreaterThan(g1.y);
  expect(g3.y, '手柄 y 随行下移').toBeGreaterThan(g2.y);
  // 悬停零 DOM 变更：入盘序列化不含探针/手柄残留
  const html = await serialize();
  expect(html.includes('ws-grip'), '悬停不产生入盘残留').toBe(false);
});

test('普通 ol 同样逐行跟随（列表类型通吃）', async () => {
  await launch();
  await openDoc('<ol><li id="o1">甲</li><li id="o2">乙</li></ol>');
  const g2 = await hoverAndGrip('#o2');
  expect(inBand(g2, await bandOf('#o2')), '悬停 ol 第二项手柄在该行').toBe(true);
});

test('嵌套子列表行：锚最深 li 且随缩进右移', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="r1">父项<ul class="ws-todo"><li id="n1">嵌套子项</li></ul></li><li id="r2">第二项</li></ul>');
  const gTop = await hoverAndGrip('#r2');
  const gNest = await hoverAndGrip('#n1');
  expect(inBand(gNest, await bandOf('#n1')), '悬停嵌套行手柄在嵌套行内').toBe(true);
  expect(gNest.x, '嵌套行手柄随缩进右移').toBeGreaterThan(gTop.x);
});

test('非列表块锚整块（不回归）+ 跨块跟随', async () => {
  await launch();
  await openDoc('<p id="pre">上方段落</p><ul class="ws-todo"><li id="r1">待办</li></ul>');
  const gP = await hoverAndGrip('#pre');
  expect(inBand(gP, await bandOf('#pre')), '悬停段落手柄在段落行内').toBe(true);
  const gL = await hoverAndGrip('#r1');
  expect(inBand(gL, await bandOf('#r1')), '移回列表手柄跟到行').toBe(true);
});

test('U2 后整块拖拽仍可用：Esc 灰选列表后拖拽 = 整列表移动', async () => {
  await launch();
  await openDoc('<p id="pre">上方段落</p><ul class="ws-todo"><li id="r1">一</li><li id="r2">二</li></ul><p id="post">下方段落</p>');
  // 块灰选路径：点进行 → Esc 退出编辑 → selectedEl=整列表 → 拖拽单位=整块。
  // ⚠ 2026-08-05 起 Esc 在列表里是三档（① 当前行 ② 整张列表 ③ 取消，Wendi 反馈「深色框把两行圈成一个」），
  // 所以「整列表灰选」要按两次。本条守的契约一字未变——**整列表灰选后拖走的是整张，绝不劈成两张**，
  // 只是拿到整列表灰选的按键数从 1 变 2。第一档（单行灰选后拖 = 只搬那一行）由 E-2 那批门另外压着。
  await frame.locator('#r2').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('[data-ws2-selected]');
    return s ? s.tagName : 'none';
  }), '两次 Esc 之后灰选的必须是整张 <ul>，不是某一行').toBe('UL');
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const post = d.getElementById('post');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = post.getBoundingClientRect();
    post.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.y + r.height - 2 }));
    post.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: r.y + r.height - 2 }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  const order = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.body.children].map((el) => el.tagName + (el.id ? '#' + el.id : ''));
  });
  expect(order.join(','), '灰选整块拖拽=整列表移动').toBe('P#pre,P#post,UL');
});

test('嵌套行勾选框 gutter 悬停：手柄不跳回父项（Colin 试玩实抓回归）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="r1">父项带嵌套<ul class="ws-todo"><li id="n1">嵌套子项甲</li><li id="n2">嵌套子项乙</li></ul></li><li id="r2">第二项</li></ul>');
  // 先悬停嵌套行文字（手柄到嵌套行），再真实鼠标向左移到该行的勾选框上。
  // ⚠ U2（2026-08-06）改了几何：勾选框原先画在 li 盒**外**（嵌套 ul 的 padding 区），
  // elementFromPoint 在那一带命中的是 <ul> 容器，closest('li') 的老实现于是跳回父项——这条门当初
  // 就是为那个坏区立的。现在勾选框收进了 li 盒内，**那个坏区在结构上不复存在**（同一像素点直接
  // 命中本行 li）。本条改为在勾选框的新位置上守同一个不变式：悬停它，手柄必须留在本行。
  await frame.locator('#n1').hover();
  await page.waitForTimeout(150);
  const frameBox = await page.locator('#doc-frame').boundingBox();
  const pt = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const n1 = d.getElementById('n1');
    const r = n1.getBoundingClientRect();
    const cs = d.defaultView.getComputedStyle(n1, '::before');
    const cx = r.left + (parseFloat(cs.left) || 0) + (parseFloat(cs.width) || 16) / 2;
    const cy = Math.round(r.top + r.height / 2);
    // 勾选框中心必须确凿落在本行 li 上（不是父 li、不是 ul）——立不住就是 fixture 变了，直接 fail
    const hit = d.elementFromPoint(Math.round(cx), cy);
    return { x: Math.round(cx), cy, onOwnRow: hit === n1 || n1.contains(hit) };
  });
  expect(pt.onOwnRow, '勾选框中心必须命中本行 li（U2 后的结构前提）').toBe(true);
  await page.mouse.move(frameBox.x + pt.x + 30, frameBox.y + pt.cy);
  await page.mouse.move(frameBox.x + pt.x, frameBox.y + pt.cy);
  await page.waitForTimeout(150);
  const g = await gripCenter();
  expect(g, 'gutter 悬停手柄仍可见').not.toBeNull();
  expect(inBand(g, await bandOf('#n1')), '手柄留在嵌套行、不跳回父项').toBe(true);
});

test('A 阶段不变式：行锚手柄点击菜单仍可开（U3 改作用域）', async () => {
  await launch();
  await openDoc('<ul class="ws-todo"><li id="r1">一</li><li id="r2">二</li></ul>');
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
});
