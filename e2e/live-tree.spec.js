// 实时文件浏览器 e2e：工作区根被外部（非 app）增删改/改名 → 侧栏树自动跟随 + 标签 reconcile。
// 直接用 fs 改磁盘（绕过 app 的 IPC），靠 workspace-watcher（fs.watch recursive）触发；
// Playwright 的 toBeVisible/toHaveCount 自带轮询重试，等去抖（200ms）+ 重读落地。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const W = 6000; // 等监听落地的宽限（去抖 + 重读 + 重渲染）

let app, page, tmp, wsDir;

async function launch(env) {
  const a = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', ...env } });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}
async function openWorkspace() {
  await page.click('#nt-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}
// 改完磁盘后主动派一次窗口 focus，确定性触发「聚焦兜底刷新」→ onTreeChanged。
// 这样测试不依赖递归 fs.watch 的平台支持（Linux CI 需 Node 20.13+；mac 主机已单独验过真 watch 路径），
// 验的是真正复杂的「重读树 + 标签 reconcile + 编辑器同步」逻辑。
async function nudge() {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-live-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(wsDir, '数据'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('外部新增文件 → 侧栏树自动出现（不用重开）', async () => {
  await openWorkspace();
  await fs.writeFile(path.join(wsDir, 'new-external.html'), HTML('NEW'), 'utf8');
  await nudge();
  await expect(page.locator('.sb-file[data-rel="new-external.html"]')).toBeVisible({ timeout: W });
});

test('外部删除文件 → 侧栏树自动消失', async () => {
  await openWorkspace();
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0, { timeout: W });
});

test('外部在子文件夹里新增 → 展开后能看到（递归监听）', async () => {
  await openWorkspace();
  await page.locator('.sb-dir[data-rel="数据"]').click(); // 先展开
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await fs.writeFile(path.join(wsDir, '数据', 'sub-new.html'), HTML('SUB'), 'utf8');
  await nudge();
  await expect(page.locator('.sb-file[data-rel="数据/sub-new.html"]')).toBeVisible({ timeout: W });
});

test('外部改名一个打开的文件 → 树更新 + 标签跟随到新名（inode 匹配）', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 打开 a → 标签
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  await fs.rename(path.join(wsDir, 'a.html'), path.join(wsDir, 'a-renamed.html')); // 外部改名
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a-renamed.html"]')).toBeVisible({ timeout: W }); // 树更新
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a-renamed.html"]')).toBeVisible({ timeout: W }); // 标签跟随
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(0); // 旧标签没了
  await expect(page.locator('#doc-name')).toHaveText('a-renamed.html', { timeout: W }); // 编辑器面包屑也重指向
});

test('外部删除一个打开的文件 → 树更新 + 标签消失', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]');
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
  await fs.rm(path.join(wsDir, 'a.html'));
  await nudge();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0, { timeout: W }); // 树
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toHaveCount(0, { timeout: W }); // 标签
  await expect(page.locator('#web-newtab')).toBeVisible({ timeout: W }); // 唯一打开的文档被删 → 编辑器回空态
});
