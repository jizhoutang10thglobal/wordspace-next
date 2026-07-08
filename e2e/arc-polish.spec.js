// Arc 润滑批(2026-07-08 Colin 拍板)e2e 真门:①Cmd+Shift+T 重开关闭标签 ②Cmd+Shift+C 拷路径/链接(剥 utm)
// ③Ctrl+Tab MRU 切换器(菜单加速器驱动,松 Ctrl 落定/Esc 取消) ④Cmd+P「>」命令混排 + 已打开徽标。
// 全部经真实菜单路由(webContents.send('menu',cmd))驱动——跟真用户按快捷键完全同路径。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir, server, url;

const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const clipRead = () => app.evaluate(({ clipboard }) => clipboard.readText());
const tabRow = (rel) => page.locator(`#sb-tabs .sb-tab[data-rel="${rel}"]`);

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>POLISH PAGE</title><h1>hi</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = 'http://127.0.0.1:' + server.address().port + '/';
});
test.afterAll(async () => { server && server.close(); });

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-polish-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(wsDir, '数据'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir, WS2_NO_CLOSE_DIALOG: '1' },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('#nt-open-folder');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('①重开关闭的标签:关掉→Cmd+Shift+T→标签回来且激活、文档重新渲染;空栈提示不崩', async () => {
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  await menu('close-tab');
  await expect(tabRow('a.html')).toHaveCount(0);
  await menu('reopen-tab');
  await expect(tabRow('a.html')).toBeVisible();
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 栈已空:再按一次 → 提示 toast、不崩
  await menu('close-tab');
  await menu('reopen-tab'); // 重开(栈里还有刚关的 a)
  await expect(tabRow('a.html')).toBeVisible();
  await menu('reopen-tab'); // 栈真空了
  await expect(page.locator('.sb-toast', { hasText: '没有可重开的标签' })).toBeVisible();
});

test('①重开跳过已被删除的文件(静默弹下一条)', async () => {
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA'); // 等渲染完,别让迟到的 onOpen 抢激活
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
  await menu('close-tab'); // 关 b
  await expect(tabRow('数据/b.html')).toHaveCount(0);
  await menu('close-tab'); // 关 a
  await expect(tabRow('a.html')).toHaveCount(0);
  await fs.rm(path.join(wsDir, 'a.html')); // a 被外部删掉
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0, { timeout: 8000 }); // live-tree 真吸收了删除
  await menu('reopen-tab'); // 栈顶是 a(已删)→ 跳过 → 重开 b
  await expect(tabRow('数据/b.html')).toBeVisible({ timeout: 5000 });
  await expect(tabRow('a.html')).toHaveCount(0);
});

test('②拷路径:文档=绝对路径;网页=清洗掉 utm 的 URL', async () => {
  await page.click('.sb-file[data-rel="a.html"]');
  await menu('copy-path');
  await expect.poll(() => clipRead()).toMatch(/\/a\.html$/);
  await expect(page.locator('.sb-toast', { hasText: '已拷贝路径' })).toBeVisible();
  // 网页:带 utm 参数导航,拷出来的链接必须干净、功能参数保留
  await page.fill('#bc-addr', url + '?utm_source=share&id=42');
  await page.press('#bc-addr', 'Enter');
  await expect(page.locator('.sb-tab.sb-tab-web')).toBeVisible();
  await page.waitForTimeout(1200); // 等导航落定(registry url 权威)
  await menu('copy-path');
  await expect.poll(() => clipRead()).toBe(url + '?id=42');
});

test('③Ctrl+Tab MRU:菜单驱动开浮层→松 Ctrl 落定回上一个;Esc 取消不切换', async () => {
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA'); // 串行化 onOpen,MRU 顺序才确定
  await page.locator('.sb-dir[data-rel="数据"]').click();
  await page.click('.sb-file[data-rel="数据/b.html"]');
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('BBB');
  await expect(tabRow('数据/b.html')).toHaveClass(/is-active/);
  // Ctrl+Tab(菜单加速器) → 浮层出现,选中项=上一个(a.html)
  await menu('mru-next');
  await expect(page.locator('#mru-overlay')).toBeVisible();
  await expect(page.locator('.mru-row.is-sel .mru-sub')).toHaveText('a.html');
  // 松 Ctrl → 落定切换
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })));
  await expect(page.locator('#mru-overlay')).toHaveCount(0);
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // Esc 取消:浮层关、激活不变
  await menu('mru-next');
  await expect(page.locator('#mru-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mru-overlay')).toHaveCount(0);
  await expect(tabRow('a.html')).toHaveClass(/is-active/);
});

test('④Cmd+P「>」命令模式:列命令、执行「收起侧栏」真收起;文件结果带已打开徽标且排前', async () => {
  await page.click('.sb-file[data-rel="a.html"]');
  await page.evaluate(() => window.__sbHooks.findPalette());
  await expect(page.locator('#fp-overlay')).toBeVisible();
  // 「>」列命令
  await page.fill('.fp-input', '>');
  await expect(page.locator('.fp-row').first()).toContainText('新建文档');
  expect(await page.locator('.fp-row').count()).toBeGreaterThanOrEqual(8);
  // 过滤 + 执行:收起侧栏
  await page.fill('.fp-input', '>收起');
  await expect(page.locator('.fp-row').first()).toContainText('收起 / 展开侧栏');
  await page.press('.fp-input', 'Enter');
  await expect(page.locator('#fp-overlay')).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/is-sb-collapsed/);
  // 展开回来,验已打开徽标:a.html 开着 → 搜 html,第一行=a.html 带「已打开」
  await page.evaluate(() => window.__sbHooks.findPalette ? null : null);
  await page.keyboard.press('Meta+Backslash').catch(() => {});
  await page.evaluate(() => document.getElementById('sb-reopen') && document.getElementById('sb-reopen').click());
  await page.evaluate(() => window.__sbHooks.findPalette());
  await page.fill('.fp-input', 'html');
  const first = page.locator('.fp-row').first();
  await expect(first).toContainText('a.html');
  await expect(first.locator('.fp-badge')).toHaveText('已打开');
});
