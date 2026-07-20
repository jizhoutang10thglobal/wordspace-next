// 回归门：手动下载点「后台下载」关掉面板后，后续进度推送不许把面板弹回来。
// 病根（Colin 2026-07-17 实机）：面板开合策略是「手动路径的任何推送 → 没开就开」，手动下载每 ~200ms
// 一条 progress 推送，一关面板就被下一条打脸重开 →「不停跳出来」。修法在 src/renderer/update-ui.js：
// 记住用户在哪个状态关的面板（dismissedAtState），同状态推送不再自动弹；状态跃迁（downloading→ready）
// 才重新弹。驱动同 update-ui.spec.js：main 状态机真链路，只有 electron-updater 事件源经 __ws2UpdateSim 仿真。
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, tmpDir;

test.beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2reopen-'));
  const wsDir = path.join(tmpDir, 'ws'); // pill 住侧栏（.sb-on），备工作区文件夹让侧栏在
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

test('「后台下载」关掉面板后：进度推送不再弹回，状态跃迁（就绪）才重新弹', async () => {
  // 手动路径进 downloading，面板自动开着
  await sim({ type: 'checking', manual: true });
  await sim({ type: 'available', version: '5.5.5', notes: [] });
  await sim({ type: 'download-started' });
  const card = page.locator('.up-card');
  await expect(card).toHaveAttribute('data-state', 'downloading');

  // 点「后台下载」（downloading 态那颗按钮就是 data-act=close）关面板
  await page.locator('.up-btn[data-act="close"]').click();
  await expect(card).toHaveCount(0);

  // 关键回归断言：后续进度推送（手动流里每 ~200ms 一条）不许把面板弹回来。
  await sim({ type: 'progress', percent: 41, transferred: 5e6, total: 12e6, bytesPerSecond: 3e4 });
  await sim({ type: 'progress', percent: 42, transferred: 5.1e6, total: 12e6, bytesPerSecond: 3e4 });
  await expect(card).toHaveCount(0); // 修前：这里面板会被 openPanel 重建 → count>0 红
  await expect(page.locator('#sb-update-txt')).toContainText('42%'); // 后台下载：pill 仍跟进度（下载没停）

  // 状态跃迁 downloading → ready：这才是「全程跟进」该弹的里程碑，面板应重新出现
  await sim({ type: 'downloaded', version: '5.5.5' });
  await expect(card).toHaveAttribute('data-state', 'ready');

  await page.locator('.sb-modal-x').click();
  await expect(card).toHaveCount(0);
});
