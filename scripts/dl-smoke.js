// U3 下载引擎自证脚本（独立 Electron main）。node:test 碰不到真 DownloadItem，e2e 是 U6 的活——
// 这里在宿主真开 Electron session、真起 http server、真触发 will-download，强断言读真磁盘 / 读 registry。
// 跑法：./node_modules/.bin/electron scripts/dl-smoke.js --no-sandbox
// 证三条：① 正常下载落盘 + uniquify（同名第二个带 (1)）；② 取消 → canceled 且无半截文件残留；
//         ③ pendingUncommittedUrl 回滚（navigate 到下载 URL 后 registry rec.url 不是那个 URL）。
// 临时脚本：可留仓（自证凭证）或 U6 后删。
'use strict';
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-dl-smoke-'));
const dlDir = path.join(tmpBase, 'downloads');
const userData = path.join(tmpBase, 'userdata');
fs.mkdirSync(dlDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
process.env.WS2_DL_DIR = dlDir; // resolveDlDir 的测试 seam（!app.isPackaged 下生效）
app.setPath('userData', userData);

const browserStore = require('../src/main/browser-store');
const webTabs = require('../src/main/web-tabs');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitUntil(fn, timeoutMs = 6000, stepMs = 60) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = fn(); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(stepMs);
  }
}
const stateOf = (id) => { const e = webTabs.downloadsList().find((x) => x.id === id); return e && e.state; };
function dlDirNames() { try { return fs.readdirSync(dlDir); } catch { return []; } }
function resetDl() {
  webTabs.dlClear();
  for (const n of dlDirNames()) { try { fs.unlinkSync(path.join(dlDir, n)); } catch { /* */ } }
}

// http server：/dl 立即完成的附件（evil.bin, 11B）；/slow 慢发不结束（big.bin）；/page 普通页。
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/dl') {
    const body = 'hello world'; // 11 bytes
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="evil.bin"', 'Content-Length': String(Buffer.byteLength(body)) });
    res.end(body);
    return;
  }
  if (u.pathname === '/slow') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="big.bin"' });
    res.write('X'.repeat(64));
    const iv = setInterval(() => { try { res.write('X'.repeat(64)); } catch { clearInterval(iv); } }, 120);
    const stop = () => clearInterval(iv);
    req.on('close', stop); res.on('error', stop); res.on('close', stop);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>ok</body></html>');
});

async function run(base) {
  // ---- ③ pendingUncommittedUrl 回滚 ----
  resetDl();
  const rollUrl = base + '/dl';
  webTabs.navigate('rk', rollUrl);
  const recBefore = webTabs._registry.get('rk');
  check('③a navigate 乐观写了 pendingUncommittedUrl', recBefore && recBefore.pendingUncommittedUrl === rollUrl, `pending=${recBefore && recBefore.pendingUncommittedUrl}`);
  await waitUntil(() => webTabs.downloadsList().length >= 1); // will-download 已跑（回滚在其同步段内）
  const recAfter = webTabs._registry.get('rk');
  check('③b will-download 回滚 rec.url 不是下载 URL', recAfter && recAfter.url !== rollUrl, `rec.url=${JSON.stringify(recAfter && recAfter.url)}`);
  check('③c 回滚目标 = null（fresh 标签无 committedUrl → 起始页）', recAfter && recAfter.url === null, `rec.url=${JSON.stringify(recAfter && recAfter.url)}`);
  check('③d pendingUncommittedUrl 已清', recAfter && recAfter.pendingUncommittedUrl === null, `pending=${JSON.stringify(recAfter && recAfter.pendingUncommittedUrl)}`);
  await waitUntil(() => stateOf(webTabs.downloadsList()[0] && webTabs.downloadsList()[0].id) === 'completed');

  // ---- ① 正常下载落盘 + uniquify ----
  resetDl();
  webTabs.navigate('u1', base + '/dl');
  const ok1 = await waitUntil(() => fs.existsSync(path.join(dlDir, 'evil.bin')));
  check('①a 第一次下载落盘 evil.bin', ok1, dlDirNames().join(', '));
  webTabs.navigate('u2', base + '/dl'); // 同名 → 磁盘已有 evil.bin → uniquify (1)
  const ok2 = await waitUntil(() => fs.existsSync(path.join(dlDir, 'evil (1).bin')));
  check('①b 第二次同名 → uniquify evil (1).bin', ok2, dlDirNames().join(', '));
  const names = dlDirNames().sort();
  check('①c 目录恰好两个文件（无多余残留）', names.length === 2 && names.includes('evil.bin') && names.includes('evil (1).bin'), names.join(', '));
  const bytes = (() => { try { return fs.readFileSync(path.join(dlDir, 'evil (1).bin'), 'utf8'); } catch { return ''; } })();
  check('①d 落盘内容字节完整（强断言,非查 UI）', bytes === 'hello world', JSON.stringify(bytes));

  // ---- ② 取消 → canceled 且无半截文件残留 ----
  resetDl();
  webTabs.navigate('cx', base + '/slow');
  const bigPath = path.join(dlDir, 'big.bin');
  const appeared = await waitUntil(() => { const l = webTabs.downloadsList(); return l.length >= 1 && l[0].state === 'downloading'; });
  const dlId = (webTabs.downloadsList()[0] || {}).id;
  const existedBefore = await waitUntil(() => fs.existsSync(bigPath), 3000); // 证「取消前确有半截文件」→ 无残留才不是空断言
  check('②a 下载已在途', appeared && !!dlId, `id=${dlId}`);
  webTabs.dlCancel(dlId);
  const gotCanceled = await waitUntil(() => stateOf(dlId) === 'canceled');
  check('②b 取消 → 条目 canceled', gotCanceled, `state=${stateOf(dlId)}`);
  await sleep(200); // 给 done 回调的 unlink 一点余量
  const residue = dlDirNames().filter((n) => n === 'big.bin' || n.endsWith('.crdownload'));
  check('②c 取消后 dlDir 无半截文件残留（含 .crdownload）', residue.length === 0, `existedBefore=${existedBefore} 残留=[${residue.join(', ')}]`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 600 });
  browserStore.init(userData);
  let pushes = 0;
  webTabs.setDownloadsHook(() => { pushes++; });
  webTabs.init(() => win);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await run(base);
  } catch (e) {
    fail++;
    console.log('FAIL  未捕获异常 — ' + (e && e.stack || e));
  }
  console.log(`\ndownloadsHook 推送次数: ${pushes}`);
  console.log(`\n===== dl-smoke: ${pass} PASS / ${fail} FAIL =====`);
  try { server.close(); } catch { /* */ }
  try { win.destroy(); } catch { /* */ }
  app.exit(fail === 0 ? 0 : 1);
});
