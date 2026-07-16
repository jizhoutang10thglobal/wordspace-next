// P0a 大根死锁止血包 e2e 真门（诊断 docs/brainstorms/2026-07-16-bigroot-freeze-p0-diagnosis.md）。
// 覆盖 U1 启动死门 / U2 条目预算「过大」态 / U3 逃生门 / U4 病灶确认 / U5 拒绝出口。
//
// 强断言口径（CLAUDE.md S4）：断言用户可感知的结果（根行/「过大」行/确认框/toast 真渲染 + 可点），
// 不查内部 class 代理。
//
// ⚠ 变异自检（CLAUDE.md 铁律，血换）——**先 commit 再变异**，改回 `git checkout --` 会连修复一起冲掉：
//   打坏 U2 预算守卫（src/main/workspace.js walk：把 `if (count >= budget)` 改成 `if (false)`，或 treeBudget()
//   直接 return 1e9）→ 重跑本文件 → 「U2 过大」「U5 出口」两条必翻红（过大态消失 / child 父根不再 truncated）。
//   还原后复绿才算门有牙。fixture 文件数（BIG=120）**刻意 != 预算（50）**：同数会让门变哑门（恰好等于不截断）。
//
// seam：WS2_FOLDER_IN 选目录 / WS2_TREE_BUDGET 覆盖条目预算 / WS2_SLOW_TREE_MS 拖慢读树 /
//       WS2_HUGE_PATHS 把 tmp 目录当病灶路径（真机拿不到 os.homedir 之类确定性 fixture）。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = (m) => `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${m}</h1></body></html>`;
const BUDGET = 50;
const BIG = 120; // 刻意 > 预算，且 != 预算（防哑门）

let app, page, tmp, wsDir, bigDir, childDir, userData;

async function launch(env) {
  const a = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: userData, ...env },
  });
  const p = await a.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.evaluate(() => { window.confirm = () => true; window.alert = () => {}; });
  app = a;
  page = p;
  return { a, p };
}
const rootHeads = () => page.locator('.sb-root-head:not(.sb-root-missing):not(.sb-root-oversize)');
const sendMenu = (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd);
const setFolderSeam = (dir) => app.evaluate(({ }, d) => { process.env.WS2_FOLDER_IN = d; }, dir);

test.beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-bigroot-'));
  userData = path.join(tmp, 'userdata');
  wsDir = path.join(tmp, '小工作区');          // 少量文件（U1/U3/U4 用）
  bigDir = path.join(tmp, '海量文件夹');        // BIG 个文件 > 预算（U2/U5 用）
  childDir = path.join(bigDir, '子项目');       // bigDir 的子目录（U5：加它被判 child）
  await fs.mkdir(wsDir, { recursive: true });
  await fs.mkdir(childDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), HTML('AAA'), 'utf8');
  await fs.writeFile(path.join(wsDir, 'b.html'), HTML('BBB'), 'utf8');
  for (let i = 0; i < BIG; i++) await fs.writeFile(path.join(bigDir, `f${i}.html`), HTML('x'), 'utf8');
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

// 启动一次把 dir 作为根打开 → 持久化进 workspace.json，随后关掉（下次冷启动就有「上次工作区」要恢复）。
async function seedRoot(dir) {
  await launch({ WS2_FOLDER_IN: dir });
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();
  await expect(rootHeads()).toHaveCount(1, { timeout: 8000 }); // 树读完 = 已持久化
  await app.close();
  app = null;
}

test('U1 启动死门：读树巨慢时根行/loading/移除入口仍即刻可见可点（不空态永驻）', async () => {
  await seedRoot(wsDir);
  // 冷启动：读树 15s 巨慢。老代码（门控在全部根读完树上）→ 空态永驻、根行 15s 才出；
  // 修复后 Phase 1 先渲染根行 + loading。给 6s 上限（远小于 15s）→ 老代码这步必超时翻红。
  const { p } = await launch({ WS2_SLOW_TREE_MS: '15000' });
  await expect(p.locator('#sidebar.sb-on')).toBeVisible({ timeout: 6000 });
  await expect(rootHeads()).toHaveCount(1, { timeout: 6000 });
  await expect(p.locator('.sb-loading')).toBeVisible({ timeout: 6000 }); // 「正在读取文件夹…」
  // 右键根行 → 移除（全程不等那 15s 读树），app 恢复正常空态
  const rootId = (await p.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root)))[0];
  await p.locator(`.sb-root-head[data-root="${rootId}"]`).click({ button: 'right' });
  await p.locator('.sb-ctx-item', { hasText: '移除' }).click();
  await expect(rootHeads()).toHaveCount(0);
  await expect(p.locator('.sb-loading')).toHaveCount(0);
});

test('U2 过大：超条目预算的根渲染「过大」行（不建局部树），可内联移除，app 全程可交互', async () => {
  const { p } = await launch({ WS2_FOLDER_IN: bigDir, WS2_TREE_BUDGET: String(BUDGET) });
  await p.click('#home-open-folder');
  // 「过大」标题行 + 「过大」标签真渲染；不渲染任何文件行（半棵树比没有更误导）
  await expect(p.locator('.sb-root-oversize')).toBeVisible({ timeout: 8000 });
  await expect(p.locator('.sb-root-miss-tag', { hasText: '过大' })).toBeVisible();
  await expect(p.locator('.sb-file')).toHaveCount(0);
  // app 可交互：树底「添加文件夹…」在且可点（没卡死）
  await expect(p.locator('#sb-add-root')).toBeVisible();
  // 内联「移除」→ 恢复正常空态
  await p.locator('.sb-root-oversize + .sb-root-miss-note .sb-root-miss-act', { hasText: '移除' }).click();
  await expect(p.locator('.sb-root-oversize')).toHaveCount(0);
  await expect(p.locator('#sidebar.sb-on')).toHaveCount(0);
});

test('U3 逃生门：菜单「管理文件夹…」列出根并移除（只依赖注册表，不依赖树）', async () => {
  const { p } = await launch({ WS2_FOLDER_IN: wsDir });
  await p.click('#home-open-folder');
  await expect(rootHeads()).toHaveCount(1);
  await sendMenu('manage-roots'); // Playwright 点不了原生菜单栏，直接发 menu IPC
  await expect(p.locator('#manage-roots-overlay')).toBeVisible();
  const row = p.locator('#manage-roots-list .mr-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('小工作区');
  await row.locator('.mr-remove').click();
  await expect(p.locator('#manage-roots-list')).toContainText('没有打开的文件夹');
  await expect(rootHeads()).toHaveCount(0); // 侧栏根也没了（removeRootUI 同步清了 rootsState）
});

test('U3b 逃生门空态也能开：无工作区时菜单「管理文件夹…」显示「没有打开的文件夹」', async () => {
  const { p } = await launch({});
  await expect(p.locator('#home-open-folder')).toBeVisible(); // 空态
  await sendMenu('manage-roots');
  await expect(p.locator('#manage-roots-overlay')).toBeVisible();
  await expect(p.locator('#manage-roots-list')).toContainText('没有打开的文件夹');
});

test('U4 病灶确认：选病灶路径出确认框，取消不注册；「仍要打开」才注册', async () => {
  // WS2_HUGE_PATHS 把 wsDir 当病灶路径（seam）。⚠ 主进程 hugeRootReason 拿的是 canonReal(dir)=realpath，
  // macOS tmp 走 /var→/private/var 软链 → seam 必须给 realpath，否则 canonPath 两形态不等、判不出病灶。
  const wsReal = await fs.realpath(wsDir);
  const { p } = await launch({ WS2_FOLDER_IN: wsDir, WS2_HUGE_PATHS: wsReal });
  await p.click('#home-open-folder');
  await expect(p.locator('#huge-confirm-overlay')).toBeVisible();
  await expect(rootHeads()).toHaveCount(0); // 确认前不注册
  // 取消（Esc）→ 关框、仍未注册
  await p.keyboard.press('Escape');
  await expect(p.locator('#huge-confirm-overlay')).toHaveCount(0);
  await expect(rootHeads()).toHaveCount(0);
  // 再来一次 → 「仍要打开」→ 注册（wsDir 文件少 < 默认预算 → 正常根）
  await sendMenu('open-folder');
  await expect(p.locator('#huge-confirm-overlay')).toBeVisible();
  await p.locator('#huge-confirm-overlay .sb-btn', { hasText: '仍要打开' }).click();
  await expect(rootHeads()).toHaveCount(1);
});

test('U5 拒绝出口：父根过大时，加它的子文件夹给「去管理文件夹移除」出口（非空头支票）', async () => {
  // 先把 bigDir 作为过大根打开
  const { p } = await launch({ WS2_FOLDER_IN: bigDir, WS2_TREE_BUDGET: String(BUDGET) });
  await p.click('#home-open-folder');
  await expect(p.locator('.sb-root-oversize')).toBeVisible({ timeout: 8000 });
  // 再加它的子文件夹 → 被判 child；父根过大 → 新文案 + 「管理文件夹」按钮
  await setFolderSeam(childDir);
  await sendMenu('open-folder');
  const toast = p.locator('.sb-toast[data-action="1"]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('管理文件夹');
  // 动作按钮直达逃生门
  await toast.locator('.sb-toast-action', { hasText: '管理文件夹' }).click();
  await expect(p.locator('#manage-roots-overlay')).toBeVisible();
});
