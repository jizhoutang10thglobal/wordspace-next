// 块编辑器（ui-demo 式 Notion 块）e2e 真门：CI 用 xvfb 真启动 Electron 跑。
// 覆盖核心交互 + 存盘保真 + 安全红线（危险链接拒绝）+ CSP 强门（取色经 CSSOM span 真渲染）。
// 原画布编辑器的 app.spec 已废（#toolbar/tb-* 选择器全删），本文件整套重写对齐新编辑器。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');

let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-'));
  app = await electron.launch({
    // --no-sandbox：CI 无特权 runner 必需；与 iframe sandbox=allow-same-origin（挡文档脚本）无关
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  // stub 原生弹窗：iframe sandbox 无 allow-modals，blockedit 用父窗口 prompt；openDoc 用 confirm
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

async function openDoc(html, extra = {}) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  for (const [name, body] of Object.entries(extra)) await fs.writeFile(path.join(tmpDir, name), body, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}

const clearUI = async () => { await page.keyboard.press('Escape').catch(() => {}); await page.mouse.click(1200, 800); await page.waitForTimeout(180); };
const tagOf = (id) => frame.locator('body').evaluate((b, id) => (b.ownerDocument.getElementById(id) || {}).tagName, id);
const htmlOf = (id) => frame.locator('body').evaluate((b, id) => { const e = b.ownerDocument.getElementById(id); return e ? e.outerHTML : null; }, id);
const blockCount = () => frame.locator('body').evaluate((b) => [...b.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')).length);
const serialize = () => page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument));

const SIMPLE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body>
<h1 id="t">标题</h1><p id="p1">第一段文字。</p><p id="p2">第二段文字内容。</p><p id="p3">第三段。</p><blockquote id="q">引用。</blockquote></body></html>`;

test.afterEach(async ({}, testInfo) => {
  try {
    if (page) { await fs.mkdir(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, testInfo.title.replace(/[^\w一-龥]+/g, '_').slice(0, 40) + '.png') }); }
  } catch (e) { /* ignore */ }
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('单击即编辑 + 加粗 + 斜杠菜单 + Enter 新建 + Backspace 合并', async () => {
  await launch();
  await openDoc(SIMPLE);
  // 单击可编辑块直接进编辑（无对象框）
  await frame.locator('#p1').click();
  await expect(frame.locator('[data-ws2-editing]')).toHaveCount(1);
  // 选中文字 → 格式气泡浮现 → 加粗
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="加粗"]').click();
  await page.waitForTimeout(150);
  expect(await htmlOf('p1')).toMatch(/<(b|strong)>/i);
  await clearUI();
  // 斜杠菜单
  await frame.locator('#p2').click();
  await page.keyboard.type('/');
  await expect(frame.locator('.ws-slashmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await clearUI();
  // Enter 段末新建正文块（块数 +1）
  let before = await blockCount();
  await frame.locator('#q').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('新块');
  await page.waitForTimeout(150);
  expect(await blockCount()).toBe(before + 1);
  await clearUI();
  // Backspace 块首合并（块数 -1）
  before = await blockCount();
  await frame.locator('#p3').click(); await page.keyboard.press('Home'); await page.keyboard.press('Backspace');
  await page.waitForTimeout(150);
  expect(await blockCount()).toBe(before - 1);
});

test('转为列表产生合法 <ul><li>（非裸 ul，不写坏文件）', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="转为"]').click();
  await frame.locator('.ws-fmtbar-menu-item', { hasText: '列表' }).click();
  await page.waitForTimeout(200);
  expect(await tagOf('p1')).toBe('UL');
  expect(await htmlOf('p1')).toMatch(/<li>/);
  // 存盘：列表合法（ul 内是 li，没有裸文本直挂 ul）
  const html = await serialize();
  expect(html).not.toMatch(/<ul[^>]*>\s*[^<\s]/); // <ul> 后紧跟非标签文本 = 裸文本，禁止
});

test('存盘保真：编辑后无编辑器标记泄漏；简单 + 复杂文档结构保留', async () => {
  await launch();
  await openDoc(SIMPLE);
  await frame.locator('#p1').click(); await page.keyboard.type('改一下');
  await page.waitForTimeout(150);
  let html = await serialize();
  expect(html).not.toMatch(/data-ws2-/);
  expect(html).not.toMatch(/contenteditable/i);
  expect(html).not.toMatch(/ws-grip|ws-fmtbar|ws-slashmenu|ws-blockmenu/);
  expect(html).toMatch(/季度|标题/); // 原内容在
  // 复杂文档：div/table/section 原样保留
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>.card{padding:10px}</style></head><body>'
    + '<h1 id="h">复杂</h1><div id="card" class="card"><h3>卡片</h3><p>内文</p></div>'
    + '<table id="tb"><tbody><tr><td>A</td></tr></tbody></table><section><p>区块</p></section></body></html>');
  await frame.locator('#card').click(); await page.waitForTimeout(150);
  html = await serialize();
  expect(html).not.toMatch(/data-ws2-/);
  expect(html).toMatch(/<table/);
  expect(html).toMatch(/class="card"/);
  expect(html).toMatch(/<section/);
  expect(html).toMatch(/卡片/);
});

test('安全红线：javascript: 链接被拒，不进文档、不写盘', async () => {
  await launch();
  await openDoc(SIMPLE);
  await page.evaluate(() => { window.prompt = () => 'javascript:alert(document.cookie)'; });
  await frame.locator('#p1').click();
  await frame.locator('#p1').selectText();
  await frame.locator('.ws-fmtbar [title="链接"]').click();
  await page.waitForTimeout(250);
  // 不生成链接
  expect(await frame.locator('#p1 a').count()).toBe(0);
  // 不写盘
  const html = await serialize();
  expect(html.toLowerCase()).not.toContain('javascript:');
});

// 取色门（普通文档，回归保护）：选区取色 → 包进 span、getComputedStyle 真画出该色。
// 注意（已知限制）：若**文档自身**声明了严格 style-src（无 unsafe-inline），其 inline 样式会被该文档
// 的 CSP 拦掉 → 取色/高亮在那类文档里不生效（现代 Chromium 对经 CSSOM 设的 style 属性同样按
// style-src 约束，实测推翻了旧 KTD2「CSSOM 不受 CSP 管」的假设）。绝大多数本地 HTML 无此 CSP，取色正常。
// 不改 class+注入样式表绕开：那样存盘后离开注入样式表颜色会丢，inline 才能随文件持久化。
test('取色：选区→CSSOM span、getComputedStyle 真渲染该色（回归保护）', async () => {
  await launch();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await openDoc('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><p id="m">给我上色</p></body></html>');
  await frame.locator('#m').click();
  await frame.locator('#m').selectText();
  await frame.locator('.ws-fmtbar [title="文字色"]').click();
  await frame.locator('.ws-fmtbar-swatches .ws-fmtbar-swatch').nth(1).click(); // 第二个色 = #d93025
  await page.waitForTimeout(200);
  // span 存在 + 真画出该色（若有人把取色改坏/改回被 CSP 丢的写法 → computed 变默认色 → 红）
  expect(await frame.locator('#m span').count()).toBeGreaterThan(0);
  const color = await frame.locator('#m span').first().evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(217, 48, 37)');
  // 真 JS 错误才算（排除 Playwright 在 no-allow-scripts 沙箱 iframe 里执行脚本被挡的良性提示——
  // 那正是沙箱安全在生效，fidelity.spec 已专门验证脚本被挡）
  const real = errs.filter((t) => !/sandboxed and the 'allow-scripts'|blocked script execution|content security policy/i.test(t));
  expect(real, real.join('\n')).toEqual([]);
});

// 用户亲手抓到的两个 bug 的永久回归门：① 选文字后气泡不能闪退（点选的尾随 click 不能折叠选区）；
// ② 改完格式后气泡要粘住、不马上关。用真 shift+点击造选区（触发尾随 click = bug 路径），不用合成 selectText。
test('格式气泡：拖选不闪退 + 改完粘住（bug 回归门）', async () => {
  await launch();
  await openDoc(SIMPLE);
  const barVis = () => frame.locator('body').evaluate((bd) => { const x = bd.ownerDocument.querySelector('.ws-fmtbar'); return !!x && getComputedStyle(x).display !== 'none'; });
  const b = await frame.locator('#p1').boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.click(b.x + 6, y); await page.waitForTimeout(80);              // 真点击进编辑
  await page.keyboard.down('Shift'); await page.mouse.click(b.x + b.width * 0.6, y); await page.keyboard.up('Shift'); // shift+点击扩选（尾随 click）
  await page.waitForTimeout(150);
  const sel = await frame.locator('body').evaluate((bd) => { const s = bd.ownerDocument.getSelection(); return { collapsed: s.isCollapsed, t: s.toString().length }; });
  expect(sel.collapsed, '选区被尾随 click 折叠了(bug1 回归)').toBe(false);
  expect(await barVis(), '选区后格式气泡未显示/闪退(bug1 回归)').toBe(true);
  await frame.locator('.ws-fmtbar [title="加粗"]').click(); await page.waitForTimeout(120);
  expect(await htmlOf('p1')).toMatch(/<(b|strong)>/i);
  expect(await barVis(), '改完格式气泡马上关了(bug2 回归)').toBe(true);
});

// 位移回归门：点进块编辑时，正文不能往右平移（高亮只能用 box-shadow/bg，不能用 padding/margin）。
// 量的是文字位置（range rect），不是元素 border 盒——padding 推文字、但 border 盒 left 不变，量盒量不出来。
test('编辑块不让正文位移（issue 回归门）', async () => {
  await launch();
  await openDoc(SIMPLE);
  const textLeft = () => frame.locator('#p1').evaluate((e) => { const r = e.ownerDocument.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect().left; });
  const before = await textLeft();
  const b = await frame.locator('#p1').boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2); // 真点击进编辑
  await page.waitForTimeout(150);
  const after = await textLeft();
  expect(Math.abs(after - before), `文字位移了 ${(after - before).toFixed(1)}px`).toBeLessThanOrEqual(1);
});
