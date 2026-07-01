// 非合规 HTML 的「基础编辑器」（Feature 3）。见 docs/plans/2026-07-01-002-...-plan.md +
// origin ../wordspace-next-ui-demo/docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
//
// 跑在父层、操作 doc-frame 的 contentDocument（iframe sandbox 不跑文档 JS）。三能力：
//   A 富就地文字（B/I/U/S + 文字色/高亮/清除）· B 删整块 · C 空间切块（方向键按渲染几何）。
// 编辑器 chrome（格式条/焦点框/悬停删除/🔒）全走**宿主浮层**、绝不注进 iframe DOM（KD-b）。
// 唯一注进 iframe 的是编辑态：body.contentEditable + cursor —— cursor 走 adoptedStyleSheets（不写
// body.style、不进序列化），contentEditable 由序列化前的剥除契约摘掉（KD-c/KD-d）。
// 保存不走 block 编辑器的 Schema 规整；结构级保真（未触及元素结构/属性保留 + 二次保存幂等）。
(function (global) {
  const CE_MARK = 'data-ws2-basic-ce'; // 编辑态锚点：cursor 样式表选它、序列化剥它
  // 编辑态样式走 adoptedStyleSheets（构造样式表，不进 DOM/不进序列化）
  function injectEditSheet(doc) {
    try {
      const CSS = doc.defaultView && doc.defaultView.CSSStyleSheet;
      if (!CSS) return;
      const sheet = new CSS();
      sheet.replaceSync('[' + CE_MARK + ']{cursor:text;outline:none}');
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet];
    } catch (e) { /* cursor 是装饰，失败无害 */ }
  }

  // 序列化剥除契约（KD-d）：克隆 documentElement，摘掉本模块注入的编辑态属性 + 浏览器注入的编辑标记。
  // 纯函数，jsdom 可单测（U4）。
  const STRIP_ATTRS = ['contenteditable', CE_MARK, 'spellcheck'];
  function serialize(doc) {
    const root = doc.documentElement.cloneNode(true);
    const body = root.querySelector('body') || root;
    STRIP_ATTRS.forEach((a) => body.removeAttribute(a));
    // 保原 doctype（无 doctype 的 quirks 文档别强塞标准模式）
    const dt = doc.doctype;
    const doctypeStr = dt ? '<!DOCTYPE ' + dt.name
      + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '')
      + (dt.systemId ? (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"' : '') + '>' : '';
    return doctypeStr + (doctypeStr ? '\n' : '') + root.outerHTML;
  }

  function attach(doc, opts) {
    opts = opts || {};
    const body = doc.body;
    if (!body) return { detach() {}, reposition() {}, serialize: () => serialize(doc) };

    body.contentEditable = 'true';
    body.setAttribute(CE_MARK, '');
    injectEditSheet(doc);

    const onInput = () => { if (opts.markDirty) opts.markDirty(); };
    doc.addEventListener('input', onInput);

    // U2/U3 会在这里挂：格式条 / 块收集 / 空间切块 / 悬停删除 / 焦点框 / 🔒。

    return {
      detach() {
        doc.removeEventListener('input', onInput);
        try { body.removeAttribute('contenteditable'); body.removeAttribute(CE_MARK); } catch (e) {}
      },
      reposition() { /* U3：重算宿主浮层坐标 */ },
      serialize() { return serialize(doc); },
    };
  }

  const api = { attach, serialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BasicEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
