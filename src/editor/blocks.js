(function (global) {
  const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
  const LIST_TAGS = new Set(['UL', 'OL']);
  const CONTAINER_TAGS = new Set(['DIV', 'MAIN', 'ARTICLE', 'SECTION']);
  // 内联文字元素：div 直接含这些（或直接含文字节点）时，应当作可编辑文本块，而不是锁死。
  const INLINE_TEXT_TAGS = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'U', 'S', 'STRIKE', 'CODE',
    'MARK', 'SMALL', 'SUB', 'SUP', 'FONT', 'BR', 'LABEL', 'ABBR', 'CITE', 'Q', 'TIME', 'INS', 'DEL',
    'KBD', 'SAMP', 'VAR', 'BDI', 'BDO']);

  function hasBlockDescendant(el) {
    for (const c of el.children) {
      if (TEXT_TAGS.has(c.tagName) || LIST_TAGS.has(c.tagName)) return true;
      if (CONTAINER_TAGS.has(c.tagName) && hasBlockDescendant(c)) return true;
    }
    return false;
  }

  // div/section 直接含非空白文字、或直接含内联文字元素 → 它本身是可编辑文本，不该锁死。
  function hasDirectText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return true;
      if (n.nodeType === 1 && INLINE_TEXT_TAGS.has(n.tagName)) return true;
    }
    return false;
  }

  function classify(el) {
    if (TEXT_TAGS.has(el.tagName)) return 'text';
    if (LIST_TAGS.has(el.tagName)) return 'list';
    if (el.tagName === 'HR') return 'divider';
    if (CONTAINER_TAGS.has(el.tagName)) {
      if (hasBlockDescendant(el)) return 'container';   // 含块级子元素 → 容器，descend 进去逐块标
      if (hasDirectText(el)) return 'text';             // 直接含文字/内联 → 当文本块，可编辑可拖（修复误锁）
      // 否则只含锁定结构（表格/图片）或空 → locked（整块可拖可删、内部不可编辑）
    }
    return 'locked';
  }

  function markBlocks(parent) {
    for (const el of parent.children) {
      if (el.hasAttribute('data-ws2-ui')) continue;
      const kind = classify(el);
      if (kind === 'container') {
        el.setAttribute('data-ws2-container', '');
        markBlocks(el);
        continue;
      }
      el.setAttribute('data-ws2-block', kind);
      if (kind === 'locked' && !el.hasAttribute('contenteditable')) {
        el.setAttribute('contenteditable', 'false');
        el.setAttribute('data-ws2-ce', '');
      }
    }
  }

  function applyEditable(doc) {
    doc.body.setAttribute('contenteditable', 'true');
    doc.body.setAttribute('data-ws2-ce', '');
    doc.body.setAttribute('spellcheck', 'false');
    doc.body.setAttribute('data-ws2-sc', '');
    markBlocks(doc.body);
  }

  const api = { applyEditable, markBlocks, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Blocks = api;
})(typeof window !== 'undefined' ? window : globalThis);
