(function (global) {
  const TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
  const LIST_TAGS = new Set(['UL', 'OL']);
  const CONTAINER_TAGS = new Set(['DIV', 'MAIN', 'ARTICLE', 'SECTION']);

  function hasBlockDescendant(el) {
    for (const c of el.children) {
      if (TEXT_TAGS.has(c.tagName) || LIST_TAGS.has(c.tagName)) return true;
      if (CONTAINER_TAGS.has(c.tagName) && hasBlockDescendant(c)) return true;
    }
    return false;
  }

  function classify(el) {
    if (TEXT_TAGS.has(el.tagName)) return 'text';
    if (LIST_TAGS.has(el.tagName)) return 'list';
    if (el.tagName === 'HR') return 'divider';
    if (CONTAINER_TAGS.has(el.tagName) && hasBlockDescendant(el)) return 'container';
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
