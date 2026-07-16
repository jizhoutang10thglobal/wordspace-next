(function (global) {
  // '/' 快捷入口的「桥」：每个条目的动作走 WS2Insert Flow 工厂 + WS2Format.retagElement，
  // 与「+ 插入」面板共用同一条 flow-insert 码路（不再走旧的浏览器命令插入）。bridge 是纯 DOM、
  // 取 (doc, block) 参数，jsdom 可单测；run 处理器只负责把它接上斜杠菜单的 deleteTyped/光标解析。

  // i18n：renderer 全局 t()（node/test 上下文无 wsT 时回退 key，防 require 期崩）。
  const T = (k, p) => (global.wsT ? global.wsT(k, p) : k);

  function getFormat() { return global.WS2Format; }
  function getInsert() { return global.WS2Insert; }

  // 光标当前块：从选区锚点往上爬到最近的块级元素（画布模型已退役 data-ws2-block 标记，
  // 用 format.nearestBlock 的标签判定）。
  function caretBlock(doc) {
    const fmt = getFormat();
    const sel = doc.getSelection && doc.getSelection();
    if (!fmt || !sel || sel.rangeCount === 0) return null;
    return fmt.nearestBlock(sel.anchorNode, doc.body);
  }

  // 块是否「空」：没有非空白文字（用于 list/hr 决定替换当前块还是插在其后）。
  function isEmptyBlock(block) {
    return !block || !block.textContent || block.textContent.trim() === '';
  }

  // 标题/正文：块类型转换——把 '/' 所在的块原地换标签（heyhtml 语义）。
  function retagBlock(doc, block, tag) {
    if (!block) return null;
    return getFormat().retagElement(block, tag);
  }

  // list/hr：造元素 + 落进文档流。当前块空 → 替换它（删空块、在原位插）；否则插在其后。
  function insertFlowElement(doc, block, makeEl) {
    const el = makeEl(doc);
    if (!el) return null;
    if (block && isEmptyBlock(block) && block.parentNode) {
      block.replaceWith(el);
    } else {
      getInsert().placeFlow(doc, el, block);
    }
    return el;
  }

  function makeUl(doc) { return getInsert().createElement(doc, 'list'); }
  // ol：复用 list 工厂（ul + 3 个 li + inline 样式）再换标签成 ol，避免重复列表样式来源。
  function makeOl(doc) {
    const ul = getInsert().createElement(doc, 'list');
    if (!ul) return null;
    const ol = doc.createElement('ol');
    ol.style.cssText = ul.style.cssText;
    while (ul.firstChild) ol.appendChild(ul.firstChild);
    return ol;
  }
  function makeHr(doc) { return getInsert().createElement(doc, 'divider'); }

  const ITEMS = [
    // run 接 (doc, block)：block 由 apply() 在 deleteTyped 扰动选区**之前**解析好传进来，
    // 否则 deleteTyped 的 sel.modify/deleteContents 会把选区弄到块外、caretBlock 取不到块。
    // labelKey 走 editor 命名空间、展示/过滤时 t() 解析；kw 是拼音/英文检索词（内部、不展示，不翻）。
    { labelKey: 'blockH1', kw: 'h1 biaoti', run: (doc, block) => retagBlock(doc, block, 'h1') },
    { labelKey: 'blockH2', kw: 'h2 biaoti', run: (doc, block) => retagBlock(doc, block, 'h2') },
    { labelKey: 'blockH3', kw: 'h3 biaoti', run: (doc, block) => retagBlock(doc, block, 'h3') },
    { labelKey: 'blockText', kw: 'p text zhengwen', run: (doc, block) => retagBlock(doc, block, 'p') },
    { labelKey: 'blockBulletList', kw: 'ul list liebiao', run: (doc, block) => insertFlowElement(doc, block, makeUl) },
    { labelKey: 'blockOrderedList', kw: 'ol list liebiao', run: (doc, block) => insertFlowElement(doc, block, makeOl) },
    { labelKey: 'blockDivider', kw: 'hr divider fengexian', run: (doc, block) => insertFlowElement(doc, block, makeHr) }
  ];
  const itemLabel = (it) => T('editor.' + it.labelKey);

  function attach(doc, undoMgr, markDirty) {
    const menu = doc.createElement('div');
    menu.setAttribute('data-ws2-ui', '');
    menu.setAttribute('contenteditable', 'false');
    menu.style.cssText = 'position:fixed;display:none;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;min-width:140px;font-family:-apple-system,sans-serif;font-size:13px;';
    doc.documentElement.appendChild(menu);

    let open = false;
    let query = '';
    let active = 0;
    let triggerBlock = null; // '/' 弹菜单那刻光标所在的块——在选区可能漂走前存好，apply 用它

    function close() { open = false; query = ''; active = 0; triggerBlock = null; menu.style.display = 'none'; }

    function visibleItems() {
      const q = query.toLowerCase();
      // itemLabel 现在可能是英文(如 'Heading 1')——大小写不敏感匹配,否则英文界面按显示名整词搜索失效(对齐 blockedit.filterSlash)。
      return ITEMS.filter(it => !q || itemLabel(it).toLowerCase().includes(q) || it.kw.includes(q));
    }

    function render() {
      const items = visibleItems();
      if (items.length === 0) { close(); return; }
      if (active >= items.length) active = 0;
      menu.innerHTML = '';
      items.forEach((it, i) => {
        const row = doc.createElement('div');
        row.textContent = itemLabel(it);
        row.style.cssText = 'padding:6px 10px;border-radius:4px;cursor:pointer;' + (i === active ? 'background:#f0f0f0;' : '');
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => apply(it));
        menu.appendChild(row);
      });
    }

    function deleteTyped() {
      const sel = doc.getSelection();
      // 把光标向后选中 '/query'（含触发的 '/'）再删——用 Range API，不再走旧浏览器命令（已退役）。
      for (let i = 0; i < query.length + 1; i++) sel.modify('extend', 'backward', 'character');
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        sel.removeAllRanges();
        sel.addRange(range); // range 删后塌缩到删除点，光标留在该块内
      }
    }

    function apply(item) {
      const block = triggerBlock || caretBlock(doc); // 优先用菜单弹出时存的块（选区可能已漂走）
      deleteTyped();
      item.run(doc, block);
      undoMgr.checkpoint();
      markDirty();
      close();
    }

    function caretRect() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0).cloneRange();
      const rects = r.getClientRects();
      if (rects.length) return rects[0];
      const node = r.startContainer;
      return node.nodeType === 1 ? node.getBoundingClientRect() : (node.parentElement ? node.parentElement.getBoundingClientRect() : null);
    }

    doc.addEventListener('keydown', (e) => {
      if (!open) {
        if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
          const sel = doc.getSelection();
          const node = sel && sel.anchorNode;
          const el = node && (node.nodeType === 1 ? node : node.parentElement);
          // 画布模型不再标 data-ws2-block：改成「光标在可编辑文字元素内」判定（沿 DOM 往上找）。
          const fmt = global.WS2Format;
          let host = el;
          while (host && host !== doc.body && !(fmt && fmt.isTextEditable(host))) host = host.parentElement;
          if (!host || host === doc.body) return;
          open = true; query = ''; active = 0;
          triggerBlock = (fmt && fmt.nearestBlock(node, doc.body)) || host; // 选区还在块里时存好块
          setTimeout(() => {
            const rect = caretRect();
            if (!rect) { close(); return; }
            menu.style.display = 'block';
            menu.style.left = rect.left + 'px';
            menu.style.top = (rect.bottom + 6) + 'px';
            render();
          }, 0);
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const items = visibleItems(); if (items[active]) apply(items[active]); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active++; render(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); return; }
      if (e.key === 'Backspace') {
        if (query.length === 0) { close(); return; }
        query = query.slice(0, -1);
        setTimeout(render, 0);
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        query += e.key;
        setTimeout(render, 0);
      }
    });

    doc.addEventListener('mousedown', (e) => {
      if (open && !menu.contains(e.target)) close();
    });
  }

  const api = { attach, caretBlock, isEmptyBlock, retagBlock, insertFlowElement, makeUl, makeOl, makeHr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Slash = api;
})(typeof window !== 'undefined' ? window : globalThis);
