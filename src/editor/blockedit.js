(function (global) {
  // WS2BlockEdit —— ui-demo（main）式 Notion 块编辑内核，取代 heyhtml 自由画布。
  // 跑在父层 renderer，操作 iframe 的 contentDocument（iframe sandbox 无 allow-scripts，不跑脚本）。
  // 「块」= 块容器（blockRoot）的顶层子元素（排除 data-ws2-ui 覆盖层）。blockRoot 默认 <body>，
  // 但会穿透居中/限宽包裹容器（见 pickBlockRoot），否则被 <div class="wrap"> 包住的文档会塌成单块。
  // 所有编辑 UI（⋮⋮ 手柄 / 块菜单 /
  // 斜杠菜单 / 格式气泡）都是 iframe 内的 data-ws2-ui 节点，存盘时 serialize 剥除（不入磁盘）。
  // 选中/编辑态走 data-ws2-selected / data-ws2-editing 属性（serialize 白名单剥除），不包裹用户元素（保真）。
  // 排版样式经 adoptedStyleSheets 注入（构造样式表 = CSSOM，CSP 不拦、且不进序列化 → 存盘干净）。

  const fmt = (typeof WS2Format !== 'undefined') ? WS2Format
    : (typeof require !== 'undefined' ? require('./format.js') : null);

  // 斜杠 / 块操作的类型表（对齐 ui-demo SLASH_ITEMS）
  const SLASH_ITEMS = [
    { key: 'text', label: '正文', tag: 'p' },
    { key: 'h1', label: '标题 1', tag: 'h1' },
    { key: 'h2', label: '标题 2', tag: 'h2' },
    { key: 'h3', label: '标题 3', tag: 'h3' },
    { key: 'list', label: '列表', tag: 'ul' },
    { key: 'quote', label: '引用', tag: 'blockquote' },
    { key: 'callout', label: '提示', tag: 'div', cls: 'ws-callout' },
    { key: 'divider', label: '分隔线', tag: 'hr' },
    { key: 'ai', label: '✦ AI 生成（开发中）', tag: null, ai: true },
  ];
  const filterSlash = (q) => {
    const s = (q || '').toLowerCase();
    return SLASH_ITEMS.filter((it) => !s || it.label.toLowerCase().includes(s) || it.key.includes(s));
  };

  // 顶层块类型推断（标签 → ui-demo 块类型）
  function classify(el) {
    if (!el || el.nodeType !== 1) return 'other';
    const t = el.tagName;
    if (t === 'H1' || t === 'H2' || t === 'H3') return 'heading';
    if (t === 'P') return 'text';
    if (t === 'UL' || t === 'OL') return 'list';
    if (t === 'BLOCKQUOTE') return 'quote';
    if (t === 'HR') return 'divider';
    if (t === 'IMG') return 'image';
    return 'other';
  }
  // 可文字编辑的块：标题/正文/列表/引用 + 含直接文字的 div（callout/裸文本容器）。其余（图片/分隔线/
  // 复杂结构 div = designed）= 不可编辑、整块灰选中。
  function isEditableEl(el) {
    const c = classify(el);
    if (c === 'heading' || c === 'text' || c === 'list' || c === 'quote') return true;
    // callout（div.ws-callout）恒可编辑——即使被清空也要能再点进去（否则空 callout 成死块陷阱）
    if (el && el.classList && el.classList.contains('ws-callout')) return true;
    if (c === 'other' && fmt && fmt.isTextEditable(el)) return true;
    return false;
  }

  // 真正承载「块」的容器。多数「像样」的文档把正文包在一个居中/限宽的容器里
  // （<body> 底下只有这一个 <div class="wrap"> / <main> 之类）。若死认 <body> 为块容器，
  // 整篇会塌成单个不可编辑块——点哪都进不去编辑。这是真实文档最常见的结构（容器 div 做居中限宽），
  // 必须穿透。规则：从 body 向下钻，当当前容器「只有一个实体元素孩子」、那孩子是无语义包裹容器
  // （div/section/article/main）、且它自己还含元素孩子（钻下去确有块）时，下钻一层；否则停。
  // 处理 body>div.wrap>[blocks] 乃至多层嵌套；单个纯文字 div 不钻（它本身就是可编辑块）。
  const WRAP_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN']);
  function realEls(el) {
    const out = [];
    for (const c of el.children) {
      if (c.nodeType === 1 && !(c.hasAttribute && c.hasAttribute('data-ws2-ui'))) out.push(c);
    }
    return out;
  }
  function pickBlockRoot(body) {
    let root = body;
    for (let depth = 0; depth < 8; depth++) { // 上限防异常深嵌套
      const kids = realEls(root);
      if (kids.length !== 1) break;
      const only = kids[0];
      if (!WRAP_TAGS.has(only.tagName)) break;     // 独子不是无语义容器（如它本身是 <p>/<ul>）→ 停
      if (realEls(only).length === 0) break;        // 纯文字容器：它自己就是可编辑块，别钻成空
      root = only;
    }
    return root;
  }

  function caretRangeAtPoint(doc, x, y) {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) { const r = doc.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true); return r; }
    }
    return null;
  }
  function isCaretAtEnd(doc, el) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.endContainer)) return false;
    const after = doc.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(el, el.childNodes.length);
    return after.toString().trim() === '';
  }
  function isCaretAtStart(doc, el) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.startContainer)) return false;
    const before = doc.createRange();
    before.setStart(el, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    return before.toString() === '';
  }

  function attach(doc, deps) {
    deps = deps || {};
    const win = deps.win || doc.defaultView;
    const undoMgr = deps.undoMgr || null;
    const markDirty = deps.markDirty || (() => {});
    const onAiSoon = deps.onAiSoon || (() => {});
    const body = doc.body;
    // 块容器：穿透居中/限宽包裹容器（见 pickBlockRoot）。撤销/重做会整体重写 body.innerHTML、
    // 重建包裹节点 → 旧引用失效，故在 reset() 里重算（let 而非 const）。
    let blockRoot = pickBlockRoot(body);

    // ---- 注入排版样式表（构造样式表 / adoptedStyleSheets，CSP-safe、不进序列化）----
    let sheet = null;
    try {
      sheet = new (win.CSSStyleSheet || CSSStyleSheet)();
      sheet.replaceSync(EDITOR_CSS);
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet];
    } catch (e) {
      // 退路：构造样式表不可用时，用一个 data-ws2-ui 的 <style>（仍不入序列化，因 data-ws2-ui 整节点剥除）
      const st = doc.createElement('style');
      st.setAttribute('data-ws2-ui', '');
      st.textContent = EDITOR_CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }
    // 居中窄栏（ui-demo 820 列）——仅当文档是「裸块」结构（block root 就是 body、没有自带包裹容器）
    // 时才套；文档自带居中容器（blockRoot ≠ body）时尊重它原有的版式，不强加编辑器的列宽。
    if (blockRoot === body) body.setAttribute('data-ws2-canvas', '');

    // ---- 状态 ----
    let selectedEl = null;   // 灰选中的不可编辑块
    let editingEl = null;    // 正在文字编辑的块
    let hoverEl = null;      // 鼠标悬停的块（驱动 ⋮⋮ 定位）
    let slash = null;        // { blockEl, query, active }
    let dragFrom = null;     // 拖拽重排的源块
    let fmtShown = false;    // 格式气泡是否显示——「粘住」用：选区折叠后不立即关，直到离开该块

    // ---- 覆盖层节点（data-ws2-ui，存盘剥除）----
    function mk(tag, cls) { const n = doc.createElement(tag); n.setAttribute('data-ws2-ui', ''); n.setAttribute('contenteditable', 'false'); if (cls) n.className = cls; return n; }

    // ⋮⋮ 手柄（单个浮动，跟随 hover/选中块）
    const grip = mk('div', 'ws-grip');
    grip.style.position = 'absolute';
    grip.style.display = 'none';
    grip.setAttribute('draggable', 'true');
    grip.title = '拖动重排 · 点击打开菜单';
    grip.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
    doc.documentElement.appendChild(grip);

    // 格式气泡
    const fmtbar = mk('div', 'ws-fmtbar');
    fmtbar.style.display = 'none';
    doc.documentElement.appendChild(fmtbar);

    // 块操作菜单
    const blockMenu = mk('div', 'ws-blockmenu');
    blockMenu.style.position = 'absolute';
    blockMenu.style.display = 'none';
    doc.documentElement.appendChild(blockMenu);

    // 斜杠菜单
    const slashMenu = mk('div', 'ws-slashmenu');
    slashMenu.style.position = 'absolute';
    slashMenu.style.display = 'none';
    doc.documentElement.appendChild(slashMenu);

    const docOf = () => doc;
    function topBlocks() { return [...blockRoot.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')); }
    function blockOf(node) {
      let el = node; if (el && el.nodeType === 3) el = el.parentElement;
      while (el && el.parentElement && el.parentElement !== blockRoot) el = el.parentElement;
      // 块 = blockRoot 的直接子元素。点到容器外/空白（el.parentElement !== blockRoot）→ null（取消选中）
      if (!el || el.parentElement !== blockRoot || el.hasAttribute('data-ws2-ui')) return null;
      return el;
    }

    // ---- 定位 ----
    function vp() { return { sx: (win.scrollX || 0), sy: (win.scrollY || 0) }; }
    function positionGrip(el) {
      if (!el || !el.isConnected) { grip.style.display = 'none'; return; } // 防已删块的幽灵手柄
      const r = el.getBoundingClientRect();
      const { sx, sy } = vp();
      grip.style.left = (r.left + sx - 28) + 'px';
      grip.style.top = (r.top + sy + 2) + 'px';
      grip.style.display = 'flex';
    }
    function showFmtAt(left, top) {
      const { sx, sy } = vp();
      fmtbar.style.position = 'absolute';
      fmtbar.style.left = (left + sx) + 'px';
      fmtbar.style.top = (top + sy - 46) + 'px';
      fmtbar.style.display = 'flex';
      fmtShown = true;
    }
    function positionFmtbar() {
      const sel = doc.getSelection();
      // ① 编辑态有非折叠选区 → 跟随选区
      if (editingEl && sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) { showFmtAt(r.left + r.width / 2, r.top); return; }
      }
      // ② 块选中（非编辑）→ 浮块上方
      if (!editingEl && selectedEl && isEditableEl(selectedEl)) {
        const r = selectedEl.getBoundingClientRect();
        showFmtAt(r.left + Math.min(r.width / 2, 180), r.top); return;
      }
      // ③ 粘住：已显示且仍在编辑同一块（选区折叠，如刚点了格式按钮/移光标）→ 保持显示、锚到块上方，
      //    直到离开该块（点别的块/空白/Esc）才关。这样「改一下不会马上关掉气泡」。
      if (fmtShown && editingEl) {
        const r = editingEl.getBoundingClientRect();
        showFmtAt(r.left + Math.min(r.width / 2, 180), r.top); return;
      }
      fmtbar.style.display = 'none'; fmtShown = false;
    }

    // ---- 选中 / 编辑 ----
    function clearSelectedAttr() { const p = body.querySelector('[data-ws2-selected]'); if (p) p.removeAttribute('data-ws2-selected'); }
    function selectBlock(el) {
      exitEdit();
      clearSelectedAttr();
      selectedEl = el;
      if (el) el.setAttribute('data-ws2-selected', '');
      positionFmtbar();
    }
    function deselect() {
      exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      hoverEl = null; grip.style.display = 'none'; // 清悬停引用，防删块后幽灵手柄
      closeBlockMenu();
      fmtbar.style.display = 'none'; fmtShown = false;
    }
    function enterEdit(el, caret) {
      if (editingEl && editingEl !== el) exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      editingEl = el;
      fmtShown = false; // 进新编辑上下文：气泡先不粘（等用户选文字才弹）
      hoverEl = el; positionGrip(el); // 编辑态保留手柄、指向当前块（可开块菜单/拖拽，对齐 ui-demo 常驻手柄）
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ws2-ce', '');
      el.setAttribute('data-ws2-editing', '');
      el.focus();
      placeCaret(el, caret);
      positionFmtbar();
    }
    function exitEdit() {
      if (!editingEl) return;
      const el = editingEl; editingEl = null;
      if (el.hasAttribute('data-ws2-ce')) { el.removeAttribute('contenteditable'); el.removeAttribute('data-ws2-ce'); }
      el.removeAttribute('data-ws2-editing');
      fmtShown = false; fmtbar.style.display = 'none'; // 离开编辑 → 关气泡
    }
    function placeCaret(el, caret) {
      const sel = doc.getSelection(); if (!sel) return;
      let range = null;
      caret = caret || { mode: 'end' };
      if (caret.mode === 'keep') return; // 保留已有选区（点选文字后进编辑，别折叠它）
      // 列表：contenteditable 在 <ul> 上，但光标要落到 <li> 内（否则打字落 ul 直接子级 = 裸文本）
      let target = el;
      if ((el.tagName === 'UL' || el.tagName === 'OL')) { const li = el.querySelector('li'); if (li) target = li; }
      // 透明内容容器（div.lead>p 之类）：自己没直接文字、只裹块级内容时，光标下钻进里面第一个块，
      // 别停在容器层（否则键盘进入 start/end 模式打字会在容器直接子级产生裸文本）。
      while ((target.tagName === 'DIV' || target.tagName === 'SECTION' || target.tagName === 'ARTICLE' || target.tagName === 'MAIN')
        && ![...target.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        && target.firstElementChild) {
        target = target.firstElementChild;
      }
      if (caret.mode === 'point' && caret.x != null) {
        const pt = caretRangeAtPoint(doc, caret.x, caret.y);
        if (pt && el.contains(pt.startContainer)) range = pt;
      }
      if (!range) { range = doc.createRange(); range.selectNodeContents(target); range.collapse(caret.mode === 'start'); }
      sel.removeAllRanges(); sel.addRange(range);
    }

    // ---- 块操作（复用 format.js）----
    function newBlock(item) {
      let el;
      if (item.tag === 'hr') { el = doc.createElement('hr'); }
      else if (item.tag === 'ul') { el = doc.createElement('ul'); el.innerHTML = '<li>列表项</li>'; }
      else if (item.tag === 'div' && item.cls === 'ws-callout') { el = doc.createElement('div'); el.className = 'ws-callout'; el.textContent = '提示内容'; }
      else if (item.tag === 'blockquote') { el = doc.createElement('blockquote'); el.textContent = '引用内容'; }
      else if (item.tag && item.tag[0] === 'h') { el = doc.createElement(item.tag); el.textContent = '新标题'; }
      else { el = doc.createElement('p'); }
      return el;
    }
    function insertAfter(refEl, item) {
      const el = newBlock(item);
      if (refEl && refEl.after) refEl.after(el); else blockRoot.appendChild(el);
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
      return el;
    }
    function turnInto(el, item) {
      if (!el) return el;
      if (item.tag === 'ul') {
        // 转列表：retag 后原内容裸挂在 <ul> 下（非法 + 无样式 + Enter 失灵）→ 包进单个 <li>。
        const next = fmt.retagElement(el, 'ul');
        next.removeAttribute('class');
        if (!next.querySelector('li')) {
          const li = doc.createElement('li');
          while (next.firstChild) li.appendChild(next.firstChild);
          next.appendChild(li); // 空内容时得到 <ul><li></li></ul>（合法、可继续编辑）
        }
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return next;
      }
      if (item.tag === 'hr') {
        const next = fmt.retagElement(el, 'hr');
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return next;
      }
      const next = fmt.retagElement(el, item.tag); // p / h1 / h2 / h3 / blockquote / div(callout)
      if (item.cls) next.className = item.cls; else if (next.classList && next.classList.contains('ws-callout')) next.classList.remove('ws-callout');
      if (undoMgr) undoMgr.checkpoint(); markDirty();
      return next;
    }
    function removeBlock(el) {
      const blocks = topBlocks();
      if (blocks.length <= 1) {
        // 删到只剩一块 → 清空成空正文进编辑，避免空白死状态
        const p = fmt.retagElement(el, 'p'); p.innerHTML = '';
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        enterEdit(p, { mode: 'start' });
        return;
      }
      const idx = blocks.indexOf(el);
      el.remove();
      if (undoMgr) undoMgr.checkpoint(); markDirty();
      deselect();
    }

    // ---- 格式气泡内容（对齐 ui-demo FormatToolbar）----
    // 选区是否落在同一块级元素内（折叠选区视为安全）。跨块用 execCommand 改结构会产生非法嵌套/
    // 写坏文档——对齐 wrapInlineStyle 的「跨块拒绝」保真红线；B/I/U/S/行内代码/链接此前都缺这道守卫。
    function selWithinOneBlock() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const r = sel.getRangeAt(0);
      if (r.collapsed) return true; // 折叠选区：execCommand 作用于光标处，安全
      const a = fmt.nearestBlock(r.startContainer, body);
      return !!a && a === fmt.nearestBlock(r.endContainer, body);
    }
    // 粗/斜/下划线/删除线：自由跨块——把选区按块切成子段，逐块聚焦+选中该段+execCommand，作用到选区里
    // 每个块的部分（不受块限制，这是用户要的）。实测 execCommand 逐块跑不写坏文档（已 fact-check）。
    // 临时设可编辑的块打 data-ws2-ce，serialize 会剥掉 contenteditable，存盘干净。
    function execText(cmd) {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (sel.isCollapsed) { doc.execCommand(cmd, false, null); markDirty(); persistEditing(); return; } // 折叠：作用于光标
      const full = sel.getRangeAt(0);
      const tops = topBlocks();
      let i = tops.indexOf(blockOf(full.startContainer)), j = tops.indexOf(blockOf(full.endContainer));
      if (i < 0 || j < 0) { doc.execCommand(cmd, false, null); markDirty(); persistEditing(); return; } // 兜底
      if (i > j) { const t = i; i = j; j = t; }
      const sC = full.startContainer, sO = full.startOffset, eC = full.endContainer, eO = full.endOffset;
      for (let k = i; k <= j; k++) {
        const blk = tops[k];
        if (!isEditableEl(blk)) continue; // 图片/分隔线等跳过
        const wasCE = blk.getAttribute('contenteditable') === 'true';
        if (!wasCE) { blk.setAttribute('contenteditable', 'true'); blk.setAttribute('data-ws2-ce', ''); }
        blk.focus();
        const r = doc.createRange();
        if (k === i) r.setStart(sC, sO); else r.setStart(blk, 0);
        if (k === j) r.setEnd(eC, eO); else r.setEnd(blk, blk.childNodes.length);
        const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
        try { doc.execCommand('styleWithCSS', false, false); } catch (e) {}
        doc.execCommand(cmd, false, null);
        if (!wasCE) { blk.removeAttribute('contenteditable'); blk.removeAttribute('data-ws2-ce'); } // 还原临时可编辑块
      }
      if (editingEl && editingEl.isConnected) editingEl.focus(); // 焦点还给原编辑块（别丢到末块）
      markDirty(); persistEditing();
    }
    // 删非折叠选区：覆盖「拖选没进编辑态」和「跨块选区」——这俩原生删不掉（选区横跨多个各自独立的
    // contenteditable 块，或没有任何 contenteditable 宿主），用户只能一个字一个字删（Wendi Bug4/5）。
    // 返回 true=已处理（调用方 preventDefault）；false=交原生（如编辑态单块内选区，原生删得了）。
    function deleteSelection() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
      const r = sel.getRangeAt(0);
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (!sBlk || !eBlk) return false; // 选区落在块外/覆盖层 → 不碰
      if (sBlk === eBlk) {
        if (editingEl === sBlk) return false;  // 编辑态单块内选区 → 原生删得了
        if (!isEditableEl(sBlk)) return false; // 不可编辑块 → 不碰
        // 无编辑态的单块拖选：进编辑（保留选区）→ 重设选区 → execCommand 删
        const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
        enterEdit(sBlk, { mode: 'keep' });
        try { const cr = doc.createRange(); cr.setStart(sc, so); cr.setEnd(ec, eo); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
        doc.execCommand('delete'); markDirty(); if (undoMgr) undoMgr.scheduleCheckpoint();
        return true;
      }
      // 跨块：Range 规范上 startContainer 在 endContainer 之前 → sBlk 在 eBlk 之前
      const tops = topBlocks();
      const i = tops.indexOf(sBlk), j = tops.indexOf(eBlk);
      if (i < 0 || j < 0 || i > j) return false;
      const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sBlk, sBlk.childNodes.length); r1.deleteContents(); // 裁起块：选区起点→块末
      const r2 = doc.createRange(); r2.setStart(eBlk, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents();                       // 裁末块：块首→选区终点
      for (let k = j - 1; k > i; k--) { const m = tops[k]; if (m && m.parentElement === blockRoot) m.remove(); }                            // 删中间整块
      const prefixEnd = sBlk.lastChild; // 接合点（合并前 prefix 末尾）
      if (isEditableEl(sBlk) && isEditableEl(eBlk) && classify(sBlk) !== 'list' && classify(eBlk) !== 'list') {
        while (eBlk.firstChild) sBlk.appendChild(eBlk.firstChild); // 起末都是文字块 → 末块剩余并入起块
        eBlk.remove();
      }
      markDirty(); if (undoMgr) undoMgr.checkpoint();
      if (isEditableEl(sBlk)) {
        enterEdit(sBlk, { mode: 'keep' });
        try { const cr = doc.createRange(); if (prefixEnd && prefixEnd.parentNode === sBlk) cr.setStartAfter(prefixEnd); else cr.setStart(sBlk, 0); cr.collapse(true); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
      } else { selectBlock(sBlk); positionGrip(sBlk); }
      return true;
    }
    function applyColor(prop, value) {
      // 颜色/高亮：用 CSSOM span（KTD2）。wrapInlineStyle 内部已含跨块拒绝。
      if (fmt.wrapInlineStyle(doc, prop, value)) { markDirty(); persistEditing(); }
    }
    function addLink() {
      // 不再跨块拒绝：链接作用于当前编辑块的选区部分（链接本就不该横跨块）；execCommand 不会写坏文档。
      // iframe sandbox 无 allow-modals → iframe window 的 prompt/alert 被禁；用父窗口（global）
      const url = global.prompt ? global.prompt('链接地址', 'https://') : null;
      if (!url) return;
      const href = fmt.safeHref(url);
      if (!href) { if (global.alert) global.alert('不允许的链接地址'); return; }
      doc.execCommand('createLink', false, href);
      markDirty(); persistEditing();
    }
    function wrapCode() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      if (!selWithinOneBlock()) return; // 跨块拒绝：否则 extractContents 会把块级元素拽进 <code>
      const range = sel.getRangeAt(0);
      const code = doc.createElement('code');
      try { range.surroundContents(code); } catch (e) { code.appendChild(range.extractContents()); range.insertNode(code); }
      markDirty(); persistEditing();
    }
    function persistEditing() { /* DOM 即模型：编辑直接改 DOM，无需额外落库；标脏即可 */ }

    function fmtBtn(title, html, on) {
      const b = doc.createElement('button'); b.setAttribute('data-ws2-ui', ''); b.className = 'ws-fmtbar-btn'; b.title = title; b.innerHTML = html;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
      return b;
    }
    function buildFmtbar() {
      fmtbar.innerHTML = '';
      // 转为▾
      const turn = fmtBtn('转为', '<span class="ws-fmtbar-text">转为 ▾</span>', () => openTurnMenu());
      turn.className = 'ws-fmtbar-btn ws-fmtbar-text';
      fmtbar.appendChild(turn);
      fmtbar.appendChild(sepEl());
      fmtbar.appendChild(fmtBtn('加粗', '<b>B</b>', () => execText('bold')));
      fmtbar.appendChild(fmtBtn('斜体', '<i>I</i>', () => execText('italic')));
      fmtbar.appendChild(fmtBtn('下划线', '<u>U</u>', () => execText('underline')));
      fmtbar.appendChild(fmtBtn('删除线', '<s>S</s>', () => execText('strikeThrough')));
      fmtbar.appendChild(fmtBtn('行内代码', '<span style="font-family:monospace">&lt;&gt;</span>', () => wrapCode()));
      fmtbar.appendChild(sepEl());
      fmtbar.appendChild(colorHolder('文字色', false));
      fmtbar.appendChild(colorHolder('高亮', true));
      fmtbar.appendChild(fmtBtn('链接', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>', () => addLink()));
      fmtbar.appendChild(sepEl());
      const ai = fmtBtn('AI', '<span class="ws-fmtbar-ai">✦ AI</span>', () => onAiSoon());
      ai.className = 'ws-fmtbar-btn ws-fmtbar-ai';
      fmtbar.appendChild(ai);
    }
    function sepEl() { const s = doc.createElement('span'); s.setAttribute('data-ws2-ui', ''); s.className = 'ws-fmtbar-sep'; return s; }
    const TEXT_COLORS = ['#1c1d1f', '#d93025', '#b06000', '#1e8e3e', '#1a73e8', '#8430ce'];
    const HILITE_COLORS = ['#fff3bf', '#ffd8d8', '#d7f0db', '#d6e4ff', '#eadcff', '#eceef0'];
    function colorHolder(title, hilite) {
      const holder = doc.createElement('span'); holder.setAttribute('data-ws2-ui', ''); holder.className = 'ws-fmtbar-holder';
      const btn = fmtBtn(title, hilite
        ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l3-1 11-11-2-2L4 18z"/><path d="M14 7l3 3"/></svg>'
        : '<span class="ws-fmtbar-aglyph">A</span>', () => togglePop(pop));
      const pop = doc.createElement('div'); pop.setAttribute('data-ws2-ui', ''); pop.className = 'ws-fmtbar-swatches'; pop.style.display = 'none';
      (hilite ? HILITE_COLORS : TEXT_COLORS).forEach((c) => {
        const sw = doc.createElement('button'); sw.setAttribute('data-ws2-ui', ''); sw.className = 'ws-fmtbar-swatch'; sw.style.background = c;
        sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); applyColor(hilite ? 'backgroundColor' : 'color', c); pop.style.display = 'none'; });
        pop.appendChild(sw);
      });
      holder.appendChild(btn); holder.appendChild(pop);
      return holder;
    }
    function togglePop(pop) {
      const open = pop.style.display !== 'none';
      fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; });
      pop.style.display = open ? 'none' : 'flex';
    }
    function openTurnMenu() {
      let menu = fmtbar.querySelector('.ws-fmtbar-menu');
      if (menu) { togglePopMenu(menu); return; }
      menu = doc.createElement('div'); menu.setAttribute('data-ws2-ui', ''); menu.className = 'ws-fmtbar-menu';
      menu.style.display = 'none'; // 必须先 none，否则 togglePopMenu 把默认 display='' 误判成「已开」→ 首次点反而隐藏
      [['text', '正文'], ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'], ['quote', '引用'], ['list', '列表']].forEach(([key, label]) => {
        const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', ''); it.className = 'ws-fmtbar-menu-item'; it.textContent = label;
        it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        it.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const item = SLASH_ITEMS.find((x) => x.key === key);
          const target = editingEl || selectedEl;
          if (target && item) { const nx = turnInto(target, item); menu.style.display = 'none'; if (editingEl) enterEdit(nx, { mode: 'end' }); else selectBlock(nx); }
        });
        menu.appendChild(it);
      });
      fmtbar.appendChild(menu);
      togglePopMenu(menu);
    }
    function togglePopMenu(menu) { const open = menu.style.display !== 'none'; fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; }); menu.style.display = open ? 'none' : 'block'; }

    // ---- 块操作菜单 ----
    function openBlockMenu(el) {
      selectBlock(el);
      blockMenu.innerHTML = '';
      const add = (label, on, danger) => {
        const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', ''); it.className = 'ws-blockmenu-item' + (danger ? ' ws-blockmenu-danger' : ''); it.textContent = label;
        it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        it.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
        blockMenu.appendChild(it); return it;
      };
      const sub = (label, item) => add(label, () => { const nx = turnInto(el, item); closeBlockMenu(); selectBlock(nx); });
      sub('转为正文', SLASH_ITEMS[0]); sub('转为标题', SLASH_ITEMS[2]); sub('转为引用', SLASH_ITEMS[5]);
      const sep = doc.createElement('div'); sep.setAttribute('data-ws2-ui', ''); sep.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep);
      add('在下方插入', () => { const nx = insertAfter(el, SLASH_ITEMS[0]); closeBlockMenu(); enterEdit(nx, { mode: 'start' }); });
      add('复制', () => { const c = fmt.duplicateBlock(el); if (undoMgr) undoMgr.checkpoint(); markDirty(); closeBlockMenu(); if (c) selectBlock(c); });
      add('删除', () => { closeBlockMenu(); removeBlock(el); }, true);
      // 颜色行
      const colors = doc.createElement('div'); colors.setAttribute('data-ws2-ui', ''); colors.className = 'ws-blockmenu-colors';
      TEXT_COLORS.forEach((c) => { const sw = doc.createElement('button'); sw.setAttribute('data-ws2-ui', ''); sw.className = 'ws-blockmenu-swatch'; sw.style.background = c;
        sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (isEditableEl(el)) { el.style.color = c; if (undoMgr) undoMgr.checkpoint(); markDirty(); } closeBlockMenu(); });
        colors.appendChild(sw); });
      blockMenu.appendChild(colors);
      const r = grip.getBoundingClientRect(); const { sx, sy } = vp();
      blockMenu.style.left = (r.left + sx) + 'px';
      blockMenu.style.top = (r.bottom + sy + 4) + 'px';
      blockMenu.style.display = 'block';
    }
    function closeBlockMenu() { blockMenu.style.display = 'none'; }

    // ---- 斜杠菜单 ----
    function openSlash(blockEl) {
      slash = { blockEl, query: '', active: 0 };
      renderSlash();
    }
    function renderSlash() {
      if (!slash) { slashMenu.style.display = 'none'; return; }
      const items = filterSlash(slash.query);
      slashMenu.innerHTML = '';
      if (!items.length) { const e = doc.createElement('div'); e.setAttribute('data-ws2-ui', ''); e.className = 'ws-slashmenu-empty'; e.textContent = '无匹配'; slashMenu.appendChild(e); }
      items.forEach((it, i) => {
        const b = doc.createElement('button'); b.setAttribute('data-ws2-ui', ''); b.className = 'ws-slashmenu-item' + (i === slash.active ? ' active' : ''); b.textContent = it.label;
        b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); applySlash(it.key); });
        slashMenu.appendChild(b);
      });
      const sel = doc.getSelection();
      let rect = null;
      if (sel && sel.rangeCount) { const rr = sel.getRangeAt(0).getClientRects(); rect = rr.length ? rr[0] : (sel.getRangeAt(0).startContainer.parentElement && sel.getRangeAt(0).startContainer.parentElement.getBoundingClientRect()); }
      if (rect) { const { sx, sy } = vp(); slashMenu.style.left = (rect.left + sx) + 'px'; slashMenu.style.top = (rect.bottom + sy + 6) + 'px'; }
      slashMenu.style.display = 'block';
    }
    function applySlash(key) {
      const cur = slash; slash = null; slashMenu.style.display = 'none';
      if (!cur) return;
      const it = SLASH_ITEMS.find((x) => x.key === key);
      if (!it) return;
      // 删掉已输入的「/query」
      const sel = doc.getSelection();
      if (sel && sel.rangeCount) { for (let i = 0; i < cur.query.length + 1; i++) sel.modify('extend', 'backward', 'character'); doc.execCommand('delete'); }
      if (it.ai) { onAiSoon(); return; }
      const el = cur.blockEl;
      const empty = !el || (el.textContent || '').trim() === '';
      if (it.tag === 'hr') { const nx = insertAfter(el, it); selectBlock(nx); }
      else if (empty && isEditableEl(el)) { const nx = turnInto(el, it); enterEdit(nx, { mode: 'start' }); }
      else { const nx = insertAfter(el, it); enterEdit(nx, { mode: 'start' }); }
    }

    // ---- 监听器（父层挂到 iframe doc）----
    function onMouseMove(e) {
      // 在手柄/菜单/气泡上移动：保持现状（手柄在块外 margin，移过去若隐藏就点不到了）
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      const el = blockOf(e.target);
      if (el && el !== hoverEl) { hoverEl = el; positionGrip(el); } // 编辑态也更新（能对当前/别的块开菜单·拖拽）
      // 移到块外空白/gutter 间隙：不立即隐藏（停在最后悬停块、保证可点）；隐藏交给进编辑/离开文档。
    }
    function onDocLeave() { if (!selectedEl && !editingEl) { hoverEl = null; grip.style.display = 'none'; } }
    function onClick(e) {
      // 点到覆盖层（手柄/菜单/气泡）自身：交给它们各自的 handler，这里忽略
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      // 刚用鼠标拖选了文字（单块或跨块）→ 松手的这下 click 触发时选区仍非折叠 → 一律保留、什么都不做，
      // 否则会把选区折叠掉、气泡闪退（这是用户报的根因）。纯点击时 mousedown 已先把选区折叠成光标，不受影响。
      const _sel = doc.getSelection();
      if (_sel && !_sel.isCollapsed && _sel.rangeCount > 0) return;
      const el = blockOf(e.target);
      if (!el) {
        // 文末续写：点最后一块下方、且在文档列水平范围内的空白 → 进末块(若空可编辑)或末尾新建正文块
        // （对齐 ui-demo ws-canvas-tail）。列左右侧边距的点击仍是取消选中。
        const blocks = topBlocks();
        // 空文档（无任何块）：点一下就建第一个正文块进编辑，避免「打开空 HTML 后点不进去」死状态
        if (blocks.length === 0) { const p = doc.createElement('p'); blockRoot.appendChild(p); if (undoMgr) undoMgr.checkpoint(); markDirty(); enterEdit(p, { mode: 'start' }); return; }
        const last = blocks[blocks.length - 1];
        const br = blockRoot.getBoundingClientRect();
        if (last && e.clientY > last.getBoundingClientRect().bottom && e.clientX >= br.left && e.clientX <= br.right) {
          if (isEditableEl(last) && (last.textContent || '').trim() === '') enterEdit(last, { mode: 'end' });
          else { const nx = insertAfter(last, SLASH_ITEMS[0]); enterEdit(nx, { mode: 'start' }); }
          return;
        }
        deselect(); return;
      }
      closeBlockMenu();
      if (isEditableEl(el)) {
        if (editingEl === el) return; // 已编辑此块的纯点击 → 交原生移光标，别重置
        enterEdit(el, { mode: 'point', x: e.clientX, y: e.clientY });
      } else { selectBlock(el); positionGrip(el); }
    }
    function onKeyDown(e) {
      // 斜杠菜单开启时：导航
      if (slash) {
        if (e.isComposing || e.keyCode === 229) return; // IME 组词中：交原生（compositionstart 已关菜单兜底），别把组词键当 query
        if (e.key === 'Escape') { e.preventDefault(); slash = null; slashMenu.style.display = 'none'; return; }
        if (e.key === 'Enter') { e.preventDefault(); const items = filterSlash(slash.query); const it = items[slash.active]; if (it) applySlash(it.key); else { slash = null; slashMenu.style.display = 'none'; } return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); const n = filterSlash(slash.query).length; slash.active = Math.min(slash.active + 1, n - 1); renderSlash(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); slash.active = Math.max(0, slash.active - 1); renderSlash(); return; }
        if (e.key === 'Backspace') { if (slash.query.length === 0) { slash = null; slashMenu.style.display = 'none'; } else { slash.query = slash.query.slice(0, -1); slash.active = 0; renderSlash(); } return; }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { slash.query += e.key; slash.active = 0; renderSlash(); return; }
        // 光标移动键（←→/Home/End/PageUp-Down）或其它键 → 关菜单、交原生：caret 移走后再 applySlash 会从错位删字
        slash = null; slashMenu.style.display = 'none';
        return;
      }
      // 触发斜杠
      if (e.key === '/' && editingEl && !e.metaKey && !e.ctrlKey) {
        const blockEl = editingEl;
        // 用父窗口 setTimeout：iframe 是 sandbox 无 allow-scripts，在 iframe window 上调度回调会被拦
        global.setTimeout(() => { if (editingEl === blockEl) openSlash(blockEl); }, 0);
        return;
      }
      // 跨块 / 无编辑态拖选的删除 + 剪切：原生删不掉这类选区（横跨多个独立 contenteditable 块，
      // 或没有 contenteditable 宿主）→ 自己删（Wendi Bug4/5/6）。deleteSelection 返回 false 时（编辑态
      // 单块内选区）不拦、交原生。Cmd+X 先把选区复制进剪贴板再删。
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.isComposing && e.keyCode !== 229) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed && deleteSelection()) { e.preventDefault(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          e.preventDefault();
          try { doc.execCommand('copy'); } catch (x) {} // 复制选区到剪贴板（剪切=复制+删）
          if (!deleteSelection()) doc.execCommand('delete'); // 跨块/无主自己删；编辑态单块内 → 原生删
          markDirty();
          return;
        }
      }
      // Enter：可编辑块末尾 → 新建正文块（list 交原生新 <li>；中间交原生；IME/Shift 软换行）
      if (e.key === 'Enter' && editingEl) {
        if (e.isComposing || e.keyCode === 229 || e.shiftKey) return;
        if (classify(editingEl) === 'list') {
          // 列表内回车：空的最后一项上再回车 → 跳出列表、在 ul 后新建正文块（双回车退出，对齐常见编辑器）。
          const sel = doc.getSelection();
          const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
          const li = node && node.closest ? node.closest('li') : null;
          if (li && (li.textContent || '').trim() === '' && !li.nextElementSibling) {
            e.preventDefault();
            const ul = editingEl; li.remove();
            if (ul.querySelector('li')) { const nx = insertAfter(ul, SLASH_ITEMS[0]); enterEdit(nx, { mode: 'start' }); }
            else { const p = turnInto(ul, SLASH_ITEMS[0]); enterEdit(p, { mode: 'start' }); } // 列表空了 → 整块转正文
            return;
          }
          return; // 非空/非末项 → 交原生（新建 <li>）
        }
        if (!isCaretAtEnd(doc, editingEl)) return;
        e.preventDefault();
        const nx = insertAfter(editingEl, SLASH_ITEMS[0]);
        enterEdit(nx, { mode: 'start' });
        return;
      }
      // 灰选中态 Enter → 在其后插正文块
      if (e.key === 'Enter' && selectedEl && !editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        const nx = insertAfter(selectedEl, SLASH_ITEMS[0]);
        enterEdit(nx, { mode: 'start' });
        return;
      }
      // Backspace 块首：空块删/落上一块末；非空并入上一块（按标签类型安全合并，绝不产生非法嵌套）
      if (e.key === 'Backspace' && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        if (classify(editingEl) === 'list') return; // 列表内 Backspace 交原生（删项/退格），不走块级合并
        if (!isCaretAtStart(doc, editingEl)) return;
        const blocks = topBlocks();
        const idx = blocks.indexOf(editingEl);
        if (idx <= 0) return;
        const prev = blocks[idx - 1];
        const cur = editingEl;
        const curEmpty = (cur.textContent || '').trim() === '';
        e.preventDefault();
        if (curEmpty) {
          // 空块：直接删，光标落上一块（可编辑→末尾；否则灰选）
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          if (isEditableEl(prev)) enterEdit(prev, { mode: 'end' }); else { selectBlock(prev); positionGrip(prev); }
          return;
        }
        if (classify(prev) === 'list') {
          // 上一块是列表：当前块内容作为新 <li> 追加（不能把裸文本塞进 <ul>）
          const li = doc.createElement('li');
          while (cur.firstChild) li.appendChild(cur.firstChild);
          prev.appendChild(li);
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          try { const r = doc.createRange(); r.selectNodeContents(li); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {}
          return;
        }
        if (isEditableEl(prev)) {
          // 两个文字块：搬移子节点拼接（合法），光标落接合点（原 prev 末尾）
          const joinAt = cur.firstChild;
          while (cur.firstChild) prev.appendChild(cur.firstChild);
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          if (joinAt && joinAt.parentNode === prev) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
          return;
        }
        // prev 不可编辑（图片/分隔线/designed）且当前块非空：不吞内容，光标留在原处
        return;
      }
      // 跨块上下方向键：末行↓→下一块、首行↑→上一块（尽量保持列位置；不可编辑块则灰选）。块中间交原生。
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
        const er = editingEl.getBoundingClientRect();
        const box = sel.getRangeAt(0).getBoundingClientRect();
        const degenerate = box.height === 0 && box.top === 0; // 空块等取不到 caret 位置
        const caret = degenerate ? { top: er.top, bottom: er.bottom, left: er.left } : box;
        const lh = (degenerate ? Math.min(er.height, 24) : box.height) || 20;
        const blocks = topBlocks();
        const idx = blocks.indexOf(editingEl);
        if (e.key === 'ArrowDown') {
          if (caret.bottom < er.bottom - lh * 0.5) return; // 不在末行 → 原生
          const next = blocks[idx + 1]; if (!next) return;
          e.preventDefault();
          if (isEditableEl(next)) { const nr = next.getBoundingClientRect(); enterEdit(next, { mode: 'point', x: caret.left, y: nr.top + lh * 0.5 }); }
          else { selectBlock(next); positionGrip(next); }
        } else {
          if (caret.top > er.top + lh * 0.5) return; // 不在首行 → 原生
          const prev = blocks[idx - 1]; if (!prev) return;
          e.preventDefault();
          if (isEditableEl(prev)) { const pr = prev.getBoundingClientRect(); enterEdit(prev, { mode: 'point', x: caret.left, y: pr.bottom - lh * 0.5 }); }
          else { selectBlock(prev); positionGrip(prev); }
        }
        return;
      }
      // 灰选中（不可编辑块）态的上下方向键：继续穿过到上/下一块——否则键盘撞到图片/分隔线就卡死、过不去。
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && selectedEl && !editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        const blocks = topBlocks();
        const idx = blocks.indexOf(selectedEl);
        const target = e.key === 'ArrowDown' ? blocks[idx + 1] : blocks[idx - 1];
        if (!target) return;
        e.preventDefault();
        if (isEditableEl(target)) enterEdit(target, { mode: e.key === 'ArrowDown' ? 'start' : 'end' });
        else { selectBlock(target); positionGrip(target); }
        return;
      }
      // Esc：编辑 → 灰选中；灰选中 → 取消
      if (e.key === 'Escape') {
        if (editingEl) { const el = editingEl; exitEdit(); selectBlock(el); positionGrip(el); e.preventDefault(); e.stopPropagation(); return; }
        if (selectedEl) { deselect(); e.preventDefault(); e.stopPropagation(); return; }
      }
      // 灰选中态 Delete/Backspace → 删整块
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl && !editingEl) { e.preventDefault(); removeBlock(selectedEl); }
    }

    function onInput() { markDirty(); }
    function closeFmtPops() { fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; }); }
    function onSelectionChange() { closeFmtPops(); positionFmtbar(); } // 选区一动就收起开着的颜色/转为弹层（防指向旧状态）
    function onCompStart() { if (slash) { slash = null; slashMenu.style.display = 'none'; } } // IME 组词开始 → 关斜杠菜单，根除 query/DOM 漂移
    function onScroll() { if (selectedEl) positionGrip(selectedEl); else if (hoverEl) positionGrip(hoverEl); positionFmtbar(); if (blockMenu.style.display !== 'none') closeBlockMenu(); }

    // grip 交互
    grip.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const el = selectedEl || hoverEl; if (el) openBlockMenu(el); });
    grip.addEventListener('dragstart', (e) => { dragFrom = selectedEl || hoverEl; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'block'); } catch (x) {} } });
    grip.addEventListener('dragend', () => { dragFrom = null; clearDrop(); });
    function clearDrop() { const p = body.querySelector('[data-ws2-drop]'); if (p) p.removeAttribute('data-ws2-drop'); }
    function onDragOver(e) { if (!dragFrom) return; e.preventDefault(); const el = blockOf(e.target); if (!el || el === dragFrom) return; clearDrop(); el.setAttribute('data-ws2-drop', el.compareDocumentPosition(dragFrom) & Node.DOCUMENT_POSITION_PRECEDING ? 'bottom' : 'top'); }
    function onDrop(e) { if (!dragFrom) return; e.preventDefault(); const el = blockOf(e.target); if (el && el !== dragFrom) { const before = el.compareDocumentPosition(dragFrom) & Node.DOCUMENT_POSITION_PRECEDING; if (before) el.after(dragFrom); else el.before(dragFrom); if (undoMgr) undoMgr.checkpoint(); markDirty(); } clearDrop(); dragFrom = null; }

    buildFmtbar();
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('input', onInput);
    doc.addEventListener('selectionchange', onSelectionChange);
    doc.addEventListener('compositionstart', onCompStart);
    doc.addEventListener('scroll', onScroll, true);
    doc.addEventListener('dragover', onDragOver);
    doc.addEventListener('drop', onDrop);
    doc.documentElement.addEventListener('mouseleave', onDocLeave);

    function detach() {
      doc.documentElement.removeEventListener('mouseleave', onDocLeave);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('input', onInput);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('compositionstart', onCompStart);
      doc.removeEventListener('scroll', onScroll, true);
      doc.removeEventListener('dragover', onDragOver);
      doc.removeEventListener('drop', onDrop);
      exitEdit();
      [grip, fmtbar, blockMenu, slashMenu].forEach((n) => n.remove());
    }

    // 撤销/重做后 body.innerHTML 被整体重写，旧的元素引用全失效 → 清空状态、收起所有覆盖层。
    function reset() {
      slash = null; slashMenu.style.display = 'none';
      editingEl = null; selectedEl = null; hoverEl = null; dragFrom = null; fmtShown = false;
      blockRoot = pickBlockRoot(body); // undo/redo 重写了 body.innerHTML、重建了包裹节点 → 旧引用失效，重算
      if (blockRoot === body) body.setAttribute('data-ws2-canvas', ''); else body.removeAttribute('data-ws2-canvas');
      const s = body.querySelector('[data-ws2-selected]'); if (s) s.removeAttribute('data-ws2-selected');
      const d = body.querySelector('[data-ws2-drop]'); if (d) d.removeAttribute('data-ws2-drop');
      grip.style.display = 'none'; fmtbar.style.display = 'none'; closeBlockMenu();
    }

    return { detach, reset, reposition: () => { if (selectedEl) positionGrip(selectedEl); positionFmtbar(); } };
  }

  // ===== 注入到 iframe 的编辑器样式（ui-demo Canvas.css 移植；选择器既命中 .ws-* 也命中裸标签）=====
  const EDITOR_CSS = `
  [data-ws2-canvas] { max-width: 820px; margin: 0 auto; padding: 30px 56px 140px;
    font-family: -apple-system,"SF Pro Text",system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  [data-ws2-canvas] > h1, [data-ws2-canvas] > .ws-h1 { font-size:30px;font-weight:700;letter-spacing:-.01em;margin:8px 0 10px;line-height:1.3;color:#1c1d1f; }
  [data-ws2-canvas] > h2 { font-size:20px;font-weight:600;margin:26px 0 8px;line-height:1.3;color:#1c1d1f; }
  [data-ws2-canvas] > h3 { font-size:16px;font-weight:600;margin:20px 0 6px;line-height:1.3;color:#1c1d1f; }
  [data-ws2-canvas] > p { font-size:15px;line-height:1.75;color:#2b2d31;margin:6px 0; }
  [data-ws2-canvas] > ul, [data-ws2-canvas] > ol { margin:6px 0;padding-left:22px; }
  [data-ws2-canvas] > ul > li, [data-ws2-canvas] > ol > li { font-size:15px;line-height:1.7;color:#2b2d31;margin:3px 0; }
  [data-ws2-canvas] > ul > li { list-style:disc; }
  [data-ws2-canvas] > blockquote { border-left:3px solid #d3d6db;padding:2px 0 2px 16px;margin:10px 0;color:#5a5f66;font-size:15px; }
  [data-ws2-canvas] > .ws-callout { background:#f7f8fa;border:1px solid #e4e6e9;border-radius:7px;padding:14px 16px;margin:12px 0;font-size:14px;line-height:1.65;color:#5a5f66; }
  [data-ws2-canvas] > hr { border:none;border-top:1px solid #eceef0;margin:22px 0; }

  [contenteditable='true']{outline:none;}
  p[data-ws2-editing]:empty::before{content:'输入正文，或按 / 插入';color:#8a8f96;pointer-events:none;}
  /* 选中/编辑高亮只用 box-shadow + background（不影响布局），绝不用 padding/margin——否则 padding 把文字推右、
     而 margin 补偿会被 [data-ws2-canvas]>tag 的更高权重盖掉、补不回来，导致选中时文字右移几像素。 */
  [data-ws2-selected]:not([data-ws2-editing]){border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.16),0 0 0 6px rgba(0,0,0,.05);background:rgba(0,0,0,.03);}
  [data-ws2-editing]{border-radius:4px;background:rgba(0,0,0,.015);}
  [data-ws2-drop='top']{box-shadow:0 -2px 0 0 #1a73e8;}
  [data-ws2-drop='bottom']{box-shadow:0 2px 0 0 #1a73e8;}

  .ws-grip{align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;color:#8a8f96;cursor:grab;background:transparent;z-index:99998;}
  .ws-grip:hover{background:#f0f1f3;color:#5a5f66;}
  .ws-grip:active{cursor:grabbing;}

  .ws-fmtbar{align-items:center;gap:1px;height:32px;padding:0 4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:99999;font-family:-apple-system,system-ui,"PingFang SC",sans-serif;}
  .ws-fmtbar-btn{display:flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 5px;border:none;background:transparent;border-radius:3px;color:#5a5f66;font-size:12px;font-weight:500;cursor:pointer;}
  .ws-fmtbar-btn:hover{background:#f0f1f3;color:#1c1d1f;}
  .ws-fmtbar-text{font-size:12px;white-space:nowrap;}
  .ws-fmtbar-sep{width:1px;height:16px;background:#eceef0;margin:0 3px;display:inline-block;}
  .ws-fmtbar-aglyph{font-weight:700;text-decoration:underline;text-decoration-color:#1a73e8;text-underline-offset:2px;}
  .ws-fmtbar-ai{gap:4px;color:#1a73e8;font-size:12px;font-weight:500;}
  .ws-fmtbar-ai:hover{background:rgba(26,115,232,.08);}
  .ws-fmtbar-holder{position:relative;display:inline-flex;}
  .ws-fmtbar-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:100000;min-width:132px;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);}
  .ws-fmtbar-menu-item{display:block;width:100%;height:30px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-fmtbar-menu-item:hover{background:#f0f1f3;}
  .ws-fmtbar-swatches{position:absolute;top:calc(100% + 6px);left:0;z-index:100000;gap:4px;padding:7px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);}
  .ws-fmtbar-swatch{width:20px;height:20px;border-radius:3px;border:1px solid #e4e6e9;cursor:pointer;padding:0;}

  .ws-blockmenu{min-width:168px;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:100000;}
  .ws-blockmenu-item{display:flex;align-items:center;width:100%;height:32px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-blockmenu-item:hover{background:#f0f1f3;}
  .ws-blockmenu-danger{color:#d93025;}
  .ws-blockmenu-danger:hover{background:#fce8e6;}
  .ws-blockmenu-sep{height:1px;background:#eceef0;margin:4px 6px;}
  .ws-blockmenu-colors{display:flex;gap:5px;padding:5px 8px 3px;}
  .ws-blockmenu-swatch{width:18px;height:18px;border-radius:3px;border:1px solid #e4e6e9;cursor:pointer;padding:0;}

  .ws-slashmenu{min-width:184px;max-height:290px;overflow-y:auto;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:100000;}
  .ws-slashmenu-item{display:block;width:100%;height:32px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-slashmenu-item:hover,.ws-slashmenu-item.active{background:#f0f1f3;}
  .ws-slashmenu-empty{padding:8px 10px;font-size:12px;color:#8a8f96;}
  `;

  const api = { attach, classify, isEditableEl, pickBlockRoot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BlockEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
