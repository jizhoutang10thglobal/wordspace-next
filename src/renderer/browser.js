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
  const veilEl = document.getElementById('web-veil');
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
  let findKey = null; // 查找条打开时锁定的标签 key（切标签必关查找条,但 stop 要发给打开时那个标签,别发给新标签）
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
  // 查找条激活时顶部收缩出条高（原生 view 会盖住 DOM，spec §4.6 推荐方案）。
  // 沉浸收起（Arc 对标，spec=docs/features/immersive-collapse.md）：原来收起时左侧留 52px 条给
  // 悬浮展开钮（COLLAPSED_STRIP）——钮和条都删了，网页贴 x=0 全宽 = Wendi 要的「零缝隙」。
  const FIND_STRIP = 52;
  let toastInset = 0;
  let peekPush = false; // 快照失败时的退路：view 同宽右移让出侧栏带（正路是 __webPeekSnap 截帧垫底）
  function viewBounds() {
    const r = mainEl.getBoundingClientRect();
    let x = Math.round(r.left);
    let width = Math.round(r.width);
    let y = Math.round(r.top);
    let height = Math.round(r.height);
    if (findOpen) { y += FIND_STRIP; height -= FIND_STRIP; }
    if (toastInset) height -= toastInset;
    if (peekPush) x += sbWidth(); // 同宽右移（右缘出窗被裁掉）：不改 width → 网页不 reflow，peek 收回瞬间复原
    return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
  }
  function rebound() { if (attachedKey) window.ws2.webSetBounds(attachedKey, viewBounds()); }
  window.__webRebound = rebound;
  try { new ResizeObserver(() => rebound()).observe(mainEl); } catch { window.addEventListener('resize', rebound); }

  // ---- 沉浸收起 × 网页 view（sidebar.js 调）----
  const sbWidth = () => {
    const v = parseInt(getComputedStyle(document.getElementById('sidebar')).getPropertyValue('--sb-width'), 10);
    return v >= 180 && v <= 520 ? v : 260;
  };
  // peek 快照垫底（Wendi 2026-07-17，替换原「同宽右移」推挤）：DOM 盖不住原生 view，滑出前
  // 对 view 截一帧垫在侧栏下（.web-peek-snap，z 230 < 侧栏 240）、摘掉 view——页面视觉纹丝不动
  // （Arc 同款）。截图失败/超时(250ms)退回推让（peekPush），peek 绝不能被截图卡住。
  // seq 是取消令牌：截图在途时 peek 已取消/已换台，迟到的截图不生效。
  let peekSnapEl = null;
  let peekSnapSeq = 0;
  let peekSnapMode = null; // 'snap' | 'push' | null
  window.__webPeekSnap = (on, cb) => {
    if (on) {
      const seq = ++peekSnapSeq;
      if (!attachedKey) { if (cb) cb(); return; } // 文档态：DOM 悬浮层直接盖，无需动 view
      const key = attachedKey;
      const timeout = new Promise((r) => setTimeout(() => r(null), 250));
      Promise.race([window.ws2.webCapture(key).catch(() => null), timeout]).then((dataUrl) => {
        if (seq !== peekSnapSeq || attachedKey !== key) { if (cb) cb(); return; }
        if (dataUrl) {
          const b = viewBounds();
          const img = document.createElement('img');
          img.className = 'web-peek-snap';
          img.src = dataUrl;
          img.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px`;
          document.body.appendChild(img);
          peekSnapEl = img;
          peekSnapMode = 'snap';
          window.ws2.webHideAll();
        } else {
          peekSnapMode = 'push';
          peekPush = true;
          rebound();
        }
        if (cb) cb();
      });
    } else {
      peekSnapSeq++; // 取消在途截图
      if (peekSnapMode === 'snap') {
        const e = activeEntry();
        if (e && T.isWebEntry(e) && e.url && attachedKey === keyOf(e)) window.ws2.webShow(attachedKey, viewBounds());
        // 等 view 真挂回再撤快照（下两帧），不闪素底；引用局部化防误删后续快照
        const el = peekSnapEl;
        peekSnapEl = null;
        if (el) requestAnimationFrame(() => requestAnimationFrame(() => el.remove()));
      } else if (peekSnapMode === 'push') {
        peekPush = false;
        rebound();
      }
      peekSnapMode = null;
    }
  };

  // web 态给底部 toast 让位：临时把 view 底部收起一条（update-ui.js 等外部模块经 window.__webToastInset 用）。
  function webToastInset() {
    if (!attachedKey) return;
    toastInset = 72;
    rebound();
    clearTimeout(toastInsetTimer);
    toastInsetTimer = setTimeout(() => { toastInset = 0; rebound(); }, 6600);
  }
  window.__webToastInset = webToastInset;

  // 主进程推来的 toast（如「不支持下载」）在 view 盖着时会被挡住。
  function toastOverWeb(msg) {
    toast(msg);
    webToastInset();
  }

  // ---- 激活漏斗（sidebar.openTabRow 的 web 分支进来）----
  function surfaceOff() {
    newtabEl.hidden = true;
    errEl.hidden = true;
  }
  const setVeil = (on) => { if (veilEl) veilEl.hidden = !on; }; // 只在真网页 view attach 时开（#13）
  function activate(entry) {
    clearSubPage(); // 清子页面 DOM 状态（不 activateBack——activate 自己接管 view）
    closeFind();
    const key = keyOf(entry);
    if (!entry.url) { // 起始页：本地 surface，不建 view（§4.5.2 懒创建）
      if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; }
      errEl.hidden = true;
      setVeil(false);
      renderNewtab();
      newtabEl.hidden = false;
      setTimeout(() => { try { ntInput.focus(); } catch { /* detached */ } }, 0);
      syncChrome();
      return;
    }
    surfaceOff();
    const st = webState[key];
    if (!live.has(key)) { live.add(key); window.ws2.webLoadUrl(key, entry.url); } // 恢复的标签懒加载（§8）
    if (st && st.error) { // 上次加载失败：显示占位,别把空白 view 盖上去（P1:占位+重试按钮才可用）
      if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; }
      setVeil(false);
      showError(key, st.error);
    } else {
      attachedKey = key;
      setVeil(true); // 真网页 view 挂上 → veil 盖底下文档
      window.ws2.webShow(key, viewBounds());
    }
    syncChrome();
  }
  function detach() {
    if (attachedKey) { window.ws2.webHideAll(); attachedKey = null; }
    surfaceOff();
    setVeil(false);
    closeFind();
    clearSubPage(); // ⚠ 不 activateBack（要切到文档/查看器了,别把 web view 挂回来盖住文档,P1）
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

  // DOM 弹层（⌘T modal / SaveModal / 关闭确认 / ⌘P 面板 / AI 接入 / 更新面板）会被原生 view 盖住 →
  // 弹层存在期间临时摘掉 view,关掉后若激活的还是网页标签再挂回（视觉正确;标签状态不动）。
  // 摘掉会露出底下的空态/文档层（Wendi 2026-07-16「更新弹窗背景变白」）→ 摘之前先对 view 截一帧
  // 垫在弹层下（.web-snap，z 在弹层之下），视觉上「页面还在」；截图失败/超时(250ms)退回素底——
  // 弹层绝不能被截图卡住。快照垫好(或放弃)才摘 view：先摘会拍不到画面，也会闪一帧素底。
  let overlayPaused = false;
  let snapEl = null;
  const OVERLAY_SEL = '.sb-modal-overlay, #fp-overlay, .aiax-overlay, .dlp-overlay';
  try {
    new MutationObserver(() => {
      const has = !!document.querySelector(OVERLAY_SEL);
      if (has && attachedKey && !overlayPaused) {
        overlayPaused = true;
        const key = attachedKey;
        const timeout = new Promise((r) => setTimeout(() => r(null), 250));
        Promise.race([window.ws2.webCapture(key).catch(() => null), timeout]).then((dataUrl) => {
          // 迟到的 capture 取消令牌：capture 期间弹层已关(overlayPaused 翻 false)或标签已切 → else-if 分支
          // 已把 view 挂回可见,这里绝不能再动它。原来 webHideAll 无条件执行 → 快速开关下载 popover 时把刚
          // 挂回的 view 又藏了、网页区卡空白须切标签才恢复(对抗审查 P2；姊妹 __webPeekSnap 有同款守卫)。
          if (!overlayPaused || attachedKey !== key) return;
          if (dataUrl) {
            if (snapEl) snapEl.remove();
            const b = viewBounds();
            const img = document.createElement('img');
            img.className = 'web-snap';
            img.src = dataUrl;
            img.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px`;
            document.body.appendChild(img);
            snapEl = img;
          }
          window.ws2.webHideAll();
        });
      } else if (!has && overlayPaused) {
        overlayPaused = false;
        const e = activeEntry();
        if (e && T.isWebEntry(e) && e.url && attachedKey === keyOf(e)) window.ws2.webShow(attachedKey, viewBounds());
        // 等 view 真挂回（原生 attach 下一帧生效）再撤快照，避免闪一帧素底；
        // 引用局部化：紧接着又开新弹层时，迟到的撤图不能误删新快照。
        const el = snapEl;
        snapEl = null;
        if (el) requestAnimationFrame(() => requestAnimationFrame(() => el.remove()));
      }
    }).observe(document.body, { childList: true });
  } catch { /* MutationObserver 恒可用;防御 */ }

  function showError(key, err) {
    errTitle.textContent = err.code === 'crash' ? window.wsT('browser.pageCrashed') : window.wsT('browser.pageLoadFailed');
    errDesc.textContent = err.desc ? window.wsT('browser.errDesc', { url: err.url || '', desc: err.desc }) : (err.url || '');
    errEl.hidden = false;
    setVeil(false);
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
    setVeil(true);
    window.ws2.webShow(key, viewBounds());
  };

  // ---- 主进程状态推送 ----
  window.ws2.onWebTabUpdated((s) => {
    if (!s || !s.key) return;
    const prev = webState[s.key] || {};
    webState[s.key] = s;
    live.add(s.key); // 有状态推来 = view 已存在
    // 标签行/持久化跟随（url/title 变了才写，防每帧写盘）。
    // title 只在拿到**真标题**（page-title-updated 后 s.title 非空）时覆写；s.title=null（懒加载起步/
    // 导航中）完全不动 entry.title——恢复的标签保住持久化的旧名(如「Google」),不再闪「新标签页」
    // (Wendi 2026-07-17)。全新标签的「新标签页」名由 sidebar 建 entry 时自己起;无 <title> 的页面
    // 不触发 page-title-updated → 行保留上一个名字,与「显示占位假名」相比是更小的恶。
    if (sb() && (prev.url !== s.url || prev.title !== s.title || prev.favicon !== s.favicon)) {
      const patch = { url: s.url };
      if (s.title) patch.title = s.title;
      sb().updateWeb(s.key, patch);
    }
    // U3 导航加载反馈（治「渲染区闪回旧页面 1-2 秒」= 导航期零反馈）：loading 变化 → 轻量刷该标签行的 spinner。
    // 不走 updateWeb（那会落盘 + 整区 renderZones）；每个 s.key 都收，后台标签加载也转圈（Chrome 语义）。
    // 旧页面保留是原地导航现有行为（view 不摘、attachedKey 不变），不动导航模型——只补「正在加载」的可见反馈。
    if (sb() && sb().setTabLoading && prev.loading !== s.loading) {
      sb().setTabLoading(s.key, !!s.loading);
    }
    // 起始页 → 真网页的切换点：导航**真提交**（everCommitted,首次 did-navigate）才藏起始页 surface。
    // navigate() 会提前把 url 写进推送（地址栏要即时显示）,不能当提交信号——慢站的响应头没来之前
    // 起始页要一直盖着（submitNavigate 不再提前藏——fresh view 首绘前藏掉它会透出底下的文档,闪回 bug）。
    if (!newtabEl.hidden && s.everCommitted && s.url && isWebActive() && keyOf(activeEntry()) === s.key) {
      newtabEl.hidden = true;
      if (attachedKey === null) { attachedKey = s.key; window.ws2.webShow(s.key, viewBounds()); }
    }
    if (s.error && isWebActive() && keyOf(activeEntry()) === s.key) {
      showError(s.key, s.error);
    } else if (!s.error && attachedKey === s.key) {
      errEl.hidden = true; // 原地导航离开错误态且 view 一直挂着：只收占位（view 没被摘）
    } else if (
      !s.error && s.navSeq > (prev.navSeq || 0) && s.url &&
      isWebActive() && keyOf(activeEntry()) === s.key && attachedKey !== s.key
    ) {
      // P1 错误页恢复：出错时 showError 摘了 view（attachedKey=null）、错误页自身的提交又藏了起始页
      // （newtabEl.hidden=true）——于是 everCommitted 分支（!newtabEl.hidden 已 false）和上面的
      // error-clear 分支（attachedKey!==key）都够不着，占位 + 脱挂的 view 永久卡死（只有切标签靠 activate 复活）。
      // 补这条第三路：认「新页真提交」的沿——s.navSeq > prev.navSeq（主进程每 did-navigate 自增序号）。
      // 为什么不是 loading true→false 沿：那个沿会被 abort/-3（204 / 下载被 cancel / 被后续导航打断）也触发,
      // 但那些**没有提交**,此刻脱挂 view 里还是失败页残帧,重挂 = 露出原生错误页且丢了重试钮（对抗审查
      // CONFIRMED P2）。navSeq 沿只在真 did-navigate 亮:新文档已提交,首绘前是白底（view setBackgroundColor
      // '#fff'）绝不透出失败页,重挂零残帧闪回——与上方 everCommitted 起始页分支同一「提交沿挂」哲学。
      // 只认激活标签防后台标签的提交推把它的 view 盖上来；attachedKey!==key 是冗余澄清位（走到这条时
      // !s.error 且非 arm2 已蕴含 attachedKey!==key,留着标意图）。覆盖 omnibox 原地换址 + 导航条 reload 两条
      // 恢复路（都走 loadURL → did-navigate → navSeq++）；提交后不收尾的流式页也能挂上（不再卡死等 stop）。
      errEl.hidden = true;
      attachedKey = s.key;
      setVeil(true);
      window.ws2.webShow(s.key, viewBounds());
    }
    syncChrome();
  });
  window.ws2.onWebOpenRequest(async (r) => { // window.open / 右键「新标签页打开」/ 搜索选中 / 系统递来的链接（默认浏览器）
    if (!r || !r.url) return;
    // 冷启动（系统点链接把 app 拉起来）：等标签恢复整条跑完再建，否则新标签被 loadTabs 整体覆盖
    // （同 open-file 的 restoreReady 串行化；热路径 promise 已 resolved,微任务级开销）。
    if (window.__sbRestoreReady) await window.__sbRestoreReady;
    openWeb(r.url, r.url, !!r.background);
    if (r.background) toastOverWeb(window.wsT('browser.openedInBackground'));
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
    else if (cmd === 'open-settings') openSubPage('settings');
    else if (cmd === 'cycle-next') { if (window.__sbHooks && window.__sbHooks.cycleTab) window.__sbHooks.cycleTab(false); }
    else if (cmd === 'cycle-prev') { if (window.__sbHooks && window.__sbHooks.cycleTab) window.__sbHooks.cycleTab(true); }
    else if (/^tab-[1-9]$/.test(cmd || '')) { if (window.__sbHooks && window.__sbHooks.tabByIndex) window.__sbHooks.tabByIndex(+cmd.slice(4)); }
  });

  // ---- 收藏 / 历史镜像 ----
  // 子页面正在被输入时（焦点在它的输入框/组合中）不整页重建——否则后台标签导航推来的 changed 会把
  // 搜索框焦点、IME 组合、打开着的「清除数据」菜单全打掉（#7）。数据已进镜像,失焦后下次操作会刷。
  const subPageEditing = () => pageEl.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  window.ws2.onBookmarksChanged((s) => { bmState = s || bmState; renderFav(); if (newtabEl.hidden === false) renderNewtab(); if (subPage === 'bookmarks' && !subPageEditing()) renderBookmarksPage(); syncOmniStar(); });
  window.ws2.onHistoryChanged((s) => { histState = Array.isArray(s) ? s : histState; if (subPage === 'history' && !subPageEditing()) renderHistoryPage(); });
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
      if (r && r.blocked) { live.delete(key); toast(window.wsT('browser.unsupportedUrl')); return; }
      // ⚠ 这里既不藏起始页也不 attach view——fresh WebContentsView 首绘前透明,提前挂上会盖住起始页
      // 露白屏（闪回 bug 只修一半的根因,两路审查交叉确认）。attach + 藏起始页全交给 onWebTabUpdated
      // 的 everCommitted 分支（导航真提交后才切,慢站加载期起始页一直盖着,像 Chrome 停在原页）。
      // 若这是已 attach 的网页标签原地导航（attachedKey===key）,view 早已挂着,不受影响。
    }).catch(() => {});
  }

  // ---- 导航条（§4.1）----
  function subPageGuard() { if (subPage) closeSubPage(); } // 在子页面点导航 → 先回主视图
  navBack.onclick = () => { subPageGuard(); const e = activeEntry(); if (e && T.isWebEntry(e)) window.ws2.webNav(keyOf(e), 'back'); };
  navFwd.onclick = () => { subPageGuard(); const e = activeEntry(); if (e && T.isWebEntry(e)) window.ws2.webNav(keyOf(e), 'forward'); };
  navReload.onclick = (ev) => {
    subPageGuard();
    const e = activeEntry();
    if (e && T.isWebEntry(e) && e.url) {
      window.ws2.webNav(keyOf(e), 'reload');
      // 教学气泡只对真实鼠标点击（isTrusted）——⌘R 菜单路径走 __webMenu → navReload.click()，
      // 程序化 click isTrusted=false，用户已会快捷键、不弹。
      if (ev && ev.isTrusted && window.__wsCoach) window.__wsCoach('reload', window.wsT('sidebar.coachReload', { key: (window.__wsKbd ? window.__wsKbd('⌘R') : '⌘R') }));
    }
  };
  navHistory.onclick = () => { if (subPage === 'history') closeSubPage(); else openSubPage('history'); };

  // 同步导航条 disabled + omnibox 值/图标/星标。sidebar 每次 renderZones 结束都会调（__webChromeSync）。
  let lastSyncKey = null; // 上次同步时的激活标签 key——只在「激活标签真变了」时强制结束打字态（P2-3）
  function syncChrome() {
    const e = activeEntry();
    const web = !!(e && T.isWebEntry(e));
    // 键盘切标签(Ctrl+Tab/⌘1-9)不触发 omnibox blur → omniTyping 一直 true → syncOmni 被守卫吞掉、
    // 地址栏残留上个标签打的半截字,回车在新标签误导航（P2-3）。切标签 = 明确离开输入上下文:强制结束
    // 打字态、丢弃未提交输入。**只在 key 真变时做**——同标签的状态更新(后台 title 推送)不能碰,否则
    // 打字被 title 事件冲掉的老 bug(守卫存在的原因)会回来。
    const curKey = e ? keyOf(e) : null;
    if (curKey !== lastSyncKey) {
      lastSyncKey = curKey;
      omniTyping = false;
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
      hideSug();
    }
    const st = web ? webState[keyOf(e)] : null;
    navBack.disabled = !(web && st && st.canGoBack); // 文档标签暂无导航历史 → 恒灰（§4.1 注）
    navFwd.disabled = !(web && st && st.canGoForward);
    navReload.disabled = !(web && e.url);
    // web 态（含起始页/子页面）隐藏文档编辑 chrome（⋯菜单 z65 / 文档面包屑）——否则它们浮在 web
    // surface(z60) 之上,起始页点右上角 ⋯ 会对看不见的后台文档导出 PDF（#8）。
    document.body.classList.toggle('ws-web-on', web);
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
      // i18n × #227 快捷键 tooltip：文案走 wsT(字典值含 ⌘ 字形)，再经 __wsKbd 平台归一(mac 保 ⌘/其他 ⌘→Ctrl+)。
      { const bmT = on ? window.wsT('browser.unbookmark') : window.wsT('browser.bookmark'); omniStar.title = window.__wsKbd ? window.__wsKbd(bmT) : bmT; }
    }
  }
  omniStar.onclick = () => toggleBookmark();
  let bmBusy = false;
  async function toggleBookmark() { // ⌘D/☆：落书签栏；取消=跨全部文件夹删该 url（§4.6/§4.9）
    const e = activeEntry();
    if (!e || !T.isWebEntry(e) || !e.url) return;
    if (bmBusy) return; // 连按去重（#12）：bmState 是推送前的陈旧镜像,快速双击 ⌘D 会读到旧态各加一条
    bmBusy = true;
    try {
      const st = webState[keyOf(e)] || {};
      if (bmState.bookmarks.some((b) => b.url === e.url)) await window.ws2.bmRemoveByUrl(e.url);
      else await window.ws2.bmAdd({ title: st.title || e.title || e.url, url: e.url, favicon: st.favicon || undefined });
      syncOmniStar(); // bmState 由 bookmarks-changed 推送刷新；星标即时反馈
    } finally { bmBusy = false; }
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
      // pick（选建议）与直接导航同款：都不提前藏起始页/attach——起始页态下会盖白屏（同闪回根因）。
      // 交给 everCommitted 分支。已 attach 的网页标签原地导航时 view 早挂着,不受影响。
      if (pick) { live.add(keyOf(e)); window.ws2.webLoadUrl(keyOf(e), pick.url); }
      else submitNavigate(keyOf(e), raw);
    } else {
      // 文档/文件/空态：开新网页标签再导航（文档不被顶掉）
      if (pick) focusOrOpen(pick.url, pick.title);
      else window.__webOpenInput(raw);
    }
  }
  let blurTimer = null; // blur 收起下拉的 150ms 定时器——回焦/打字要取消它,否则它会把刚打的字回吞（#10）
  const cancelBlur = () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } };
  omniInput.addEventListener('focus', () => { cancelBlur(); omniInput.select(); });
  omniInput.addEventListener('input', () => {
    cancelBlur();
    omniTyping = true;
    sugOriginal = omniInput.value;
    sug = computeSug(omniInput.value);
    sugSel = -1;
    renderSug();
  });
  omniInput.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; // IME 组合中的 Enter/方向键是选字,不是提交（血泪教训:IME 走 input 事件）
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
    cancelBlur();
    blurTimer = setTimeout(() => { omniTyping = false; hideSug(); syncOmni(); blurTimer = null; }, 150); // 150ms 宽限：点建议的时间窗（§4.2）
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
      empty.textContent = window.wsT('browser.favEmpty');
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
      empty.textContent = window.wsT('browser.newtabTilesEmpty');
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
    if (ev.isComposing || ev.keyCode === 229) return; // IME 确认键不当提交
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
    findKey = keyOf(e); // 锁定当前标签——后续 find/stop 都发给它,不看 activeEntry（切标签会变）
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
    if (findKey) window.ws2.webFindStop(findKey, 'clearSelection'); // 清打开时那个标签的高亮,别错发给切过去的新标签（#5）
    findKey = null;
    rebound();
  }
  function findGo(forward, next) {
    if (!findKey) return;
    const q = findInput.value;
    if (!q) { findCount.hidden = true; return; }
    window.ws2.webFind(findKey, q, { forward, findNext: next });
  }
  findInput.addEventListener('input', () => { findGo(true, false); });
  findInput.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; // IME 确认键不当「下一个」
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
    setVeil(false);
    closeFind();
    newtabEl.hidden = true;
    errEl.hidden = true;
    if (name === 'history') renderHistoryPage();
    else if (name === 'bookmarks') renderBookmarksPage();
    else renderSettingsPage();
    pageEl.hidden = false;
  }
  // 只清子页面 DOM/状态,不回主视图（detach/activate 用——它们自己接管 view）。
  function clearSubPage() {
    if (!subPage) return;
    subPage = null;
    pageEl.hidden = true;
    pageEl.innerHTML = '';
  }
  // 用户从子页面「返回」：清 + 回到激活的 web 标签主视图（复用 activate 的完整逻辑,含错误占位/起始页）。
  function closeSubPage() {
    if (!subPage) return;
    clearSubPage();
    const e = activeEntry();
    if (e && T.isWebEntry(e)) activate(e);
  }
  function pageShell(title, actions) {
    pageEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'wp-wrap';
    const top = document.createElement('div');
    top.className = 'wp-top';
    const back = document.createElement('button');
    back.className = 'wp-back';
    back.title = window.wsT('common.back');
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
    clearBtn.innerHTML = TRASH14 + '<span>' + window.wsT('browser.clearBrowsingData') + '</span>';
    actions.appendChild(clearBtn);
    const wrap = pageShell(window.wsT('browser.history'), actions);
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
      menu.append(mk(window.wsT('browser.lastHour'), '1h'), mk(window.wsT('browser.last24h'), '24h'), mk(window.wsT('browser.last7d'), '7d'));
      const sep = document.createElement('div');
      sep.className = 'wp-clear-sep';
      menu.appendChild(sep);
      menu.appendChild(mk(window.wsT('browser.clearAll'), 'all', true));
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
    input.placeholder = window.wsT('browser.searchHistory');
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
        empty.textContent = q ? window.wsT('browser.noMatchingHistory') : window.wsT('browser.noHistory');
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
          const label = dk === todayKey ? window.wsT('browser.today') : dk === yesterdayKey ? window.wsT('browser.yesterday') : window.wsT('browser.monthDay', { month: d.getMonth() + 1, day: d.getDate() });
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
        x.title = window.wsT('common.delete');
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
    newFolder.innerHTML = FOLDER_PLUS14 + '<span>' + window.wsT('browser.newFolder') + '</span>';
    newFolder.onclick = () => window.ws2.bmAddFolder(window.wsT('browser.newFolder'));
    const imp = document.createElement('button');
    imp.className = 'wp-btn';
    imp.innerHTML = UPLOAD14 + '<span>' + window.wsT('browser.import') + '</span>';
    imp.onclick = async () => {
      let r;
      try { r = await window.ws2.bmImport(); } catch { return; }
      if (!r || r.canceled) return;
      if (r.error) { toast(window.wsT('browser.importFailed', { error: r.error })); return; }
      toast(r.parsed === 0
        ? window.wsT('browser.importNoneRecognized')
        : r.added === 0
          ? window.wsT('browser.importAllExist')
          : window.wsT('browser.importedCount', { count: r.added })); // 报净新增（拍板#6）
    };
    const exp = document.createElement('button');
    exp.className = 'wp-btn';
    exp.innerHTML = DOWNLOAD14 + '<span>' + window.wsT('browser.export') + '</span>';
    exp.onclick = async () => {
      let r;
      try { r = await window.ws2.bmExport(); } catch { return; }
      if (r && r.ok) toast(window.wsT('browser.exportedToast'));
    };
    actions.append(newFolder, imp, exp);
    const wrap = pageShell(window.wsT('browser.bookmarks'), actions);
    const hint = document.createElement('p');
    hint.className = 'wp-hint';
    hint.textContent = window.wsT('browser.bookmarksHint');
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
      name.title = f.id === BM_BAR ? window.wsT('browser.bookmarkBarFixed') : window.wsT('browser.renameFolder');
      name.onblur = () => { const v = name.value.trim(); if (v && v !== f.name) window.ws2.bmRenameFolder(f.id, v); else name.value = f.name; };
      name.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); name.blur(); } };
      const count = document.createElement('span');
      count.className = 'wp-folder-count';
      count.textContent = String(items.length);
      head.append(name, count);
      if (f.id !== BM_BAR) {
        const del = document.createElement('button');
        del.className = 'wp-btn is-danger wp-folder-del';
        del.title = window.wsT('browser.deleteFolder');
        del.innerHTML = TRASH14;
        del.onclick = () => window.ws2.bmRemoveFolder(f.id);
        head.appendChild(del);
      }
      sec.appendChild(head);
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'wp-hint';
        empty.textContent = window.wsT('browser.emptyFolder');
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
        open.title = window.wsT('common.open');
        open.innerHTML = EXT13;
        open.onclick = () => { closeSubPage(); focusOrOpen(b.url, b.title); }; // 同 §4.3 语义（拍板#3）
        const del = document.createElement('button');
        del.className = 'wp-row-x';
        del.title = window.wsT('common.delete');
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
    const T = (k) => (typeof window.wsT === 'function' ? window.wsT(k) : k);
    const wrap = pageShell(T('settings.pageTitle'));

    // 语言三态（偏好归 main 管；切换后整窗 reload 生效——静态外壳建一次不重建，plan 决策1）。
    const langSec = document.createElement('div');
    langSec.className = 'wp-sec';
    langSec.textContent = T('settings.language');
    wrap.appendChild(langSec);
    const lrow = document.createElement('div');
    lrow.className = 'wp-set-row';
    const llabel = document.createElement('span');
    llabel.className = 'wp-set-label';
    llabel.textContent = T('settings.uiLanguage');
    const ldesc = document.createElement('span');
    ldesc.className = 'wp-set-desc';
    ldesc.textContent = T('settings.languageDesc');
    const lctl = document.createElement('span');
    lctl.className = 'wp-set-ctl';
    const lsel = document.createElement('select');
    lsel.id = 'wp-language-select';
    for (const [val, key] of [['system', 'settings.langSystem'], ['zh', 'settings.langZh'], ['en', 'settings.langEn']]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = T(key);
      lsel.appendChild(opt);
    }
    if (window.ws2 && window.ws2.getLanguage) {
      window.ws2.getLanguage().then((p) => { lsel.value = p || 'system'; }).catch(() => {});
    }
    // 切语言 → main 持久化 + 广播 language-changed → i18n-ui.js 整窗 reload（新语言全量生效）。
    lsel.onchange = () => { if (window.ws2 && window.ws2.setLanguage) window.ws2.setLanguage(lsel.value); };
    lctl.appendChild(lsel);
    lrow.append(llabel, ldesc, lctl);
    wrap.appendChild(lrow);

    // 外观三态（与菜单栏 radio / ⋯菜单同一真相源，都从 main 查；这是 Colin 追认的第三入口）
    const appSec = document.createElement('div');
    appSec.className = 'wp-sec';
    appSec.textContent = T('settings.appearance');
    wrap.appendChild(appSec);
    const arow = document.createElement('div');
    arow.className = 'wp-set-row';
    const alabel = document.createElement('span');
    alabel.className = 'wp-set-label';
    alabel.textContent = T('settings.theme');
    const adesc = document.createElement('span');
    adesc.className = 'wp-set-desc';
    adesc.textContent = T('settings.themeDesc');
    const actl = document.createElement('span');
    actl.className = 'wp-set-ctl';
    const asel = document.createElement('select');
    asel.id = 'wp-appearance-select';
    for (const [val, name] of [['system', T('common.apprSystem')], ['light', T('common.apprLight')], ['dark', T('common.apprDark')]]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = name;
      asel.appendChild(opt);
    }
    if (window.ws2 && window.ws2.getAppearance) {
      window.ws2.getAppearance().then((p) => { asel.value = p || 'system'; }).catch(() => {});
    }
    asel.onchange = () => { if (window.ws2 && window.ws2.setAppearance) window.ws2.setAppearance(asel.value); };
    actl.appendChild(asel);
    arow.append(alabel, adesc, actl);
    wrap.appendChild(arow);

    const sec = document.createElement('div');
    sec.className = 'wp-sec';
    sec.textContent = T('settings.browser');
    wrap.appendChild(sec);
    const row = document.createElement('div');
    row.className = 'wp-set-row';
    const label = document.createElement('span');
    label.className = 'wp-set-label';
    label.textContent = T('settings.defaultSearchEngine');
    const desc = document.createElement('span');
    desc.className = 'wp-set-desc';
    desc.textContent = T('settings.defaultSearchEngineDesc');
    const ctl = document.createElement('span');
    ctl.className = 'wp-set-ctl';
    const sel = document.createElement('select');
    sel.id = 'wp-engine-select'; // i18n 加了语言 select 后,设置页有 3 个 select——给引擎 select 显式 id,e2e 精确定位(不再靠 :not 排除)
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

    // 默认浏览器（macOS 点按钮后系统会弹确认框,确认前 isDefault 不翻真 → 文案按「已请求」处理）
    const row2 = document.createElement('div');
    row2.className = 'wp-set-row';
    const label2 = document.createElement('span');
    label2.className = 'wp-set-label';
    label2.textContent = T('settings.defaultBrowser');
    const desc2 = document.createElement('span');
    desc2.className = 'wp-set-desc';
    desc2.textContent = T('settings.defaultBrowserDesc');
    const ctl2 = document.createElement('span');
    ctl2.className = 'wp-set-ctl';
    const btn = document.createElement('button');
    btn.className = 'wp-btn';
    btn.textContent = T('settings.setDefaultBrowser');
    window.ws2.browserDefaultStatus().then((s) => {
      if (!s) return;
      if (s.isDefault) { btn.textContent = T('settings.isDefaultBrowser'); btn.disabled = true; }
      else if (!s.packaged) { btn.textContent = T('settings.installedOnly'); btn.disabled = true; }
    }).catch(() => {});
    btn.onclick = async () => {
      try {
        const r = await window.ws2.browserSetDefault();
        if (r && r.isDefault) { btn.textContent = T('settings.isDefaultBrowser'); btn.disabled = true; }
        else if (r && r.ok) btn.textContent = T('settings.confirmInSystemDialog');
        else btn.textContent = T('settings.setDefaultFailed');
      } catch { btn.textContent = T('settings.setDefaultFailed'); }
    };
    ctl2.appendChild(btn);
    row2.append(label2, desc2, ctl2);
    wrap.appendChild(row2);
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
    if (cmd === 'reload') { navReload.click(); return true; } // ⌘R 刷新当前网页标签：复用导航条按钮的 disabled 守卫（起始页 url=null → 按钮禁用 → 点击 no-op，不炸）
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
    // 弹层守卫（§7）：任何 modal/面板开着不穿透——含 AI 接入 .aiax-overlay / 下载 popover .dlp-overlay（#11,与 view 暂停的 OVERLAY_SEL 口径一致）
    if (document.querySelector('.sb-modal-overlay, #fp-overlay, .aiax-overlay, .dlp-overlay')) return;
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

  // ==== 下载（§4.11）：工具栏进度环 + popover 列表 ==================================
  // 状态源 = 主进程 downloads-changed 推送（+ 打开 popover 时 dlList() 拉一次触发 fileMissing sweep）。
  // renderer 无 require → truncateMiddle/aggregateProgress/formatBytes/逐状态操作在这里内联等价实现
  // （照 ui-demo src/lib/downloads.ts；逐状态操作可见性照 spec §4.11 表）。
  // 增量渲染（P5，updater 狂闪血教训）：进度高频推送只改 stroke-dashoffset/徽标/进度条 width/状态文本，
  // 绝不整卡整列重建、绝不抢焦点。popover 根挂 document.body 直接子节点 + 注册 .dlp-overlay 进 OVERLAY_SEL
  // → 打开即摘原生 view + 快照垫底，340px 卡片在快照上完整渲染、veil 收得到 click。
  (function initDownloads() {
    const navDl = document.getElementById('nav-downloads');
    if (!navDl || !window.ws2 || !window.ws2.dlList || !window.ws2.onDownloadsChanged) return; // 老 preload/DOM 不齐时安静退场
    const ringWrap = navDl.querySelector('.dl-ring-wrap');
    const ringBar = navDl.querySelector('.dl-ring-bar');
    const badge = navDl.querySelector('.dl-badge');
    const RING_C = 2 * Math.PI * 8; // 进度环 r=8 周长（dasharray 基准）
    if (ringBar) { ringBar.style.strokeDasharray = String(RING_C); ringBar.style.strokeDashoffset = String(RING_C); }

    let entries = [];        // 最新下载列表（主进程已按 startedAt 倒序）
    let ringBatch = new Set(); // 进度环「当前批次」的条目 id：在途条目加入,已完成的**留在批次里撑住分母**,
                               // 直到批次全部落地(无在途)才清空——兑现 spec §4.11「单条先完成环不回退」
                               // （对齐 ui-demo lib/downloads.ts 的 batchIds；真 app 主进程无 batchIds,批次账放 renderer）。
    let popEl = null;        // .dlp-overlay 根（null=未开）
    let listEl = null, emptyEl = null, clearBtn = null; // popover 持久子元素
    const rowEls = new Map(); // id -> 行 DOM（增量复用）
    let onEsc = null;

    // —— 纯逻辑内联（照 ui-demo lib/downloads.ts）——
    function truncateMiddle(name, max) {
      max = max || 34;
      const chars = Array.from(name);
      if (chars.length <= max) return name;
      const tail = Math.max(10, Math.floor(max * 0.4));
      const head = Math.max(1, max - tail - 1);
      return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
    }
    function formatBytes(n) {
      if (!(n > 0)) return '0 B';
      if (n < 1024) return n + ' B';
      const kb = n / 1024;
      if (kb < 1024) return Math.round(kb) + ' KB';
      const mb = kb / 1024;
      if (mb < 1024) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
      const gb = mb / 1024;
      return (gb < 10 ? gb.toFixed(1) : Math.round(gb)) + ' GB';
    }
    // 聚合进度（工具栏环，spec §4.11）：批次 = 在途 + 本批已完成条目（已完成的**留在分子分母里**，
    // 单条先完成时分母不缩小 → 环只前进不回退）。active=在途数（徽标）；active 归零 → 清批次、环隐藏。
    // ⚠ 别退回「只对 state==='downloading' 求和」：那样某条先完成会被移出分母，环可见地倒退（对抗审查 P2）。
    function aggregateProgress(list) {
      const byId = new Map(list.map((e) => [e.id, e]));
      for (const e of list) if (e.state === 'downloading') ringBatch.add(e.id);
      const active = list.filter((e) => e.state === 'downloading').length;
      if (active === 0) { ringBatch.clear(); return { active: 0, pct: 0 }; }
      // 只算仍存在的批次成员（被移除/清空的条目自然掉出）；已完成条目 sizeBytes 用实收兜底（见 web-tabs done）。
      const batch = [...ringBatch].map((id) => byId.get(id)).filter(Boolean);
      const recv = batch.reduce((s, e) => s + (e.receivedBytes || 0), 0);
      const total = batch.reduce((s, e) => s + (e.sizeBytes || 0), 0);
      return { active: active, pct: total > 0 ? Math.min(1, recv / total) : 0 };
    }
    // 逐状态操作可见性（spec §4.11：downloading→取消；completed→访达+移除；failed/canceled/interrupted→重试+移除；fileMissing→仅移除）
    const isTerminal = (s) => s !== 'downloading';
    const canRetry = (s) => s === 'failed' || s === 'canceled' || s === 'interrupted';
    const canReveal = (s) => s === 'completed';
    const canRemove = (s) => s !== 'downloading';

    // —— 内联 SVG（无 lucide）：文件类型图标（照 ui-demo extIconOf）+ 动作图标 ——
    const ICO_IMAGE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="10" cy="13" r="2"/><path d="m20 17-1.1-1.1a2 2 0 0 0-2.8 0L10 22"/>';
    const ICO_ARCHIVE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 7h1"/><path d="M10 11h1"/><path d="M10 15h1"/>';
    const ICO_TEXT = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>';
    const ICO_FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>';
    const ICO_X = '<path d="M18 6L6 18M6 6l12 12"/>';
    const ICO_REVEAL = '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/><path d="M2 11h20"/>';
    const ICO_RETRY = '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>';
    const ICO_DL = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>';
    const ICO_TRASH = '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>';
    function svg(paths, size) {
      return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
    }
    function extIco(name) {
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      if (/^(png|jpe?g|gif|webp|svg|heic)$/.test(ext)) return ICO_IMAGE;
      if (/^(zip|dmg|exe|gz|tar|7z|rar)$/.test(ext)) return ICO_ARCHIVE;
      if (/^(pdf|docx?|html?|md|txt)$/.test(ext)) return ICO_TEXT;
      return ICO_FILE;
    }

    // —— 工具栏进度环（增量：零态纯图标；有在途 = 环 + 徽标，只改 dashoffset/徽标文本）——
    function renderToolbar() {
      const agg = aggregateProgress(entries);
      if (agg.active > 0) {
        if (ringWrap) ringWrap.classList.add('is-active');
        if (ringBar) ringBar.style.strokeDashoffset = String(RING_C * (1 - agg.pct));
        if (badge) badge.textContent = String(agg.active);
      } else if (ringWrap) {
        ringWrap.classList.remove('is-active');
      }
    }

    function statusText(e) {
      const s = e.state;
      if (s === 'downloading') {
        const pct = e.sizeBytes > 0 ? Math.floor((e.receivedBytes / e.sizeBytes) * 100) : 0;
        return window.wsT('browser.dlProgress', { done: formatBytes(e.receivedBytes), total: formatBytes(e.sizeBytes), pct: pct });
      }
      if (s === 'completed') return window.wsT('browser.dlStateCompleted') + ' · ' + formatBytes(e.sizeBytes);
      if (s === 'failed') return window.wsT('browser.dlStateFailed');
      if (s === 'canceled') return window.wsT('browser.dlStateCanceled');
      if (s === 'interrupted') return window.wsT('browser.dlStateInterrupted');
      return window.wsT('browser.dlStateFileMissing');
    }

    async function doReveal(e) {
      try {
        const r = await window.ws2.dlReveal(e.id);
        if (r && r.missing) toast(window.wsT('browser.dlRevealToast', { name: e.filename }));
      } catch (err) { /* 主进程不可用 */ }
    }

    // 动作区（随 state 变才重建；进行中态每帧不动这里）
    function buildActs(actsEl, e) {
      actsEl.textContent = '';
      const s = e.state;
      const mk = (paths, size, cls, titleKey, fn) => {
        const b = document.createElement('button');
        b.className = 'dl-act' + (cls ? ' ' + cls : '');
        b.title = window.wsT(titleKey);
        b.innerHTML = svg(paths, size);
        b.addEventListener('click', fn);
        actsEl.appendChild(b);
      };
      if (s === 'downloading') mk(ICO_X, 14, 'is-danger', 'browser.dlCancel', () => window.ws2.dlCancel(e.id));
      if (canReveal(s)) mk(ICO_REVEAL, 14, '', 'browser.dlReveal', () => doReveal(e));
      if (canRetry(s)) mk(ICO_RETRY, 13, '', 'browser.dlRetry', () => window.ws2.dlRetry(e.id));
      if (canRemove(s)) mk(ICO_X, 14, 'is-danger', 'browser.dlRemove', () => window.ws2.dlRemove(e.id));
    }

    function buildRow() {
      const row = document.createElement('div');
      row.className = 'dl-row';
      const ico = document.createElement('span');
      ico.className = 'dl-row-ico';
      const main = document.createElement('div');
      main.className = 'dl-row-main';
      const name = document.createElement('span');
      name.className = 'dl-name';
      const status = document.createElement('span');
      status.className = 'dl-status';
      const bar = document.createElement('span');
      bar.className = 'dl-bar';
      const fill = document.createElement('span');
      fill.className = 'dl-bar-fill';
      bar.appendChild(fill);
      main.appendChild(name);
      main.appendChild(status);
      main.appendChild(bar);
      const acts = document.createElement('div');
      acts.className = 'dl-acts';
      row.appendChild(ico);
      row.appendChild(main);
      row.appendChild(acts);
      row._els = { ico: ico, name: name, status: status, bar: bar, fill: fill, acts: acts };
      row._state = null;
      row._name = null;
      return row;
    }

    // 增量更新一行：name/icon 仅名变时动；进行中态每帧只改 status + width；state 变才重建动作区。
    function updateRow(row, e) {
      const els = row._els;
      if (row._name !== e.filename) {
        els.name.textContent = truncateMiddle(e.filename);
        els.name.title = e.filename;
        els.ico.innerHTML = svg(extIco(e.filename), 16);
        row._name = e.filename;
      }
      els.status.textContent = statusText(e);
      els.status.classList.toggle('is-danger', e.state === 'failed');
      const downloading = e.state === 'downloading';
      els.bar.hidden = !downloading;
      if (downloading) {
        const pct = e.sizeBytes > 0 ? Math.floor((e.receivedBytes / e.sizeBytes) * 100) : 0;
        els.fill.style.width = pct + '%';
      }
      if (row._state !== e.state) {
        row.dataset.state = e.state;
        row.classList.toggle('is-missing', e.state === 'fileMissing');
        buildActs(els.acts, e);
        row._state = e.state;
      }
    }

    // popover 列表（增量：按 id 复用行，insertBefore 只移动既有节点、不重建，不重启进度条 transition）
    function renderList() {
      if (!popEl) return;
      clearBtn.hidden = !entries.some((e) => isTerminal(e.state)); // 有终态才显「清空」
      if (entries.length === 0) {
        listEl.hidden = true;
        emptyEl.hidden = false;
        rowEls.forEach((r) => r.remove());
        rowEls.clear();
        return;
      }
      emptyEl.hidden = true;
      listEl.hidden = false;
      const seen = new Set();
      let prev = null;
      for (const e of entries) {
        seen.add(e.id);
        let row = rowEls.get(e.id);
        if (!row) { row = buildRow(); rowEls.set(e.id, row); }
        updateRow(row, e);
        const next = prev ? prev.nextSibling : listEl.firstChild;
        if (next !== row) listEl.insertBefore(row, next);
        prev = row;
      }
      rowEls.forEach((row, id) => { if (!seen.has(id)) { row.remove(); rowEls.delete(id); } });
    }

    // anchorPos（照 ui-demo：读 [data-dl-anchor] rect、钳窗口内；无按钮回落左上，卡片 340 + 边距 = 356）
    function anchorPos() {
      const el = document.querySelector('[data-dl-anchor]');
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.bottom > 0) {
          return {
            left: Math.max(10, Math.min(r.left - 8, window.innerWidth - 356)),
            top: Math.min(r.bottom + 8, window.innerHeight - 120),
          };
        }
      }
      return { left: 12, top: 52 };
    }

    function openPop() {
      if (popEl) return;
      const overlay = document.createElement('div');
      overlay.className = 'dlp-overlay';
      const veil = document.createElement('div');
      veil.className = 'dlp-veil';
      veil.addEventListener('click', closePop);
      const card = document.createElement('div');
      card.className = 'dlp';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', window.wsT('browser.dlTitle'));
      const pos = anchorPos();
      card.style.left = pos.left + 'px';
      card.style.top = pos.top + 'px';
      const head = document.createElement('header');
      head.className = 'dlp-head';
      const title = document.createElement('span');
      title.className = 'dlp-title';
      title.textContent = window.wsT('browser.dlTitle');
      clearBtn = document.createElement('button');
      clearBtn.className = 'dlp-clear';
      clearBtn.innerHTML = svg(ICO_TRASH, 12) + '<span></span>';
      clearBtn.lastChild.textContent = window.wsT('browser.dlClear');
      clearBtn.hidden = true;
      clearBtn.addEventListener('click', () => window.ws2.dlClear());
      head.appendChild(title);
      head.appendChild(clearBtn);
      card.appendChild(head);
      emptyEl = document.createElement('div');
      emptyEl.className = 'dlp-empty';
      emptyEl.hidden = true;
      const eico = document.createElement('span');
      eico.className = 'dlp-empty-ico';
      eico.innerHTML = svg(ICO_DL, 20);
      const etext = document.createElement('div');
      etext.className = 'dlp-empty-text';
      etext.textContent = window.wsT('browser.dlEmpty');
      const ehint = document.createElement('div');
      ehint.className = 'dlp-empty-hint';
      ehint.textContent = window.wsT('browser.dlEmptyHint');
      emptyEl.appendChild(eico);
      emptyEl.appendChild(etext);
      emptyEl.appendChild(ehint);
      listEl = document.createElement('div');
      listEl.className = 'dlp-list';
      listEl.hidden = true;
      card.appendChild(emptyEl);
      card.appendChild(listEl);
      overlay.appendChild(veil);
      overlay.appendChild(card);
      document.body.appendChild(overlay); // 直接挂 body（OVERLAY_SEL 非 subtree observer 要求）
      popEl = overlay;
      rowEls.clear();
      renderList();
      // 打开即拉一次（触发主进程 fileMissing sweep + 拿最新）
      window.ws2.dlList().then((data) => { entries = Array.isArray(data) ? data : entries; renderToolbar(); renderList(); }).catch(() => { /* keep */ });
      onEsc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closePop(); } };
      window.addEventListener('keydown', onEsc);
    }

    function closePop() {
      if (!popEl) return;
      popEl.remove();
      popEl = null;
      listEl = emptyEl = clearBtn = null;
      rowEls.clear();
      if (onEsc) { window.removeEventListener('keydown', onEsc); onEsc = null; }
    }

    navDl.addEventListener('click', () => { if (popEl) closePop(); else openPop(); });

    // 状态源：主进程推送 → 环 + 列表（列表仅开着时）都刷
    window.ws2.onDownloadsChanged((data) => {
      entries = Array.isArray(data) ? data : [];
      renderToolbar();
      if (popEl) renderList();
    });
    // 启动补拉一次（拿既有下载记录 → 环初态正确）
    window.ws2.dlList().then((data) => { entries = Array.isArray(data) ? data : []; renderToolbar(); if (popEl) renderList(); }).catch(() => { /* keep default */ });
  })();

  // 初始 chrome 态
  syncChrome();

  // 启动竞态兜底（实测抓到,间歇复现）：sidebar 的 loadTabs 恢复流程走 IPC invoke,其余脚本求值与
  // invoke 响应的先后**不保证**——恢复的激活 web 标签可能在本脚本定义 __webActivate 之前就走完
  // openTabRow,那次激活被 `if (window.__webActivate)` 守卫静默跳过,view 永不 attach。
  // 这里补一拍：本脚本就绪后若激活的是 web 标签且还没 attach → 激活一次。两种时序都安全：
  // loadTabs 晚于本脚本 → 这里 no-op（active 还不是 web）,正常路径自己激活;早于 → 这里补上。
  setTimeout(() => {
    const e = activeEntry();
    if (e && T.isWebEntry(e) && !attachedKey && !subPage && newtabEl.hidden) activate(e);
  }, 0);
})();
