// 勾选框必须在行选中框**里面**（U2）。
// 病灶：勾选框画在 .ws-todo>li::before 的 left:-22px，落在 li 盒子外；而行选中框画的是 li 的边框盒、
// 整表选中框画的是 ul 的边框盒（ul padding-left 27.2 > 22）——同一个勾选框，Esc 一档在框外、二档在框内。
// 修法是把 li 盒左扩到与 ul 齐平（负 margin + 等量 padding 推回内容），**文字与勾选框绝对位置不动**。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2selbox-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body, todoCss) {
  const style = todoCss === undefined
    ? '<style id="ws-todo-style" data-ws-schema-css="todo">.ws-todo{list-style:none}.ws-todo>li{list-style:none}</style>'
    : (todoCss === null ? '' : '<style id="ws-todo-style" data-ws-schema-css="todo">' + todoCss + '</style>');
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${style}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
}
// 量真实几何：勾选框用 ::before 的 computed left 折算成绝对坐标；文字左缘用 Range 量纯文本矩形
// （量 li.getBoundingClientRect 会把 padding 算进去，看不出文字有没有动）。
const geo = () => frame.locator('body').evaluate((b) => {
  const d = b.ownerDocument, win = d.defaultView;
  const li = d.querySelectorAll('#lst > li')[1];
  const ul = d.querySelector('#lst');
  const liR = li.getBoundingClientRect(), ulR = ul.getBoundingClientRect();
  const cb = win.getComputedStyle(li, '::before');
  const cbLeftAbs = liR.left + parseFloat(cb.left); // ::before 的包含块 = li 的 padding 盒（li 无 border）
  const cbW = parseFloat(cb.width);
  const tn = d.createTreeWalker(li, NodeFilter.SHOW_TEXT).nextNode();
  const tr = d.createRange(); tr.selectNodeContents(tn);
  const textR = tr.getBoundingClientRect();
  return {
    liLeft: +liR.left.toFixed(1), ulLeft: +ulR.left.toFixed(1),
    cbLeft: +cbLeftAbs.toFixed(1), cbRight: +(cbLeftAbs + cbW).toFixed(1),
    textLeft: +textR.left.toFixed(1),
  };
});
const selBoxLeft = () => frame.locator('body').evaluate((b) => {
  const e = b.ownerDocument.querySelector('[data-ws2-selected]');
  return e ? { tag: e.tagName, left: +e.getBoundingClientRect().left.toFixed(1) } : null;
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; frame = null; }
});

test('CB-1 勾选框完整落在行选中框内', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  const g = await geo();
  expect(g.cbLeft, '勾选框左缘不在行盒左缘之外').toBeGreaterThanOrEqual(g.liLeft - 0.5);
  expect(g.cbRight, '勾选框右缘也在行盒内').toBeLessThanOrEqual(g.liLeft + (g.textLeft - g.liLeft));
});

test('CB-2 两档选中框左缘一致（行选 vs 整表选）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  await frame.locator('#lst > li').nth(1).click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const row = await selBoxLeft();
  expect(row.tag).toBe('LI');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const whole = await selBoxLeft();
  expect(whole.tag).toBe('UL');
  expect(Math.abs(row.left - whole.left), '两档框左缘必须齐平（修前差 27.2px）').toBeLessThanOrEqual(1);
});

test('CB-3 文字与勾选框绝对位置不位移（这条是本单元的安全带）', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>');
  const g = await geo();
  // 基线来自改动前实测：ul 左缘 279 / 文字左缘 310.2 / 勾选框左缘 284.2（视口 1280，默认页边距）
  expect(g.textLeft - g.ulLeft, '文字相对 ul 左缘的位置 = 1.7em + 4px = 31.2').toBeCloseTo(31.2, 0);
  expect(g.cbLeft - g.ulLeft, '勾选框相对 ul 左缘的位置 = 1.7em - 22px = 5.2').toBeCloseTo(5.2, 0);
});

test('CB-4 嵌套层不塌：子行文字仍比父行右缩一层', async () => {
  await launch();
  await openDoc('<ul id="lst" class="ws-todo"><li>父行<ul class="ws-todo"><li id="sub">子行</li></ul></li></ul>');
  const d = await frame.locator('body').evaluate((b) => {
    const doc2 = b.ownerDocument;
    const txt = (el) => { const t = doc2.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); const r = doc2.createRange(); r.selectNodeContents(t); return +r.getBoundingClientRect().left.toFixed(1); };
    return { parent: txt(doc2.querySelector('#lst > li')), sub: txt(doc2.querySelector('#sub')) };
  });
  // 一层的净缩进 = 内层 ul 的 padding-left(1.7em=27.2) + li 自身的 4px 文字内距 = 31.2，
  // 改动前后完全一致（负 margin 与等量 padding 逐层对冲，每一层都不动）。
  expect(d.sub - d.parent, '子行仍比父行缩进整整一层（1.7em + 4px = 31.2px）').toBeCloseTo(31.2, 0);
});

test('CB-5 老文档自愈：旧版 todo CSS 被升级，且文字不位移', async () => {
  await launch();
  // 旧版入盘 CSS（padding-left:4px + left:-22px），模拟存量文档
  await openDoc('<ul id="lst" class="ws-todo"><li>第一行</li><li>第二行</li></ul>',
    '.ws-todo{list-style:none}.ws-todo>li{list-style:none;position:relative;padding-left:4px}.ws-todo>li::before{content:"";position:absolute;left:-22px;top:.38em;width:16px;height:16px;box-sizing:border-box;border:1.5px solid #8a857c;border-radius:4px;background:#fff;cursor:pointer}');
  const css = await frame.locator('body').evaluate((b) => (b.ownerDocument.querySelector('style[data-ws-schema-css="todo"]') || {}).textContent || '');
  expect(css, '旧 CSS 已被自愈升级').toContain('margin-left:-1.7em');
  const g = await geo();
  expect(g.textLeft - g.ulLeft, '升级后文字位置与旧版一致').toBeCloseTo(31.2, 0);
  expect(g.cbLeft - g.ulLeft, '升级后勾选框位置与旧版一致').toBeCloseTo(5.2, 0);
});
