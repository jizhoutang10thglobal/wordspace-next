// 默认浏览器 e2e 真门：系统递 URL（open-url）→ 网页标签。
// 覆盖四条：热路径（app 开着点链接）/ 冷启动排队（app 没开点链接,等 did-finish-load + restoreReady）/
// 冷启动不覆盖已恢复的标签（loadTabs 竞态,同 open-file 的 __pendingColdOpen 教训）/ scheme 白名单
// （file:/javascript: 丢弃,不建标签）。
// e2e 点不了系统层的真链接,open-url 用 app.emit 注入（handler/队列/白名单/renderer 消费全是真链路）;
// 冷启动走 WS2_OPEN_URL seam（main.js 非打包态,与 WS2_OPEN_FILE 同款,且过同一道白名单）。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

let app, page, server, base;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/b')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Page B</title></head><body style="background:#1e8a3c;color:#fff"><h1>BBB</h1></body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Page A</title></head><body style="background:#c81e1e;color:#fff"><h1>AAA</h1></body></html>');
      }
    });
    server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); });
  });
}

async function launch(userdata, extraEnv = {}) {
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: userdata, WS2_NO_CLOSE_DIALOG: '1', ...extraEnv },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860));
}

// 模拟 macOS 把链接递给已运行实例（open-url 事件带 preventDefault）。
function emitOpenUrl(url) {
  return app.evaluate(({ app }, u) => { app.emit('open-url', { preventDefault() {} }, u); }, url);
}

const webTabCount = () => page.locator('#sb-tabs .sb-tab.sb-tab-web').count();

test.beforeAll(async () => { await startServer(); });
test.afterAll(async () => { if (server) server.close(); });
test.afterEach(async () => { if (app) await app.close().catch(() => {}); app = null; });

test('热路径：app 开着,系统递 http 链接 → 新网页标签真加载并激活', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2defbr-'));
  await launch(path.join(tmp, 'userdata'));
  await emitOpenUrl(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(1);
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  await expect(page.locator('#omni-input')).toHaveValue(base + '/');
});

test('冷启动：URL 在 renderer 就绪前到 → 排队后建标签,且不覆盖恢复的旧标签', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2defbr-'));
  const userdata = path.join(tmp, 'userdata');
  // 第一启:开一个网页标签留持久化
  await launch(userdata);
  await emitOpenUrl(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name')).toHaveText('Page A', { timeout: 8000 });
  await app.close();
  // 第二启:冷启动带 URL(seam 在 did-finish-load 前入队,复现「点链接把 app 拉起来」)
  await launch(userdata, { WS2_OPEN_URL: base + '/b' });
  // 旧标签(Page A)恢复 + 新标签(/b)都在——若 web-open-request 抢在 loadTabs 前建,会被整体覆盖只剩 1 个
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveCount(2, { timeout: 8000 });
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web .sb-name').filter({ hasText: 'Page B' })).toHaveCount(1, { timeout: 8000 });
  // 新标签是激活态(用户点的链接要立刻可见)
  await expect(page.locator('#omni-input')).toHaveValue(base + '/b');
});

test('scheme 白名单：file:// 与 javascript: 一律丢弃,不建标签', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2defbr-'));
  // 冷启动 file://(seam 走 openExternalUrlFromOS,同一道白名单)
  await launch(path.join(tmp, 'userdata'), { WS2_OPEN_URL: 'file:///etc/hosts' });
  await page.waitForTimeout(1500);
  expect(await webTabCount()).toBe(0);
  // 热路径 javascript:
  await emitOpenUrl('javascript:alert(1)');
  await page.waitForTimeout(800);
  expect(await webTabCount()).toBe(0);
});
