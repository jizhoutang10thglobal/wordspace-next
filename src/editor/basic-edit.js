// 非合规 HTML 的「基础编辑器」（Feature 3）。见 docs/plans/2026-07-01-002-...-plan.md +
// origin ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
//
// 跑在父层、操作 doc-frame 的 contentDocument（iframe sandbox 不跑文档 JS）。三能力：
//   A 富就地文字（B/I/U/S + 文字色/高亮/清除）· B 删整块 · C 空间切块（方向键按渲染几何）。
// 编辑器 chrome（格式条/焦点框/悬停删除/🔒）全走**宿主浮层**（append 到 document.body、position:fixed、
// 视口坐标），绝不注进 iframe DOM（KD-b）。唯一注进 iframe 的是编辑态：body.contentEditable + cursor
// —— cursor 走 adoptedStyleSheets（不写 body.style、不进序列化），contentEditable 由序列化前的剥除契约摘掉。
// 保存不走 block 编辑器的 Schema 规整；结构级保真（KD-c）。色/高亮用 CSSOM span（WS2Format.wrapInlineStyle）
// 非 execCommand foreColor（KD-g：避 <font>）。
(function (global) {
  const fmt = (typeof WS2Format !== 'undefined') ? WS2Format
    : (typeof require !== 'undefined' ? require('./format.js') : null);

  // 跟正规编辑器同一套调色板（blockedit TEXT_COLORS/HILITE）。
  const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff'];

  const CE_MARK = 'data-ws2-basic-ce'; // 编辑态锚点：cursor 样式表选它、序列化剥它

  function injectEditSheet(doc) {
    try {
      const CSS = doc.defaultView && doc.defaultView.CSSStyleSheet;
      if (!CSS) return;
      const sheet = new CSS();
      sheet.replaceSync('[' + CE_MARK + ']{cursor:text;outline:none}');
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet];
    } catch (e) { /* cursor 是装饰，失败无害 */ }
  }

  // ---- 序列化剥除契约（KD-d，纯函数，jsdom 可单测）----
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
    try { doc.execCommand('styleWithCSS', false, false); } catch (e) {} // 语义标签优先（<b>/<i>），色走 CSSOM span
    injectEditSheet(doc);

    // 找 iframe 元素（把 iframe 内选区矩形换算成宿主视口坐标）。
    const frameEl = win.frameElement || document.getElementById('doc-frame');
    const frameRect = () => (frameEl ? frameEl.getBoundingClientRect() : { top: 0, left: 0 });

    // ---- 富文字格式条（宿主浮层，append 到 document.body、position:fixed）----
    const bar = el('div', 'ws-fmtbar nce-bubble');
    bar.setAttribute('role', 'toolbar');
    bar.hidden = true;
    bar.addEventListener('mousedown', (e) => e.preventDefault()); // 别让点按钮塌掉选区
    let menu = null; // 当前展开的 swatch：'color' | 'hilite' | null

    const doExec = (cmd) => { try { doc.execCommand(cmd, false); } catch (e) {} markDirty(); closeMenu(); refreshBubble(); };
    const doColor = (prop, hex) => { if (fmt && fmt.wrapInlineStyle(doc, prop, hex)) markDirty(); closeMenu(); refreshBubble(); };
    const closeMenu = () => { menu = null; colorSw.hidden = true; hiliteSw.hidden = true; };

    const btn = (title, html, on) => {
      const b = el('button', 'ws-fmtbar-btn', html);
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', on);
      return b;
    };
    const swatchRow = (colors, prop) => {
      const row = el('div', 'ws-fmtbar-swatches');
      row.hidden = true;
      row.addEventListener('mousedown', (e) => e.preventDefault());
      colors.forEach((c) => {
        const s = el('button', 'ws-fmtbar-swatch');
        s.style.background = c; s.title = c;
        s.addEventListener('mousedown', (e) => e.preventDefault());
        s.addEventListener('click', () => doColor(prop, c));
        row.appendChild(s);
      });
      return row;
    };

    const colorHolder = el('div', 'ws-fmtbar-holder');
    const colorBtn = btn('文字颜色', 'A', () => { const open = menu !== 'color'; closeMenu(); if (open) { menu = 'color'; colorSw.hidden = false; } });
    colorBtn.classList.add('ws-fmtbar-aglyph');
    const colorSw = swatchRow(TEXT_COLORS, 'color');
    colorHolder.append(colorBtn, colorSw);

    const hiliteHolder = el('div', 'ws-fmtbar-holder');
    const hiliteBtn = btn('背景高亮', '🖍', () => { const open = menu !== 'hilite'; closeMenu(); if (open) { menu = 'hilite'; hiliteSw.hidden = false; } });
    const hiliteSw = swatchRow(HILITE_COLORS, 'background-color');
    hiliteHolder.append(hiliteBtn, hiliteSw);

    bar.append(
      btn('加粗', SVG.bold, () => doExec('bold')),
      btn('斜体', SVG.italic, () => doExec('italic')),
      btn('下划线', SVG.underline, () => doExec('underline')),
      btn('删除线', SVG.strike, () => doExec('strikeThrough')),
      el('span', 'ws-fmtbar-sep'),
      colorHolder, hiliteHolder,
      el('span', 'ws-fmtbar-sep'),
      btn('清除格式', SVG.eraser, () => doExec('removeFormat')),
    );
    document.body.appendChild(bar);

    // ---- 选区 → 格式条定位 ----
    let barShown = false;
    function refreshBubble() {
      const sel = doc.getSelection && doc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideBar(); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) { hideBar(); return; }
      const fr = frameRect();
      bar.hidden = false; barShown = true;
      bar.style.top = Math.max(6, fr.top + r.top - bar.offsetHeight - 8) + 'px';
      bar.style.left = Math.max(6, fr.left + r.left + r.width / 2 - bar.offsetWidth / 2) + 'px';
    }
    function hideBar() { if (barShown) { bar.hidden = true; barShown = false; } closeMenu(); }

    const onSelChange = () => refreshBubble();
    const onInput = () => markDirty();
    doc.addEventListener('selectionchange', onSelChange);
    doc.addEventListener('mouseup', onSelChange);
    doc.addEventListener('keyup', onSelChange);
    doc.addEventListener('input', onInput);
    doc.addEventListener('scroll', refreshBubble, true);

    return {
      detach() {
        doc.removeEventListener('selectionchange', onSelChange);
        doc.removeEventListener('mouseup', onSelChange);
        doc.removeEventListener('keyup', onSelChange);
        doc.removeEventListener('input', onInput);
        doc.removeEventListener('scroll', refreshBubble, true);
        bar.remove();
        try { body.removeAttribute('contenteditable'); body.removeAttribute(CE_MARK); } catch (e) {}
      },
      reposition() { if (barShown) refreshBubble(); },
      serialize() { return serialize(doc); },
    };
  }

  const api = { attach, serialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BasicEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
