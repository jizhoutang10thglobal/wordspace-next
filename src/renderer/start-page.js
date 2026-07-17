// 默认屏导览页(方案 3「时间流」,Wendi 2026-07-17;spec docs/features/start-page.md,
// ui-demo 定稿 PR #259 移植)。挂在 #home(空态容器,显隐契约归 shell.js,本模块只管内容):
// 左栏=问候+统一 omnibox+按 今天/昨天/本周/更早 分组的最近文件;右栏=书签瓦片+最常访问+开始动作。
// 数据:recents IPC({path,openedAt},MAX 10)/bm-state/hist-state(+变更推送,与 browser.js
// 镜像互不相扰——那是闭包读不到,这里自己走同一套 IPC)。文案全走 window.wsT(start.*)。
(() => {
  const $ = (id) => document.getElementById(id);
  const wsT = (k, p) => (window.wsT ? window.wsT(k, p) : k);
  const baseName = (p) => String(p).split(/[\\/]/).pop();

  // ---- 纯函数(与 ui-demo src/lib/recency.ts 同一逻辑,移植保持行为一致) ----
  function groupKey(at, now) {
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (at >= todayStart) return 'today';
    const dayMs = 24 * 60 * 60 * 1000;
    if (at >= todayStart - dayMs) return 'yesterday';
    if (at >= todayStart - 6 * dayMs) return 'week';
    return 'earlier';
  }
  const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'];
  function folderLabel(p) {
    const segs = String(p).split(/[\\/]/).filter(Boolean);
    return segs.length >= 2 ? segs[segs.length - 2] : wsT('start.rootFolder');
  }
  function relTime(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return wsT('start.timeJustNow');
    if (m < 60) return wsT('start.timeMinutesAgo', { n: m });
    const h = Math.round(m / 60);
    if (h < 24) return wsT('start.timeHoursAgo', { n: h });
    return wsT('start.timeDaysAgo', { n: Math.round(h / 24) });
  }
  // URL 形输入 → 交给浏览器管道(URL/搜索的最终判定在主进程 url-input.js,这里只分「文件 vs 网」)
  const urlish = (v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(v);

  // ---- 问候 + 日期 ----
  function renderGreeting() {
    const h = new Date().getHours();
    const key = h < 6 ? 'start.greetNight' : h < 12 ? 'start.greetMorning' : h < 18 ? 'start.greetAfternoon' : 'start.greetEvening';
    $('sp-greet').textContent = wsT(key);
    const lang = window.wsLang === 'en' ? 'en-US' : 'zh-CN';
    $('sp-date').textContent = new Date().toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---- 最近文件时间流 ----
  let recentsCache = [];
  async function renderFlow() {
    try { recentsCache = (await window.ws2.recents()) || []; } catch { recentsCache = []; }
    const flow = $('sp-flow');
    flow.textContent = '';
    const byGroup = new Map();
    for (const r of recentsCache) {
      const k = groupKey(r.openedAt || 0, Date.now());
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(r);
    }
    let any = false;
    for (const k of GROUP_ORDER) {
      const items = byGroup.get(k);
      if (!items) continue;
      any = true;
      const cap = document.createElement('div');
      cap.className = 'sp-grp-cap';
      cap.textContent = wsT('start.' + (k === 'week' ? 'thisWeek' : k));
      flow.appendChild(cap);
      for (const r of items) {
        const row = document.createElement('button');
        row.className = 'sp-row';
        const ico = document.createElement('span');
        ico.className = 'sp-fico' + (/\.md$/i.test(r.path) ? ' is-md' : '');
        const name = document.createElement('span');
        name.className = 'sp-row-name';
        name.textContent = baseName(r.path).replace(/\.(html?|md)$/i, '');
        const meta = document.createElement('span');
        meta.className = 'sp-row-meta';
        const chip = document.createElement('span');
        chip.className = 'sp-chip';
        chip.textContent = folderLabel(r.path);
        meta.append(chip, document.createTextNode(relTime(r.openedAt || 0)));
        row.append(ico, name, meta);
        row.title = r.path; // 完整路径只进悬停,不进版面(Wendi 吐槽的裸路径)
        row.onclick = () => openDoc(r.path); // shell.js 全局漏斗(脏检查/载入/watch/recents)
        flow.appendChild(row);
      }
    }
    if (!any) {
      const empty = document.createElement('div');
      empty.className = 'sp-empty';
      empty.textContent = wsT('start.noRecents');
      flow.appendChild(empty);
    }
  }

  // ---- 书签瓦片 + 最常访问(与 browser.js 同源 IPC;起始页同款首字彩块,CSSOM 设色 CSP 安全) ----
  const BM_BAR = 'bm-bar';
  function tile(title, url, onClick) {
    const b = document.createElement('button');
    b.className = 'sp-tile';
    b.title = url;
    const chip = document.createElement('span');
    chip.className = 'sp-tile-chip';
    let hue = 0;
    for (const c of String(url)) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    chip.style.backgroundColor = 'hsl(' + hue + ' 55% 92%)';
    chip.style.color = 'hsl(' + hue + ' 42% 40%)';
    chip.textContent = (String(title).trim().charAt(0) || '·').toUpperCase();
    const name = document.createElement('span');
    name.className = 'sp-tile-name';
    name.textContent = title;
    b.append(chip, name);
    b.onclick = onClick;
    return b;
  }
  const goWeb = (input) => { if (window.__webOpenInput) window.__webOpenInput(input); };
  let bmCache = { folders: [], bookmarks: [] };
  let histCache = [];
  function renderRail() {
    const tilesWrap = $('sp-tiles-wrap');
    const tilesEl = $('sp-tiles');
    tilesEl.textContent = '';
    const bar = (bmCache.bookmarks || []).filter((b) => b.folderId === BM_BAR).slice(0, 6);
    for (const b of bar) tilesEl.appendChild(tile(b.title || b.url, b.url, () => goWeb(b.url)));
    tilesWrap.hidden = bar.length === 0;

    const mvWrap = $('sp-mv-wrap');
    const mvEl = $('sp-mv');
    mvEl.textContent = '';
    const bmUrls = new Set(bar.map((b) => b.url));
    const byUrl = new Map();
    for (const h of histCache) {
      if (!/^https?:/i.test(h.url) || bmUrls.has(h.url)) continue;
      const cur = byUrl.get(h.url);
      if (cur) cur.n++;
      else byUrl.set(h.url, { url: h.url, title: h.title || h.url, n: 1 });
    }
    const mv = [...byUrl.values()].sort((a, b) => b.n - a.n).slice(0, 4);
    for (const m of mv) mvEl.appendChild(tile(m.title, m.url, () => goWeb(m.url)));
    mvWrap.hidden = mv.length === 0;
  }
  async function loadRail() {
    try { bmCache = (await window.ws2.bmState()) || bmCache; } catch { /* 主进程未就绪,保持空 */ }
    try { histCache = (await window.ws2.histState()) || histCache; } catch { /* 同上 */ }
    renderRail();
  }

  // ---- 统一 omnibox:打字滤最近文件;URL/搜索词回车 → 浏览器管道 ----
  const input = $('sp-omni-input');
  const sug = $('sp-sug');
  let sel = 0;
  let hits = [];
  function renderSug() {
    sug.textContent = '';
    const q = input.value.trim();
    if (!q) { sug.hidden = true; return; }
    hits = urlish(q) ? [] : recentsCache.filter((r) => baseName(r.path).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    hits.forEach((r, i) => {
      const item = document.createElement('button');
      item.className = 'sp-sug-item' + (i === sel ? ' is-sel' : '');
      const ico = document.createElement('span');
      ico.className = 'sp-fico';
      const name = document.createElement('span');
      name.className = 'sp-sug-name';
      name.textContent = baseName(r.path).replace(/\.(html?|md)$/i, '');
      const meta = document.createElement('span');
      meta.className = 'sp-sug-meta';
      meta.textContent = folderLabel(r.path);
      item.append(ico, name, meta);
      item.onmousedown = (e) => { e.preventDefault(); closeSug(); openDoc(r.path); };
      item.onmouseenter = () => { sel = i; renderSug(); };
      sug.appendChild(item);
    });
    const web = document.createElement('button');
    web.className = 'sp-sug-item sp-sug-web';
    web.textContent = wsT('start.searchWebFor', { q });
    web.onmousedown = (e) => { e.preventDefault(); closeSug(); goWeb(q); };
    sug.appendChild(web);
    sug.hidden = false;
  }
  function closeSug() { sug.hidden = true; input.value = ''; sel = 0; hits = []; }
  function submit() {
    const q = input.value.trim();
    if (!q) return;
    const pick = hits[sel] || hits[0];
    closeSug();
    if (pick && !urlish(q)) openDoc(pick.path);
    else goWeb(q);
  }
  if (input) {
    input.addEventListener('input', () => { sel = 0; renderSug(); });
    input.addEventListener('blur', () => { sug.hidden = true; });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // IME 守卫(照 browser.js omnibox 惯例)
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') closeSug();
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, Math.max(hits.length - 1, 0)); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderSug(); }
    });
  }

  // ---- 开始动作:新建文档 → 侧栏的新建标签页 modal(⌘T 同门);打开文档/文件夹 = shell/sidebar 既有接线 ----
  const newBtn = $('home-new');
  if (newBtn) newBtn.onclick = () => { if (window.__sbHooks && window.__sbHooks.newTab) window.__sbHooks.newTab(); };

  // ---- 装配:shell.js 的 renderRecents 委托到这;书签/历史变更推送跟着刷 ----
  window.__startPage = { refresh: renderFlow };
  if (window.ws2 && window.ws2.onBookmarksChanged) window.ws2.onBookmarksChanged((s) => { if (s) { bmCache = s; renderRail(); } });
  if (window.ws2 && window.ws2.onHistoryChanged) window.ws2.onHistoryChanged((s) => { if (Array.isArray(s)) { histCache = s; renderRail(); } });
  renderGreeting();
  renderFlow();
  loadRail();
})();
