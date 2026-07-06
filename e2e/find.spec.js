// 文档内查找（Cmd+F）e2e 真门：CI 用 xvfb 真启动 Electron 跑。
// 强断言（S4「查 class ≠ 视觉验证」）：CSS Custom Highlight 无 DOM 节点，
//   ① range 建对 —— 读 iframe 内 CSS.highlights registry；
//   ② 像素真变 —— 截首个匹配区域，清掉 highlight 后同区域必须变（若不变=::highlight 被 CSP 拦/哑门）；
//   ③ 变异探针内建在 ②：清 highlight = 把「画」拆掉，断言必翻。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');

let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2e2e-find-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

async function openDoc(html) {
  const docPath = path.join(tmpDir, 'doc.html');
  await fs.writeFile(docPath, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, p) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', p); }, docPath);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(400);
  return docPath;
}

const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);

// 4 个 MATCH：h1(1) + p1(1) + p2(2)，p3 无。首个在标题、天然在视野内（截图稳定、无滚动动画干扰）。
const FIND_DOC = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>查找测试</title></head><body>
<h1 id="t">MATCH 在标题里</h1>
<p id="p1">第一段有一个 MATCH 词。</p>
<p id="p2">第二段又一个 MATCH，还有一个 MATCH。</p>
<p id="p3">这一段没有关键词。</p></body></html>`;

// 首个匹配的绝对 box（iframe 偏移 + range rect），给 clip 截图。
async function firstMatchBox() {
  return page.evaluate(() => {
    const f = document.getElementById('doc-frame');
    const fr = f.getBoundingClientRect();
    const hl = f.contentWindow.CSS.highlights.get('ws-find');
    const r = hl ? [...hl][0] : null;
    if (!r) return null;
    const rr = r.getBoundingClientRect();
    return {
      x: Math.round(fr.left + rr.left),
      y: Math.round(fr.top + rr.top),
      width: Math.max(6, Math.round(rr.width)),
      height: Math.max(6, Math.round(rr.height)),
    };
  });
}

test.afterEach(async ({}, testInfo) => {
  try {
    if (page) { await fs.mkdir(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, 'find_' + testInfo.title.replace(/[^\w一-龥]+/g, '_').slice(0, 34) + '.png') }); }
  } catch (e) { /* ignore */ }
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('FIND-1: Cmd+F 开查找条 + 真高亮匹配（range 建对 + 像素真变 + 变异探针）', async () => {
  await launch();
  await openDoc(FIND_DOC);

  // Cmd+F（菜单 find-in-doc）→ 块编辑器活跃 → 查找条出现在父层
  await menu('find-in-doc');
  await expect(page.locator('.ws-docfind')).toBeVisible();

  // 输入查询词
  await page.locator('.ws-docfind-input').fill('MATCH');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);

  // ── 强断言①：range 建对（在 iframe 上下文读 registry）──
  const reg = await frame.locator('body').evaluate(() => {
    const hl = CSS.highlights.get('ws-find');
    const cur = CSS.highlights.get('ws-find-cur');
    const rs = hl ? [...hl] : [];
    return { count: rs.length, allMatch: rs.every((r) => r.toString() === 'MATCH'), cur: cur ? [...cur].length : 0 };
  });
  expect(reg.count).toBe(4);
  expect(reg.allMatch).toBe(true);
  expect(reg.cur).toBe(1); // 当前匹配单独一层

  // ── 强断言②+③：像素真变 + 变异探针 ──
  const box = await firstMatchBox();
  expect(box).not.toBeNull();
  const withHL = await page.screenshot({ clip: box });
  // 变异探针：清掉 highlight registry（把「画」拆掉）
  await frame.locator('body').evaluate(() => CSS.highlights.clear());
  await page.waitForTimeout(150);
  const noHL = await page.screenshot({ clip: box });
  // 高亮真画出来 → 两张必然不同；相同 = ::highlight 没生效（CSP 拦 / 哑门）→ fail
  expect(Buffer.compare(withHL, noHL)).not.toBe(0);
});

test('FIND-2: 上下导航（Enter/Shift+Enter）+ Esc 关闭并清高亮', async () => {
  await launch();
  await openDoc(FIND_DOC);
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('MATCH');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);

  // Enter → 下一个
  await page.locator('.ws-docfind-input').press('Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/2\s*\/\s*4/);
  // Shift+Enter → 上一个（回到 1；环绕也顺带验：从 1 再 Shift+Enter 到 4）
  await page.locator('.ws-docfind-input').press('Shift+Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);
  await page.locator('.ws-docfind-input').press('Shift+Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/4\s*\/\s*4/); // 环绕到最后一个

  // Esc → 关闭 + 清高亮
  await page.locator('.ws-docfind-input').press('Escape');
  await expect(page.locator('.ws-docfind')).toBeHidden();
  const stillThere = await frame.locator('body').evaluate(() => CSS.highlights.has('ws-find') || CSS.highlights.has('ws-find-cur'));
  expect(stillThere).toBe(false);
});

test('FIND-3: 无匹配显示「无结果」、导航禁用', async () => {
  await launch();
  await openDoc(FIND_DOC);
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('这个词肯定没有xyz');
  await expect(page.locator('.ws-docfind-count')).toHaveText('无结果');
  const has = await frame.locator('body').evaluate(() => CSS.highlights.has('ws-find'));
  expect(has).toBe(false);
});

test('FIND-4: 换文档时查找条关闭 + 高亮清干净（不飘到下一个文档）', async () => {
  await launch();
  await openDoc(FIND_DOC);
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('MATCH');
  await expect(page.locator('.ws-docfind')).toBeVisible();
  // 开另一个文档（detachEditors → WS2Find.close）
  await openDoc(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>x</title></head><body><h1 id="h">另一个文档</h1><p id="q">没有那个词。</p></body></html>`);
  await expect(page.locator('.ws-docfind')).toBeHidden();
  const clean = await frame.locator('body').evaluate(() => CSS.highlights.has('ws-find') || CSS.highlights.has('ws-find-cur'));
  expect(clean).toBe(false);
});
