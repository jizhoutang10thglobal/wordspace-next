// UX 审计截图:抓多个状态存 PNG,供人 / agent 目视找 ui/ux bug。用法 node scripts/browser-shots.js
const { _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs'); const os = require('os'); const path = require('path');
const OUT = path.join(os.tmpdir(), 'ws-browser-shots'); fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset=utf8><title>示例网站 · Example</title><style>body{font-family:sans-serif;padding:40px;max-width:700px;margin:auto}h1{color:#1a73e8}</style><h1>这是一个真实网页</h1><p>由 Chromium 渲染。这段文字用来测试页内查找。Lorem ipsum dolor sit amet.</p><a href="/2">下一页链接</a>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const wsDir = path.join(tmp, 'ws'); fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, '设计方案.html'), '<!doctype html><html><body><h1>设计方案</h1><p>这是一个本地 Wordspace 文档,用来对比文档态和网页态的观感是否统一。</p></body></html>', 'utf8');
  const app = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, WS2_USERDATA: path.join(tmp, 'ud'), WS2_FOLDER_IN: wsDir, WS2_NO_CLOSE_DIALOG: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1200, height: 820 });
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };

  await page.waitForSelector('#sidebar.sb-on', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await shot('01-startup-newtab');           // 开屏 NewTab 页 + 侧栏 omnibox

  await page.evaluate(() => { const a = document.getElementById('bc-addr'); a.focus(); }); await shot('02-omnibox-focus');

  // omnibox 输网址 → 网页态
  await page.fill('#bc-addr', url); await page.press('#bc-addr', 'Enter');
  await page.waitForTimeout(2000);
  await shot('03-web-tab');                    // 网页态(view + 侧栏标签)

  // Cmd+T modal
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  await page.waitForTimeout(800);
  await shot('04-newtab-modal');               // Cmd+T 模板+地址栏 modal
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // 开工作区 + 开文档
  await page.click('#sb-open-folder');
  await page.waitForSelector('.sb-file[data-rel="设计方案.html"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  await shot('05-workspace-opened');           // 工作区 + 树(注意:web 标签被 destroyAll 了没?)
  await page.click('.sb-file[data-rel="设计方案.html"]');
  await page.waitForTimeout(1200);
  await shot('06-doc-open');                    // 文档态(对比割裂感)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {}); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OUT_DIR', OUT);
  process.exit(0);
})().catch((e) => { console.error('SHOTS ERROR', e); process.exit(1); });
