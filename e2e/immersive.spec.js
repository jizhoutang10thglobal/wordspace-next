// 沉浸收起（Arc 对标，Wendi 2026-07-16）e2e 真门：收起 = 零可见 chrome（无细轨/无 sb-reopen 浮钮/
// 内容贴满 x=0）+ 左缘 hover peek 悬浮侧栏（盖内容不推挤）+ peek 内点 toggle 真展开 + 文档头保留（拍板②）。
// 断言口径 = boundingBox / computed style（老实现「52px 条 + sb-reopen 浮钮」跑这套必翻红，门天然有牙）。
// 网页 view 贴 x=0 那半边在 browser.spec.js（要本地 http 服务器）。spec=docs/features/immersive-collapse.md
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;

let app, page, tmp, wsDir;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  return { a, p };
}
// 可重试 hover（防宿主真实鼠标干扰,见 peek 测试注释）：每轮先移开再进热区,直到 peek 打开
async function hoverUntilPeek(x, y) {
  await expect
    .poll(async () => {
      await page.mouse.move(880, y);
      await page.waitForTimeout(60);
      await page.mouse.move(x, y);
      await page.waitForTimeout(300); // 120ms 触发延迟 + 余量
      return page.evaluate(() => document.body.classList.contains('is-sb-peek'));
    }, { timeout: 10000 })
    .toBe(true);
}

async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-file[data-rel="a.html"]')).toBeVisible();
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-immersive-'));
  wsDir = path.join(tmp, 'workspace');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'userdata'), WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('收起 = 零可见 chrome：宽 0、无 sb-reopen、热区就位、内容贴 x=0、文档头保留', async () => {
  await openWorkspace();
  await page.click('.sb-file[data-rel="a.html"]'); // 开文档（拍板②要验文档头保留）
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  expect(await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(5);
  // 常驻浮钮已删——连元素都不存在（纯 Arc 式拍板）
  expect(await page.locator('#sb-reopen').count()).toBe(0);
  // 左缘热区只在收起态可命中，宽=沉浸窗框 10px（触发锚点可见化，Wendi 2026-07-17）
  await expect(page.locator('#sb-edge-hot')).toBeVisible();
  expect(Math.round((await page.locator('#sb-edge-hot').boundingBox()).width)).toBe(10);
  // 沉浸窗框：内容区四周内缩 10px（原「贴 x=0 零缝隙」拍板已被 Wendi 边框反馈取代）
  const m = await page.locator('#main').boundingBox();
  const vp = page.viewportSize();
  expect(Math.round(m.x)).toBe(10);
  expect(Math.round(m.y)).toBe(10);
  expect(Math.round(vp.width - (m.x + m.width))).toBe(10);
  expect(Math.round(vp.height - (m.y + m.height))).toBe(10);
  // 三条拖拽带真是 drag 区（收起态窗口的唯一拖动手柄；几何断言+计算属性，不查 class）
  for (const cls of ['win-frame-top', 'win-frame-right', 'win-frame-bottom']) {
    const s = await page.locator('.' + cls).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, drag: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim(), disp: getComputedStyle(el).display };
    });
    expect(s.disp, cls + ' 收起态该显示').toBe('block');
    expect(s.drag, cls + ' 不是 drag 区').toBe('drag');
    expect(Math.min(s.w, s.h), cls + ' 厚度不是 10').toBe(10);
  }
  // 左边带不许是 drag 区（drag 吞鼠标事件会哑掉 peek 触发）
  expect(await page.locator('#sb-edge-hot').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim())).not.toBe('drag');
  // 文档头保留（沉浸范围拍板：网页全隐、文档留头）
  const header = await page.locator('.ws-doc-header').evaluate((el) => ({
    h: el.getBoundingClientRect().height, vis: getComputedStyle(el).visibility, disp: getComputedStyle(el).display,
  }));
  expect(header.disp).not.toBe('none');
  expect(header.vis).toBe('visible');
  expect(header.h).toBeGreaterThan(30);
});

test('左缘 hover peek：滑出悬浮侧栏（盖内容不推挤）→ 移开收回 → peek 内点 toggle 真展开', async () => {
  await openWorkspace();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);

  // hover 左缘 → peek 滑出（120ms 触发 + 320ms 动画）。hover 写成可重试轮询：宿主上操作者的
  // 真实鼠标若恰在窗口内,真实 mousemove 会与 CDP 合成指针混流、给热区注入幽灵 mouseleave 清掉
  // 开启定时器（__pdlog 实测定位）——重试一轮即恢复;CI(xvfb 无真人)不受影响,门语义不变。
  await hoverUntilPeek(3, 430);
  await page.waitForTimeout(380); // 等滑入动画走完再量
  const sb = await page.locator('#sidebar').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), pos: getComputedStyle(el).position };
  });
  expect(sb.pos).toBe('fixed'); // 悬浮层，不在流内
  expect(sb.x).toBe(10); // 贴沉浸窗框内侧（Arc 浮层形态）
  expect(sb.w).toBeGreaterThan(180);
  // 不推挤：内容区纹丝不动（peek 是覆盖不是挤占；沉浸窗框下停靠位 = x:10）
  expect(Math.round((await page.locator('#main').boundingBox()).x)).toBe(10);

  // 移开 → 收回（240ms 缓冲 + 320ms 滑出）
  await page.mouse.move(900, 430);
  await expect(page.locator('body')).not.toHaveClass(/is-sb-peek/, { timeout: 2500 });
  expect(await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(5);

  // 再 hover 出 peek，点 toggle = 真展开回停靠
  await hoverUntilPeek(2, 430);
  await page.waitForTimeout(380);
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('body')).not.toHaveClass(/is-sb-peek/);
  expect(await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(100);
  // 展开后热区退场（display:none → 不可见）
  await expect(page.locator('#sb-edge-hot')).toBeHidden();
});

test('Cmd/Ctrl+\\ 主层 fallback 仍工作（收起↔展开，浮钮删了快捷键不能跟着哑）', async () => {
  await openWorkspace();
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
});
