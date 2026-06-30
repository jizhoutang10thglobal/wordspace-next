// PDF.js viewer e2e（Wendi B7/B8）：点开 PDF → PDF.js 渲染 canvas 连续滚动 + 一行工具栏（页码/缩放/适应宽度）+
// 没有 Chromium 内置 iframe（旧 pdfv-frame）。宿主真启 Electron。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');

// 最小单页 PDF（空白 300x300，跟 U1 probe 同一个）
const PDF_B64 = 'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMzAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MyAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTc4CiUlRU9G';

let app, page, tmp, wsDir;
test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-pdf-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), '<!doctype html><html><body><h1>A</h1></body></html>', 'utf8');
  await fs.writeFile(path.join(wsDir, 'test.pdf'), Buffer.from(PDF_B64, 'base64'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_USERDATA: path.join(tmp, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_FOLDER_IN: wsDir } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
});
test.afterEach(async () => { await app.close().catch(() => {}); await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); });

test('PDF.js viewer：canvas 渲染 + 一行工具栏（页码/缩放/适应宽度）+ 无 Chromium iframe', async () => {
  await page.click('#home-open-folder');
  await expect(page.locator('.sb-file[data-rel="test.pdf"]')).toBeVisible();
  await page.click('.sb-file[data-rel="test.pdf"]');
  // PDF.js 渲染出 canvas（连续滚动舞台里）
  await expect(page.locator('.pdfv-stage canvas.pdfv-page')).toHaveCount(1, { timeout: 12000 });
  // 一行工具栏：页码 1/1 + 缩放 −/＋ 两个按钮 + 适应宽度
  await expect(page.locator('.pdfv-pageinfo')).toHaveText(/1 \/ 1/);
  await expect(page.locator('.pdfv-zbtn')).toHaveCount(2);
  await expect(page.locator('.pdfv-fit')).toBeVisible();
  // B7/B8：没有 Chromium 内置 iframe viewer（旧 pdfv-frame 已删）
  await expect(page.locator('.pdfv-frame')).toHaveCount(0);
  await expect(page.locator('iframe.pdfv-frame')).toHaveCount(0);
});

test('PDF.js viewer：放大按钮改变缩放比', async () => {
  await page.click('#home-open-folder');
  await page.click('.sb-file[data-rel="test.pdf"]');
  await expect(page.locator('.pdfv-stage canvas.pdfv-page')).toHaveCount(1, { timeout: 12000 });
  const z0 = await page.locator('.pdfv-zlabel').textContent();
  await page.locator('.pdfv-zbtn').nth(1).click(); // ＋
  await page.waitForTimeout(200);
  const z1 = await page.locator('.pdfv-zlabel').textContent();
  expect(parseInt(z1, 10), '放大后缩放比没变大').toBeGreaterThan(parseInt(z0, 10));
});
