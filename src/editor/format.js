(function (global) {
  // 这些纯 DOM 操作跟 Electron 解耦，可用 jsdom 单测（execCommand 类命令测不了，留给 e2e）。

  // 从某个节点往上走到第一个满足 pred 的祖先元素（到 body 为止，不含 body）。抽出来不依赖
  // selection，纯逻辑可单测。
  function climb(node, body, pred) {
    if (node && node.nodeType === 3) node = node.parentElement;
    while (node && node !== body && node.nodeType === 1) {
      if (pred(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function blockFromNode(node, body) {
    return climb(node, body, (el) => el.hasAttribute('data-ws2-block'));
  }

  function anchorFromNode(node, body) {
    return climb(node, body, (el) => el.tagName === 'A');
  }

  // 选区所在的「当前块」：从锚点往上走到最近的 [data-ws2-block]（顶层块或容器内的块）。
  // 供块操作（复制 / 上下移 / 删除）和标题下拉判定当前块类型用。
  function currentBlock(doc) {
    const sel = doc.getSelection && doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return blockFromNode(sel.anchorNode, doc.body);
  }

  // 选区所在的 <a>（光标落在链接里时返回它，用于改 / 拆链接）。
  function anchorAt(doc) {
    const sel = doc.getSelection && doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return anchorFromNode(sel.anchorNode, doc.body);
  }

  // 把选区内容包进一个带行内样式的 span（字号用——execCommand 的 fontSize 只认 1–7、给不了 px）。
  // 折叠选区不动。跨块的复杂选区按简单语义包（v1 取舍，字号主要用在块内文字段）。
  function wrapInlineStyle(doc, prop, value) {
    const sel = doc.getSelection && doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const span = doc.createElement('span');
    span.style[prop] = value;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const r = doc.createRange();
    r.selectNodeContents(span);
    sel.addRange(r);
    return true;
  }

  // 复制块：克隆并插到原块之后，返回克隆体。
  function duplicateBlock(block) {
    if (!block || !block.parentElement) return null;
    const clone = block.cloneNode(true);
    block.after(clone);
    return clone;
  }

  // 移动块：dir<0 上移、dir>0 下移，只在同级相邻块间换位（不钻进容器）。
  function moveBlock(block, dir) {
    if (!block) return false;
    if (dir < 0) {
      const prev = block.previousElementSibling;
      if (!prev) return false;
      prev.before(block);
      return true;
    }
    const next = block.nextElementSibling;
    if (!next) return false;
    next.after(block);
    return true;
  }

  const api = { currentBlock, anchorAt, blockFromNode, anchorFromNode, wrapInlineStyle, duplicateBlock, moveBlock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Format = api;
})(typeof window !== 'undefined' ? window : globalThis);
