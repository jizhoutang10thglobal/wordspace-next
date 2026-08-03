// 浏览器下载 e2e 真门（spec docs/browser-feature-spec.md §4.11）。真开 Electron + WebContentsView +
// 本地 http server，真触发 will-download → 真落盘 WS2_DL_DIR（= os.tmpdir 下 mkdtemp，仓内 + runner
// 家目录零落盘）。强断言纪律（S4）：读真磁盘字节 / 读 wt.downloadsList() / 读 wt._registry / computed
// style——不查 UI 文本存在性（「文本在」测不出「文件真落盘」「记录真持久化」「环真着色」）。
//
// ── 变异自检两探针（先 commit 后变异，铁律；破坏后翻红 + 还原翻绿 才算门有牙）──
//   ① src/main/web-tabs.js will-download 里
//        const name = downloadsLib.uniquify(raw, taken);
//      改成 `const name = raw;`（打掉 uniquify）→ 用例「uniquify：连下两次同名落两文件」翻红
//      （第二次同名下载覆写 evil.bin，`evil (1).bin` 不出现，目录只剩一个文件）。
//   ② src/main/web-tabs.js will-download 首行
//        rollbackUncommittedFor(wc);
//      注释掉（打掉未提交 url 回滚）→ 用例「P4 地址栏敲下载 URL 重启不重下」翻红
//      （navigate 乐观写的 /dl 未被回滚 → 持久化进标签 → 重启懒加载重触发 will-download，记录 +1 = 重下）。
//   ④ src/main/web-tabs.js dlOpen 里
//        if (exists) { try { shell.openPath(e.savePath); } ...
//      打掉 `shell.openPath(e.savePath)` → 用例「「打开」按钮」翻红（stub 记录恒 null，.toContain('evil.bin') 失败）。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DL_BODY = 'WS2-DL-PAYLOAD-8f3a2b\n'; // /dl 的确定性 body：字节完整性强断言的基准（读真磁盘比对）

let app, page, tmpDir, dlDir, server, base;

// 本地测试站：/ 红底页（开 web 标签用）；/dl 立即完成的附件（evil.bin，body=DL_BODY，带 Content-Length）；
// /slowdl 慢发不结束的大附件（big.bin，验取消无残留 / 在途关 app 转 interrupted / 进度环着色）。
function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/dl')) {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="evil.bin"',
          'Content-Length': String(Buffer.byteLength(DL_BODY)),
        });
        res.end(DL_BODY);
      } else if (req.url.startsWith('/slowdl')) {
        // 慢发不结束：先给头 + 一截，之后每 120ms 补一截，直到连接关闭。不给 Content-Length（进度 pct 未知，
        // 但环仍 is-active 着色）。req/res close 时停 interval（否则测试结束后 server 泄漏定时器）。
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="big.bin"' });
        res.write('X'.repeat(256));
        const iv = setInterval(() => { try { res.write('X'.repeat(256)); } catch { clearInterval(iv); } }, 120);
        const stop = () => clearInterval(iv);
        req.on('close', stop); res.on('error', stop); res.on('close', stop);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><head><title>Page A</title></head><body style="background:#c81e1e;color:#fff">'
          + '<h1>AAA page</h1></body></html>');
      }
    });
    server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); });
  });
}

async function launch(extraEnv = {}) {
  tmpDir = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-ud-'));
  dlDir = dlDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    // WS2_DL_DIR = resolveDlDir 的测试 seam（!app.isPackaged 下生效）→ 下载全写 tmpdir，仓内/家目录零落盘。
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_DL_DIR: dlDir, ...extraEnv },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860));
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

// ⌘T modal 地址栏开网页：菜单 new-tab → 地址行输入 → Enter。
async function openWebViaModal(input) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  const omni = page.locator('.sb-cm-omni-input');
  await expect(omni).toBeVisible();
  await omni.fill(input);
  await omni.press('Enter');
}

// 主进程侧读 web-tabs 状态（global.__ws2WebTabs seam：与 main 同一 registry 单例）。
function mainWebTabs(fn, arg) {
  return app.evaluate((electronMod, { fnSrc, arg }) => {
    const wt = globalThis.__ws2WebTabs;
    // eslint-disable-next-line no-eval
    return eval('(' + fnSrc + ')')(wt, arg, electronMod);
  }, { fnSrc: fn.toString(), arg });
}
const dlList = () => mainWebTabs((wt) => wt.downloadsList());
const registryUrl = (key) => mainWebTabs((wt, { key }) => { const r = wt._registry.get(key); return r ? r.url : undefined; }, { key });
const activeWebKey = () => page.evaluate(() => { const e = window.__sbWeb.active(); return e ? e.abs : null; });
const attachedCount = () => app.evaluate(({ BrowserWindow }) => {
  const wt = globalThis.__ws2WebTabs;
  const win = BrowserWindow.getAllWindows()[0];
  let n = 0;
  for (const [, r] of wt._registry) if (win.contentView.children.includes(r.view)) n++;
  return n;
});
const isRed = (p) => !!p && p.r > 150 && p.g < 90 && p.b < 90;
async function viewInfo(key) {
  return app.evaluate(async ({ BrowserWindow }, key) => {
    const wt = globalThis.__ws2WebTabs;
    const win = BrowserWindow.getAllWindows()[0];
    const r = wt._registry.get(key);
    if (!r) return null;
    const attached = win.contentView.children.includes(r.view);
    let pixel = null;
    try {
      const img = await r.view.webContents.capturePage();
      const size = img.getSize();
      const bmp = img.getBitmap();
      const i = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4;
      pixel = { b: bmp[i], g: bmp[i + 1], r: bmp[i + 2] };
    } catch { /* 未渲染完 */ }
    return { attached, pixel };
  }, key);
}
// 开好一个红底 web 标签，等 view 真上屏（后续下载触发点：链接点击语义 = wc.downloadURL，不动 pending，不回滚）。
async function openReadyWebTab() {
  await openWebViaModal(base + '/');
  const key = await activeWebKey();
  await expect.poll(async () => { const v = await viewInfo(key); return !!(v && v.attached && isRed(v.pixel)); }, { timeout: 8000 }).toBe(true);
  return key;
}
// 在活跃 web 标签上触发下载（wc.downloadURL = 链接点击语义，页面已提交 → pending=null → 不回滚）。
async function triggerDownload(url) {
  const key = await activeWebKey();
  await mainWebTabs((wt, { key, url }) => { wt._registry.get(key).view.webContents.downloadURL(url); }, { key, url });
}

test.beforeAll(async () => { await startServer(); });
test.afterAll(async () => { if (server) server.close(); });
test.afterEach(async () => {
  if (app) await app.close().catch(() => {});
  app = null;
  for (const d of [dlDir, tmpDir]) { if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } } }
  dlDir = null; tmpDir = null;
});

test('happy path：网页触发下载 → 落 WS2_DL_DIR 的文件字节 === 服务端 body（读真磁盘，非查 UI）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/dl');
  await expect.poll(async () => (await dlList()).some((e) => e.filename === 'evil.bin' && e.state === 'completed'), { timeout: 8000 }).toBe(true);
  // 强断言：读 tmpdir 里的真实字节，逐字节比对服务端 body（UI 文本「已完成」测不出落盘内容是否完整/正确）。
  const bytes = await fsp.readFile(path.join(dlDir, 'evil.bin'), 'utf8');
  expect(bytes).toBe(DL_BODY);
});

test('uniquify：连下两次同名 → 磁盘落 evil.bin + evil (1).bin 两文件（不覆盖已有）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/dl');
  await expect.poll(() => fs.existsSync(path.join(dlDir, 'evil.bin')), { timeout: 8000 }).toBe(true);
  // 等第一个真完成（落磁盘）后再下第二个——uniquify 查重集含真磁盘名，第二次同名撞 evil.bin → 消歧成 evil (1).bin。
  await expect.poll(async () => (await dlList()).some((e) => e.filename === 'evil.bin' && e.state === 'completed'), { timeout: 8000 }).toBe(true);
  await triggerDownload(base + '/dl');
  await expect.poll(() => fs.existsSync(path.join(dlDir, 'evil (1).bin')), { timeout: 8000 }).toBe(true);
  const names = (await fsp.readdir(dlDir)).sort();
  expect(names).toEqual(['evil (1).bin', 'evil.bin']); // 恰好两个，绝不覆盖
});

test('取消无残留：/slowdl 在途 → dlCancel → canceled + tmpdir 无半截文件（含 .crdownload）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/slowdl');
  await expect.poll(async () => { const l = await dlList(); return l.length >= 1 && l[0].state === 'downloading'; }, { timeout: 8000 }).toBe(true);
  const id = (await dlList())[0].id;
  // 证「取消前确有半截文件在写」→ 之后的「无残留」才不是空断言（手动 poll，不用 expect.poll 免超时抛断测试）。
  let existedBefore = false;
  for (let i = 0; i < 40 && !existedBefore; i++) { existedBefore = fs.existsSync(path.join(dlDir, 'big.bin')); if (!existedBefore) await page.waitForTimeout(100); }
  expect(existedBefore, '取消前应有半截 big.bin 在写').toBe(true);
  await mainWebTabs((wt, { id }) => wt.dlCancel(id), { id });
  await expect.poll(() => dlList().then((l) => { const e = l.find((x) => x.id === id); return e && e.state; }), { timeout: 8000 }).toBe('canceled');
  await page.waitForTimeout(200); // 给 done(cancelled) 回调的 unlink 一点余量
  const residue = (await fsp.readdir(dlDir)).filter((n) => n === 'big.bin' || n.endsWith('.crdownload'));
  expect(residue, `existedBefore=${existedBefore} 残留=${residue.join(',')}`).toEqual([]);
});

test('P4 地址栏敲下载 URL 重启不重下：navigate 到 /dl → registry.url 被回滚(非 /dl) → 重启同 userdata 不新增记录', async () => {
  const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-ud-'));
  const keepDl = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-'));
  tmpDir = keep; dlDir = keepDl;
  await launch();
  // 地址栏 navigate 到下载 URL（navigate 乐观写 pendingUncommittedUrl=/dl；will-download 触发时回滚 r.url）。
  await openWebViaModal(base + '/dl');
  const key = await activeWebKey();
  await expect.poll(async () => (await dlList()).length >= 1, { timeout: 8000 }).toBe(true);
  // 强断言 1：下载记录出现，但标签持久化 url **不是**下载 URL（回滚到 null/上一提交 → 重启不会拿它去导航）。
  expect(await registryUrl(key)).not.toBe(base + '/dl');
  await expect.poll(async () => (await dlList()).some((e) => e.state === 'completed'), { timeout: 8000 }).toBe(true);
  const before = (await dlList()).length;
  expect(before).toBe(1);
  await page.waitForTimeout(600); // store 防抖落盘窗口
  await app.close();
  app = null;

  tmpDir = keep; dlDir = keepDl; // 同一 userdata + 下载目录再启动
  await launch();
  await page.waitForTimeout(1200); // 给「若污染的 url 被懒加载重导航」充分冒头时间
  // 强断言 2：重启后下载记录数不涨（污染的 url 会让会话恢复静默重下 → +1；回滚后 url=起始页 → 零重下）。
  expect((await dlList()).length).toBe(before);
  tmpDir = keep; dlDir = keepDl; // 交给 afterEach 清理
});

test('重启中断：在途关 app → 重启同 userdata → 该条目 state=interrupted（load-sanitize 翻转）', async () => {
  const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-ud-'));
  const keepDl = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2dl-'));
  tmpDir = keep; dlDir = keepDl;
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/slowdl');
  await expect.poll(async () => { const l = await dlList(); return l.length >= 1 && l[0].state === 'downloading'; }, { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(600); // 让在途条目落盘（before-quit flushSync 兜底）
  await app.close(); // 关 app：在途下载中断
  app = null;

  tmpDir = keep; dlDir = keepDl;
  await launch();
  // 强断言：读 downloadsList，那条在途下载已被 load-sanitize 翻成 interrupted（磁盘没有可续的进行中下载）。
  await expect.poll(async () => { const l = await dlList(); return l.length >= 1 && l.every((e) => e.state !== 'downloading') && l.some((e) => e.state === 'interrupted'); }, { timeout: 8000 }).toBe(true);
  tmpDir = keep; dlDir = keepDl;
});

test('popover：锁侧栏宽不覆盖网页(view 不摘) → 逐状态操作(含「打开」) → Esc/veil 关 → 清空只清终态', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/dl');
  await expect.poll(async () => (await dlList()).some((e) => e.state === 'completed'), { timeout: 8000 }).toBe(true);
  // 开 popover（Colin 2026-07-20 改：锁进侧栏宽、**不摘原生 view**——不再进 OVERLAY_SEL）。
  await page.locator('#nav-downloads').click();
  await expect(page.locator('.dlp')).toBeVisible();
  // 强断言 ①：view **仍挂着**（旧行为是摘成 0；根拔 webHideAll 竞态后 popover 不动 view → 恒 1）。
  await expect.poll(() => attachedCount(), { timeout: 4000 }).toBe(1);
  // 强断言 ②：popover 右缘 ≤ 侧栏右缘（锁进侧栏宽）且不越进 #main（网页区）——查真实 getBoundingClientRect。
  const rects = await page.evaluate(() => {
    const dlp = document.querySelector('.dlp').getBoundingClientRect();
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    const main = document.getElementById('main').getBoundingClientRect();
    return { dlpLeft: dlp.left, dlpRight: dlp.right, sbLeft: sb.left, sbRight: sb.right, mainLeft: main.left };
  });
  expect(rects.dlpRight, `popover 右缘=${rects.dlpRight} 应 ≤ 侧栏右缘=${rects.sbRight}`).toBeLessThanOrEqual(rects.sbRight + 1);
  expect(rects.dlpRight, `popover 右缘=${rects.dlpRight} 应不越进 #main 左缘=${rects.mainLeft}（否则盖网页）`).toBeLessThanOrEqual(rects.mainLeft + 1);
  expect(rects.dlpLeft).toBeGreaterThanOrEqual(rects.sbLeft - 1);
  // 逐状态操作（completed）：打开 + 在访达中显示 + 移除；**无**取消（spec §4.11 表 + U-DL「打开」）。查 title 精确匹配 i18n 文案。
  await expect(page.locator('.dl-row')).toHaveCount(1);
  await expect(page.locator('.dl-row .dl-act[title="打开"]')).toBeVisible();
  await expect(page.locator('.dl-row .dl-act[title="在访达中显示"]')).toBeVisible();
  await expect(page.locator('.dl-row .dl-act[title="从记录中移除"]')).toBeVisible();
  await expect(page.locator('.dl-row .dl-act[title="取消"]')).toHaveCount(0);
  // Esc 关。
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlp')).toHaveCount(0);
  await expect.poll(() => attachedCount(), { timeout: 4000 }).toBe(1); // 全程 view 没被动过
  // 重开 → 点侧栏区 veil 关（veil 只收侧栏区 click；网页区在原生 view 之下靠 Esc/图标 toggle）。
  await page.locator('#nav-downloads').click();
  await expect(page.locator('.dlp')).toBeVisible();
  await page.locator('.dlp-veil').click({ position: { x: 5, y: 700 } }); // 侧栏下方空白（远离卡片）
  await expect(page.locator('.dlp')).toHaveCount(0);
  // 注：第三管「再点下载图标关」由 veil 兜底——veil(inset:0,z395)盖住侧栏含下载图标，点图标即命中 veil→关；
  // 故不单独测（veil 已覆盖该区域点击）。navDl 的 toggle handler 仍在（veil 不盖时的防御）。
  // 重开 → 清空：只清终态。当前只有 1 条 completed → 清空后列表空、记录归零。
  await page.locator('#nav-downloads').click();
  await expect(page.locator('.dlp-clear')).toBeVisible();
  await page.locator('.dlp-clear').click();
  await expect(page.locator('.dlp-empty')).toBeVisible();
  await expect.poll(async () => (await dlList()).length, { timeout: 4000 }).toBe(0);
});

test('「打开」按钮（U-DL polish）：completed 行点「打开」→ dlOpen → shell.openPath(savePath)（stub 记录，不真开 GUI）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/dl');
  await expect.poll(async () => (await dlList()).some((e) => e.filename === 'evil.bin' && e.state === 'completed'), { timeout: 8000 }).toBe(true);
  // stub 主进程 shell.openPath：记录被打开路径,绝不真开 GUI。web-tabs 与此处 destructure 的是同一个 electron.shell
  // 对象引用,`shell.openPath(...)` call-time 查方法 → 命中 stub。
  await app.evaluate(({ shell }) => {
    globalThis.__ws2OpenedPath = null;
    shell.openPath = (p) => { globalThis.__ws2OpenedPath = p; return Promise.resolve(''); };
  });
  await page.locator('#nav-downloads').click();
  await expect(page.locator('.dlp')).toBeVisible();
  await page.locator('.dl-row .dl-act[title="打开"]').click();
  // 强断言：点「打开」→ IPC dl-open → dlOpen(existsSync 过) → shell.openPath 收到 completed 文件 savePath。
  // 变异探针④：打掉 web-tabs dlOpen 里的 `shell.openPath(e.savePath)` → 记录恒 null → 本断言翻红。
  await expect.poll(() => app.evaluate(() => globalThis.__ws2OpenedPath), { timeout: 4000 }).toContain('evil.bin');
});

test('进度环：有在途时 .dl-ring-wrap.is-active + .dl-ring-bar 真着色（computed stroke 是 rgb，非 none）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/slowdl');
  // 有在途 → aggregateProgress.active>0 → 环显形 is-active（增量渲染只改 class/dashoffset，不重建）。
  await expect(page.locator('#nav-downloads .dl-ring-wrap')).toHaveClass(/is-active/, { timeout: 8000 });
  // 强断言（S4：查 computed style，不查 class 名）：进度环描边真被 CSS 着色成 accent（rgb），非默认 none。
  // 若 .dl-ring-bar { stroke: var(--c-accent) } 被删/失效 → computed stroke = 'none' → 翻红。
  const stroke = await page.locator('#nav-downloads .dl-ring-bar').evaluate((el) => getComputedStyle(el).stroke);
  expect(stroke).toMatch(/^rgb/);
  expect(stroke).not.toBe('none');
});

test('收起态 toast：侧栏收起下触发下载 → 开始 toast over-web 在视口内可见（boundingBox 兜底反馈）', async () => {
  await launch();
  await openReadyWebTab();
  await page.click('#sb-toggle'); // 收起侧栏（沉浸态）
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await triggerDownload(base + '/dl');
  // 收起态：renderer 从 downloads-changed diff 派生的 dlStarted toast 走 over-web（P6，下载图标看不见时唯一反馈）。
  // dlStarted='正在下载 {name}'，落 #sb-toast-host（over-web = toastOverWeb）。
  const toast = page.locator('#sb-toast-host .sb-toast', { hasText: '正在下载' });
  await expect(toast).toBeVisible({ timeout: 6000 });
  // 强断言：toast 真在视口内（收起态若被挤出屏 = 兜底反馈失效）。
  const box = await toast.boundingBox();
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.w + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 1);
});

test('侧栏开着 toast（U-DL polish）：下载 → 侧栏内 .dl-toast（锁侧栏宽）+ 网页 view 无 72px inset（不顶网页）', async () => {
  await launch();
  const key = await openReadyWebTab();
  const bounds = (k) => app.evaluate(({ BrowserWindow }, k) => {
    const wt = globalThis.__ws2WebTabs;
    const r = wt._registry.get(k);
    return r && r.view ? r.view.getBounds() : null;
  }, k);
  const before = await bounds(key); // 无 inset 基线高度
  await triggerDownload(base + '/dl');
  // 侧栏开着 = 侧栏内紧凑 .dl-toast（非 over-web 的 #sb-toast-host）；showDlPill 只留一条（新的替换旧的）。
  const pill = page.locator('.dl-toast');
  await expect(pill).toBeVisible({ timeout: 6000 });
  await expect(pill).toContainText('下载'); // '正在下载 …' 或 '已下载 …' 都含「下载」
  // 强断言 ①：pill 锁进侧栏宽（右缘 ≤ 侧栏右缘 且不越进 #main）。
  const rects = await page.evaluate(() => {
    const p = document.querySelector('.dl-toast').getBoundingClientRect();
    const sb = document.getElementById('sidebar').getBoundingClientRect();
    const main = document.getElementById('main').getBoundingClientRect();
    return { pr: p.right, sr: sb.right, ml: main.left };
  });
  expect(rects.pr, `pill 右缘=${rects.pr} 应 ≤ 侧栏右缘=${rects.sr}`).toBeLessThanOrEqual(rects.sr + 1);
  expect(rects.pr, `pill 右缘=${rects.pr} 应不越进 #main 左缘=${rects.ml}`).toBeLessThanOrEqual(rects.ml + 1);
  // Colin 2026-07-24：toast 是从下载按钮正下方弹出的小气泡 → 右缘对齐下载按钮右缘（不再顶到侧栏最左压地址栏）。
  const anchorRight = await page.evaluate(() => { const a = document.querySelector('#dl-anchor,[data-dl-anchor]'); return a ? a.getBoundingClientRect().right : null; });
  expect(Math.abs(rects.pr - anchorRight), `pill 右缘=${rects.pr} 应≈下载按钮右缘=${anchorRight}（锚按钮下方）`).toBeLessThanOrEqual(4);
  // 强断言 ②：网页 view **没被顶起 72px**（侧栏开着的小 toast 不调 webToastInset）——高度与下载前一致。
  await page.waitForTimeout(300);
  const after = await bounds(key);
  expect(after && after.height, `view 高度不应因侧栏内 toast 变化（before=${before && before.height} after=${after && after.height}）`).toBe(before && before.height);
});

// ── 以下 4 条 = 五棱镜对抗审查(2026-07-18)confirmed findings 的回归门 ──
// 变异探针③（补前述①②）：src/renderer/browser.js aggregateProgress 退回「只对 state==='downloading' 求和」
//   （删批次 ringBatch 逻辑）→ 用例「进度环不回退」翻红（完成条目被移出分母 → 环从满倒退到空 offset=RING_C）。

test('进度环不回退（对抗审查 P2，spec §4.11「单条先完成环不回退」）：并发中某条完成不缩小分母', async () => {
  await launch();
  await openReadyWebTab();
  // /slowdl 无 Content-Length → sizeBytes=0（对分母贡献 0）；/dl 有 Content-Length → sizeBytes=22。两者同批。
  await triggerDownload(base + '/slowdl'); // 在途
  await triggerDownload(base + '/dl');     // 立即完成
  await expect.poll(async () => { const l = await dlList(); return l.some((e) => e.filename === 'evil.bin' && e.state === 'completed') && l.some((e) => e.state === 'downloading'); }, { timeout: 8000 }).toBe(true);
  await expect(page.locator('#nav-downloads .dl-ring-wrap')).toHaveClass(/is-active/);
  const RING_C = 2 * Math.PI * 8; // = 50.27（与 browser.js RING_C 一致）
  // 修复版：完成的 evil.bin 留在批次(sizeBytes=22)→ pct=min(1,(22+slowRecv)/22)=1 → offset≈0（环满）。
  // 旧 bug(只对 downloading 求和)：evil.bin 移出 → 批次只剩 slow(size 0)→ total=0 → pct=0 → offset=RING_C（环空,倒退）。
  const offset = await page.locator('#nav-downloads .dl-ring-bar').evaluate((el) => parseFloat(el.style.strokeDashoffset || '0'));
  expect(offset, `环 offset=${offset.toFixed(1)}（RING_C=${RING_C.toFixed(1)}）：完成条目应留在批次撑住分母、环不倒退`).toBeLessThan(RING_C * 0.1);
  for (const e of (await dlList()).filter((x) => x.state === 'downloading')) await mainWebTabs((wt, { id }) => wt.dlCancel(id), { id: e.id });
});

test('并发同名 uniquify（对抗审查 P3 门缺口）：两 /slowdl 同时在途 → big.bin + big (1).bin（在途名查重，非只查磁盘）', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/slowdl');
  await triggerDownload(base + '/slowdl');
  await expect.poll(async () => (await dlList()).filter((e) => e.state === 'downloading').length, { timeout: 8000 }).toBe(2);
  const names = (await dlList()).filter((e) => e.state === 'downloading').map((e) => e.filename).sort();
  expect(names).toEqual(['big (1).bin', 'big.bin']); // 第二个撞在途名 → 消歧；否则两个都 big.bin → 互相覆盖=数据损坏
  for (const e of (await dlList())) await mainWebTabs((wt, { id }) => wt.dlCancel(id), { id: e.id });
});

test('fileMissing（对抗审查 P3 门缺口）：完成的下载文件被删 → dlReveal 就地标 fileMissing', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/dl');
  await expect.poll(async () => (await dlList()).some((e) => e.filename === 'evil.bin' && e.state === 'completed'), { timeout: 8000 }).toBe(true);
  const id = (await dlList()).find((e) => e.filename === 'evil.bin').id;
  fs.rmSync(path.join(dlDir, 'evil.bin')); // 用户在访达里删了文件
  const r = await mainWebTabs((wt, { id }) => wt.dlReveal(id), { id }); // reveal 校验磁盘 → 缺失
  expect(r && r.missing).toBe(true);
  expect((await dlList()).find((e) => e.id === id).state).toBe('fileMissing'); // 就地转态,可识别(置灰)
});

test('dlRetry（对抗审查 P3 门缺口）：已取消条目重试 → 新条目置顶重下、老条目不动', async () => {
  await launch();
  await openReadyWebTab();
  await triggerDownload(base + '/slowdl');
  await expect.poll(async () => { const l = await dlList(); return l.length >= 1 && l[0].state === 'downloading'; }, { timeout: 8000 }).toBe(true);
  const id = (await dlList())[0].id;
  await mainWebTabs((wt, { id }) => wt.dlCancel(id), { id });
  await expect.poll(() => dlList().then((l) => { const e = l.find((x) => x.id === id); return e && e.state; }), { timeout: 8000 }).toBe('canceled');
  const beforeLen = (await dlList()).length;
  await mainWebTabs((wt, { id }) => wt.dlRetry(id), { id });
  await expect.poll(async () => (await dlList()).length, { timeout: 8000 }).toBe(beforeLen + 1); // 新条目 +1
  const list = await dlList();
  expect(list.find((x) => x.id === id).state).toBe('canceled'); // 老条目不动（spec:重试=新条目置顶,不是原地复位）
  const fresh = list.find((x) => x.id !== id && x.state === 'downloading');
  expect(fresh && fresh.sourceUrl).toBe(base + '/slowdl'); // 新条目同源重下
  if (fresh) await mainWebTabs((wt, { id }) => wt.dlCancel(id), { id: fresh.id });
});

// U5 右键存图/链接另存的**端到端**门：此前只有 web-context-menu.test.js 单测菜单 builder 产出 save-image/save-link
// 的 id、+ 引擎侧 downloadURL→落盘各自测过,但「executeCtxAction 的 save-image case → wc.downloadURL → 真下载」
// 这条合起来的路径无集成门(U5 新增的 switch case 是唯一没被直接测的下载入口)。这里补上,含防御纵深负例。
test('右键存图端到端（U5）：executeCtxAction save-image → wc.downloadURL → 真落盘（+ 危险 scheme 防御纵深不下载）', async () => {
  await launch();
  const key = await openReadyWebTab();
  // 正例：save-image case 对 http(s) srcURL → downloadURL → will-download → 落盘（读真磁盘字节强断言）。
  await mainWebTabs((wt, { key, url }) => wt.executeCtxAction(key, 'save-image', { url }), { key, url: base + '/dl' });
  await expect.poll(async () => (await dlList()).some((e) => e.filename === 'evil.bin' && e.state === 'completed'), { timeout: 8000 }).toBe(true);
  expect(await fsp.readFile(path.join(dlDir, 'evil.bin'), 'utf8')).toBe(DL_BODY);
  // save-link 同管线：http(s) 链接也走 downloadURL（再下一次 → uniquify 成 evil (1).bin）。
  await mainWebTabs((wt, { key, url }) => wt.executeCtxAction(key, 'save-link', { url }), { key, url: base + '/dl' });
  await expect.poll(() => fs.existsSync(path.join(dlDir, 'evil (1).bin')), { timeout: 8000 }).toBe(true);
  // 防御纵深负例：executeCtxAction 内 isAllowedNavUrl 再校验一道 → 危险 scheme 绝不触发下载（builder 该拦,这里是兜底门）。
  const before = (await dlList()).length;
  await mainWebTabs((wt, { key }) => wt.executeCtxAction(key, 'save-link', { url: 'javascript:alert(1)' }), { key });
  await mainWebTabs((wt, { key }) => wt.executeCtxAction(key, 'save-image', { url: 'file:///etc/passwd' }), { key });
  await page.waitForTimeout(500);
  expect((await dlList()).length, '危险 scheme 不触发下载').toBe(before);
});
