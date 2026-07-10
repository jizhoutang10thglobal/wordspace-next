// 真机性能测量 harness：启动 app、打开 1-2 个真实文件夹作根，读诊断探针数字（每根文件数/readTree 耗时/
// watcher 触发/云盘 + 渲染耗时），并验证 Cmd+Shift+D 诊断面板能弹。用来在宿主上量大/云盘文件夹的真实成本
// （容器/CI 量不出，也复现不了用户环境）。用法: node scripts/diag-smoke.js <文件夹A> [文件夹B]
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

const ROOT = path.join(__dirname, '..');
const BIG = process.argv[2];
const SECOND = process.argv[3]; // 可选第二个根
if (!BIG) { console.error('用法: node scripts/diag-smoke.js <文件夹A> [文件夹B]'); process.exit(1); }

(async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-diag-'));
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, WS2_FOLDER_IN: BIG },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });

  const t0 = Date.now();
  await page.click('#home-open-folder');
  await page.locator('.sb-root-head').first().waitFor({ timeout: 30000 });
  console.log(`开 20k 文件夹 → 首根出现: ${Date.now() - t0}ms`);

  // 可选：加第二个根
  if (SECOND) {
    await app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, SECOND);
    const t1 = Date.now();
    await page.click('#sb-add-root');
    await page.waitForFunction(() => document.querySelectorAll('.sb-root-head').length >= 2, { timeout: 60000 });
    console.log(`加第二根 → 两根就位: ${Date.now() - t1}ms`);
  }

  // 展开每个根的第一个文件夹，制造更多可见行 + 触发 renderRoot
  for (const dir of await page.$$('.sb-dir')) {
    try { await dir.click(); await page.waitForTimeout(50); } catch {}
    if ((await page.$$('.sb-row')).length > 800) break; // 够多行就停
  }

  // 普通用户零感知：确认没有自动横幅冒出来
  const banner = await page.evaluate(() => !!document.getElementById('perf-banner'));
  console.log('\n自动横幅是否存在(应为 false=普通用户零感知):', banner);

  // 走菜单入口（__sbHooks.perfDiag）打开隐藏诊断面板
  await page.evaluate(() => window.__sbHooks && window.__sbHooks.perfDiag && window.__sbHooks.perfDiag());
  await page.waitForTimeout(300);
  // 制造一点滚动，长任务观察器应记到（若有卡帧）
  const body = await page.$('#sb-body, .sb-body, #sb-tree');
  if (body) { try { await page.mouse.move(200, 400); await page.mouse.wheel(0, 4000); await page.waitForTimeout(300); } catch {} }
  await page.waitForTimeout(1200); // 等面板刷新一拍
  const panelText = await page.evaluate(() => { const p = document.getElementById('perf-panel'); return p ? p.querySelector('pre').textContent : null; });
  console.log('\n=== 诊断面板文本(菜单「性能诊断…」) ===');
  console.log(panelText || '⚠ 面板没弹出来');
  console.log('\n面板含「长任务」行:', /长任务/.test(panelText || ''), ' 含「内存」行:', /内存/.test(panelText || ''));

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
