// 本地文件夹工作区（F06）e2e 真门：CI 用 xvfb 真启动 Electron。
// 强断言锚在真实文件系统（fs.stat），不是 DOM class——F06 done-bar 即规格。
// WS2_FOLDER_IN 测试 seam：让 pickFolder 直接返回 seed 目录（原生目录对话框 e2e 点不了）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

const exists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-fsworkspace-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(path.join(wsDir, '数据'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', 'b.html'), HTML('BBB'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', 'c.png'), 'png', 'utf8');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: {
      ...process.env,
      WS2_USERDATA: path.join(tmp, 'userdata'),
      WS2_NO_CLOSE_DIALOG: '1',
      WS2_FOLDER_IN: wsDir,
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => {
    window.confirm = () => true;
    window.alert = () => {};
  });
});

test.afterEach(async () => {
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('opens a folder → renders the file tree, click .html opens it', async () => {
  await page.click('#home-open-folder'); // WS2_FOLDER_IN → 返回 wsDir
  // 树列出：数据(文件夹) + a.html + 展开后的 b.html / c.png
  await expect(page.locator('.sb-dir .sb-name', { hasText: '数据' })).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="数据/c.png"]')).toBeVisible();
  // 点 a.html → 进编辑器
  await page.click('.sb-file[data-rel="a.html"]');
  const frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('h1')).toHaveText('AAA');
  // 高亮当前文件
  await expect(page.locator('.sb-file[data-rel="a.html"].is-active')).toBeVisible();
});

test('filter narrows the tree to matching files', async () => {
  await page.click('#home-open-folder');
  await page.fill('#sb-filter-input', 'b.html');
  await expect(page.locator('.sb-file[data-rel="数据/b.html"]')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toHaveCount(0);
  await page.fill('#sb-filter-input', '');
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
});

test('fs ops via IPC truly change disk (new/rename/move/delete+undo)', async () => {
  await page.click('#home-open-folder');

  // 新建文档
  const created = await page.evaluate((html) => window.ws2.wsNewDoc('', '新文档', html), HTML('NEW'));
  expect(created.rel).toBe('新文档.html');
  expect(await exists(path.join(wsDir, '新文档.html'))).toBe(true);

  // 改名（保留扩展名）
  const renamed = await page.evaluate(() => window.ws2.wsRename('新文档.html', '改名后'));
  expect(renamed.rel).toBe('改名后.html');
  expect(await exists(path.join(wsDir, '改名后.html'))).toBe(true);
  expect(await exists(path.join(wsDir, '新文档.html'))).toBe(false);

  // 移动到 数据/
  const moved = await page.evaluate(() => window.ws2.wsMove('改名后.html', '数据'));
  expect(moved.rel).toBe('数据/改名后.html');
  expect(await exists(path.join(wsDir, '数据', '改名后.html'))).toBe(true);
  expect(await exists(path.join(wsDir, '改名后.html'))).toBe(false);

  // 删除 + 撤销
  const del = await page.evaluate(() => window.ws2.wsDelete('a.html'));
  expect(await exists(path.join(wsDir, 'a.html'))).toBe(false);
  await page.evaluate((tok) => window.ws2.wsUndoDelete(tok), del.token);
  expect(await exists(path.join(wsDir, 'a.html'))).toBe(true);
});

test('makeDir creates a real directory on disk', async () => {
  await page.click('#home-open-folder');
  const r = await page.evaluate(() => window.ws2.wsMakeDir('', '素材'));
  expect(r.rel).toBe('素材');
  expect(await exists(path.join(wsDir, '素材'))).toBe(true);
});

// ---- U6/U7/U8 UI 手势真验（驱动已通的 IPC，断言落在真实 fs）----

test('folder hover + → 模板台 → 选模板在该文件夹建文档并打开', async () => {
  await page.click('#home-open-folder');
  const folder = page.locator('.sb-dir', { hasText: '数据' }).first();
  await folder.hover();
  await folder.locator('.sb-add').click();
  await expect(page.locator('.sb-modal')).toBeVisible();
  await page.locator('.sb-card', { hasText: '空文档' }).click();
  await expect.poll(() => exists(path.join(wsDir, '数据', '无标题文档.html'))).toBe(true);
  // 新建后进编辑器
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('无标题文档');
});

test('右键文件 → 重命名 → 改真实文件名', async () => {
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '重命名' }).click();
  const input = page.locator('.sb-rename');
  await input.fill('改名后');
  await input.press('Enter');
  await expect.poll(() => exists(path.join(wsDir, '改名后.html'))).toBe(true);
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
});

test('右键文件 → 删除 → toast 撤销 → 文件回来', async () => {
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  await page.locator('.sb-toast-action', { hasText: '撤销' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(true);
});

test('删除当前打开的文件 → 编辑区回空态、不崩', async () => {
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="a.html"]'); // 打开
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await page.click('.sb-file[data-rel="a.html"]', { button: 'right' });
  await page.locator('.sb-ctx-item', { hasText: '删除' }).click();
  await expect.poll(() => exists(path.join(wsDir, 'a.html'))).toBe(false);
  await expect(page.locator('#home')).toBeVisible(); // 回空态
});

test('Cmd/Ctrl+\\ 收起/展开侧栏', async () => {
  await page.click('#home-open-folder');
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar.is-collapsed')).toBeVisible();
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar.is-collapsed')).toHaveCount(0);
});
