(function (global) {
  // HVE_TextEdit 等价物：双击文字元素 → 该元素 contenteditable + 聚焦 + 编辑态标记；
  // Esc / 外点退出还原。文字编辑只在被选元素上局部进行（不再 body 级 contenteditable）。
  // contenteditable 是个属性、我们 toggle 它（KTD2 允许属性 toggle；样式只走 CSSOM，绝不
  // setAttribute('style')/<style>）。enter 时盖 data-ws2-ce（让 serialize 剥掉我们加的
  // contenteditable）+ data-ws2-editing（编辑态标记，U5 已登记进 WS2_MARKERS）。

  // 解析双击落点的编辑目标：从 node climb，先看是不是落在 <a>（用 WS2Format.anchorWithin），
  // 是则 {kind:'link'}；否则找最近的 WS2Format.isTextEditable 元素 {kind:'editable'}；都不是 none。
  function resolveEditTarget(node) {
    const fmt = global.WS2Format;
    let el = node;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || el.nodeType !== 1) return { kind: 'none' };
    // 先 climb 到最近的可编辑文字元素（含 <a>，A 在 isTextEditable 白名单里）
    let host = el;
    while (host && host.nodeType === 1) {
      if (fmt && fmt.isTextEditable(host)) break;
      host = host.parentElement;
    }
    if (!host || host.nodeType !== 1) return { kind: 'none' };
    const a = fmt ? fmt.anchorWithin(host) : null;
    if (a) return { kind: 'link', el: a };
    return { kind: 'editable', el: host };
  }

  function attach(doc, deps) {
    deps = deps || {};
    const onEnter = deps.onEnter || (() => {});
    const onExit = deps.onExit || (() => {});
    const openLinkDialog = deps.openLinkDialog || null;
    const markDirty = deps.markDirty || (() => {});

    let editingEl = null;

    function placeCaretEnd(el) {
      const sel = doc.getSelection && doc.getSelection();
      if (!sel) return;
      try {
        const r = doc.createRange();
        r.selectNodeContents(el);
        r.collapse(false); // 末尾
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {}
    }

    function enter(el) {
      if (!el || el.nodeType !== 1) return;
      if (editingEl && editingEl !== el) exit();
      if (editingEl === el) return;
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ws2-ce', '');      // 标记「这个 contenteditable 是我们加的」→ serialize 剥
      el.setAttribute('data-ws2-editing', '');  // 编辑态标记
      editingEl = el;
      if (el.focus) el.focus();
      placeCaretEnd(el);
      onEnter(el);
      // 不在 enter 标脏：进编辑还没改内容；真正的 markDirty 走 input（shell 接线）。
    }

    function exit() {
      if (!editingEl) return;
      const prev = editingEl;
      // 只摘我们加的 contenteditable：仅当当初是我们 stamp 的 data-ws2-ce 才移除属性。
      if (prev.hasAttribute('data-ws2-ce')) {
        prev.removeAttribute('contenteditable');
        prev.removeAttribute('data-ws2-ce');
      }
      prev.removeAttribute('data-ws2-editing');
      editingEl = null;
      onExit(prev);
    }

    function onDblClick(e) {
      const t = resolveEditTarget(e.target);
      if (t.kind === 'link') {
        if (openLinkDialog) { openLinkDialog(t.el); return; }
        // 没有 openLinkDialog 回调 → 把 <a> 当文字编辑（FALL THROUGH）。
        enter(t.el);
        return;
      }
      if (t.kind === 'editable') { enter(t.el); return; }
      // kind 'none' → 忽略
    }

    // Esc：capture 阶段 + stopPropagation，确保编辑态下先于 selection 的 Esc-选父跑（KTD7）。
    function onKeyDown(e) {
      if (e.key === 'Escape' && editingEl) {
        e.preventDefault();
        e.stopPropagation();
        exit();
      }
    }

    // 外点退出：mousedown / click 落在 editingEl 之外 → 退出。
    function onOutside(e) {
      if (editingEl && !editingEl.contains(e.target)) exit();
    }

    doc.addEventListener('dblclick', onDblClick);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('mousedown', onOutside);
    doc.addEventListener('click', onOutside);

    function detach() {
      doc.removeEventListener('dblclick', onDblClick);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('mousedown', onOutside);
      doc.removeEventListener('click', onOutside);
      exit();
    }

    return {
      detach,
      enter,
      exit,
      isEditing: () => !!editingEl,
      getEditingEl: () => editingEl,
    };
  }

  const api = { resolveEditTarget, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2TextEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
