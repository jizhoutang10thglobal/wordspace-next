(function (global) {
  const TEXT_COLORS = ['#1a1a1a', '#888888', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2'];
  const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff'];

  function attach(doc, undoMgr, markDirty) {
    const bar = doc.createElement('div');
    bar.setAttribute('data-ws2-ui', '');
    bar.setAttribute('contenteditable', 'false');
    bar.style.cssText = 'position:fixed;display:none;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;font-family:-apple-system,sans-serif;font-size:13px;white-space:nowrap;';
    doc.documentElement.appendChild(bar);

    function hidePalettes() {
      bar.querySelectorAll('[data-ws2-palette]').forEach(p => { p.style.display = 'none'; });
    }

    function btn(label, title, fn) {
      const b = doc.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText = 'border:none;background:none;padding:4px 8px;cursor:pointer;font-size:13px;';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { fn(); undoMgr.checkpoint(); markDirty(); hidePalettes(); });
      return b;
    }

    function palette(label, title, colors, cmd) {
      const holder = doc.createElement('span');
      holder.style.cssText = 'position:relative;display:inline-block;';
      const openBtn = doc.createElement('button');
      openBtn.textContent = label;
      openBtn.title = title;
      openBtn.style.cssText = 'border:none;background:none;padding:4px 8px;cursor:pointer;font-size:13px;';
      const pop = doc.createElement('div');
      pop.setAttribute('data-ws2-palette', '');
      pop.style.cssText = 'position:absolute;top:100%;left:0;display:none;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;width:120px;';
      for (const c of colors) {
        const sw = doc.createElement('button');
        sw.title = c;
        sw.style.cssText = 'width:18px;height:18px;border:1px solid #ccc;border-radius:3px;cursor:pointer;margin:2px;background:' + c + ';';
        sw.addEventListener('mousedown', (e) => e.preventDefault());
        sw.addEventListener('click', () => {
          doc.execCommand(cmd, false, c);
          undoMgr.checkpoint(); markDirty(); hidePalettes();
        });
        pop.appendChild(sw);
      }
      const clear = doc.createElement('button');
      clear.textContent = '清除';
      clear.style.cssText = 'border:none;background:none;font-size:12px;cursor:pointer;display:block;margin-top:4px;color:#666;';
      clear.addEventListener('mousedown', (e) => e.preventDefault());
      clear.addEventListener('click', () => {
        doc.execCommand(cmd, false, cmd === 'hiliteColor' ? 'transparent' : '#1a1a1a');
        undoMgr.checkpoint(); markDirty(); hidePalettes();
      });
      pop.appendChild(clear);
      openBtn.addEventListener('mousedown', (e) => e.preventDefault());
      openBtn.addEventListener('click', () => {
        const showing = pop.style.display !== 'none';
        hidePalettes();
        pop.style.display = showing ? 'none' : 'block';
      });
      holder.append(openBtn, pop);
      return holder;
    }

    const boldBtn = btn('', '加粗 Cmd+B', () => doc.execCommand('bold'));
    const boldLabel = doc.createElement('b');
    boldLabel.textContent = 'B';
    boldBtn.appendChild(boldLabel);
    bar.appendChild(boldBtn);
    bar.appendChild(btn('I', '斜体 Cmd+I', () => doc.execCommand('italic')));
    bar.appendChild(btn('U', '下划线 Cmd+U', () => doc.execCommand('underline')));
    bar.appendChild(btn('S', '删除线', () => doc.execCommand('strikeThrough')));
    bar.appendChild(palette('A', '文字颜色', TEXT_COLORS, 'foreColor'));
    bar.appendChild(palette('🖍', '背景高亮', HILITE_COLORS, 'hiliteColor'));
    bar.appendChild(btn('清除格式', '移除行内格式', () => doc.execCommand('removeFormat')));

    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { bar.style.display = 'none'; hidePalettes(); return; }
      const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (!node || !doc.body.contains(node) || node.closest('[data-ws2-block="locked"]') || node.closest('[data-ws2-ui]')) {
        bar.style.display = 'none';
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { bar.style.display = 'none'; return; }
      bar.style.display = 'block';
      bar.style.left = Math.max(8, rect.left) + 'px';
      bar.style.top = Math.max(8, rect.top - bar.offsetHeight - 8) + 'px';
    });
  }

  const api = { attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Toolbar = api;
})(typeof window !== 'undefined' ? window : globalThis);
