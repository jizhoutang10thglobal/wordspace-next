(function (global) {
  // 按需浮出的富工具栏（Notion 气泡式），挂在父层 app chrome（不进 iframe 文档，对保真零风险）。
  // 自己不决定「何时显示 / 显示在哪」——那是 shell 的定位控制器（有 iframe 几何 + 选中/编辑态）干的；
  // 这里只负责：① 构建按钮 + 命令逻辑（跨帧 execCommand / WS2Format）② setMode 切「文字态 vs 元素态」
  // 露出对应分组。命令通过 ctx.doc / ctx.getSelectedEl 跨帧操作被编辑文档；ctx 由 shell setContext。
  const TURN = [
    { label: '正文', tag: 'p' },
    { label: '标题 1', tag: 'h1' },
    { label: '标题 2', tag: 'h2' },
    { label: '标题 3', tag: 'h3' },
    { label: '引用', tag: 'blockquote' }
  ];
  const FONTS = [
    { label: '默认字体', value: '' },
    { label: '无衬线', value: 'sans-serif' },
    { label: '衬线', value: 'serif' },
    { label: '等宽', value: 'monospace' },
    { label: '系统', value: '-apple-system, system-ui, sans-serif' }
  ];
  const SIZES = ['默认字号', '12', '14', '16', '18', '20', '24', '28', '32', '40'];
  const TEXT_COLORS = ['#1c1d1f', '#8a8f96', '#d93025', '#b06000', '#1e8e3e', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#fce8b6', '#fce8e6', '#e6f4ea', '#e8f0fe', '#f3e3ff'];
  const RADII = ['', '8px', '16px'];
  const OPACITIES = ['', '0.75', '0.5'];
  const BOX_SHADOW = '0 6px 18px rgba(0,0,0,0.18)';

  // lucide 式描边图标（16px），父层 chrome、不进文档故 innerHTML 注入安全。
  function svg(inner, size) {
    const s = size || 16;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  const ICON = {
    bold: svg('<path d="M14 12a4 4 0 0 0 0-8H6v8"/><path d="M15 20a4 4 0 0 0 0-8H6v8Z"/>'),
    italic: svg('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>'),
    underline: svg('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>'),
    strike: svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    alignL: svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>'),
    alignC: svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>'),
    alignR: svg('<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/>'),
    copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    more: svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 13),
    highlight: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>')
  };

  function create(container, hooks) {
    const d = container.ownerDocument;
    let ctx = { doc: null, win: null, getRange: () => null, undoMgr: null, canvas: null, getSelectedEl: () => null, isTextEditing: () => false };
    const els = {};

    function restoreSelection(range) {
      if (!ctx.doc) return;
      const r = range || (ctx.getRange && ctx.getRange());
      const sel = ctx.doc.getSelection();
      if (r && sel) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) {} }
    }

    // 跨帧执行：聚焦 iframe + 恢复选区 → 跑命令 → checkpoint + 标脏 + 刷新。
    function run(fn) {
      if (!ctx.doc) return;
      if (ctx.win && ctx.win.focus) ctx.win.focus();
      restoreSelection();
      fn(ctx.doc);
      if (ctx.undoMgr) ctx.undoMgr.checkpoint();
      hooks.markDirty();
      refresh();
      if (hooks.onApply) hooks.onApply();
    }
    const cmd = (name, val) => () => run((doc) => doc.execCommand(name, false, val));

    // 元素级执行：对 ctx.getSelectedEl() 跑 fn(el)，再 checkpoint + 标脏 + 刷新。
    function applyToSel(fn) {
      const el = ctx.getSelectedEl && ctx.getSelectedEl();
      if (!el) return;
      fn(el);
      if (ctx.undoMgr && ctx.undoMgr.checkpoint) ctx.undoMgr.checkpoint();
      hooks.markDirty();
      refresh();
      if (hooks.onApply) hooks.onApply();
    }
    const editing = () => !!(ctx.isTextEditing && ctx.isTextEditing());
    const selEl = () => (ctx.getSelectedEl && ctx.getSelectedEl()) || null;

    // ---- DOM 构建小工具 ----
    function btn(label, title, onClick, opts) {
      const b = d.createElement('button');
      b.className = 'tb-btn' + (opts && opts.danger ? ' tb-danger' : '');
      b.innerHTML = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault()); // 不抢 iframe 焦点 → 选区保住
      b.addEventListener('click', onClick);
      return b;
    }
    function group(modes) {
      const g = d.createElement('span'); g.className = 'tb-group';
      g.dataset.modes = modes;
      for (let i = 1; i < arguments.length; i++) g.appendChild(arguments[i]);
      return g;
    }
    function select(options, onPick, opts) {
      const s = d.createElement('select');
      s.className = 'tb-select';
      for (const o of options) {
        const op = d.createElement('option');
        op.value = o.value; op.textContent = o.label;
        s.appendChild(op);
      }
      s.addEventListener('change', () => {
        const v = s.value;
        if (opts && opts.reset) s.selectedIndex = 0;
        if (v !== '' || !opts || !opts.reset) onPick(v);
      });
      return s;
    }
    function closePops() {
      container.querySelectorAll('.tb-pop.open').forEach(p => p.classList.remove('open'));
    }
    // 触发钮 + 弹层：点开/关，互斥（先 closePops）。onOpen 在弹层「打开后」调（链接弹层靠它
    // 回填+聚焦输入——必须在 .open 之后跑，否则 openLink 的 open 守卫挡掉）。
    function holder(trigger, pop, onOpen) {
      const h = d.createElement('span'); h.className = 'tb-holder';
      pop.classList.add('tb-pop');
      trigger.addEventListener('mousedown', (e) => e.preventDefault());
      trigger.addEventListener('click', () => {
        const showing = pop.classList.contains('open');
        closePops();
        if (!showing && ctx.doc) { pop.classList.add('open'); if (onOpen) onOpen(); }
      });
      h.append(trigger, pop);
      return h;
    }

    // ---- 转为（块类型）：文字编辑态 formatBlock；元素态 retagElement 并把选中转到新元素 ----
    function applyTurn(tag) {
      if (editing() || !selEl()) { run((doc) => doc.execCommand('formatBlock', false, tag)); return; }
      applyToSel((el) => {
        const next = WS2Format.retagElement(el, tag);
        if (next !== el && ctx.canvas && ctx.canvas.select) ctx.canvas.select(next);
      });
    }
    const turnBtn = btn('转为' + ICON.chevron, '转换类型', () => {});
    turnBtn.className = 'tb-btn tb-turn';
    const turnPop = d.createElement('div'); turnPop.className = 'tb-menu';
    for (const t of TURN) {
      const row = btn(t.label, t.label, () => { applyTurn(t.tag); closePops(); });
      row.className = 'tb-menu-item';
      turnPop.appendChild(row);
    }
    const turnHolder = holder(turnBtn, turnPop);

    // ---- 文字行内格式 ----
    els.bold = btn(ICON.bold, '加粗 Cmd+B', cmd('bold'));
    els.italic = btn(ICON.italic, '斜体 Cmd+I', cmd('italic'));
    els.underline = btn(ICON.underline, '下划线 Cmd+U', cmd('underline'));
    els.strike = btn(ICON.strike, '删除线', cmd('strikeThrough'));

    // ---- 颜色弹层：元素态作用于被选元素（CSSOM），文字态作用于选区（execCommand） ----
    function colorMenu(triggerLabel, title, colors, command, clearValue, styleProp) {
      const trigger = btn(triggerLabel, title, () => {});
      const applyColor = (c) => {
        if (editing() || !selEl()) run((doc) => doc.execCommand(command, false, c));
        else applyToSel((el) => WS2Format.applyBlockStyle(el, styleProp, c));
      };
      const pop = d.createElement('div'); pop.className = 'tb-swatches';
      for (const c of colors) {
        const sw = d.createElement('button');
        sw.className = 'tb-swatch'; sw.title = c; sw.style.background = c;
        sw.addEventListener('mousedown', (e) => e.preventDefault());
        sw.addEventListener('click', () => { applyColor(c); closePops(); });
        pop.appendChild(sw);
      }
      const clr = btn('清除', '清除', () => {
        if (editing() || !selEl()) run((doc) => doc.execCommand(command, false, clearValue));
        else applyToSel((el) => WS2Format.applyBlockStyle(el, styleProp, ''));
        closePops();
      });
      clr.className = 'tb-swatch-clear';
      pop.appendChild(clr);
      return holder(trigger, pop);
    }
    els.color = colorMenu('<span class="tb-aglyph">A</span>', '文字颜色', TEXT_COLORS, 'foreColor', '#1c1d1f', 'color');
    els.hilite = colorMenu(ICON.highlight, '背景高亮', HILITE_COLORS, 'hiliteColor', 'transparent', 'backgroundColor');

    // ---- 链接弹层 ----
    let linkSnapshot = null;
    const linkBtn = btn(ICON.link, '链接', () => {});
    const linkPop = d.createElement('div'); linkPop.className = 'tb-linkpop';
    const linkInput = d.createElement('input');
    linkInput.type = 'text'; linkInput.placeholder = 'https://…'; linkInput.className = 'tb-linkinput';
    const linkOk = btn('应用', '应用链接', () => applyLink());
    const linkRemove = btn('移除', '移除链接', () => { linkInput.value = ''; applyLink(); });
    linkOk.className = 'tb-textbtn'; linkRemove.className = 'tb-textbtn';
    const linkRow = d.createElement('div'); linkRow.className = 'tb-linkrow';
    linkRow.append(linkInput, linkOk, linkRemove);
    linkPop.appendChild(linkRow);
    const linkHolder = holder(linkBtn, linkPop, () => openLink());
    linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') closePops(); });
    linkInput.addEventListener('input', () => { linkInput.style.borderColor = ''; });

    function openLink() {
      // holder 的 click 已 toggle 了 linkPop；这里在它打开时回填 + 聚焦输入。
      if (!linkPop.classList.contains('open') || !ctx.doc) return;
      linkSnapshot = ctx.getRange ? ctx.getRange() : null;
      const a = global.WS2Format ? WS2Format.anchorAt(ctx.doc) : null;
      const safe = WS2Format.safeHref(a ? a.getAttribute('href') : '');
      linkInput.value = safe || '';
      linkInput.style.borderColor = '';
      linkInput.focus(); linkInput.select();
    }
    function unwrap(el) {
      const p = el.parentNode; if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
    }
    function applyLink() {
      const safe = WS2Format.safeHref(linkInput.value);
      if (safe === null) { linkInput.style.borderColor = '#d93025'; return; } // 危险 scheme：拒绝
      closePops();
      if (!ctx.doc) return;
      if (ctx.win && ctx.win.focus) ctx.win.focus();
      restoreSelection(linkSnapshot);
      const a = global.WS2Format ? WS2Format.anchorAt(ctx.doc) : null;
      if (!safe) { if (a) unwrap(a); }
      else if (a) a.setAttribute('href', safe);
      else ctx.doc.execCommand('createLink', false, safe);
      if (ctx.undoMgr) ctx.undoMgr.checkpoint();
      hooks.markDirty();
      refresh();
      if (hooks.onApply) hooks.onApply();
    }

    // ---- 对齐（元素态 textAlign / 文字态 justify*） ----
    const align = (command, value) => () => {
      if (editing() || !selEl()) run((doc) => doc.execCommand(command, false));
      else applyToSel((el) => WS2Format.applyBlockStyle(el, 'textAlign', value));
    };
    els.alignL = btn(ICON.alignL, '左对齐', align('justifyLeft', 'left'));
    els.alignC = btn(ICON.alignC, '居中', align('justifyCenter', 'center'));
    els.alignR = btn(ICON.alignR, '右对齐', align('justifyRight', 'right'));

    // ---- 块操作（元素态） ----
    const blockTarget = (doc) => (ctx.getSelectedEl && ctx.getSelectedEl()) || WS2Format.currentBlock(doc);
    els.dup = btn(ICON.copy, '复制块', () => run((doc) => { WS2Format.duplicateBlock(blockTarget(doc)); }));
    els.del = btn(ICON.trash, '删除块', () => run((doc) => { const b = blockTarget(doc); if (b) b.remove(); }), { danger: true });

    // ---- 更多 ⋯：字体 / 字号 / 圆角 / 阴影 / 不透明度 / 清除格式（元素态画布特性收纳于此） ----
    function cycle(prop, ring, el) {
      const cur = el.style[prop] || '';
      const i = ring.indexOf(cur);
      return ring[(i + 1) % ring.length];
    }
    els.font = select(FONTS, (v) => {
      if (editing() || !selEl()) { if (v) run((doc) => doc.execCommand('fontName', false, v)); return; }
      applyToSel((el) => WS2Format.applyBlockStyle(el, 'fontFamily', v));
    });
    els.size = select(SIZES.map(s => ({ label: s, value: s === '默认字号' ? '' : s })), (v) => {
      if (editing() || !selEl()) { if (v) run((doc) => WS2Format.wrapInlineStyle(doc, 'fontSize', v + 'px')); return; }
      applyToSel((el) => WS2Format.applyBlockStyle(el, 'fontSize', v ? v + 'px' : ''));
    });
    function moreRow(node) { const r = d.createElement('div'); r.className = 'tb-menu-row'; r.appendChild(node); return r; }
    function moreItem(label, title, onClick) { const b = btn(label, title, onClick); b.className = 'tb-menu-item'; return b; }
    const moreBtn = btn(ICON.more, '更多', () => {});
    const morePop = d.createElement('div'); morePop.className = 'tb-menu tb-menu-wide';
    const moreSep = () => { const s = d.createElement('div'); s.className = 'tb-menu-sep'; return s; };
    morePop.append(
      moreRow(els.font),
      moreRow(els.size),
      moreSep(),
      moreItem('圆角', '圆角', () => applyToSel((el) => WS2Format.applyBlockStyle(el, 'borderRadius', cycle('borderRadius', RADII, el)))),
      moreItem('阴影', '阴影', () => applyToSel((el) => WS2Format.applyBlockStyle(el, 'boxShadow', el.style.boxShadow ? '' : BOX_SHADOW))),
      moreItem('不透明度', '不透明度', () => applyToSel((el) => WS2Format.applyBlockStyle(el, 'opacity', cycle('opacity', OPACITIES, el)))),
      moreSep(),
      moreItem('清除格式', '清除格式', cmd('removeFormat'))
    );
    const moreHolder = holder(moreBtn, morePop);

    // ---- 组装：分组带 data-modes，setMode 切显隐；除首组「转为」外都带左分隔（CSS tb-group + tb-group）----
    container.append(
      group('text element', turnHolder),
      group('text', els.bold, els.italic, els.underline, els.strike),
      group('element', els.alignL, els.alignC, els.alignR),
      group('text element', els.color, els.hilite),
      group('text', linkHolder),
      group('element', moreHolder),
      group('element', els.dup, els.del)
    );

    // 点工具栏外关弹层（含 iframe 内点击——shell 把 iframe mousedown 转过来）。
    d.addEventListener('mousedown', (e) => {
      if (!container.contains(e.target)) closePops();
    });

    function setMode(mode) {
      container.querySelectorAll('.tb-group').forEach((g) => {
        g.hidden = g.dataset.modes.split(' ').indexOf(mode) === -1;
      });
      closePops();
    }

    function refresh() {
      const on = !!ctx.doc;
      container.querySelectorAll('button, select, input').forEach(el => { el.disabled = !on; });
      if (!on) return;
      const doc = ctx.doc;
      try {
        els.bold.classList.toggle('active', doc.queryCommandState('bold'));
        els.italic.classList.toggle('active', doc.queryCommandState('italic'));
        els.underline.classList.toggle('active', doc.queryCommandState('underline'));
        els.strike.classList.toggle('active', doc.queryCommandState('strikeThrough'));
      } catch (e) {}
    }

    function setContext(next) {
      ctx = Object.assign({ doc: null, win: null, getRange: () => null, undoMgr: null, canvas: null, getSelectedEl: () => null, isTextEditing: () => false }, next);
      closePops();
      refresh();
    }

    refresh();
    return { setContext, refresh, closePops, setMode };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Toolbar = api;
})(typeof window !== 'undefined' ? window : globalThis);
