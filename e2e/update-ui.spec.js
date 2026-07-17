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
    env: { ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1', WS2_FOLDER_IN: wsDir },
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

test('下载进度推送不重建面板：同一张卡原地更新（防闪烁），焦点不被反复抢', async () => {
  // 进入 downloading 面板态
  await sim({ type: 'checking', manual: true });
  await sim({ type: 'available', version: '7.7.7', notes: [] });
  await sim({ type: 'download-started' });
  const card = page.locator('.up-card');
  await expect(card).toHaveAttribute('data-state', 'downloading');
  // 给卡片打上 DOM 身份标记 + 把焦点挪到「后台下载」按钮（非 primary），随后的进度推送都不许动这两样
  await page.evaluate(() => {
    document.querySelector('.up-card').__probe = 'same-node';
    document.querySelector('.up-btn[data-act="close"]').focus();
  });
  await sim({ type: 'progress', percent: 33, transferred: 44e6, total: 132e6, bytesPerSecond: 3e6 });
  await sim({ type: 'progress', percent: 34, transferred: 45e6, total: 132e6, bytesPerSecond: 3e6 });
  await expect(page.locator('.up-prog-detail')).toContainText('34%'); // 数值真在走
  const after = await page.evaluate(() => ({
    probe: document.querySelector('.up-card').__probe || null, // 重建过的新节点上不会有这个标记
    focusAct: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : null,
  }));
  expect(after.probe, '进度推送不许拆掉重建面板（拆建=闪烁病根）').toBe('same-node');
  expect(after.focusAct, '进度推送不许抢焦点').toBe('close');
  // 状态跃迁（downloading → ready）才允许重建：按钮/标题都换了
  await sim({ type: 'downloaded', version: '7.7.7' });
  await expect(card).toHaveAttribute('data-state', 'ready');
  await page.locator('.sb-modal-x').click();
  await expect(card).toHaveCount(0);
});

test('quitAndInstall 退出链兜底监听：挂在正确的发射器（native autoUpdater，非 app）上', async () => {
  // ⚠ 本门 2026-07-17 重写。旧版是哑门标本：① 存在性查的是 app.listenerCount——但
  // before-quit-for-update 是 require('electron').autoUpdater（AutoUpdater 接口,d.ts:1995）的事件,
  // 挂 app 上的监听器永远不触发,门却绿着（Colin 07-17 实机复现「重启不重启」戳穿）；② darwin 行为段
  // 自导自演——测试自己在 app 上 emit 一个现实中不存在的事件给自己的监听器接,验的是虚构时序。
  // 现行主修 = 动作点直置（update-install → beginQuitForUpdate,零事件依赖）,**行为门在
  // e2e/update-quit.spec.js**（真实按钮路径驱动 + WS2_DARWIN_PERSIST_SIM 强制驻留分支,断言进程
  // 真退出,全平台有牙）。这里只兜「事件兜底监听挂在正确发射器上」的存在性（防未来把兜底删了）。
  const counts = await app.evaluate(({ app: a, autoUpdater: nau }) => ({
    onNative: nau ? nau.listenerCount('before-quit-for-update') : -1,
    onApp: a.listenerCount('before-quit-for-update'),
  }));
  expect(counts.onNative, '兜底监听必须挂在 native autoUpdater（事件的真实发射器）上').toBeGreaterThan(0);
  // app 上不该再有该监听——那是 07-16 哑修的残留形态,挂回去 = 把错误示范复活
  expect(counts.onApp, 'app 上不该挂 before-quit-for-update（不是 app 事件,挂了也不触发,纯误导）').toBe(0);
});
