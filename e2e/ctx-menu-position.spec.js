// 侧栏右键菜单定位 e2e 真门 —— Wendi 2026-07-21 视频反馈：右键靠底部的文件时菜单往下展开、被窗口底边裁掉。
//
// 契约（docs/features/workspace-file-tree.md「右键菜单视口感知定位」）：
//   ① 下方放不下 → 翻到点击点上方（菜单底贴点击点），不溢出视口底部
//   ② 右侧放不下 → 翻左，不溢出视口右侧
//   ③ 常规点击 → 贴点击点向下展开，完整在视口内
//   ④ 菜单开着时滚动侧栏 → 菜单关闭（fixed 菜单不跟内容走，飘着会脱离右键那行）
//
// 断言锚在**真实布局位置** offsetLeft/Top/Width/Height（body 在 0,0，offset 即视口坐标）——
// 不用 getBoundingClientRect：它把 ws-pop-in 入场动画的 scale/translateY 也算进去，量到的是动画瞬态、不是落定位置。
// 用合成 contextmenu（显式 clientX/clientY），不用 Playwright 右键（它会自动把元素滚进视口、打乱布局）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const VW = 1280;
const VH = 720;
const MARGIN = 6; // 与实现里的视口边距一致

let app, page, tmp;

async function launch(wsDir) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: VW, height: VH });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}

// 在某文件行上以显式 clientX/clientY 合成右键，返回菜单的真实布局盒（offset*）。
async function openMenuAt(rel, cx, cy) {
  return await page.evaluate(({ rel, cx, cy }) => {
    const m0 = document.getElementById('sb-ctx'); if (m0) m0.remove();
    const row = document.querySelector(`.sb-file[data-rel="${rel}"]`);
    if (!row) throw new Error('没找到行 ' + rel);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    const menu = document.getElementById('sb-ctx');
    if (!menu) return null;
    return { left: menu.offsetLeft, top: menu.offsetTop, w: menu.offsetWidth, h: menu.offsetHeight };
  }, { rel, cx, cy });
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-ctxpos-'));
  const wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  // 一个撑满列表的顶层文件（够右键出菜单即可，不需要真滚到底——用显式 clientY 控制点击点）
  for (let i = 0; i < 40; i++) {
    await fs.writeFile(path.join(wsDir, `f${String(i).padStart(2, '0')}.html`), HTML('F' + i), 'utf8');
  }
  ({ a: app, p: page } = await launch(wsDir));
  await page.click('#home-open-folder');
  await page.waitForSelector('.sb-file[data-rel="f00.html"]');
});

test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('①靠底部右键：菜单翻上、不被视口底边裁掉', async () => {
  const cy = VH - 20; // 点击点贴近视口底部（720-20=700）
  const m = await openMenuAt('f00.html', 150, cy);
  expect(m).not.toBeNull();
  // 核心：菜单完整落在视口内（底边不超过视口高度 - 边距）
  expect(m.top + m.h).toBeLessThanOrEqual(VH - MARGIN + 1);
  expect(m.top).toBeGreaterThanOrEqual(0);
  // 翻上语义：菜单底边贴在点击点（±2px）
  expect(Math.abs(m.top + m.h - cy)).toBeLessThanOrEqual(2);
});

test('②靠右边缘右键：菜单翻左、不溢出视口右侧', async () => {
  const cx = VW - 5; // 贴近右边缘（1275）
  const m = await openMenuAt('f00.html', cx, 300);
  expect(m).not.toBeNull();
  expect(m.left + m.w).toBeLessThanOrEqual(VW - MARGIN + 1);
  expect(m.left).toBeGreaterThanOrEqual(0);
  // 翻左语义：菜单右边贴点击点
  expect(Math.abs(m.left + m.w - cx)).toBeLessThanOrEqual(2);
});

test('③常规右键（视口中部）：贴点击点向下展开、完整在视口内', async () => {
  const cx = 150, cy = 300;
  const m = await openMenuAt('f00.html', cx, cy);
  expect(m).not.toBeNull();
  // 向下展开：左上角贴点击点
  expect(Math.abs(m.left - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(m.top - cy)).toBeLessThanOrEqual(2);
  // 完整在视口内
  expect(m.top + m.h).toBeLessThanOrEqual(VH - MARGIN + 1);
  expect(m.left + m.w).toBeLessThanOrEqual(VW - MARGIN + 1);
});

test('④菜单开着时滚动侧栏 → 菜单关闭（不飘在原地脱离右键那行）', async () => {
  const m = await openMenuAt('f00.html', 150, 300);
  expect(m).not.toBeNull();
  await expect(page.locator('#sb-ctx')).toHaveCount(1);
  // 滚动侧栏内容
  await page.evaluate(() => {
    const b = document.getElementById('sb-body');
    b.scrollTop = 120;
    b.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#sb-ctx')).toHaveCount(0);
});
