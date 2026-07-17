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
let rlHits = 0; // /rl 路由累计命中数（U5 ⌘R 刷新强门：reload 应让 server 真收到二次请求，查线上命中而非 renderer 状态）

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
      } else if (req.url.startsWith('/rl')) {
        // ⌘R 刷新强门：每次请求 rlHits++，reload 应命中二次。禁缓存，确保 reload 真回源不吃 304/内存缓存。
        rlHits++;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('<!DOCTYPE html><html><head><title>RL</title></head><body style="background:#7a4fb5;color:#fff"><h1>reload hit ' + rlHits + '</h1></body></html>');
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
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_CTXMENU_PROBE: '1', ...extraEnv },
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

test('沉浸收起：收起 → 网页 view 内缩进 10px 窗框；peek=快照垫底不推挤，收回挂回（Wendi 2026-07-17）', async () => {
  await launch();
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  await page.click('#sb-toggle'); // 收起
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  // 沉浸窗框：view 内缩 10px（原「贴 x=0 零缝隙」拍板已被 Wendi 边框反馈取代）
  await expect.poll(async () => (await viewInfo(key)).bounds.x, { timeout: 4000 }).toBe(10);
  const v = await viewInfo(key);
  expect(v.bounds.width).toBe(v.content.w - 20); // 左右各让 10
  // peek：真 hover 左边带（内缩后左 10px 是 DOM 地盘，主进程 watcher 已删）→ 快照垫底 + view 摘掉。
  // hover 可重试轮询：防宿主操作者真实鼠标与 CDP 合成指针混流（见 immersive.spec 注）。
  await expect
    .poll(async () => {
      await page.mouse.move(880, 430);
      await page.waitForTimeout(60);
      await page.mouse.move(5, 430);
      await page.waitForTimeout(300);
      return page.evaluate(() => document.body.classList.contains('is-sb-peek'));
    }, { timeout: 10000 })
    .toBe(true);
  const snap = page.locator('.web-peek-snap');
  await expect(snap).toBeVisible();
  const src = await snap.getAttribute('src');
  expect(src.startsWith('data:image/'), '快照不是 data 图').toBe(true);
  expect(src.length, '快照是空图').toBeGreaterThan(5000);
  // 快照几何 = view 原位（内容视觉纹丝不动，不是推让）
  const sBox = await snap.boundingBox();
  expect(Math.round(sBox.x)).toBe(10);
  expect(Math.round(sBox.width)).toBe(v.bounds.width);
  await expect.poll(async () => (await viewInfo(key)).attached, { timeout: 4000 }).toBe(false); // view 真摘了
  // 移开 → 收回：view 挂回原位、快照撤掉
  await page.mouse.move(900, 430);
  await expect(page.locator('body')).not.toHaveClass(/is-sb-peek/, { timeout: 3000 });
  await expect.poll(async () => { const w = await viewInfo(key); return w.attached && w.bounds.x === 10; }, { timeout: 4000 }).toBe(true);
  await expect(page.locator('.web-peek-snap')).toHaveCount(0);
  expect(isRed((await viewInfo(key)).pixel), '挂回后页面没真回屏').toBe(true);
});

test('沉浸窗框 × 网页（展开态，Colin 2026-07-18 扩 #271）：view bounds 跟随 #main 矩形（x=侧栏宽+10, y=10）', async () => {
  await launch();
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  // 展开态（未收起）：窗框非全屏恒有 → #main 四周 10px 框，网页 view 铺满 #main 矩形（KD3：bounds=renderer 量的 #main rect，margin 变化自动传导）
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  const mainRect = await page.evaluate(() => {
    const r = document.getElementById('main').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const sbW = await page.evaluate(() => Math.round(document.getElementById('sidebar').getBoundingClientRect().width));
  expect(mainRect.x, '#main 左=侧栏宽+10（左缝）').toBe(sbW + 10);
  expect(mainRect.y, '#main 顶=10').toBe(10);
  await expect.poll(async () => (await viewInfo(key)).bounds.x, { timeout: 4000 }).toBe(mainRect.x);
  const v = await viewInfo(key);
  expect(v.bounds.y, 'view 顶跟随 #main').toBe(mainRect.y);
  expect(v.bounds.width, 'view 宽跟随 #main').toBe(mainRect.w);
  expect(v.bounds.height, 'view 高跟随 #main').toBe(mainRect.h);
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
  await expectAttached(0); // ← 提交前 view 绝不能挂上（闪回半修的真门）
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

// 失败注入：reserve 一个端口 → 立刻 close → 该端口确定性拒连（ERR_CONNECTION_REFUSED,-102,
// 主 frame → web-tabs-policy.classifyLoadFailure='error-page'）。http 已在文件顶部 import。
function reserveClosedUrl() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve('http://127.0.0.1:' + port + '/')); });
  });
}
// view 的 attach/detach 走 IPC 异步：showError 在渲染层立刻置 errEl.hidden=false,但主进程 removeChildView
// 稍晚——断言瞬时 attachedCount 会在 full-suite 负载下偶发抢跑（实测过一次）。轮询到期望值,既除抖又不
// 削门:真卡着不脱挂的回归永远到不了 0 → 超时翻红。
async function expectAttached(n, timeout = 8000) { await expect.poll(() => attachedCount(), { timeout }).toBe(n); }

test('P1 错误页不是死路：加载过的标签失败→占位(0 view attach)，omnibox 换好网址回车真恢复(探索测试 p1)', async () => {
  await launch();
  const deadUrl = await reserveClosedUrl();
  // 1) 先正常加载一个网页（绿底 Page B）→ 提交后起始页被藏、view 挂上（everCommitted=true）。
  //    这步是复现真死路的关键:起始页一旦被提交藏掉,everCommitted 重挂分支(!newtabEl.hidden)就够不着了
  //    ——纯新标签(起始页仍在)出错反而能靠 everCommitted 分支自愈,不是死路,那样的用例测不到本修复。
  await openWebViaModal(base + '/b');
  const key = await activeWebKey();
  expect(key).not.toBeNull();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && v.pixel && v.pixel.g > 100 && v.pixel.r < 90); }, { timeout: 8000 }).toBe(true);
  // 2) 原地导航到必失败网址 → 出错：占位 + 重试钮 + 主进程镜像 error + ★0 view attach = 真死路态。
  //    S4 真门：只测 #web-error visible 是代理断言；attachedCount===0 才测得出「空白 view 没盖上来」。
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(deadUrl);
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#web-error')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#web-err-reload')).toBeVisible();
  await expect.poll(() => page.evaluate((k) => { const st = window.__webStatus(k); return !!(st && st.error); }, key), { timeout: 8000 }).toBe(true);
  await expectAttached(0);
  // 3) 恢复：地址栏输好网址回车 → 网页标签原地导航（§4.2）
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/');
  await page.locator('#omni-input').press('Enter');
  // 4) 恢复强断言：占位藏 + 同一 view 真 attach + 真渲染红底(view 自身 framebuffer) + 恰好 1 个 view(防重复 attach)
  await expect(page.locator('#web-error')).toBeHidden({ timeout: 8000 });
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  expect(await attachedCount()).toBe(1);
  expect(await page.evaluate((k) => { const st = window.__webStatus(k); return st ? !!st.error : true; }, key)).toBe(false);
});

test('P1 错误页恢复变体：出错标签切走再切回(activate 复现占位)→好网址回车仍恢复(探索测试 p1)', async () => {
  await launch();
  const deadUrl = await reserveClosedUrl();
  // A：先开一个正常网页标签（红底 Page A，view 真挂上）
  await openWebViaModal(base + '/');
  const keyA = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(keyA); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  // B：再开一个标签导航到必失败网址 → B 激活且出错、0 view attach
  await openWebViaModal(deadUrl);
  const keyB = await activeWebKey();
  expect(keyB).not.toBe(keyA);
  await expect(page.locator('#web-error')).toBeVisible({ timeout: 8000 });
  await expectAttached(0);
  // 切回 A（activate 复活 A 的 view）→ 再切回 B（activate 依 webState[B].error 复现占位，走的是与
  // did-fail-load 不同的 showError 入口）。Ctrl+Tab 顺序循环（2 标签 = 来回切）。
  await page.keyboard.press('Control+Tab');
  await expect.poll(async () => (await activeWebKey()) === keyA, { timeout: 4000 }).toBe(true);
  await expect.poll(async () => { const v = await viewInfo(keyA); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  await page.keyboard.press('Control+Tab');
  await expect.poll(async () => (await activeWebKey()) === keyB, { timeout: 4000 }).toBe(true);
  await expect(page.locator('#web-error')).toBeVisible({ timeout: 8000 });
  await expectAttached(0); // 切回 B：占位复现、A 的 view 摘掉、B 无 view
  // B 上 omnibox 换好网址回车 → 恢复（这条 activate-复现占位 后的恢复路，与 live did-fail-load 后的恢复同支）
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/b'); // 绿底 Page B
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#web-error')).toBeHidden({ timeout: 8000 });
  await expect.poll(async () => { const v = await viewInfo(keyB); return !!(v && v.attached && v.pixel && v.pixel.g > 100 && v.pixel.r < 90); }, { timeout: 8000 }).toBe(true);
  expect(await attachedCount()).toBe(1);
});

test('P1 错误页恢复零闪回：加载过的标签失败后恢复到慢页，提交前占位撑住、view 不早挂(探索测试 p1)', async () => {
  await launch();
  const deadUrl = await reserveClosedUrl();
  // 先正常加载(红底 Page A,提交→起始页藏)→ 再原地导航到失败网址(出错、0 attach = 真死路态)
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(deadUrl);
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#web-error')).toBeVisible({ timeout: 8000 });
  await expectAttached(0);
  // 恢复到慢页（/slow：3s 才给响应头）
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/slow');
  await page.locator('#omni-input').press('Enter');
  // ★加载窗口内（提交前,/slow 头 3s 才来）：view 绝不能早挂——脱挂 view 里此刻还是失败页残帧,早挂=闪回。
  // 连续采样(每 300ms)整段提交前窗口都必须 0-attach + 占位仍在,而非单点采样——单点会漏掉亚秒级早挂,
  // 也分不清「提交沿挂」与「提交前挂」(对抗审查 test-adequacy 指出的洞)。navSeq 提交沿修法全程 0-attach。
  for (let t = 0; t < 2400; t += 300) {
    expect(await attachedCount()).toBe(0);
    await expect(page.locator('#web-error')).toBeVisible();
    await page.waitForTimeout(300);
  }
  // 提交后：占位藏 + view attach + 蓝底真渲染
  await expect(page.locator('#web-error')).toBeHidden({ timeout: 10000 });
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && v.pixel && v.pixel.b > 100 && v.pixel.r < 90); }, { timeout: 8000 }).toBe(true);
  expect(await attachedCount()).toBe(1);
});

test('P1 错误页恢复不误触发：换到中止型导航(下载被 cancel/-3)不提交时,占位撑住、绝不挂失败页残帧(探索测试 p1)', async () => {
  await launch();
  const deadUrl = await reserveClosedUrl();
  // 先正常加载(红底) → 原地导航到失败网址(出错、0 attach = 真死路态)
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(deadUrl);
  await page.locator('#omni-input').press('Enter');
  await expect(page.locator('#web-error')).toBeVisible({ timeout: 8000 });
  await expectAttached(0);
  // 恢复输入一个「下载被 cancel」的地址(/dl：Content-Disposition attachment → will-download → item.cancel()
  // → ERR_ABORTED(-3) → classifyLoadFailure='ignore',不置 error 也不触发 did-navigate = loading 循环但没提交)。
  // 这正是对抗审查 CONFIRMED 的 P2：若按 loading 收尾沿重挂,会把脱挂 view 里的失败页残帧盖上、还丢重试钮。
  // navSeq 提交沿修法：没提交 → navSeq 不变 → 不重挂,占位与重试钮原样撑住(绝不让这条路比修复前更糟)。
  await page.locator('#omni-input').click();
  await page.locator('#omni-input').fill(base + '/dl');
  await page.locator('#omni-input').press('Enter');
  await page.waitForTimeout(2000); // 给足下载 cancel + loading 收尾窗口,假沿有充分机会误触发
  await expectAttached(0);                        // ★没有任何 view 被误挂
  await expect(page.locator('#web-error')).toBeVisible();       // 占位仍在
  await expect(page.locator('#web-err-reload')).toBeVisible();  // 重试钮仍在(没被误挂顶掉)
});

test('P1 恢复只认激活标签：后台标签(慢页)提交不劫持前台标签的内容区(guard #2,探索测试 p1)', async () => {
  await launch();
  // A：前台正常网页(红底,view 挂上)
  await openWebViaModal(base + '/');
  const keyA = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(keyA); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  // B：再开一个慢页标签(/slow,3s 才提交)→ B 激活、尚未提交
  await openWebViaModal(base + '/slow');
  const keyB = await activeWebKey();
  expect(keyB).not.toBe(keyA);
  // 立刻切回 A(远早于 B 的 3s 提交)→ A 前台挂上,B 退后台仍在加载
  await page.keyboard.press('Control+Tab');
  await expect.poll(async () => (await activeWebKey()) === keyA, { timeout: 4000 }).toBe(true);
  await expect.poll(async () => { const v = await viewInfo(keyA); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  // 过 B 的提交点：B 在后台 did-navigate(navSeq++) 推来时,恢复分支必须被 guard #2 挡住,不劫持 A 的内容区。
  await page.waitForTimeout(3500);
  expect(await activeWebKey()).toBe(keyA);          // 激活仍是 A
  expect(await attachedCount()).toBe(1);            // 只有一个 view 挂着(A),B 没被误挂上
  const va = await viewInfo(keyA);
  expect(!!(va && va.attached && isRed(va.pixel))).toBe(true); // 内容区仍是 A 的红底,没被 B 顶掉
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
  // 管理入口**常显**（Wendi 2026-07-17 与标签页「+」统一,§4.3/§15）——强断言:鼠标不在收藏行上时
  // 真实 computed opacity 也是 1（旧行为 opacity:0 hover 才显 = 此处翻红;查 computed 非查 class,防哑门）
  await page.mouse.move(600, 400); // 鼠标挪去编辑区,确保没 hover 收藏行
  expect(await page.locator('#sb-fav-manage').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.locator('#sb-tabs .sb-zone-add').evaluate((el) => getComputedStyle(el).opacity)).toBe('1'); // 与「+」口径一致的对照
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

// Wendi 2026-07-17:重启后点一个恢复的标签,行标题先闪「新标签页」+spinner 再变回真名。
// 根因两环:主进程 registry 建 view 时发明占位 title(web-tabs.js createView)+ renderer 跟随块
// 拿占位盲覆写侧栏里持久化的真名(browser.js onWebTabUpdated)。修后:registry title 初始 null、
// renderer 只在真标题(page-title-updated 后非空)时覆写。
// 门:/slow 3s 响应窗口撑宽加载期,MutationObserver 记录标签行标题的**每一个中间值**(比抽样强,
// 一帧的闪也逃不掉),断言全程 ⊆ {真名集合}——「新标签页」和「裸 URL」两种闪法都翻红。
test('恢复的标签懒加载:行标题全程保持持久化真名,不闪「新标签页」/裸 URL', async () => {
  const keep = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2webkeep2-'));
  tmpDir = keep;
  await launch();
  await openWebViaModal(base + '/slow');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Slow', { timeout: 15000 });
  await openWebViaModal(base + '/'); // 第二个标签,退出时它是激活项 → 重启后 /slow 是「后台恢复标签」等着被点
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name').nth(1)).toHaveText('Page A', { timeout: 8000 });
  await page.waitForTimeout(600); // persistTabs 落盘
  await app.close();

  tmpDir = keep; // 同一 userdata 再启动
  await launch();
  const slowRow = page.locator('#sb-tabs .sb-tab.sb-tab-web', { hasText: 'Slow' });
  await expect(slowRow).toBeVisible({ timeout: 8000 }); // 恢复:行上直接是持久化真名
  // 布观察者:此后 #sb-tabs 里出现过的每个标题快照都进 __titleLog
  await page.evaluate(() => {
    window.__titleLog = [];
    const snap = () => document.querySelectorAll('#sb-tabs .sb-name').forEach((n) => window.__titleLog.push(n.textContent));
    new MutationObserver(snap).observe(document.getElementById('sb-tabs'), { subtree: true, childList: true, characterData: true });
    snap();
  });
  await slowRow.click(); // 懒加载启动,/slow 会挂 3s 才给响应头 → 加载窗口足够宽
  await page.waitForTimeout(1200); // 窗口中段:行标题必须还是真名(修前这里已经是「新标签页」)
  await expect(slowRow.locator('.sb-name')).toHaveText('Slow');
  await expect.poll(async () => { // 等页面真加载完(标题事件到齐)
    const k = await activeWebKey();
    if (!k) return false;
    const v = await viewInfo(k);
    return !!(v && v.attached);
  }, { timeout: 15000 }).toBe(true);
  await expect(slowRow.locator('.sb-name')).toHaveText('Slow'); // 终态仍真名
  // 全程无一帧脏值:出现过的标题只允许两个真名(「新标签页」/裸 URL 任何一帧都算翻车)
  const log = await page.evaluate(() => window.__titleLog);
  const dirty = log.filter((t) => t !== 'Slow' && t !== 'Page A');
  expect(dirty, '标签行标题闪过脏值: ' + JSON.stringify(dirty)).toEqual([]);
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
  await expect(page.locator('#wp-engine-select')).toHaveValue('bing'); // 默认 Bing（i18n 后设置页有语言/外观/引擎三个 select，用 id 精确定位）
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

test('P2-4 含冒号词组落搜索不误拦：note:hello 开成 Bing 搜索页(不赌外网,验 registry.url)', async () => {
  await launch();
  await openWebViaModal('note:hello'); // ⌘T modal 地址行提交
  // 旧 bug: 被当危险协议 blocked(toast+不建 view); 修后: 落搜索,新标签 url = Bing 搜索页
  await expect.poll(() => registrySnapshot().then((s) => s.map((x) => x.url).join(' ')), { timeout: 8000 })
    .toContain('bing.com/search?q=note%3Ahello');
});

test('P2-3 地址栏打字中键盘切标签:残留字丢弃复位为新标签 url;同标签 title 更新不冲掉打字', async () => {
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  await openWebViaModal(base + '/b'); // 标签 B 激活
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(2);
  await expect(page.locator('#omni-input')).toHaveValue(base + '/b', { timeout: 8000 });
  // 在 B 的地址栏打半截字(不回车)
  await page.locator('#omni-input').fill('zzz-half-typed');
  // 键盘切标签(synthetic Ctrl+Tab 走 renderer 全局 handler,不触发 omnibox blur)
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })));
  // 修后:地址栏复位为新激活标签的真实 url,残留 zzz-half-typed 丢弃
  const activeUrl = await page.evaluate(() => { const e = window.__sbWeb.active(); return e ? (e.url || '') : ''; });
  expect(activeUrl).not.toBe('zzz-half-typed');
  await expect(page.locator('#omni-input')).toHaveValue(activeUrl);
  // 对照组(守住原守卫):同标签的 syncChrome(后台 title 更新)不冲掉正在打的字
  await page.locator('#omni-input').fill('control-typing');
  await page.evaluate(() => window.__webChromeSync()); // 同标签,key 没变
  await expect(page.locator('#omni-input')).toHaveValue('control-typing');
});

test('P3-01 星标只在网页标签显形:文档标签态地址栏可见但星标真隐藏(不是 CSS 压过 [hidden] 的死按钮)', async () => {
  await launch();
  // 开工作区 + 文档 → 激活一个文档标签（地址栏此时可见、显本地路径,但不该有收藏星标）
  const wsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2star-'));
  await fs.writeFile(path.join(wsDir, 'a.html'), '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>a</title></head><body><h1>AAA</h1></body></html>', 'utf8');
  await app.evaluate(({ app: a }, dir) => { process.env.WS2_FOLDER_IN = dir; }, wsDir);
  await page.locator('#home-open-folder').click();
  await page.locator('.sb-file[data-rel="a.html"]').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  // 先确认地址栏(星标的祖先)可见 → 星标是否隐藏就取决于它自己的样式,不是祖先被藏(防哑门)
  await expect(page.locator('#omni-input')).toBeVisible();
  // 文档标签态:收藏星标应真隐藏。旧 bug: .sb-omni-star{display:inline-flex} 压过 UA [hidden]
  // {display:none} → JS 设了 hidden 也隐不掉,露出点了无效的死星标。
  await expect(page.locator('#omni-star')).toBeHidden();
  // 正向对照:开网页标签 → 星标显形
  await openWebViaModal(base + '/');
  await expect(page.locator('#omni-star')).toBeVisible();
});

test('U1 空态「打开文件夹」CTA 在侧栏最底（收藏/置顶/标签页之下，Wendi 2026-07-15）', async () => {
  await launch(); // 无工作区
  await openWebViaModal(base + '/'); // 开个网页标签 → 侧栏亮起（0 根仍显示 #sb-empty）
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect(page.locator('#sb-empty')).toBeVisible(); // 0 根 → CTA 显示
  await expect(page.locator('#sb-empty-open')).toBeVisible(); // 打开文件夹按钮（接线 = pickFolder，未断）
  // 坐标断言（布局，功能测不出）：CTA 在 置顶/标签页 之下 = 侧栏最底
  const y = (sel) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().top);
  const emptyY = await y('#sb-empty'), tabsY = await y('#sb-tabs'), pinnedY = await y('#sb-pinned');
  expect(emptyY).toBeGreaterThan(tabsY);
  expect(emptyY).toBeGreaterThan(pinnedY);
});

test('U2 三栏折叠统一：置顶/标签页可折叠(默认展开)+计数+持久化(Wendi 2026-07-15)', async () => {
  await launch();
  await openWebViaModal(base + '/'); // 一个标签页（普通组）
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  // 默认态：标签页/置顶展开(is-open + 有列表)、收藏收起(既有拍板不变)
  await expect(page.locator('#sb-tabs')).toHaveClass(/is-open/);
  await expect(page.locator('#sb-tabs .sb-zone-list')).toBeVisible();
  await expect(page.locator('#sb-pinned')).toHaveClass(/is-open/);
  await expect(page.locator('#sb-fav-list')).toBeHidden(); // 收藏仍默认收起
  // 折叠「标签页」：点栏标 caret → 列表消失、is-open 撤、栏标出计数
  await page.locator('#sb-tabs .sb-zone-caret').click();
  await expect(page.locator('#sb-tabs .sb-zone-list')).toHaveCount(0);
  await expect(page.locator('#sb-tabs')).not.toHaveClass(/is-open/);
  await expect(page.locator('#sb-tabs .sb-zone-count')).toHaveText('1'); // 1 个标签
  // 折叠「置顶」同款
  await page.locator('#sb-pinned .sb-zone-caret').click();
  await expect(page.locator('#sb-pinned .sb-zone-list')).toHaveCount(0);
  await expect(page.locator('#sb-pinned')).not.toHaveClass(/is-open/);
  // 持久化：重启（同 userdata，标签会话恢复 + localStorage 保留）→ 标签页仍折叠
  await app.close();
  await launch();
  // 折叠态活过重启：列表折叠不渲染,标签恢复由折叠栏标的计数体现（count=1 = Page A 恢复了）
  await expect(page.locator('#sb-tabs .sb-zone-count')).toHaveText('1', { timeout: 8000 });
  await expect(page.locator('#sb-tabs')).not.toHaveClass(/is-open/); // 折叠态活过重启
  await expect(page.locator('#sb-tabs .sb-zone-list')).toHaveCount(0);
});

test('U2b 折叠栏标键盘：栏标 keydown 折叠、+ 按钮的 keydown 不冒泡成折叠(审查 P3 回归门)', async () => {
  // 用 dispatchEvent 直接派发 keydown（确定性,不依赖 xvfb 下不可靠的 OS 焦点路由）；核心验的是
  // head.onkeydown 的 e.target===head 守卫:栏标自身的键触发折叠、从 + 按钮冒泡上来的键不触发。
  await launch();
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs')).toHaveClass(/is-open/);
  // 栏标自身 keydown Enter（e.target=head）→ 折叠
  await page.locator('#sb-tabs .sb-zone-head').dispatchEvent('keydown', { key: 'Enter', bubbles: true });
  await expect(page.locator('#sb-tabs')).not.toHaveClass(/is-open/);
  // 再来一次 → 展开
  await page.locator('#sb-tabs .sb-zone-head').dispatchEvent('keydown', { key: 'Enter', bubbles: true });
  await expect(page.locator('#sb-tabs')).toHaveClass(/is-open/);
  // 关键 P3：+ 按钮上的 keydown Enter 冒泡到 head，但 e.target=按钮≠head → 守卫拦住、不折叠
  await page.locator('#sb-tabs .sb-zone-add').dispatchEvent('keydown', { key: 'Enter', bubbles: true });
  await expect(page.locator('#sb-tabs')).toHaveClass(/is-open/); // 仍展开
  // Space 同款（Space 在被折叠场景更险，一并守）
  await page.locator('#sb-tabs .sb-zone-add').dispatchEvent('keydown', { key: ' ', bubbles: true });
  await expect(page.locator('#sb-tabs')).toHaveClass(/is-open/);
});

test('U3 导航加载反馈：慢站导航期标签行转圈(spinner 真动画,非查 class)、旧页保留、提交后消失', async () => {
  await launch();
  await openWebViaModal(base + '/'); // Page A(快)先加载好
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return v && v.attached && isRed(v.pixel); }, { timeout: 8000 }).toBe(true);
  const tab = page.locator('#sb-tabs .sb-tab.sb-tab-web');
  await expect(tab).not.toHaveClass(/is-loading/); // Page A 已加载完,不转圈
  // 原地导航到慢站 /slow（同标签,view 不摘,旧红页保留 = Chrome 语义）
  await page.locator('#omni-input').fill(base + '/slow');
  await page.locator('#omni-input').press('Enter');
  // 加载窗口内:标签行 is-loading + spinner 真有旋转动画（强断言:查 computed ::after animation-name,非查 class 名——哑门自检）
  await expect(tab).toHaveClass(/is-loading/, { timeout: 3000 });
  const spinAnim = await tab.locator('.sb-ico').evaluate((el) => getComputedStyle(el, '::after').animationName);
  expect(spinAnim).toContain('ws-spin');
  // 旧页保留:加载期渲染区仍是旧红页 view（未摘），不是空白/新页——这是 Wendi「跳转旧页面」感知的正解(旧页+转圈=正常加载)
  const v = await viewInfo(key);
  expect(v.attached).toBe(true);
  expect(isRed(v.pixel)).toBe(true); // 仍显示旧红页
  // 提交后:spinner 熄灭 + 新蓝页上屏
  await expect(tab).not.toHaveClass(/is-loading/, { timeout: 12000 });
  await expect.poll(async () => { const v2 = await viewInfo(key); return v2 && v2.pixel && v2.pixel.b > 120 && v2.pixel.r < 90; }, { timeout: 8000 }).toBe(true); // 蓝底 /slow 上屏
});

test('U5 ⌘R 刷新网页标签：菜单 reload → server 真收到二次请求（命中计数+1，非查 renderer 状态，Wendi 2026-07-15）', async () => {
  await launch();
  rlHits = 0;
  await openWebViaModal(base + '/rl'); // /rl 每次请求 rlHits++
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect.poll(() => rlHits, { timeout: 8000 }).toBe(1); // 首载命中 1
  // 菜单 reload（= ⌘R 视图菜单加速器，等价 sendMenu('reload')；web 活跃 → __webMenu 接管 → navReload.click → wc.reload）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'reload'));
  // 强断言：server 端命中 +1 = view 真回源重载（no-store，不吃缓存），不是查 renderer JS 状态（哑门自检：断言查线上字节）
  await expect.poll(() => rlHits, { timeout: 8000 }).toBe(2);
});

test('U5 边界 ⌘R 无可刷新目标不炸：无网页标签时 menu reload → no-op、无报错、无 view 挂上（url=null 同款安全路径）', async () => {
  await launch(); // 无工作区、无标签：无 web url 可刷新
  // __webMenu 判 isWebActive=false → 落 shell onMenu → 无 reload 分支 → no-op。起始页(url=null)走 navReload disabled 守卫,同样落 no-op。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'reload'));
  await page.waitForTimeout(300); // 给「若误触发导航」一点冒头时间
  await expectAttached(0); // 没有任何 web view 被挂上（reload 没误开导航）
  await expect(page.locator('#sidebar')).toBeAttached(); // 壳没崩
});

// Wendi 2026-07-16「更新的时候背景变白了,按说背景应该 keep the tab content」：DOM 弹层要摘原生
// view（否则弹层被网页盖住——Electron 里 WebContentsView 恒在 HTML 层之上），摘掉就露出空态底。
// 修法=摘之前对 view 的 webContents 截一帧垫在弹层下（.web-snap）。门走 Wendi 原路径（手动检查
// 更新→available 自动弹面板），强断言：快照真是非空 data 图 + 几何盖住内容区 + view 真摘了；
// 关弹层后快照撤掉 + view 真挂回（像素级红底回屏,非查 class）。
test('弹层摘 view 垫页面快照：更新弹窗背景保住网页内容,关弹层挂回撤图（Wendi 2026-07-16）', async () => {
  await launch();
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const i = await viewInfo(key); return !!(i && i.attached && isRed(i.pixel)); }, { timeout: 8000 }).toBe(true);
  await app.evaluate(() => { globalThis.__ws2UpdateSim.push({ type: 'checking', manual: true }); });
  await app.evaluate(() => { globalThis.__ws2UpdateSim.push({ type: 'available', version: '9.9.9', notes: [{ t: 'li', text: '条目' }] }); });
  await expect(page.locator('.up-card')).toBeVisible();
  const snap = page.locator('.web-snap');
  await expect(snap).toBeVisible();
  const src = await snap.getAttribute('src');
  expect(src.startsWith('data:image/'), '快照不是 data 图').toBe(true);
  expect(src.length, '快照是空图').toBeGreaterThan(5000);
  const sBox = await snap.boundingBox();
  const mBox = await page.locator('#main').boundingBox();
  expect(Math.abs(sBox.x - mBox.x), '快照没对齐内容区左缘').toBeLessThanOrEqual(2);
  expect(Math.abs(sBox.width - mBox.width), '快照没盖住内容区宽度').toBeLessThanOrEqual(4);
  await expectAttached(0); // 原契约不变：弹层期间 view 真摘（弹层不被网页盖住）
  await page.locator('.up-btn[data-act="close"]').click(); // 「以后再说」关面板
  await expectAttached(1);
  await expect(page.locator('.web-snap')).toHaveCount(0);
  const after = await viewInfo(key);
  expect(after.attached).toBe(true);
  expect(isRed(after.pixel), '关弹层后页面没真回屏').toBe(true);
});
