// 打包态冒烟（U-hardening / U5）：真启动「签名跳过的 asar 打包产物」跑一遍核心闭环，证明
// WebContentsView / vendored Readability / 菜单→renderer 通道 / 工作区恢复 在打包+asar 下都活着。
// 用法（宿主 macOS，需先跑 U4 构建出 release-smoke/）：
//   node scripts/packaged-smoke.js            # 正常门
//   SMOKE_MUTATE=1 node scripts/packaged-smoke.js  # 变异自检:必须翻红(证明门是活的)
//   SMOKE_NET=1 node scripts/packaged-smoke.js      # 附加真外网软探针(不计 FAIL)
//
// 安全铁律（见 docs/plans/2026-07-08-browser-prod-hardening-plan.md B.0）：
//   产物改名 "Wordspace Smoke" → userData/单实例锁/文件关联与生产版 "Wordspace Next" 天然隔离。
//   A0 断言 userData 以 "Wordspace Smoke" 结尾，否则立即 abort（防碰生产数据）。全程绝不触碰生产版。
const { _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SMOKE_NAME = 'Wordspace Smoke';
const APP_BIN = path.join(ROOT, 'release-smoke', 'mac-arm64', SMOKE_NAME + '.app', 'Contents', 'MacOS', SMOKE_NAME);
const USERDATA = path.join(os.homedir(), 'Library', 'Application Support', SMOKE_NAME);
const CONFIG = path.join(ROOT, 'scripts', 'smoke.builder-config.json');
const SHOTS = path.join(ROOT, 'test-results', 'packaged-smoke');
const MUTATE = !!process.env.SMOKE_MUTATE;
const NET = !!process.env.SMOKE_NET;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const log = [];
const ok = (c, m) => { const line = (c ? 'PASS ' : 'FAIL ') + m; log.push(line); console.log(line); };
const warn = (m) => { console.log('WARN ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, { timeout = 8000, interval = 250 } = {}) {
  const t = Date.now();
  while (Date.now() - t < timeout) { try { if (await fn()) return true; } catch { /* retry */ } await sleep(interval); }
  return false;
}
// 只匹配 "Wordspace Smoke.app" 下的进程——绝不匹配生产版 "Wordspace Next"，也不匹配本 node 驱动(其 argv 不含此串)。
function killSmoke() { try { execSync('pkill -9 -f "' + SMOKE_NAME + '\\.app"', { stdio: 'ignore' }); } catch { /* none */ } }
function smokeRunning() { try { execSync('pgrep -f "' + SMOKE_NAME + '\\.app"', { stdio: 'ignore' }); return true; } catch { return false; } }

async function main() {
  // 前置门①：构建配置 productName 必须是 Wordspace Smoke（防有人改坏配置去碰生产 userData）
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (cfg.productName !== SMOKE_NAME) { console.error('ABORT: smoke config productName 不是 "' + SMOKE_NAME + '"（=' + cfg.productName + '）'); process.exit(3); }
  // 前置门②：产物在
  if (!fs.existsSync(APP_BIN)) { console.error('ABORT: 打包产物不存在，先跑 U4:\n  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --config scripts/smoke.builder-config.json\n缺:' + APP_BIN); process.exit(3); }
  // 前置门③（关键安全闸，启动前就验，绝不靠运行时 A0 兜底）：
  // Electron 运行时 app.getName() 读的是 asar 内 package.json 的 productName（缺则 name），决定 userData。
  // 若它不是 "Wordspace Smoke"，app 会落到生产版的 userData（wordspace-next）→ 碰 Colin 真实数据 + 撞生产锁。
  // 配置必须靠 extraMetadata 把 name/productName 一起写进 asar 的 package.json，这里静态核验。
  const ASAR = path.join(ROOT, 'release-smoke', 'mac-arm64', SMOKE_NAME + '.app', 'Contents', 'Resources', 'app.asar');
  let asarPkg;
  try { asarPkg = JSON.parse(require('@electron/asar').extractFile(ASAR, 'package.json').toString('utf8')); }
  catch (e) { console.error('ABORT: 读不出打包产物 asar 内 package.json：' + e.message); process.exit(3); }
  const runtimeName = asarPkg.productName || asarPkg.name;
  if (runtimeName !== SMOKE_NAME) {
    console.error('ABORT: 打包产物运行时 app.getName() 会解析成 "' + runtimeName + '"（≠ "' + SMOKE_NAME + '"）\n' +
      '→ userData 会落到生产版目录、碰真实数据。smoke config 必须带 extraMetadata:{name,productName}。绝不启动。');
    process.exit(3);
  }

  await fsp.mkdir(SHOTS, { recursive: true });
  // 本地 http fixture（不访外网）：/ 简单页、/article 可抽正文、/wide 1400px 定宽、/pic.png
  const ARTICLE = '<!doctype html><html><head><title>ARTICLE</title></head><body><article><h1>the article</h1>' +
    '<p>' + 'This is the first substantial paragraph of the article body with enough prose here. '.repeat(4) + '</p>' +
    '<p>' + 'A second paragraph so Readability keeps extraction above threshold in this text. '.repeat(4) + '</p>' +
    '<img src="/pic.png" alt="pic"></article></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/pic.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); return; }
    if (req.url && req.url.indexOf('/article') === 0) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(ARTICLE); return; }
    if (req.url && req.url.indexOf('/wide') === 0) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>WIDE</title><body style="margin:0"><div style="width:1400px;height:500px;background:linear-gradient(90deg,#f33,#33f)">wide fixed block</div></body>'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>PKG SMOKE</title><h1 id=h>hello packaged</h1><input id=box>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  // fixture 工作区 + 预埋 userData（seam 全死，只能靠持久化的 workspace.json 让 app 冷启动自动恢复工作区）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-pkg-'));
  const wsDir = path.join(tmp, 'workspace'); fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'a.html'), '<!doctype html><html><body><h1>AAA</h1></body></html>', 'utf8');
  killSmoke(); // 清任何孤儿 smoke（绝不碰生产版）
  await sleep(300);
  fs.rmSync(USERDATA, { recursive: true, force: true });
  fs.mkdirSync(USERDATA, { recursive: true });
  fs.writeFileSync(path.join(USERDATA, 'workspace.json'), JSON.stringify({ root: wsDir }), 'utf8'); // 最小种子：只要 root（校验过 workspace-store.load）

  const app = await electron.launch({ executablePath: APP_BIN }); // 不传 args、不传 WS2_* env（seam 打包态全死）
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });

  const childWC = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((c) => c.webContents).length);
  const viewExec = (js) => app.evaluate(({ BrowserWindow }, j) => { const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents); return v ? v.webContents.executeJavaScript(j) : null; }, js);
  const viewZoom = () => app.evaluate(({ BrowserWindow }) => { const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents); return v ? v.webContents.getZoomFactor() : null; });
  const sendMenu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);

  // ---- A0 安全门：userData 的 basename 必须精确等于 Wordspace Smoke，否则立即撤 ----
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const a0 = path.basename(ud) === SMOKE_NAME;
  ok(a0, 'A0 安全门 userData=' + ud);
  if (!a0) { console.error('!!! ABORT: userData basename 不是 "' + SMOKE_NAME + '"，可能在碰生产数据。立即退出。'); await app.close().catch(() => {}); server.close(); process.exit(3); }

  // ---- A1 侧栏 + 冷启动自动恢复工作区（打包态 workspace 恢复链）----
  await page.waitForSelector('#sidebar.sb-on', { timeout: 10000 });
  const treeUp = await poll(() => page.locator('.sb-file[data-rel="a.html"]').count().then((n) => n > 0), { timeout: 12000 });
  ok(treeUp, 'A1 冷启动自动恢复工作区、文件树出现 a.html');
  await page.screenshot({ path: path.join(SHOTS, 'a1-startup.png') }).catch(() => {});

  // 变异自检：SMOKE_MUTATE 下断言一个不存在的元素可见 → 必须记 FAIL → 证明门能翻红
  if (MUTATE) { const bogus = await page.locator('#___nonexistent___').count(); ok(bogus > 0, 'MUTATION 探针:不存在的元素应可见(故意红)'); }

  // ---- A2 打开 a.html → 编辑器渲染 h1 ----
  await page.click('.sb-file[data-rel="a.html"]');
  const h1 = page.frameLocator('#doc-frame').locator('h1');
  await h1.waitFor({ timeout: 10000 }).catch(() => {});
  ok((await h1.textContent().catch(() => null)) === 'AAA', 'A2 打开文档、编辑器渲染 h1=AAA');

  // ---- A3 编辑 → 自动保存 → 磁盘变了（打包态 save-doc IPC + 主进程 fs 写）----
  await h1.click();
  await page.keyboard.press('End');
  await page.keyboard.type('_PKGMARK_');
  const aPath = path.join(wsDir, 'a.html');
  const saved = await poll(async () => (await fsp.readFile(aPath, 'utf8')).includes('_PKGMARK_'), { timeout: 8000 });
  ok(saved, 'A3 编辑自动保存到磁盘（save IPC 打包态可用）');

  // ---- A4 omnibox 输网址 → 网页标签 + 恰 1 view attach + 真加载 ----
  await page.fill('#bc-addr', url);
  await page.press('#bc-addr', 'Enter');
  await page.waitForSelector('.sb-tab.sb-tab-web', { timeout: 10000 });
  const c1 = await poll(async () => (await childWC()) === 1, { timeout: 8000 });
  ok(c1, 'A4 导航后恰 1 个 web view attach');
  const title = await poll(async () => (await viewExec('document.title')) === 'PKG SMOKE', { timeout: 10000 });
  ok(title, 'A4 网页在 WebContentsView 里真加载（打包态 view 活着）');
  await page.screenshot({ path: path.join(SHOTS, 'a4-webtab.png') }).catch(() => {});

  // ---- A5 剪藏（Readability 在 asar 内 fs.readFileSync 读取——打包最大风险点的直接证据）----
  await page.fill('#bc-addr', url + 'article');
  await page.press('#bc-addr', 'Enter');
  await poll(async () => (await viewExec('document.title')) === 'ARTICLE', { timeout: 10000 });
  await sleep(500);
  await page.click('#web-clip-btn').catch(() => {});
  const clipped = await poll(async () => {
    const files = (await fsp.readdir(wsDir)).filter((f) => f.endsWith('.html') && f !== 'a.html');
    if (!files.length) return false;
    return /first substantial paragraph/.test(await fsp.readFile(path.join(wsDir, files[0]), 'utf8'));
  }, { timeout: 15000 });
  ok(clipped, 'A5 剪藏落盘含正文（vendored Readability 在 asar 里生效，非空壳降级）');
  await page.screenshot({ path: path.join(SHOTS, 'a5-clip.png') }).catch(() => {});

  // ---- A6 宽页 shrink-to-fit ----
  await page.fill('#bc-addr', url + 'wide');
  await page.press('#bc-addr', 'Enter');
  await poll(async () => (await viewExec('document.title')) === 'WIDE', { timeout: 10000 });
  const fit = await poll(async () => { const z = await viewZoom(); return z !== null && z < 0.99; }, { timeout: 10000 });
  ok(fit, 'A6 宽页自动缩放（zoom<1，打包态 fitToWidth 活着）');
  await page.screenshot({ path: path.join(SHOTS, 'a6-widefit.png') }).catch(() => {});

  // ---- A7 菜单→renderer 通道 ----
  await sendMenu('new-tab');
  const modal = await poll(() => page.locator('.cm-omnibar-input').count().then((n) => n > 0), { timeout: 6000 });
  ok(modal, 'A7 菜单→renderer 通道（Cmd+T 新建 modal 出现）');
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);

  // ---- A9 更新静默：全程无额外窗口（native 更新弹窗需要 app-update.yml，已确认缺失）----
  const winCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  ok(winCount === 1, 'A9 无额外/更新窗口（app-update.yml 缺失→checkForUpdates 静默 reject，见 U4 自检④）');

  // ---- A8 重启持久化：切回网页标签 → 完全退出 → 重开 → 网页标签恢复 ----
  await page.fill('#bc-addr', url);
  await page.press('#bc-addr', 'Enter');
  await page.waitForSelector('.sb-tab.sb-tab-web', { timeout: 8000 });
  await sleep(1300); // 让全局网页标签 fire-and-forget 落盘
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  const gone = await poll(() => !smokeRunning(), { timeout: 10000 }); // 第一实例必须完全退出，否则单实例锁秒杀第二次 launch
  ok(gone, 'A8 前置:第一实例完全退出（单实例锁释放）');
  await sleep(400);
  const app2 = await electron.launch({ executablePath: APP_BIN });
  const page2 = await app2.firstWindow();
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForSelector('#sidebar.sb-on', { timeout: 10000 });
  const webRestored = await poll(() => page2.locator('.sb-tab.sb-tab-web').count().then((n) => n > 0), { timeout: 12000 });
  ok(webRestored, 'A8 重启后网页标签恢复（打包态全局标签持久化）');
  const treeRestored = await poll(() => page2.locator('.sb-file[data-rel="a.html"]').count().then((n) => n > 0), { timeout: 8000 });
  ok(treeRestored, 'A8 重启后工作区文件树恢复');
  await page2.screenshot({ path: path.join(SHOTS, 'a8-restart.png') }).catch(() => {});
  await app2.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app2.close().catch(() => {});

  // ---- SMOKE_NET 软探针（不计 FAIL）：真外网 ----
  if (NET) {
    await sleep(500);
    const app3 = await electron.launch({ executablePath: APP_BIN });
    const page3 = await app3.firstWindow();
    await page3.waitForLoadState('domcontentloaded');
    await page3.waitForSelector('#sidebar.sb-on', { timeout: 10000 });
    await page3.fill('#bc-addr', 'https://www.bing.com');
    await page3.press('#bc-addr', 'Enter');
    const netTitle = await poll(async () => {
      const t = await app3.evaluate(({ BrowserWindow }) => { const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents); return v ? v.webContents.executeJavaScript('document.title').catch(() => '') : ''; });
      return t && t.length > 0;
    }, { timeout: 20000 });
    if (netTitle) console.log('WARN(net) PASS 真外网 bing.com 加载成功'); else warn('真外网未加载(网络抖动?不计 FAIL)');
    await app3.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app3.close().catch(() => {});
  }

  // ---- 收尾 ----
  server.close();
  killSmoke();
  if (USERDATA.endsWith(SMOKE_NAME)) fs.rmSync(USERDATA, { recursive: true, force: true }); // 双重保险：只删 Smoke 的 userData
  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = log.filter((l) => l.startsWith('FAIL'));
  console.log('\n' + log.join('\n'));
  console.log('\n截图存证: ' + SHOTS);
  console.log(failed.length ? '\n' + failed.length + ' FAILED' : '\nALL PASS');
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('PACKAGED SMOKE ERROR', e); try { killSmoke(); if (USERDATA.endsWith(SMOKE_NAME)) fs.rmSync(USERDATA, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(2); });
