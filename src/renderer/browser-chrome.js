// 浏览器 chrome + 激活漏斗的 renderer 侧（U5,对齐 ui-demo）。classic script,在 sidebar.js 之后加载。
// 关键 UX（Colin 2026-07-05 纠正）：
//  - omnibox 在侧栏里(#sb-omni,永不被 native view 盖),始终可见。反映当前激活标签的 URL;输网址上网。
//  - 新标签页 = 内容区居中的 NewTab 页(#web-newtab,大搜索框)——也是开屏空态。
//  - web view 占满整个内容区(#web-viewport 全高),无内容区 chrome 条。
// 职责：omnibox/nav 交互、激活漏斗 web 分支(__webActivate)、__webDetach、web-tab-updated 消费、find 条。
(function () {
  var UrlInput = window.WS2UrlInput;
  var main = document.getElementById('main');
  var viewport = document.getElementById('web-viewport');
  var newtab = document.getElementById('web-newtab');
  var addrInput = document.getElementById('bc-addr');       // 侧栏 omnibox
  var omniIco = document.getElementById('omni-ico');
  var backBtn = document.getElementById('bc-back');
  var fwdBtn = document.getElementById('bc-fwd');
  var reloadBtn = document.getElementById('bc-reload');
  var findBar = document.getElementById('bc-find');
  var findInput = document.getElementById('bc-find-input');
  var findCount = document.getElementById('bc-find-count');
  var newtabAddr = document.getElementById('nt-addr');       // NewTab 页大搜索框
  var webHeader = document.getElementById('web-header');      // 网页头(与 doc-header 同壳)
  var webSec = document.getElementById('web-sec');
  var webTitle = document.getElementById('web-title');
  var webHost = document.getElementById('web-host');
  var LOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  var INSECURE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

  var attachedKey = null;        // 当前 attach 的 web view key（null=没有）
  var activeWebEntry = null;     // 当前激活的 web entry
  var addrEditing = false;       // omnibox 是否在编辑（编辑中冻结后台导航刷新,#21）
  var recs = Object.create(null); // key -> 主进程状态镜像

  var GLOBE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var FOLDER = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h5l2 2h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1z"/></svg>';

  // web view 占满整个内容区（#web-viewport 全高;view 画在它上面）。DIP=CSS px,与 setBounds 一致。
  function bounds() {
    var anchor = (viewport && !viewport.hidden) ? viewport : main;
    if (!anchor) return null;
    var r = anchor.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  function pushBounds() { if (attachedKey) window.ws2.webSetBounds(attachedKey, bounds()); }

  // ---- 激活漏斗 web 分支：entry 是 web 标签 ----
  window.__webActivate = function (entry) {
    activeWebEntry = entry;
    var key = entry.rel || entry.abs;
    if (window.__shellHideDocSurfaces) window.__shellHideDocSurfaces();
    hideFind();
    setOmniContext(entry);
    if (entry.url == null) {
      // 新标签页：detach view,显示 NewTab 页,聚焦大搜索框
      if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; }
      if (webHeader) webHeader.hidden = true;
      if (viewport) viewport.hidden = true;
      if (newtab) newtab.hidden = false;
      focusNewtab();
    } else {
      if (newtab) newtab.hidden = true;
      updateWebHeader(entry);         // 网页头(标题+安全标+域名),与文档面包屑同壳
      if (viewport) viewport.hidden = false;
      window.ws2.webShow(key, bounds());
      attachedKey = key; // ⚠ 记住 attach 的 key,否则 __webDetach 守卫 no-op
      if (!(recs[key] && recs[key]._loaded)) { window.ws2.webLoad(key, entry.url); if (!recs[key]) recs[key] = {}; recs[key]._loaded = true; }
    }
  };
  window.__webDetach = function () {
    if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; }
    activeWebEntry = null;
    if (viewport) viewport.hidden = true;
    if (newtab) newtab.hidden = true;
    if (webHeader) webHeader.hidden = true;
    hideFind();
    setOmniContext(null); // 切到文档:omnibox 回落到文件夹上下文
  };
  window.__webCloseView = function (key) { window.ws2.webClose(key); delete recs[key]; if (attachedKey === key) attachedKey = null; };
  window.__webDestroyAll = function () { window.ws2.webDestroyAll(); recs = Object.create(null); attachedKey = null; activeWebEntry = null; setOmniContext(null); }; // 清空 omnibox,别留幽灵 URL(审计 P1.3)
  window.__webActiveKey = function () { return activeWebEntry ? (activeWebEntry.rel || activeWebEntry.abs) : null; };
  window.__webViewState = function () {
    if (!activeWebEntry) return null;
    if (activeWebEntry.url == null) return 'newtab';
    var key = activeWebEntry.rel || activeWebEntry.abs;
    return (recs[key] && recs[key]._loaded) ? 'live' : 'placeholder';
  };
  // 开屏 / 关掉所有标签后的空态：显示 NewTab 页（不建 web entry,输网址时才建）。sidebar 调。
  window.__webShowEmpty = function () {
    if (window.__shellHideDocSurfaces) window.__shellHideDocSurfaces();
    activeWebEntry = null;
    if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; }
    if (webHeader) webHeader.hidden = true;
    if (viewport) viewport.hidden = true;
    if (newtab) newtab.hidden = false;
    setOmniContext(null);
    focusNewtab(); // 焦点落在中间大搜索框(主 CTA),不是侧栏那个(审计 P1.2)
  };

  function focusNewtab() { setTimeout(function () { if (newtabAddr) { newtabAddr.focus(); newtabAddr.select(); } }, 0); }

  // ---- omnibox 上下文（web=地球+URL；doc/空=文件夹图标+空,占位提示浏览） ----
  function setOmniContext(entry) {
    if (!addrInput) return;
    if (entry && entry.url != null) {
      if (omniIco) omniIco.innerHTML = GLOBE;
      if (!addrEditing) addrInput.value = UrlInput.pretty(entry.url);
    } else {
      if (omniIco) omniIco.innerHTML = entry && entry.url === null ? GLOBE : FOLDER;
      if (!addrEditing) addrInput.value = '';
    }
    syncNavButtons();
  }
  function syncNavButtons() {
    var rec = activeWebEntry ? recs[activeWebEntry.rel || activeWebEntry.abs] : null;
    if (backBtn) backBtn.disabled = !(rec && rec.canGoBack);
    if (fwdBtn) fwdBtn.disabled = !(rec && rec.canGoForward);
    if (reloadBtn) reloadBtn.classList.toggle('is-loading', !!(rec && rec.loading));
  }
  // 网页头（与文档面包屑同一套外壳）：安全标 + 标题 + 域名。web url 态显示,其余隐藏。textContent 防不可信内容。
  function updateWebHeader(entry) {
    if (!webHeader) return;
    if (!entry || entry.url == null) { webHeader.hidden = true; return; }
    var rec = recs[entry.rel || entry.abs] || {};
    var url = rec.url || entry.url || '';
    var https = /^https:/i.test(url);
    if (webSec) { webSec.innerHTML = https ? LOCK : INSECURE; webSec.className = 'web-sec ' + (https ? 'is-secure' : 'is-insecure'); }
    if (webTitle) webTitle.textContent = rec.title || entry.title || UrlInput.pretty(url);
    if (webHost) { try { webHost.textContent = new URL(url).host; } catch (e) { webHost.textContent = ''; } }
    webHeader.hidden = false;
  }

  // omnibox 提交（KD-12）：有 web 标签激活→在它上面导航;否则→新建 web 标签浏览（对齐 ui-demo submitOmni）。
  function submitOmni(text) {
    var v = String(text || '').trim();
    if (!v) return;
    var parsed = UrlInput.parse(v);
    if (parsed.kind === 'blocked') return;
    if (activeWebEntry && activeWebEntry.url != null) {
      var key = activeWebEntry.rel || activeWebEntry.abs;
      window.ws2.webNavigate(key, v);
    } else if (activeWebEntry && activeWebEntry.url == null) {
      // 新标签页原地导航
      firstNavigateNewtab(activeWebEntry, parsed.url, v);
    } else {
      // 文档态 / 空态:新建 web 标签
      if (window.__sbOpenWebTab) window.__sbOpenWebTab(parsed.url, false, v);
    }
  }
  function firstNavigateNewtab(entry, normalized, raw) {
    var key = entry.rel || entry.abs;
    window.ws2.webNavigate(key, raw);
    entry.url = normalized;
    if (window.__sbWebNavigated) window.__sbWebNavigated(key, normalized);
    if (newtab) newtab.hidden = true;
    updateWebHeader(entry);
    if (viewport) viewport.hidden = false;
    window.ws2.webShow(key, bounds());
    attachedKey = key;
    if (!recs[key]) recs[key] = {}; recs[key]._loaded = true;
    setOmniContext(entry);
  }

  // ---- omnibox 交互 ----
  if (addrInput) {
    addrInput.addEventListener('focus', function () { addrEditing = true; addrInput.select(); });
    addrInput.addEventListener('blur', function () { addrEditing = false; setOmniContext(activeWebEntry); });
    addrInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitOmni(addrInput.value); addrInput.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); addrEditing = false; setOmniContext(activeWebEntry); addrInput.blur(); }
    });
  }
  if (newtabAddr) {
    newtabAddr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitOmni(newtabAddr.value); newtabAddr.value = ''; }
    });
  }
  var ntNewDoc = document.getElementById('nt-new-doc');
  var ntOpenFolder = document.getElementById('nt-open-folder');
  if (ntNewDoc) ntNewDoc.onclick = function () { if (window.__sbNewDoc) window.__sbNewDoc(); };
  if (ntOpenFolder) ntOpenFolder.onclick = function () { if (window.__sbHooks && window.__sbHooks.pickFolder) window.__sbHooks.pickFolder(); };

  // ---- 导航按钮 ----
  if (backBtn) backBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'back'); };
  if (fwdBtn) fwdBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'forward'); };
  if (reloadBtn) reloadBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, reloadBtn.classList.contains('is-loading') ? 'stop' : 'reload'); };

  // ---- 页内查找条 ----
  function showFind() { if (!findBar) return; window.__focusMainFrame && window.__focusMainFrame(); findBar.hidden = false; if (findInput) { findInput.focus(); findInput.select(); } }
  function hideFind() { if (!findBar || findBar.hidden) return; findBar.hidden = true; var k = window.__webActiveKey(); if (k) window.ws2.webStopFind(k, 'keepSelection'); if (findCount) findCount.textContent = ''; }
  window.__webShowFind = showFind;
  if (findInput) {
    findInput.addEventListener('keydown', function (e) {
      var k = window.__webActiveKey(); if (!k) return;
      if (e.key === 'Enter') { e.preventDefault(); window.ws2.webFind(k, findInput.value, { findNext: false, forward: !e.shiftKey }); }
      else if (e.key === 'Escape') { e.preventDefault(); hideFind(); }
    });
    findInput.addEventListener('input', function () {
      var k = window.__webActiveKey(); if (!k) return;
      if (findInput.value) window.ws2.webFind(k, findInput.value, { findNext: true });
      else { window.ws2.webStopFind(k, 'clearSelection'); if (findCount) findCount.textContent = ''; }
    });
  }
  if (window.ws2.onWebFound) window.ws2.onWebFound(function (r) { if (findCount) findCount.textContent = r.matches ? (r.active + '/' + r.matches) : '0/0'; });

  // ---- 消费主进程状态推送 ----
  if (window.ws2.onWebTabUpdated) window.ws2.onWebTabUpdated(function (s) {
    var prev = recs[s.key] || {};
    recs[s.key] = { url: s.url, title: s.title, favicon: s.favicon, loading: s.loading, audible: s.audible, canGoBack: s.canGoBack, canGoForward: s.canGoForward, error: s.error, _loaded: prev._loaded || (s.url != null) };
    if (window.__sbWebStatus) window.__sbWebStatus(s);
    if (activeWebEntry && (activeWebEntry.rel || activeWebEntry.abs) === s.key) {
      if (s.url != null) activeWebEntry.url = s.url;
      setOmniContext(activeWebEntry);
      updateWebHeader(activeWebEntry); // 标题/域名/安全标随导航刷新
    }
  });
  if (window.ws2.onWebOpenRequest) window.ws2.onWebOpenRequest(function (r) { if (window.__sbOpenWebTab) window.__sbOpenWebTab(r.url, r.background); });
  if (window.ws2.onWebRebound) window.ws2.onWebRebound(function () { pushBounds(); });

  var raf = null;
  function scheduleBounds() { if (raf) return; raf = requestAnimationFrame(function () { raf = null; pushBounds(); }); }
  window.addEventListener('resize', scheduleBounds);
  window.__webRebound = scheduleBounds;

  window.__webReload = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'reload'); };
  window.__webBack = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'back'); };
  window.__webForward = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'forward'); };
  window.__webFocusAddr = function () { if (window.__focusMainFrame) window.__focusMainFrame(); if (addrInput) { addrInput.focus(); addrInput.select(); } };

  // sidebar 启动可能在本脚本定义 __webShowEmpty 之前就想显示开屏空态（顺序不定）→ 消费其 pending 标志。
  if (window.__pendingEmptyState) { window.__pendingEmptyState = false; window.__webShowEmpty(); }
})();
