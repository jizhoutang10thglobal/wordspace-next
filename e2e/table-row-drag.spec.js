// PR-5c（Notion parity 第三批）：表格行拖拽——行药丸按住拖=移动整行。
// Notion 对照（2026-08-06 复拍 t3f 修正读数）：药丸按住分步拖 → 行 2/行 3 真机互换；拖拽中被拖行
// 渲染为横跨表宽的落槽指示；单击药丸=行菜单不变。表头行不可拖（thead 恒顶是文法硬约束）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rowdrag-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
  cdp = await page.context().newCDPSession(page); // 按住拖动走裸 CDP（Playwright mouse.down+move 在 Electron 卡死）
}
async function openDoc(body) {
  const tag = 'run' + (++seq);
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tag}</title></head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc' + seq + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForFunction((t) => {
    const f = document.getElementById('doc-frame');
    return !!(f && f.contentDocument && f.contentDocument.title === t);
  }, tag, { timeout: 15000 });
  await page.waitForTimeout(300);
}
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

const DOC = '<p id="a">上文。</p><table id="T"><thead><tr id="h"><th scope="col">甲头</th><th scope="col">乙头</th></tr></thead>'
  + '<tbody><tr id="r1"><td id="c11">一甲</td><td>一乙</td></tr>'
  + '<tr id="r2"><td id="c21">二甲</td><td>二乙</td></tr>'
  + '<tr id="r3"><td id="c31">三甲</td><td>三乙</td></tr></tbody></table><p id="z">下文。</p>';

const rowsText = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.querySelectorAll('#T tbody tr')].map((r) => r.firstElementChild.textContent.trim()).join('|');
});
// 悬停某行唤出行药丸并返回其中心（窗口坐标）
async function pillFor(rowSel) {
  const c = await frame.locator(rowSel + ' td, ' + rowSel + ' th').first().boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.waitForTimeout(350);
  const pb = await frame.locator('.ws-rowsel').boundingBox();
  return { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 };
}
async function dragPill(from, toY, { midCheck } = {}) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 6;
  let mid = null;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 30 * i / steps, y: from.y + (toY - from.y) * i / steps, button: 'left', buttons: 1 });
    await page.waitForTimeout(40);
    if (i === steps && midCheck) mid = await midCheck();
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + 30, y: toY, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(200);
  return mid;
}

test('D1: 药丸拖行 2 到行 3 下方 → 行序互换；一步 undo 还原', async () => {
  await launch();
  await openDoc(DOC);
  const r3 = await frame.locator('#r3').boundingBox();
  const pill = await pillFor('#r2');
  await dragPill(pill, r3.y + r3.height + 2);
  expect(await rowsText()).toBe('一甲|三甲|二甲'); // 行 2 落到行 3 之后
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'undo'));
  await expect.poll(() => rowsText()).toBe('一甲|二甲|三甲'); // 单步 undo 整体还原
});

test('D2: 拖拽中指示线可见、横跨表宽、真画出来（S4 判据）', async () => {
  await launch();
  await openDoc(DOC);
  const r3 = await frame.locator('#r3').boundingBox();
  const tb = await frame.locator('#T').boundingBox();
  const pill = await pillFor('#r1');
  const mid = await dragPill(pill, r3.y + r3.height + 2, {
    midCheck: () => page.evaluate(() => {
      const d = document.getElementById('doc-frame').contentDocument;
      const l = d.querySelector('.ws-rowdropline');
      if (!l || l.style.display === 'none') return null;
      const r = l.getBoundingClientRect();
      const cs = getComputedStyle(l);
      return { x: r.x, w: r.width, h: r.height, bg: cs.backgroundColor };
    }),
  });
  expect(mid).not.toBeNull(); // 拖拽中指示线在
  expect(Math.abs(mid.w - tb.width)).toBeLessThan(6); // 横跨表宽（Notion T4）
  expect(mid.h).toBeGreaterThan(1); // 真画出来——CSS 规则被删时翻红
  expect(mid.bg).not.toBe('rgba(0, 0, 0, 0)');
  // 拖完线收场
  expect(await page.evaluate(() => {
    const l = document.getElementById('doc-frame').contentDocument.querySelector('.ws-rowdropline');
    return l.style.display;
  })).toBe('none');
});

test('D3: 药丸纯点击（未越阈）仍开行菜单；拖完那下不开', async () => {
  await launch();
  await openDoc(DOC);
  const pill = await pillFor('#r2');
  await page.mouse.click(pill.x, pill.y);
  await expect(frame.locator('.ws-blockmenu')).toBeVisible(); // 单击=行菜单（既有契约不破）
  await page.keyboard.press('Escape');
  await expect(frame.locator('.ws-blockmenu')).toBeHidden();
  const r3 = await frame.locator('#r3').boundingBox();
  const pill2 = await pillFor('#r1');
  await dragPill(pill2, r3.y + r3.height + 2);
  await page.waitForTimeout(200);
  expect(await frame.locator('.ws-blockmenu').isVisible()).toBe(false); // 拖完的 click 被消化，不弹菜单
});

test('D4: 表头行药丸不可拖——行序不变、无指示线', async () => {
  await launch();
  await openDoc(DOC);
  const r3 = await frame.locator('#r3').boundingBox();
  const pill = await pillFor('#h'); // 悬停表头行
  const mid = await dragPill(pill, r3.y + r3.height + 2, {
    midCheck: () => page.evaluate(() => {
      const l = document.getElementById('doc-frame').contentDocument.querySelector('.ws-rowdropline');
      return l && l.style.display !== 'none';
    }),
  });
  expect(mid).toBe(false); // 全程无指示线
  expect(await rowsText()).toBe('一甲|二甲|三甲'); // 行序不动
  expect(await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelectorAll('#T thead tr').length)).toBe(1); // 表头还在顶上
});

test('D5: 拖到原位（自己的槽）= 无操作不标脏', async () => {
  await launch();
  await openDoc(DOC);
  const r2 = await frame.locator('#r2').boundingBox();
  const pill = await pillFor('#r2');
  await dragPill(pill, r2.y + 6); // 越了 4px 阈值但落回自己上缘槽
  expect(await rowsText()).toBe('一甲|二甲|三甲'); // 原样
  const dirty = await page.evaluate(() => {
    const el = document.querySelector('.doc-dirty, [data-dirty]');
    return el ? true : (document.title.includes('●') || false);
  });
  expect(dirty).toBe(false); // 没标脏（原位拖不产生假编辑）
});

test('D6: 拖出表格下界 → 夹到末槽（行落最后）', async () => {
  await launch();
  await openDoc(DOC);
  const z = await frame.locator('#z').boundingBox();
  const pill = await pillFor('#r1');
  await dragPill(pill, z.y + z.height + 20); // 指针远超表界
  expect(await rowsText()).toBe('二甲|三甲|一甲'); // 行 1 夹到末槽
});
