(function (global) {
  // HVE_DragMove 等价物：抓被选元素自由拖到任意位置。首次拖动把它从文档流转成
  // position:absolute（钉住当前视觉框 left/top/width/height，防 reflow），拖动中实时改
  // left/top（CSSOM）。整次拖动经 undo 的 coalesce 收成一个操作级 op。
  // 这里只放纯几何（jsdom/node 可单测）+ 一个薄 DOM/事件驱动（attach），仿 format.js 的
  // 纯/DOM 拆分、draghandle.js 的阈值 + onMove/onUp 监听拆装。

  // ---- 纯几何 ----

  // 元素转绝对定位前，冻结它当前的视觉框：rect = el.getBoundingClientRect()，
  // parentRect = offsetParent 的 rect。返回相对 offsetParent 的 left/top + 当前宽高
  // （宽高钉住，避免转 absolute 后内容重排改变盒子尺寸）。
  function computeAbsolutePlacement(rect, parentRect) {
    return {
      left: rect.left - parentRect.left,
      top: rect.top - parentRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  // 在已冻结的 base 上叠加位移：返回新的 left/top（宽高不变，宽高在转换时已钉住）。
  function applyDelta(base, dx, dy) {
    return { left: base.left + dx, top: base.top + dy };
  }

  // 是否需要转成 absolute：static / '' / relative 需要转；已经 absolute / fixed 不转。
  function needsConversion(computedPosition) {
    const p = computedPosition || '';
    return p === 'static' || p === '' || p === 'relative';
  }

  // 方向键 → 位移 {dx, dy}（step = shift?10:1），非方向键返 null。nudge 与 drag 共用 applyDelta。
  function nudgeDelta(key, shift) {
    const step = shift ? 10 : 1;
    switch (key) {
      case 'ArrowLeft':  return { dx: -step, dy: 0 };
      case 'ArrowRight': return { dx: step, dy: 0 };
      case 'ArrowUp':    return { dx: 0, dy: -step };
      case 'ArrowDown':  return { dx: 0, dy: step };
      default: return null;
    }
  }

  // 冻结并把元素转成 absolute（若需要），返回基准 {left, top}。drag 首拖与 nudge 共用同一条转换路径。
  // needsConversion 时：computeAbsolutePlacement 钉视觉框 + CSSOM 写 position/left/top/width/height；
  // 否则读当前 inline left/top（缺省按 0）。绝不 setAttribute('style')（KTD2）。
  function ensureAbsolute(el, win, doc) {
    const cs = win.getComputedStyle(el);
    if (needsConversion(cs.position)) {
      const parent = el.offsetParent || doc.documentElement;
      const place = computeAbsolutePlacement(
        el.getBoundingClientRect(),
        parent.getBoundingClientRect()
      );
      el.style.width = place.width + 'px';
      el.style.height = place.height + 'px';
      el.style.position = 'absolute';
      el.style.left = place.left + 'px';
      el.style.top = place.top + 'px';
      return { left: place.left, top: place.top };
    }
    return { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 };
  }

  // ---- DOM / 事件驱动 ----

  const THRESHOLD = 4; // 像素阈值，沿用 draghandle.js 的小位移门限

  function attach(doc, deps) {
    deps = deps || {};
    const getSelectedEl = deps.getSelectedEl || (() => null);
    const isEditing = deps.isEditing || (() => false);
    const undoMgr = deps.undoMgr || null;
    const markDirty = deps.markDirty || (() => {});
    const win = deps.win || doc.defaultView;
    const guide = deps.guide || null; // HVE_AlignGuide：拖动中算对齐线 + 吸附（可选）

    function onMouseDown(e) {
      if (isEditing()) return; // 文字编辑态：mousedown 放光标，不启动拖动（KTD7 / R2 门）
      const el = getSelectedEl();
      if (!el || !el.contains || !el.contains(e.target)) return; // 只拖被选元素本身（含其内部点击点）

      const downAt = { x: e.clientX, y: e.clientY };
      let dragging = false;
      let base = null;       // 冻结后的 {left, top}（已是数字）
      let before = null;     // 转换/移动前的 el.style.cssText 快照
      let key = null;        // 稳定 coalesce key

      const onMove = (me) => {
        if (!dragging) {
          if (Math.abs(me.clientX - downAt.x) <= THRESHOLD && Math.abs(me.clientY - downAt.y) <= THRESHOLD) return;
          dragging = true;
          startDrag(el);
        }
        const dx = me.clientX - downAt.x;
        const dy = me.clientY - downAt.y;
        let next = applyDelta(base, dx, dy);
        // 对齐线 + 吸附：在写 left/top 前让 guide 调整拟落点（snap）+ 画线（in-doc CSSOM）
        if (guide) next = guide.update(el, next, win) || next;
        el.style.left = next.left + 'px'; // CSSOM，绝不 setAttribute('style')（KTD2）
        el.style.top = next.top + 'px';
        if (undoMgr) undoMgr.recordStyleOp(el, before, el.style.cssText, key);
        me.preventDefault(); // 抑制原生文本选区
      };

      const onUp = () => {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);
        if (guide) guide.clear(); // 收起对齐线
        if (dragging && undoMgr) undoMgr.commit(); // 整次拖动塌成一个 op（无净变化则丢弃）
        if (dragging) markDirty();
      };

      function startDrag(target) {
        // 在任何 mutation 之前抓 before（含可能本来就有的 inline style）
        before = target.style.cssText;
        key = 'move:' + stableKey(target);
        if (undoMgr) undoMgr.beginCoalesce(key);
        base = ensureAbsolute(target, win, doc); // 冻结+转绝对（与 nudge 共用，DRY）
      }

      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    }

    doc.addEventListener('mousedown', onMouseDown);

    function detach() {
      doc.removeEventListener('mousedown', onMouseDown);
    }

    return { detach };
  }

  // 稳定 coalesce key：优先用元素已有的 data-ws2-eid（canvas.ensureId 懒盖的持久句柄），
  // 没有就退回 tagName——同一次拖动里 el 不变，key 只需在这次拖动内稳定即可。
  function stableKey(el) {
    return (el.getAttribute && el.getAttribute('data-ws2-eid')) || (el.tagName || 'el');
  }

  const api = { computeAbsolutePlacement, applyDelta, needsConversion, nudgeDelta, ensureAbsolute, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Drag = api;
})(typeof window !== 'undefined' ? window : globalThis);
