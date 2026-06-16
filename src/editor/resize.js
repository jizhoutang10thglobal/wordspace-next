(function (global) {
  // HVE_Resize：元素选中时渲染 8 个 in-doc 手柄（data-ws2-ui），拖手柄经 WS2ResizeGeom.computeResize
  // 实时改宽高；西/北手柄还要平移 left/top（右/下边固定、左/上边跟着缩）。整次缩放一个 undo op
  // （beginCoalesce/commit，KTD3），手柄走 CSSOM、不入存盘（KTD2）。
  // 纯逻辑 originShift 可 node:test 单测；attach 是薄 DOM/事件驱动，复用 WS2Drag.ensureAbsolute。

  // ---- 纯几何 ----

  // 缩放后元素原点的平移：西边手柄(x===0) 固定右边、左边随宽变化 → left = start.left + (start.width - size.width)；
  // 北边手柄(y===0) 固定下边、上边随高变化 → top = start.top + (start.height - size.height)。
  // 东/南手柄不动原点（left/top 保持 start）。computeResize 已在 U3 单测，这里只测原点平移。
  function originShift(handle, start, size) {
    const west = handle && handle.x === 0;
    const north = handle && handle.y === 0;
    return {
      left: west ? start.left + (start.width - size.width) : start.left,
      top: north ? start.top + (start.height - size.height) : start.top,
    };
  }

  // ---- DOM / 事件驱动（in-doc CSSOM，KTD2）----

  function attach(doc, deps) {
    deps = deps || {};
    const getSelectedEl = deps.getSelectedEl || (() => null);
    const undoMgr = deps.undoMgr || null;
    const markDirty = deps.markDirty || (() => {});
    const win = deps.win || doc.defaultView;
    const geom = (typeof WS2ResizeGeom !== 'undefined') ? WS2ResizeGeom
      : (typeof require !== 'undefined' ? require('./resize-geom.js') : null);
    const drag = (typeof WS2Drag !== 'undefined') ? WS2Drag
      : (typeof require !== 'undefined' ? require('./dragmove.js') : null);

    // 8 个手柄节点：与几何 HANDLES 一一对应。每个挂自己的 mousedown（拖动起点）。
    const handles = geom.HANDLES.map((descriptor) => {
      const node = doc.createElement('div');
      node.setAttribute('data-ws2-ui', '');
      node.setAttribute('contenteditable', 'false');
      node.style.position = 'absolute';
      node.style.display = 'none';
      node.style.width = '10px';
      node.style.height = '10px';
      node.style.marginLeft = '-5px'; // 把 10px 方块的中心对准 rect 角/边点
      node.style.marginTop = '-5px';
      node.style.boxSizing = 'border-box';
      node.style.background = '#fff';
      node.style.border = '1px solid #ff5a5f';
      node.style.borderRadius = '2px';
      node.style.cursor = descriptor.cursor;
      node.style.zIndex = '99999';
      // 手柄是交互节点（NOT pointer-events:none）：要接 mousedown 启动缩放
      node.addEventListener('mousedown', (e) => onHandleDown(e, descriptor));
      doc.documentElement.appendChild(node);
      return { descriptor, node };
    });

    function hideAll() {
      for (const h of handles) h.node.style.display = 'none';
    }

    // 把手柄定位到 el rect 的角/边点（文档坐标 = 视口 rect + scroll，跟随滚动免费）。
    function render() {
      const el = getSelectedEl();
      if (!el) { hideAll(); return; }
      const r = el.getBoundingClientRect();
      const sx = (win && win.scrollX) || 0;
      const sy = (win && win.scrollY) || 0;
      for (const h of handles) {
        const d = h.descriptor;
        h.node.style.left = (r.left + sx + d.x * r.width) + 'px';
        h.node.style.top = (r.top + sy + d.y * r.height) + 'px';
        h.node.style.display = 'block';
      }
    }

    function clear() { hideAll(); }

    function onHandleDown(e, descriptor) {
      e.stopPropagation();  // 别让 dragmove/selection 的 doc 级 mousedown 跟着反应
      e.preventDefault();
      const el = getSelectedEl();
      if (!el) return;
      drag.ensureAbsolute(el, win, doc); // 钉住绝对定位 + left/top/width/height
      const start = {
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        width: parseFloat(el.style.width) || 0,
        height: parseFloat(el.style.height) || 0,
      };
      const before = el.style.cssText; // 缩放前快照（合并 op 的 before）
      const key = 'resize:' + descriptor.id;
      if (undoMgr) undoMgr.beginCoalesce(key);
      const downAt = { x: e.clientX, y: e.clientY };

      const onMove = (me) => {
        const dx = me.clientX - downAt.x;
        const dy = me.clientY - downAt.y;
        const size = geom.computeResize(descriptor, { width: start.width, height: start.height }, dx, dy, { min: 8 });
        el.style.width = size.width + 'px';  // CSSOM（KTD2）
        el.style.height = size.height + 'px';
        const o = originShift(descriptor, start, size);
        if (descriptor.x === 0) el.style.left = o.left + 'px'; // 西边：右边固定、左边随宽缩
        if (descriptor.y === 0) el.style.top = o.top + 'px';   // 北边：下边固定、上边随高缩
        if (undoMgr) undoMgr.recordStyleOp(el, before, el.style.cssText, key);
        render(); // 手柄跟着正在缩放的盒子走
        me.preventDefault();
      };

      const onUp = () => {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        if (undoMgr) undoMgr.commit(); // 整次缩放塌成一个 op（无净变化则丢弃）
        markDirty();
      };

      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    }

    function detach() {
      for (const h of handles) h.node.remove();
      handles.length = 0;
    }

    return { render, clear, detach };
  }

  const api = { originShift, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Resize = api;
})(typeof window !== 'undefined' ? window : globalThis);
