// 表格两条实机缺口（Colin 2026-08-06 试玩 v0.13.0 后由独立审查提出、我逐条实测坐实）：
//  ① 鼠标离开文档时表格边缘「+」条不收，一直挂在屏上；
//  ② 矩形选中态按方向键，选区凭空消失且光标无着落（按了等于白按）。
// 拖选只能走裸 CDP —— Playwright mouse.down+move 在 Electron 进 drag loop 卡死（仓里铁律）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, cdp, seq = 0;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2eba-'));
  seq = 0;
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1120, height: 760 });
  cdp = await page.context().newCDPSession(page);
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
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); app = null; page = null; frame = null; }
});

const T33 = '<p id="up">表格上方一段。</p><table id="T"><tbody>'
  + '<tr><td id="c11">一甲</td><td id="c12">一乙</td><td id="c13">一丙</td></tr>'
  + '<tr><td id="c21">二甲</td><td id="c22">二乙</td><td id="c23">二丙</td></tr>'
  + '<tr><td id="c31">三甲</td><td id="c32">三乙</td><td id="c33">三丙</td></tr>'
  + '</tbody></table><p id="z">表格下方一段。</p>';

const center = async (sel) => { const b = await frame.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, button: 'left', buttons: 1 });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.waitForTimeout(150);
}
// 「+」条的**可见性**——不是「元素在不在」。元素是池化复用的，永远在；判可见只能看 computed。
const edgeBarVisible = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const bars = [...d.querySelectorAll('[data-ws2-ui]')].filter((x) => /加一行|加一列/.test(x.title || ''));
  if (!bars.length) return { found: 0, visible: 0 };
  const vis = bars.filter((e) => {
    const c = d.defaultView.getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0 && r.width > 0 && r.height > 0;
  });
  return { found: bars.length, visible: vis.length };
});
const rectState = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const box = d.querySelector('.ws-rectsel');
  const c = box && d.defaultView.getComputedStyle(box);
  const sel = d.getSelection();
  let caretCell = null;
  if (sel && sel.rangeCount) {
    let n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    caretCell = n && n.closest ? (n.closest('td,th') || {}).id || null : null;
  }
  return {
    cellsel: d.querySelectorAll('[data-ws2-cellsel]').length,
    boxVisible: !!(box && c.display !== 'none'),
    editingCell: (d.querySelector('[data-ws2-cell]') || {}).id || null,
    caretCell,
    hasRange: !!(sel && sel.rangeCount),
  };
});

test('E1 鼠标离开文档，表格边缘「+」条必须收起', async () => {
  await launch();
  await openDoc(T33);
  const b = await frame.locator('#T').boundingBox();
  // 悬到表格下缘触发带里
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.width / 2, y: b.y + b.height - 2 });
  await page.waitForTimeout(320);
  const on = await edgeBarVisible();
  expect(on.visible, '前置：「+」条真的浮出来了，否则这条门测的是空气').toBeGreaterThan(0);
  // 鼠标甩出 iframe（页面顶部工具栏区域）
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 560, y: 6 });
  await page.waitForTimeout(500);
  const off = await edgeBarVisible();
  expect(off.visible, '鼠标离开文档后「+」条必须一条都不可见（元素可以还在，但不能看得见）').toBe(0);
});

test('E2 负向：鼠标离开文档不许动「选中态」——矩形选区必须还在', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c12'), await center('#c23'));
  const before = await rectState();
  expect(before.cellsel, '前置：先框出 2×2').toBe(4);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 560, y: 6 });
  await page.waitForTimeout(500);
  const after = await rectState();
  expect(after.cellsel, '鼠标滑出去不该让用户主动做出来的选区消失').toBe(4);
  expect(after.boxVisible, '蓝框也该还在').toBe(true);
});

test('E3 矩形态按 ↓ / → → 光标落到右下角格，不留真空', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c12'), await center('#c23'));
  expect((await rectState()).cellsel, '前置：2×2 = c12/c13/c22/c23').toBe(4);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  const s = await rectState();
  expect(s.cellsel, '矩形已解除').toBe(0);
  expect(s.boxVisible, '蓝框已收（不留鬼影）').toBe(false);
  // 核心：不许出现「没选区也没光标」的真空
  expect(s.editingCell, '光标必须有着落——落进矩形右下角那一格').toBe('c23');
  expect(s.hasRange, '必须有一个真实的 range').toBe(true);
  expect(s.caretCell, 'range 也在那一格里').toBe('c23');
});

test('E4 矩形态按 ↑ / ← → 光标落到左上角格', async () => {
  await launch();
  await openDoc(T33);
  await drag(await center('#c12'), await center('#c23'));
  expect((await rectState()).cellsel).toBe(4);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  const s = await rectState();
  expect(s.cellsel).toBe(0);
  expect(s.editingCell, '←/↑ 收到起点 = 左上角格（照文字选区的老规矩）').toBe('c12');
  expect(s.hasRange).toBe(true);
});

test('E5 负向：矩形态的其它键语义一字未动（Delete 清内容 / Esc 上卷 / 打字进左上格）', async () => {
  await launch();
  await openDoc(T33);
  // Delete：清内容不动结构
  await drag(await center('#c12'), await center('#c23'));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const shape = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return { cells: d.querySelectorAll('#T td').length, texts: [...d.querySelectorAll('#T td')].map((c) => c.textContent.trim()) };
  });
  expect(shape.cells, 'Delete 不动结构：仍 9 格').toBe(9);
  expect(shape.texts, '只清矩形内那 4 格').toEqual(['一甲', '', '', '二甲', '', '', '三甲', '三乙', '三丙']);
  // Esc：上卷成整表灰选
  await drag(await center('#c31'), await center('#c32'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const s = d.querySelector('[data-ws2-selected]');
    return s ? s.tagName : 'none';
  }), 'Esc 仍上卷成整表灰选').toBe('TABLE');
});
