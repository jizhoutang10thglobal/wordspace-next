(function (global) {
  const ITEMS = [
    { label: '标题 1', kw: 'h1 biaoti', run: (doc) => doc.execCommand('formatBlock', false, 'h1') },
    { label: '标题 2', kw: 'h2 biaoti', run: (doc) => doc.execCommand('formatBlock', false, 'h2') },
    { label: '标题 3', kw: 'h3 biaoti', run: (doc) => doc.execCommand('formatBlock', false, 'h3') },
    { label: '正文', kw: 'p text zhengwen', run: (doc) => doc.execCommand('formatBlock', false, 'p') },
    { label: '无序列表', kw: 'ul list liebiao', run: (doc) => doc.execCommand('insertUnorderedList') },
    { label: '有序列表', kw: 'ol list liebiao', run: (doc) => doc.execCommand('insertOrderedList') },
    { label: '分隔线', kw: 'hr divider fengexian', run: (doc) => doc.execCommand('insertHorizontalRule') }
  ];

  function attach(doc, undoMgr, markDirty) {
    const menu = doc.createElement('div');
    menu.setAttribute('data-ws2-ui', '');
    menu.setAttribute('contenteditable', 'false');
    menu.style.cssText = 'position:fixed;display:none;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;min-width:140px;font-family:-apple-system,sans-serif;font-size:13px;';
    doc.documentElement.appendChild(menu);

    let open = false;
    let query = '';
    let active = 0;

    function close() { open = false; query = ''; active = 0; menu.style.display = 'none'; }

    function visibleItems() {
      const q = query.toLowerCase();
      return ITEMS.filter(it => !q || it.label.includes(q) || it.kw.includes(q));
    }

    function render() {
      const items = visibleItems();
      if (items.length === 0) { close(); return; }
      if (active >= items.length) active = 0;
      menu.innerHTML = '';
      items.forEach((it, i) => {
        const row = doc.createElement('div');
        row.textContent = it.label;
        row.style.cssText = 'padding:6px 10px;border-radius:4px;cursor:pointer;' + (i === active ? 'background:#f0f0f0;' : '');
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => apply(it));
        menu.appendChild(row);
      });
    }

    function deleteTyped() {
      const sel = doc.getSelection();
      for (let i = 0; i < query.length + 1; i++) sel.modify('extend', 'backward', 'character');
      doc.execCommand('delete');
    }

    function apply(item) {
      const win = doc.defaultView;
      const sx = win.scrollX;
      const sy = win.scrollY;
      deleteTyped();
      item.run(doc);
      undoMgr.checkpoint();
      markDirty();
      close();
      // Chromium 在长文档里执行块命令后会异常滚动视口（与光标位置无关），钉住原位置约半秒
      const until = Date.now() + 600;
      (function pin() {
        if (win.scrollY !== sy || win.scrollX !== sx) win.scrollTo(sx, sy);
        if (Date.now() < until) win.requestAnimationFrame(pin);
      })();
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
          if (!el || !el.closest('[data-ws2-block="text"], li')) return;
          open = true; query = ''; active = 0;
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

  const api = { attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Slash = api;
})(typeof window !== 'undefined' ? window : globalThis);
