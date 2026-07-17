// 默认屏导览页(方案 3 时间流,ui-demo #259 移植)e2e 真门:空态=导览页(问候/omnibox/时间流/
// 书签+最常访问/开始动作),#home 与 #home-open/#home-open-folder 的 id 契约不破(30+ 既有位点的锚)。
// 变异口径:index.html 撤 start-page.js 或 #home 回旧结构 → 首条即翻红。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-startpage-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(wsDir, '提案'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '提案', 'b.html'), HTML('BBB'), 'utf8');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('冷启动空态 = 导览页:问候刊头 34px 真渲染 + omnibox + 锚 id 契约(#home/#home-open/#home-open-folder)', async () => {
  await expect(page.locator('#home')).toBeVisible();
  const greet = await page.locator('#sp-greet').evaluate((el) => ({ txt: el.textContent, size: parseFloat(getComputedStyle(el).fontSize) }));
  expect(greet.txt.length).toBeGreaterThan(0);
  expect(greet.size).toBeGreaterThanOrEqual(30);
  await expect(page.locator('#sp-omni-input')).toBeVisible();
  await expect(page.locator('#home-open')).toBeVisible();
  await expect(page.locator('#home-open-folder')).toBeVisible(); // 全仓 openWorkspace 惯例的锚
});

test('时间流:开文档→关标签回空态 → 「今天」组渲染,行=名字+文件夹chip+时间,版面无裸绝对路径;点行重开', async () => {
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  await page.locator('.sb-dir[data-rel="提案"]').click();
  await page.click('.sb-file[data-rel="提案/b.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
  // 关掉标签回空态(menu close-tab 走关标签惯例)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(page.locator('#home')).toBeVisible();
  // 「今天」组 + b 行(recents 记的是刚打开的)
  await expect(page.locator('.sp-grp-cap').first()).toHaveText('今天');
  const row = page.locator('.sp-row', { hasText: 'b' }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.sp-chip')).toHaveText('提案'); // 文件夹名=路径倒数第二段
  // 版面无裸绝对路径(完整路径只进 title 悬停)
  const flowText = await page.locator('#sp-flow').innerText();
  expect(flowText).not.toContain(wsDir);
  expect(flowText).not.toContain('/private/');
  // 点行重开文档
  await row.click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
});

test('统一 omnibox:打字过滤最近文件+回车开文档;输入域名回车 → 开网页标签(主进程 registry 实证)', async () => {
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(page.locator('#home')).toBeVisible();
  // 打字过滤 → 候选 → Enter 开文档
  await page.fill('#sp-omni-input', 'a');
  await expect(page.locator('.sp-sug-item').first()).toBeVisible();
  await page.press('#sp-omni-input', 'Enter');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 回空态,输入域名 → 开网页标签(不真联网,只验 registry 建了 view/标签行出现)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(page.locator('#home')).toBeVisible();
  await page.fill('#sp-omni-input', 'example.com');
  await page.press('#sp-omni-input', 'Enter');
  await expect(page.locator('#sb-tabs .sb-tab-web')).toHaveCount(1, { timeout: 8000 });
});

test('开始动作:#home-new → 新建标签页 modal(⌘T 同门)', async () => {
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  await page.click('#home-new');
  await expect(page.locator('.sb-modal-overlay')).toBeVisible();
  await expect(page.locator('.sb-modal-grid')).toBeVisible(); // 模板台在(新建文档语义)
});
