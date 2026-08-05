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
  // 【断言迁移，2026-08-05】Esc 在列表里改成三档（Wendi 反馈：回车换行后第二行已是独立的
  // 交互单元，Esc 却把整张列表圈成一个深色框）。① 当前行 ② 整张列表 ③ 取消 —— 与 ⌘A 已有的
  // 三档对称。本条守的是**块作用域**那一档，所以按两次 Esc；「Esc 灰选列表后拖=整列表」这条
  // 既有契约一字未改，只是入口往后挪了一次按键。行作用域那一档另有新门覆盖。
  await page.keyboard.press('Escape'); // ① 当前行
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape'); // ② 整张列表
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['UL#L']); // 整块灰选，不是某一行
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  // 块作用域：删除作用于整张列表
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await bodyOrder()).toEqual(['P#L']); // 收严（gate 审计）：not.toContain 在「整篇被删光」时也过。
  // 删掉唯一的块后编辑器留一个空段落（文档不许空），且**继承原 id** —— 这两件事本身也被这条钉住了。
});

// ── 2026-08-05 对抗审查：I4 只把**三个手柄作用点**收口到 gripEl/gripRow，键盘那几个（Delete /
// Enter / ⌘C / ⌘X）仍读 selectedEl。于是「灰底罩着谁」和「手柄指着谁」可以分家，同一可见状态
// 出现两个作用对象。E1-E5 的行级 gutter 把这个差距从「块 vs 块」放大成「一行 vs 整张列表」。
// 立的不变式：**灰选在场时 gutter 不许下沉到它内部的行**（悬停别的块照常下沉 → I4-1~I4-4 不受影响）。

test('I4-8 灰选整列表后「与鼠标无关」的重锚：reposition 不许把作用对象换成行', async () => {
  await launch();
  await openDoc(LIST);
  await frame.locator('#r2').click();   // 这一次点击就把 hoverRow 锁成了 r2
  await page.waitForTimeout(150);
  // 【断言迁移，2026-08-05】Esc 在列表里改成三档（Wendi 反馈：回车换行后第二行已是独立的
  // 交互单元，Esc 却把整张列表圈成一个深色框）。① 当前行 ② 整张列表 ③ 取消 —— 与 ⌘A 已有的
  // 三档对称。本条守的是**块作用域**那一档，所以按两次 Esc；「Esc 灰选列表后拖=整列表」这条
  // 既有契约一字未改，只是入口往后挪了一次按键。行作用域那一档另有新门覆盖。
  await page.keyboard.press('Escape'); // ① 当前行
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape'); // ② 整张列表
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['UL#L']);
  // ⌘\ 收侧栏 / 缩放 / 拖窗口边 / 改页面设置都汇到这一个出口，全程**不需要鼠标动**。
  // 修前：gutterAnchor 把 hoverRow 排在 selectedEl 之前 → 手柄悄悄变成行作用域，灰底还罩着整块。
  await page.evaluate(() => { if (window.__shellReposition) window.__shellReposition(); });
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await selectedIds()).toEqual(['UL#L']); // 修前：['LI#r2']
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await bodyOrder()).toEqual(['P#L']); // 键盘与手柄同一个作用对象：删的是整张列表（留空段落继承 id）
});

test('I4-9 灰选整列表后鼠标**真的**停在某一行上：作用对象仍是整块', async () => {
  await launch();
  await openDoc(LIST);
  await frame.locator('#r2').click();
  await page.waitForTimeout(150);
  // 【断言迁移，2026-08-05】Esc 在列表里改成三档（Wendi 反馈：回车换行后第二行已是独立的
  // 交互单元，Esc 却把整张列表圈成一个深色框）。① 当前行 ② 整张列表 ③ 取消 —— 与 ⌘A 已有的
  // 三档对称。本条守的是**块作用域**那一档，所以按两次 Esc；「Esc 灰选列表后拖=整列表」这条
  // 既有契约一字未改，只是入口往后挪了一次按键。行作用域那一档另有新门覆盖。
  await page.keyboard.press('Escape'); // ① 当前行
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape'); // ② 整张列表
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['UL#L']);
  // 与 I4-8 的区别：这次是**活体** hover，hoverRow 会被真实 mousemove 重新武装 ——
  // 光靠「selectBlock 里清 hoverRow」治不了，必须在 positionGrip 这个唯一写入口拦下来。
  await frame.locator('#r1').hover();
  await page.waitForTimeout(200);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  expect(await selectedIds()).toEqual(['UL#L']); // 修前：['LI#r1']，菜单成了行作用域
  await frame.locator('.ws-blockmenu-item', { hasText: '删除' }).first().click();
  await page.waitForTimeout(250);
  expect(await bodyOrder()).toEqual(['P#L']); // 修前：只删掉「一」，列表还剩三行
});

test('I4-10 灰选整列表后拖手柄：搬走整张列表，绝不把列表劈成两张（会入盘的那条）', async () => {
  await launch();
  await openDoc('<p id="top">上段</p>' + LIST + '<p id="bot">下段</p>');
  await frame.locator('#r2').click();
  await page.waitForTimeout(150);
  // 【断言迁移，2026-08-05】Esc 在列表里改成三档（Wendi 反馈：回车换行后第二行已是独立的
  // 交互单元，Esc 却把整张列表圈成一个深色框）。① 当前行 ② 整张列表 ③ 取消 —— 与 ⌘A 已有的
  // 三档对称。本条守的是**块作用域**那一档，所以按两次 Esc；「Esc 灰选列表后拖=整列表」这条
  // 既有契约一字未改，只是入口往后挪了一次按键。行作用域那一档另有新门覆盖。
  await page.keyboard.press('Escape'); // ① 当前行
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape'); // ② 整张列表
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['UL#L']);
  await frame.locator('#r1').hover(); // 真实用户去够手柄，路上必然经过某一行
  await page.waitForTimeout(200);
  // 用本仓既有的合成 DragEvent 序列（同 list-row-drag.spec.js 的 dragRowTo）——page.mouse 那套
  // 在 iframe 里驱动 HTML5 拖放不可靠，实测直接把页面拖崩、报 "Target page has been closed"。
  // 关键在于**起点的 hover 是真实的**（上面那句 #r1.hover 已经把 hoverRow 武装成第一行），
  // 这正是 gate 审计点名的那个测试盲区：合成 dragstart 本身不产生 mousemove。
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.querySelector('#bot');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 40), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(400);
  // 修前：dragFrom = gripRow = 第一行 → 只搬一行，原列表还剩 li 不被清除 → 一分为二，1.2s 落盘。
  expect(await bodyOrder()).toEqual(['P#top', 'P#bot', 'UL#L']);
  expect(await liTexts()).toEqual(['一', '二', '三', '四']); // 四行整体搬走，一行不落
});

test('I4-11 灰选之后，鼠标已经不在那儿的陈旧悬停行不许把手柄拽走', async () => {
  await launch();
  await openDoc('<p id="top">上段</p>' + LIST);
  // 造出「selectedEl 与陈旧 hoverRow 分属不同块」的状态：先进段落编辑 → 鼠标滑过列表第 3 行
  //（此时 hoverRow=r3 是**真**的）→ 鼠标移出文档区（编辑态下 onDocLeave 不清悬停）→ Esc 灰选段落。
  // 此刻鼠标既不在 r3 上、灰底也在段落，hoverRow 却还指着 r3。
  await frame.locator('#top').click();
  await page.waitForTimeout(150);
  await frame.locator('#r3').hover();
  await page.waitForTimeout(200);
  await page.mouse.move(20, 400); // 移出 iframe，落到侧栏
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['P#top']);
  await page.evaluate(() => { if (window.__shellReposition) window.__shellReposition(); });
  await page.waitForTimeout(200);
  // 修前：gutterAnchor 把陈旧 hoverRow 排在 selectedEl 之前 → 手柄漂到第 3 行旁边，
  // 而灰底在段落上 —— 手柄指着的和键盘要动的又不是同一个东西，且鼠标不动就永不自愈。
  const a = await gripAnchorOf('#top');
  expect(a.visible).toBe(true);
  expect(a.gripCy).toBeGreaterThanOrEqual(a.top - 1);
  expect(a.gripCy).toBeLessThanOrEqual(a.bottom + 1);
});

// ── E 组（2026-08-05，Wendi 反馈）：Esc 在列表里的三档阶梯 ─────────────────────────────
// 原话：「打开第一行 to do list，点击回车换行，第二行实质上已经是另一个 block 了，
// 但选中深色的其实还是和上一行连成一起的」。实测复现：列表的 editingEl 是整个 <ul>（存储单元），
// Esc 走 selectBlock(editingEl) → 深色框罩住整张列表。而这一行的手柄 / 「+」/ 菜单作用域 /
// 行首退格 / 拖拽早就都是行级的了 —— 唯独 Esc 把底层容器暴露了出来。
// 修法：Esc 分三档（与 ⌘A 已有的三档对称）① 当前行 ② 整张列表 ③ 取消。
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (html) => page.evaluate((h) => { const d = new DOMParser().parseFromString(h, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, html);
// 深色框的**几何**：这条报告本质是视觉的，只断结构会漏掉「框画得对不对」
const selBox = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('[data-ws2-selected]');
  const rows = [...d.querySelectorAll('#L > li')].map((li) => Math.round(li.getBoundingClientRect().height));
  if (!m) return { none: true, rows };
  const r = m.getBoundingClientRect();
  return { tag: m.tagName, top: Math.round(r.top), h: Math.round(r.height), rows };
});

test('E-1 回车换行后按 Esc：深色框只罩新的那一行（Wendi 报告的原路径）', async () => {
  await launch();
  await openDoc('<p>上面</p><ul id="L"><li id="r1">买牛奶</li></ul><p>下面</p>');
  await frame.locator('#r1').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('写周报');
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const b = await selBox();
  expect(b.tag, '罩的是行，不是整张列表').toBe('LI');
  // 几何才是这条报告的实质：修前框高 = 两行之和（实测 61，单行 28）
  expect(b.rows.length).toBe(2);
  expect(b.h, '框高必须等于单行高，不能把两行圈成一个').toBeLessThanOrEqual(b.rows[1] + 2);
  expect(b.h).toBeGreaterThanOrEqual(b.rows[1] - 2);
});

test('E-2 三档阶梯：① 当前行 → ② 整张列表 → ③ 取消', async () => {
  await launch();
  await openDoc('<p>上面</p><ul id="L"><li id="r1">一</li><li id="r2">二</li></ul><p>下面</p>');
  await frame.locator('#r2').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  expect(await selectedIds(), '① 当前行').toEqual(['LI#r2']);
  const one = await selBox();
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  expect(await selectedIds(), '② 整张列表').toEqual(['UL#L']);
  const two = await selBox();
  expect(two.h, '② 的框必须比 ① 高——真的升了一档，不是标记换个位置').toBeGreaterThan(one.h + 10);
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  expect(await selectedIds(), '③ 取消').toEqual([]);
});

test('E-3 行灰选后 Delete：只删这一行（周边还有别的块）', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul id="L"><li id="r1">一</li><li id="r2">二</li></ul><p id="post">后</p>');
  await frame.locator('#r2').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['LI#r2']);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(350);
  expect(await liTexts(), '只少这一行').toEqual(['一']);
  expect(await bodyOrder()).toEqual(['P#pre', 'UL#L', 'P#post']);
  expect(await conformOf(await serialize())).toBe(true);
});

// ⚠ E-3a / E-3b 是被变异自检逼出来的：E-3 那个 fixture 有三个顶层块，removeBlock 在这种情况下
// 恰好也只删掉那个 <li>，两条路径产出一样 —— 把行删除改回 removeBlock，E-3 照样绿（哑门）。
// removeBlock 的危险只在下面这两种形态暴露，缺一条这个修复就没有门。
test('E-3a 文档只剩这一个列表时删行：不许把 <li> 原地改造成 <p>（会产 <ul><p></p></ul>）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await frame.locator('#r2').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['LI#r2']);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(350);
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const ul = d.querySelector('#L');
    return { 列表还在: !!ul, 列表直接子: ul ? [...ul.children].map((e) => e.tagName) : null };
  });
  expect(shape.列表直接子, '<ul> 底下只许有 <li>').toEqual(['LI']);
  // removeBlock 走「作用域只剩一块」分支会 retag 成 <p> 塞在 <ul> 里 —— 非合规、重开整篇降级
  expect(await conformOf(await serialize()), '产物必须合规').toBe(true);
});

test('E-3b 删掉最后一行：空列表换成空段落，不留一个空 <ul>', async () => {
  await launch();
  await openDoc('<p id="pre">前</p><ul id="L"><li id="r1">唯一一行</li></ul><p id="post">后</p>');
  await frame.locator('#r1').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  expect(await selectedIds()).toEqual(['LI#r1']);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { 块: [...d.body.children].filter((e) => !e.hasAttribute('data-ws2-ui')).map((e) => e.tagName),
             空列表残留: d.querySelectorAll('ul:not(:has(li))').length };
  });
  expect(shape.块, '掏空的列表该换成空段落').toEqual(['P', 'P', 'P']);
  expect(shape.空列表残留, '不许留空 <ul>').toBe(0);
  expect(await conformOf(await serialize())).toBe(true);
});

test('E-4 负向：非列表块不受影响，Esc 仍是两档', async () => {
  await launch();
  await openDoc('<p id="a">第一段</p><p id="b">第二段</p>');
  await frame.locator('#b').click();
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  expect(await selectedIds(), '段落一次就是块作用域').toEqual(['P#b']);
  await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  expect(await selectedIds(), '再按直接取消，不许多出一档').toEqual([]);
});
