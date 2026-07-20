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
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
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

// 第 n 个匹配的绝对 box（iframe 偏移 + range rect），给 clip 截图。
async function nthMatchBox(n) {
  return page.evaluate((idx) => {
    const f = document.getElementById('doc-frame');
    const fr = f.getBoundingClientRect();
    const hl = f.contentWindow.CSS.highlights.get('ws-find');
    const rs = hl ? [...hl] : [];
    const r = rs[idx];
    if (!r) return null;
    const rr = r.getBoundingClientRect();
    return {
      x: Math.round(fr.left + rr.left),
      y: Math.round(fr.top + rr.top),
      width: Math.max(6, Math.round(rr.width)),
      height: Math.max(6, Math.round(rr.height)),
    };
  }, n);
}

// 当前匹配（ws-find-cur）落在全部匹配（ws-find）里的第几个——用 range 边界比较，验证「当前」真的移动。
const curIndex = () =>
  frame.locator('body').evaluate(() => {
    const all = [...(CSS.highlights.get('ws-find') || [])];
    const cur = [...(CSS.highlights.get('ws-find-cur') || [])][0];
    if (!cur) return -1;
    for (let i = 0; i < all.length; i++) {
      if (all[i].compareBoundaryPoints(Range.START_TO_START, cur) === 0) return i;
    }
    return -1;
  });

test.afterEach(async ({}, testInfo) => {
  try {
    if (page) { await fs.mkdir(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, 'find_' + testInfo.title.replace(/[^\w一-龥]+/g, '_').slice(0, 34) + '.png') }); }
  } catch (e) { /* ignore */ }
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test.only('FIND-1: Cmd+F 开查找条 + 真高亮匹配（range 建对 + 像素真变 + 变异探针）', async () => {
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

  // ── 强断言②+③：像素真变 + 变异探针（两层都验：当前匹配琥珀 + 非当前匹配淡黄基础层）──
  const box0 = await nthMatchBox(0); // 当前匹配（ws-find-cur 琥珀）
  const box1 = await nthMatchBox(1); // 非当前匹配（ws-find 淡黄基础层）——单独验，别只测琥珀那一层
  expect(box0).not.toBeNull();
  expect(box1).not.toBeNull();
  const cur0 = await page.screenshot({ clip: box0 });
  const base1 = await page.screenshot({ clip: box1 });
  // 变异探针：清掉 highlight registry（把「画」拆掉）
  await frame.locator('body').evaluate(() => CSS.highlights.clear());
  await page.waitForTimeout(150);
  const cur0Off = await page.screenshot({ clip: box0 });
  const base1Off = await page.screenshot({ clip: box1 });
  // 两层都真画出来 → 各自清前清后必然不同；相同 = ::highlight 没生效（CSP 拦 / 哑门）→ fail
  expect(Buffer.compare(cur0, cur0Off)).not.toBe(0); // 当前匹配（琥珀）真画了
  expect(Buffer.compare(base1, base1Off)).not.toBe(0); // 非当前匹配（淡黄基础层）也真画了
});

test('FIND-2: 上下导航（Enter/Shift+Enter）+ Esc 关闭并清高亮', async () => {
  await launch();
  await openDoc(FIND_DOC);
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('MATCH');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);
  expect(await curIndex()).toBe(0); // 当前高亮真的在第 0 个（不只看计数文本）

  // Enter → 下一个：计数 + 当前高亮层双双前移
  await page.locator('.ws-docfind-input').press('Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/2\s*\/\s*4/);
  expect(await curIndex()).toBe(1); // ws-find-cur 真跟着 Enter 移到第 1 个
  // Shift+Enter → 上一个（回到 0）
  await page.locator('.ws-docfind-input').press('Shift+Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);
  expect(await curIndex()).toBe(0);
  // 再 Shift+Enter → 环绕到最后一个（第 3 个）
  await page.locator('.ws-docfind-input').press('Shift+Enter');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/4\s*\/\s*4/);
  expect(await curIndex()).toBe(3); // 环绕，当前高亮真到最后一个

  // Esc → 关闭 + 清高亮
  await page.locator('.ws-docfind-input').press('Escape');
  await expect(page.locator('.ws-docfind')).toBeHidden();
  const stillThere = await frame.locator('body').evaluate(() => CSS.highlights.has('ws-find') || CSS.highlights.has('ws-find-cur'));
  expect(stillThere).toBe(false);
});

test('FIND-5: 同文档反复 Cmd+F 不累积 ::highlight 样式表（防泄漏回归，对抗审查 P2）', async () => {
  await launch();
  await openDoc(FIND_DOC);
  const sheetCount = () => frame.locator('body').evaluate(() => document.adoptedStyleSheets.length);
  // 首次开查找 + 输入 → 注入一张 ::highlight 构造样式表
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('MATCH');
  await page.waitForTimeout(120);
  const after1 = await sheetCount();
  // 反复 Cmd+F（每次都会走 open()→ensureSheet）——修前每次 +1、旧表从不移除
  for (let i = 0; i < 8; i++) {
    await menu('find-in-doc');
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(80);
  const afterN = await sheetCount();
  expect(afterN).toBe(after1); // 不增长（ensureSheet 的 indexOf 守卫认出已注入的表、不重复追加）
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

test('FIND-4: 换文档→查找条关闭；在新文档重开能查新内容（frame 重指向、不串状态）', async () => {
  await launch();
  await openDoc(FIND_DOC);
  await menu('find-in-doc');
  await page.locator('.ws-docfind-input').fill('MATCH');
  await expect(page.locator('.ws-docfind')).toBeVisible();
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*4/);
  // 开另一个文档（detachEditors → WS2Find.close 关条）
  await openDoc(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>x</title></head><body>
<h1 id="h">另一个文档 KEEP</h1><p id="q">这里 KEEP 又 KEEP。</p></body></html>`);
  await expect(page.locator('.ws-docfind')).toBeHidden(); // 查找条随换文档关闭
  // 在新文档重开查找 → WS2Find 重指向到新 iframe，能查新文档内容（不是空断言：真读新文档 registry）
  await menu('find-in-doc');
  await expect(page.locator('.ws-docfind')).toBeVisible();
  await page.locator('.ws-docfind-input').fill('KEEP');
  await expect(page.locator('.ws-docfind-count')).toHaveText(/1\s*\/\s*3/);
  const cnt = await frame.locator('body').evaluate(() => [...(CSS.highlights.get('ws-find') || [])].length);
  expect(cnt).toBe(3); // 新文档 iframe 的 registry 真有 3 个高亮（重指向成功、不飘旧文档）
});
