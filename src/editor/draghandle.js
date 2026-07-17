(function (global) {
  // i18n：renderer 全局 t()（node/test 上下文无 wsT 时回退 key，防 require 期崩）。
  const T = (k, p) => (global.wsT ? global.wsT(k, p) : k);
  function attach(doc, undoMgr, markDirty) {
    const win = doc.defaultView;

    const handle = doc.createElement('div');
    handle.setAttribute('data-ws2-ui', '');
    handle.setAttribute('contenteditable', 'false');
    handle.textContent = '⋮⋮';
    handle.title = T('editor.dragHandleTip');
    handle.style.cssText = 'position:absolute;display:none;z-index:99998;cursor:grab;color:#bbb;font-size:14px;line-height:1;padding:4px;user-select:none;font-family:-apple-system,sans-serif;';
    doc.documentElement.appendChild(handle);

    const indicator = doc.createElement('div');
    indicator.setAttribute('data-ws2-ui', '');
    indicator.style.cssText = 'position:absolute;display:none;z-index:99998;height:2px;background:#1a73e8;pointer-events:none;';
    doc.documentElement.appendChild(indicator);

    const menu = doc.createElement('div');
    menu.setAttribute('data-ws2-ui', '');
    menu.setAttribute('contenteditable', 'false');
    menu.style.cssText = 'position:absolute;display:none;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;font-family:-apple-system,sans-serif;font-size:13px;';
    const del = doc.createElement('div');
    del.textContent = T('editor.deleteBlock');
    del.style.cssText = 'padding:6px 12px;border-radius:4px;cursor:pointer;color:#b3261e;';
    del.addEventListener('click', () => {
      if (current) { current.remove(); current = null; handle.style.display = 'none'; undoMgr.checkpoint(); markDirty(); }
      hideMenu();
    });
    menu.appendChild(del);
    doc.documentElement.appendChild(menu);

    const tip = doc.createElement('div');
    tip.setAttribute('data-ws2-ui', '');
    tip.textContent = T('editor.blockNotEditable');
    tip.style.cssText = 'position:absolute;display:none;z-index:99999;background:#333;color:#fff;font-size:12px;padding:3px 8px;border-radius:4px;font-family:-apple-system,sans-serif;pointer-events:none;';
    doc.documentElement.appendChild(tip);

    let current = null;
    let dragging = false;
    let pendingDrag = false;
    let dropTarget = null;
    let dropAfter = false;

    function hideMenu() { menu.style.display = 'none'; }

    function blockFromPoint(x, y) {
      let el = doc.elementFromPoint(x, y);
      while (el && el !== doc.body && el !== doc.documentElement) {
        if (el.hasAttribute && el.hasAttribute('data-ws2-block')) {
          const p = el.parentElement;
          if (p === doc.body || (p && p.hasAttribute('data-ws2-container'))) return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function positionHandle(block) {
      const r = block.getBoundingClientRect();
      handle.style.display = 'block';
      handle.style.left = (r.left + win.scrollX - 26) + 'px';
      handle.style.top = (r.top + win.scrollY + 2) + 'px';
    }

    doc.addEventListener('mousemove', (e) => {
      if (dragging) {
        const b = blockFromPoint(e.clientX, e.clientY);
        if (b && b !== current) {
          const r = b.getBoundingClientRect();
          dropAfter = e.clientY > r.top + r.height / 2;
          dropTarget = b;
          indicator.style.display = 'block';
          indicator.style.left = (r.left + win.scrollX) + 'px';
          indicator.style.width = r.width + 'px';
          indicator.style.top = ((dropAfter ? r.bottom : r.top) + win.scrollY - 1) + 'px';
        } else if (!b) {
          dropTarget = null;
          indicator.style.display = 'none';
        }
        return;
      }
      if (menu.style.display === 'block' || pendingDrag) return;
      const b = blockFromPoint(e.clientX, e.clientY);
      if (b) { current = b; positionHandle(b); }
      const lockedEl = e.target.closest && e.target.closest('[data-ws2-block="locked"]');
      if (lockedEl) {
        tip.style.display = 'block';
        tip.style.left = (e.clientX + win.scrollX + 12) + 'px';
        tip.style.top = (e.clientY + win.scrollY + 12) + 'px';
      } else {
        tip.style.display = 'none';
      }
    });

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const downAt = { x: e.clientX, y: e.clientY };
      dragging = false;
      pendingDrag = true;
      const onMove = (me) => {
        if (!dragging && (Math.abs(me.clientX - downAt.x) > 4 || Math.abs(me.clientY - downAt.y) > 4)) {
          dragging = true;
          handle.style.cursor = 'grabbing';
          if (current) current.style.opacity = '0.4';
        }
      };
      const onUp = () => {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        pendingDrag = false;
        if (current) {
          current.style.opacity = '';
          if (current.getAttribute('style') === '') current.removeAttribute('style');
        }
        indicator.style.display = 'none';
        handle.style.cursor = 'grab';
        if (dragging) {
          if (dropTarget && current && dropTarget !== current) {
            if (dropAfter) { dropTarget.after(current); } else { dropTarget.before(current); }
            undoMgr.checkpoint();
            markDirty();
            positionHandle(current);
          }
          dragging = false;
          dropTarget = null;
        } else {
          const r = handle.getBoundingClientRect();
          menu.style.display = 'block';
          menu.style.left = (r.left + win.scrollX) + 'px';
          menu.style.top = (r.bottom + win.scrollY + 4) + 'px';
        }
      };
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    });

    doc.addEventListener('mousedown', (e) => {
      if (menu.style.display === 'block' && !menu.contains(e.target) && e.target !== handle) hideMenu();
    });

    win.addEventListener('scroll', () => {
      handle.style.display = 'none';
      hideMenu();
    }, { passive: true });
  }

  const api = { attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2DragHandle = api;
})(typeof window !== 'undefined' ? window : globalThis);
