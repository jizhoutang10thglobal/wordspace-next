// 更新退出链真门（Colin 2026-07-17 复现「点了重启安装,app 赖在 Dock 里」的修复门）。
// 链路：面板「重启安装」→ IPC update-install → beginQuitForUpdate（quitting=true 放行,零事件依赖）
//   → [真环境] native quitAndInstall 逐窗 close → 全关 → quit → ShipIt 换包重开
//   → [本门]   WS2_UPDATE_QUIT_SIM 用「逐窗 close」模拟 native 的关窗序列（时序同构）,断言**进程真退出**。
// 有牙的关键：WS2_DARWIN_PERSIST_SIM 在任何平台强制 darwin 隐藏驻留分支——老 bug（quitting 靠
// 挂错发射器的事件、从未置位）下窗口被 preventDefault+hide、进程永不退 → 门红；修复后 → 绿。
// （不加该 seam 的话 Linux CI 无驻留分支,坏代码也能绿 = 哑门。）
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
let app, page, tmpDir;

test.beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2updq-'));
  app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: {
      ...process.env, WS2_LANG: 'zh', WS2_USERDATA: path.join(tmpDir, 'userdata'),
      WS2_UPDATE_QUIT_SIM: '1', WS2_DARWIN_PERSIST_SIM: '1',
    },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { if (app) await app.close().catch(() => {}); app = null; });

const sim = (evt) => app.evaluate((_el, e) => { globalThis.__ws2UpdateSim.push(e); }, evt);

test('重启安装真退出：驻留守卫不吞更新退出（quitting 动作点直置,非事件依赖）', async () => {
  // 推到就绪态 → 面板出「重启安装」
  await sim({ type: 'checking', manual: true });
  await sim({ type: 'available', version: '9.9.9', notes: [] });
  await sim({ type: 'download-started' });
  await sim({ type: 'downloaded', version: '9.9.9' });
  await expect(page.locator('.up-card')).toHaveAttribute('data-state', 'ready');

  // 点「重启安装」→ 主进程走 beginQuitForUpdate + 模拟关窗序列 → 进程必须在限时内真退出。
  // 老 bug：窗口被驻留守卫 hide(不是 close) → window-all-closed 永不发 → 进程活着 → 此处超时翻红。
  const exited = new Promise((res) => app.process().once('exit', (code) => res(code)));
  await page.locator('.up-btn[data-act="install"]').click();
  const code = await Promise.race([
    exited,
    new Promise((_, rej) => setTimeout(() => rej(new Error('进程 8s 未退出——更新退出被驻留守卫吞了(重启不重启复发)')), 8000)),
  ]);
  expect(typeof code).toBe('number'); // 真退了（退出码拿到即链路通,不苛求 0——平台差异）
  app = null; // 已退出,afterEach 别再 close
});

test('对照:未点重启安装时,关窗仍是隐藏驻留(seam 没有误伤日常路径)', async () => {
  // WS2_DARWIN_PERSIST_SIM 强制驻留分支后,普通关窗应照旧「藏而不退」——防 seam 本身把驻留搞坏。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(600);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { alive: !!w && !w.isDestroyed(), visible: w ? w.isVisible() : null };
  });
  expect(state.alive).toBe(true); // 窗口没销毁
  expect(state.visible).toBe(false); // 只是藏了 = 驻留语义完好
});
