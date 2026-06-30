// Schema #1 确定性校验器 v1：判一份 HTML 是否符合 Schema #1。合规判定的唯一权威。
// 纯函数。**调用方必须传「磁盘字节 reparse 出的 Document」，不是编辑器活 DOM**（§4.3 铁律③）。
// §4.3 铁律：① 绝不因 <meta wordspace-schema> 自称就放行——本函数压根不看 meta，只查内容；
//           ② 状态只认属性（data-checked），不认视觉（::before）；③ 判 reparse DOM。
// 输出 { conform:boolean, violations:[{rule, msg, tag}] }。见 docs/schema-1-draft-v0.md §2/§4/§7。
// 双导出 + 依赖 schema-model（PHRASING_TAGS 单一来源）。
// ⚠ 对抗验证（2026-06-30）修过：P0-1 href 控制字符绕过 / P0-2 SVG 命名空间 script / P1-2 单元格盲区 /
//   P1-3 head 白名单 / P2-1 表格不变式 / P2-2 块级 style / P2-3 figure。
(function (global) {
  const model = (typeof require === 'function') ? require('./schema-model.js') : (global.WS2SchemaModel || {});
  const PHRASING = model.PHRASING_TAGS || new Set();

  const TOP_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE', 'DETAILS', 'IMG']);
  const UNSAFE_SCHEME = /^(javascript|data|vbscript|file):/i;

  function isPhrasing(el) { return PHRASING.has(el.tagName); }
  // 命名空间无关地判脚本（修 P0-2：SVG/MathML 里的 <script> 其 tagName 是小写 'script'，===‘SCRIPT’ 漏过）
  function isScript(el) { return !!el.localName && el.localName.toLowerCase() === 'script'; }
  function isAnchor(el) { return !!el.localName && el.localName.toLowerCase() === 'a'; }
  // 修 P0-1：href 里 tab/newline/前导控制字符会被浏览器剥掉再执行，校验前先剥同样的字符
  function hrefUnsafe(href) {
    const c = String(href || '').split('').filter((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) !== 127).join('');
    return UNSAFE_SCHEME.test(c);
  }

  // 容器（blockquote / callout）允许的子：phrasing，或一段 <p>（决策4：多段文字），不许列表/别的块。
  function childrenAreMultiPara(el, V) {
    for (const c of el.children) {
      if (c.tagName === 'P') { if (model.hasBlockLevelDescendant(c)) V.push({ rule: 'nested-block', tag: 'P', msg: '容器内的 <p> 不能再含块级' }); continue; }
      if (!isPhrasing(c)) V.push({ rule: 'nested-block', tag: c.tagName, msg: '容器（callout/quote）只允许多段 <p> + 行内，不允许列表/别的块' });
    }
  }
  function phrasingOnly(el, V, rule, what) {
    for (const c of el.children) if (!isPhrasing(c)) V.push({ rule: rule, tag: c.tagName, msg: what + '只能放行内内容，不能是 ' + c.tagName });
  }

  function validateList(ul, V) {
    const isTodo = ul.classList.contains('ws-todo');
    for (const c of ul.children) {
      if (c.tagName !== 'LI') { V.push({ rule: 'list-child', tag: c.tagName, msg: 'ul/ol 直接子只能是 <li>' }); continue; }
      if (isTodo) {
        const dc = c.getAttribute('data-checked');
        if (dc !== null && dc !== 'true' && dc !== 'false') V.push({ rule: 'todo-checked', tag: 'LI', msg: 'data-checked 只能是 true/false，当前: ' + dc });
      }
      for (const sub of c.children) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') validateList(sub, V);
        else if (!isPhrasing(sub)) V.push({ rule: 'li-content', tag: sub.tagName, msg: '<li> 内只能是行内 + 尾随子列表' });
      }
    }
  }

  function rowCells(tr) { return [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); }
  function validateTable(tbl, V) {
    tbl.querySelectorAll('td,th').forEach((cell) => {
      if (cell.hasAttribute('colspan') || cell.hasAttribute('rowspan')) V.push({ rule: 'table-merge', tag: cell.tagName, msg: '禁合并格 colspan/rowspan' });
      // 修 P1-2：单元格内容 = phrasing-only（决策4），iframe/object/embed/块都挡在这
      for (const c of cell.children) if (!isPhrasing(c)) V.push({ rule: 'cell-content', tag: c.tagName, msg: '单元格只能放行内内容，不能是 ' + c.tagName });
    });
    // 修 P2-1：结构不变式（§2.3）
    if (tbl.querySelector('caption')) V.push({ rule: 'table-structure', tag: 'CAPTION', msg: '禁 <caption>' });
    if (tbl.querySelector('colgroup')) V.push({ rule: 'table-structure', tag: 'COLGROUP', msg: '禁 <colgroup>' });
    if (tbl.querySelector('tfoot')) V.push({ rule: 'table-structure', tag: 'TFOOT', msg: '禁 <tfoot>' });
    const thead = tbl.querySelector('thead');
    if (thead && thead.querySelectorAll('tr').length > 1) V.push({ rule: 'table-structure', tag: 'THEAD', msg: '表头至多一行' });
    const counts = [...tbl.querySelectorAll('tr')].map((r) => rowCells(r).length);
    if (counts.length && counts.some((c) => c !== counts[0])) V.push({ rule: 'table-ragged', tag: 'TABLE', msg: '表格须矩形（各行同格数）' });
  }

  // 修 P2-3：figure（§5 captioned image canonical）= 一个 <img> + 可选 <figcaption>(phrasing)
  function validateFigure(fig, V) {
    for (const c of fig.children) {
      if (c.tagName === 'IMG') continue;
      if (c.tagName === 'FIGCAPTION') { phrasingOnly(c, V, 'figcaption-content', 'figcaption'); continue; }
      V.push({ rule: 'figure-content', tag: c.tagName, msg: 'figure 只能含 <img> + 可选 <figcaption>' });
    }
  }

  function validateBlock(el, V) {
    const t = el.tagName;
    // 修 P2-2：块级禁 style（带 style 的块 → 不符合 → 走基础编辑；显示仍按原生，不在这剥色）。行内 span style 仍合法。
    if (el.hasAttribute('style')) V.push({ rule: 'block-style', tag: t, msg: '块级不能带 style 属性' });
    if (t === 'DIV') {
      if (!el.classList.contains('ws-callout')) { V.push({ rule: 'block-tag', tag: t, msg: '裸 <div> 不是合法块（只有 div.ws-callout）' }); return; }
      childrenAreMultiPara(el, V); return;
    }
    if (t === 'FIGURE') { validateFigure(el, V); return; }
    if (!TOP_BLOCKS.has(t)) { V.push({ rule: 'block-tag', tag: t, msg: t + ' 不在 Schema #1 块集合（h5/h6/section/… 不符合）' }); return; }
    if (t === 'P' || t === 'H1' || t === 'H2' || t === 'H3' || t === 'H4') {
      if (model.hasBlockLevelDescendant(el)) V.push({ rule: 'nested-block', tag: t, msg: t + ' 是叶子文字块、不能含块级' });
    } else if (t === 'BLOCKQUOTE') {
      childrenAreMultiPara(el, V); // 决策4：引用 = 多段文字
    } else if (t === 'UL' || t === 'OL') {
      validateList(el, V);
    } else if (t === 'TABLE') {
      validateTable(el, V);
    }
    // HR / IMG / DETAILS：void 或 v1 暂不深验
  }

  // 修 P1-3：head 白名单（§4.1）。只放 meta[charset]/meta[name=...]（禁 http-equiv）、<title>、
  // <style data-ws-schema-css>；禁 <base>/<link>/作者 <style>/<script>。base+meta-refresh 是导航劫持向量。
  function validateHead(head, V) {
    for (const c of head.children) {
      const t = c.tagName;
      if (t === 'META') { if (c.hasAttribute('http-equiv')) V.push({ rule: 'head-meta-http-equiv', tag: 'META', msg: '禁 meta http-equiv（refresh 等跳转劫持）' }); continue; }
      if (t === 'TITLE') continue;
      if (t === 'STYLE') { if (!c.hasAttribute('data-ws-schema-css')) V.push({ rule: 'head-style', tag: 'STYLE', msg: 'head 只允许 Schema baseline 的 <style data-ws-schema-css>' }); continue; }
      if (t === 'BASE') { V.push({ rule: 'head-base', tag: 'BASE', msg: '禁 <base>（重写全篇相对 URL）' }); continue; }
      if (t === 'LINK') { V.push({ rule: 'head-link', tag: 'LINK', msg: '禁外联 <link>' }); continue; }
      if (isScript(c)) continue; // 全局 script 闸已抓，不重复记
      V.push({ rule: 'head-tag', tag: t, msg: 'head 不允许 ' + t });
    }
  }

  function validate(doc) {
    const V = [];
    // 全局安全/铁律（不信 meta，只查内容）
    doc.querySelectorAll('*').forEach((el) => {
      if (isScript(el)) V.push({ rule: 'script', tag: 'SCRIPT', msg: '禁脚本' });
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) V.push({ rule: 'event-attr', tag: el.tagName, msg: '禁内联事件属性 ' + a.name });
      }
      if (isAnchor(el) && hrefUnsafe(el.getAttribute('href'))) V.push({ rule: 'unsafe-href', tag: 'A', msg: '危险链接 href' });
    });
    if (doc.head) validateHead(doc.head, V);
    if (doc.body) for (const c of doc.body.children) validateBlock(c, V);
    return { conform: V.length === 0, violations: V };
  }

  const api = { validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
