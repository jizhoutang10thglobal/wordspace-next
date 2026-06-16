(function (global) {
  // 常驻富工具栏，挂在父层 app chrome（不进 iframe 文档，对保真零风险）。命令通过
  // ctx.doc.execCommand / WS2Format 跨帧操作被编辑文档；ctx 由 shell 每次开文档时 setContext。
  const HEADINGS = [
    { label: '正文', tag: 'p' },
    { label: '标题 1', tag: 'h1' },
    { label: '标题 2', tag: 'h2' },
    { label: '标题 3', tag: 'h3' },
    { label: '引用', tag: 'blockquote' }
  ];
  const FONTS = [
    { label: '字体', value: '' },
    { label: '无衬线', value: 'sans-serif' },
    { label: '衬线', value: 'serif' },
    { label: '等宽', value: 'monospace' },
    { label: '系统', value: '-apple-system, system-ui, sans-serif' }
  ];
  const SIZES = ['字号', '12', '14', '16', '18', '20', '24', '28', '32', '40'];
  const TEXT_COLORS = ['#1a1a1a', '#888888', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff'];

  function create(container, hooks) {
    const d = container.ownerDocument;
    let ctx = { doc: null, win: null, getRange: () => null, undoMgr: null, canvas: null, getSelectedEl: () => null };
    const els = {};

    function restoreSelection(range) {
      if (!ctx.doc) return;
      const r = range || (ctx.getRange && ctx.getRange());
      const sel = ctx.doc.getSelection();
      if (r && sel) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) {} }
    }

    // 跨帧执行：先聚焦 iframe + 恢复选区，再跑命令；之后 checkpoint + 标脏 + 刷新状态。
    // 画布模型不需要重标块（不再依赖 data-ws2-block），故去掉 WS2Blocks.markBlocks。
    function run(fn) {
      if (!ctx.doc) return;
      if (ctx.win && ctx.win.focus) ctx.win.focus();
      restoreSelection();
      fn(ctx.doc);
      if (ctx.undoMgr) ctx.undoMgr.checkpoint();
      hooks.markDirty();
      refresh();
    }
    const cmd = (name, val) => () => run((doc) => doc.execCommand(name, false, val));

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
    function sep() { const s = d.createElement('span'); s.className = 'tb-sep'; return s; }
    function group() {
      const g = d.createElement('span'); g.className = 'tb-group';
      for (let i = 0; i < arguments.length; i++) g.appendChild(arguments[i]);
      return g;
    }
    // 下拉：options=[{label,value}]；reset=true 时选完自动回到第 0 项（当动作菜单用）。
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
    // 颜色弹窗：openBtn 旁挂 swatch 面板。
    function colorMenu(label, title, colors, command, clearValue) {
      const holder = d.createElement('span'); holder.className = 'tb-holder';
      const open = btn(label, title, () => {
        const showing = pop.classList.contains('open');
        closePops();
        if (!showing) pop.classList.add('open');
      });
      const pop = d.createElement('div'); pop.className = 'tb-pop';
      for (const c of colors) {
        const sw = d.createElement('button');
        sw.className = 'tb-swatch'; sw.title = c;
        sw.style.background = c;
        sw.addEventListener('mousedown', (e) => e.preventDefault());
        sw.addEventListener('click', () => { run((doc) => doc.execCommand(command, false, c)); closePops(); });
        pop.appendChild(sw);
      }
      const clr = btn('清除', '清除', () => { run((doc) => doc.execCommand(command, false, clearValue)); closePops(); });
      clr.className = 'tb-clear';
      pop.appendChild(clr);
      holder.append(open, pop);
      return holder;
    }
    function closePops() {
      container.querySelectorAll('.tb-pop.open').forEach(p => p.classList.remove('open'));
    }

    // ---- 链接弹窗 ----
    let linkSnapshot = null;
    const linkHolder = d.createElement('span'); linkHolder.className = 'tb-holder';
    const linkBtn = btn('🔗', '链接', () => openLink());
    const linkPop = d.createElement('div'); linkPop.className = 'tb-pop tb-linkpop';
    const linkInput = d.createElement('input');
    linkInput.type = 'text'; linkInput.placeholder = 'https://…'; linkInput.className = 'tb-linkinput';
    const linkOk = btn('确定', '应用链接', () => applyLink());
    const linkRemove = btn('移除', '移除链接', () => { linkInput.value = ''; applyLink(); });
    linkOk.className = 'tb-textbtn'; linkRemove.className = 'tb-textbtn';
    const linkRow = d.createElement('div'); linkRow.className = 'tb-linkrow';
    linkRow.append(linkInput, linkOk, linkRemove);
    linkPop.appendChild(linkRow);
    linkHolder.append(linkBtn, linkPop);
    linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') closePops(); });
    linkInput.addEventListener('input', () => { linkInput.style.borderColor = ''; }); // 改输入清掉拒绝红边

    function openLink() {
      const showing = linkPop.classList.contains('open');
      closePops();
      if (showing || !ctx.doc) return;
      linkSnapshot = ctx.getRange ? ctx.getRange() : null;
      const a = global.WS2Format ? WS2Format.anchorAt(ctx.doc) : null;
      const safe = WS2Format.safeHref(a ? a.getAttribute('href') : ''); // 旧值若是危险 scheme，回填空
      linkInput.value = safe || '';
      linkInput.style.borderColor = '';
      linkPop.classList.add('open');
      linkInput.focus(); linkInput.select();
    }
    function unwrap(el) {
      const p = el.parentNode; if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
    }
    function applyLink() {
      const safe = WS2Format.safeHref(linkInput.value);
      if (safe === null) { linkInput.style.borderColor = '#b3261e'; return; } // 危险 scheme：拒绝、不动文档
      closePops();
      if (!ctx.doc) return;
      if (ctx.win && ctx.win.focus) ctx.win.focus();
      restoreSelection(linkSnapshot);
      const a = global.WS2Format ? WS2Format.anchorAt(ctx.doc) : null;
      if (!safe) { if (a) unwrap(a); }       // 空 = 拆链接
      else if (a) a.setAttribute('href', safe);
      else ctx.doc.execCommand('createLink', false, safe);
      if (ctx.undoMgr) ctx.undoMgr.checkpoint();
      hooks.markDirty();
      refresh();
    }

    // ---- 文字色按钮（A 带下划色条） ----
    const colorA = '<span class="tb-aglyph">A</span>';

    // ---- 组装 ----
    els.bold = btn('<b>B</b>', '加粗 Cmd+B', cmd('bold'));
    els.italic = btn('<i>I</i>', '斜体 Cmd+I', cmd('italic'));
    els.underline = btn('<u>U</u>', '下划线 Cmd+U', cmd('underline'));
    els.strike = btn('<s>S</s>', '删除线', cmd('strikeThrough'));

    els.heading = select(HEADINGS.map(h => ({ label: h.label, value: h.tag })),
      (v) => run((doc) => doc.execCommand('formatBlock', false, v)));

    els.ul = btn('•', '无序列表', cmd('insertUnorderedList'));
    els.ol = btn('1.', '有序列表', cmd('insertOrderedList'));

    els.font = select(FONTS, (v) => { if (v) run((doc) => doc.execCommand('fontName', false, v)); }, { reset: true });
    els.size = select(SIZES.map(s => ({ label: s, value: s === '字号' ? '' : s })),
      (v) => { if (v) run((doc) => WS2Format.wrapInlineStyle(doc, 'fontSize', v + 'px')); }, { reset: true });

    els.color = colorMenu(colorA, '文字颜色', TEXT_COLORS, 'foreColor', '#1a1a1a');
    els.hilite = colorMenu('🖍', '背景高亮', HILITE_COLORS, 'hiliteColor', 'transparent');

    els.alignL = btn('左', '左对齐', cmd('justifyLeft'));
    els.alignC = btn('中', '居中', cmd('justifyCenter'));
    els.alignR = btn('右', '右对齐', cmd('justifyRight'));

    // 块操作目标：优先被选元素（HVE 选择模型），回退到光标当前块（文字编辑路径）。
    const blockTarget = (doc) => (ctx.getSelectedEl && ctx.getSelectedEl()) || WS2Format.currentBlock(doc);
    els.dup = btn('⧉', '复制块', () => run((doc) => { WS2Format.duplicateBlock(blockTarget(doc)); }));
    els.up = btn('↑', '上移块', () => run((doc) => { WS2Format.moveBlock(blockTarget(doc), -1); }));
    els.down = btn('↓', '下移块', () => run((doc) => { WS2Format.moveBlock(blockTarget(doc), 1); }));
    els.del = btn('🗑', '删除块', () => run((doc) => { const b = blockTarget(doc); if (b) b.remove(); }), { danger: true });

    els.hr = btn('―', '插入分隔线', cmd('insertHorizontalRule'));
    els.clear = btn('清除格式', '移除行内格式', cmd('removeFormat'));
    els.clear.className = 'tb-btn tb-textbtn';

    els.undo = btn('↶', '撤销', () => { if (ctx.undoMgr && ctx.undoMgr.undo()) { hooks.markDirty(); refresh(); } });
    els.redo = btn('↷', '重做', () => { if (ctx.undoMgr && ctx.undoMgr.redo()) { hooks.markDirty(); refresh(); } });

    container.append(
      group(els.bold, els.italic, els.underline, els.strike), sep(),
      group(els.heading), sep(),
      group(els.ul, els.ol), sep(),
      group(els.font, els.size), sep(),
      group(els.color, els.hilite), sep(),
      group(linkHolder), sep(),
      group(els.alignL, els.alignC, els.alignR), sep(),
      group(els.dup, els.up, els.down, els.del), sep(),
      group(els.hr, els.clear), sep(),
      group(els.undo, els.redo)
    );

    // 点工具栏外关掉所有弹窗（含 iframe 内点击——shell 会把 iframe 的 mousedown 转过来）。
    d.addEventListener('mousedown', (e) => {
      if (!container.contains(e.target)) closePops();
    });

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
      const block = global.WS2Format ? WS2Format.currentBlock(doc) : null;
      if (block) {
        const tag = block.tagName.toLowerCase();
        els.heading.value = HEADINGS.some(h => h.tag === tag) ? tag : 'p';
      }
    }

    function setContext(next) {
      ctx = Object.assign({ doc: null, win: null, getRange: () => null, undoMgr: null, canvas: null, getSelectedEl: () => null }, next);
      closePops();
      refresh();
    }

    refresh(); // 初始：无文档 → 全禁用
    return { setContext, refresh, closePops };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Toolbar = api;
})(typeof window !== 'undefined' ? window : globalThis);
