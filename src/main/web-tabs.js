// 网页标签的主进程 view 管理器 + 安全 session（KD-2/4/11/13/14/15）。
// 一个 registry 管完：view 生命周期 + 导航事件权威副本 + 安全边界（独立 session/零 preload/默认拒权限/
// file:// 三层封死/下载清洗）。纯决策逻辑在 src/lib/web-tabs-policy.js（可单测）,这里只做 electron 副作用。
//
// 关键不变式：
//  - view 是可丢弃的渲染面,tab 状态在 renderer/store。惰性创建,关标签/切工作区 destroy。
//  - webContents 永不自动销毁（官方明示会泄漏）→ 关闭路径显式 webContents.close()。
//  - url/title/favicon 权威副本在这（registry）,renderer 只做 UI 镜像;before-quit 从这合并落盘。
//  - 主进程永不直接 attach view：show() 是唯一 attach 入口,由 renderer 的 activate 漏斗驱动（KD-5）。
const { WebContentsView, session, net, shell, dialog, Menu, clipboard, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const policy = require('../lib/web-tabs-policy');
const webHistory = require('../lib/web-history');
const ctxMenu = require('../lib/web-context-menu');

const PARTITION = 'persist:webtabs';
const registry = new Map(); // key -> { view, url, title, favicon, loading, audible, canGoBack, canGoForward }
let getWin = () => null;

// 浏览历史（U6 尾）:权威副本在主进程(和 url/title 同源),ipc 注册持久化钩子(防抖写盘 + 退出同步 flush)。
let history = [];
let onHistoryChange = null;
function historyChanged() { if (onHistoryChange) onHistoryChange(); }
function getHistory() { return history; }
function loadHistory(arr) { history = webHistory.sanitize(arr); }
function setHistoryHook(fn) { onHistoryChange = fn; }
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
  if (ctxProbeOn()) global.__ws2CtxAction = executeCtxAction; // e2e 探针：右键前也能直接调动作出口
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
  wc.on('did-finish-load', () => { fitToWidth(key); }); // 宽页自动缩放适配(Colin:别让用户横滚)
  // MRU 切换器(Ctrl+Tab)落定信号:web view 聚焦时 renderer DOM keyup 全死(KD-8)→ 主进程转发松 Ctrl。
  wc.on('before-input-event', (_e, input) => { if (input && input.type === 'keyUp' && input.key === 'Control') sendToRenderer('web-ctrl-up'); });
  wc.on('page-title-updated', (_e, title) => {
    const r = registry.get(key); if (!r) return;
    r.title = title || r.url || '新标签页'; pushUpdate(key);
    if (title && r.url) { history = webHistory.touchTitle(history, r.url, title); historyChanged(); } // 晚到的真标题补进历史
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    const r = registry.get(key); if (!r) return;
    const pick = policy.pickFavicon(favicons, r._faviconSrc);
    if (pick) { r._faviconSrc = pick; fetchFavicon(key, pick); }
  });
  const onNav = (url) => {
    const r = registry.get(key); if (!r || !url) return;
    r.url = url; syncNav(key); pushUpdate(key);
    // 浏览历史(U6 尾:进 Cmd+P)。add 只认 http/https,错误页/about:blank 自动不进。
    history = webHistory.add(history, { url, title: r.title, ts: Date.now() });
    historyChanged();
  };
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

  // 右键菜单（U-hardening）：原生 Menu.popup（DOM 菜单会被 native view 盖住，看不见）。
  wc.on('context-menu', (_e, params) => openCtxMenu(key, params));
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
  if (bounds) { rec.view.setBounds(bounds); scheduleRefit(key); } // attach 时视口宽度可能变了(侧栏收展/换窗口尺寸)
  rec.view.setVisible(true);
}
function setBounds(key, bounds) { const r = registry.get(key); if (r && bounds) { try { r.view.setBounds(bounds); scheduleRefit(key); } catch { /* view 已销毁 */ } } }
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
  const parsed = urlInput.parse(input, opts || {});
  if (parsed.kind === 'blocked') return { blocked: true }; // 先判 blocked,别为拒绝的输入白建 view(adversarial:潜在泄漏)
  createView(key, null);
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

// ---- 右键菜单（U-hardening）----
// 挂钩点 wireViewEvents 的 context-menu 事件 → 纯逻辑 builder 算 template → 原生 Menu.popup。
// 每个条目的动作都收敛到 executeCtxAction 这唯一出口（e2e 直接调它，与菜单 click 同一路径）。
function ctxProbeOn() { try { return !!process.env.WS2_CTXMENU_PROBE && !app.isPackaged; } catch { return false; } }
function openCtxMenu(key, params) {
  const rec = registry.get(key); if (!rec) return;
  const p = params || {};
  const sub = { linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType, selectionText: p.selectionText, isEditable: p.isEditable, x: p.x, y: p.y };
  const ctx = { canGoBack: rec.canGoBack, canGoForward: rec.canGoForward, pageUrl: rec.url, isAllowedUrl: policy.isAllowedNavUrl };
  const template = ctxMenu.buildCtxTemplate(sub, ctx);
  if (ctxProbeOn()) { global.__ws2LastCtxMenu = { key, params: sub, template }; global.__ws2CtxAction = executeCtxAction; return; } // e2e 探针：不弹菜单，存捕获
  const win = getWin(); if (!win || win.isDestroyed()) return;
  const items = template.map((it) => it.type === 'separator'
    ? { type: 'separator' }
    : { label: it.label, enabled: it.enabled !== false, click: () => executeCtxAction(key, it.id, it.args) });
  try { Menu.buildFromTemplate(items).popup({ window: win }); } catch { /* 窗口销毁中 */ } // 不传 x/y = 弹在鼠标处
}
// 唯一动作出口。open/download/search 类动作内部重校验 URL（防御纵深，不信 template 回传的 args）。未知 id 静默 no-op。
function executeCtxAction(key, id, args) {
  const rec = registry.get(key); if (!rec) return;
  const wc = rec.view && rec.view.webContents; if (!wc || wc.isDestroyed()) return;
  const a = args || {};
  switch (id) {
    case 'open-link': if (policy.isAllowedNavUrl(a.url)) sendToRenderer('web-open-request', { url: a.url, background: false }); break;
    case 'open-link-bg': if (policy.isAllowedNavUrl(a.url)) sendToRenderer('web-open-request', { url: a.url, background: true }); break;
    case 'copy-link': clipboard.writeText(urlInput.cleanShareUrl(a.url || '')); break;
    case 'copy-image': wc.copyImageAt(a.x, a.y); break;
    case 'copy-image-url': if (policy.isAllowedNavUrl(a.url)) clipboard.writeText(a.url); break;
    case 'save-image': if (policy.isAllowedNavUrl(a.url)) wc.downloadURL(a.url); break; // 走 will-download 清洗
    case 'copy-selection': wc.copy(); break;
    case 'search-selection': { const u = urlInput.searchUrl(String(a.text || '')); if (policy.isAllowedNavUrl(u)) sendToRenderer('web-open-request', { url: u, background: false }); break; }
    case 'cut': wc.cut(); break;
    case 'copy': wc.copy(); break;
    case 'paste': wc.paste(); break;
    case 'select-all': wc.selectAll(); break;
    case 'nav-back': nav(key, 'back'); break;
    case 'nav-forward': nav(key, 'forward'); break;
    case 'reload': nav(key, 'reload'); break;
    case 'copy-page-url': clipboard.writeText(urlInput.cleanShareUrl(rec.url || '')); break;
    case 'clip-page': sendToRenderer('web-clip-request', { key }); break;
    case 'export-pdf': printToPdf(key); break;
    default: break;
  }
}

// 宽页自动缩放适配（Colin 2026-07-08:固定宽度老站(如 baidu 桌面版)比网页区宽会出横滚,嵌在编辑器里
// 该像手机浏览器 shrink-to-fit）。只缩不放:zoom' = min(1, zoom * 视口宽/内容宽),下限 0.65(再小没法读,
// 宁可留横滚),溢出 <2% 不动(别为一像素抖)。did-finish-load + 视口变宽窄(setBounds)都重算,收敛稳定。
async function fitToWidth(key) {
  const r = registry.get(key); if (!r) return;
  const wc = r.view && r.view.webContents;
  if (!wc || wc.isDestroyed()) return;
  try {
    // 先回 zoom 1 量**自然宽度**——zoom 在 session 里按 origin 延续,若在缩小态下量,流式页永远
    // 报告 dw≈vw、算不出「其实 1x 就放得下」,会被钉死在缩小态(e2e 抓的:宽页→窄页不回弹)。
    if ((wc.getZoomFactor() || 1) !== 1) wc.setZoomFactor(1);
    const m = await wc.executeJavaScript(
      'new Promise((res) => requestAnimationFrame(() => res({ vw: window.innerWidth, dw: Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, document.body ? document.body.scrollWidth : 0) })))',
      true,
    );
    if (!m || !m.vw || !m.dw) return;
    if (m.dw <= m.vw * 1.02) return;                    // 自然宽度放得下 → 保持 1(溢出 <2% 不为一像素抖)
    wc.setZoomFactor(Math.max(0.65, m.vw / m.dw));      // 缩到正好放下;下限 0.65(再小没法读,宁可留横滚)
  } catch { /* 页面导航中/被销毁,下个 load 再算 */ }
}
let fitTimer = null;
function scheduleRefit(key) { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitToWidth(key), 250); }

// 网页存成本地文档（融合核心桥,Colin 拍板「正经剪藏」）：用 Mozilla Readability(Firefox 阅读模式那套)
// 抽正文——保留图片(绝对 URL)/行内链接/标题层级,产出干净可读可编辑的文章。抽取跑在不可信页面上下文;
// 抽完在页面里就地 sanitize(去 script/style/iframe/on*/javascript:)再回传。没正文的页面(如 baidu 首页)
// 回 {empty:true} → renderer 降级成链接收藏。
let READABILITY_SRC = null; // 懒加载 + 兜底:vendor 文件万一在打包里缺失,只让剪藏失效,别在 require 期崩整个主进程
function readabilitySrc() {
  if (READABILITY_SRC === null) {
    try { READABILITY_SRC = fs.readFileSync(path.join(__dirname, 'vendor', 'readability.js'), 'utf8'); }
    catch (e) { READABILITY_SRC = ''; }
  }
  return READABILITY_SRC;
}
async function extractReadable(key) {
  const r = registry.get(key); if (!r) return null;
  const wc = r.view && r.view.webContents;
  if (!wc || wc.isDestroyed()) return null;
  const src = readabilitySrc();
  if (!src) return { error: 'readability-unavailable' };
  try {
    await wc.executeJavaScript(src, true); // 注入 Readability(guard 了 module,页面里安全)
    const js = '(function(){try{' +
      'var art=null;try{art=new Readability(document.cloneNode(true)).parse();}catch(e){}' +   // 传 clone,构造器会改文档
      'var title=document.title||location.href, url=location.href;' +
      'if(!art||!art.content||(art.textContent||"").replace(/\\s+/g," ").trim().length<80){' +
        'return JSON.stringify({empty:true,title:title,url:url,excerpt:(art&&art.excerpt)||""});' +   // 没正文 → 降级链接
      '}' +
      'var box=document.createElement("div");box.innerHTML=art.content;' +
      'box.querySelectorAll("script,style,iframe,object,embed,form,noscript").forEach(function(n){n.remove();});' +
      'box.querySelectorAll("*").forEach(function(n){Array.prototype.slice.call(n.attributes).forEach(function(a){' +
        'var nm=a.name.toLowerCase();' +
        'if(nm.indexOf("on")===0){n.removeAttribute(a.name);return;}' +
        'if((nm==="href"||nm==="src")&&/^\\s*javascript:/i.test(a.value)){n.removeAttribute(a.name);}' +
      '});});' +
      'return JSON.stringify({title:art.title||title,url:url,content:box.innerHTML,byline:art.byline||"",excerpt:art.excerpt||""});' +
    '}catch(e){return JSON.stringify({error:String(e&&e.message||e),title:document.title,url:location.href});}})()';
    return JSON.parse(await wc.executeJavaScript(js, true));
  } catch (e) { return null; }
}

function wireFoundInPage(key) {
  const r = registry.get(key); if (!r || r._foundWired) return; // 幂等:web-show 每次激活都调,不守会累积 listener 泄漏(adversarial)
  r._foundWired = true;
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
  navigate, loadUrlDirect, nav, find, stopFind, wireFoundInPage, setAudioMutedAll, printToPdf, extractReadable,
  openCtxMenu, executeCtxAction,
  getHistory, loadHistory, setHistoryHook,
  snapshot, hasActiveDownloads, _registry: registry,
};
