// 浏览器 feature 的 renderer 层（spec docs/browser-feature-spec.md）。跑在父层 shell 作用域
// （classic script，sidebar.js 之后加载）。分工（§10.1）：
//   - 这里管：omnibox+补全 / 收藏区(.sb-fav) / 起始页 / 历史页 / 收藏页 / 设置页 / 查找条 / 缩放键 /
//     导航条 disabled 态 / web view 的激活漏斗（__webActivate/__webDetach）与 bounds 报告。
//   - sidebar.js 管：标签模型（tabState，含 web 条目）、标签行渲染、关闭/重开/循环切换。
//   - 主进程管：WebContentsView 生命周期、loadURL 白名单、导航事件、历史记录、原生右键菜单。
// CSP 约束同 sidebar.js：无 inline style（单 CSSOM 属性 setter 例外），SVG 走 innerHTML。
(function () {
  const T = window.WS2Tabs;
  const H = window.WS2WebHistory;
  const keyOf = T.keyOf;

  // ---- DOM ----
  const mainEl = document.getElementById('main');
  const navBack = document.getElementById('nav-back');
  const navFwd = document.getElementById('nav-fwd');
  const navReload = document.getElementById('nav-reload');
  const navHistory = document.getElementById('nav-history');
  const omniWrap = document.getElementById('sb-omni');
  const omniIco = document.getElementById('omni-ico');
  const omniInput = document.getElementById('omni-input');
  const omniLocal = document.getElementById('omni-local');
  const omniStar = document.getElementById('omni-star');
  const omniSug = document.getElementById('omni-sug');
  const favEl = document.getElementById('sb-fav');
  const favHead = document.getElementById('sb-fav-head');
  const favCount = document.getElementById('sb-fav-count');
  const favManage = document.getElementById('sb-fav-manage');
  const favList = document.getElementById('sb-fav-list');
  const newtabEl = document.getElementById('web-newtab');
  const ntInput = document.getElementById('web-nt-input');
  const ntTiles = document.getElementById('web-nt-tiles');
  const ntPins = document.getElementById('web-nt-pins');
  const errEl = document.getElementById('web-error');
  const errTitle = document.getElementById('web-err-title');
  const errDesc = document.getElementById('web-err-desc');
  const errReload = document.getElementById('web-err-reload');
  const pageEl = document.getElementById('web-page');
  const findBar = document.getElementById('web-findbar');
  const findInput = document.getElementById('web-find-input');
  const findCount = document.getElementById('web-find-count');
  if (!omniInput || !window.ws2 || !window.ws2.webShow) return; // 老 preload/DOM 不齐时安静退场

  // ---- 状态 ----
  const webState = Object.create(null); // key -> { url,title,favicon,loading,canGoBack,canGoForward,error }（主进程镜像）
  const live = new Set(); // 已让主进程建过 view 的 key（防重复 loadURL 重载）
  let attachedKey = null; // 当前 attach 的 web view（null=没有）
  let bmState = { folders: [], bookmarks: [] }; // 收藏镜像（补全/收藏区/起始页共用）
  let histState = []; // 历史镜像（补全/历史页）
  let settings = { engine: 'bing', engines: [] };
  let subPage = null; // 'history' | 'bookmarks' | 'settings' | null
  let findOpen = false;
  let toastInsetTimer = null;
  const BM_BAR = 'bm-bar';

  const sb = () => window.__sbWeb; // sidebar.js 的标签桥（脚本顺序保证已就位）
  const activeEntry = () => (sb() ? sb().active() : null);
  const isWebActive = () => { const e = activeEntry(); return !!(e && T.isWebEntry(e)); };

  // ---- SVG ----
  const GLOBE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const GLOBE12 = GLOBE.replace(/width="13" height="13"/, 'width="12" height="12"');
  const LOCK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const FOLDER_CLOSED = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/></svg>';
  const STAR12 = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3.4a.55.55 0 0 1 1 0l2.4 4.9a.55.55 0 0 0 .4.3l5.4.8a.55.55 0 0 1 .3.9l-3.9 3.8a.55.55 0 0 0-.15.5l.9 5.3a.55.55 0 0 1-.8.6l-4.8-2.5a.55.55 0 0 0-.5 0l-4.8 2.5a.55.55 0 0 1-.8-.6l.9-5.3a.55.55 0 0 0-.15-.5L3 10.3a.55.55 0 0 1 .3-.9l5.4-.8a.55.55 0 0 0 .4-.3z"/></svg>';
  const HIST12 = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>';
  const GLOBE2_14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';
  const X13 = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  const TRASH14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const BACK18 = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const SEARCH14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
  const EXT13 = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
  const FOLDER_PLUS14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>';
  const UPLOAD14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';
  const DOWNLOAD14 = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  const PIN12 = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

  const toast = (msg) => { if (window.__wsToast) window.__wsToast(msg); };

  // ---- FavChip（§4.3 算法：seed=url 的逐字符色相；同 url 永远同色）----
  function favChipEl(title, url, favicon) {
    if (favicon) {
      const img = document.createElement('img');
      img.className = 'fav-favicon';
      img.src = favicon;
      img.alt = '';
      return img;
    }
    const chip = document.createElement('span');
    chip.className = 'fav-chip';
    const seed = String(url || title || '·');
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    chip.style.backgroundColor = 'hsl(' + h + ' 55% 92%)'; // 单 CSSOM 属性，CSP 安全
    chip.style.color = 'hsl(' + h + ' 42% 40%)';
    const first = Array.from(String(title || '').trim())[0];
    chip.textContent = first ? first.toUpperCase() : '·';
    return chip;
  }

  // ---- bounds：view = 侧栏右侧整个内容区（§10.2；无网页头 → 无顶部偏移）----
  // 查找条激活时顶部收缩出条高（原生 view 会盖住 DOM，spec §4.6 推荐方案）；
  // 侧栏全收起时左侧留 52px 条给悬浮展开钮（对齐 ui-demo「收起留窄轨」的意图）。
  const FIND_STRIP = 52;
  const COLLAPSED_STRIP = 52;
  let toastInset = 0;
  function viewBounds() {
    const r = mainEl.getBoundingClientRect();
    let x = Math.round(r.left);
    let width = Math.round(r.width);
    if (document.body.classList.contains('is-sb-collapsed')) { x += COLLAPSED_STRIP; width -= COLLAPSED_STRIP; }
    let y = Math.round(r.top);
    let height = Math.round(r.height);
    if (findOpen) { y += FIND_STRIP; height -= FIND_STRIP; }
    if (toastInset) height -= toastInset;
    return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
  }
  function rebound() { if (attachedKey) window.ws2.webSetBounds(attachedKey, viewBounds()); }
  window.__webRebound = rebound;
  try { new ResizeObserver(() => rebound()).observe(mainEl); } catch { window.addEventListener('resize', rebound); }

  // 主进程推来的 toast（如「不支持下载」）在 view 盖着时会被挡住 → 临时把 view 底部收起一条。
  function toastOverWeb(msg) {
    toast(msg);
    if (!attachedKey) return;
    toastInset = 72;
    rebound();
    clearTimeout(toastInsetTimer);
    toastInsetTimer = setTimeout(() => { toastInset = 0; rebound(); }, 6600);
  }

  // ---- 激活漏斗（sidebar.openTabRow 的 web 分支进来）----
  function surfaceOff() {
    newtabEl.hidden = true;
    errEl.hidden = true;
  }
  function activate(entry) {
    closeSubPage(); // 正在看历史/收藏/设置 → 回主视图（§4.1/§4.3）
    closeFind();
    const key = keyOf(entry);
    if (!entry.url) { // 起始页：本地 surface，不建 view（§4.5.2 懒创建）
      if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; }
      errEl.hidden = true;
      renderNewtab();
      newtabEl.hidden = false;
      setTimeout(() => { try { ntInput.focus(); } catch { /* detached */ } }, 0);
      syncChrome();
      return;
    }
    surfaceOff();
    const st = webState[key];
    if (st && st.error) { // 上次加载失败：显示占位（view 可能空白）
      showError(key, st.error);
    }
    if (!live.has(key)) { live.add(key); window.ws2.webLoadUrl(key, entry.url); } // 恢复的标签懒加载（§8）
    attachedKey = key;
    window.ws2.webShow(key, viewBounds());
    syncChrome();
  }
  function detach() {
    if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; }
    surfaceOff();
    closeFind();
    closeSubPage();
    syncChrome();
  }
  function closeView(key) {
    live.delete(key);
    delete webState[key];
    if (attachedKey === key) attachedKey = null;
    window.ws2.webClose(key);
  }
  window.__webActivate = activate;
  window.__webDetach = detach;
  window.__webCloseView = closeView;
  window.__webIsActive = isWebActive;
  window.__webStatus = (key) => webState[key] || null;
  window.__webEnsureLoaded = (key, url) => { if (!live.has(key) && url) { live.add(key); window.ws2.webLoadUrl(key, url); } }; // 后台标签建 view 加载,不 attach

  function showError(key, err) {
    errTitle.textContent = err.code === 'crash' ? '页面崩溃了' : '页面加载失败';
    errDesc.textContent = (err.url || '') + (err.desc ? '（' + err.desc + '）' : '');
    errEl.hidden = false;
    if (attachedKey === key) { window.ws2.webHideAll(); attachedKey = null; } // 摘掉空白 view 露出占位
  }
  errReload.onclick = () => {
    const e = activeEntry();
    if (!e || !T.isWebEntry(e) || !e.url) return;
    errEl.hidden = true;
    const key = keyOf(e);
    live.add(key);
    window.ws2.webLoadUrl(key, e.url); // 重建/重载
    attachedKey = key;
    window.ws2.webShow(key, viewBounds());
  };

  // ---- 主进程状态推送 ----
  window.ws2.onWebTabUpdated((s) => {
    if (!s || !s.key) return;
    const prev = webState[s.key] || {};
    webState[s.key] = s;
    live.add(s.key); // 有状态推来 = view 已存在
    // 标签行/持久化跟随（url/title 变了才写，防每帧写盘）
    if (sb() && (prev.url !== s.url || prev.title !== s.title || prev.favicon !== s.favicon)) {
      sb().updateWeb(s.key, { url: s.url, title: s.title || s.url || '新标签页' });
    }
    if (s.error && isWebActive() && keyOf(activeEntry()) === s.key) showError(s.key, s.error);
    else if (!s.error && attachedKey === s.key) errEl.hidden = true;
    syncChrome();
  });
  window.ws2.onWebOpenRequest((r) => { // window.open / 右键「新标签页打开」/ 搜索选中
    if (!r || !r.url) return;
    openWeb(r.url, r.url, !!r.background);
    if (r.background) toastOverWeb('已在后台标签页打开');
  });
  window.ws2.onWebToast((msg) => toastOverWeb(String(msg || '')));
  window.ws2.onWebFound((r) => {
    if (!r || !findOpen) return;
    findCount.textContent = r.matches ? (r.active || 0) + '/' + r.matches : '0/0';
    findCount.hidden = false;
  });
  window.ws2.onWebShortcut((r) => { // web view 聚焦时主进程转发的应用快捷键
    const cmd = r && r.cmd;
    if (cmd === 'focus-address') focusOmni();
    else if (cmd === 'bookmark-toggle') toggleBookmark();
    else if (cmd === 'web-find') openFind();
    else if (cmd === 'toggle-sidebar') { const t = document.getElementById('sb-toggle'); if (t) t.click(); }
    else if (cmd === 'open-settings') openSubPage('settings');
    else if (cmd === 'cycle-next') { if (window.__sbHooks && window.__sbHooks.cycleTab) window.__sbHooks.cycleTab(false); }
    else if (cmd === 'cycle-prev') { if (window.__sbHooks && window.__sbHooks.cycleTab) window.__sbHooks.cycleTab(true); }
    else if (/^tab-[1-9]$/.test(cmd || '')) { if (window.__sbHooks && window.__sbHooks.tabByIndex) window.__sbHooks.tabByIndex(+cmd.slice(4)); }
  });

  // ---- 收藏 / 历史镜像 ----
  window.ws2.onBookmarksChanged((s) => { bmState = s || bmState; renderFav(); renderNewtab(); if (subPage === 'bookmarks') renderBookmarksPage(); syncOmniStar(); });
  window.ws2.onHistoryChanged((s) => { histState = Array.isArray(s) ? s : histState; if (subPage === 'history') renderHistoryPage(); });
  (async () => {
    try { bmState = (await window.ws2.bmState()) || bmState; } catch { /* keep default */ }
    try { histState = (await window.ws2.histState()) || histState; } catch { /* keep default */ }
    try { const s = await window.ws2.browserSettings(); if (s) settings = s; } catch { /* keep default */ }
    favEl.hidden = false;
    renderFav();
    syncChrome();
  })();

  // ---- 打开网页的统一入口 ----
  // openWeb：永远新建标签（demo openWebTab 语义）；focusOrOpen：已开同址（含置顶）→ 聚焦（拍板#3）。
  function openWeb(url, title, background) {
    return sb() ? sb().openWeb(url, title, background) : null;
  }
  function focusOrOpen(url, title) {
    if (sb() && sb().focusWebByUrl(url)) return;
    openWeb(url, title, false);
  }
  window.__webOpenInput = (raw) => { // ⌘T modal 的地址行提交：新标签 + 主进程 parse
    const input = String(raw || '').trim();
    if (!input) return;
    const key = openWeb(null, input, false); // 先开新标签（起始页态）
    if (key) submitNavigate(key, input);
  };
  function submitNavigate(key, input) {
    live.add(key);
    window.ws2.webNavigate(key, input).then((r) => {
      if (r && r.blocked) { live.delete(key); toast('不支持打开这类地址'); return; }
      if (attachedKey === null && isWebActive() && keyOf(activeEntry()) === key) {
        attachedKey = key;
        window.ws2.webShow(key, viewBounds());
      }
      newtabEl.hidden = true;
    }).catch(() => {});
  }

  // ---- 导航条（§4.1）----
  function subPageGuard() { if (subPage) closeSubPage(); } // 在子页面点导航 → 先回主视图
  navBack.onclick = () => { subPageGuard(); const e = activeEntry(); if (e && T.isWebEntry(e)) window.ws2.webNav(keyOf(e), 'back'); };
  navFwd.onclick = () => { subPageGuard(); const e = activeEntry(); if (e && T.isWebEntry(e)) window.ws2.webNav(keyOf(e), 'forward'); };
  navReload.onclick = () => { subPageGuard(); const e = activeEntry(); if (e && T.isWebEntry(e) && e.url) window.ws2.webNav(keyOf(e), 'reload'); };
  navHistory.onclick = () => { if (subPage === 'history') closeSubPage(); else openSubPage('history'); };

  // 同步导航条 disabled + omnibox 值/图标/星标。sidebar 每次 renderZones 结束都会调（__webChromeSync）。
  function syncChrome() {
    const e = activeEntry();
    const web = !!(e && T.isWebEntry(e));
    const st = web ? webState[keyOf(e)] : null;
    navBack.disabled = !(web && st && st.canGoBack); // 文档标签暂无导航历史 → 恒灰（§4.1 注）
    navFwd.disabled = !(web && st && st.canGoForward);
    navReload.disabled = !(web && e.url);
    if (!newtabEl.hidden) renderNewtab(); // 起始页可见时刷新置顶快捷行/瓦片
    syncOmni();
  }
  window.__webChromeSync = syncChrome;

  // ---- omnibox（§4.2）----
  let omniTyping = false;
  let sug = []; // 当前建议 [{ kind:'tab'|'bm'|'hist', title, url, key? }]
  let sugSel = -1;
  let sugOriginal = '';
  function tabUrlOf(entry) { // 地址栏显示值：web=url / 文档=本地路径 / 临时=空
    if (!entry) return '';
    if (T.isWebEntry(entry)) return entry.url || '';
    if (entry.rel) return entry.rel;
    if (typeof entry.abs === 'string' && entry.abs.indexOf('temp:') === 0) return '';
    return entry.abs || '';
  }
  function syncOmni() {
    if (omniTyping) return; // 打字中不抢输入
    const e = activeEntry();
    const web = !!(e && T.isWebEntry(e));
    omniInput.value = tabUrlOf(e);
    omniIco.innerHTML = web ? GLOBE : (e && (e.rel || e.abs) && !String(e.abs || '').startsWith('temp:') ? FOLDER_CLOSED : LOCK);
    omniIco.classList.toggle('is-web', web);
    omniLocal.hidden = !(e && !web && (e.rel || (e.abs && !String(e.abs).startsWith('temp:'))));
    syncOmniStar();
    hideSug();
  }
  function syncOmniStar() {
    const e = activeEntry();
    const web = !!(e && T.isWebEntry(e) && e.url); // 起始页不显示星标
    omniStar.hidden = !web;
    if (web) {
      const on = bmState.bookmarks.some((b) => b.url === e.url);
      omniStar.classList.toggle('is-on', on);
      omniStar.title = on ? '取消收藏 (Cmd+D)' : '收藏 (Cmd+D)';
    }
  }
  omniStar.onclick = () => toggleBookmark();
  async function toggleBookmark() { // ⌘D/☆：落书签栏；取消=跨全部文件夹删该 url（§4.6/§4.9）
    const e = activeEntry();
    if (!e || !T.isWebEntry(e) || !e.url) return;
    const st = webState[keyOf(e)] || {};
    if (bmState.bookmarks.some((b) => b.url === e.url)) await window.ws2.bmRemoveByUrl(e.url);
    else await window.ws2.bmAdd({ title: st.title || e.title || e.url, url: e.url, favicon: st.favicon || undefined });
    // bmState 由 bookmarks-changed 推送刷新；星标即时反馈：
    syncOmniStar();
  }

  function focusOmni() { // ⌘L：聚焦并全选（侧栏收起时先展开，§7）
    if (window.__sbHooks && window.__sbHooks.expandSidebar) window.__sbHooks.expandSidebar();
    omniInput.focus();
    omniInput.select();
  }

  // 补全（§4.2）：① 开着的网页标签 → ② 收藏 → ③ 历史，去重合并，≤6 条。
  function computeSug(q) {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out = [];
    const seen = new Set();
    const push = (kind, title, url, key) => {
      if (!url || url === 'wordspace://newtab' || seen.has(url) || out.length >= 6) return;
      seen.add(url);
      out.push({ kind, title: title || url, url, key });
    };
    const hit = (s) => s && s.toLowerCase().includes(term);
    for (const e of (sb() ? sb().entries() : [])) {
      if (T.isWebEntry(e) && e.open && e.url && (hit(e.url) || hit(e.title))) push('tab', e.title, e.url, keyOf(e));
    }
    for (const b of bmState.bookmarks) { if (hit(b.url) || hit(b.title)) push('bm', b.title, b.url); }
    for (const h of H.search(histState, term, 8)) push('hist', h.title, h.url);
    return out;
  }
  function renderSug() {
    if (!sug.length) { hideSug(); return; }
    omniSug.innerHTML = '';
    sug.forEach((s, i) => {
      const row = document.createElement('button');
      row.className = 'sb-omni-sug-row' + (i === sugSel ? ' is-sel' : '');
      const ico = document.createElement('span');
      ico.className = 'sug-ico';
      ico.innerHTML = s.kind === 'tab' ? GLOBE12 : s.kind === 'bm' ? STAR12 : HIST12;
      const t = document.createElement('span');
      t.className = 'sug-title';
      t.textContent = s.title;
      const u = document.createElement('span');
      u.className = 'sug-url';
      u.textContent = String(s.url).replace(/^https?:\/\//i, '');
      row.append(ico, t, u);
      row.onmouseenter = () => { sugSel = i; renderSug(); };
      row.onmousedown = (ev) => { ev.preventDefault(); submitOmni(s); }; // mousedown 防 blur 先触发（demo 同款坑）
      omniSug.appendChild(row);
    });
    omniSug.hidden = false;
  }
  function hideSug() { omniSug.hidden = true; sug = []; sugSel = -1; }

  // 回车提交语义（§4.2）：非网页标签 → 先开新网页标签；网页标签 → 原地导航。
  function submitOmni(pick) {
    const e = activeEntry();
    omniTyping = false;
    hideSug();
    if (pick && pick.kind === 'tab' && pick.key) { // 建议里的「开着的标签」：直接聚焦过去
      const target = (sb() ? sb().entries() : []).find((x) => keyOf(x) === pick.key);
      if (target && window.__sbHooks && window.__sbHooks.openEntryRow) { window.__sbHooks.openEntryRow(target); return; }
    }
    const raw = pick ? pick.url : omniInput.value.trim();
    if (!raw) { syncOmni(); return; }
    omniInput.blur();
    if (e && T.isWebEntry(e)) {
      closeSubPage();
      if (pick) { live.add(keyOf(e)); window.ws2.webLoadUrl(keyOf(e), pick.url); newtabEl.hidden = true; attachIfActive(keyOf(e)); }
      else submitNavigate(keyOf(e), raw);
    } else {
      // 文档/文件/空态：开新网页标签再导航（文档不被顶掉）
      if (pick) focusOrOpen(pick.url, pick.title);
      else window.__webOpenInput(raw);
    }
  }
  function attachIfActive(key) {
    if (isWebActive() && keyOf(activeEntry()) === key) { attachedKey = key; window.ws2.webShow(key, viewBounds()); }
  }
  omniInput.addEventListener('focus', () => { omniInput.select(); });
  omniInput.addEventListener('input', () => {
    omniTyping = true;
    sugOriginal = omniInput.value;
    sug = computeSug(omniInput.value);
    sugSel = -1;
    renderSug();
  });
  omniInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (sug.length) { sugSel = Math.min(sugSel + 1, sug.length - 1); omniInput.value = sug[sugSel].url; renderSug(); }
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (sugSel >= 0) { sugSel--; omniInput.value = sugSel === -1 ? sugOriginal : sug[sugSel].url; renderSug(); }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      submitOmni(sugSel >= 0 ? sug[sugSel] : null);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      omniTyping = false;
      hideSug();
      omniInput.blur();
      syncOmni();
    }
  });
  omniInput.addEventListener('blur', () => {
    setTimeout(() => { omniTyping = false; hideSug(); syncOmni(); }, 150); // 150ms 宽限：点建议的时间窗（§4.2）
  });

  // ---- 收藏区（§4.3）----
  const FAV_OPEN_KEY = 'ws-fav-open';
  let favOpen = localStorage.getItem(FAV_OPEN_KEY) === '1'; // 折叠态持久化（拍板#4），首次默认收起
  function renderFav() {
    favEl.classList.toggle('is-open', favOpen);
    favList.hidden = !favOpen;
    favCount.textContent = String(bmState.bookmarks.length || '');
    if (!favOpen) return;
    favList.innerHTML = '';
    const mkRow = (b) => {
      const row = document.createElement('button');
      row.className = 'sb-fav-row';
      row.title = b.url;
      const chip = favChipEl(b.title, b.url, b.favicon);
      const t = document.createElement('span');
      t.className = 'fav-title';
      t.textContent = b.title;
      row.append(chip, t);
      row.onclick = () => focusOrOpen(b.url, b.title); // 已开则聚焦，否则新标签（拍板#3）
      return row;
    };
    const bar = bmState.bookmarks.filter((b) => b.folderId === BM_BAR);
    for (const b of bar) favList.appendChild(mkRow(b)); // 书签栏平铺（不带文件夹名）
    for (const f of bmState.folders) {
      if (f.id === BM_BAR) continue;
      const items = bmState.bookmarks.filter((b) => b.folderId === f.id);
      if (!items.length) continue; // 空文件夹不渲染
      const g = document.createElement('div');
      g.className = 'sb-fav-group';
      g.textContent = f.name;
      favList.appendChild(g);
      for (const b of items) favList.appendChild(mkRow(b));
    }
    if (!bmState.bookmarks.length) {
      const empty = document.createElement('div');
      empty.className = 'sb-fav-empty';
      empty.textContent = '点地址栏的 ☆ 收藏网页';
      favList.appendChild(empty);
    }
  }
  favHead.onclick = () => {
    favOpen = !favOpen;
    localStorage.setItem(FAV_OPEN_KEY, favOpen ? '1' : '0');
    renderFav();
  };
  favManage.onclick = (ev) => { ev.stopPropagation(); openSubPage('bookmarks'); };

  // ---- 起始页（§4.5.2）----
  function renderNewtab() {
    if (newtabEl.hidden && !(isWebActive() && !activeEntry().url)) { /* 不可见也允许预渲染,开销小 */ }
    ntTiles.innerHTML = '';
    const bar = bmState.bookmarks.filter((b) => b.folderId === BM_BAR).slice(0, 8); // 瓦片=书签栏前 N（拍板#5）
    if (bar.length) {
      for (const b of bar) {
        const tile = document.createElement('button');
        tile.className = 'web-nt-tile';
        tile.title = b.url;
        const chip = favChipEl(b.title, b.url, b.favicon);
        const name = document.createElement('span');
        name.className = 'web-nt-tile-name';
        name.textContent = b.title;
        tile.append(chip, name);
        tile.onclick = () => focusOrOpen(b.url, b.title);
        ntTiles.appendChild(tile);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'web-nt-tiles-empty';
      empty.textContent = '还没有收藏——打开网页后点地址栏的 ☆，就会出现在这里';
      ntTiles.appendChild(empty);
    }
    // 置顶快捷行
    const pinned = (sb() ? sb().entries() : []).filter((x) => x.pinned);
    ntPins.innerHTML = '';
    if (pinned.length) {
      const ic = document.createElement('span');
      ic.innerHTML = PIN12;
      ntPins.appendChild(ic);
      for (const p of pinned) {
        const btn = document.createElement('button');
        btn.className = 'web-nt-pin';
        const t = document.createElement('span');
        t.textContent = p.title;
        btn.appendChild(t);
        btn.onclick = () => { if (window.__sbHooks && window.__sbHooks.openEntryRow) window.__sbHooks.openEntryRow(p); };
        ntPins.appendChild(btn);
      }
      ntPins.hidden = false;
    } else ntPins.hidden = true;
  }
  ntInput.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const raw = ntInput.value.trim();
    if (!raw) return;
    ntInput.value = '';
    const e = activeEntry();
    if (e && T.isWebEntry(e) && !e.url) submitNavigate(keyOf(e), raw); // 起始页标签原地导航
    else window.__webOpenInput(raw);
  });

  // ---- 页内查找（§4.6）----
  function openFind() {
    const e = activeEntry();
    if (!e || !T.isWebEntry(e) || !e.url) return;
    findOpen = true;
    findBar.hidden = false;
    findCount.hidden = true;
    rebound(); // view 顶部收缩出查找条
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    if (!findOpen) return;
    findOpen = false;
    findBar.hidden = true;
    const e = activeEntry();
    if (e && T.isWebEntry(e)) window.ws2.webFindStop(keyOf(e), 'clearSelection');
    rebound();
  }
  function findGo(forward, next) {
    const e = activeEntry();
    if (!e || !T.isWebEntry(e)) return;
    const q = findInput.value;
    if (!q) { findCount.hidden = true; return; }
    window.ws2.webFind(keyOf(e), q, { forward, findNext: next });
  }
  findInput.addEventListener('input', () => { findGo(true, false); });
  findInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); findGo(!ev.shiftKey, true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeFind(); }
  });
  document.getElementById('web-find-prev').onclick = () => findGo(false, true);
  document.getElementById('web-find-next').onclick = () => findGo(true, true);
  document.getElementById('web-find-close').onclick = () => closeFind();

  // ---- 子页面（历史 §4.8 / 收藏管理 §4.9 / 设置 §4.10）----
  function openSubPage(name) {
    subPage = name;
    if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; } // 原生 view 会盖住 DOM → 先摘
    closeFind();
    newtabEl.hidden = true;
    errEl.hidden = true;
    if (name === 'history') renderHistoryPage();
    else if (name === 'bookmarks') renderBookmarksPage();
    else renderSettingsPage();
    pageEl.hidden = false;
  }
  function closeSubPage() {
    if (!subPage) return;
    subPage = null;
    pageEl.hidden = true;
    pageEl.innerHTML = '';
    // 回主视图：激活的是 web 标签 → 重新 attach / 起始页
    const e = activeEntry();
    if (e && T.isWebEntry(e)) activateBack(e);
  }
  function activateBack(e) {
    if (!e.url) { renderNewtab(); newtabEl.hidden = false; return; }
    const key = keyOf(e);
    if (!live.has(key)) { live.add(key); window.ws2.webLoadUrl(key, e.url); }
    attachedKey = key;
    window.ws2.webShow(key, viewBounds());
  }
  function pageShell(title, actions) {
    pageEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'wp-wrap';
    const top = document.createElement('div');
    top.className = 'wp-top';
    const back = document.createElement('button');
    back.className = 'wp-back';
    back.title = '返回';
    back.innerHTML = BACK18;
    back.onclick = () => closeSubPage();
    const h = document.createElement('div');
    h.className = 'wp-title';
    h.textContent = title;
    top.append(back, h);
    if (actions) top.appendChild(actions);
    wrap.appendChild(top);
    pageEl.appendChild(wrap);
    return wrap;
  }

  // 历史页（§4.8）
  let histQuery = '';
  function renderHistoryPage() {
    const actions = document.createElement('div');
    actions.className = 'wp-actions';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'wp-btn';
    clearBtn.innerHTML = TRASH14 + '<span>清除浏览数据</span>';
    actions.appendChild(clearBtn);
    const wrap = pageShell('历史记录', actions);
    clearBtn.onclick = () => {
      const old = actions.querySelector('.wp-clear-menu');
      if (old) { old.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'wp-clear-menu';
      const mk = (label, range, danger) => {
        const b = document.createElement('button');
        b.className = 'wp-clear-item' + (danger ? ' is-danger' : '');
        b.textContent = label;
        b.onclick = async () => { menu.remove(); await window.ws2.histClear(range); };
        return b;
      };
      menu.append(mk('最近一小时', '1h'), mk('最近 24 小时', '24h'), mk('最近 7 天', '7d'));
      const sep = document.createElement('div');
      sep.className = 'wp-clear-sep';
      menu.appendChild(sep);
      menu.appendChild(mk('全部清除', 'all', true));
      actions.appendChild(menu);
      setTimeout(() => {
        const off = (ev) => { if (!menu.contains(ev.target) && ev.target !== clearBtn) { menu.remove(); document.removeEventListener('mousedown', off); } };
        document.addEventListener('mousedown', off);
      }, 0);
    };
    const search = document.createElement('div');
    search.className = 'wp-search';
    search.innerHTML = SEARCH14;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '搜索历史记录';
    input.value = histQuery;
    const clearX = document.createElement('button');
    clearX.className = 'wp-search-x';
    clearX.innerHTML = X13;
    clearX.hidden = !histQuery;
    search.append(input, clearX);
    wrap.appendChild(search);
    const listHost = document.createElement('div');
    wrap.appendChild(listHost);
    const renderList = () => {
      listHost.innerHTML = '';
      const q = histQuery.trim().toLowerCase();
      const items = q
        ? histState.filter((h) => (h.title || '').toLowerCase().includes(q) || (h.url || '').toLowerCase().includes(q))
        : histState;
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'wp-empty';
        empty.textContent = q ? '没有匹配的历史记录' : '还没有浏览记录';
        listHost.appendChild(empty);
        return;
      }
      // 按自然日分组：今天 / 昨天 / M 月 D 日（§4.8）
      const dayKey = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
      const now = new Date();
      const todayKey = dayKey(now.getTime());
      const yesterdayKey = dayKey(now.getTime() - 864e5);
      let lastDay = null;
      for (const h of items) {
        const dk = dayKey(h.visitedAt);
        if (dk !== lastDay) {
          lastDay = dk;
          const d = new Date(h.visitedAt);
          const label = dk === todayKey ? '今天' : dk === yesterdayKey ? '昨天' : (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
          const day = document.createElement('div');
          day.className = 'wp-day';
          day.textContent = label;
          listHost.appendChild(day);
        }
        const row = document.createElement('button');
        row.className = 'wp-row';
        const time = document.createElement('span');
        time.className = 'wp-row-time';
        const d = new Date(h.visitedAt);
        time.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const ico = document.createElement('span');
        ico.className = 'wp-row-ico';
        ico.innerHTML = GLOBE2_14.replace(/width="14" height="14"/, 'width="13" height="13"');
        const t = document.createElement('span');
        t.className = 'wp-row-title';
        t.textContent = h.title;
        const u = document.createElement('span');
        u.className = 'wp-row-url';
        u.textContent = String(h.url).replace(/^https?:\/\//i, '');
        const x = document.createElement('button');
        x.className = 'wp-row-x';
        x.title = '删除';
        x.innerHTML = X13;
        x.onclick = async (ev) => { ev.stopPropagation(); await window.ws2.histRemoveOne(h.id); };
        row.append(time, ico, t, u, x);
        row.title = h.url;
        row.onclick = () => { closeSubPage(); openWeb(h.url, h.title, false); }; // 点行=开新网页标签并跳回主视图
        listHost.appendChild(row);
      }
    };
    input.addEventListener('input', () => { histQuery = input.value; clearX.hidden = !histQuery; renderList(); });
    clearX.onclick = () => { histQuery = ''; input.value = ''; clearX.hidden = true; renderList(); input.focus(); };
    renderList();
  }

  // 收藏管理页（§4.9）
  function renderBookmarksPage() {
    const actions = document.createElement('div');
    actions.className = 'wp-actions';
    const newFolder = document.createElement('button');
    newFolder.className = 'wp-btn';
    newFolder.innerHTML = FOLDER_PLUS14 + '<span>新文件夹</span>';
    newFolder.onclick = () => window.ws2.bmAddFolder('新文件夹');
    const imp = document.createElement('button');
    imp.className = 'wp-btn';
    imp.innerHTML = UPLOAD14 + '<span>导入</span>';
    imp.onclick = async () => {
      let r;
      try { r = await window.ws2.bmImport(); } catch { return; }
      if (!r || r.canceled) return;
      if (r.error) { toast('导入失败：' + r.error); return; }
      toast(r.parsed === 0
        ? '没识别到书签（需要浏览器导出的 HTML 书签文件）'
        : r.added === 0
          ? '这些书签都已存在，没有新增'
          : '已导入 ' + r.added + ' 个书签'); // 报净新增（拍板#6）
    };
    const exp = document.createElement('button');
    exp.className = 'wp-btn';
    exp.innerHTML = DOWNLOAD14 + '<span>导出</span>';
    exp.onclick = async () => {
      let r;
      try { r = await window.ws2.bmExport(); } catch { return; }
      if (r && r.ok) toast('已导出为 bookmarks.html（Chrome/Safari/Firefox 都能导入）');
    };
    actions.append(newFolder, imp, exp);
    const wrap = pageShell('收藏夹', actions);
    const hint = document.createElement('p');
    hint.className = 'wp-hint';
    hint.textContent = '导入 / 导出用的是浏览器通用的 HTML 书签格式（Netscape），可以和 Chrome、Safari、Firefox、Edge 互相搬。';
    wrap.appendChild(hint);
    for (const f of bmState.folders) {
      const items = bmState.bookmarks.filter((b) => b.folderId === f.id);
      const sec = document.createElement('section');
      sec.className = 'wp-folder';
      const head = document.createElement('div');
      head.className = 'wp-folder-head';
      const name = document.createElement('input');
      name.className = 'wp-folder-name';
      name.value = f.name;
      name.disabled = f.id === BM_BAR;
      name.title = f.id === BM_BAR ? '书签栏（固定）' : '重命名文件夹';
      name.onblur = () => { const v = name.value.trim(); if (v && v !== f.name) window.ws2.bmRenameFolder(f.id, v); else name.value = f.name; };
      name.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); } };
      const count = document.createElement('span');
      count.className = 'wp-folder-count';
      count.textContent = String(items.length);
      head.append(name, count);
      if (f.id !== BM_BAR) {
        const del = document.createElement('button');
        del.className = 'wp-btn is-danger wp-folder-del';
        del.title = '删除文件夹（含其中书签）';
        del.innerHTML = TRASH14;
        del.onclick = () => window.ws2.bmRemoveFolder(f.id);
        head.appendChild(del);
      }
      sec.appendChild(head);
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'wp-hint';
        empty.textContent = '空';
        sec.appendChild(empty);
      }
      for (const b of items) {
        const row = document.createElement('div');
        row.className = 'wp-row';
        const ico = document.createElement('span');
        ico.className = 'wp-row-ico';
        ico.innerHTML = GLOBE2_14;
        const title = document.createElement('input');
        title.className = 'wp-bm-title';
        title.value = b.title;
        title.onblur = () => { const v = title.value.trim(); if (v && v !== b.title) window.ws2.bmUpdate(b.id, { title: v }); else title.value = b.title; };
        title.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); title.blur(); } };
        const u = document.createElement('span');
        u.className = 'wp-row-url';
        u.title = b.url;
        u.textContent = String(b.url).replace(/^https?:\/\//i, '');
        const sel = document.createElement('select');
        sel.className = 'wp-bm-folder';
        for (const ff of bmState.folders) {
          const opt = document.createElement('option');
          opt.value = ff.id;
          opt.textContent = ff.name;
          if (ff.id === b.folderId) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.onchange = () => window.ws2.bmUpdate(b.id, { folderId: sel.value });
        const open = document.createElement('button');
        open.className = 'wp-row-x';
        open.title = '打开';
        open.innerHTML = EXT13;
        open.onclick = () => { closeSubPage(); focusOrOpen(b.url, b.title); }; // 同 §4.3 语义（拍板#3）
        const del = document.createElement('button');
        del.className = 'wp-row-x';
        del.title = '删除';
        del.innerHTML = X13;
        del.onclick = () => window.ws2.bmRemoveOne(b.id);
        row.append(ico, title, u, sel, open, del);
        sec.appendChild(row);
      }
      wrap.appendChild(sec);
    }
  }

  // 设置页（§4.10）：浏览器区只有默认搜索引擎一行；「主页」设置已删（拍板#2），不要加回来。
  function renderSettingsPage() {
    const wrap = pageShell('设置');
    const sec = document.createElement('div');
    sec.className = 'wp-sec';
    sec.textContent = '浏览器';
    wrap.appendChild(sec);
    const row = document.createElement('div');
    row.className = 'wp-set-row';
    const label = document.createElement('span');
    label.className = 'wp-set-label';
    label.textContent = '默认搜索引擎';
    const desc = document.createElement('span');
    desc.className = 'wp-set-desc';
    desc.textContent = '在地址栏打一句话（不是网址）时用它搜索';
    const ctl = document.createElement('span');
    ctl.className = 'wp-set-ctl';
    const sel = document.createElement('select');
    for (const eng of (settings.engines || [])) {
      const opt = document.createElement('option');
      opt.value = eng.key;
      opt.textContent = eng.name;
      if (eng.key === settings.engine) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = async () => {
      try { const s = await window.ws2.browserSetEngine(sel.value); if (s) settings.engine = s.engine; } catch { /* keep */ }
    };
    ctl.appendChild(sel);
    row.append(label, desc, ctl);
    wrap.appendChild(row);
  }

  // ---- 菜单命令的 web 态拦截（shell.onMenu 顶部调 __webMenu，true=已处理别再走文档路径）----
  window.__webMenu = (cmd) => {
    if (!isWebActive()) return false;
    const e = activeEntry();
    const key = keyOf(e);
    if (cmd === 'find-in-doc') { openFind(); return true; }
    if (cmd === 'export-pdf') { if (e.url) window.ws2.webExportPdf(key); return true; }
    if (cmd === 'undo') { window.ws2.webNav(key, 'undo'); return true; }
    if (cmd === 'redo') { window.ws2.webNav(key, 'redo'); return true; }
    if (cmd === 'save') return true; // 网页无保存目标：no-op（防误存后台文档）
    return false;
  };
  // 自己的菜单命令（独立 onMenu 订阅，与 shell 的互不干扰）
  window.ws2.onMenu((cmd) => {
    if (cmd === 'reopen-tab' && window.__sbHooks && window.__sbHooks.reopenClosedTab) window.__sbHooks.reopenClosedTab(); // ⌘⇧T
    if (cmd === 'open-settings') { if (subPage === 'settings') closeSubPage(); else openSubPage('settings'); } // ⌘,
  });

  // ---- 全局快捷键（renderer 聚焦时；web view 聚焦时由主进程 before-input-event 转发同名命令）----
  document.addEventListener('keydown', (ev) => {
    const mod = ev.metaKey || ev.ctrlKey;
    // 弹层守卫（§7）：modal 开着不穿透
    if (document.querySelector('.sb-modal-overlay') || document.getElementById('fp-overlay')) return;
    if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'l') { ev.preventDefault(); focusOmni(); return; }
    if (mod && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'd') {
      if (isWebActive()) { ev.preventDefault(); toggleBookmark(); }
      return;
    }
    if (isWebActive() && mod && !ev.shiftKey && !ev.altKey) {
      const k = ev.key;
      if (k === '=' || k === '+') { ev.preventDefault(); window.ws2.webZoom(keyOf(activeEntry()), 'in'); return; }
      if (k === '-') { ev.preventDefault(); window.ws2.webZoom(keyOf(activeEntry()), 'out'); return; }
      if (k === '0') { ev.preventDefault(); window.ws2.webZoom(keyOf(activeEntry()), 'reset'); return; }
    }
  });

  // 初始 chrome 态
  syncChrome();
})();
