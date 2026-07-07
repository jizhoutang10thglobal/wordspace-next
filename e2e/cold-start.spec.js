// 冷启动竞态 e2e：app 没开着时双击 .html（macOS Finder → open-file 在 ready 前到 → pendingOpenPath →
// did-finish-load 才发给 renderer），与侧栏「恢复上次工作区 + 标签」并发。修复前：openDoc 建的标签被
// loadTabs 整体覆盖 / openTabFromAbs 的过期根守卫中止 → 文档开了但标签区是空的（Wendi/Colin 报的 bug）。
// 修复后：open-file 建标签等恢复流程跑完再做，标签必留。
//
// WS2_OPEN_FILE 测试 seam（仅非打包态，仿 WS2_FOLDER_IN）：whenReady 后挂 pendingOpenPath，
// 忠实复现 macOS 冷启动那条路，且每次启动确定性触发竞态（点不了真 Finder）。
//
// ⚠ WS2_SLOW_TREE_MS='700' 是「承载变异」的：它让「恢复」确定性慢于 open，竞态才必然触发。
// 去掉它（读树快）→ 时序偶发让标签侥幸活下来 → 即便 fix 被改坏也可能照过（哑门）。这三条已实测变异自检：
// 抽掉 sidebar.js/shell.js 的 fix（保留 seam）→ 三条全红。改这个常数前先重跑变异验证，别让它静默退化。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const W = 8000;

let tmp, wsDir, outsideDir, userData;
let app = null; // 模块级：afterEach 兜底关，红跑（断言失败）也不漏 Electron 进程（对齐其它 spec）

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_NO_CLOSE_DIALOG: '1', ...env },
  });
  app = a; // 记到模块级，afterEach 负责关
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  return { a, p };
}

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-cold-'));
  wsDir = path.join(tmp, 'workspace');
  outsideDir = path.join(tmp, 'desktop'); // 工作区外（模拟桌面）
  userData = path.join(tmp, 'userdata');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, 'b.html'), HTML('BBB'), 'utf8');
  await fs.writeFile(path.join(outsideDir, 'outside.html'), HTML('OUT'), 'utf8');
  // 先持久化一个工作区，让下次冷启动 ws-get-root 有「上次工作区」要恢复（= restore 在飞，制造竞态）。
  const { p } = await launch({ WS2_USERDATA: userData, WS2_FOLDER_IN: wsDir });
  await p.click('#nt-open-folder');
  await expect(p.locator('#sidebar.sb-on')).toBeVisible();
  await app.close(); // launch 已把它赋给模块级 app
  app = null; // seed 已关，afterEach 不重复关（接下来测试自己的 launch 会重新赋值）
});
test.afterEach(async () => {
  await app?.close().catch(() => {}); // 关掉测试体的 app（含红跑半途）；seed 已置 null
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('冷启动双击工作区内文件（恢复在飞）→ 文档打开且建标签', async () => {
  const { p } = await launch({
    WS2_USERDATA: userData,
    WS2_OPEN_FILE: path.join(wsDir, 'b.html'),
    WS2_SLOW_TREE_MS: '700', // 确定性让恢复落后于 open（仿真机大目录读树慢）
  });
  await expect(p.locator('#sidebar.sb-on')).toBeVisible(); // 工作区恢复了
  await expect(p.locator('#doc-name')).toHaveText('b.html'); // 文档载入了
  // 关键：标签区出现该文件（修复前竞态把它抹掉 → 这条 timeout 失败）
  await expect(p.locator('#sb-tabs .sb-tab[data-rel="b.html"]')).toBeVisible({ timeout: W });
});

test('冷启动双击工作区外文件（恢复在飞）→ 文档打开且建外部标签', async () => {
  const outside = path.join(outsideDir, 'outside.html');
  const { p } = await launch({
    WS2_USERDATA: userData,
    WS2_OPEN_FILE: outside,
    WS2_SLOW_TREE_MS: '700',
  });
  await expect(p.locator('#sidebar.sb-on')).toBeVisible();
  await expect(p.locator('#doc-name')).toHaveText('outside.html');
  // 工作区外标签身份键 = 绝对路径（data-rel 存 keyOf=abs），带 ext 标记
  const tab = p.locator(`#sb-tabs .sb-tab[data-rel="${outside}"]`);
  await expect(tab).toBeVisible({ timeout: W });
  await expect(tab).toHaveClass(/sb-tab-ext/);
});

test('冷启动双击新文件，上次留有激活标签 → 新文件占 viewer + 旧标签仍恢复', async () => {
  // 直接往 workspace.json 注入「上次会话留下激活标签 a.html」（绕开 persist 是 fire-and-forget 的竞态）。
  const storeFile = path.join(userData, 'workspace.json');
  const store = JSON.parse(await fs.readFile(storeFile, 'utf8'));
  store.tabsByRoot = {
    [store.root]: {
      entries: [{ rel: 'a.html', kind: 'html', title: 'a.html', open: true, pinned: false }],
      activeRel: 'a.html',
    },
  };
  await fs.writeFile(storeFile, JSON.stringify(store, null, 2), 'utf8');

  const { p } = await launch({
    WS2_USERDATA: userData,
    WS2_OPEN_FILE: path.join(wsDir, 'b.html'),
    WS2_SLOW_TREE_MS: '700',
  });
  await expect(p.locator('#sidebar.sb-on')).toBeVisible();
  // 双击的 b.html 占着 viewer（没被上次激活的 a.html 抢走）
  await expect(p.locator('#doc-name')).toHaveText('b.html', { timeout: W });
  // b 建了标签
  await expect(p.locator('#sb-tabs .sb-tab[data-rel="b.html"]')).toBeVisible({ timeout: W });
  // 上次的 a 标签也恢复了（恢复没被牺牲）
  await expect(p.locator('#sb-tabs .sb-tab[data-rel="a.html"]')).toBeVisible();
});
