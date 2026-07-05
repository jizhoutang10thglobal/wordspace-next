// U4/U5 功能冒烟：真启动 app + 本地 http fixture,验激活漏斗/地址栏/view attach 排他/切回 detach。
// 用法：node scripts/browser-smoke.js （宿主,需已装 electron 二进制）。不访外网。
const { _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

(async () => {
  // 本地测试页
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>SMOKE PAGE</title><h1 id=h>hello from local</h1><input id=box>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port + '/';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-smoke-'));
  const wsDir = path.join(tmp, 'ws'); fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'doc.html'), '<!doctype html><html><body><h1>DOC</h1></body></html>', 'utf8');
  const userData = path.join(tmp, 'ud');

  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: userData, WS2_FOLDER_IN: wsDir, WS2_NO_CLOSE_DIALOG: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const log = [];
  const ok = (c, m) => log.push((c ? 'PASS ' : 'FAIL ') + m);

  // 开工作区
  await page.click('#home-open-folder');
  await page.waitForSelector('#sidebar.sb-on', { timeout: 8000 });
  ok(true, '工作区打开');

  // 关键 hook 都在（脚本加载无异常）
  const hooks = await page.evaluate(() => ({
    activate: typeof window.__webActivate,
    detach: typeof window.__webDetach,
    urlInput: typeof (window.WS2UrlInput && window.WS2UrlInput.parse),
    policy: typeof (window.WS2WebPolicy && window.WS2WebPolicy.routeMenuCmd),
    newTabHook: !!(window.__sbHooks && window.__sbHooks.newTab),
  }));
  ok(hooks.activate === 'function', '__webActivate 存在');
  ok(hooks.detach === 'function', '__webDetach 存在');
  ok(hooks.urlInput === 'function', 'WS2UrlInput 加载');
  ok(hooks.policy === 'function', 'WS2WebPolicy 加载');
  ok(hooks.newTabHook, 'newTab hook 就位');

  const childCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length);

  // Cmd+T → 新标签页 surface
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await page.waitForSelector('#web-newtab:not([hidden])', { timeout: 5000 }).catch(() => {});
  const newtabShown = await page.evaluate(() => !document.getElementById('web-newtab').hidden);
  ok(newtabShown, 'Cmd+T 显示新标签页 surface');
  const webTabRow = await page.evaluate(() => !!document.querySelector('.sb-tab.sb-tab-web'));
  ok(webTabRow, '侧栏出现网页标签行');

  // 地址栏输入本地 URL → 导航,view attach
  await page.fill('#nt-addr', url);
  await page.press('#nt-addr', 'Enter');
  await page.waitForTimeout(1500);
  const c1 = await childCount();
  ok(c1 === 1, '导航后恰好 1 个 web view attach（实际 ' + c1 + '）');

  // 页面真加载了（在 view 里执行 JS 读标题）
  const title = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const v = win.contentView.children.find((ch) => ch.webContents);
    return v ? v.webContents.executeJavaScript('document.title') : null;
  });
  ok(title === 'SMOKE PAGE', '网页在 view 里真加载（title=' + title + '）');

  // 切到文档标签 → web view detach（排他,不盖编辑器）
  await page.click('.sb-file[data-rel="doc.html"]');
  await page.waitForTimeout(800);
  const c2 = await childCount();
  ok(c2 === 0, '切到文档后 web view 摘除（实际 ' + c2 + '）');
  const docShown = await page.evaluate(() => !document.getElementById('doc-frame').hidden);
  ok(docShown, '文档 frame 显示');

  // 切回网页标签 → 重新 attach
  await page.click('.sb-tab.sb-tab-web');
  await page.waitForTimeout(800);
  const c3 = await childCount();
  ok(c3 === 1, '切回网页标签重新 attach（实际 ' + c3 + '）');

  console.log('\n' + log.join('\n'));
  const failed = log.filter((l) => l.startsWith('FAIL'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + (failed.length ? failed.length + ' FAILED' : 'ALL PASS'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('SMOKE ERROR', e); process.exit(2); });
