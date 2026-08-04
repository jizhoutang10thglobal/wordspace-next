// 对抗审查 findings 的回归门（2026-08-04，审查 agent 提出、我逐条真跑复现后修）：
// P1-1 摘子树期间落 checkpoint → 一次 undo 抹掉嵌套子项并入盘（丢内容）
// P1-2 嵌套行菜单「转为」→ 整张顶层列表被拍成一个段落
// P2-3 gutter 锚点没收口：进编辑/滚动后手柄画在首行、却作用于上次悬停的行
// P2-4 菜单开着时行被删（⌘A 全删）→ 菜单不关、再点抛未捕获异常
// P3-5 「复制」把 data-ws2-selected 一起克隆到副本
// P3-6 删嵌套唯一子行 → 焦点悬空、接着打字全丢
// P3-7 空 toggle 占位只在真 <p></p> 上出现，打过字再删干净就不再出现
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, frame, tmpDir, docPath;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2rev-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>${body}</body></html>`;
  docPath = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));
const conformOf = (h) => page.evaluate((x) => { const d = new DOMParser().parseFromString(x, 'text/html'); return WS2SchemaRegistry.classify(d).conform; }, h);
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const shape = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  return [...d.body.children].map((el) => el.tagName + '[' + (el.textContent || '').trim().replace(/\s+/g, '') + ']').join(' ');
});
const gripCenterY = () => page.evaluate(() => {
  const d = document.getElementById('doc-frame').contentDocument;
  const g = d.querySelector('.ws-grip');
  if (!g || g.style.display === 'none') return null;
  const r = g.getBoundingClientRect(); return Math.round(r.y + r.height / 2);
});
const rowBand = (sel) => page.evaluate((s) => {
  const d = document.getElementById('doc-frame').contentDocument;
  const r = d.querySelector(s).getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
}, sel);
async function openRowMenuAt(sel, pos) {
  await frame.locator(sel).hover(pos ? { position: pos } : undefined);
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await expect(frame.locator('.ws-blockmenu')).toBeVisible();
}
const clickItem = async (label) => { await frame.locator('.ws-blockmenu-item', { hasText: label }).first().click(); await page.waitForTimeout(250); };

test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('P1-1 带子项的行「转为正文」后 undo 一步：子项必须回来，且不得有缺子项的中间态入盘', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">一级A</li><li id="b">一级B<ul id="S"><li id="b1">二级B1</li><li id="b2">二级B2</li></ul></li><li id="c">一级C</li></ul>');
  await openRowMenuAt('#b', { x: 30, y: 6 });
  await clickItem('转为正文');
  expect(await shape(), '转换结果：前列表/段落/子树列表/后列表').toBe('UL[一级A] P[一级B] UL[二级B1二级B2] UL[一级C]');
  await menu('undo');
  await page.waitForTimeout(400);
  const after = await shape();
  expect(after.includes('二级B1'), 'undo 一步后子项必须还在（此前一次 undo 落到「子树已摘走」的中间态 = 丢内容）').toBe(true);
  expect(after, 'undo 一步回到原结构').toBe('UL[一级A一级B二级B1二级B2一级C]');
  // 磁盘验证：等自动保存，字节里必须有子项
  await page.waitForTimeout(2200);
  const disk = await fs.readFile(docPath, 'utf8');
  expect(disk.includes('二级B1'), '磁盘字节必须含子项（此前中间态被写盘）').toBe(true);
});

test('P1-2 嵌套行的菜单：不提供「转为」（结构上无法把嵌套行抽成块），且绝不拍平整张列表', async () => {
  await launch();
  await openDoc('<ul id="L"><li>一级A</li><li>一级B<ul><li id="n1">二级N1</li><li>二级N2</li></ul></li><li>一级C</li></ul>');
  const before = await shape();
  await openRowMenuAt('#n1');
  const items = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('.ws-blockmenu-item')].map((b) => b.textContent.trim());
  });
  expect(items.some((t) => t.startsWith('转为')), '嵌套行不给「转为」组').toBe(false);
  expect(items.includes('删除'), '删除/复制/插入仍在（这些对嵌套行是对的）').toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await shape(), '开关菜单不改结构').toBe(before);
});

test('P2-3 gutter 锚点收口：进编辑后手柄画在哪就作用在哪', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li><li id="r3">三</li><li id="r4">四</li></ul>');
  await frame.locator('#r3').click();          // 进编辑（此前 enterEdit 把锚点重置到整块 = 首行）
  await page.waitForTimeout(200);
  const g = await gripCenterY();
  const band = await rowBand('#r3');
  expect(g, '手柄可见').not.toBeNull();
  expect(g >= band.top && g <= band.bottom, '进编辑后手柄仍画在第三行（此前跳回首行）').toBe(true);
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(250);
  expect(await shape(), '「+」作用点与手柄画的位置一致（第三行之后）').toBe('UL[一二三] P[] UL[四]');
});

test('P2-4 行菜单开着时整篇被删：菜单自动关闭，再无未捕获异常', async () => {
  await launch();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul><p id="p1">段</p>');
  await openRowMenuAt('#r2');
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(350);
  const menuOpen = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const m = d.querySelector('.ws-blockmenu');
    return !!m && m.style.display !== 'none';
  });
  expect(menuOpen, '文档被清空后行菜单必须关掉（此前浮在空文档上指着已删的行）').toBe(false);
  expect(errors, '不得抛未捕获异常').toEqual([]);
});

test('P3-5 「复制」不把行高亮属性克隆进副本', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">一</li><li id="r2">二</li></ul>');
  await openRowMenuAt('#r2');
  await clickItem('复制');
  const marked = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    return [...d.querySelectorAll('[data-ws2-selected]')].length;
  });
  expect(marked, '副本不带 data-ws2-selected（此前副本一直蓝底）').toBe(0);
});

test('P3-6 删掉嵌套唯一子行后仍可继续打字（焦点不悬空）', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="r1">父<ul id="S"><li id="n1">仅一个嵌套</li></ul></li><li id="r2">二</li></ul>');
  await openRowMenuAt('#n1');
  await clickItem('删除');
  await page.keyboard.type('打字看看');
  await expect.poll(async () => await shape(), { message: '删完后打字必须落进文档（此前 contenteditable 数为 0、键入全丢）' })
    .toContain('打字看看');
  expect(await conformOf(await serialize())).toBe(true);
});

test('P3-7 空 toggle 占位：打过字再删干净仍然出现', async () => {
  await launch();
  await openDoc('<details open id="D"><summary>标题</summary><p id="bp">先打点字</p></details>');
  await frame.locator('#bp').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(350);
  const hint = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const p = d.querySelector('#D > p');
    return { content: getComputedStyle(p, '::before').content, html: p.innerHTML };
  });
  expect(hint.content.includes('空折叠块'), '内容删空后仍显示占位（此前 contenteditable 留 <br>、:empty 不成立 → 占位永不出现）').toBe(true);
  expect((await serialize()).includes('空折叠块'), '占位不入盘').toBe(false);
});
