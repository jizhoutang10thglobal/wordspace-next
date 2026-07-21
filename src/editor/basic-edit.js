// 非合规 HTML 的「基础编辑器」（Feature 3）。见 docs/plans/2026-07-01-002-...-plan.md +
// origin ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
//
// 跑在父层、操作 doc-frame 的 contentDocument（iframe sandbox 不跑文档 JS）。能力：
//   A 富就地文字（B/I/U/S + 文字色/高亮/清除）· 删除全走 contenteditable 原生「选中 + Delete」。
// 编辑器 chrome（格式条）走**宿主浮层**（append 到 document.body、position:fixed、视口坐标），绝不注进
// iframe DOM（KD-b）。唯一注进 iframe 的是编辑态：body.contentEditable + cursor —— cursor 走
// adoptedStyleSheets（不写 body.style、不进序列化），contentEditable 由序列化前的剥除契约摘掉。
// 保存不走 block 编辑器的 Schema 规整；结构级保真（KD-c）。色/高亮用 CSSOM span（WS2Format.wrapInlineStyle）
// 非 execCommand foreColor（KD-g）。
// 无删除 chrome：曾有 Esc 块模式 + 右上「删除此块」chip，因按钮不可靠/不可发现整体撤除（Colin 2026-07-21）。
// collectBlocks/nearestInDir 仍导出（纯函数 + 单测），当前 attach 不再内部使用。
(function (global) {
  const fmt = (typeof WS2Format !== 'undefined') ? WS2Format
    : (typeof require !== 'undefined' ? require('./format.js') : null);
  // i18n：renderer 全局 t()（node/test 上下文无 wsT 时回退 key，防 require 期崩）。
  const T = (k, p) => (global.wsT ? global.wsT(k, p) : k);

  const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff'];
  const CE_MARK = 'data-ws2-basic-ce';

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
    // 修 ED-B4：<html> 之外的注释（浏览器「另存网页」的 <!-- saved from url... --> 是基础编辑的典型输入）
    // 也要保真——原来只拼 documentElement.outerHTML 会把顶层注释全丢，违反基础编辑「结构保真」契约（KD-c）。
    // 逐个序列化文档顶层节点，对齐 WS2Serialize.serializeDocument。
    const parts = [];
    for (const node of doc.childNodes) {
      if (node.nodeType === 10) parts.push(doctypeStr);
      else if (node.nodeType === 8) parts.push('<!--' + node.data + '-->');
      else if (node === doc.documentElement) parts.push(root.outerHTML);
    }
    return parts.join('\n');
  }

  // ---- 宿主浮层小工具 ----
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
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
    const colorBtn = btn(T('editor.textColor'), 'A', () => { const open = menu !== 'color'; closeMenu(); if (open) { menu = 'color'; colorSw.hidden = false; } });
    colorBtn.classList.add('ws-fmtbar-aglyph');
    const colorSw = swatchRow(TEXT_COLORS, 'color'); colorHolder.append(colorBtn, colorSw);
    const hiliteHolder = el('div', 'ws-fmtbar-holder');
    const hiliteBtn = btn(T('editor.highlightBg'), '🖍', () => { const open = menu !== 'hilite'; closeMenu(); if (open) { menu = 'hilite'; hiliteSw.hidden = false; } });
    const hiliteSw = swatchRow(HILITE_COLORS, 'background-color'); hiliteHolder.append(hiliteBtn, hiliteSw);
    bar.append(
      btn(T('editor.bold'), SVG.bold, () => doExec('bold')), btn(T('editor.italic'), SVG.italic, () => doExec('italic')),
      btn(T('editor.underline'), SVG.underline, () => doExec('underline')), btn(T('editor.strike'), SVG.strike, () => doExec('strikeThrough')),
      el('span', 'ws-fmtbar-sep'), colorHolder, hiliteHolder,
      el('span', 'ws-fmtbar-sep'), btn(T('editor.clearFormat'), SVG.eraser, () => doExec('removeFormat')),
    );
    document.body.appendChild(bar);

    function refreshBubble() {
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

    // ==== B：删块 ====
    // 无任何删除 chrome（Colin 2026-07-21 拍板）：不出「删除此块」按钮、不设 Esc 块模式。删除整段/整块
    // 一律走 contenteditable 原生「选中内容 + Delete/Backspace」——编辑器保持「安静的纸」，零浮层。
    // （历史：曾有 Esc 块模式 + 右上「删除此块」chip；因按钮不可靠 / 不可发现，整体撤除。见 docs/features/basic-edit.md）

    // ==== 事件 ====
    // 删除全走原生（选中 + Delete），故只留：格式条跟随选区 + dirty 标记 + 滚动重定位格式条。
    const onSelChange = () => refreshBubble();
    const onInput = () => markDirty();
    const onScroll = () => refreshBubble();

    doc.addEventListener('selectionchange', onSelChange);
    doc.addEventListener('mouseup', onSelChange);
    doc.addEventListener('keyup', onSelChange);
    doc.addEventListener('input', onInput);
    doc.addEventListener('scroll', onScroll, true);

    return {
      detach() {
        doc.removeEventListener('selectionchange', onSelChange);
        doc.removeEventListener('mouseup', onSelChange);
        doc.removeEventListener('keyup', onSelChange);
        doc.removeEventListener('input', onInput);
        doc.removeEventListener('scroll', onScroll, true);
        bar.remove();
        try { body.removeAttribute('contenteditable'); body.removeAttribute(CE_MARK); } catch (e) {}
      },
      reposition() { if (barShown) refreshBubble(); },
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
