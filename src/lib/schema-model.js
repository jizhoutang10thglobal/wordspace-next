// Schema #1 内容模型适配纯函数：把任意输入 coerce 到合法 Schema 形态。
// 编辑器的 turn-into / 合并 / 粘贴净化 都过这里（单一收口、对 Schema 闭合：合法进 → 合法出）。
// 纯逻辑、无副作用、传 DOM 节点进出（用 node.ownerDocument 建元素）；jsdom 可单测。
// 双导出：node:test 用 require，渲染层用 <script> 当 classic script（window.WS2SchemaModel）。
// 见 docs/schema-1-draft-v0.md §0 / §6 / §7（堵根因 1：A1/B1/B2/S1-S3）。
(function (global) {
  // phrasing（行内）标签：可安全做节点级文字拼接的内容。其余 = 块级，禁塞进叶子文字块。
  // 与 blockedit.js 的 INLINE_TAGS 对齐（U3 接线时由编辑器改用本表，去重）。
  const PHRASING_TAGS = new Set(['B', 'I', 'EM', 'STRONG', 'U', 'S', 'A', 'CODE', 'SPAN', 'BR', 'IMG', 'SUB', 'SUP', 'MARK', 'SMALL', 'BIG', 'FONT', 'LABEL', 'ABBR', 'TIME', 'CITE', 'Q', 'KBD', 'SAMP', 'VAR', 'WBR', 'DEL', 'INS']);

  const isOverlay = (el) => el && el.nodeType === 1 && el.hasAttribute && el.hasAttribute('data-ws2-ui');

  // 递归：el 内是否含块级后代（穿透行内标签，跳过 data-ws2-ui 覆盖层）。
  function hasBlockLevelDescendant(el) {
    if (!el || !el.children) return false;
    for (const c of el.children) {
      if (isOverlay(c)) continue;
      if (!PHRASING_TAGS.has(c.tagName)) return true;   // 直接子是块级 → 是
      if (hasBlockLevelDescendant(c)) return true;       // 行内子里还藏块级（修 S1：<a><h2>..</h2></a>）
    }
    return false;
  }

  // 只有「文字承载块」才可能是叶子文字块（fail-closed 正向白名单）：结构容器（ul/ol/table/details）、
  // void（hr/img）、嵌入（iframe/object/svg…）、未知标签一律非叶子——哪怕「无块级后代」也不行。
  // 修 P1-1/P2-5（对抗验证实证）：空 <ul>/void 块原判 !hasBlockLevelDescendant=叶子 → canMerge 放行 →
  // 节点级拼接产 <ul>text</ul>（非法落盘）或把文字灌进 <hr>（重序列化静默丢失）。
  // 修 S1：白名单内的块仍递归确认内部无块级（行内 <a> 里藏 <h2> 不算叶子）。
  const LEAF_TEXT_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV']);
  function isLeafTextBlock(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!LEAF_TEXT_TAGS.has(el.tagName)) return false; // 非文字承载块 → 永不叶子
    return !hasBlockLevelDescendant(el);
  }

  // 两个块能否安全合并（节点级拼接 inline 内容）：都是叶子文字块。
  // 修 B1/B2：跨块删 / 并入列表前必须过它，防 <p><p> / <li><p>。
  function canMerge(a, b) {
    return isLeafTextBlock(a) && isLeafTextBlock(b);
  }

  // 收集列表里每个 li 的 phrasing 内容成「行」（DocumentFragment 数组）；嵌套子列表递归、各项各成一行。
  function collectLiLines(listEl, lines) {
    const doc = listEl.ownerDocument;
    for (const li of listEl.children) {
      if (li.tagName !== 'LI') continue;
      const lineFrag = doc.createDocumentFragment();
      let nested = null;
      for (const node of [...li.childNodes]) {
        if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) { nested = node; continue; }
        lineFrag.appendChild(node.cloneNode(true));
      }
      lines.push(lineFrag);
      if (nested) collectLiLines(nested, lines); // 嵌套子项也各成一行
    }
  }

  // 把列表（ul/ol）拍平成 phrasing 片段：每个 li 一行、<br> 分隔，嵌套子列表展开。
  // 修 A1：list → 引用/正文/标题前先拍平，避免 <blockquote><li>…</li> 孤儿。
  function flattenListToPhrasing(listEl) {
    const doc = listEl.ownerDocument;
    const frag = doc.createDocumentFragment();
    const lines = [];
    collectLiLines(listEl, lines);
    lines.forEach((lineFrag, i) => {
      if (i > 0) frag.appendChild(doc.createElement('br'));
      frag.appendChild(lineFrag);
    });
    return frag;
  }

  // 把一个块的 inline 内容裹进单个 <li>（A→B turn-into 用；调用方建外层 ul/ol）。
  function wrapInlineAsLi(srcEl) {
    const doc = srcEl.ownerDocument;
    const li = doc.createElement('li');
    for (const node of [...srcEl.childNodes]) li.appendChild(node.cloneNode(true));
    return li;
  }

  const api = { PHRASING_TAGS, isOverlay, hasBlockLevelDescendant, isLeafTextBlock, canMerge, flattenListToPhrasing, wrapInlineAsLi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
