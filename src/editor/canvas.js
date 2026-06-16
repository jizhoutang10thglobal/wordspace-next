(function (global) {
  // HVE_Core 等价物：画布控制器。取代 blocks.js applyEditable 作为 edit 模式入口。
  // enable() 只做 doc 级的「进入编辑」标记，**不**把 body 设成 contenteditable——body 级
  // contenteditable 的块流模型在退役，文字编辑改成 U7 的 per-element。选中/悬停态存在闭包变量
  // 里（指真实元素 ref，绝不序列化）；需要跨快照的持久句柄时 ensureId 懒盖 data-ws2-eid。

  function create(doc, opts) {
    opts = opts || {};
    const undoMgr = opts.undoMgr || null;
    const markDirty = opts.markDirty || (() => {});

    let enabled = false;
    let selectedEl = null; // 真实元素 ref，不序列化
    let hoverEl = null;

    function enable() {
      if (enabled) return; // 幂等
      doc.body.setAttribute('data-ws2-canvas', '');
      doc.body.setAttribute('spellcheck', 'false');
      doc.body.setAttribute('data-ws2-sc', '');
      enabled = true;
    }

    function disable() {
      if (!enabled) return;
      doc.body.removeAttribute('data-ws2-canvas');
      selectedEl = null;
      hoverEl = null;
      enabled = false;
    }

    // 懒盖持久句柄：只在被操作的元素上盖 data-ws2-eid（白名单内、存盘剥）。已有就复用。
    function ensureId(el) {
      if (!el || el.nodeType !== 1) return null;
      let id = el.getAttribute('data-ws2-eid');
      if (!id) {
        id = 'e' + (++ensureId._n);
        el.setAttribute('data-ws2-eid', id);
      }
      return id;
    }
    ensureId._n = 0;

    function select(el) { selectedEl = el || null; return selectedEl; }
    function hover(el) { hoverEl = el || null; return hoverEl; }
    function deselect() { selectedEl = null; }

    function getState() {
      return { enabled, selectedEl, hoverEl };
    }

    function destroy() {
      disable();
    }

    return { enable, disable, getState, select, hover, deselect, ensureId, destroy,
      get undoMgr() { return undoMgr; }, get markDirty() { return markDirty; } };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Canvas = api;
})(typeof window !== 'undefined' ? window : globalThis);
