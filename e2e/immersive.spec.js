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

// 沉浸窗框非全屏恒有（Colin 2026-07-18 扩 #271）：展开态也有框。侧栏贴左缘（=左侧 chrome，KD1），
// #main 四周 10px + 三条 drag 带；#main 左 margin=与侧栏的 10px 缝。断言口径=computed margin/边/
// app-region + 几何（不查 class）。变异自检：CSS 里「恒有」选择器改回 .is-sb-collapsed → 本测必红。
test('展开态窗框：非全屏恒有——#main 四周 10px + 三条 drag 带 + 侧栏贴左缘 + 无左热区', async () => {
  await openWorkspace(); // 启动即展开态（未收起）
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  const mm = await page.locator('#main').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { mt: cs.marginTop, mr: cs.marginRight, mb: cs.marginBottom, ml: cs.marginLeft, bw: cs.borderTopWidth, br: parseFloat(cs.borderTopLeftRadius) };
  });
  expect(mm.mt, '上 margin').toBe('10px');
  expect(mm.mr, '右 margin').toBe('10px');
  expect(mm.mb, '下 margin').toBe('10px');
  expect(mm.ml, '左 margin（与侧栏的缝）').toBe('10px');
  expect(mm.bw, '内容纸 1px 边').toBe('1px');
  expect(mm.br, '内容纸圆角').toBeGreaterThan(0);
  // 三条拖拽带展开态也显示且是 drag 区（几何 + 计算属性，不查 class）
  for (const cls of ['win-frame-top', 'win-frame-right', 'win-frame-bottom']) {
    const s = await page.locator('.' + cls).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { disp: getComputedStyle(el).display, drag: getComputedStyle(el).getPropertyValue('-webkit-app-region').trim(), thick: Math.min(r.width, r.height) };
    });
    expect(s.disp, cls + ' 展开态该显示').toBe('block');
    expect(s.drag, cls + ' 不是 drag 区').toBe('drag');
    expect(s.thick, cls + ' 厚度不是 10').toBe(10);
  }
  // 侧栏贴左缘（KD1：侧栏本身=左侧 chrome，不给左带）
  expect(await page.locator('#sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().left)), '侧栏没贴左缘').toBe(0);
  // #main 从侧栏右侧 + 10px 起（左缝）
  const sbW = await page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().width);
  const mx = await page.locator('#main').evaluate((el) => el.getBoundingClientRect().x);
  expect(Math.round(mx - sbW), '#main 左缝不是 10px').toBe(10);
  // 展开态无左热区（edge-hot 只收起态）
  await expect(page.locator('#sb-edge-hot')).toBeHidden();
});

// 融合（Wendi 2026-07-21「边框和左侧边栏的融合…还是尴尬」→ Arc 图层模型：侧栏=窗框 chrome 表面
// 的一部分,不是独立面板）：侧栏底色==body 窗框底色（同一块表面）+ 非透明（防 CSS 全废两个都
// transparent 的假绿）+ 无右边线；真全屏（摘框摘缝）补回 1px 分界线。变异自检：侧栏底改回
// sunken → 同色断言红；融合 CSS 整段删 → 非透明断言红；全屏补线删 → 全屏断言红。
test('融合：侧栏底=窗框同色（一块 chrome 表面）、无右边线；全屏态补 1px 分界', async () => {
  await openWorkspace();
  const probe = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.background = 'var(--c-bg-chrome)';
    document.body.appendChild(d);
    const chrome = getComputedStyle(d).backgroundColor;
    d.remove();
    const sb = getComputedStyle(document.getElementById('sidebar'));
    return { chrome, sbBg: sb.backgroundColor, sbBorderR: sb.borderRightWidth, bodyBg: getComputedStyle(document.body).backgroundColor };
  });
  expect(probe.sbBg, '侧栏底该非透明（CSS 全废假绿探针）').not.toMatch(/^rgba\(0, 0, 0, 0\)$|^transparent$/);
  expect(probe.sbBg, '侧栏底≠body 窗框底（两块表面，融合破了）').toBe(probe.bodyBg);
  expect(probe.sbBg, '侧栏底≠chrome 色（改回 sunken？）').toBe(probe.chrome);
  expect(probe.sbBorderR, '侧栏右边线该删（分界交给内容纸的边）').toBe('0px');
  // 真全屏：摘框摘缝后侧栏与内容直接相邻 → 补回 1px 分界线
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('enter-full-screen'));
  await expect(page.locator('body')).toHaveClass(/is-win-fullscreen/, { timeout: 3000 });
  expect(await page.locator('#sidebar').evaluate((el) => getComputedStyle(el).borderRightWidth), '全屏态该补 1px 分界线').toBe('1px');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('leave-full-screen'));
  await expect(page.locator('body')).not.toHaveClass(/is-win-fullscreen/, { timeout: 3000 });
  expect(await page.locator('#sidebar').evaluate((el) => getComputedStyle(el).borderRightWidth), '退全屏该回无线').toBe('0px');
});

// toggle 两形态（Colin 2026-07-21「收起后不知道哪个钮是恢复」）：展开态=「收起」形态（左箭头），
// 收起/peek 态=「展开」形态（右箭头），tooltip 同步切。变异自检：CSS 切换规则删 → 收起态断言红；
// setSidebarCollapsed 的 title 切换删 → tooltip 断言红。
test('toggle 两形态：展开显「收起」、收起/peek 显「展开」（图标+tooltip 都切）', async () => {
  await openWorkspace();
  const shapes = () => page.evaluate(() => ({
    close: getComputedStyle(document.querySelector('#sb-toggle .sb-tgl-close')).display,
    open: getComputedStyle(document.querySelector('#sb-toggle .sb-tgl-open')).display,
    title: document.getElementById('sb-toggle').title,
  }));
  let s = await shapes();
  expect(s.close, '展开态该显「收起」形态').not.toBe('none');
  expect(s.open, '展开态不该显「展开」形态').toBe('none');
  expect(s.title, '展开态 tooltip 该是收起').toContain('收起');
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  s = await shapes();
  expect(s.close, '收起态不该显「收起」形态').toBe('none');
  expect(s.open, '收起态该显「展开」形态').not.toBe('none');
  expect(s.title, '收起态 tooltip 该是展开').toContain('展开');
  // peek 浮卡里钮真可见且是「展开」形态（用户在浮卡里认恢复钮的现场）
  await hoverUntilPeek(3, 430);
  await expect(page.locator('#sb-toggle .sb-tgl-open')).toBeVisible();
  // peek 里点 toggle = 真展开 → 回「收起」形态
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  s = await shapes();
  expect(s.close, '展开后该回「收起」形态').not.toBe('none');
  expect(s.title, '展开后 tooltip 该回收起').toContain('收起');
});

test('展开态：侧栏图标钮顶边归钮不归拖拽条（顶 ~4px 可点，Colin 2026-07-18）', async () => {
  await openWorkspace(); // 展开态：窗框顶带横跨全宽、盖住侧栏头图标钮顶部
  // 在「钮 与 顶带」的重叠区打一个 elementFromPoint（钮顶 y≈6、顶带 0..10 → 取钮顶 +2px 落进重叠带）。
  // 顶带 .win-frame-top(z235,fixed,drag) 若在钮之上 → 命中 frame、那几 px 变 drag 吞点击；
  // .sb-head 抬到 z236 后 no-drag 钮赢 → 命中钮。真实层叠判定（elementFromPoint），不查 class。
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('.sb-head .sb-icobtn');
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const topY = Math.round(r.top + 2);
    const el = document.elementFromPoint(cx, topY);
    return {
      btnTop: Math.round(r.top),
      hitsFrame: !!(el && el.closest('.win-frame')),
      hitsButton: !!(el && el.closest('.sb-head .sb-icobtn')),
    };
  });
  expect(hit.btnTop, '钮顶应落在顶带(0..10)内，否则本测试无意义').toBeLessThan(10);
  expect(hit.hitsFrame, '钮顶被窗框拖拽条盖住 → 那几 px 吞点击').toBe(false);
  expect(hit.hitsButton, '钮顶未命中按钮本身').toBe(true);
});

// 全屏无框：真全屏（macOS enter-full-screen / F11）两态都摘框。用 win.emit 确定性驱动主进程真实 handler
// （真 setFullScreen 在 mac 会强占屏/Space 动画、xvfb CI 事件不可靠；emit 走完全相同的 send→挂类→CSS 链，
// 摘掉 handler/preload channel/renderer 监听任一环此测即红——变异自检据此翻红）。真 OS 事件→handler 链宿主眼验兜。
test('全屏无框：进全屏 → #main 摘 margin/边、三条带全隐；退全屏恢复', async () => {
  await openWorkspace();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('enter-full-screen'));
  await expect(page.locator('body')).toHaveClass(/is-win-fullscreen/, { timeout: 3000 });
  const mm = await page.locator('#main').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { ml: cs.marginLeft, mt: cs.marginTop, bw: cs.borderTopWidth };
  });
  expect(mm.ml, '全屏左 margin 该 0').toBe('0px');
  expect(mm.mt, '全屏上 margin 该 0').toBe('0px');
  expect(parseFloat(mm.bw), '全屏内容边该 0').toBe(0);
  for (const cls of ['win-frame-top', 'win-frame-right', 'win-frame-bottom']) {
    expect(await page.locator('.' + cls).evaluate((el) => getComputedStyle(el).display), cls + ' 全屏该隐').toBe('none');
  }
  // 退全屏 → 框恢复
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('leave-full-screen'));
  await expect(page.locator('body')).not.toHaveClass(/is-win-fullscreen/, { timeout: 3000 });
  expect(await page.locator('#main').evaluate((el) => getComputedStyle(el).marginTop), '退全屏 margin 该恢复 10').toBe('10px');
});

// 全屏 + 收起：peek 重开路不能被全屏堵——edge-hot 仍在、hover 仍能触发 peek（收起态特有）。
test('全屏 + 收起：edge-hot 仍在、peek 仍能触发（重开路不堵）', async () => {
  await openWorkspace();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('enter-full-screen'));
  await expect(page.locator('body')).toHaveClass(/is-win-fullscreen/, { timeout: 3000 });
  // edge-hot 仍显示（peek 触发锚点，全屏收起态保留）
  await expect(page.locator('#sb-edge-hot')).toBeVisible();
  expect(Math.round((await page.locator('#sb-edge-hot').boundingBox()).width)).toBe(10);
  // peek 仍能触发（hover 左缘 → 悬浮侧栏滑出）
  await hoverUntilPeek(3, 430);
  expect(await page.evaluate(() => document.body.classList.contains('is-sb-peek'))).toBe(true);
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

// 光标轮询触发(Wendi 2026-07-22「必须精确停在缝上」→ Arc 式宽容,主进程 ws-edge-watch 轮询 +
// renderer onEdgeHover 接线)。轮询几何在 node:test(edge-zones.test.js);这里测 renderer 接线:
// 主进程发 ws-edge-hover(trigger,dwell) → peek 开/收。xvfb 全局光标不动、watcher 被 arming 拦住
// (防 (0,0) 常驻误触发),所以用 IPC 直发驱动——与真轮询到达 renderer 的通道一字不差。
// 变异自检:删 sidebar.js 的 onEdgeHover 接线 → 本测必红;删 ipc.js 的 arming → 其他收起态测试炸。
// ⚠ 宿主已知敏感:操作者物理光标若恰悬在测试窗口侧栏区,真实 mouseenter 会清掉关卡计时器 → 「收回」
// 断言偶发红(与 hoverUntilPeek 注释同款干扰)。CI(xvfb 无真人)确定;宿主中招挪开鼠标重跑即过。
test('光标轮询接线：ws-edge-hover(trigger) 开 peek、(!dwell) 宽限收回（Arc 式触发通道）', async () => {
  await openWorkspace();
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  // 关掉真 watcher 再 IPC 驱动:宿主跑测试时真人光标一动就 arm 真轮询,它按真实光标发信号、
  // 与本测的合成序列互相覆盖(实翻过:peek 关不掉)。CI xvfb 光标不动、armed 永假,本无此扰。
  await page.evaluate(() => window.ws2.edgeWatch(false));
  // trigger=true → 首拍即开(不需要 DOM hover、不需要 120ms 停留)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ws-edge-hover', true, true));
  await expect(page.locator('body')).toHaveClass(/is-sb-peek/, { timeout: 2000 });
  // dwell=false → 240ms 宽限 + 320ms 滑出后收回
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ws-edge-hover', false, false));
  await expect(page.locator('body')).not.toHaveClass(/is-sb-peek/, { timeout: 2500 });
  // 展开态收到 trigger 不该开 peek(接线里有 is-collapsed 守卫)
  await page.click('#sb-edge-hot').catch(() => {}); // 收起态下先重开侧栏:直接走快捷键
  await page.keyboard.press('Control+\\');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-collapsed/);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ws-edge-hover', true, true));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.body.classList.contains('is-sb-peek')), '展开态不该被 trigger 开 peek').toBe(false);
});

// peek 浮卡 DOM 假红绿灯(Wendi 2026-07-22「把这3个按钮放到卡片上」):mac 专属分支用 WS2_FAKE_MAC
// seam 在 linux CI 上强挂 is-mac 测(原生灯 CI 摸不到,假灯是 DOM 摸得到)。断言:收起前隐、peek 现
// (随卡=display 由 is-sb-peek 驱动)、三颗齐、点最小化真最小化(IPC 全链路)。
test('peek 假红绿灯：peek 现/收起前隐、三颗齐、点最小化走真窗控（WS2_FAKE_MAC seam）', async () => {
  // 换带 seam 的实例(beforeEach 起的默认实例没有 fakeMac)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  ({ a: app, p: page } = await launch({ WS2_USERDATA: path.join(tmp, 'ud-fakemac'), WS2_FOLDER_IN: wsDir, WS2_FAKE_MAC: '1' }));
  await openWorkspace();
  // 展开态:假灯必须隐藏(display none——它只属于 peek 卡)
  expect(await page.locator('#sb-fakelights').evaluate((el) => getComputedStyle(el).display), '展开态假灯该隐').toBe('none');
  await page.click('#sb-toggle');
  await expect(page.locator('#sidebar')).toHaveClass(/is-collapsed/);
  await page.evaluate(() => window.ws2.edgeWatch(false)); // 同上:宿主真人光标会经真 watcher 干扰 DOM 开出的 peek
  await hoverUntilPeek(3, 430);
  await page.waitForTimeout(380); // 滑入落定
  // peek 态:假灯可见、三颗齐、在卡内(x ∈ 卡左缘 10..70 让位区)
  await expect(page.locator('#sb-fakelights')).toBeVisible();
  await expect(page.locator('.sb-fl')).toHaveCount(3);
  const fl = await page.locator('#sb-fakelights').boundingBox();
  expect(fl.x, '假灯该在卡内让位区').toBeGreaterThan(10);
  expect(fl.x + fl.width, '假灯不该越过 70px 让位区').toBeLessThan(10 + 70);
  // 假灯点击链路:主进程挂记录探针验「ws-win-ctl 真到达」。不断言窗控实效——CI 两头都验不动:
  // minimize/fullscreen 是 WM 功能(xvfb 无 WM 永 no-op,CI 实翻过);close 在 linux 会销毁唯一窗口
  // → app 进程退出 → 后续 evaluate 全崩(CI 也实翻过)。实效(真最小化/真全屏)宿主人工验过(Colin 07-22)。
  await app.evaluate(({ ipcMain }) => { global.__flCtl = null; ipcMain.on('ws-win-ctl', (_e, a) => { global.__flCtl = a; }); });
  await page.locator('.sb-fl-min').click();
  await expect.poll(() => app.evaluate(() => global.__flCtl), { timeout: 3000 }).toBe('minimize');
});
