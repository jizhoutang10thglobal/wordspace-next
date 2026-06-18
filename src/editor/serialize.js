(function (global) {
  function doctypeString(dt) {
    let s = '<!DOCTYPE ' + dt.name;
    if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"';
    else if (dt.systemId) s += ' SYSTEM';
    if (dt.systemId) s += ' "' + dt.systemId + '"';
    return s + '>';
  }

  // 只剥编辑器自己加的标记（白名单）。**不能**用 startsWith('data-ws2') 前缀剥——
  // 那会误删文档自带的 data-ws2-* 属性（用户内容损坏，保真红线）。
  const WS2_MARKERS = new Set([
    'data-ws2-ui', 'data-ws2-ce', 'data-ws2-sc', 'data-ws2-block', 'data-ws2-container',
    'data-ws2-canvas', 'data-ws2-eid', 'data-ws2-editing',
    'data-ws2-selected', 'data-ws2-drop', // 块编辑：灰选中 / 拖拽投放标记（仅交互态，存盘剥除）
  ]);

  function cleanRoot(root) {
    root.querySelectorAll('[data-ws2-ui]').forEach(n => n.remove());
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el.hasAttribute('data-ws2-ce')) el.removeAttribute('contenteditable');
      if (el.hasAttribute('data-ws2-sc')) el.removeAttribute('spellcheck');
      for (const a of [...el.attributes]) {
        if (WS2_MARKERS.has(a.name)) el.removeAttribute(a.name);
      }
    }
    return root;
  }

  function serializeDocument(doc) {
    // 逐个序列化文档顶层节点：doctype 原样（含 legacy publicId/systemId）、
    // <html> 外的注释也要保留（浏览器另存的页面常见）
    const parts = [];
    for (const node of doc.childNodes) {
      if (node.nodeType === 10) parts.push(doctypeString(doc.doctype));
      else if (node.nodeType === 8) parts.push('<!--' + node.data + '-->');
      else if (node === doc.documentElement) parts.push(cleanRoot(node.cloneNode(true)).outerHTML);
    }
    return parts.join('\n');
  }

  // body 的「干净 innerHTML」：克隆后按同一白名单剥掉编辑器标记/contenteditable。供 undo 快照用——
  // 这样编辑器选中/编辑态属性 toggle 不会被当成内容变更（且与存盘用同一套剥除规则，不误删用户 data-ws2-*）。
  function cleanedBodyHtml(body) {
    return cleanRoot(body.cloneNode(true)).innerHTML;
  }

  const api = { serializeDocument, cleanedBodyHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Serialize = api;
})(typeof window !== 'undefined' ? window : globalThis);
