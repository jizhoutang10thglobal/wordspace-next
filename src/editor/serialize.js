(function (global) {
  function doctypeString(dt) {
    let s = '<!DOCTYPE ' + dt.name;
    if (dt.publicId) s += ' PUBLIC "' + dt.publicId + '"';
    else if (dt.systemId) s += ' SYSTEM';
    if (dt.systemId) s += ' "' + dt.systemId + '"';
    return s + '>';
  }

  // 编辑器覆盖层（⋮⋮手柄/块菜单/斜杠菜单/格式气泡）的 data-ws2-ui 值用这个 sentinel 标记——
  // cleanRoot 只删**值匹配它**的节点，用户文件自带的 data-ws2-ui="任意值" 原样保留（保真红线，对抗审计 F1）。
  const OVERLAY_VAL = '__ws2-overlay__';
  // 只剥编辑器自己加的标记（白名单）。**不能**用 startsWith('data-ws2') 前缀剥——
  // 那会误删文档自带的 data-ws2-* 属性（用户内容损坏，保真红线）。
  // 注意：data-ws2-ui **不在**此集合——覆盖层节点按 sentinel 值整删（见 cleanRoot），不靠属性剥除；
  // 用户自带的 data-ws2-ui 属性必须保留（F1）。
  const WS2_MARKERS = new Set([
    'data-ws2-ce', 'data-ws2-sc', 'data-ws2-block', 'data-ws2-container',
    'data-ws2-canvas', 'data-ws2-eid', 'data-ws2-editing',
    'data-ws2-selected', 'data-ws2-drop', // 块编辑：灰选中 / 拖拽投放标记（仅交互态，存盘剥除）
    'data-ws2-root', // 块容器标记（给空块占行高等结构 CSS 用，存盘剥除）
  ]);

  function cleanRoot(root) {
    // 只删本编辑器覆盖层（data-ws2-ui 值 = sentinel），保留用户自带的 data-ws2-ui="任意其他值"（F1）。
    // 分页的 spacer 节点（表格间隔行 / pre 的行间隔 span / 覆盖层遮罩）都带此 sentinel → 一并整删。
    root.querySelectorAll('[data-ws2-ui="' + OVERLAY_VAL + '"]').forEach(n => n.remove());
    // 分页 strip-on-persist（P0）：V4 推挤是运行时视觉产物（块内切分的 paddingTop / 块级切页的
    // marginTop，带 data-ws-pushed 标记）。漏一个进磁盘 = 块级 style 属性 = 文档瞬间非合规
    //（Schema 1 校验器 block-style 规则）。这里剥样式而非删节点——被推挤的是用户内容元素本身。
    // 也兜住 contenteditable 回车分裂继承出来的推挤克隆（persist 可能先于下一帧 recalc 扫荡发生）。
    root.querySelectorAll('[data-ws-pushed]').forEach(n => {
      n.style.paddingTop = '';
      n.style.marginTop = '';
      n.removeAttribute('data-ws-pushed');
      if (!n.getAttribute('style')) n.removeAttribute('style');
    });
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
    const clone = cleanRoot(body.cloneNode(true));
    // U10（KD5）：撤销快照/判脏基准里剥掉 <details open> —— 折叠态不进撤销历史（内容撤销不该重折叠/展开
    // 用户手动折叠的 toggle）。这只影响撤销层；serializeDocument（存盘）走 cleanRoot 不剥、open 照常落盘（R7）。
    clone.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));
    return clone.innerHTML;
  }

  const api = { serializeDocument, cleanedBodyHtml, OVERLAY_VAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Serialize = api;
})(typeof window !== 'undefined' ? window : globalThis);
