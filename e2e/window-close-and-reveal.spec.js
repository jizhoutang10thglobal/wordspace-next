// 两个 shell 生命周期 feature 的 e2e（Wendi/Colin 2026-07-03）：
// ① Cmd+W 分层：有标签关标签（tabs.spec 已盖）→ 无标签但有内容（查看器等）先关内容 → 真·空态关窗口。
//    关窗口按平台分流：macOS=隐藏驻留（后台开着，Dock 点击 / 双击文件唤回，状态全保留）；
//    Windows/Linux=按平台惯例退出。两个分支各自真断言——CI(Linux) 跑退出分支、宿主(mac) 跑驻留分支，
//    没有 test.skip 假绿（CLAUDE.md S3 教训）。
// ② 外部（Finder 双击 / open-file）打开工作区内文件 → 树展开到所在文件夹 + 滚动定位 + 高亮 + 建标签。
//    树默认全收起（collectDirRels），修复前文件在树里不可见、高亮落空。热开 + 冷启动两条路都验。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const IS_MAC = process.platform === 'darwin';
const W = 8000;

let app, page, tmp, wsDir, userData;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}
async function openWorkspace() {
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.locator('.sb-dir[data-rel="数据"]')).toBeVisible();
}
const menu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
// 非 mac 分支等到进程退出后，把 app 换成惰性假对象让 afterEach 不碰死进程（两处平台分支共用）
const neuterApp = () => { app = { evaluate: async () => {}, close: async () => {}, waitForEvent: async () => {} }; };
const sendOpenFile = (p) => app.evaluate(({ BrowserWindow }, fp) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp), p);
const winVisible = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? w.isVisible() : null; });

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wcr-'));
  wsDir = path.join(tmp, 'workspace');
  userData = path.join(tmp, 'userdata');
  await fs.mkdir(path.join(wsDir, '数据', '深层'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'outside'), { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, '数据', '深层', 'c.html'), HTML('CCC'), 'utf8');
  await fs.writeFile(path.join(tmp, 'outside', 'pic.png'), 'not-really-a-png', 'utf8'); // 查看器只要 kind=image 分流
  ({ a: app, p: page } = await launch({ WS2_USERDATA: userData, WS2_FOLDER_IN: wsDir }));
});
test.afterEach(async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

// ---- ② 外部打开 → 树展开定位 ----

test('外部打开工作区内深层文件（热开）→ 文件夹链展开 + 行高亮 + 标签激活', async () => {
  await openWorkspace();
  // 树默认全收起：深层文件行此刻不存在
  await expect(page.locator('.sb-file[data-rel="数据/深层/c.html"]')).toHaveCount(0);
  await sendOpenFile(path.join(wsDir, '数据', '深层', 'c.html'));
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('CCC');
  // 文件夹链（数据 → 深层）被展开、文件行可见且高亮
  await expect(page.locator('.sb-file[data-rel="数据/深层/c.html"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-file[data-rel="数据/深层/c.html"]')).toHaveClass(/is-active/);
  // 标签也开着且激活
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="数据/深层/c.html"]')).toHaveClass(/is-active/);
});

test('冷启动双击工作区内深层文件（恢复在飞）→ 树照样展开定位 + 标签在', async () => {
  await openWorkspace(); // 持久化工作区根，给下一次冷启动恢复
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app.close().catch(() => {});
  ({ a: app, p: page } = await launch({
    WS2_USERDATA: userData,
    WS2_OPEN_FILE: path.join(wsDir, '数据', '深层', 'c.html'),
    WS2_SLOW_TREE_MS: '700', // 确定性让恢复落后于 open（同 cold-start.spec）
  }));
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('CCC');
  await expect(page.locator('.sb-file[data-rel="数据/深层/c.html"]')).toBeVisible({ timeout: W });
  await expect(page.locator('.sb-file[data-rel="数据/深层/c.html"]')).toHaveClass(/is-active/);
  await expect(page.locator('#sb-tabs .sb-tab[data-rel="数据/深层/c.html"]')).toBeVisible({ timeout: W });
});

// ---- ① Cmd+W 空态 → 关窗口（平台分流） ----

test('Cmd+W 真·空态 → mac 隐藏驻留 + Dock 唤回 / 其他平台退出', async () => {
  await openWorkspace(); // 有工作区、无标签、无文档 = 真·空态
  if (IS_MAC) {
    await menu('close-tab');
    await expect.poll(winVisible).toBe(false);            // 窗口藏了
    expect(await app.evaluate(({ app: a }) => a.getVersion())).toBeTruthy(); // 进程还活着（后台驻留）
    await app.evaluate(({ app: a }) => { a.emit('activate'); });             // 点 Dock 图标
    await expect.poll(winVisible).toBe(true);              // 窗口回来了
    await expect(page.locator('#sidebar.sb-on')).toBeVisible(); // 状态原样（工作区还开着）
  } else {
    const closed = app.waitForEvent('close');
    await menu('close-tab');
    await closed; // Linux/Windows：关窗即退（平台惯例）
    neuterApp();
  }
});

test('Cmd+W 分层：无标签的文档（单文件模式）先关文档回空态，再按一次才关窗口', async () => {
  // 不开工作区 = 单文件模式：文档开着但没有标签（openTabFromAbs 的 current 守卫不建标签）
  await sendOpenFile(path.join(wsDir, 'a.html'));
  await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0);
  await menu('close-tab'); // 第一次：关文档回空态、窗口不动
  await expect(page.locator('#home')).toBeVisible();
  expect(await winVisible()).toBe(true);
  if (IS_MAC) {
    await menu('close-tab'); // 第二次：真·空态 → 隐藏驻留
    await expect.poll(winVisible).toBe(false);
    // 隐藏驻留中 Finder 双击文件 → 唤醒窗口 + 打开文档（open-file → openExternalPath → focusWindow 链路）
    await app.evaluate(({ app: a }, fp) => { a.emit('open-file', { preventDefault: () => {} }, fp); }, path.join(wsDir, 'a.html'));
    await expect.poll(winVisible).toBe(true);
    await expect(page.frameLocator('#doc-frame').locator('h1')).toHaveText('AAA');
  } else {
    const closed = app.waitForEvent('close');
    await menu('close-tab');
    await closed;
    neuterApp();
  }
});

test('Cmd+W 分层：无标签的查看器（单文件模式看图）先关内容回空态，窗口不动（审计：pic.png fixture 归位）', async () => {
  // 不开工作区：查看器无标签态只在单文件模式（开了工作区后外部文件会建 ↗ 标签、走标签层）
  await page.evaluate((abs) => window.__shellShowViewer({ abs, rel: null, kind: 'image', name: 'pic.png' }), path.join(tmp, 'outside', 'pic.png'));
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#sb-tabs .sb-tab')).toHaveCount(0);
  await menu('close-tab'); // 第一层：关查看器回空态、窗口绝不能动
  await expect(page.locator('#viewer')).toBeHidden();
  await expect(page.locator('#home')).toBeVisible();
  expect(await winVisible()).toBe(true);
});
