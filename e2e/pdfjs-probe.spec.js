// U1 风险前置探针：验证 PDF.js 6.x（ESM + module worker）在 Electron file:// + 现有 CSP 下能不能加载。
// 通不过 → 整个 PDF.js 方案要换路（legacy build / 调 CSP），先确认再投入做 viewer。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');

test('U1 probe: PDF.js ESM import + module worker 在 Electron file://+CSP 能加载 + 解析最小 PDF', async () => {
  // WS2_USERDATA 隔离：本 spec 曾是全套唯一用默认 userData 的——宿主开着 npm start 时撞单实例锁秒退、必红
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-pdfjs-'));
  const app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_USERDATA: path.join(tmp, 'userdata') } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  const result = await page.evaluate(async () => {
    const out = { importOk: false, workerOk: false, pages: 0, err: null };
    try {
      const pdfjsLib = await import('../../node_modules/pdfjs-dist/build/pdf.min.mjs');
      out.importOk = true;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', window.location.href).href;
      // 最小单页 PDF（空白 300x300）
      const b64 = 'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMzAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MyAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTc4CiUlRU9G';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjsLib.getDocument({ data: bytes }).promise; // 启动 module worker
      out.workerOk = true;
      out.pages = doc.numPages;
    } catch (e) {
      out.err = String((e && e.message) || e);
    }
    return out;
  });
  await app.close();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});

  const cspErrs = errs.filter((e) => /worker|content security|csp|refused|module/i.test(e));
  console.log('=== PDF.js probe 结果:', JSON.stringify(result), '\n=== 相关报错:', cspErrs.join(' | '));
  expect(result.importOk, 'ESM import 失败: ' + result.err + ' | ' + cspErrs.join(';')).toBe(true);
  expect(result.workerOk, 'worker/getDocument 失败: ' + result.err + ' | ' + cspErrs.join(';')).toBe(true);
});
