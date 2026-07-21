// 文件树高亮跟随激活标签（always linked）真门。Wendi 2026-07-20：设为默认浏览器后从外部点链接
// 开网页标签，标签区选中网页，但文件树还高亮着跳转前的旧文件。契约（Jizhou 收口 / Wendi 确认）：
// **右边渲染区显示什么，左边侧栏就定位什么**——网页/临时/起始页无高亮，文档/查看器/收编进树的外部
// 文件亮其行。判定源 = 激活标签（不再读 shell 的 docPath：web 态它留旧文档、viewer 态它是 null）。
const { test, expect, _electron: electron } = require('@playwright/test');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir, server, base;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><title>外部网页</title></head><body><h1>WEB</h1></body></html>');
    });
    server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); });
  });
}

async function seed(dir) {
  await fs.mkdir(path.join(dir, '数据'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  await fs.writeFile(path.join(dir, '数据', 'c.png'), 'png', 'utf8'); // 查看器文件（非 html/md）
}

async function launch(env) {
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
}

test.beforeAll(startServer);
test.afterAll(() => { if (server) server.close(); });
test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-treehl-'));
  wsDir = path.join(tmp, 'ws');
  await seed(wsDir);
  await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir });
});
test.afterEach(async () => {
  if (!app) return;
  // 有未保存临时文档时主进程关窗守卫会卡住 app.close() → 先 destroy 强制关（纯测试收尾，同 tabs.spec）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = null;
});

const fileRow = (rel) => page.locator(`.sb-file[data-rel="${rel}"]`);
const tabRow = (rel) => page.locator(`#sb-tabs .sb-tab[data-rel="${rel}"]`);
const activeFiles = () => page.locator('.sb-file.is-active');
const emitOpenUrl = (u) => app.evaluate(({ app: a }, url) => a.emit('open-url', { preventDefault() {} }, url), u);
const stubPick = (p) => app.evaluate(({ dialog }, ap) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [ap] }); }, p);

async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(fileRow('a.html')).toBeVisible();
}
async function openWebViaModal(url) { // ⌘T modal 地址栏开网页（app 内主路径）
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'new-tab'));
  const omni = page.locator('.sb-cm-omni-input');
  await expect(omni).toBeVisible();
  await omni.fill(url);
  await omni.press('Enter');
}

test('外部链接开网页标签后，文件树不再高亮旧文件；切回文档标签高亮恢复（Wendi 2026-07-20 bug）', async () => {
  await openWorkspace();
  await fileRow('a.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(fileRow('a.html')).toHaveClass(/is-active/); // 文档态：树定位该文件

  // 外部链接进来（= 设为默认浏览器后点任意链接走的同一条 open-url IPC）→ 网页标签激活
  await emitOpenUrl(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveClass(/is-active/); // 标签区：选中网页 ✓
  await expect(activeFiles()).toHaveCount(0); // ★ 树里不许有 is-active（修前此处红：a.html 残留高亮）

  // always linked 双向：切回文档标签 → 该文档树行高亮恢复
  await tabRow('a.html').click();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
});

test('app 内开网页标签（omnibox）同样清空树高亮', async () => {
  await openWorkspace();
  await fileRow('a.html').click();
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
  await openWebViaModal(base + '/');
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-web')).toHaveClass(/is-active/);
  await expect(activeFiles()).toHaveCount(0);
});

test('键盘切标签（Ctrl+Tab / ⌘1-9）从网页切回文档 → 高亮恢复（独立于点击路径）', async () => {
  await openWorkspace();
  await fileRow('a.html').click();
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
  await emitOpenUrl(base + '/');
  await expect(activeFiles()).toHaveCount(0);
  // 键盘循环回文档标签（reveal=false 路径，与点标签的 'expand' 路径不同）
  await page.evaluate(() => window.__sbHooks.tabByIndex(1));
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
});

test('查看器（PDF/图片）标签激活期间，树重渲染不丢高亮（docPath=null 镜像 bug）', async () => {
  await openWorkspace();
  await page.click('.sb-row.sb-dir[data-rel="数据"]'); // 展开子文件夹
  await fileRow('数据/c.png').click();
  await expect(page.locator('#viewer .fv-bar')).toBeVisible(); // 查看器出来了
  await expect(fileRow('数据/c.png')).toHaveClass(/is-active/);
  // 触发一次树重渲染（确定性：筛选到匹配词，行仍在）——修前此处红：afterRender 用 null 冲掉高亮
  await page.fill('#sb-filter-input', 'c.png');
  await expect(fileRow('数据/c.png')).toBeVisible();
  await expect(fileRow('数据/c.png')).toHaveClass(/is-active/);
  await page.fill('#sb-filter-input', ''); // 清筛选 → 再次全量重渲染
  await expect(fileRow('数据/c.png')).toHaveClass(/is-active/);
});

test('临时文档标签激活 → 树无高亮（activeRel 跟随修复；不修则旧文档行残留）', async () => {
  await openWorkspace();
  await fileRow('a.html').click();
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
  await page.locator('#sb-tabs .sb-zone-add').click(); // 「+」→ 模板台
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect(page.locator('#sb-tabs .sb-tab.sb-tab-temp')).toHaveClass(/is-active/);
  await expect(activeFiles()).toHaveCount(0);
});

test('关闭全部标签回起始页 → 树无高亮', async () => {
  await openWorkspace();
  await fileRow('a.html').click();
  await expect(fileRow('a.html')).toHaveClass(/is-active/);
  await tabRow('a.html').locator('.sb-tab-close').click();
  await expect(activeFiles()).toHaveCount(0);
});

test('外部文件收编进树后其行高亮（abs entry 不许硬判无高亮；收编窗口 always linked）', async () => {
  await openWorkspace();
  const dir2 = path.join(tmp, '第二文件夹');
  await fs.mkdir(dir2, { recursive: true });
  const inside = path.join(dir2, 'x.html');
  await fs.writeFile(inside, HTML('XX'), 'utf8');
  await stubPick(inside);
  await page.click('#doc-menu-btn');
  await page.click('#open-btn');
  await expect(page.locator(`#sb-tabs .sb-tab[data-rel="${inside}"]`)).toHaveClass(/sb-tab-ext/);
  await expect(activeFiles()).toHaveCount(0); // 根外：树里无行 → 无高亮
  // 添加其所在文件夹为根 → 标签被收编（abs→rel），树里出现该行
  await app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir2);
  await page.click('#sb-add-root');
  await expect(page.locator('.sb-root-head', { hasText: '第二文件夹' })).toBeVisible();
  await expect(fileRow('x.html')).toHaveClass(/is-active/); // ★ 收编后该行高亮（abs 硬判 null 会漏这条）
});
