// E5：gutter「+」点下去立刻弹块类型选择器（Notion 实测 2026-08-04）。
// Notion 侧实证：① 点「+」→ 插入一个空文本块 **并同时弹出块类型选择器**；
//                ② 该空块的占位在选择器开着时变成「Type to filter…」；
//                ③ 按 Escape → 只关选择器，**那个空块留下**（不回滚插入）；
//                ④ aria-label 写着 "Click to add below. Option-click to add a block above" —— ⌥ 插上方，与我们既有一致。
// 真坑不在唤起，而在**确认**：既有 applySlash 假定用户打过字面「/」，会往回删 query.length+1 个字符。
// 从「+」进来没有那个字符 → 改成 query.length + (typed ? 1 : 0)。
// ⚠ 诚实标注：这条**当前没有门能咬住**——变异自检把 typed 判断去掉，七条全绿，因为每个块是独立
//   contenteditable、selection.modify 跨不出块边界，多删那一下打在空气上。留着是为了块模型万一收敛成
//   单一 contenteditable 时不变成丢数据 bug。能被门咬住的是反方向（不删 query → E5-3 翻红）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2plus-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conform = async () => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, await serialize());
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + '[' + (el.textContent || '').trim().replace(/\s+/g, '') + ']').join(' ');
});
const menuOpen = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const m = d.querySelector('.ws-slashmenu');
  return !!m && m.style.display !== 'none';
});
async function hoverAndPlus(sel, alt) {
  await frame.locator(sel).hover();
  await page.waitForTimeout(160);
  await frame.locator('.ws-plus').click(alt ? { modifiers: ['Alt'] } : undefined);
  await page.waitForTimeout(280);
}

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('E5-1 段落旁点「+」：插空块 + 立刻弹选择器，且空块占位变成「输入以筛选」', async () => {
  await launch();
  await openDoc('<p id="p1">上一段</p><p id="p2">下一段</p>');
  await hoverAndPlus('#p1');
  expect(await menuOpen(), '选择器必须同时弹出（这就是 E5）').toBe(true);
  expect(await shape(), '空块插在下方').toBe('P[上一段] P[] P[下一段]');
  const ph = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('[data-ws2-editing]');
    return { picking: d.documentElement.hasAttribute('data-ws2-picking'), content: getComputedStyle(el, '::before').content };
  });
  expect(ph.picking, '选择器开着时文档根带 picking 标记').toBe(true);
  expect(ph.content, '占位文案切成筛选提示（Notion 同款 Type to filter…）').toContain('筛选');
});

test('E5-2 从「+」选一个类型：产物类型对、上一块完整（当前架构下多删一下打在空气上，见文件头注）', async () => {
  await launch();
  await openDoc('<p id="p1">上一段ABC</p>');
  await hoverAndPlus('#p1');
  await frame.locator('.ws-slashmenu-item', { hasText: '待办' }).first().click();
  await page.waitForTimeout(350);
  expect(await frame.locator('#p1').textContent(), '上一块一个字都不能少').toBe('上一段ABC');
  const s = await shape();
  expect(s.startsWith('P[上一段ABC] UL['), '产物是待办列表，接在下方：' + s).toBe(true);
  expect(await conform()).toBe(true);
});

test('E5-3 打字筛选后确认：query 字符不残留在产物里', async () => {
  await launch();
  await openDoc('<p id="p1">上一段</p>');
  await hoverAndPlus('#p1');
  // ⚠ 用 ASCII 筛选词：Playwright 打中文走 Input.insertText、**不产生 keydown**，
  //   而 query 是在 keydown 里累积的 → 中文永远进不了 query，测出来的是假象（本条第一版就栽在这）
  await page.keyboard.type('todo');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  const s = await shape();
  expect(s, '筛选用的「todo」四个字不得留在产物里').toBe('P[上一段] UL[]');
  expect(await frame.locator('#p1').textContent(), '上一块仍完整').toBe('上一段');
  expect(await conform()).toBe(true);
});

test('E5-4 Escape 只关选择器、空块留下（Notion 实测同款，不回滚插入）', async () => {
  await launch();
  await openDoc('<p id="p1">上一段</p>');
  await hoverAndPlus('#p1');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect(await menuOpen(), '选择器关掉').toBe(false);
  expect(await shape(), '空块留下').toBe('P[上一段] P[]');
  const picking = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.documentElement.hasAttribute('data-ws2-picking'));
  expect(picking, 'picking 标记必须清掉，否则占位文案永远卡在「输入以筛选」').toBe(false);
  await page.keyboard.type('接着打字');
  await expect.poll(async () => await shape()).toBe('P[上一段] P[接着打字]');
});

test('E5-5 ⌥ 点「+」插到上方，同样弹选择器', async () => {
  await launch();
  await openDoc('<p id="p1">上一段</p><p id="p2">下一段</p>');
  await hoverAndPlus('#p2', true);
  expect(await shape(), '插在 #p2 上方').toBe('P[上一段] P[] P[下一段]');
  expect(await menuOpen(), '⌥ 路径也要弹').toBe(true);
});

test('E5-6 列表行的「+」：劈开列表插空块，也弹选择器', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await hoverAndPlus('#r1');
  expect(await shape(), '在第一行之后劈开').toBe('UL[一] P[] UL[二]');
  expect(await menuOpen()).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await conform()).toBe(true);
});

test('E5-7 打「/」这条老路不受影响：字面 / 仍要被删掉', async () => {
  await launch();
  await openDoc('<p id="p1">abc</p>');
  await frame.locator('#p1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/');
  await page.waitForTimeout(300);
  expect(await menuOpen(), '打 / 仍弹菜单').toBe(true);
  await frame.locator('.ws-slashmenu-item', { hasText: '待办' }).first().click();
  await page.waitForTimeout(350);
  const s = await shape();
  expect(s, '字面「/」必须被删掉，不能留在文档里：' + s).not.toContain('/');
  expect(await conform()).toBe(true);
});

// ===== 对抗审查 ADV-2 的回归门 =====
// 通用门：**任何时刻**序列化出来的字节都不许带编辑器交互态标记。写一次就永久覆盖将来新增的标记，
// 比「记得往 WS2_MARKERS 里加」可靠——ADV-2 正是漏加了 data-ws2-picking。
// 时序不是竞态而是必然：点「+」→ markDirty 排 1200ms 自动保存 → 同步打开选择器；
// 人读完一屏块类型远超 1.2 秒，所以第一次自动保存**几乎必然**发生在选择器开着的时候。
const WS2_ATTR_RE = /data-ws2-[a-z]+/;

test('ADV-2 选择器开着时序列化：字节里不得出现任何 data-ws2-* 交互态标记', async () => {
  await launch();
  await openDoc('<p id="p1">上一段</p><p id="p2">下一段</p>');
  await hoverAndPlus('#p1');
  expect(await menuOpen(), '前置：选择器确实开着（否则这条门测了个寂寞）').toBe(true);
  const disk = await serialize();
  const hit = disk.match(WS2_ATTR_RE);
  expect(hit ? hit[0] : undefined, '选择器开着时序列化，泄漏了交互态标记').toBeUndefined();
  expect(await conform()).toBe(true);
});

test('ADV-2b 拖拽指示线亮着时序列化：同样不得泄漏', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">甲</li><li id="b">乙</li></ul>');
  await frame.locator('#b').hover();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const grip = d.querySelector('.ws-grip');
    const tgt = d.getElementById('a');
    const root = d.querySelector('[data-ws2-root]') || d.body;
    const rr = root.getBoundingClientRect();
    const x = Math.round(rr.left + (parseFloat(getComputedStyle(root).paddingLeft) || 0) + 26);
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: r.bottom - 3 }));
  });
  await page.waitForTimeout(200);
  const marked = await page.evaluate(() => !!document.getElementById('doc-frame').contentDocument.querySelector('[data-ws2-drop]'));
  expect(marked, '前置：指示线确实亮着').toBe(true);
  const disk = await serialize();
  const hit = disk.match(WS2_ATTR_RE);
  expect(hit ? hit[0] : undefined, '拖拽指示线亮着时泄漏了标记').toBeUndefined();
});

test('W-4 列表行的「+」：产物也要显示占位（此前塞了 <br> 导致 :empty 不成立，一个占位都没有）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await hoverAndPlus('#r1');
  const ph = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector('[data-ws2-editing]');
    return { html: el.innerHTML, content: getComputedStyle(el, '::before').content };
  });
  expect(ph.html, '产物是真空块（不塞 <br>，与段落那条路一致）').toBe('');
  expect(ph.content, '占位切成筛选提示').toContain('筛选');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.type('还能打字');
  await expect.poll(async () => await shape()).toContain('还能打字');
  expect(await conform()).toBe(true);
});
