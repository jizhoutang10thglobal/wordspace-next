// 一次性调试：确认外层窗口红圈标注到底画没画出来（哑探针排查）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2b2shots');

test('marker debug', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2dbg-'));
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 900 });
  const p = path.join(tmpDir, 'd.html');
  await fs.writeFile(p, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p id="s">哨兵</p><table class="ws-table"><thead><tr><th scope="col">列一</th></tr></thead><tbody><tr id="tr1"><td id="c11">甲一</td></tr></tbody></table></body></html>', 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  await expect(page.frameLocator('#doc-frame').locator('#s')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(400);

  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate(() => {
    const d = document.getElementById('doc-frame').contentDocument;
    const b = d.querySelector('#c11').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const pt = { x: box.x + r.x + 20, y: box.y + r.y + r.h / 2 };

  // 画标注并**读回它的实际几何**——只看截图会把「画了但看不见」和「根本没画」混为一谈
  const diag = await page.evaluate(({ x, y }) => {
    const m = document.createElement('div');
    m.id = '__probe_cursor';
    // ⚠ 必须走 CSSOM 逐条 setProperty：app 的 CSP 是 style-src 'self' file:（无 unsafe-inline），
    // setAttribute('style', ...) 会被整条拦掉 → 元素在 DOM 里但零样式 = 哑标注。
    const S = {
      position: 'fixed', left: Math.round(x - 9) + 'px', top: Math.round(y - 9) + 'px',
      width: '18px', height: '18px', border: '3px solid #E5484D', 'border-radius': '50%',
      'z-index': '2147483647', 'pointer-events': 'none', 'box-shadow': '0 0 0 2px rgba(255,255,255,.85)',
      'box-sizing': 'border-box', margin: '0', padding: '0', flex: 'none',
    };
    for (const k in S) m.style.setProperty(k, S[k]);
    document.body.appendChild(m);
    const b = m.getBoundingClientRect();
    const st = getComputedStyle(m);
    return {
      inDom: !!document.getElementById('__probe_cursor'),
      rect: { x: b.x, y: b.y, w: b.width, h: b.height },
      display: st.display, visibility: st.visibility, opacity: st.opacity, zIndex: st.zIndex,
      bodyOverflow: getComputedStyle(document.body).overflow,
      docElOverflow: getComputedStyle(document.documentElement).overflow,
      winSize: { w: innerWidth, h: innerHeight },
    };
  }, pt);
  console.log('MARKER_DIAG=' + JSON.stringify({ box, cellRect: r, pt, diag }));

  await fs.mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'dbg-full.png') }); // 整窗，不裁剪
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
});
