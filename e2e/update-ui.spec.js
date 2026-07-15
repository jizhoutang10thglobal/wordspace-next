// 更新 UI e2e 真门：面板 / 侧栏 pill / 按钮 wiring。真 updater 在 dev 不工作（无 update feed），
// 状态事件注入走 main 的 __ws2UpdateSim seam（非打包态，照 __ws2WebTabs 惯例）——驱动的是
// 「main 状态机 → IPC 推送 → renderer 渲染」的真链路，只有 electron-updater 事件源是仿真的。
// 按钮点击断言主进程侧真收到调用（sim.calls 计数），不只断 DOM。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, tmpDir;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2upd-'));
  // pill 住在侧栏（.sb-on 才显示）→ 备一个工作区文件夹（WS2_FOLDER_IN seam），pill 测试前打开
  const wsDir = path.join(tmpDir, 'ws');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(path.join(wsDir, 'a.html'), '<!DOCTYPE html><html><body><p>hi</p></body></html>');
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_FOLDER_IN: wsDir },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});
test.afterAll(async () => { if (app) await app.close(); });

const sim = (evt) => app.evaluate((_el, e) => { globalThis.__ws2UpdateSim.push(e); }, evt);
const simCalls = () => app.evaluate(() => globalThis.__ws2UpdateSim.calls);
const fillRatio = () => page.evaluate(() => {
  const f = document.getElementById('up-prog-fill');
  if (!f) return -1;
  const track = f.parentElement.getBoundingClientRect().width;
  return track ? f.getBoundingClientRect().width / track : -1;
});

test('手动链路：检查→发现新版(带说明)→下载→进度→就绪→重启，按钮真接到主进程', async () => {
  await sim({ type: 'checking', manual: true });
  const card = page.locator('.up-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-state', 'checking');

  await sim({ type: 'available', version: '9.9.9', notes: [{ t: 'h', text: '新功能' }, { t: 'li', text: '测试条目甲' }] });
  await expect(card).toHaveAttribute('data-state', 'available');
  await expect(page.locator('.sb-modal-title')).toHaveText('发现新版本 v9.9.9');
  await expect(page.locator('.up-line-li')).toHaveText('测试条目甲');

  await page.locator('.up-btn[data-act="download"]').click();
  expect((await simCalls()).download).toBe(1); // 主进程真收到 update-download

  // dev 下 update-download 只计数不动状态机 → 后续状态由 sim 推（对应真环境 electron-updater 的事件流）
  await sim({ type: 'download-started' });
  await expect(card).toHaveAttribute('data-state', 'downloading');
  await expect(page.locator('.up-prog-detail')).toContainText('正在开始下载');

  await sim({ type: 'progress', percent: 42, transferred: 55e6, total: 132e6, bytesPerSecond: 3.2e6 });
  await expect(page.locator('.up-prog-detail')).toContainText('42%');
  await expect(page.locator('.up-prog-detail')).toContainText('MB'); // 已下/总量真在展示
  // 进度条强断言：computed 宽度占轨道比例 ≈ percent（width 有 .3s transition → poll 到位）
  await expect.poll(fillRatio, { timeout: 2000 }).toBeGreaterThan(0.38);
  expect(await fillRatio()).toBeLessThan(0.46);

  await sim({ type: 'progress', percent: 80, transferred: 106e6, total: 132e6, bytesPerSecond: 3.2e6 });
  await expect.poll(fillRatio, { timeout: 2000 }).toBeGreaterThan(0.76); // 真在长

  await sim({ type: 'downloaded' });
  await expect(card).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.sb-modal-title')).toHaveText('更新已就绪');
  await page.locator('.up-btn[data-act="install"]').click();
  expect((await simCalls()).install).toBe(1); // 主进程真收到 update-install

  await page.locator('.sb-modal-x').click();
  await expect(card).toHaveCount(0);
});

test('自动路径：全程不弹面板，侧栏 pill 跟进度；就绪后 toast 带「重启安装」；点 pill 才开面板', async () => {
  // 打开工作区让侧栏出现（pill 的宿主）
  await page.click('#home-open-folder');
  await expect(page.locator('#sidebar.sb-on')).toBeVisible();

  await sim({ type: 'checking', manual: false });
  await expect(page.locator('.up-card')).toHaveCount(0);

  await sim({ type: 'available', version: '8.8.8', notes: [] }); // 自动路径 → 状态机直落 downloading（静默下载）
  const pill = page.locator('#sb-update');
  await expect(pill).toBeVisible();
  await expect(page.locator('.up-card')).toHaveCount(0); // 仍不打扰

  await sim({ type: 'progress', percent: 66, transferred: 87e6, total: 132e6, bytesPerSecond: 2e6 });
  await expect(page.locator('#sb-update-txt')).toContainText('66%');
  await expect(page.locator('#sb-update-txt')).toContainText('v8.8.8');

  await sim({ type: 'downloaded', version: '8.8.8' });
  await expect(page.locator('#sb-update-txt')).toContainText('更新已就绪');
  // 低打扰提示：toast 出现且 action 是重启安装
  await expect(page.locator('.sb-toast', { hasText: '新版本已就绪' })).toBeVisible();
  await expect(page.locator('.sb-toast-action')).toHaveText('重启安装');

  const installBefore = (await simCalls()).install;
  await page.locator('.sb-toast-action').click();
  expect((await simCalls()).install).toBe(installBefore + 1); // toast 的 action 真接到主进程

  await pill.click();
  await expect(page.locator('.up-card')).toHaveAttribute('data-state', 'ready');
  await page.locator('.up-btn[data-act="close"]').click(); // 「稍后」= 关面板，pill 留着
  await expect(page.locator('.up-card')).toHaveCount(0);
  await expect(pill).toBeVisible();
});

test('启动补拉：renderer 重载后从 main 缓存恢复 pill（事件先于 renderer 就绪的竞态门），且不弹面板', async () => {
  // 上一测试把 main 侧状态留在 ready → 重载窗口模拟「事件都发生在 renderer 就绪前」
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sb-update-txt')).toContainText('更新已就绪');
  await expect(page.locator('.up-card')).toHaveCount(0); // 补拉只挂 pill，不自动弹面板
});
