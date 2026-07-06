// 网页标签的主进程 view 管理器 + 安全 session（KD-2/4/11/13/14/15）。
// 一个 registry 管完：view 生命周期 + 导航事件权威副本 + 安全边界（独立 session/零 preload/默认拒权限/
// file:// 三层封死/下载清洗）。纯决策逻辑在 src/lib/web-tabs-policy.js（可单测）,这里只做 electron 副作用。
//
// 关键不变式：
//  - view 是可丢弃的渲染面,tab 状态在 renderer/store。惰性创建,关标签/切工作区 destroy。
//  - webContents 永不自动销毁（官方明示会泄漏）→ 关闭路径显式 webContents.close()。
//  - url/title/favicon 权威副本在这（registry）,renderer 只做 UI 镜像;before-quit 从这合并落盘。
//  - 主进程永不直接 attach view：show() 是唯一 attach 入口,由 renderer 的 activate 漏斗驱动（KD-5）。
const { WebContentsView, session, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const policy = require('../lib/web-tabs-policy');

const PARTITION = 'persist:webtabs';
const registry = new Map(); // key -> { view, url, title, favicon, loading, audible, canGoBack, canGoForward }
let getWin = () => null;
let sess = null;
let downloadDir = null;
const activeDownloads = new Set();

// ---- 初始化 session（一次）----
function ensureSession() {
  if (sess) return sess;
  sess = session.fromPartition(PARTITION);

  // 权限：默认拒绝,白名单放行（KD-4）。request + check 两个 handler 都要设。
  sess.setPermissionRequestHandler((_wc, permission, cb) => cb(policy.permissionAllowed(permission)));
  sess.setPermissionCheckHandler((_wc, permission) => policy.permissionAllowed(permission));
  // 屏幕共享：不给源 = 拒。
  if (sess.setDisplayMediaRequestHandler) sess.setDisplayMediaRequestHandler((_req, cb) => cb({}));
  // 设备类权限（WebUSB/HID/Serial/Bluetooth）走独立机制,一律拒（KD-4）。
  if (sess.setDevicePermissionHandler) sess.setDevicePermissionHandler(() => false);

  // 下载：清洗文件名 + 越界拒 + 同名去重（KD-4/U3）,进度/完成推 renderer。
  sess.on('will-download', (_e, item) => {
    const dir = downloadDir || path.join(os.homedir(), 'Downloads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    const name = policy.safeFilename(item.getFilename());
    const target = policy.uniqueName(dir, name, (p) => fs.existsSync(p));
    if (!policy.isInsideDir(dir, target)) { item.cancel(); return; } // 二道防线:越界直接取消
    item.setSavePath(target);
    activeDownloads.add(item);
    const push = (state) => sendToRenderer('web-download', {
      state, name: path.basename(target), savePath: target,
      received: item.getReceivedBytes(), total: item.getTotalBytes(),
    });
    push('started');
    item.on('updated', (_ev, st) => push(st === 'progressing' ? 'progressing' : st));
    item.once('done', (_ev, st) => { activeDownloads.delete(item); push(st); });
  });

  return sess;
}

function init(winGetter) {
  getWin = winGetter;
  ensureSession();
}
function setDownloadDir(dir) { downloadDir = dir; } // WS2_DL_DIR seam（e2e）

function sendToRenderer(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

// registry → renderer 的节流推送（title/favicon/loading/canGoBack 合并成一条 web-tab-updated）
function pushUpdate(key) {
  const rec = registry.get(key);
  if (!rec) return;
  sendToRenderer('web-tab-updated', {
    key, url: rec.url, title: rec.title, favicon: rec.favicon,
    loading: rec.loading, audible: rec.audible,
    canGoBack: rec.canGoBack, canGoForward: rec.canGoForward, error: rec.error || null,
  });
}

// ---- 拉 favicon → data:URL（KD-11：CSP img-src 无 https:,主进程拉图转 data 存 entry）----
async function fetchFavicon(key, url) {
  try {
    const resp = await net.fetch(url, { session: sess });
    if (!resp.ok) return;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 200 * 1024) return; // favicon 该很小,超 200KB 视为异常不存
    const mime = resp.headers.get('content-type') || 'image/x-icon';
    const rec = registry.get(key);
    if (!rec) return;
    rec.favicon = 'data:' + mime + ';base64,' + buf.toString('base64');
    pushUpdate(key);
  } catch { /* 失败静默：favicon 是装饰,标签行回落通用图标 */ }
}

// ---- 建 view（惰性,首次激活/首次导航才调）----
function createView(key, url) {
  if (registry.get(key)) return registry.get(key).view;
  ensureSession();
  const view = new WebContentsView({
    webPreferences: {
      session: sess,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      safeDialogs: true, // 防 alert 洪水
      focusOnNavigation: false, // U1 实证:阻止 loadURL 完成抢焦点（#42578）
      // 零 preload——远程内容碰不到任何本地能力（KD-4）
    },
  });
  const rec = { view, url: url || null, title: '新标签页', favicon: null, loading: false, audible: false, canGoBack: false, canGoForward: false, error: null };
  registry.set(key, rec);
  wireViewEvents(key, view);
  return view;
}

function wireViewEvents(key, view) {
  const wc = view.webContents;
  // file:// 三层封死之二：will-navigate + will-redirect + will-frame-navigate（KD-4）。
  // ⚠ Electron 42:这三个事件的 URL 在**第一个参数**(Event 对象,同时带 .url 和 .preventDefault());
  // 第二个位置参数是 deprecated 的 url 字符串。读错参数(details.url)会永远 undefined → 无条件 preventDefault
  // → 拦掉所有站内跳转/重定向/iframe(http→https、OAuth、点链接全废)。security review 抓的,e2e 补真链接点击。
  const guard = (e) => { if (!policy.isAllowedNavUrl(e && e.url)) e.preventDefault(); };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  if (wc.on) wc.on('will-frame-navigate', guard);

  wc.on('did-start-loading', () => { const r = registry.get(key); if (r) { r.loading = true; r.error = null; pushUpdate(key); } });
  wc.on('did-stop-loading', () => { const r = registry.get(key); if (r) { r.loading = false; syncNav(key); pushUpdate(key); } });
  wc.on('page-title-updated', (_e, title) => { const r = registry.get(key); if (r) { r.title = title || r.url || '新标签页'; pushUpdate(key); } });
  wc.on('page-favicon-updated', (_e, favicons) => {
    const r = registry.get(key); if (!r) return;
    const pick = policy.pickFavicon(favicons, r._faviconSrc);
    if (pick) { r._faviconSrc = pick; fetchFavicon(key, pick); }
  });
  const onNav = (url) => { const r = registry.get(key); if (r && url) { r.url = url; syncNav(key); pushUpdate(key); } };
  wc.on('did-navigate', (_e, url) => onNav(url));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) onNav(url); });
  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (policy.classifyLoadFailure(code, isMainFrame) === 'error-page') {
      const r = registry.get(key); if (r) { r.loading = false; r.error = { code, desc, url: validatedURL }; pushUpdate(key); }
    }
  });
  wc.on('render-process-gone', (_e, details) => {
    if (!policy.isRealCrash(details && details.reason)) return;
    const r = registry.get(key); if (r) { r.error = { code: 'crash', desc: (details && details.reason) || 'crashed', url: r.url }; pushUpdate(key); }
  });
  wc.on('audio-state-changed', (e) => { const r = registry.get(key); if (r) { r.audible = !!(e && e.audible); pushUpdate(key); } });

  // window.open：deny 原生弹窗 + 通知 renderer 建新标签走漏斗（KD-15,主进程不直接建 view）
  wc.setWindowOpenHandler((details) => {
    if (policy.isAllowedNavUrl(details.url)) {
      const background = details.disposition === 'background-tab';
      sendToRenderer('web-open-request', { url: details.url, background });
    }
    return { action: 'deny' };
  });
}

function syncNav(key) {
  const r = registry.get(key); if (!r) return;
  const nh = r.view.webContents.navigationHistory;
  try { r.canGoBack = nh ? nh.canGoBack() : r.view.webContents.canGoBack(); } catch { r.canGoBack = false; }
  try { r.canGoForward = nh ? nh.canGoForward() : r.view.webContents.canGoForward(); } catch { r.canGoForward = false; }
}

// ---- 显示/隐藏/销毁 ----
function show(key, bounds) {
  const win = getWin(); if (!win || win.isDestroyed()) return;
  const rec = registry.get(key); if (!rec) return;
  const children = win.contentView.children;
  // 排他:先摘掉其它所有 web view（同一时刻最多一个 attach）
  for (const [k, r] of registry) { if (k !== key && children.indexOf(r.view) !== -1) win.contentView.removeChildView(r.view); }
  // re-add 已存在的 view = 提到最顶（官方 z-order）;不存在则新挂。
  win.contentView.addChildView(rec.view);
  if (bounds) rec.view.setBounds(bounds);
  rec.view.setVisible(true);
}
function setBounds(key, bounds) { const r = registry.get(key); if (r && bounds) { try { r.view.setBounds(bounds); } catch { /* view 已销毁 */ } } }
function setVisible(key, visible) { const r = registry.get(key); if (r) { try { r.view.setVisible(visible); } catch { /* view 已销毁 */ } } }
function hide(key) {
  const win = getWin(); const rec = registry.get(key); if (!win || !rec) return;
  // 窗口/view 可能已销毁（如 'closed' 事件里跑 destroyAll）→ 访问 contentView 会抛「Object has been destroyed」。
  try {
    if (win.isDestroyed()) return;
    if (win.contentView.children.indexOf(rec.view) !== -1) win.contentView.removeChildView(rec.view);
  } catch { /* 窗口/view 已销毁,无需 detach */ }
}
function destroy(key) {
  const rec = registry.get(key); if (!rec) return;
  hide(key);
  try { if (rec.view.webContents && !rec.view.webContents.isDestroyed()) rec.view.webContents.close(); } catch { /* 已销毁 */ } // 显式 close,否则内存泄漏
  registry.delete(key);
}
function destroyAll() { for (const key of Array.from(registry.keys())) destroy(key); }

// ---- 导航操作 ----
const urlInput = require('../lib/url-input');
function navigate(key, input, opts) {
  const rec = registry.get(key) || { view: createView(key, null) } && registry.get(key);
  const parsed = urlInput.parse(input, opts || {});
  if (parsed.kind === 'blocked') return { blocked: true };
  const r = registry.get(key);
  r.url = parsed.url; r.error = null;
  r.view.webContents.loadURL(parsed.url); // noop rejection 已内附,不必 catch
  pushUpdate(key);
  return { url: parsed.url };
}
function loadUrlDirect(key, url) { // 书签/历史命中/恢复重载：URL 已知,仍过 scheme 守卫
  if (!policy.isAllowedNavUrl(url)) return { blocked: true };
  createView(key, url);
  const r = registry.get(key); r.url = url; r.error = null;
  r.view.webContents.loadURL(url);
  pushUpdate(key);
  return { url };
}
function nav(key, action) {
  const r = registry.get(key); if (!r) return;
  const wc = r.view.webContents; const nh = wc.navigationHistory;
  if (action === 'back') { nh && nh.canGoBack() ? nh.goBack() : wc.canGoBack() && wc.goBack(); }
  else if (action === 'forward') { nh && nh.canGoForward() ? nh.goForward() : wc.canGoForward() && wc.goForward(); }
  else if (action === 'reload') wc.reload();
  else if (action === 'stop') wc.stop();
  else if (action === 'undo') wc.undo();   // 转发网页内文本框撤销（KD-7:菜单吞了 Cmd+Z,不转发=杀死网页撤销）
  else if (action === 'redo') wc.redo();
}
function find(key, text, opts) { const r = registry.get(key); if (r && text) r.view.webContents.findInPage(text, opts || {}); }
function stopFind(key, action) { const r = registry.get(key); if (r) r.view.webContents.stopFindInPage(action || 'clearSelection'); }
function setAudioMutedAll(muted) { for (const r of registry.values()) { try { r.view.webContents.setAudioMuted(muted); } catch { /* ignore */ } } }
// 网页导出 PDF（KD-7）：printToPDF → 存进下载目录（复用下载的清洗/去重）+ 推 toast。返回落盘路径。
async function printToPdf(key) {
  const r = registry.get(key); if (!r) return null;
  const buf = await r.view.webContents.printToPDF({ printBackground: true });
  const dir = downloadDir || path.join(os.homedir(), 'Downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const base = policy.safeFilename((r.title || 'webpage').replace(/[/\\:*?"<>|]/g, '_').slice(0, 60) + '.pdf');
  const out = policy.uniqueName(dir, base, (p) => fs.existsSync(p));
  if (!policy.isInsideDir(dir, out)) return null; // 防御纵深:与 will-download 同一道越界闸(security review 建议对齐)
  fs.writeFileSync(out, buf);
  sendToRenderer('web-download', { state: 'completed', name: path.basename(out), savePath: out, received: buf.length, total: buf.length });
  return out;
}

function wireFoundInPage(key) {
  const r = registry.get(key); if (!r) return;
  r.view.webContents.on('found-in-page', (_e, result) => {
    if (result.finalUpdate) sendToRenderer('web-found', { key, matches: result.matches, active: result.activeMatchOrdinal });
  });
}

// ---- 快照（before-quit 合并落盘用；权威 url/title 在 registry,不走 renderer 三跳,KD-11）----
function snapshot() {
  const out = {};
  for (const [key, r] of registry) out[key] = { url: r.url, title: r.title };
  return out;
}
function hasActiveDownloads() { return activeDownloads.size > 0; }

module.exports = {
  init, setDownloadDir, createView, show, hide, setBounds, setVisible, destroy, destroyAll,
  navigate, loadUrlDirect, nav, find, stopFind, wireFoundInPage, setAudioMutedAll, printToPdf,
  snapshot, hasActiveDownloads, _registry: registry,
};
