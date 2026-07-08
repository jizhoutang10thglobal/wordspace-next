// 网页右键菜单 e2e 真门（U-hardening / U3）。
// 原生 Menu 无法被 Playwright 驱动,所以门分两半:
//  ① template 正确性 + wc.on('context-menu') 挂钩:真右键(sendInputEvent)→ WS2_CTXMENU_PROBE 存下捕获,断言 template。
//  ② 动作正确性:直接调 global.__ws2CtxAction(key,id,args)——与菜单 click 完全同一路径(收口)。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// 交互页:绝对定位把可点元素摆在确定坐标,真右键才打得准。
const INTERACTIVE = (port) => `<!doctype html><html><head><meta charset="utf-8"><title>CTX PAGE</title>
<style>body{margin:0}a,img,p{position:absolute;left:0;display:block}</style></head><body>
<a id="safe" href="http://127.0.0.1:${port}/other" style="top:0;width:320px;height:60px;background:#eee">safe link</a>
<a id="js" href="javascript:void(0)" style="top:100px;width:320px;height:60px;background:#ddd">js link</a>
<img id="pic" src="/pic.png" style="top:200px;width:120px;height:80px;background:#ccc">
<p style="top:320px">selectable words here</p>
</body></html>`;
const ARTICLE = '<!doctype html><html><head><title>ARTICLE</title></head><body><article>' +
  '<h1>the article</h1>' +
  '<p>' + 'This is the first substantial paragraph of the article body with enough prose. '.repeat(4) + '</p>' +
  '<p>' + 'A second paragraph so Readability keeps the extraction above threshold here. '.repeat(4) + '</p>' +
  '<img src="/pic.png" alt="pic">' +
  '</article></body></html>';

let app, page, tmp, wsDir, dlDir, server, url, port;

const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const lastCtxMenu = () => app.evaluate(() => (global.__ws2LastCtxMenu || null));
const clipRead = () => app.evaluate(({ clipboard }) => clipboard.readText());
const activeKey = () => page.evaluate(() => window.__webActiveKey && window.__webActiveKey());
const webTabCount = () => page.locator('.sb-tab.sb-tab-web').count();
// 直接调动作出口（与菜单项 click 同路径）
const doAction = (key, id, args) => app.evaluate(({ /* electron */ }, a) => global.__ws2CtxAction(a.key, a.id, a.args), { key, id, args });
const viewTitle = () => app.evaluate(({ BrowserWindow }) => {
  const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
  return v ? v.webContents.executeJavaScript('document.title') : null;
});
// 真右键打进 web view（先强制窗口/view 聚焦,sendInputEvent 要求窗口聚焦——Electron 文档明说）。
const rightClickView = (x, y) => app.evaluate(({ BrowserWindow }, pt) => {
  const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus();
  const v = win.contentView.children.find((c) => c.webContents); if (!v) return;
  const wc = v.webContents; wc.focus();
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', x: pt.x, y: pt.y, clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', x: pt.x, y: pt.y, clickCount: 1 });
}, { x, y });

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/pic.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); return; }
    if (req.url && req.url.indexOf('/article') === 0) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(ARTICLE); return; }
    if (req.url && req.url.indexOf('/other') === 0) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>OTHER</title><h1>other</h1>'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(INTERACTIVE(port));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  url = 'http://127.0.0.1:' + port + '/';
});
test.afterAll(async () => { server && server.close(); });

test.beforeEach(async () => {
  test.setTimeout(120000);
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-ctx-'));
  wsDir = path.join(tmp, 'workspace'); dlDir = path.join(tmp, 'dl');
  await fs.mkdir(wsDir, { recursive: true }); await fs.mkdir(dlDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmp, 'ud'), WS2_FOLDER_IN: wsDir, WS2_NO_CLOSE_DIALOG: '1', WS2_CTXMENU_PROBE: '1', WS2_DL_DIR: dlDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('#nt-open-folder');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  // 建一个网页标签并导航到交互页,等它真加载完(右键坐标才打得准)
  await page.fill('#bc-addr', url);
  await page.press('#bc-addr', 'Enter');
  await expect(page.locator('.sb-tab.sb-tab-web')).toBeVisible();
  await expect.poll(viewTitle, { timeout: 15000 }).toBe('CTX PAGE');
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('真右键链接 → 探针捕获 template 含开链接项,且右键前无捕获(非恒真)', async () => {
  expect(await lastCtxMenu()).toBe(null); // 右键前:未捕获
  const ids = await expect.poll(async () => {
    await rightClickView(160, 30); // safe link 中心
    const m = await lastCtxMenu();
    return m && m.template ? m.template.filter((i) => i.id).map((i) => i.id) : [];
  }, { timeout: 15000, intervals: [400, 400, 600, 800] }).toContain('open-link');
  const m = await lastCtxMenu();
  expect(m.params.linkURL).toBe(url + 'other'); // 命中的确实是那条链接
  expect(m.template.map((i) => i.id)).toContain('copy-link');
});

test('真右键空白处 → template 无开链接项(与链接处不同,变异自检)', async () => {
  await expect.poll(async () => {
    await rightClickView(600, 500); // 页面空白区(元素都在左上角)
    const m = await lastCtxMenu();
    return m && m.template ? m.template.filter((i) => i.id).map((i) => i.id) : null;
  }, { timeout: 15000, intervals: [400, 400, 600] }).toContain('nav-back'); // 捕获到了(导航节恒在)
  const m = await lastCtxMenu();
  expect(m.template.map((i) => i.id)).not.toContain('open-link'); // 空白处无链接项
  expect(m.params.linkURL == null || m.params.linkURL === '').toBeTruthy();
});

test('安全:真右键 javascript: 链接 → 命中链接元素但非 http 目标、template 无 open-link/copy-link', async () => {
  // Chromium 把 <a href="javascript:…"> 的 context-menu linkURL 报成 about:blank#blocked(不暴露原始 javascript:)——
  // 连它的 blocked 形式也不是 http(s),必须被链接节整节拦掉。truthy linkURL = 确实命中了链接元素(空白处为空)。
  await expect.poll(async () => {
    await rightClickView(160, 130); // js link 中心(y 100-160,与 safe link 不重叠)
    const m = await lastCtxMenu();
    return !!(m && m.params && m.params.linkURL);
  }, { timeout: 15000, intervals: [400, 400, 600] }).toBe(true);
  const m = await lastCtxMenu();
  expect(m.params.linkURL).not.toMatch(/^https?:/i);
  const gotIds = m.template.map((i) => i.id);
  expect(gotIds).not.toContain('open-link');
  expect(gotIds).not.toContain('copy-link');
});

test('动作 open-link / open-link-bg → 新网页标签(前台激活 / 后台不激活)', async () => {
  const key = await activeKey();
  const before = await webTabCount();
  await doAction(key, 'open-link', { url: url + 'other' });
  await expect.poll(webTabCount).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => window.__webActiveUrl && window.__webActiveUrl())).toContain('/other');
  // 后台开:再多一个,但激活仍是刚才前台那个
  const fgUrl = await page.evaluate(() => window.__webActiveUrl && window.__webActiveUrl());
  await doAction(key, 'open-link-bg', { url: url + 'article' });
  await expect.poll(webTabCount).toBe(before + 2);
  expect(await page.evaluate(() => window.__webActiveUrl && window.__webActiveUrl())).toBe(fgUrl); // 后台不夺激活
});

test('动作 copy-link → 清洗掉 utm 的链接进剪贴板(功能参数保留)', async () => {
  const key = await activeKey();
  await doAction(key, 'copy-link', { url: url + 'other?utm_source=share&id=42' });
  await expect.poll(clipRead).toBe(url + 'other?id=42');
});

test('动作 copy-image-url / save-image → 剪贴板是图片地址;图片落下载目录(清洗文件名)', async () => {
  const key = await activeKey();
  await doAction(key, 'copy-image-url', { url: url + 'pic.png' });
  await expect.poll(clipRead).toBe(url + 'pic.png');
  await doAction(key, 'save-image', { url: url + 'pic.png' });
  await expect.poll(async () => (await fs.readdir(dlDir)).some((f) => /pic.*\.png$/i.test(f)), { timeout: 10000 }).toBeTruthy();
});

test('动作 search-selection → 新 Bing 搜索标签', async () => {
  const key = await activeKey();
  const before = await webTabCount();
  await doAction(key, 'search-selection', { text: 'wordspace demo' });
  await expect.poll(webTabCount).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => window.__webActiveUrl && window.__webActiveUrl())).toContain('bing.com/search');
});

test('动作 clip-page → 工作区新增含正文的 .html(存为文档打通)', async () => {
  // 先把激活网页导到文章页(有可抽正文)
  await page.fill('#bc-addr', url + 'article');
  await page.press('#bc-addr', 'Enter');
  await expect.poll(viewTitle, { timeout: 15000 }).toBe('ARTICLE');
  const key = await activeKey();
  await doAction(key, 'clip-page', {});
  const readClip = async () => {
    const files = (await fs.readdir(wsDir)).filter((f) => f.endsWith('.html') && f !== 'a.html');
    return files.length ? fs.readFile(path.join(wsDir, files[0]), 'utf8') : '';
  };
  await expect.poll(readClip, { timeout: 15000 }).toMatch(/first substantial paragraph/);
});
