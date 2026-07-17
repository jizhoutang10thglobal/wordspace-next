// 网页标签的主进程 view 管理器 + 安全 session（spec §10.2/§11）。
// 一个 registry 管完：view 生命周期 + 导航事件权威副本 + 安全边界（独立 session/零 preload/
// 权限默认拒/loadURL 白名单/下载受控落盘,§4.11）。纯决策逻辑在 src/lib/web-tabs-policy.js（可单测），
// 这里只做 electron 副作用。
//
// 关键不变式：
//  - view 是可丢弃的渲染面,tab 状态在 renderer/store（tabs 持久化里带 url/title）。惰性创建,关标签 destroy。
//  - webContents 永不自动销毁（官方明示会泄漏）→ 关闭路径显式 webContents.close()。
//  - url/title/favicon 权威副本在这（registry）,renderer 只做 UI 镜像（webtab:state 推送驱动）。
//  - 主进程永不自行 attach view：show() 是唯一 attach 入口,由 renderer 的激活漏斗驱动。
//  - 历史只由这里的导航事件写（spec §10.3：历史写入无 renderer 入口）；back/forward 不记（§4.8）。
const { WebContentsView, session, net, dialog, Menu, clipboard, app, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const policy = require('../lib/web-tabs-policy');
const i18n = require('../lib/i18n');
const webHistory = require('../lib/web-history');
const ctxMenu = require('../lib/web-context-menu');
const urlInput = require('../lib/url-input');
const engines = require('../lib/search-engines');
const browserStore = require('./browser-store');
const downloadsLib = require('../lib/downloads');

const PARTITION = 'persist:webtabs';
const registry = new Map(); // key -> { view, url, title, favicon, loading, canGoBack, canGoForward, error, userZoom, _skipRecord, committedUrl, pendingUncommittedUrl }
let getWin = () => null;
let sess = null;
let onHistoryChange = null; // ipc 注册：历史变更 → 持久化 + 推 renderer

// ---- 下载引擎状态（spec §4.11）----
const inflight = new Map(); // id -> DownloadItem（内存实时进度源；store 只在状态迁移时落盘,进度 tick 不写盘）
let dlSeq = 0;
let downloadsHook = null;   // ipc 注册：下载列表变更 → 广播 renderer（照 onHistoryChange 先例）
const DL_PUSH_MS = 250;     // updated 事件很密 → 节流广播（照 updater 血教训,主进程算整包 renderer 增量渲染）
let dlPushTimer = null;

function engineTemplate() { return engines.engineOf(browserStore.getSettings().engine).url; }
function engineName() { return engines.engineOf(browserStore.getSettings().engine).name; }

// ---- 初始化 session（一次）----
function ensureSession() {
  if (sess) return sess;
  sess = session.fromPartition(PARTITION);

  // User-Agent 归一（反 CAPTCHA）：剥掉 Electron 默认 UA 里的 `Electron/…` 和 app 名 token，归一成标准
  // Chrome UA——否则 Google 反滥用把非标准 UA 当 bot、网页搜索反复弹 /sorry + reCAPTCHA（Wendi 2026-07-14）。
  // 只动 persist:webtabs 这一个 session，不碰主窗口/默认 session。session 级设置自动覆盖该 session 的所有 view。
  try { sess.setUserAgent(policy.browserUA(sess.getUserAgent(), app.getName())); } catch { /* 老版本无此 API 就算了 */ }

  // 权限：默认拒绝,极小白名单放行（policy）。request + check 两个 handler 都要设。
  sess.setPermissionRequestHandler((_wc, permission, cb) => cb(policy.permissionAllowed(permission)));
  sess.setPermissionCheckHandler((_wc, permission) => policy.permissionAllowed(permission));
  // 屏幕共享：不给源 = 拒。设备类权限（WebUSB/HID/Serial/BT）走独立机制,一律拒。
  if (sess.setDisplayMediaRequestHandler) sess.setDisplayMediaRequestHandler((_req, cb) => cb({}));
  if (sess.setDevicePermissionHandler) sess.setDevicePermissionHandler(() => false);

  // 下载（spec §4.11）：真接 DownloadItem。同步段（setSavePath 之前）绝不 await——任何 await 之后
  // Electron 已走默认路径/弹框（spike 实证红线）。命名管线（sanitize+uniquify）必须全同步完成。
  sess.on('will-download', (_e, item, wc) => {
    // 1. 未提交 url 回滚（修「地址栏敲下载 URL → navigate 乐观写 r.url 被持久化 → 重启会话恢复静默重下」雷）。
    //    链接点击触发的下载:页面早已 onNav 提交过(pending=null),天然不回滚。
    try { rollbackUncommittedFor(wc); } catch { /* 回滚失败不阻断下载 */ }

    // 2. 下载目录（WS2_DL_DIR 测试 seam → 系统下载 → home 兜底,照 printToPdf/bm-export 先例）。
    const dir = resolveDlDir();

    // 3. 命名管线（全同步）：清洗 → 查重集(真磁盘 ∪ 在途名) → uniquify → setSavePath。
    const raw = downloadsLib.sanitizeFilename(item.getFilename());
    const taken = new Set();
    try { for (const n of fs.readdirSync(dir)) taken.add(n); } catch { /* 目录不存在 → 空集 */ }
    for (const it of inflight.values()) {
      try { const p = it.getSavePath(); if (p) taken.add(path.basename(p)); } catch { /* item 已结束 */ }
    }
    const name = downloadsLib.uniquify(raw, taken);
    const savePath = path.join(dir, name);
    item.setSavePath(savePath); // ⚠ 同步!spike 实证:任何 await 之后就晚了

    // 4. 建条目 → inflight → store → 开始 toast → 推送。
    const id = mkDlId();
    let sizeBytes = 0; try { sizeBytes = item.getTotalBytes() || 0; } catch { /* 无 Content-Length */ }
    let sourceUrl = ''; try { sourceUrl = item.getURL() || ''; } catch { /* */ }
    const entry = { id, filename: name, sourceUrl, sizeBytes, receivedBytes: 0, state: 'downloading', startedAt: Date.now(), savePath };
    inflight.set(id, item);
    browserStore.setDownloads(downloadsLib.capDownloads([entry, ...browserStore.getDownloads()]));
    sendToRenderer('web-toast', i18n.t('browser.dlStarted', { name })); // 收起态兜底:侧栏收起时唯一可见反馈
    flushDownloads(); // 状态迁移即推（不节流）

    // 5. updated：只写内存实时进度、节流广播（不写盘,进度值易失,重启本就翻 interrupted）。
    item.on('updated', () => { pushDownloadsThrottled(); });

    // 6. done：映射终态 + 非 completed 清半截文件（spike 发现残留）+ 更新 store + toast。
    item.on('done', (_e2, state) => {
      inflight.delete(id);
      // spike 实证:state ∈ {'completed','cancelled'(我方 cancel=用户取消),'interrupted'(运行时失败)}。
      const terminal = state === 'completed' ? 'completed' : state === 'cancelled' ? 'canceled' : 'failed';
      if (terminal !== 'completed') { try { fs.unlinkSync(savePath); } catch { /* 半截文件可能已不在 */ } }
      let recv = 0; try { recv = item.getReceivedBytes(); } catch { /* */ }
      browserStore.setDownloads(browserStore.getDownloads().map((e) => (e.id === id ? { ...e, state: terminal, receivedBytes: recv } : e)));
      if (terminal === 'completed') sendToRenderer('web-toast', i18n.t('browser.dlDone', { name }));
      else if (terminal === 'failed') sendToRenderer('web-toast', i18n.t('browser.dlFailed', { name }));
      // 取消不 toast（用户正看着,无需打扰）。
      flushDownloads();
    });
  });

  return sess;
}

function init(winGetter) {
  getWin = winGetter;
  ensureSession();
  if (ctxProbeOn()) global.__ws2CtxAction = executeCtxAction; // e2e 探针：右键前也能直接调动作出口
}
function setHistoryHook(fn) { onHistoryChange = fn; }
function setDownloadsHook(fn) { downloadsHook = fn; }

function sendToRenderer(channel, payload) {
  const win = getWin();
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

// registry → renderer 的合并推送（url/title/favicon/loading/canGoBack/error 合成一条 webtab:state）
function pushUpdate(key) {
  const rec = registry.get(key);
  if (!rec) return;
  sendToRenderer('web-tab-updated', {
    key, url: rec.url, title: rec.title, favicon: rec.favicon,
    loading: rec.loading, canGoBack: rec.canGoBack, canGoForward: rec.canGoForward, error: rec.error || null,
    everCommitted: !!rec.everCommitted, // 首次 did-navigate 才置位——renderer 拿它判「起始页可以让位了」（navigate() 会提前写 url,不能当提交信号）
    navSeq: rec.navSeq || 0, // 提交序号（每 did-navigate +1）：renderer 识别真提交沿 → 错误页恢复只在真提交后重挂 view（P1）
  });
}

// ---- 历史（主进程自动记录，spec §4.8）----
function recordHistory(url, title) {
  const next = webHistory.record(browserStore.getHistory(), { url, title, ts: Date.now() });
  browserStore.setHistory(next);
  if (onHistoryChange) onHistoryChange(next);
}
function touchHistoryTitle(url, title) {
  const cur = browserStore.getHistory();
  const next = webHistory.touchTitle(cur, url, title, Date.now());
  if (next !== cur) {
    browserStore.setHistory(next);
    if (onHistoryChange) onHistoryChange(next);
  }
}

// ---- 拉 favicon → data:URL（renderer CSP img-src 无 https:,主进程拉图转 data 推给标签行/收藏）----
const FAVICON_MAX = 200 * 1024; // favicon 该很小,超 200KB 视为异常不存
async function fetchFavicon(key, url) {
  try {
    // ⚠ 必须走 persist:webtabs session（§11.1 隔离）——`net.fetch` 的 init **没有 session 选项**
    // （Electron 42 d.ts 明示：net.fetch 用默认 session,跨 session 要 ses.fetch()）。原来传
    // `{ session: sess }` 被静默忽略,favicon 请求落默认 session、cookie/cache 跨界。改用 sess.fetch。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000); // 无超时的恶意流式 favicon 会吊住,加 8s 闸
    let resp;
    try { resp = await sess.fetch(url, { signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    if (!resp.ok) return;
    const declared = Number(resp.headers.get('content-length'));
    if (declared && declared > FAVICON_MAX) return; // 声明就超限 → 不缓冲（防无界吃内存）
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > FAVICON_MAX) return; // 没声明长度的兜底：全量拿到再判（arrayBuffer 无流式截断,只能靠 declared 先挡大头）
    const mime = resp.headers.get('content-type') || 'image/x-icon';
    const rec = registry.get(key);
    if (!rec) return;
    rec.favicon = 'data:' + mime + ';base64,' + buf.toString('base64');
    pushUpdate(key);
  } catch { /* 失败静默：favicon 是装饰,标签行回落地球/FavChip */ }
}

// ---- 建 view（惰性,首次导航才调；起始页是 renderer 本地 surface,不建 view）----
// 首绘底色按当前有效主题(暗态深底,亮态白底)。view 是长命的,主题切换后要刷新所有存活 view,
// 否则「先开标签、后切主题」这条常见路径上闪错色（暗态闪白 / 亮态闪黑）。
function viewBgColor() {
  return nativeTheme.shouldUseDarkColors ? '#262220' : '#ffffff';
}
let themeSubscribed = false;
function subscribeTheme() {
  if (themeSubscribed) return;
  themeSubscribed = true;
  nativeTheme.on('updated', () => {
    const bg = viewBgColor();
    for (const rec of registry.values()) {
      try { rec.view.setBackgroundColor(bg); } catch { /* view 可能已销毁 */ }
    }
  });
}

function createView(key, url) {
  if (registry.get(key)) return registry.get(key).view;
  subscribeTheme();
  ensureSession();
  const view = new WebContentsView({
    webPreferences: {
      session: sess,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      safeDialogs: true, // 防 alert 洪水
      focusOnNavigation: false, // 阻止 loadURL 完成抢焦点（Electron #42578 实证）
      // 零 preload——远程内容碰不到任何 Wordspace API（spec §11.1）
    },
  });
  // 首绘前的 WebContentsView 是透明的——不设底色,新标签首次加载的几秒里会把底下的文档透出来
  // （Colin 实测报的「加载中闪回文档」bug 的根因之一）。底色按当前有效主题取,否则暗态切网页标签闪白。
  try { view.setBackgroundColor(viewBgColor()); } catch { /* 老版本无此 API 就算了 */ }
  // title 初始 null,不发明「新标签页」占位——registry 是数据层,title 非空 ⇔ 来自真事件(page-title-updated)。
  // 曾把占位当初值:恢复的标签懒加载起步时,这个假名会顺着 pushUpdate 把侧栏里持久化的真标题(如「Google」)
  // 覆写成「新标签页」闪一下(Wendi 2026-07-17)。下游全有 || url 兜底(历史/PDF/收藏),null 安全。
  const rec = { view, url: url || null, title: null, favicon: null, loading: false, canGoBack: false, canGoForward: false, error: null, navSeq: 0, userZoom: null, _skipRecord: false, committedUrl: null, pendingUncommittedUrl: null };
  registry.set(key, rec);
  wireViewEvents(key, view);
  return view;
}

function wireViewEvents(key, view) {
  const wc = view.webContents;
  // file:// 封死：will-navigate + will-redirect + will-frame-navigate 三处同守（spec §11.3）。
  // ⚠ Electron 42：这三个事件的 URL 在**第一个参数**（Event 对象,同时带 .url 和 .preventDefault()）；
  // 第二个位置参数是 deprecated 的 url 字符串。读错参数会永远 undefined → 无条件 preventDefault
  // → 拦掉所有站内跳转/重定向/iframe（http→https、OAuth、点链接全废）。
  const guard = (e) => { if (!policy.isAllowedNavUrl(e && e.url)) e.preventDefault(); };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  if (wc.on) wc.on('will-frame-navigate', guard);

  wc.on('did-start-loading', () => { const r = registry.get(key); if (r) { r.loading = true; r.error = null; pushUpdate(key); } });
  wc.on('did-stop-loading', () => { const r = registry.get(key); if (r) { r.loading = false; syncNav(key); pushUpdate(key); } });
  wc.on('did-finish-load', () => { fitToWidth(key); }); // 宽页自动缩放适配（Colin 2026-07-08:别让用户横滚）
  wc.on('page-title-updated', (_e, title) => {
    const r = registry.get(key); if (!r) return;
    r.title = title || r.url || i18n.t('dialog.webNewTabTitle'); pushUpdate(key);
    if (title && r.url) touchHistoryTitle(r.url, title); // 晚到的真标题补进历史头条目（§4.8）
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    const r = registry.get(key); if (!r) return;
    const pick = policy.pickFavicon(favicons, r._faviconSrc);
    if (pick) { r._faviconSrc = pick; fetchFavicon(key, pick); }
  });
  // isTop=true 是整页导航（did-navigate）；false 是 SPA 站内路由（did-navigate-in-page,不换 favicon/不重置）。
  const onNav = (url, isTop) => {
    const r = registry.get(key); if (!r || !url) return;
    if (isTop) {
      // 整页导航 → 换站：清 favicon,别让新页无 icon 时挂着上一站图标（轻度 spoof 面,P2-9）。
      // _faviconSrc 也清,否则同 URL 首次 fetch 失败后被 pickFavicon 永久去重、reload 不再拉。
      r.favicon = null; r._faviconSrc = null;
    }
    // navSeq 每次真提交（did-navigate/-in-page）自增——renderer 拿它认「新页刚提交」的沿；
    // did-start-loading / navigate() 的乐观推都不动它,失败载(did-fail-load)与 abort(-3) 更不会 → 恢复
    // 重挂 view 只认这个沿,不会被 204/下载/中止那种「loading 收尾但没提交」的假沿误触发（P1 审查 CONFIRMED）。
    // 真提交 → 记为已提交 url,清未提交标志（will-download 回滚只回滚「乐观写了但没提交」的那种）。
    r.committedUrl = url; r.pendingUncommittedUrl = null;
    r.url = url; r.everCommitted = true; r.navSeq = (r.navSeq || 0) + 1; syncNav(key); pushUpdate(key);
    // 历史：主动导航才记；back/forward 前 nav() 打了 _skipRecord 标志（§4.8 契约）。用后即清,别泄漏。
    if (r._skipRecord) { r._skipRecord = false; return; }
    // ⚠ did-navigate 时 r.title 还是**上一页**的标题（page-title-updated 晚于 did-navigate）——
    // 传它会让历史条目顶着旧标题。传 null,让 web-history 用 url 兜底（§4.8「先用 url 当标题」）,
    // 真标题稍后由 page-title-updated → touchHistoryTitle 补写。
    recordHistory(url, null);
  };
  wc.on('did-navigate', (_e, url) => onNav(url, true));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) onNav(url, false); });
  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (policy.classifyLoadFailure(code, isMainFrame) === 'error-page') {
      const r = registry.get(key); if (r) { r.loading = false; r.error = { code, desc, url: validatedURL }; pushUpdate(key); }
    }
  });
  wc.on('render-process-gone', (_e, details) => {
    if (!policy.isRealCrash(details && details.reason)) return;
    // r.loading=false 必须补（对齐 did-fail-load:208）——渲染进程崩了不会再补发 did-stop-loading,
    // 漏了它 loading 卡 true → U3 标签行 spinner 永久旋转（审查 P2）。
    const r = registry.get(key); if (r) { r.loading = false; r.error = { code: 'crash', desc: (details && details.reason) || 'crashed', url: r.url }; pushUpdate(key); }
  });

  // window.open：deny 原生弹窗；http(s) 链接 → 通知 renderer 建新标签走漏斗（spec §10.2：主进程不直接建 view）。
  // disposition=background-tab（⌘点击）→ 后台标签；其余（target=_blank/window.open）→ 前台（浏览器惯例）。
  wc.setWindowOpenHandler((details) => {
    if (policy.isAllowedNavUrl(details.url)) {
      // 频率闸（P2-7）：Electron 基于 //content,没有 Chrome 的 popup blocker。恶意页
      // setInterval(window.open) 会无界开标签打死 UI。每标签每秒最多 5 个新标签,超了静默丢。
      const r = registry.get(key);
      const now = Date.now();
      if (r) {
        r._openTimes = (r._openTimes || []).filter((t) => now - t < 1000);
        if (r._openTimes.length >= 5) return { action: 'deny' };
        r._openTimes.push(now);
      }
      const background = details.disposition === 'background-tab';
      sendToRenderer('web-open-request', { url: details.url, background });
    }
    return { action: 'deny' };
  });

  // 右键菜单：原生 Menu.popup（DOM 菜单会被 native view 盖住，spec §4.7 硬约束）。
  wc.on('context-menu', (_e, params) => openCtxMenu(key, params));

  // web view 聚焦时 renderer 的 DOM keydown 全死 → 应用级快捷键在这拦截转发（菜单加速器已覆盖的
  // ⌘T/⌘W/⌘P/⌘⇧F/⌘⇧T/⌘S/⌘E 不用管）。只拦我们认识的组合,其余放行给网页（§7 未命中放行）。
  wc.on('before-input-event', (e, input) => {
    if (!input || input.type !== 'keyDown') return;
    const cmd = shortcutOf(input);
    if (!cmd) return;
    e.preventDefault();
    if (cmd === 'zoom-in' || cmd === 'zoom-out' || cmd === 'zoom-reset') {
      setZoom(key, cmd === 'zoom-in' ? 'in' : cmd === 'zoom-out' ? 'out' : 'reset');
      return;
    }
    // 要聚焦 DOM 控件的命令（地址栏/查找条）：show() 刚把焦点给了 view,renderer 的 input.focus()
    // 夺不回窗口级焦点 → 键击仍进网页。转发前先把焦点还给主 webContents（#9）。
    if (cmd === 'focus-address' || cmd === 'web-find') {
      const win = getWin(); if (win && !win.isDestroyed()) { try { win.webContents.focus(); } catch { /* 销毁竞态 */ } }
    }
    sendToRenderer('web-shortcut', { cmd });
  });
}

// before-input-event → 应用命令映射。mac ⌘ = meta,Win/Linux = ctrl（Ctrl+Tab 两边都是 control）。
function shortcutOf(input) {
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const k = String(input.key || '').toLowerCase();
  if (input.control && k === 'tab') return input.shift ? 'cycle-prev' : 'cycle-next';
  if (!mod) return null;
  if (input.shift) return null; // ⌘⇧ 组合都在菜单加速器里（⌘⇧T/⌘⇧F/⌘⇧S）
  if (k === 'l') return 'focus-address';
  if (k === 'd') return 'bookmark-toggle';
  if (k === 'f') return 'web-find';
  // ⌘\ 切换侧栏改由「视图」菜单加速器统一处理（全焦点域，含 web view 聚焦时也触发）——不再这里转发，
  // 否则菜单加速器 + 本转发会双触发（切两次=no-op）。同 §238 注释：菜单已覆盖的命令不在此重复转发。
  if (k === ',') return 'open-settings';
  if (k === '=' || k === '+') return 'zoom-in';
  if (k === '-') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  if (/^[1-9]$/.test(k)) return 'tab-' + k;
  return null;
}

function syncNav(key) {
  const r = registry.get(key); if (!r) return;
  const nh = r.view.webContents.navigationHistory;
  try { r.canGoBack = nh ? nh.canGoBack() : r.view.webContents.canGoBack(); } catch { r.canGoBack = false; }
  try { r.canGoForward = nh ? nh.canGoForward() : r.view.webContents.canGoForward(); } catch { r.canGoForward = false; }
}

// ---- 显示/隐藏/销毁（renderer 激活漏斗驱动）----
function show(key, bounds) {
  const win = getWin(); if (!win || win.isDestroyed()) return;
  const rec = registry.get(key); if (!rec) return;
  const children = win.contentView.children;
  // 排他:先摘掉其它所有 web view（同一时刻最多一个 attach）
  for (const [k, r] of registry) { if (k !== key && children.indexOf(r.view) !== -1) win.contentView.removeChildView(r.view); }
  win.contentView.addChildView(rec.view); // re-add 已存在的 = 提到最顶（官方 z-order）
  if (bounds) { rec.view.setBounds(bounds); scheduleRefit(key); }
  rec.view.setVisible(true);
  try { rec.view.webContents.focus(); } catch { /* 销毁竞态 */ } // 切到网页标签,键盘该进页面
}
function setBounds(key, bounds) { const r = registry.get(key); if (r && bounds) { try { r.view.setBounds(bounds); scheduleRefit(key); } catch { /* view 已销毁 */ } } }
function hide(key) {
  const win = getWin(); const rec = registry.get(key); if (!win || !rec) return;
  try {
    if (win.isDestroyed()) return;
    if (win.contentView.children.indexOf(rec.view) !== -1) win.contentView.removeChildView(rec.view);
  } catch { /* 窗口/view 已销毁,无需 detach */ }
}
function hideAll() { for (const key of registry.keys()) hide(key); }
// 弹层快照（Wendi 2026-07-16「更新弹窗背景变白」）：DOM 弹层要摘 view，renderer 摘之前先拍一帧
// 当垫底背景。必须对 view 自己的 webContents 截（窗口级 capturePage 不合成子 view，实测恒白）。
async function capture(key) {
  const rec = registry.get(key);
  if (!rec) return null;
  try {
    if (rec.view.webContents.isDestroyed()) return null;
    const img = await rec.view.webContents.capturePage();
    if (img.isEmpty()) return null;
    return img.toDataURL();
  } catch { return null; }
}
function destroy(key) {
  const rec = registry.get(key); if (!rec) return;
  hide(key);
  try { if (rec.view.webContents && !rec.view.webContents.isDestroyed()) rec.view.webContents.close(); } catch { /* 已销毁 */ } // 显式 close,否则内存泄漏
  registry.delete(key);
}
function destroyAll() { for (const key of Array.from(registry.keys())) destroy(key); }

// ---- 导航操作 ----
// 地址栏提交：input 原文进来,主进程统一 parse（搜索引擎模板从设置取,单一实现,spec §5 等价实现）。
function navigate(key, input) {
  const parsed = urlInput.parse(input, { searchTemplate: engineTemplate() });
  if (parsed.kind === 'blocked') return { blocked: true }; // 先判 blocked,别为拒绝的输入白建 view
  createView(key, null);
  const r = registry.get(key);
  r.url = parsed.url; r.error = null; r._skipRecord = false; // 兜底清 back/forward 残留标志（P1-1:back 未成行时标志会滞留,吞掉这次正常导航的历史）
  r.pendingUncommittedUrl = parsed.url; // 乐观写了 url 但还没 did-navigate 提交:若这次导航其实是下载,will-download 据此回滚 r.url（修「重启静默重下」雷）
  r.view.webContents.loadURL(parsed.url); // noop rejection 已内附,不必 catch
  pushUpdate(key);
  return { url: parsed.url };
}
// 书签/历史/补全建议/恢复重载：URL 已知,仍过 scheme 守卫（§11.3）。opts.record=false 预留给「会话恢复
// 不记历史」（§4.8 主动导航封闭列表不含恢复）——目前 renderer 未接线,恢复也记一条历史（轻微,且恢复的
// 就是上次看的页,记它并不违和;要真不记需一路穿 sidebar→browser→preload 标记,收益不划算,记欠账）。
function loadUrlDirect(key, url, opts) {
  if (!policy.isAllowedNavUrl(url)) return { blocked: true };
  createView(key, url);
  const r = registry.get(key); r.url = url; r.error = null;
  r._skipRecord = opts && opts.record === false; // 恢复不记；其余清零（兜底 back 残留）
  r.pendingUncommittedUrl = url; // 同 navigate:正常页面加载会在 did-navigate 清掉;真是下载则 will-download 回滚
  r.view.webContents.loadURL(url);
  pushUpdate(key);
  return { url };
}
function nav(key, action) {
  const r = registry.get(key); if (!r) return;
  const wc = r.view.webContents; const nh = wc.navigationHistory;
  // ⚠ 只有**真的会导航**时才置 _skipRecord（P1-1）：双击到栈底 canGoBack=false 时不置,否则标志
  // 滞留、吞掉下一次正常导航的历史。
  if (action === 'back') { const can = nh ? nh.canGoBack() : wc.canGoBack(); if (can) { r._skipRecord = true; nh ? nh.goBack() : wc.goBack(); } }
  else if (action === 'forward') { const can = nh ? nh.canGoForward() : wc.canGoForward(); if (can) { r._skipRecord = true; nh ? nh.goForward() : wc.goForward(); } }
  else if (action === 'reload') wc.reload(); // 刷新记历史（60s 合并兜着不刷屏，§4.8）
  else if (action === 'stop') wc.stop();
  else if (action === 'undo') wc.undo();   // 菜单吞了 Cmd+Z,不转发=杀死网页文本框撤销
  else if (action === 'redo') wc.redo();
}
function find(key, text, opts) {
  const r = registry.get(key);
  if (!r || !text) return;
  // ⚠ Electron 42 实测怪癖：显式传 findNext:false 会让 found-in-page **静默不发**（无事件无报错）；
  // 首次请求必须省略 findNext,只有「下一个/上一个」跟进请求才传 findNext:true。
  const o = { forward: !opts || opts.forward !== false };
  if (opts && opts.findNext) o.findNext = true;
  r.view.webContents.findInPage(text, o);
}
function stopFind(key, action) { const r = registry.get(key); if (r) r.view.webContents.stopFindInPage(action || 'clearSelection'); }
function wireFoundInPage(key) {
  const r = registry.get(key); if (!r || r._foundWired) return; // 幂等:防重复挂 listener 泄漏
  r._foundWired = true;
  r.view.webContents.on('found-in-page', (_e, result) => {
    if (result.finalUpdate) sendToRenderer('web-found', { key, matches: result.matches, active: result.activeMatchOrdinal });
  });
}

// ---- 缩放（spec §4.6：每标签独立、±0.1、0.5–2、⌘0 复位）----
function setZoom(key, dir) {
  const r = registry.get(key); if (!r) return;
  const wc = r.view.webContents;
  if (wc.isDestroyed()) return;
  const next = policy.nextZoom(wc.getZoomFactor() || 1, dir);
  r.userZoom = next; // 用户手动缩放后,fitToWidth 不再自动动它
  try { wc.setZoomFactor(next); } catch { /* 销毁竞态 */ }
}

// 网页导出 PDF（右键菜单）：printToPDF → 保存对话框（spec §4.7；下载已砍,不走下载目录）。
// single-flight（P2-6）：连点两次导出会叠两个 printToPDF + 两个保存框；rec._pdfBusy 挡住。
async function printToPdf(key) {
  const r = registry.get(key); if (!r) return null;
  if (r._pdfBusy) return { busy: true };
  const wc = r.view.webContents;
  if (wc.isDestroyed()) return null;
  r._pdfBusy = true;
  try {
    const buf = await wc.printToPDF({ printBackground: true });
    const win = getWin();
    const leaf = policy.safeFilename(r.title || 'webpage') + '.pdf';
    const seamPath = !app.isPackaged ? process.env.WS2_PDF_OUT : null; // 测试 seam,照 export-pdf 先例
    let out = seamPath;
    if (!out) {
      let defDir;
      try { defDir = app.getPath('downloads'); } catch { defDir = app.getPath('home'); }
      const picked = await dialog.showSaveDialog(win, {
        title: i18n.t('dialog.exportPdfTitle'),
        defaultPath: path.join(defDir, leaf),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (picked.canceled || !picked.filePath) return { canceled: true };
      out = picked.filePath;
    }
    fs.writeFileSync(out, buf);
    if (!seamPath) shell.showItemInFolder(out);
    return { ok: true, path: out };
  } finally {
    r._pdfBusy = false; // registry 里的 rec 引用即使标签已关也安全（局部 r）
  }
}
// 全部 web view 静音/取消静音（P2-11：macOS 关窗=隐藏驻留,view 保活,别让后台网页继续放声）。
function setAllAudioMuted(muted) {
  for (const r of registry.values()) {
    try { if (r.view.webContents && !r.view.webContents.isDestroyed()) r.view.webContents.setAudioMuted(muted); } catch { /* 销毁竞态 */ }
  }
}

// ---- 下载引擎（spec §4.11）----
function mkDlId() { return Date.now().toString(36) + '-' + (++dlSeq).toString(36); } // 时间戳+seq:跨重启防撞,同 ms 多下载不撞（照 mkWebId 先例）
function resolveDlDir() {
  if (!app.isPackaged && process.env.WS2_DL_DIR) return process.env.WS2_DL_DIR; // 测试 seam,e2e 全程写 tmpdir
  try { return app.getPath('downloads'); } catch { return app.getPath('home'); }
}

// will-download 里找 wc 对应的 registry key,若有未提交乐观 url → 回滚。
// 回滚目标 = 上一个已提交 url(committedUrl),无则 null(=起始页,与 fresh web 条目的 url:null 一致；
// ⚠ 不用 'wordspace://newtab' 字面 sentinel——那是真值 url,会被 activate 当真地址加载→被 policy 拦成错误页。
// u3-design 举它作例但真 app 里 fresh 标签的 entry.url 就是 null，回滚到 null 才让 renderer 显起始页）。
function rollbackUncommittedFor(wc) {
  if (!wc) return; // sess.downloadURL(retry) 触发时 wc 可能为空 → 无标签可回滚
  for (const [key, rec] of registry) {
    if (rec.view && rec.view.webContents === wc) {
      if (rec.pendingUncommittedUrl) {
        rec.url = rec.committedUrl || null;
        rec.pendingUncommittedUrl = null;
        pushUpdate(key);
      }
      return;
    }
  }
}

// 节流广播（updated tick）——250ms 合并；状态迁移走 flushDownloads 即推。
function pushDownloadsThrottled() {
  if (!downloadsHook || dlPushTimer) return;
  dlPushTimer = setTimeout(() => { dlPushTimer = null; if (downloadsHook) downloadsHook(downloadsList()); }, DL_PUSH_MS);
}
function flushDownloads() {
  if (dlPushTimer) { clearTimeout(dlPushTimer); dlPushTimer = null; }
  if (downloadsHook) downloadsHook(downloadsList());
}

// fileMissing 懒检测:completed 且非在途的条目,savePath 不在磁盘 → 就地标 fileMissing 写回 store（popover 开时 sweep）。
function sweepMissing(stored) {
  let changed = false;
  const swept = stored.map((e) => {
    if (e.state === 'completed' && e.savePath && !inflight.has(e.id)) {
      let exists = true;
      try { exists = fs.existsSync(e.savePath); } catch { exists = true; } // 判不了就当在,别误标缺失
      if (!exists) { changed = true; return { ...e, state: 'fileMissing' }; }
    }
    return e;
  });
  if (changed) browserStore.setDownloads(swept);
  return changed ? swept : stored;
}

// 展示列表 = store 全量 + 在途叠加内存实时进度,按 startedAt 倒序。
function downloadsList() {
  const stored = sweepMissing(browserStore.getDownloads());
  return stored
    .map((e) => {
      const item = inflight.get(e.id);
      if (!item) return e;
      let recv = e.receivedBytes; let total = e.sizeBytes;
      try { recv = item.getReceivedBytes(); } catch { /* */ }
      try { const t = item.getTotalBytes(); if (t) total = t; } catch { /* */ }
      return { ...e, receivedBytes: recv, sizeBytes: total };
    })
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function dlCancel(id) {
  const item = inflight.get(String(id));
  if (item) { try { item.cancel(); } catch { /* 已结束 */ } } // done(cancelled) 回调收尾（清半截+终态+push）
}
function dlRetry(id) {
  const e = browserStore.getDownloads().find((x) => x.id === String(id));
  if (!e || !e.sourceUrl) return;
  ensureSession();
  try { sess.downloadURL(e.sourceUrl); } catch { /* 会话不可用 */ } // 触发新 will-download → 新条目置顶（不动老条目,spec）
}
function dlClear() { // 只清终态,在途保留
  browserStore.setDownloads(browserStore.getDownloads().filter((e) => e.state === 'downloading'));
  flushDownloads();
}
function dlRemove(id) { // 单条移除:id 命中且非在途才删（在途不可单条移除,只能取消）
  browserStore.setDownloads(browserStore.getDownloads().filter((e) => e.id !== String(id) || e.state === 'downloading'));
  flushDownloads();
}
function dlReveal(id) {
  const e = browserStore.getDownloads().find((x) => x.id === String(id));
  if (!e) return { ok: false, missing: true };
  let exists = false;
  try { exists = !!(e.savePath && fs.existsSync(e.savePath)); } catch { exists = false; }
  if (exists) { try { shell.showItemInFolder(e.savePath); } catch { /* 系统调用失败 */ } return { ok: true }; } // §11.5 红线:只定位不打开
  browserStore.setDownloads(browserStore.getDownloads().map((x) => (x.id === String(id) ? { ...x, state: 'fileMissing' } : x)));
  flushDownloads();
  return { ok: false, missing: true };
}

// ---- 右键菜单（原生）----
function ctxProbeOn() { try { return !!process.env.WS2_CTXMENU_PROBE && !app.isPackaged; } catch { return false; } }
function openCtxMenu(key, params) {
  const rec = registry.get(key); if (!rec) return;
  const p = params || {};
  const sub = { linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType, selectionText: p.selectionText, isEditable: p.isEditable, x: p.x, y: p.y };
  const ctx = { canGoBack: rec.canGoBack, canGoForward: rec.canGoForward, pageUrl: rec.url, engineName: engineName(), isAllowedUrl: policy.isAllowedNavUrl };
  const template = ctxMenu.buildCtxTemplate(sub, ctx);
  if (ctxProbeOn()) { global.__ws2LastCtxMenu = { key, params: sub, template }; global.__ws2CtxAction = executeCtxAction; return; } // e2e 探针：不弹菜单，存捕获
  const win = getWin(); if (!win || win.isDestroyed()) return;
  const items = template.map((it) => it.type === 'separator'
    ? { type: 'separator' }
    : { label: it.label, enabled: it.enabled !== false, click: () => executeCtxAction(key, it.id, it.args) });
  try { Menu.buildFromTemplate(items).popup({ window: win }); } catch { /* 窗口销毁中 */ } // 不传 x/y = 弹在鼠标处
}
// 唯一动作出口（id 白名单收口,spec §11.4）。open/search 类动作内部重校验 URL（防御纵深,不信 template 回传的 args）。
// 未知 id 静默 no-op。
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
    // 存储图片 / 链接另存为（spec §4.11）：防御纵深重校验 url（builder 已过 isAllowedUrl，这里再过一道）→
    // wc.downloadURL 触发 will-download → 汇入单一下载管线（命名/落盘/进度/记录全在那）。
    case 'save-image': if (policy.isAllowedNavUrl(a.url)) wc.downloadURL(a.url); break;
    case 'save-link': if (policy.isAllowedNavUrl(a.url)) wc.downloadURL(a.url); break;
    case 'copy-selection': wc.copy(); break;
    case 'search-selection': { const u = urlInput.searchUrl(String(a.text || ''), engineTemplate()); if (policy.isAllowedNavUrl(u)) sendToRenderer('web-open-request', { url: u, background: false }); break; }
    case 'cut': wc.cut(); break;
    case 'copy': wc.copy(); break;
    case 'paste': wc.paste(); break;
    case 'select-all': wc.selectAll(); break;
    case 'nav-back': nav(key, 'back'); break;
    case 'nav-forward': nav(key, 'forward'); break;
    case 'reload': nav(key, 'reload'); break;
    case 'copy-page-url': clipboard.writeText(urlInput.cleanShareUrl(rec.url || '')); break;
    case 'export-pdf': printToPdf(key); break;
    default: break;
  }
}

// 宽页自动缩放适配（Colin 2026-07-08:固定宽度老站比网页区宽会出横滚,该像手机浏览器 shrink-to-fit）。
// 只缩不放:zoom' = min(1, 视口宽/内容宽),下限 0.65,溢出 <2% 不动。did-finish-load + 视口变化都重算。
// ⚠ 与手动缩放的边界（spec §4.6 每标签手动缩放优先）：用户 ⌘±/⌘0 过（userZoom != null）就不再自动动。
async function fitToWidth(key) {
  const r = registry.get(key); if (!r || r.userZoom != null) return;
  const wc = r.view && r.view.webContents;
  if (!wc || wc.isDestroyed()) return;
  try {
    // 先回 zoom 1 量**自然宽度**——若在缩小态下量,流式页永远报告 dw≈vw、算不出「其实 1x 就放得下」。
    if ((wc.getZoomFactor() || 1) !== 1) wc.setZoomFactor(1);
    const m = await wc.executeJavaScript(
      'new Promise((res) => requestAnimationFrame(() => res({ vw: window.innerWidth, dw: Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, document.body ? document.body.scrollWidth : 0) })))',
      true,
    );
    if (!m || !m.vw || !m.dw) return;
    if (m.dw <= m.vw * 1.02) return;                    // 自然宽度放得下 → 保持 1
    wc.setZoomFactor(Math.max(0.65, m.vw / m.dw));      // 缩到正好放下
  } catch { /* 页面导航中/被销毁,下个 load 再算 */ }
}
let fitTimer = null;
function scheduleRefit(key) { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitToWidth(key), 250); }

module.exports = {
  init, setHistoryHook, setDownloadsHook, createView, show, hide, hideAll, capture, setBounds, destroy, destroyAll,
  navigate, loadUrlDirect, nav, find, stopFind, wireFoundInPage, setZoom, printToPdf,
  openCtxMenu, executeCtxAction, recordHistory, setAllAudioMuted,
  downloadsList, dlCancel, dlRetry, dlClear, dlRemove, dlReveal,
  _registry: registry,
};
