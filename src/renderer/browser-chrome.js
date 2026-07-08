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
      if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; } syncWebActiveClass();
      if (webHeader) webHeader.hidden = true;
      if (viewport) viewport.hidden = true;
      if (newtab) newtab.hidden = false;
      focusNewtab();
    } else {
      if (newtab) newtab.hidden = true;
      updateWebHeader(entry);         // 网页头(标题+安全标+域名),与文档面包屑同壳
      if (viewport) viewport.hidden = false;
      window.ws2.webShow(key, bounds());
      attachedKey = key; syncWebActiveClass(); // ⚠ 记住 attach 的 key,否则 __webDetach 守卫 no-op
      // ⚠ 顺序:先 webShow(主进程 show() 无条件 setVisible(true)),再 showError 的 setVisible(false),
      // 否则 show 的 true 盖掉 error 的 false → 重新激活错误标签会显空白 view、盖住错误页+重试钮(adversarial P2)。
      if (recs[key] && recs[key].error) showError(recs[key].error); else hideError();
      if (!(recs[key] && recs[key]._loaded)) { window.ws2.webLoad(key, entry.url); if (!recs[key]) recs[key] = {}; recs[key]._loaded = true; }
    }
  };
  window.__webDetach = function () {
    if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; } syncWebActiveClass();
    activeWebEntry = null;
    if (viewport) viewport.hidden = true;
    if (newtab) newtab.hidden = true;
    if (webHeader) webHeader.hidden = true;
    if (webError) webError.hidden = true;
    hideFind();
    setOmniContext(null); // 切到文档:omnibox 回落到文件夹上下文
  };
  window.__webCloseView = function (key) { window.ws2.webClose(key); delete recs[key]; if (attachedKey === key) attachedKey = null; syncWebActiveClass(); };
  window.__webDestroyAll = function () { window.ws2.webDestroyAll(); recs = Object.create(null); attachedKey = null; activeWebEntry = null; setOmniContext(null); syncWebActiveClass(); }; // 清空 omnibox,别留幽灵 URL(审计 P1.3)
  window.__webActiveKey = function () { return activeWebEntry ? (activeWebEntry.rel || activeWebEntry.abs) : null; };
  // 当前网页的权威 URL(registry 镜像优先,entry.url 兜底)——Cmd+Shift+C 拷链接用。
  window.__webActiveUrl = function () {
    if (!activeWebEntry) return null;
    var k = activeWebEntry.rel || activeWebEntry.abs;
    return (recs[k] && recs[k].url) || activeWebEntry.url || null;
  };
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
    if (attachedKey) { window.ws2.webHide(attachedKey); attachedKey = null; } syncWebActiveClass();
    if (webHeader) webHeader.hidden = true;
    if (viewport) viewport.hidden = true;
    if (newtab) newtab.hidden = false;
    setOmniContext(null);
    focusNewtab(); // 焦点落在中间大搜索框(主 CTA),不是侧栏那个(审计 P1.2)
  };

  function focusNewtab() { setTimeout(function () {
    if (!newtabAddr) return;
    // ⚠ 用户正在别的输入框打字(典型:开文件夹后立刻在侧栏 omnibox 输网址,loadTabs 迟到才渲染空态)——
    // 别抢焦点:抢会 blur 掉侧栏地址栏、把正输入的值清空(e2e 套件顺序依赖抓出的真竞态)。
    var ae = document.activeElement;
    if (ae && ae !== newtabAddr && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    newtabAddr.focus(); newtabAddr.select();
  }, 0); }

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
    attachedKey = key; syncWebActiveClass();
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

  // ---- 网页存成本地文档（融合核心桥）：抽正文 → 存进工作区 → 用编辑器打开 ----
  var clipBtn = document.getElementById('web-clip-btn');
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function safeFileName(t) { return (String(t || '网页').replace(/[/\\:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)) || '网页'; }
  // 剪藏一个网页标签成本地文档。web 头「＋存为文档」按钮 和 右键「存为文档」都调它。
  function clipTab(k) {
    if (!k) return;
    if (!window.__sbHasWorkspace || !window.__sbHasWorkspace()) { // 存进文档库需要一个工作区
      if (window.__sbHooks && window.__sbHooks.pickFolder) window.__sbHooks.pickFolder();
      return;
    }
    if (clipBtn) { clipBtn.disabled = true; clipBtn.textContent = '正在保存…'; }
    function restoreBtn() { if (clipBtn) { clipBtn.disabled = false; clipBtn.textContent = '＋ 存为文档'; } }
    window.ws2.webClip(k).then(function (clip) {
      restoreBtn();
      if (!clip || clip.error) { if (window.__sbToast) window.__sbToast('这个页面读不出内容'); return; }
      var head = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(clip.title) + '</title></head><body>\n' +
        '<h1>' + esc(clip.title) + '</h1>\n' +
        '<p>来源：<a href="' + esc(clip.url) + '">' + esc(clip.url) + '</a></p>\n';
      var html, note;
      if (clip.empty) {
        // 没正文的页面(baidu 首页这种应用页)→ 降级成链接收藏,老实告诉用户
        html = head + (clip.excerpt ? '<p>' + esc(clip.excerpt) + '</p>\n' : '') +
          '<p>这个页面没有可提取的正文，已存为链接收藏。</p>\n</body></html>';
        note = '这页没有正文，已存为链接收藏：';
      } else {
        html = head + (clip.byline ? '<p><em>' + esc(clip.byline) + '</em></p>\n' : '') +
          (clip.content || '') + '\n</body></html>';
        note = '已把网页存成文档：';
      }
      if (window.__sbClipToDoc) window.__sbClipToDoc(safeFileName(clip.title), html, note);
    }).catch(function () { restoreBtn(); if (window.__sbToast) window.__sbToast('保存失败'); });
  }
  if (clipBtn) clipBtn.onclick = function () { clipTab(window.__webActiveKey()); };
  // 右键「存为文档」→ 主进程 web-clip-request（带 key）；只对当前激活的 web tab 执行,防非激活 view 的迟到请求剪错页。
  if (window.ws2.onWebClipRequest) window.ws2.onWebClipRequest(function (r) {
    if (r && r.key && r.key === window.__webActiveKey()) clipTab(r.key);
  });

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

  // ---- 错误页（加载失败/崩溃）：显示 DOM 错误 + view setVisible(false) 让它透出；重试=reload ----
  var webError = document.getElementById('web-error');
  var webErrDesc = document.getElementById('web-error-desc');
  var webErrTitle = document.getElementById('web-error-title');
  var webErrRetry = document.getElementById('web-error-retry');
  var ERR_MSG = { '-105': '找不到该网站（域名无法解析）', '-106': '当前没有网络连接', '-102': '连接被拒绝', '-118': '连接超时', '-201': '证书无效或不受信任', 'crash': '页面崩溃了' };
  function showError(err) {
    if (!webError) return;
    var k = window.__webActiveKey(); if (k) window.ws2.webSetVisible(k, false); // 让 DOM 错误页透出
    if (webErrTitle) webErrTitle.textContent = err.code === 'crash' ? '页面崩溃了' : '无法打开此页面';
    if (webErrDesc) webErrDesc.textContent = (ERR_MSG[String(err.code)] || ('错误码 ' + err.code)) + (err.url ? '\n' + UrlInput.pretty(err.url) : '');
    webError.hidden = false;
  }
  function hideError() { if (webError && !webError.hidden) { webError.hidden = true; var k = window.__webActiveKey(); if (k && !overlayOpen()) window.ws2.webSetVisible(k, true); } } // 有浮层开着时别恢复 view(否则盖住模态,adversarial 残留)
  if (webErrRetry) webErrRetry.onclick = function () { var k = window.__webActiveKey(); if (!k) return; hideError(); window.ws2.webNav(k, 'reload'); };

  // ---- 消费主进程状态推送 ----
  if (window.ws2.onWebTabUpdated) window.ws2.onWebTabUpdated(function (s) {
    var prev = recs[s.key] || {};
    recs[s.key] = { url: s.url, title: s.title, favicon: s.favicon, loading: s.loading, audible: s.audible, canGoBack: s.canGoBack, canGoForward: s.canGoForward, error: s.error, _loaded: prev._loaded || (s.url != null) };
    if (window.__sbWebStatus) window.__sbWebStatus(s);
    if (activeWebEntry && (activeWebEntry.rel || activeWebEntry.abs) === s.key) {
      if (s.url != null) activeWebEntry.url = s.url;
      setOmniContext(activeWebEntry);
      updateWebHeader(activeWebEntry); // 标题/域名/安全标随导航刷新
      if (s.error) showError(s.error); else if (s.loading || s.url) hideError();
    }
  });
  // 下载反馈:开始/进度/完成的 toast(锚侧栏区,web 激活时不被 native view 盖)
  var dlHost = document.getElementById('web-downloads');
  var dlItems = Object.create(null);
  if (window.ws2.onWebDownload) window.ws2.onWebDownload(function (d) {
    if (!dlHost) return;
    var el = dlItems[d.savePath];
    if (!el) {
      el = document.createElement('div'); el.className = 'wd-item'; dlItems[d.savePath] = el; dlHost.appendChild(el); dlHost.hidden = false;
    }
    var pct = d.total > 0 ? Math.round(d.received / d.total * 100) : 0;
    if (d.state === 'completed') {
      el.innerHTML = ''; var n = document.createElement('span'); n.className = 'wd-name'; n.textContent = '✓ ' + d.name;
      var open = document.createElement('button'); open.className = 'wd-reveal'; open.textContent = '在 Finder 显示'; open.onclick = function () { window.ws2.wsRevealPath && window.ws2.wsRevealPath(d.savePath); };
      el.append(n, open);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); delete dlItems[d.savePath]; if (dlHost && !dlHost.children.length) dlHost.hidden = true; }, 8000);
    } else if (d.state === 'cancelled' || d.state === 'interrupted') {
      el.textContent = '✕ ' + d.name + ' 下载中断'; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); delete dlItems[d.savePath]; if (dlHost && !dlHost.children.length) dlHost.hidden = true; }, 5000);
    } else {
      el.textContent = '↓ ' + d.name + (d.total > 0 ? '  ' + pct + '%' : '  下载中…');
    }
  });
  if (window.ws2.onWebOpenRequest) window.ws2.onWebOpenRequest(function (r) { if (window.__sbOpenWebTab) window.__sbOpenWebTab(r.url, r.background); });
  if (window.ws2.onWebRebound) window.ws2.onWebRebound(function () { pushBounds(); });

  var raf = null;
  function scheduleBounds() { if (raf) return; raf = requestAnimationFrame(function () { raf = null; pushBounds(); }); }
  window.addEventListener('resize', scheduleBounds);
  window.__webRebound = scheduleBounds;

  // ---- KD-6:居中 DOM 浮层打开时让 native view 让位（否则原生 view 盖死模态,看不见也点不到）----
  // 单一收口:MutationObserver 盯 body 上的浮层增删,不用改每个弹层的 open/close 点。
  var OVERLAY_SEL = '.sb-modal-overlay, #fp-overlay';
  function overlayOpen() { return !!document.querySelector(OVERLAY_SEL); }
  function syncOverlayVeil() {
    if (!attachedKey) return;
    if (overlayOpen()) { window.ws2.webSetVisible(attachedKey, false); if (window.__focusMainFrame) window.__focusMainFrame(); } // 让位 + 把焦点拉回主 frame,浮层输入框才聚焦得上
    else if (!webError || webError.hidden) window.ws2.webSetVisible(attachedKey, true); // 全关且无错误页 → 恢复
  }
  try { new MutationObserver(syncOverlayVeil).observe(document.body, { childList: true }); } catch (e) { /* ignore */ }

  function syncWebActiveClass() { document.body.classList.toggle('ws-web-active', !!attachedKey); } // toast 锚点切换用

  window.__webReload = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'reload'); };
  window.__webBack = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'back'); };
  window.__webForward = function () { var k = window.__webActiveKey(); if (k) window.ws2.webNav(k, 'forward'); };
  window.__webFocusAddr = function () { if (window.__focusMainFrame) window.__focusMainFrame(); if (addrInput) { addrInput.focus(); addrInput.select(); } };

  // sidebar 启动可能在本脚本定义 __webShowEmpty 之前就想显示开屏空态（顺序不定）→ 消费其 pending 标志。
  if (window.__pendingEmptyState) { window.__pendingEmptyState = false; window.__webShowEmpty(); }
})();
