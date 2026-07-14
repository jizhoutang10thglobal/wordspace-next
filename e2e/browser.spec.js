// 浏览器 feature e2e 真门（spec docs/browser-feature-spec.md §14 验收清单的核心闭环）。
// 真开 Electron + WebContentsView 加载**本地 http server** 的真网页（不赌外网,CI 可跑）。
// 强断言纪律（S4）三件套：attach（view 真挂在窗口上）+ bounds（真铺满内容区）+ 像素
// （view 自己的 webContents.capturePage 中心点真是页面底色）。⚠ win.capturePage 不合成子 view
// （只截主 webContents,实测恒白）,像素必须对 view 的 webContents 采。
// 主进程状态经 global.__ws2WebTabs seam（app.evaluate 沙箱无 require,main.js 非打包态暴露）。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');

let app, page, tmpDir, server, base;
let lastUA = null; // /ua 路由记下 server 真实收到的 User-Agent 头（反 CAPTCHA 强门：查线上字节，非 API 返回值）
let lastSecChUa = null; // 顺带记 sec-ch-ua（U3 核查用，只打印不断言）

// 本地测试站：A 页红底带标题/链接/长文,B 页绿底,/dl 下发附件（验下载 cancel）。
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/b')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Page B</title></head><body style="background:#1e8a3c;color:#fff"><h1>BBB page</h1></body></html>');
      } else if (req.url.startsWith('/slow')) {
        // 慢首载页（闪回文档 bug 的回归门）：3s 后才给响应头 → 导航提交前有一段长「加载中」窗口
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><head><title>Slow</title></head><body style="background:#1e5a8a;color:#fff"><h1>slow page</h1></body></html>');
        }, 3000);
      } else if (req.url.startsWith('/ua')) {
        // 反 CAPTCHA 强门：记下 server 真实收到的 UA / sec-ch-ua（不是查 session API 返回值）。
        lastUA = req.headers['user-agent'] || '';
        lastSecChUa = req.headers['sec-ch-ua'] || null;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>UA</title></head><body style="background:#888"><pre id="ua">' + lastUA.replace(/[<>&]/g, '_') + '</pre></body></html>');
      } else if (req.url.startsWith('/dl')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="evil.bin"' });
        res.end('xx');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Page A</title></head><body style="background:#c81e1e;color:#fff">'
          + '<h1>AAA page</h1><a id="tob" href="/b">to B</a>'
          + '<p>' + 'findme '.repeat(3) + '</p></body></html>');
      }
    });
    server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); });
  });
}

async function launch(extraEnv = {}) {
  tmpDir = tmpDir || (await fs.mkdtemp(path.join(os.tmpdir(), 'ws2web-')));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_CTXMENU_PROBE: '1', ...extraEnv },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // 真改窗口尺寸（setViewportSize 只骗 CDP viewport,不动 BrowserWindow → bounds 会按假 rect 算）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860));
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

// ⌘T modal 地址栏开网页（用户主路径）：菜单 new-tab → 地址行输入 → Enter。
async function openWebViaModal(input) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  const omni = page.locator('.sb-cm-omni-input');
  await expect(omni).toBeVisible();
  await omni.fill(input);
  await omni.press('Enter');
}

// 主进程侧取 web view 状态（global.__ws2WebTabs seam：与 main 同一 registry 单例）。
// fn(webTabs, arg, electronModule)——evaluate 沙箱无 require,electron 模块经第三参透传。
function mainWebTabs(fn, arg) {
  return app.evaluate((electronMod, { fnSrc, arg }) => {
    const wt = globalThis.__ws2WebTabs;
    // eslint-disable-next-line no-eval
    return eval('(' + fnSrc + ')')(wt, arg, electronMod);
  }, { fnSrc: fn.toString(), arg });
}
const registrySnapshot = () => mainWebTabs((wt) => {
  const out = [];
  for (const [key, r] of wt._registry) out.push({ key, url: r.url, title: r.title });
  return out;
});
const activeWebKey = () => page.evaluate(() => { const e = window.__sbWeb.active(); return e ? e.abs : null; });
// 强断言三件套：attach + bounds + view 自己 framebuffer 的中心像素（BGRA）。
async function viewInfo(key) {
  return app.evaluate(async ({ BrowserWindow }, key) => {
    const wt = globalThis.__ws2WebTabs;
    const win = BrowserWindow.getAllWindows()[0];
    const r = wt._registry.get(key);
    if (!r) return null;
    const attached = win.contentView.children.includes(r.view);
    const bounds = r.view.getBounds();
    const [cw, ch] = win.getContentSize();
    let pixel = null;
    try {
      const img = await r.view.webContents.capturePage();
      const size = img.getSize();
      const bmp = img.getBitmap();
      const i = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
      pixel = { b: bmp[i], g: bmp[i + 1], r: bmp[i + 2] };
    } catch { /* 页面未渲染完,poll 重试 */ }
    return { attached, bounds, content: { w: cw, h: ch }, pixel };
  }, key);
}
const attachedCount = () => app.evaluate(({ BrowserWindow }) => {
  const wt = globalThis.__ws2WebTabs;
  const win = BrowserWindow.getAllWindows()[0];
  let n = 0;
  for (const [, r] of wt._registry) if (win.contentView.children.includes(r.view)) n++;
  return n;
});
const isRed = (p) => !!p && p.r > 150 && p.g < 90 && p.b < 90;

test.beforeAll(async () => { await startServer(); });
test.afterAll(async () => { if (server) server.close(); });
test.afterEach(async ({}, testInfo) => {
  try {
    if (page) { await fs.mkdir(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, ('web_' + testInfo.title).replace(/[^\w一-龥]+/g, '_').slice(0, 40) + '.png') }); }
  } catch { /* ignore */ }
  if (app) await app.close().catch(() => {});
  app = null;
  tmpDir = null; // 每条测试独立 userdata（会话恢复那条自己管理）
});

test('⌘T 地址栏开网页：真加载(像素级红底上屏) + 标签行/omnibox/星标就位 + 无网页头', async () => {
  await launch();
  await openWebViaModal(base + '/');
  // 标签行出现且激活,标题随 page-title-updated 变成真标题
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  // omnibox 值 = 当前 url,星标显形（网页标签才有）
  await expect(page.locator('#omni-input')).toHaveValue(base + '/');
  await expect(page.locator('#omni-star')).toBeVisible();
  // 强断言三件套：view 真挂上窗口 / bounds 真铺满内容区（x=侧栏宽,y=0 无网页头,右下顶到窗口边）/ 真渲染红底
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return v && v.attached && isRed(v.pixel); }, { timeout: 8000 }).toBe(true);
  const v = await viewInfo(key);
  const sbW = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
  expect(v.bounds.x).toBe(Math.round(sbW)); // 紧贴侧栏右缘
  expect(v.bounds.y).toBe(0); // 无网页头 → 无顶部偏移（§3.2）
  expect(v.bounds.width).toBe(v.content.w - Math.round(sbW)); // 铺满剩余宽度
  expect(v.bounds.height).toBe(v.content.h); // 全高
  // 无网页头：内容区里没有任何 Wordspace chrome 罩在网页上（§3.2 决策——连元素都不存在）
  expect(await page.locator('#web-header, .web-chrome, .web-bmbar').count()).toBe(0);
});

test('反 CAPTCHA：webtabs UA 无 Electron/app 标识（主进程 session 门 + 真实请求头强门）', async () => {
  await launch();
  // 主进程门：persist:webtabs session 的 UA 已归一（去 Electron/app 名、留标准 Chrome UA）
  const sessUA = await app.evaluate(({ session }) => session.fromPartition('persist:webtabs').getUserAgent());
  expect(sessUA).not.toMatch(/Electron\//i);
  expect(sessUA).not.toMatch(/wordspace/i);
  expect(sessUA).toMatch(/Chrome\//);
  // 强门（S4 口径：查线上真实发出的请求头，不是查 API 返回值）：开网页标签访问 /ua，server 记下真实 UA
  lastUA = null;
  await openWebViaModal(base + '/ua');
  await expect.poll(() => lastUA, { timeout: 8000 }).not.toBe(null);
  expect(lastUA).not.toMatch(/Electron\//i);
  expect(lastUA).not.toMatch(/wordspace/i);
  expect(lastUA).toMatch(/Chrome\//);
  // U3 核查（不断言，仅记录到测试输出供 PR）：sec-ch-ua 是否也暴露 Electron 品牌
  console.log('[UA e2e] real request User-Agent =', lastUA);
  console.log('[UA e2e] real request sec-ch-ua =', lastSecChUa);
});

test('闪回文档回归门：新标签慢首载期间起始页 surface 撑住,导航提交后才切网页(Colin 实测 bug)', async () => {
  await launch();
  // ⌘T → 慢页：fresh view 首绘前透明,过早藏起始页会把底下的文档透出来
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  const omni = page.locator('.sb-cm-omni-input');
  await expect(omni).toBeVisible();
  await omni.fill(base + '/slow');
  await omni.press('Enter');
  // 加载窗口内（响应头 3s 后才来）：①起始页 DOM 可见 ②**没有任何 web view attach**——
  // 真断言（S4：只测 DOM visible 是代理断言,测不出白底原生 view 提前挂上盖住起始页 = 白屏）。
  await page.waitForTimeout(1200);
  await expect(page.locator('#web-newtab')).toBeVisible();
  expect(await attachedCount()).toBe(0); // ← 提交前 view 绝不能挂上（闪回半修的真门）
  // 导航提交后：起始页藏、view attach、慢页真渲染（蓝底）
  await expect(page.locator('#web-newtab')).toBeHidden({ timeout: 10000 });
  const key = await activeWebKey();
  await expect.poll(async () => {
    const v = await viewInfo(key);
    return !!(v && v.attached && v.pixel && v.pixel.b > 100 && v.pixel.r < 90);
  }, { timeout: 8000 }).toBe(true);
  // 主进程 view 有白底（首绘前不透明,防透出文档——setBackgroundColor 的变异防护）
  const bg = await mainWebTabs((wt, { key }) => {
    const v = wt._registry.get(key).view;
    try { return v.getBackgroundColor ? v.getBackgroundColor() : 'no-api'; } catch { return 'err'; }
  }, { key });
  expect(bg === 'no-api' || String(bg).toLowerCase().includes('ffffff') || String(bg).toLowerCase() === '#fff').toBeTruthy();
});

test('历史自动记录(60s 合并/back 不记) + 导航条 disabled 实时 + 历史页分组/删除', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#omni-input')).toHaveValue(base + '/');
  // 历史记了 A（主进程 did-navigate 驱动,renderer 无写入口）
  await expect.poll(() => page.evaluate(() => window.ws2.histState().then((h) => h.length))).toBe(1);
  // omnibox 原地导航去 B（网页标签 → 原地导航,§4.2）
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/b');
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#omni-input')).toHaveValue(base + '/b', { timeout: 8000 });
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1); // 原地导航,不开新标签
  await expect.poll(() => page.evaluate(() => window.ws2.histState().then((h) => h.length))).toBe(2);
  // 后退:导航条按钮从 disabled → enabled,点了回 A,历史**不再涨**（§4.8 back 不记）
  await expect(page.locator('#nav-back')).toBeEnabled();
  await page.locator('#nav-back').click();
  await expect(page.locator('#omni-input')).toHaveValue(base + '/', { timeout: 8000 });
  await expect(page.locator('#nav-fwd')).toBeEnabled();
  const after = await page.evaluate(() => window.ws2.histState().then((h) => h.map((e) => e.url)));
  expect(after.length).toBe(2);
  // 历史页：分组「今天」+ 行可删
  await page.locator('#nav-history').click();
  await expect(page.locator('#web-page .wp-title')).toHaveText('历史记录');
  await expect(page.locator('#web-page .wp-day').first()).toHaveText('今天');
  const rows = page.locator('#web-page .wp-row');
  await expect(rows).toHaveCount(2);
  await rows.first().hover();
  await rows.first().locator('.wp-row-x').click();
  await expect(page.locator('#web-page .wp-row')).toHaveCount(1);
});

test('⌘D 收藏落书签栏 + 收藏区默认收起点开 + 点收藏聚焦已开标签(拍板#3) + 取消收藏跨文件夹删', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#omni-star')).toBeVisible();
  await page.locator('#omni-star').click(); // ☆ 收藏
  await expect(page.locator('#omni-star')).toHaveClass(/is-on/);
  const bm = await page.evaluate(() => window.ws2.bmState());
  expect(bm.bookmarks.length).toBe(1);
  expect(bm.bookmarks[0].folderId).toBe('bm-bar'); // 默认落书签栏
  // 收藏区：默认收起（只有标题行）,点标题行展开出书签
  await expect(page.locator('#sb-fav')).toBeVisible();
  await expect(page.locator('#sb-fav-list')).toBeHidden();
  await page.locator('#sb-fav-head').click();
  await expect(page.locator('#sb-fav-list .sb-fav-row')).toHaveCount(1);
  // 点收藏 = 已开该网址 → 聚焦,不堆新标签（拍板#3）
  await page.locator('#sb-fav-list .sb-fav-row').click();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  // 再点星标 = 取消收藏（跨全部文件夹删该 url）
  await page.locator('#omni-star').click();
  await expect.poll(() => page.evaluate(() => window.ws2.bmState().then((s) => s.bookmarks.length))).toBe(0);
});

test('会话恢复：重启后 web 标签(url/title/pinned)回来,激活标签懒加载真渲染', async () => {
  const keep = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2webkeep-'));
  tmpDir = keep;
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  await page.waitForTimeout(600); // persistTabs 落盘
  await app.close();
  tmpDir = keep; // 同一 userdata 再启动
  await launch();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  // 激活标签懒加载：恢复后 view 重建、attach 并真渲染（红底像素）
  await expect.poll(async () => {
    const key = await activeWebKey();
    if (!key) return false;
    const v = await viewInfo(key);
    return !!(v && v.attached && isRed(v.pixel));
  }, { timeout: 10000 }).toBe(true);
  tmpDir = null;
});

test('右键菜单(原生 probe)：六分节按上下文/危险 scheme 整节滤/拷贝链接洗跟踪参数/动作白名单收口', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  const key = await page.evaluate(() => window.__sbWeb.active().abs);
  // probe 捕获 template（不真弹原生菜单）
  const tpl = await mainWebTabs((wt, { key, params }) => {
    wt.openCtxMenu(key, params);
    return global.__ws2LastCtxMenu.template.filter((i) => i.type !== 'separator').map((i) => i.id);
  }, { key, params: { linkURL: base + '/b?utm_source=x&id=1', selectionText: 'hello world' } });
  expect(tpl).toEqual(['open-link', 'open-link-bg', 'copy-link', 'copy-selection', 'search-selection', 'nav-back', 'nav-forward', 'reload', 'copy-page-url', 'export-pdf']);
  // 危险 scheme：链接节整节不出
  const bad = await mainWebTabs((wt, { key }) => {
    wt.openCtxMenu(key, { linkURL: 'javascript:alert(1)' });
    return global.__ws2LastCtxMenu.template.filter((i) => i.type !== 'separator').map((i) => i.id);
  }, { key });
  expect(bad).toEqual(['nav-back', 'nav-forward', 'reload', 'copy-page-url', 'export-pdf']);
  // 拷贝链接：跟踪参数被洗,功能参数保留（executeCtxAction 唯一出口）
  const copied = await mainWebTabs((wt, { key, url }, { clipboard }) => {
    wt.executeCtxAction(key, 'copy-link', { url });
    return clipboard.readText();
  }, { key, url: base + '/b?utm_source=x&id=1' });
  expect(copied).toBe(base + '/b?id=1');
  // 未知动作 id：白名单收口,静默 no-op 不抛
  const noThrow = await mainWebTabs((wt, { key }) => {
    try { wt.executeCtxAction(key, 'evil-action', { url: 'file:///etc/passwd' }); return true; } catch { return false; }
  }, { key });
  expect(noThrow).toBe(true);
});

test('安全不变式：loadURL 白名单拒 file:导航守卫兜底 + 下载一律 cancel + toast', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  const key = await page.evaluate(() => window.__sbWeb.active().abs);
  // loadUrlDirect 白名单：file:// 拒（renderer 便利 ≠ 加载授权,§11.3）
  const blocked = await page.evaluate((k) => window.ws2.webLoadUrl(k, 'file:///etc/passwd'), key);
  expect(blocked && blocked.blocked).toBe(true);
  // 页面内自导航到 file:// 被 will-navigate 拦（不换页）
  await mainWebTabs((wt, { key }) => {
    const r = wt._registry.get(key);
    return r.view.webContents.executeJavaScript('location.href="file:///etc/passwd"; true', true).catch(() => null);
  }, { key });
  await page.waitForTimeout(600);
  const snap = await registrySnapshot();
  expect(snap.find((s) => s.key === key).url.startsWith(base)).toBe(true);
  // 下载：will-download 一律 cancel + toast（§12 砍除）
  await mainWebTabs((wt, { key, url }) => { wt._registry.get(key).view.webContents.downloadURL(url); }, { key, url: base + '/dl' });
  await expect(page.locator('#sb-toast-host')).toContainText('不支持下载', { timeout: 6000 });
});

test('页内查找 ⌘F：胶囊条 + N/M 计数 + Esc 清除；缩放 ⌘±0 每标签 0.5–2', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  const key = await page.evaluate(() => window.__sbWeb.active().abs);
  // ⌘F 走真实菜单路由（find-in-doc → __webMenu 拦截 → 网页查找条,§4.6/§7）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'find-in-doc'));
  await expect(page.locator('#web-findbar')).toBeVisible();
  await page.locator('#web-find-input').fill('findme');
  await expect(page.locator('#web-find-count')).toHaveText(/3/, { timeout: 6000 }); // 3 个 findme
  await page.locator('#web-find-input').press('Enter'); // 下一个
  await expect(page.locator('#web-find-count')).toHaveText(/2\/3/, { timeout: 6000 });
  await page.locator('#web-find-input').press('Escape');
  await expect(page.locator('#web-findbar')).toBeHidden();
  // 缩放：renderer ⌘+ → 主进程 setZoomFactor(每标签)
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => mainWebTabs((wt, { key }) => wt._registry.get(key).view.webContents.getZoomFactor(), { key })).toBeCloseTo(1.1, 5);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true, cancelable: true })));
  await expect.poll(() => mainWebTabs((wt, { key }) => wt._registry.get(key).view.webContents.getZoomFactor(), { key })).toBeCloseTo(1, 5);
});

test('标签系统：⌘W 关网页标签→view 销毁;⌘⇧T 重开(url/title 恢复);Ctrl+Tab 顺序循环;起始页空态引导', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  await openWebViaModal(base + '/b');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(2);
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name').nth(1)).toHaveText('Page B', { timeout: 8000 });
  // Ctrl+Tab 顺序循环（synthetic dispatch 走 renderer 全局 handler）
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })));
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web').nth(0)).toHaveClass(/is-active/);
  // ⌘W 关掉激活的 A → registry 里它的 view 销毁,B 恢复激活（相邻回落）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'close-tab'));
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect.poll(() => registrySnapshot().then((s) => s.length)).toBe(1);
  // ⌘⇧T 重开：url/title 恢复并激活
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'reopen-tab'));
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(2);
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name').nth(1)).toHaveText('Page A', { timeout: 8000 });
  await expect(page.locator('#omni-input')).toHaveValue(base + '/', { timeout: 8000 });
});

test('收藏管理页：Netscape 导入(seam)重名文件夹加后缀不合并(拍板#6)+toast 报净新增;导出往返', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#omni-star')).toBeVisible();
  await page.locator('#omni-star').click(); // 先有一条书签栏收藏 + 一个「工作」文件夹
  await page.evaluate(() => window.ws2.bmAddFolder('工作'));
  // 准备导入文件：含重名「工作」文件夹 + 书签栏一条重复、一条新增
  const importFile = path.join(os.tmpdir(), 'ws2-bm-import-' + Date.now() + '.html');
  await fs.writeFile(importFile, [
    '<DL><p>',
    '  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bar</H3>',
    '  <DL><p>',
    '    <DT><A HREF="' + base + '/" ADD_DATE="1700000000">dupe</A>',
    '    <DT><A HREF="https://fresh.example/" ADD_DATE="1700000000">Fresh</A>',
    '  </DL><p>',
    '  <DT><H3>工作</H3>',
    '  <DL><p><DT><A HREF="https://work.example/" ADD_DATE="1700000000">周报</A></DL><p>',
    '</DL><p>',
  ].join('\n'), 'utf8');
  await app.evaluate(({ app: a }, f) => { process.env.WS2_BM_IN = f; }, importFile);
  await page.locator('#sb-fav-head').hover();
  await page.locator('#sb-fav-manage').click();
  await expect(page.locator('#web-page .wp-title')).toHaveText('收藏夹');
  await page.locator('.wp-btn', { hasText: '导入' }).click();
  await expect(page.locator('#sb-toast-host')).toContainText('已导入 2 个书签'); // 3 parsed - 1 dupe = 2 净新增
  const st = await page.evaluate(() => window.ws2.bmState());
  expect(st.folders.some((f) => f.name === '工作 2')).toBe(true); // 重名不合并,加后缀
  expect(st.bookmarks.some((b) => b.url === 'https://fresh.example/' && b.folderId === 'bm-bar')).toBe(true); // 对方书签栏并入
  // 导出（seam）→ 文件落盘且可被解析回等量书签
  const exportFile = path.join(os.tmpdir(), 'ws2-bm-export-' + Date.now() + '.html');
  await app.evaluate(({ app: a }, f) => { process.env.WS2_BM_OUT = f; }, exportFile);
  await page.locator('.wp-btn', { hasText: '导出' }).click();
  await expect(page.locator('#sb-toast-host')).toContainText('已导出');
  const out = await fs.readFile(exportFile, 'utf8');
  expect(out.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
  expect(out).toContain('PERSONAL_TOOLBAR_FOLDER="true"');
  expect(out).toContain('https://work.example/');
});

test('设置页：默认引擎 Bing(拍板#1)/无主页设置(拍板#2);地址栏打词走引擎搜索;起始页瓦片=书签栏(拍板#5)', async () => {
  await launch();
  // 设置页（⌘, 菜单路由）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-settings'));
  await expect(page.locator('#web-page .wp-title')).toHaveText('设置');
  await expect(page.locator('.wp-set-ctl select')).toHaveValue('bing'); // 默认 Bing
  expect(await page.locator('#web-page').textContent()).not.toContain('主页'); // 主页设置已删,别加回来
  // 地址栏打词（含空格→搜索）：主进程 parse 出 Bing 结果页 url（不真加载外网,断言 registry.url）
  await openWebViaModal(base + '/'); // 先有个 web 标签
  await expect(page.locator('#omni-input')).toHaveValue(base + '/');
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill('hello world');
  await page.locator('#omni-input').press('Enter');
  await expect.poll(() => registrySnapshot().then((s) => s.map((x) => x.url).join(' '))).toContain('bing.com/search?q=hello%20world');
  // 起始页：无收藏时空态引导（拍板#5 的空态分支）
  await page.evaluate(() => { window.__sbWeb.openWeb(null, null, false); });
  await expect(page.locator('#web-newtab')).toBeVisible();
  await expect(page.locator('.web-nt-tiles-empty')).toContainText('还没有收藏');
  await expect(page.locator('.web-nt-note')).toContainText('内置浏览器没有恶意网站防护'); // 产品口径文案保留（§11.6）
});

test('web↔doc 共存：切到文档标签摘 view(编辑器可见),切回网页 view 复原;omnibox 非网页回车开新网页标签', async () => {
  await launch();
  // 建工作区 + 文档（复用 WS2_FOLDER_IN seam）
  const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2webws-'));
  await fs.writeFile(path.join(wsDir, 'a.html'), '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>a</title></head><body><h1>AAA</h1><p>x</p></body></html>', 'utf8');
  await app.evaluate(({ app: a }, dir) => { process.env.WS2_FOLDER_IN = dir; }, wsDir);
  await page.locator('#home-open-folder').click();
  await page.locator('.sb-file[data-rel="a.html"]').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // omnibox 在文档标签上回车 → 先开**新**网页标签（文档不被顶掉,§4.2）
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/');
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(2); // 文档标签还在
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true); // 网页盖上来了
  // 切回文档标签 → view 全部摘掉,编辑器可见可用
  await page.locator('#sb-tabs .sb-tab:not(.sb-tab-web)').click();
  await expect.poll(() => attachedCount(), { timeout: 8000 }).toBe(0);
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 切回网页标签 → view 复原（attach + 红底回来）
  await page.locator('#sb-tabs .sb-tab.sb-tab-web').click();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
});
