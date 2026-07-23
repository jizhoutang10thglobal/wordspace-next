// 勾选父项后未勾选的嵌套子项被划线+变灰（纯视觉污染，check-2）。text-decoration:line-through 按 CSS 装饰
// 传播规则绘穿 in-flow 后代、无法从后代取消 → 候选②：含子列表的勾选项不加 line-through（只变灰）、嵌套 color 重置。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2chkvis-'));
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
const styleOf = (sel) => frame.locator(sel).evaluate((el) => { const cs = getComputedStyle(el); return { color: cs.color, deco: cs.textDecorationLine }; });

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

test('勾选父项不划穿未勾嵌套子项：子项正常色、无划线（check-2）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="parent" data-checked="true">父任务<ul class="ws-todo"><li id="child">子任务</li></ul></li></ul>');
  const child = await styleOf('#child');
  expect(child.color, '子项 color 重置回正文色（非灰 rgb(155,152,145)）').not.toBe('rgb(155, 152, 145)');
  expect(child.deco, '子项无划线（父项不加 line-through 故无传播）').toBe('none');
  const parent = await styleOf('#parent');
  expect(parent.color, '父项仍变灰').toBe('rgb(155, 152, 145)');
  expect(parent.deco, '含子列表的勾选父项不划线（候选②：避免划穿子项）').toBe('none');
  expect(await conformOf(await serialize())).toBe(true);
});

test('叶子勾选项照常灰+划线（无子列表，不因反制丢既有视觉）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="leaf" data-checked="true">已完成的事</li><li>没完成</li></ul>');
  const leaf = await styleOf('#leaf');
  expect(leaf.color, '叶子勾选项变灰').toBe('rgb(155, 152, 145)');
  expect(leaf.deco, '叶子勾选项照常划线（:has 反制不误伤无子列表项）').toContain('line-through');
  expect(await conformOf(await serialize())).toBe(true);
});

test('入盘 CSS 含视觉传播反制规则（磁盘直开等价）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li data-checked="true">父<ul class="ws-todo"><li>子</li></ul></li></ul>');
  await frame.locator('#lst > li').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await page.waitForTimeout(200);
  const html = await serialize();
  expect(html.includes(':not(:has(ul,ol))'), '入盘 ws-todo CSS 含反制规则（编辑器与磁盘同口径）').toBe(true);
  expect(await conformOf(html)).toBe(true);
});

// U25/visual-3：勾选框对比度达 WCAG 3:1（非文本对比，1.4.11）。读 computedStyle 真算相对亮度对比。
function wcagRatio(c1, c2) {
  const parse = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (c) => { const [r, g, b] = parse(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const la = L(c1), lb = L(c2), hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

test('U25：勾选框对比度达 WCAG 3:1（浅色：未勾边框/已勾蓝底/✓字形）（visual-3）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li id="u">未勾项</li><li id="c" data-checked="true">已勾项</li></ul>');
  const d = await frame.locator('body').evaluate(() => {
    let paper = 'rgb(255, 255, 255)';
    for (const el of [document.body, document.documentElement]) { const bg = getComputedStyle(el).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { paper = bg; break; } }
    const u = document.getElementById('u'), c = document.getElementById('c');
    return { paper, uBorder: getComputedStyle(u, '::before').borderTopColor, cBg: getComputedStyle(c, '::before').backgroundColor, cGlyph: getComputedStyle(c, '::before').color };
  });
  expect(wcagRatio(d.uBorder, d.paper), `未勾边框 vs 纸底 ≥3:1（边框=${d.uBorder} 纸=${d.paper}）`).toBeGreaterThanOrEqual(3);
  expect(wcagRatio(d.cBg, d.paper), `已勾蓝底 vs 纸底 ≥3:1（蓝=${d.cBg}）`).toBeGreaterThanOrEqual(3);
  expect(wcagRatio(d.cGlyph, d.cBg), `✓ 字形 vs 蓝底 ≥3:1`).toBeGreaterThanOrEqual(3);
});
