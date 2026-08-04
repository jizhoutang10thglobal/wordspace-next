// 维度报告截图探针（不入库）：编号列表 / 无序列表 的改后效果。
// ⚠ 红圈标注必须画在**外层窗口**（往 iframe 里注会让编辑器藏掉手柄、甚至让「+」点击失效——对拍 agent 实证）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'ws2shots');
const CLIP = { x: 180, y: 20, width: 900, height: 380 };
let app, page, frame, tmpDir;

async function launch() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2dim-'));
  app = await electron.launch({ args: ['--no-sandbox', ROOT], env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'ud'), WS2_NO_CLOSE_DIALOG: '1' } });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 860 });
}
async function openDoc(body, head) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title>${head || ''}</head><body>${body}</body></html>`;
  const p = path.join(tmpDir, 'doc-' + Date.now() + '.html');
  await fs.writeFile(p, html, 'utf8');
  await app.evaluate(({ BrowserWindow }, pp) => { BrowserWindow.getAllWindows()[0].webContents.send('open-file', pp); }, p);
  frame = page.frameLocator('#doc-frame');
  await expect(frame.locator('body')).toBeVisible();
  await page.waitForTimeout(450);
}
// 外层窗口画红圈：把 iframe 内坐标换算成窗口坐标
async function markOuter(sel, dx) {
  const box = await page.locator('#doc-frame').boundingBox();
  const r = await page.evaluate((s) => {
    const d = document.getElementById('doc-frame').contentDocument;
    const el = d.querySelector(s); if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, h: b.height };
  }, sel);
  if (!r) return;
  await page.evaluate(({ x, y }) => {
    const m = document.createElement('div');
    m.id = '__probe_cursor';
    m.setAttribute('style', `position:fixed;left:${Math.round(x - 9)}px;top:${Math.round(y - 9)}px;width:18px;height:18px;border:3px solid #E5484D;border-radius:50%;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 2px rgba(255,255,255,.85)`);
    document.body.appendChild(m);
  }, { x: box.x + r.x + (dx || 130), y: box.y + r.y + r.h / 2 });
}
const unmarkOuter = () => page.evaluate(() => { const m = document.getElementById('__probe_cursor'); if (m) m.remove(); });
const shot = async (name) => { await page.waitForTimeout(220); await page.screenshot({ path: path.join(SHOTS, name), clip: CLIP }); await unmarkOuter(); };

const OL_NEST = '<ol id="L1"><li>一级项目<ol id="L2"><li>二级项目<ol id="L3"><li>三级项目</li></ol></li></ol></li></ol>';
const UL_NEST = '<ul id="B1"><li>一级项目<ul id="B2"><li>二级项目<ul id="B3"><li>三级项目</li></ul></li></ul></li></ul>';
const OLD_BASELINE = '<style id="ws-schema-baseline" data-ws-schema-css="baseline">:where(body){max-width:820px;margin:0 auto;padding:48px 60px;font-family:-apple-system,"PingFang SC",sans-serif;font-size:16px;line-height:1.75;color:#37352f}:where(ul,ol){margin:.5em 0;padding-left:1.7em}:where(li){margin:.3em 0}</style>';

test.beforeAll(async () => { await fs.mkdir(SHOTS, { recursive: true }); });
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
  app = null; page = null; frame = null;
});

test('嵌套 marker：改后（编号 + 圆点）', async () => {
  await launch();
  await openDoc(OL_NEST + UL_NEST);
  await shot('dim-markers-after.png');
});

test('嵌套 marker：改前（用旧基线 + 关掉升级路径无法模拟 → 用纯浏览器渲染旧基线字节）', async () => {
  await launch();
  // 直接把旧基线字节渲染进一个 about:blank 窗口式对照：用 iframe srcdoc 不经编辑器 attach
  await openDoc('<p id="x">占位</p>');
  await page.evaluate(({ html }) => {
    const f = document.getElementById('doc-frame');
    const d = f.contentDocument;
    d.open(); d.write(html); d.close();
  }, { html: `<!DOCTYPE html><html><head><meta charset="UTF-8">${OLD_BASELINE}</head><body>${OL_NEST + UL_NEST}</body></html>` });
  await page.waitForTimeout(400);
  await shot('dim-markers-before.png');
});

test('编号列表 start：改后（中间行转正文）', async () => {
  await launch();
  await openDoc('<ol id="L" start="2"><li id="r1">项目甲</li><li id="r2">项目乙</li><li id="r3">项目丙</li></ol>');
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await page.waitForTimeout(200);
  await frame.locator('.ws-blockmenu-item', { hasText: '转为正文' }).first().click();
  await page.waitForTimeout(350);
  await shot('dim-ol-start-after.png');
});

test('行「转为」保住嵌套子项：改后', async () => {
  await launch();
  await openDoc('<ul id="L"><li id="a">一级 A</li><li id="b">一级 B<ul id="S"><li>二级 B1</li><li>二级 B2</li></ul></li><li id="c">一级 C</li></ul>');
  await frame.locator('#b').hover({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await page.waitForTimeout(200);
  await frame.locator('.ws-blockmenu-item', { hasText: '转为正文' }).first().click();
  await page.waitForTimeout(350);
  await shot('dim-turninto-keepchildren-after.png');
});

test('菜单头标注：待办 / 编号 / 圆点', async () => {
  await launch();
  await openDoc('<ol id="O"><li id="o1">编号一</li><li id="o2">编号二</li></ol>');
  await frame.locator('#o2').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-grip').click();
  await page.waitForTimeout(250);
  await shot('dim-menu-head-ol.png');
});

test('gutter「+」方案 A 在编号列表上的效果', async () => {
  await launch();
  await openDoc('<ol id="L"><li id="r1">项目甲</li><li id="r2">项目乙</li><li id="r3">项目丙</li></ol>');
  await frame.locator('#r2').hover();
  await page.waitForTimeout(150);
  await frame.locator('.ws-plus').click();
  await page.waitForTimeout(250);
  await page.keyboard.type('插进来的正文块');
  await page.waitForTimeout(200);
  await shot('dim-ol-plus-after.png');
  console.log('DIM SHOTS DONE');
});
