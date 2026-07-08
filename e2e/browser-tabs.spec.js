// 浏览器标签(WebContentsView)e2e 真门(U8)。宿主真启动 Electron + 本地 http fixture,不访外网。
// 覆盖核心闭环:开屏 NewTab → omnibox 上网(真 view attach + 页面真加载)→ 切文档排他 detach →
// 存为文档剪藏 → 浏览历史进 Cmd+P → 重启恢复(活跃 web 标签 + 模型同步)。
// 变异自检(哑门探针):断言用的判定函数必须能翻红——detach 后 attach 数必须归 0、乱词必须搜不到历史。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

let server, url, tmp, wsDir, userData;

test.beforeAll(async () => {
  // 带站内链接的本地文章页(剪藏要能抽到正文;/2 的正文够长才过 Readability 阈值)
  const ARTICLE = '<!doctype html><html><head><title>E2E PAGE 2</title></head><body><article><h1>page two</h1>' +
    '<p>' + 'Readable paragraph for the clip extraction threshold to pass in this e2e. '.repeat(5) + '</p>' +
    '<p>' + 'Second paragraph keeps the article well above the minimum length. '.repeat(5) + '</p>' +
    '</article></body></html>';
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/2') { res.end(ARTICLE); return; }
    if (req.url === '/wide') { res.end('<!doctype html><title>WIDE</title><body style="margin:0"><div style="min-width:1400px;background:#eee">固定宽 1400px 的老式桌面布局(baidu 量级;3000px 那种极端页按设计撞 0.65 下限保留横滚)</div></body>'); return; }
    res.end('<!doctype html><title>E2E SMOKE</title><h1>hello</h1><a id=lnk href="/2">next</a>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = 'http://127.0.0.1:' + server.address().port + '/';
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-browser-e2e-'));
  wsDir = path.join(tmp, 'ws'); await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'doc.html'), '<!doctype html><html><body><h1>DOC</h1></body></html>', 'utf8');
  userData = path.join(tmp, 'ud');
});

test.afterAll(async () => {
  server && server.close();
  if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function launch() {
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: userData, WS2_FOLDER_IN: wsDir, WS2_NO_CLOSE_DIALOG: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  return { app, page };
}
// 主窗口 contentView 挂着几个 WebContentsView(排他不变式的探针)
function attachedCount(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w && !w.isDestroyed() ? w.contentView.children.filter((c) => c.webContents).length : -1;
  });
}
async function shutdown(app) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
}

test('浏览核心闭环 + 剪藏 + 历史 + 重启恢复(含变异自检)', async () => {
  test.setTimeout(120000);
  let { app, page } = await launch();

  // 开屏 = NewTab 空页面,侧栏 omnibox 常驻(对齐 ui-demo)
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('#web-newtab')).toBeVisible();
  await expect(page.locator('#bc-addr')).toBeVisible();

  // 开工作区(WS2_FOLDER_IN 跳过对话框)
  await page.click('#sb-open-folder');
  await expect(page.locator('.sb-file[data-rel="doc.html"]')).toBeVisible();

  // omnibox 上网:标签行出现 + 恰好 1 个 view attach + 页面真加载(view 里读 title,非查 class 的强断言)
  await page.fill('#bc-addr', url);
  await page.press('#bc-addr', 'Enter');
  await expect(page.locator('.sb-tab.sb-tab-web')).toBeVisible();
  await expect.poll(() => attachedCount(app), { timeout: 15000 }).toBe(1);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    return v ? v.webContents.executeJavaScript('document.title') : null;
  }), { timeout: 15000 }).toBe('E2E SMOKE');

  // 站内链接点击真导航(守卫不误拦 http——security review 参数 bug 的回归锁)
  await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    if (v) v.webContents.executeJavaScript('document.getElementById("lnk").click()');
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    return v ? v.webContents.executeJavaScript('document.title') : null;
  }), { timeout: 15000 }).toBe('E2E PAGE 2');

  // 切到文档 → 排他 detach(native view 不许盖编辑器)
  await page.click('.sb-file[data-rel="doc.html"]');
  await expect.poll(() => attachedCount(app)).toBe(0);
  await expect(page.locator('#doc-frame')).toBeVisible();

  // 切回网页 → 重新 attach。变异自检①:__webDetach 后判定必须翻红(attach 计数非恒真)
  await page.click('.sb-tab.sb-tab-web');
  await expect.poll(() => attachedCount(app)).toBe(1);
  await page.evaluate(() => window.__webDetach());
  await expect.poll(() => attachedCount(app)).toBe(0); // 探针能变红 = 上面的 =1 断言不是哑的
  await page.click('.sb-tab.sb-tab-web');
  await expect.poll(() => attachedCount(app)).toBe(1);

  // 存为文档剪藏:工作区多一个 .html 且含正文段落(Readability 真生效,非空壳)
  await page.click('#web-clip-btn');
  await expect.poll(async () => {
    const files = await fs.readdir(wsDir);
    return files.filter((f) => f.endsWith('.html') && f !== 'doc.html').length;
  }, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  const clipFile = (await fs.readdir(wsDir)).find((f) => f.endsWith('.html') && f !== 'doc.html');
  const clipHtml = await fs.readFile(path.join(wsDir, clipFile), 'utf8');
  expect(clipHtml).toMatch(/Readable paragraph/);

  // 宽页自动缩放适配(Colin 2026-07-08):1400px 固定宽的页面 → zoom 自动缩到内容不横向溢出
  await page.fill('#bc-addr', url + 'wide');
  await page.press('#bc-addr', 'Enter');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    if (!v) return null;
    const z = v.webContents.getZoomFactor();
    return v.webContents.executeJavaScript('({vw: window.innerWidth, dw: document.documentElement.scrollWidth})', true)
      .then((m) => ({ zoom: z, overflow: m.dw > m.vw * 1.05 }));
  }), { timeout: 15000 }).toMatchObject({ overflow: false });
  const fitZoom = await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    return v ? v.webContents.getZoomFactor() : null;
  });
  expect(fitZoom, '1400px 宽页必须触发缩放(zoom<1),否则 fit 是哑的').toBeLessThan(1);
  // 回到窄内容页 → 恢复正常(不永久钉在缩小态)
  await page.fill('#bc-addr', url);
  await page.press('#bc-addr', 'Enter');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents);
    return v ? v.webContents.getZoomFactor() : null;
  }), { timeout: 15000 }).toBeGreaterThan(0.95);

  // 浏览历史进 Cmd+P:搜到访问过的页面。变异自检②:乱词必须无历史命中(匹配非恒真)
  await page.evaluate(() => window.__sbHooks.findPalette());
  await expect(page.locator('#fp-overlay')).toBeVisible();
  await page.fill('.fp-input', 'E2E');
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('.fp-row .fp-sub')].some((s) => (s.textContent || '').startsWith('http://127.0.0.1'))
  ), { timeout: 5000 }).toBe(true);
  await page.fill('.fp-input', 'zzz乱词zzz');
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('.fp-row .fp-sub')].some((s) => (s.textContent || '').startsWith('http'))
  )).toBe(false);
  await page.keyboard.press('Escape');

  // 重启:活跃 web 标签恢复且高亮 + activeRel 与 activeWebEntry 同步(adversarial P1 回归锁)
  await page.click('.sb-tab.sb-tab-web');
  await page.waitForTimeout(1200); // 防抖持久化落盘
  await shutdown(app);
  await new Promise((r) => setTimeout(r, 600));
  ({ app, page } = await launch());
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-tab.sb-tab-web.is-active')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector('.sb-tab.sb-tab-web.is-active');
    const k = window.__webActiveKey ? window.__webActiveKey() : null;
    return !!(r && k && r.dataset.rel === k);
  }), { timeout: 15000 }).toBe(true);
  // 历史也要活过重启(退出同步 flush + 启动载入)
  await page.evaluate(() => window.__sbHooks.findPalette());
  await page.fill('.fp-input', 'E2E');
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('.fp-row .fp-sub')].some((s) => (s.textContent || '').startsWith('http://127.0.0.1'))
  ), { timeout: 5000 }).toBe(true);
  await page.keyboard.press('Escape');

  await shutdown(app);
});
