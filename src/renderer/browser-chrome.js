// 浏览器 chrome UI + 激活漏斗的 renderer 侧（U4/U5）。classic script,在 sidebar.js 之后加载。
// 职责：
//  - window.__webActivate(entry)：激活漏斗的 web 分支（KD-5）——显示 chrome 条 + 让主进程 attach/show view
//    （或 url=null 时显示新标签页 surface）。sidebar 的 openTabRow web 分支调它。
//  - window.__webDetach()：把当前 attach 的 web view 摘掉（切到 doc/viewer/home 前调,shell 各表面入口调）。
//  - chrome 条交互：后退/前进/刷新、地址栏(focus 全选/Esc 还原/编辑冻结刷新/prettyURL)、页内查找条。
//  - 新标签页 surface：聚焦地址栏 + 新建文档入口 + 最近浏览（U6 填历史,先留空态隐藏）。
//  - 消费主进程推来的 web-tab-updated（title/favicon/loading/canGoBack/error）刷新 chrome + 通知 sidebar。
//  - onMenu 的 web 路由（KD-7/KD-8）：reload/back/forward/find/pdf/undo/redo 按 viewState 分派。
(function () {
  var UrlInput = window.WS2UrlInput;
  var chrome = document.getElementById('browser-chrome');
  var viewport = document.getElementById('web-viewport');
  var newtab = document.getElementById('web-newtab');
  var addrInput = document.getElementById('bc-addr');
  var backBtn = document.getElementById('bc-back');
  var fwdBtn = document.getElementById('bc-fwd');
  var reloadBtn = document.getElementById('bc-reload');
  var findBar = document.getElementById('bc-find');
  var findInput = document.getElementById('bc-find-input');
  var findCount = document.getElementById('bc-find-count');
  var newtabAddr = document.getElementById('nt-addr');
  var newtabRecent = document.getElementById('nt-recent');

  var attachedKey = null;        // 当前 attach 的 web view key（null=没有）
  var activeWebEntry = null;     // 当前激活的 web entry（含 url/title,渲染 chrome 用）
  var addrEditing = false;       // 地址栏是否在编辑（编辑中冻结后台导航刷新,#21）
  var recs = Object.create(null); // key -> 主进程推来的最新状态镜像（favicon/loading/error/canGoBack…）

  // ---- 计算 web view 应占的窗口坐标（chrome 条以下、侧栏以右；DIP=CSS px,与 setBounds 一致）----
  function bounds() {
    if (!viewport) return null;
    var r = viewport.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  function pushBounds() { if (attachedKey) window.ws2.webSetBounds(attachedKey, bounds()); }

  // ---- 表面切换：显示 chrome + view / 新标签页；隐藏文档表面 ----
  function showDocSurfaceHidden(hide) {
    // 由 shell 掌管文档/viewer/home 的显隐；这里只管 chrome/viewport/newtab 三个 web 表面。
    if (chrome) chrome.hidden = hide;
    if (viewport) viewport.hidden = hide || !activeWebEntry || activeWebEntry.url == null;
    if (newtab) newtab.hidden = hide || !activeWebEntry || activeWebEntry.url != null;
  }

  // 激活漏斗 web 分支：entry 是 web 标签。
  window.__webActivate = function (entry) {
    activeWebEntry = entry;
    var key = entry.rel || entry.abs;
    // 让 shell 收起文档/viewer/home 表面（它内部会调 __webDetach? 不——这里主动隐藏文档 DOM）
    if (window.__shellHideDocSurfaces) window.__shellHideDocSurfaces();
    if (chrome) chrome.hidden = false;
    hideFind();
    renderChrome(entry, recs[key] || {});
    if (entry.url == null) {
      // 新标签页：detach 任何 view,显示 newtab surface,聚焦地址栏
      if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; }
      if (viewport) viewport.hidden = true;
      if (newtab) newtab.hidden = false;
      focusNewtabAddr();
    } else {
      if (newtab) newtab.hidden = true;
      if (viewport) viewport.hidden = false;
      // 首次激活/占位恢复：告诉主进程 show（内部惰性建 view;若从没导航过则需 load）
      window.ws2.webShow(key, bounds());
      attachedKey = key; // ⚠ 必须记住当前 attach 的 key,否则 __webDetach 的守卫 no-op、view 永不摘除
      // 占位恢复（有 url 但 view 从未加载）：show 会建空 view,这里补一次 load
      if (recs[key] && recs[key]._loaded) { /* 已加载,show 即 attach */ }
      else { window.ws2.webLoad(key, entry.url); if (!recs[key]) recs[key] = {}; recs[key]._loaded = true; }
      focusView();
    }
  };
  // 摘掉当前 web view（切到非 web 表面前调）。不销毁 view,只 detach（切回秒回）。
  window.__webDetach = function () {
    if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; }
    activeWebEntry = null;
    if (chrome) chrome.hidden = true;
    if (viewport) viewport.hidden = true;
    if (newtab) newtab.hidden = true;
    hideFind();
  };
  // 关闭 web 标签 → 销毁 view（webContents 不自动销毁,会泄漏）。sidebar 的 finishClose 调。
  window.__webCloseView = function (key) { window.ws2.webClose(key); delete recs[key]; if (attachedKey === key) attachedKey = null; };
  window.__webDestroyAll = function () { window.ws2.webDestroyAll(); recs = Object.create(null); attachedKey = null; activeWebEntry = null; };
  window.__webActiveKey = function () { return activeWebEntry ? (activeWebEntry.rel || activeWebEntry.abs) : null; };
  // 当前激活 web 标签的 viewState（KD-7 菜单路由用）
  window.__webViewState = function () {
    if (!activeWebEntry) return null;
    if (activeWebEntry.url == null) return 'newtab';
    var key = activeWebEntry.rel || activeWebEntry.abs;
    return (recs[key] && recs[key]._loaded && !(recs[key].error)) ? 'live' : (recs[key] && recs[key]._loaded ? 'live' : 'placeholder');
  };

  function focusView() { /* 主进程 view 聚焦由 webShow 后系统处理;地址栏失焦即可 */ if (addrInput) addrInput.blur(); }
  function focusNewtabAddr() { setTimeout(function () { if (newtabAddr) { newtabAddr.focus(); newtabAddr.select(); } }, 0); }

  // ---- chrome 条渲染 ----
  function renderChrome(entry, rec) {
    if (!addrInput) return;
    if (!addrEditing) addrInput.value = rec && rec.url ? UrlInput.pretty(rec.url) : (entry.url ? UrlInput.pretty(entry.url) : '');
    if (backBtn) backBtn.disabled = !(rec && rec.canGoBack);
    if (fwdBtn) fwdBtn.disabled = !(rec && rec.canGoForward);
    if (reloadBtn) reloadBtn.classList.toggle('is-loading', !!(rec && rec.loading));
  }

  // ---- 地址栏交互（KD-12）----
  if (addrInput) {
    addrInput.addEventListener('focus', function () { addrEditing = true; addrInput.select(); });
    addrInput.addEventListener('blur', function () { addrEditing = false; if (activeWebEntry) renderChrome(activeWebEntry, recs[activeWebEntry.rel || activeWebEntry.abs] || {}); });
    addrInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); navigateFromAddr(addrInput.value); addrInput.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); addrEditing = false; addrInput.blur(); }
    });
  }
  if (newtabAddr) {
    newtabAddr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); navigateFromAddr(newtabAddr.value); }
    });
  }
  var ntNewDoc = document.getElementById('nt-new-doc');
  var ntOpenFolder = document.getElementById('nt-open-folder');
  if (ntNewDoc) ntNewDoc.onclick = function () { if (window.__sbNewDoc) window.__sbNewDoc(); };
  if (ntOpenFolder) ntOpenFolder.onclick = function () { if (window.__sbHooks && window.__sbHooks.pickFolder) window.__sbHooks.pickFolder(); };
  function navigateFromAddr(text) {
    if (!activeWebEntry) return;
    var key = activeWebEntry.rel || activeWebEntry.abs;
    var parsed = UrlInput.parse(text);
    if (parsed.kind === 'blocked') return; // file:/javascript: 等,什么都不做
    // url=null 新标签页首次导航：原地变真网页标签（sidebar 更新 entry.url + 切表面）
    window.ws2.webNavigate(key, text).then(function () {});
    if (activeWebEntry.url == null) {
      activeWebEntry.url = parsed.url;
      if (window.__sbWebNavigated) window.__sbWebNavigated(key, parsed.url); // 通知 sidebar 更新 entry + 落盘
      if (newtab) newtab.hidden = true;
      if (viewport) viewport.hidden = false;
      window.ws2.webShow(key, bounds());
      attachedKey = key;
      if (!recs[key]) recs[key] = {}; recs[key]._loaded = true;
    }
  }

  // ---- 导航按钮 ----
  if (backBtn) backBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'back'); };
  if (fwdBtn) fwdBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'forward'); };
  if (reloadBtn) reloadBtn.onclick = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, reloadBtn.classList.contains('is-loading') ? 'stop' : 'reload'); };

  // ---- 页内查找条（U6 消费 found；这里搭骨架 + 键位）----
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
  if (window.ws2.onWebFound) window.ws2.onWebFound(function (r) {
    if (findCount) findCount.textContent = r.matches ? (r.active + '/' + r.matches) : '0/0';
  });

  // ---- 消费主进程状态推送 ----
  if (window.ws2.onWebTabUpdated) window.ws2.onWebTabUpdated(function (s) {
    var prev = recs[s.key] || {};
    recs[s.key] = { url: s.url, title: s.title, favicon: s.favicon, loading: s.loading, audible: s.audible, canGoBack: s.canGoBack, canGoForward: s.canGoForward, error: s.error, _loaded: prev._loaded || (s.url != null) };
    if (window.__sbWebStatus) window.__sbWebStatus(s); // 通知 sidebar 刷新标签行（favicon/spinner/喇叭/错误角标）
    if (activeWebEntry && (activeWebEntry.rel || activeWebEntry.abs) === s.key) {
      if (s.url != null) activeWebEntry.url = s.url;
      renderChrome(activeWebEntry, recs[s.key]);
    }
  });
  // window.open → 主进程 deny + 让 renderer 建新标签走漏斗（KD-15）
  if (window.ws2.onWebOpenRequest) window.ws2.onWebOpenRequest(function (r) {
    if (window.__sbOpenWebTab) window.__sbOpenWebTab(r.url, r.background);
  });
  // 唤回后重发 bounds（KD-13）
  if (window.ws2.onWebRebound) window.ws2.onWebRebound(function () { pushBounds(); });

  // 窗口/侧栏尺寸变化 → 重发 bounds（rAF 合并）
  var raf = null;
  function scheduleBounds() { if (raf) return; raf = requestAnimationFrame(function () { raf = null; pushBounds(); }); }
  window.addEventListener('resize', scheduleBounds);
  window.__webRebound = scheduleBounds; // 侧栏收起/拖宽后 shell/sidebar 调

  // onMenu web 路由由 shell 统一分发时查询这里（见 shell.js 改动）。导出查找/pdf 触发器。
  window.__webReload = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'reload'); };
  window.__webBack = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'back'); };
  window.__webForward = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'forward'); };
})();
