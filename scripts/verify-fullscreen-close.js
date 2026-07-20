#!/usr/bin/env node
// 宿主验证：全屏下关窗不留空 Space（Wendi/Colin 2026-07-20「全屏点左上角关闭 → 黑屏」）。
//
// 为什么不放 e2e：macOS 原生全屏是真 Space 转场，CI 的 xvfb 无窗口管理器、setFullScreen 不可靠
// （immersive.spec.js:156 同款结论：那边改用 win.emit 驱动，但本 bug 的判据是 win.isFullScreen()
// 的**真 OS 状态**，emit 伪造不了）。CI 侧的牙在 test/window-residency.test.js（顺序不变量 + 变异自检）；
// 这个脚本补真机行为，发版前 / 动 close 路径时跑。
//
// 判据（老代码必红、修后必绿，实测）：
//   进真全屏 → close() → 轮询：isVisible() 必须变 false 且 isFullScreen() 必须变 false。
//   老代码实测停在 vis=true/fs=true（macOS 吞掉对全屏窗口的 orderOut:，窗口没藏、Space 没拆）。
//
// 用法：node scripts/verify-fullscreen-close.js
const { _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>A</h1></body></html>';

async function main() {
  if (process.platform !== 'darwin') {
    // 不静默跳过（假绿是本仓明令禁止的）：非 mac 直接以非零退出说明「这里验不了」。
    console.error('✗ 本脚本只在 macOS 有意义（原生全屏 Space 是 mac 概念）。CI 侧的门在 test/window-residency.test.js。');
    process.exit(2);
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-fsclose-'));
  const ws = path.join(tmp, 'ws');
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(ws, 'a.html'), HTML, 'utf8');

  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_LANG: 'zh', WS2_NO_CLOSE_DIALOG: '1', WS2_USERDATA: path.join(tmp, 'ud'), WS2_FOLDER_IN: ws },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const state = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w ? { vis: w.isVisible(), fs: w.isFullScreen() } : { gone: true };
  });
  const pollFor = async (pred, ms) => {
    const t0 = Date.now();
    let s;
    while (Date.now() - t0 < ms) {
      s = await state();
      if (pred(s)) return { ...s, waited: Date.now() - t0 };
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ...s, waited: Date.now() - t0, timedOut: true };
  };

  let failed = 0;
  const ok = (cond, msg) => { if (!cond) { failed++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setFullScreen(true); });
    const inFs = await pollFor((s) => s.fs === true, 15000);
    ok(inFs.fs === true, `前置：真进全屏（${inFs.waited}ms）`);
    if (!inFs.fs) throw new Error('进不了全屏，后续判据无意义');

    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    const after = await pollFor((s) => s.vis === false && s.fs === false, 10000);
    ok(after.vis === false, `全屏关窗后窗口真藏起来（vis=${after.vis}）`);
    ok(after.fs === false, `全屏关窗后已退出全屏、不留空 Space（fs=${after.fs}）`);

    // 回来是窗口态（对齐原生 mac 红灯语义），且能正常唤回
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
    const back = await pollFor((s) => s.vis === true, 5000);
    ok(back.vis === true && back.fs === false, `Dock 唤回：窗口态回来（vis=${back.vis} fs=${back.fs}）`);
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.setFullScreen(false); } catch { /* 已销毁 */ }
        try { w.destroy(); } catch { /* 已销毁 */ }
      }
    }).catch(() => {});
    await app.close().catch(() => {});
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
