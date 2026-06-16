(function (global) {
  // HVE_Selector 等价物：命中测试 + 选父 + in-doc CSSOM 选中/悬停框。取代 blocks.js 的推断块分类
  // 成为交互核。选中态只存在 controller（WS2Canvas）闭包里，绝不污染存盘。覆盖框是独立的
  // [data-ws2-ui] 节点，serialize 走节点删除路径剥掉。

  // 从一个节点往上走到第一个满足 pred 的祖先元素（到 body 为止，不含 body）。format.climb 的
  // 等价物——format.js 没把它 export 出来，这里内联一份（纯逻辑、可单测）。
  function climb(node, body, pred) {
    if (node && node.nodeType === 3) node = node.parentElement;
    while (node && node !== body && node.nodeType === 1) {
      if (pred(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  // 命中测试：elementFromPoint 拿到点下节点，若落在 [data-ws2-ui] 覆盖节点上（或其内部），
  // 先爬出 UI 层；再 climb 到 body 下最近的可选元素（不是 body、不是 UI 节点）。命中空白返 null。
  function hitTest(doc, x, y) {
    let node = doc.elementFromPoint(x, y);
    if (!node) return null;
    // 爬出 data-ws2-ui 覆盖层：覆盖节点本身或其后代都不可选
    while (node && node.nodeType === 1 && node.closest && node.closest('[data-ws2-ui]')) {
      node = node.closest('[data-ws2-ui]').parentElement;
    }
    return climbSelectable(doc, node);
  }

  // 从一个节点 climb 到 body 下最近的可选元素：跳过 body / documentElement / UI 节点。
  function climbSelectable(doc, node) {
    const body = doc.body;
    return climb(node, body, (el) =>
      el !== body
      && el !== doc.documentElement
      && !el.hasAttribute('data-ws2-ui')
    );
  }

  // Esc 选父：返回 el.parentElement，到 body（或 body 外）即返 null = 取消选中（选父到顶）。
  function parentOf(el, body) {
    if (!el) return null;
    const p = el.parentElement;
    if (!p || p === body) return null;
    return p;
  }

  function attach(doc, controller, opts) {
    opts = opts || {};
    const onSelect = opts.onSelect || (() => {});
    const refresh = opts.refresh || (() => {});
    const win = doc.defaultView;

    // ---- in-doc CSSOM 覆盖框（KTD2：只用 el.style.x=，绝不 setAttribute('style')/<style>）----
    function makeBox(border) {
      const box = doc.createElement('div');
      box.setAttribute('data-ws2-ui', '');
      box.setAttribute('contenteditable', 'false');
      box.style.position = 'absolute';
      box.style.display = 'none';
      box.style.pointerEvents = 'none';
      box.style.boxSizing = 'border-box';
      box.style.border = border;
      box.style.zIndex = '99997';
      doc.documentElement.appendChild(box);
      return box;
    }
    const selBox = makeBox('2px solid #ff5a5f');   // 实线 coral/accent 选中框
    const hoverBox = makeBox('1px dashed #ff5a5f'); // 虚线悬停框

    function positionBox(box, el) {
      if (!el) { box.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      box.style.left = (r.left + win.scrollX) + 'px';
      box.style.top = (r.top + win.scrollY) + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      box.style.display = 'block';
    }

    function renderOverlay() {
      const st = controller.getState();
      positionBox(selBox, st.selectedEl);
      // 悬停框：无悬停 / 悬停即选中元素时隐藏（避免叠在实线框上）
      if (st.hoverEl && st.hoverEl !== st.selectedEl) positionBox(hoverBox, st.hoverEl);
      else hoverBox.style.display = 'none';
    }

    function select(el) {
      controller.select(el || null);
      onSelect(el || null);
      renderOverlay();
      refresh();
      return el || null;
    }

    function deselect() {
      controller.deselect();
      onSelect(null);
      renderOverlay();
      refresh();
    }

    function selectParent() {
      const cur = controller.getState().selectedEl;
      if (!cur) return;
      const p = parentOf(cur, doc.body);
      if (p) select(p);
      else deselect(); // 到顶 → 取消选中
    }

    function current() { return controller.getState().selectedEl; }

    // ---- 监听器 ----
    function onMouseMove(e) {
      const el = hitTest(doc, e.clientX, e.clientY);
      controller.hover(el);
      renderOverlay();
    }

    function onClick(e) {
      // climb 跳过 data-ws2-ui（点到自家覆盖框时不算点中元素）
      const el = climbSelectable(doc, e.target);
      if (el) select(el);
      else deselect(); // 点裸 body / 空白 → 取消
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (!controller.getState().selectedEl) return; // 没选中时不拦 Esc
        selectParent();
        e.preventDefault();
        e.stopPropagation(); // 别再触发 shell 的全局 Esc
      }
    }

    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKeyDown, true);

    function detach() {
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('keydown', onKeyDown, true);
      selBox.remove();
      hoverBox.remove();
    }

    return { select, selectParent, deselect, current, detach };
  }

  const api = { hitTest, parentOf, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Selection = api;
})(typeof window !== 'undefined' ? window : globalThis);
