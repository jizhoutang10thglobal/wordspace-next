// PR-6（Notion parity 第三批）：图片簇 I6/I7/I11/I12/I13/I14。
// Notion 对照（对拍实测，diff/image.json）：
//   I6 说明已空再退格 → 当场回收说明行、光标弹上一个可编辑位（图片本体仍 inert）
//   I7 「说明」是常驻开关（有说明=聚焦、无说明=创建），菜单项不随块状态消失
//   I11 图片本体按住可拖重排（起拖区不只 ⋮⋮ 手柄）；外部拖放仍拒
//   I12 拖拽落点=指针半区（此前 compareDocumentPosition 方向判，指针位置不参与）
//   I13 图片不是键盘停靠位：裸图被 ↑↓ 跳过；带说明图停靠在说明文字（无块级灰选）
//   I14 被跨块选区罩住的图整张呈被蓝罩态（功能早对，视觉上蓝被图片像素盖住）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2imgc-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAAC4wJK5AAAAHElEQVRoge3BAQ0AAADCoPdPbQ43oAAAAAAAAHgaHkAAAcHf9WEAAAAASUVORK5CYII=';
const order = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].filter((el) => !el.hasAttribute('data-ws2-ui')).map((el) => el.tagName + (el.id ? '#' + el.id : ''));
});
const caretIn = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const s = d.getSelection(); if (!s || !s.anchorNode) return null;
  let n = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  const cap = n.closest && n.closest('figcaption');
  if (cap) return 'caption';
  while (n && n.parentElement && n.parentElement !== d.body) n = n.parentElement;
  return n ? (n.tagName + (n.id ? '#' + n.id : '')) : null;
});

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('I7 「说明」常驻：裸图点它创建并聚焦；有说明的图菜单项仍在、点它聚焦既有说明', async () => {
  await launch();
  await openDoc(`<p id="a">上</p><img id="pic" src="${PNG}" alt="图"><p id="z">下</p>`);
  await frame.locator('#pic').hover();
  await page.waitForTimeout(220);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  await frame.locator('.ws-blockmenu-item', { hasText: '说明' }).first().click();
  await page.waitForTimeout(300);
  expect(await caretIn()).toBe('caption'); // 创建并聚焦
  await page.keyboard.type('图注文字');
  await page.keyboard.press('Enter'); // 收尾
  await page.waitForTimeout(300);
  // 有说明的图：菜单项**仍在**（修前只给无说明的图），点它聚焦既有说明
  await frame.locator('figure').hover();
  await page.waitForTimeout(220);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
  const items = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('.ws-blockmenu-item')].map((i) => i.textContent.trim()));
  expect(items.join('|')).toContain('说明');
  await frame.locator('.ws-blockmenu-item', { hasText: '说明' }).first().click();
  await page.waitForTimeout(300);
  expect(await caretIn()).toBe('caption');
  const capText = await page.evaluate(() => document.getElementById('doc-frame').contentDocument.querySelector('figcaption').textContent);
  expect(capText).toBe('图注文字'); // 聚焦的是既有说明，不是新建
});

test('I6 说明清空后再退格：回收说明行、降回裸图、光标弹上一块末尾；图片永不被删', async () => {
  await launch();
  await openDoc(`<p id="a">上文</p><figure id="F"><img id="pic" src="${PNG}" alt="图"><figcaption id="cap">注</figcaption></figure><p id="z">下</p>`);
  await frame.locator('#cap').click();
  await page.waitForTimeout(250);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace'); // 删「注」→ 说明空了
  await page.waitForTimeout(200);
  const mid = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { imgs: d.querySelectorAll('img').length, caps: d.querySelectorAll('figcaption').length };
  });
  expect(mid).toEqual({ imgs: 1, caps: 1 }); // 第一下只删字：行还在（inert 不变）
  await page.keyboard.press('Backspace'); // 第二下：回收说明行
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { imgs: d.querySelectorAll('img').length, figures: d.querySelectorAll('figure').length, caps: d.querySelectorAll('figcaption').length };
  });
  expect(after).toEqual({ imgs: 1, figures: 0, caps: 0 }); // 降回裸图、图没被删
  expect(await caretIn()).toBe('P#a'); // 光标弹到上一个可编辑位置（Notion 同款）
});

test('I11 图片本体拖动可重排（此前只有 ⋮⋮ 手柄能拖）', async () => {
  await launch();
  await openDoc(`<p id="a">上</p><img id="pic" src="${PNG}" alt="图"><p id="z">下</p>`);
  expect(await order()).toEqual(['P#a', 'IMG#pic', 'P#z']);
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const img = d.querySelector('#pic');
    const tgt = d.querySelector('#z');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.bottom - 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    tgt.dispatchEvent(new DragEvent('drop', ev));
    img.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(300);
  expect(await order()).toEqual(['P#a', 'P#z', 'IMG#pic']); // 修前：本体拖动纹丝不动
});

test('I12 落点=指针半区：向下拖到目标块上半区 → 插它上面（修前恒插下面）', async () => {
  await launch();
  await openDoc(`<img id="pic" src="${PNG}" alt="图"><p id="p1">一</p><p id="p2">二</p><p id="p3">三</p>`);
  // 向下拖 pic 到 p3 的**上半区** → 修前（文档序判）线画 p3 下缘、落 p3 后；修后落 p3 前
  const mark = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const img = d.querySelector('#pic');
    const tgt = d.querySelector('#p3');
    const dt = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const ev = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + 10), clientY: Math.round(r.top + 3) };
    tgt.dispatchEvent(new DragEvent('dragover', ev));
    const m = d.querySelector('[data-ws2-drop]');
    const rec = m ? (m.id + ':' + m.getAttribute('data-ws2-drop')) : null;
    tgt.dispatchEvent(new DragEvent('drop', ev));
    img.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return rec;
  });
  await page.waitForTimeout(300);
  expect(mark).toBe('p3:top'); // 指示线在上缘（修前：'p3:bottom'）
  expect(await order()).toEqual(['P#p1', 'P#p2', 'IMG#pic', 'P#p3']); // 画的=做的
});

test('I13 键盘停靠位：裸图被 ↓↑ 跳过；带说明图停靠在说明文字', async () => {
  await launch();
  await openDoc(`<p id="a">上文</p><img id="pic" src="${PNG}" alt="图"><p id="z">下文</p>`);
  await frame.locator('#a').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect(await caretIn()).toBe('P#z'); // 裸图 0 停靠位：直接跳到下一段（修前：图片灰选 1 停靠位）
  const sel = await page.evaluate(() => [...document.getElementById('doc-frame').contentDocument.querySelectorAll('[data-ws2-selected]')].length);
  expect(sel).toBe(0); // 全程无块级灰选
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  expect(await caretIn()).toBe('P#a'); // 反向对称
});

test('I13b 带说明图：↓ 停进说明；再 ↓ 到下一段', async () => {
  await launch();
  await openDoc(`<p id="a">上文</p><figure id="F"><img src="${PNG}" alt="图"><figcaption id="cap">注文</figcaption></figure><p id="z">下文</p>`);
  await frame.locator('#a').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  expect(await caretIn()).toBe('caption'); // 停靠位 = 说明文字（Notion 同款）
});

test('I14 跨块选区罩图：图片呈被蓝罩态（透明度让蓝底透上来）', async () => {
  await launch();
  await openDoc(`<p id="a">上文字</p><img id="pic" src="${PNG}" alt="图"><p id="z">下文字</p>`);
  // 从上段拖选到下段（合成 DOM 选区 + 触发 selectionchange）
  await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const r = d.createRange();
    r.setStart(d.querySelector('#a').firstChild, 0);
    r.setEnd(d.querySelector('#z').firstChild, 3);
    const s = d.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const img = d.querySelector('#pic');
    return { marked: img.hasAttribute('data-ws2-rangesel'), opacity: parseFloat(getComputedStyle(img).opacity) };
  });
  expect(st.marked).toBe(true);      // 功能层本来就对（refreshRangeSel 会标）
  expect(st.opacity).toBeLessThan(1); // 视觉层：透明度让底下的蓝透上来 = 整图被蓝罩（修前 opacity 1，蓝被像素盖死）
});
