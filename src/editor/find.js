/* src/editor/find.js —— 文档内查找（Cmd+F）。
 *
 * 调研裁决：Cmd+F 是所有软件的铁律 = 在当前文档里找字；文件筛选让位到 Cmd+Shift+F。
 * 架构（照 shell.js/basic-edit.js 的既有套路，实测 spike 过）：
 *   · 查找条 UI 在**父层** document.body（position:fixed，钉在 doc-frame 右上角）——
 *     因为文档正文渲染在 sandbox iframe 里，父层浮层套路见 basic-edit.js。
 *   · 匹配高亮用 **CSS Custom Highlight API**：range 建在 iframe 的 contentDocument、
 *     highlight 设在 iframe 的 window、`::highlight` 规则用 **constructable stylesheet**
 *     注进 iframe 的 adoptedStyleSheets（照 applyZoom shell.js:114-126；inline <style>
 *     会被 style-src CSP 拦，constructable 不会——已在真 Electron 实测）。
 *   · 纯视觉覆盖：不改 DOM、不动文档模型 → 撤销/存盘/脏标记都不受影响。
 * 匹配 range 的建立是纯逻辑，抽在 src/lib/find-ranges.js（jsdom 单测），这里只管「画 + 交互」。
 */
(function () {
  'use strict';

  var HL = 'ws-find';
  var HL_CUR = 'ws-find-cur';
  // ::highlight 规则注进 iframe（constructable stylesheet，CSP 安全）。当前匹配用琥珀、其余淡黄。
  var HL_CSS =
    '::highlight(' + HL + '){background-color:#fef08a;color:#1c1917;}' +
    '::highlight(' + HL_CUR + '){background-color:#f59e0b;color:#1c1917;}';

  var SVG_UP = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
  var SVG_DOWN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  var SVG_X = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  var frame = null; // 当前目标 doc-frame（<iframe id="doc-frame">）
  var bar = null, inputEl = null, countEl = null, prevBtn = null, nextBtn = null;
  var matches = []; // Range[]（活在 iframe 文档里）
  var active = 0;
  var findSheet = null; // 注进 iframe 的 constructable stylesheet
  var isOpen = false;

  function cw() { try { return frame && frame.contentWindow; } catch (e) { return null; } }
  function cd() { try { return frame && frame.contentDocument; } catch (e) { return null; } }
  function hlApi() { var w = cw(); return w && w.CSS && w.CSS.highlights ? w.CSS.highlights : null; }
  function HLCtor() { var w = cw(); return w && w.Highlight ? w.Highlight : null; }

  function mkBtn(title, svg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-docfind-btn';
    b.title = title;
    b.innerHTML = svg;
    return b;
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'ws-docfind';
    bar.setAttribute('role', 'search');
    bar.hidden = true;

    inputEl = document.createElement('input');
    inputEl.className = 'ws-docfind-input';
    inputEl.type = 'text';
    inputEl.placeholder = window.wsT('find.findInDoc');
    inputEl.spellcheck = false;
    inputEl.setAttribute('aria-label', window.wsT('find.findInDoc'));

    countEl = document.createElement('span');
    countEl.className = 'ws-docfind-count';
    countEl.setAttribute('aria-live', 'polite');

    var nav = document.createElement('div');
    nav.className = 'ws-docfind-nav';
    prevBtn = mkBtn(window.wsT('find.prevTitle'), SVG_UP);
    nextBtn = mkBtn(window.wsT('find.nextTitle'), SVG_DOWN);
    prevBtn.setAttribute('aria-label', window.wsT('find.prevMatch'));
    nextBtn.setAttribute('aria-label', window.wsT('find.nextMatch'));
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);

    var closeBtn = mkBtn(window.wsT('find.closeTitle'), SVG_X);
    closeBtn.className += ' ws-docfind-close';
    closeBtn.setAttribute('aria-label', window.wsT('find.closeFind'));

    bar.appendChild(inputEl);
    bar.appendChild(countEl);
    bar.appendChild(nav);
    bar.appendChild(closeBtn);
    document.body.appendChild(bar);

    inputEl.addEventListener('input', recompute);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); returnFocusToDoc(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    });
    prevBtn.addEventListener('click', function () { go(-1); inputEl.focus(); });
    nextBtn.addEventListener('click', function () { go(1); inputEl.focus(); });
    closeBtn.addEventListener('click', function () { close(); returnFocusToDoc(); });
  }

  // 把 ::highlight 规则注进 iframe（不存在就建；照 applyZoom：push 到 adoptedStyleSheets 末尾，不被盖）。
  function ensureSheet() {
    var w = cw(), d = cd();
    if (!w || !d) return;
    try {
      if (!findSheet || d.adoptedStyleSheets.indexOf(findSheet) < 0) {
        var SheetCtor = w.CSSStyleSheet || CSSStyleSheet;
        findSheet = new SheetCtor();
        findSheet.replaceSync(HL_CSS);
        d.adoptedStyleSheets = [].concat(d.adoptedStyleSheets, findSheet);
      }
    } catch (e) { /* 老 Chromium 无 constructable stylesheet：高亮画不出，查找仍能定位滚动 */ }
  }

  function clearHighlights() {
    var api = hlApi();
    if (!api) return;
    try { api.delete(HL); api.delete(HL_CUR); } catch (e) {}
  }

  // 建一个含指定 range 的 Highlight。用 .add() 逐个加（Highlight 是 Set-like）——
  // 不用 `new Highlight(...ranges)` 变参展开：匹配数极大（>数万）时变参会撞引擎实参上限
  // 抛 RangeError，导致「全部匹配」层静默不渲染而计数仍显示总数。逐个 add 无此上限。
  function makeHighlight(Ctor, ranges) {
    var h = new Ctor();
    for (var i = 0; i < ranges.length; i++) { try { h.add(ranges[i]); } catch (e) {} }
    return h;
  }

  function applyHighlights() {
    var api = hlApi(), Ctor = HLCtor();
    if (!api || !Ctor) return;
    if (!matches.length) { clearHighlights(); return; }
    ensureSheet();
    try {
      api.set(HL, makeHighlight(Ctor, matches)); // 全部匹配一层
      api.set(HL_CUR, makeHighlight(Ctor, [matches[active]])); // 当前匹配另一层
    } catch (e) {}
    scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    var r = matches[active];
    if (!r) return;
    var el = r.startContainer && r.startContainer.parentElement;
    // U12（R11）：命中落在折叠的 toggle 里 → 先展开所有折叠的 <details> 祖先，否则高亮落在 display:none 的隐藏节点、
    // 滚动到 0 高看不见（Chromium 原生 find 同款自动展开）。设 open 触发 toggle 事件→markDirty（编辑器已监听）。
    var anc = el;
    while (anc && anc !== (cd() && cd().body)) {
      // __wsFindReveal 标记：查找触发的展开是「只读揭示」，onToggle 见此跳过 markDirty → 纯搜索绝不把折叠态改写进磁盘（P2）。
      if (anc.tagName === 'DETAILS' && !anc.open) { anc.__wsFindReveal = true; anc.open = true; }
      anc = anc.parentElement;
    }
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    }
  }

  function recompute() {
    var body = cd() && cd().body;
    var q = inputEl ? inputEl.value : '';
    matches = body && window.WS2FindRanges ? window.WS2FindRanges.buildMatchRanges(body, q) : [];
    active = 0;
    applyHighlights();
    updateCount();
  }

  function updateCount() {
    if (!countEl) return;
    var q = inputEl ? inputEl.value : '';
    if (!q) countEl.textContent = '';
    else if (!matches.length) countEl.textContent = window.wsT('find.noResults');
    else countEl.textContent = (active + 1) + ' / ' + matches.length;
    if (prevBtn) prevBtn.disabled = !matches.length;
    if (nextBtn) nextBtn.disabled = !matches.length;
  }

  function go(dir) {
    if (!matches.length) return;
    var n = matches.length;
    active = (((active + dir) % n) + n) % n;
    var api = hlApi(), Ctor = HLCtor();
    if (api && Ctor) { try { api.set(HL_CUR, makeHighlight(Ctor, [matches[active]])); } catch (e) {} }
    scrollActiveIntoView();
    updateCount();
  }

  function reposition() {
    if (!bar || !frame) return;
    var fr = frame.getBoundingClientRect();
    var w = bar.offsetWidth || 300;
    var RIGHT_RESERVE = 84; // 让开右上角 ⋯ 菜单（--top-actions-reserve 72 + 余量）
    var left = fr.right - w - RIGHT_RESERVE;
    if (left < fr.left + 8) left = fr.left + 8;
    bar.style.top = fr.top + 10 + 'px';
    bar.style.left = left + 'px';
  }

  function returnFocusToDoc() {
    var w = cw();
    if (w) { try { w.focus(); } catch (e) {} }
  }

  // 打开查找条，目标是 targetFrame（doc-frame）。已开则聚焦并全选输入框（Cmd+F 再按一次的常见行为）。
  function open(targetFrame) {
    frame = targetFrame || document.getElementById('doc-frame');
    if (!frame) return;
    if (!bar) buildBar();
    // 不清 findSheet：ensureSheet 的 indexOf 守卫已正确处理两种情形——同文档重开时旧表仍在
    // adoptedStyleSheets 里（indexOf≥0，不重复注，避免泄漏累积）；换文档后新 iframe 数组不含旧表
    // （indexOf<0，重建）。此处再置 null 会让同文档每次 Cmd+F 都追加一张、旧表从不移除。
    isOpen = true;
    bar.hidden = false;
    reposition();
    recompute(); // 若输入框已有词，重算高亮
    inputEl.focus();
    inputEl.select();
  }

  function close() {
    clearHighlights();
    matches = [];
    active = 0;
    if (bar) bar.hidden = true;
    isOpen = false;
  }

  window.WS2Find = {
    open: open,
    close: close,
    reposition: function () { if (isOpen) reposition(); },
    isOpen: function () { return isOpen; },
  };
})();
