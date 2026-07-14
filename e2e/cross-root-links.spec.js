// A 跨根互链消费面 e2e 真门：跨根链接点得开、看得见（反链带空间名+跳转）、断了红虚线、删除守卫跨根。
//
// 两根并列在同一父目录下（tmp/工作笔记、tmp/项目资料）→ '../项目资料/x.html' 词法解析得到跨根目标。
// 强断言：跳转断言 docPath 真切根 + h1；断链读真实 CSS.highlights('ws-broken') size（非查 class）；
// 删除守卫断言 modal 列出跨根来源。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DOC = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body || ''}</body></html>`;

let app, page, tmp, wsA, wsB, userData;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
  return { a, p };
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);
const docPath = () => page.evaluate(() => (window.__shellDocPath ? window.__shellDocPath() : null));
const brokenSize = () => page.evaluate(() => {
  const w = document.getElementById('doc-frame').contentWindow;
  const hl = w.CSS && w.CSS.highlights && w.CSS.highlights.get('ws-broken');
  return hl ? hl.size : 0;
});

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-xroot-links-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '工作笔记');
  wsB = path.join(tmp, '项目资料');
  await fs.mkdir(wsA, { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
  // A/周报 跨根链到 B/报价单（有效）+ B/不存在（断链）
  await fs.writeFile(path.join(wsA, '周报.html'),
    DOC('周报', '<p>本周见 <a href="../项目资料/报价单.html">报价单</a>，另附 <a href="../项目资料/不存在.html">缺失件</a>。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, '报价单.html'), DOC('报价单', '<p>金额若干。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, 'b.html'), DOC('B文档'), 'utf8');
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function openTwoRoots() {
  await launch({ WS2_FOLDER_IN: wsA });
  await page.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  await setFolderSeam(wsB);
  await page.click('#sb-add-root');
  await expect(rootHeads()).toHaveCount(2);
  return page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
}

test('A-1 跨根反链：打开 B/报价单 → 反链看到 A/周报（标空间名）+ 点它跳去 A', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(rb, '报价单.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('报价单');
  // 反链面板：1 篇（来自另一个空间的 周报）
  await expect(page.locator('#ws-bl-count')).toHaveText('1 篇文档链接到这里', { timeout: 8000 });
  await page.click('#ws-bl-head'); // 展开
  const item = page.locator('.ws-bl-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.ws-bl-item-title')).toContainText('周报');
  await expect(item.locator('.ws-bl-item-root')).toHaveText('工作笔记'); // 跨根来源标空间名
  // 点来源 → 应用内打开 A/周报（真切根）
  await item.click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('周报');
  expect((await docPath()).endsWith(path.join('工作笔记', '周报.html'))).toBe(true);
});

test('A-2 跨根链接：打开 A/周报 → 有效跨根链接不红、缺失的红；点有效链接跳去 B', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(ra, '周报.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('周报');
  // 两条跨根链接：报价单.html 有效（不红）、不存在.html 断链（红）→ 只有 1 条 ws-broken
  await expect.poll(brokenSize, { timeout: 5000 }).toBe(1);
  // 点有效的那条 → 应用内打开 B/报价单（跨根点击走 resolveDocLink 的多根归属，真切根）
  await page.frameLocator('#doc-frame').locator('a[href="../项目资料/报价单.html"]').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('报价单');
  expect((await docPath()).endsWith(path.join('项目资料', '报价单.html'))).toBe(true);
});

test('A-3 跨根删除守卫：删 B/报价单（被 A/周报 引用）→ 守卫列出跨根来源', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(rb, '报价单.html').click({ button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: /^删除$/ }).click();
  // 删除守卫弹窗（fan-out 后看得见跨根来源 A/周报）
  const guard = page.locator('.ws-delguard').filter({ hasText: '仍要删除' });
  await expect(guard).toBeVisible();
  await expect(guard.locator('.ws-delguard-item-title')).toContainText('周报');
  await guard.locator('.ws-delguard-btn', { hasText: '取消' }).click();
  // 取消 → 文件还在
  await expect(fileRow(rb, '报价单.html')).toBeVisible();
});
