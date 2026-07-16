// B 跨根互链创建面 e2e 真门：@菜单能搜到别的文件夹空间的文档（带空间名分节头）+ 拖拽跨空间建链。
// 落盘断言纯净跨根相对 href（../项目资料/x.html，零 class/contenteditable）；拖拽走真实 DnD 管线（dragTo，L10）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DOC = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body || ''}</body></html>`;

let app, page, tmp, wsA, wsB, userData;

async function launch(env) {
  const a = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env } });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a; page = p;
}
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing)');
const fileRow = (rootId, rel) => page.locator(`.sb-file[data-root="${rootId}"][data-rel="${rel}"]`);

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-xroot-create-'));
  userData = path.join(tmp, 'userdata');
  wsA = path.join(tmp, '工作笔记');
  wsB = path.join(tmp, '项目资料');
  await fs.mkdir(wsA, { recursive: true });
  await fs.mkdir(wsB, { recursive: true });
  await fs.writeFile(path.join(wsA, '周报.html'), DOC('周报', '<p>本周进展。</p>'), 'utf8');
  await fs.writeFile(path.join(wsB, '报价单.html'), DOC('报价单', '<p>金额若干。</p>'), 'utf8');
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

test('B-1 @菜单跨根候选：在 A/周报 搜到 B/报价单（带空间名分节头）→ 插入纯净跨根 href', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(ra, '周报.html').click();
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('周报');
  await frame.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('@');
  await expect(page.locator('.ws-mention-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.type('报价'); // 当前空间无匹配 → 只有跨空间的 报价单
  // 分节头显示来源空间名「项目资料」，候选是 报价单
  await expect(page.locator('.ws-mention-group', { hasText: '项目资料' })).toBeVisible();
  await expect(page.locator('.ws-mention-item.is-active')).toContainText('报价单');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ws-mention-menu')).toBeHidden();
  // 插入的是跨根相对 href
  await expect(frame.locator('a', { hasText: '报价单' })).toHaveAttribute('href', '../项目资料/报价单.html');
  await page.waitForTimeout(1700); // 自动保存
  const d = await fs.readFile(path.join(wsA, '周报.html'), 'utf8');
  expect(d).toMatch(/<a href="\.\.\/项目资料\/报价单\.html">报价单<\/a>/); // 纯净跨根 href + 标题快照
  expect(d).not.toContain('ws-doclink');
  expect(d).not.toContain('contenteditable');
  // （插入的跨根链接可点开 = 消费面，已由 cross-root-links.spec A-2 覆盖，这里不重复——编辑态点链接是落光标非导航）
});

test('B-2 拖拽跨根建链：把 B/报价单 拖进 A/周报 正文 → 纯净跨根链接（真实拖拽管线）', async () => {
  const [ra, rb] = await openTwoRoots();
  await fileRow(ra, '周报.html').click();
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('周报');
  await fileRow(rb, '报价单.html').dragTo(frame.locator('p').first()); // 跨空间文件行 → 正文（dragTo=真 DnD，L10）
  await expect(frame.locator('a[href="../项目资料/报价单.html"]')).toBeVisible({ timeout: 4000 });
  await page.waitForTimeout(1700);
  const d = await fs.readFile(path.join(wsA, '周报.html'), 'utf8');
  expect(d).toMatch(/<a href="\.\.\/项目资料\/报价单\.html">报价单<\/a>/);
  expect(d).not.toContain('ws-doclink');
  expect(d).not.toContain('contenteditable');
});
