// 非合规 HTML 的「基础编辑器」（Feature 3）。见 docs/plans/2026-07-01-002-...-plan.md +
// origin ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
//
// 跑在父层、操作 doc-frame 的 contentDocument（iframe sandbox 不跑文档 JS）。三能力：
//   A 富就地文字（B/I/U/S + 文字色/高亮/清除）· B 删整块 · C 空间切块（方向键按渲染几何）。
// 编辑器 chrome（格式条/焦点框/悬停删除/🔒）全走**宿主浮层**（append 到 document.body、position:fixed、
// 视口坐标），绝不注进 iframe DOM（KD-b）。唯一注进 iframe 的是编辑态：body.contentEditable + cursor
// —— cursor 走 adoptedStyleSheets（不写 body.style、不进序列化），contentEditable 由序列化前的剥除契约摘掉。
// 保存不走 block 编辑器的 Schema 规整；结构级保真（KD-c）。色/高亮用 CSSOM span（WS2Format.wrapInlineStyle）
// 非 execCommand foreColor（KD-g）。导航/定位用渲染几何（nearestInDir），编辑/删除用节点身份。
(function (global) {
  const fmt = (typeof WS2Format !== 'undefined') ? WS2Format
    : (typeof require !== 'undefined' ? require('./format.js') : null);

  const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff'];
  const CE_MARK = 'data-ws2-basic-ce';
  const READONLY_TAGS = new Set(['IMG', 'HR', 'IFRAME', 'SVG', 'VIDEO', 'AUDIO', 'EMBED', 'OBJECT', 'CANVAS']);
  const isReadOnly = (el) => !!el && READONLY_TAGS.has(el.tagName);

  // ---- 纯逻辑（导出可 jsdom 单测）----
  // 块收集：img/hr/iframe/table/ul/ol/svg 当原子块 + 「有直接文字且父无直接文字」的元素当叶子文字块。
  function collectBlocks(body) {
    const blocks = [];
    const skip = new Set();
    body.querySelectorAll('img,hr,iframe,table,ul,ol,svg').forEach((el) => {
      blocks.push(el);
      el.querySelectorAll('*').forEach((d) => skip.add(d));
    });
    const hasDirectText = (el) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length);
    body.querySelectorAll('*').forEach((el) => {
      if (skip.has(el)) return;
      if (el.closest('table,ul,ol,svg')) return;
      if (['SCRIPT', 'STYLE', 'BR', 'HEAD'].includes(el.tagName)) return;
      if (!hasDirectText(el)) return;
      if (el.parentElement && hasDirectText(el.parentElement) && !skip.has(el.parentElement)) return;
      blocks.push(el);
    });
    return blocks;
  }

  // 空间导航：按渲染几何找方向上最近的块（primary 方向距离 + cross 侧偏*2 惩罚）。getRect 可注入（单测）。
  function nearestInDir(cur, dir, all, getRect) {
    getRect = getRect || ((e) => e.getBoundingClientRect());
    const cr = getRect(cur);
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const r = getRect(el);
      if (!r.width && !r.height) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let inDir, primary, cross;
      if (dir === 'down') { inDir = dy > 6; primary = dy; cross = Math.abs(dx); }
      else if (dir === 'up') { inDir = dy < -6; primary = -dy; cross = Math.abs(dx); }
      else if (dir === 'right') { inDir = dx > 6; primary = dx; cross = Math.abs(dy); }
      else { inDir = dx < -6; primary = -dx; cross = Math.abs(dy); }
      if (!inDir) continue;
      const score = primary + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  // ---- 序列化剥除契约（KD-d，纯函数，jsdom 可单测，U4 强化测试）----
  const STRIP_ATTRS = ['contenteditable', CE_MARK, 'spellcheck'];
  function serialize(doc) {
    const root = doc.documentElement.cloneNode(true);
    const body = root.querySelector('body') || root;
    STRIP_ATTRS.forEach((a) => body.removeAttribute(a));
    const dt = doc.doctype;
    const doctypeStr = dt ? '<!DOCTYPE ' + dt.name
      + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '')
      + (dt.systemId ? (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"' : '') + '>' : '';
    return doctypeStr + (doctypeStr ? '\n' : '') + root.outerHTML;
  }

  // ---- 宿主浮层小工具 ----
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  const TRASH = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
  const SVG = {
    bold: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h7a4 4 0 0 1 0 8H6zM6 12h8a4 4 0 0 1 0 8H6z"/></svg>',
    italic: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 4h-9M14 20H5M15 4L9 20"/></svg>',
    underline: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/></svg>',
    strike: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/></svg>',
    eraser: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10M5 13l6-6 8 8-6 6H8z"/></svg>',
  };

  function attach(doc, opts) {
    opts = opts || {};
    const win = opts.win || doc.defaultView;
    const markDirty = opts.markDirty || function () {};
    const body = doc.body;
    if (!body) return { detach() {}, reposition() {}, serialize: () => serialize(doc) };

    body.contentEditable = 'true';
    body.setAttribute(CE_MARK, '');
    try { doc.execCommand('styleWithCSS', false, false); } catch (e) {}
    injectEditSheet(doc);

    const frameEl = win.frameElement || document.getElementById('doc-frame');
    const frameRect = () => (frameEl ? frameEl.getBoundingClientRect() : { top: 0, left: 0 });
    // iframe 内元素 rect → 宿主视口坐标（focus/hover 浮层在 document.body、position:fixed）
    const toHost = (r) => { const fr = frameRect(); return { top: fr.top + r.top, left: fr.left + r.left, width: r.width, height: r.height }; };

    let mode = 'text';          // 'text' 点字改 | 'block' 方向键切块
    let blocks = collectBlocks(body);
    let focusEl = null;
    let hoverEl = null;

    // ==== A：富文字格式条 ====
    const bar = el('div', 'ws-fmtbar nce-bubble');
    bar.setAttribute('role', 'toolbar'); bar.hidden = true;
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    let menu = null; let barShown = false;
    const closeMenu = () => { menu = null; colorSw.hidden = true; hiliteSw.hidden = true; };
    const doExec = (cmd) => { try { doc.execCommand(cmd, false); } catch (e) {} markDirty(); closeMenu(); refreshBubble(); };
    const doColor = (prop, hex) => { if (fmt && fmt.wrapInlineStyle(doc, prop, hex)) markDirty(); closeMenu(); refreshBubble(); };
    const btn = (title, html, on) => { const b = el('button', 'ws-fmtbar-btn', html); b.title = title; b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', on); return b; };
    const swatchRow = (colors, prop) => {
      const row = el('div', 'ws-fmtbar-swatches'); row.hidden = true;
      row.addEventListener('mousedown', (e) => e.preventDefault());
      colors.forEach((c) => { const s = el('button', 'ws-fmtbar-swatch'); s.style.background = c; s.title = c; s.addEventListener('mousedown', (e) => e.preventDefault()); s.addEventListener('click', () => doColor(prop, c)); row.appendChild(s); });
      return row;
    };
    const colorHolder = el('div', 'ws-fmtbar-holder');
    const colorBtn = btn('文字颜色', 'A', () => { const open = menu !== 'color'; closeMenu(); if (open) { menu = 'color'; colorSw.hidden = false; } });
    colorBtn.classList.add('ws-fmtbar-aglyph');
    const colorSw = swatchRow(TEXT_COLORS, 'color'); colorHolder.append(colorBtn, colorSw);
    const hiliteHolder = el('div', 'ws-fmtbar-holder');
    const hiliteBtn = btn('背景高亮', '🖍', () => { const open = menu !== 'hilite'; closeMenu(); if (open) { menu = 'hilite'; hiliteSw.hidden = false; } });
    const hiliteSw = swatchRow(HILITE_COLORS, 'background-color'); hiliteHolder.append(hiliteBtn, hiliteSw);
    bar.append(
      btn('加粗', SVG.bold, () => doExec('bold')), btn('斜体', SVG.italic, () => doExec('italic')),
      btn('下划线', SVG.underline, () => doExec('underline')), btn('删除线', SVG.strike, () => doExec('strikeThrough')),
      el('span', 'ws-fmtbar-sep'), colorHolder, hiliteHolder,
      el('span', 'ws-fmtbar-sep'), btn('清除格式', SVG.eraser, () => doExec('removeFormat')),
    );
    document.body.appendChild(bar);

    function refreshBubble() {
      if (mode !== 'text') { hideBar(); return; }
      const sel = doc.getSelection && doc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideBar(); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) { hideBar(); return; }
      const h = toHost(r);
      bar.hidden = false; barShown = true;
      bar.style.top = Math.max(6, h.top - bar.offsetHeight - 8) + 'px';
      bar.style.left = Math.max(6, h.left + h.width / 2 - bar.offsetWidth / 2) + 'px';
    }
    function hideBar() { if (barShown) { bar.hidden = true; barShown = false; } closeMenu(); }

    // ==== B/C：焦点框 + 悬停删除（宿主浮层）====
    const focusBox = el('div', 'nce-focus'); focusBox.hidden = true;
    const focusDel = el('button', 'nce-focus-del', TRASH + '<span>删除此块</span>');
    focusDel.title = '删除此块 (Delete)';
    focusDel.addEventListener('mousedown', (e) => e.preventDefault());
    focusDel.addEventListener('click', () => { if (focusEl) removeBlock(focusEl, true); });
    focusBox.appendChild(focusDel);
    document.body.appendChild(focusBox);

    const hoverBox = el('div', 'nce-hover'); hoverBox.hidden = true;
    const hoverDel = el('button', 'nce-hover-del', TRASH); hoverDel.title = '删除这一块';
    hoverDel.addEventListener('mousedown', (e) => e.preventDefault());
    hoverDel.addEventListener('click', () => { if (hoverEl) removeBlock(hoverEl, false); });
    const hoverLock = el('span', 'nce-lock', '🔒'); hoverLock.title = '只读（不是可编辑文字）';
    hoverBox.append(hoverDel, hoverLock);
    document.body.appendChild(hoverBox);

    let hoverTimer = 0;
    function placeBox(box, elm) { const h = toHost(elm.getBoundingClientRect()); box.style.top = h.top + 'px'; box.style.left = h.left + 'px'; box.style.width = h.width + 'px'; box.style.height = h.height + 'px'; }
    function setFocus(elm) {
      focusEl = elm || null;
      if (!focusEl) { focusBox.hidden = true; return; }
      try { focusEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      placeBox(focusBox, focusEl); focusBox.hidden = false;
    }
    function clearFocus() { focusEl = null; focusBox.hidden = true; }
    function showHover(elm) {
      hoverEl = elm; placeBox(hoverBox, elm);
      hoverLock.style.display = isReadOnly(elm) ? '' : 'none';
      hoverBox.hidden = false;
    }
    function clearHover() { hoverEl = null; hoverBox.hidden = true; }

    function blockAt(target) {
      if (!target || target.nodeType !== 1 && !target.parentElement) return null;
      const t = target.nodeType === 1 ? target : target.parentElement;
      const hits = blocks.filter((b) => b === t || b.contains(t));
      if (!hits.length) return null;
      // 命中多个（嵌套）→ 取面积最小的（最贴近光标的那层）
      return hits.reduce((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (ra.width * ra.height <= rb.width * rb.height) ? a : b; });
    }

    function enterBlockMode(fromEl) {
      mode = 'block'; hideBar(); clearHover();
      try { body.contentEditable = 'false'; } catch (e) {}
      setFocus(fromEl || blocks[0] || null);
    }
    function enterTextMode() {
      mode = 'text'; clearFocus();
      try { body.contentEditable = 'true'; } catch (e) {}
    }
    function caretInto(elm) {
      enterTextMode();
      try { const rng = doc.createRange(); rng.selectNodeContents(elm); rng.collapse(true); const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(rng); } catch (e) {}
    }
    function removeBlock(elm, keepNext) {
      // 破坏性兜底（doc-review）：一块几乎是整篇 → 二次确认
      try {
        const br = elm.getBoundingClientRect(); const bb = body.getBoundingClientRect();
        const frac = (br.width * br.height) / Math.max(1, bb.width * bb.height);
        if (frac > 0.85 && win.confirm && !win.confirm('这一块几乎是整个文档，确定删除？')) return;
      } catch (e) {}
      const next = keepNext ? (nearestInDir(elm, 'down', blocks) || nearestInDir(elm, 'up', blocks)) : null;
      elm.remove();
      blocks = collectBlocks(body);
      clearHover(); markDirty();
      if (keepNext) setFocus(next && blocks.includes(next) ? next : blocks[0] || null);
      else if (focusEl === elm) clearFocus();
    }

    // ==== 事件 ====
    const onSelChange = () => refreshBubble();
    const onInput = () => markDirty();
    const onMouseDown = () => { if (mode === 'block') enterTextMode(); };
    const onMouseMove = (e) => {
      if (mode !== 'text') return;
      const blk = blockAt(e.target);
      if (!blk) { clearTimeout(hoverTimer); hoverTimer = setTimeout(clearHover, 160); return; }
      clearTimeout(hoverTimer);
      if (blk !== hoverEl) showHover(blk);
    };
    const onBodyLeave = () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(clearHover, 160); };
    const onScroll = () => { refreshBubble(); if (focusEl) placeBox(focusBox, focusEl); clearHover(); };
    const DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const a = doc.getSelection && doc.getSelection().anchorNode;
        const start = a ? (a.nodeType === 3 ? a.parentElement : a) : null;
        enterBlockMode(blocks.find((x) => start && x.contains(start)) || null);
        return;
      }
      if (mode !== 'block') return;
      if (DIR[e.key]) { e.preventDefault(); const n = focusEl ? nearestInDir(focusEl, DIR[e.key], blocks) : blocks[0]; if (n) setFocus(n); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (focusEl) removeBlock(focusEl, true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (focusEl && !isReadOnly(focusEl)) caretInto(focusEl); }
    };

    doc.addEventListener('selectionchange', onSelChange);
    doc.addEventListener('mouseup', onSelChange);
    doc.addEventListener('keyup', onSelChange);
    doc.addEventListener('input', onInput);
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('mousemove', onMouseMove, true);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('scroll', onScroll, true);
    body.addEventListener('mouseleave', onBodyLeave);

    return {
      detach() {
        doc.removeEventListener('selectionchange', onSelChange);
        doc.removeEventListener('mouseup', onSelChange);
        doc.removeEventListener('keyup', onSelChange);
        doc.removeEventListener('input', onInput);
        doc.removeEventListener('mousedown', onMouseDown, true);
        doc.removeEventListener('mousemove', onMouseMove, true);
        doc.removeEventListener('keydown', onKeyDown, true);
        doc.removeEventListener('scroll', onScroll, true);
        body.removeEventListener('mouseleave', onBodyLeave);
        bar.remove(); focusBox.remove(); hoverBox.remove();
        try { body.removeAttribute('contenteditable'); body.removeAttribute(CE_MARK); } catch (e) {}
      },
      reposition() { if (barShown) refreshBubble(); if (focusEl) placeBox(focusBox, focusEl); if (hoverEl) placeBox(hoverBox, hoverEl); },
      serialize() { return serialize(doc); },
    };
  }

  function injectEditSheet(doc) {
    try {
      const CSS = doc.defaultView && doc.defaultView.CSSStyleSheet;
      if (!CSS) return;
      const sheet = new CSS();
      sheet.replaceSync('[' + CE_MARK + ']{cursor:text;outline:none}');
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet];
    } catch (e) { /* cursor 是装饰，失败无害 */ }
  }

  const api = { attach, serialize, collectBlocks, nearestInDir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BasicEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
