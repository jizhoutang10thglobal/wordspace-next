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
  // i18n:违规消息双上下文取 t —— renderer(<script> 全局,无 require)用 window.wsT;node(CLI/测试)用 require('./i18n')。
  const _i18nMod = (typeof require === 'function') ? (function () { try { return require('./i18n'); } catch (_) { return null; } })() : null;
  function _t(key, params) {
    if (typeof window !== 'undefined' && typeof window.wsT === 'function') return window.wsT(key, params);
    if (_i18nMod) return _i18nMod.t(key, params);
    return key;
  }

  const TOP_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE', 'DETAILS', 'IMG']);
  const UNSAFE_SCHEME = /^(javascript|data|vbscript|file|blob):/i;   // 链接类一律禁（加 blob，同类遗漏）
  const HARD_UNSAFE = /^(javascript|vbscript|file|blob):/i;          // 任何 URL 属性都禁（data 另判：媒体可放 data:image）
  // 行内 style 值里的危险片段：全屏覆盖层点击劫持 / 外链请求 / 老式 CSS 执行向量。块级带 style 另由 block-style 抓。
  // 修 KV-7：position:absolute 与 fixed/sticky 同类——配 display:block/宽高 100% 能把「只该上色」的行内 span
  // 变成任意覆盖层/点击劫持面。行内 style 是收白名单外的排版属性都放行、只黑名单危险值，故补进危险位置集。
  const STYLE_DANGER = /(position\s*:\s*(fixed|sticky|absolute)|url\s*\(|expression\s*\(|-moz-binding|behavior\s*:|@import|javascript:)/i;

  function isPhrasing(el) { return PHRASING.has(el.tagName); }
  // 判磁盘字节时找块级后代：穿透行内标签，但**不信任运行时 data-ws2-ui 覆盖层标记**（铁律③）——
  // model.hasBlockLevelDescendant 跳过 overlay 是给活 DOM 用的；磁盘字节里 overlay 标记可被手写/AI/粘贴
  // 伪造来藏 <iframe>/<button>/块级（KV-2）。这里一律下探。修 KV-1：块级裹一层 span/a 就绕过 phrasing-only 检查。
  function hasBlockDescendant(el) {
    if (!el || !el.children) return false;
    for (const c of el.children) {
      if (!PHRASING.has(c.tagName)) return true;
      if (hasBlockDescendant(c)) return true;
    }
    return false;
  }
  // 命名空间无关地判脚本（修 P0-2：SVG/MathML 里的 <script> 其 tagName 是小写 'script'，===‘SCRIPT’ 漏过）
  function isScript(el) { return !!el.localName && el.localName.toLowerCase() === 'script'; }
  // 修 P0（本轮）：<template> 在 Schema #1 任何位置都不合法，且其 .content 逃过 querySelectorAll('*') 扫描 → fail-closed 拒
  function isTemplate(el) { return !!el.localName && el.localName.toLowerCase() === 'template'; }
  function isAnchor(el) { return !!el.localName && el.localName.toLowerCase() === 'a'; }
  // 修 P0-1：href/src 里 tab/newline/控制字符会被浏览器剥掉再执行，校验前先剥同样的字符（≤32、127）
  function stripCtrl(s) { return String(s || '').split('').filter((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) !== 127).join(''); }
  function hrefUnsafe(href) { return UNSAFE_SCHEME.test(stripCtrl(href)); } // 链接：js/data/vbscript/file/blob 全禁
  // 修 P0（本轮）：媒体资源 src（img/source/xlink:href）——禁 js/vbscript/file/blob；data: 只放 data:image/* 且拒 svg（SVG 能内嵌脚本/外链）
  function srcUnsafe(val) {
    const c = stripCtrl(val);
    if (HARD_UNSAFE.test(c)) return true;
    if (/^data:/i.test(c)) return !/^data:image\/(?!svg)/i.test(c);
    return false;
  }

  // 容器（blockquote / callout）允许的子：phrasing，或一段 <p>（决策4：多段文字），不许列表/别的块。
  function childrenAreMultiPara(el, V) {
    for (const c of el.children) {
      if (c.tagName === 'P') { if (hasBlockDescendant(c)) V.push({ rule: 'nested-block', tag: 'P', msg: _t('schema.pInContainerNoBlock') }); if (c.hasAttribute('style')) V.push({ rule: 'block-style', tag: 'P', msg: _t('schema.blockNoStyle') }); continue; }
      // 修 KV-1：块级裹在 phrasing（span/a）里也要抓
      if (!isPhrasing(c)) V.push({ rule: 'nested-block', tag: c.tagName, msg: _t('schema.containerMultiPara') });
      else if (hasBlockDescendant(c)) V.push({ rule: 'nested-block', tag: c.tagName, msg: _t('schema.containerInlineNoBlock') });
    }
  }
  function phrasingOnly(el, V, rule, what) {
    for (const c of el.children) {
      if (!isPhrasing(c)) V.push({ rule: rule, tag: c.tagName, msg: _t('schema.phrasingOnlyNot', { what: what, tag: c.tagName }) });
      else if (hasBlockDescendant(c)) V.push({ rule: rule, tag: c.tagName, msg: _t('schema.phrasingInlineNoBlock', { what: what }) }); // 修 KV-1
    }
  }

  function validateList(ul, V) {
    const isTodo = ul.classList.contains('ws-todo');
    // 修 ED-A6：ul/ol 直接挂裸文本（删空唯一 li 后打字产 <ul>裸文本</ul>）也是违规——原来只遍历 children 漏了文本节点。
    for (const n of ul.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { V.push({ rule: 'list-child', tag: '#text', msg: _t('schema.ulNoText') }); break; }
    for (const c of ul.children) {
      if (c.tagName !== 'LI') { V.push({ rule: 'list-child', tag: c.tagName, msg: _t('schema.ulLiOnly') }); continue; }
      if (isTodo) {
        const dc = c.getAttribute('data-checked');
        if (dc !== null && dc !== 'true' && dc !== 'false') V.push({ rule: 'todo-checked', tag: 'LI', msg: _t('schema.todoChecked', { value: dc }) });
      }
      if (c.hasAttribute('style')) V.push({ rule: 'block-style', tag: 'LI', msg: _t('schema.blockNoStyle') }); // 修 KV-3
      for (const sub of c.children) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') validateList(sub, V);
        else if (!isPhrasing(sub)) V.push({ rule: 'li-content', tag: sub.tagName, msg: _t('schema.liContent') });
        else if (hasBlockDescendant(sub)) V.push({ rule: 'li-content', tag: sub.tagName, msg: _t('schema.liInlineNoBlock') }); // 修 KV-1
      }
    }
  }

  function rowCells(tr) { return [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); }
  function validateTable(tbl, V) {
    tbl.querySelectorAll('td,th').forEach((cell) => {
      // 修 KV-6：colspan="1"/rowspan="1" 是语义 no-op（等同没写），不该判合并格。只在跨度 >1 时 flag。
      if (cell.colSpan > 1 || cell.rowSpan > 1) V.push({ rule: 'table-merge', tag: cell.tagName, msg: _t('schema.noMergeCells') });
      if (cell.hasAttribute('style')) V.push({ rule: 'block-style', tag: cell.tagName, msg: _t('schema.blockNoStyle') }); // 修 KV-3
      // 修 P1-2：单元格内容 = phrasing-only（决策4），iframe/object/embed/块都挡在这
      for (const c of cell.children) {
        if (!isPhrasing(c)) V.push({ rule: 'cell-content', tag: c.tagName, msg: _t('schema.cellPhrasingNot', { tag: c.tagName }) });
        else if (hasBlockDescendant(c)) V.push({ rule: 'cell-content', tag: c.tagName, msg: _t('schema.cellInlineNoBlock') }); // 修 KV-1
      }
    });
    // 修 P2-1：结构不变式（§2.3）
    if (tbl.querySelector('caption')) V.push({ rule: 'table-structure', tag: 'CAPTION', msg: _t('schema.noCaption') });
    if (tbl.querySelector('colgroup')) V.push({ rule: 'table-structure', tag: 'COLGROUP', msg: _t('schema.noColgroup') });
    if (tbl.querySelector('tfoot')) V.push({ rule: 'table-structure', tag: 'TFOOT', msg: _t('schema.noTfoot') });
    const thead = tbl.querySelector('thead');
    if (thead && thead.querySelectorAll('tr').length > 1) V.push({ rule: 'table-structure', tag: 'THEAD', msg: _t('schema.theadOneRow') });
    const counts = [...tbl.querySelectorAll('tr')].map((r) => rowCells(r).length);
    if (counts.length && counts.some((c) => c !== counts[0])) V.push({ rule: 'table-ragged', tag: 'TABLE', msg: _t('schema.tableRect') });
  }

  // 修 P2-3：figure（§5 captioned image canonical）= 一个 <img> + 可选 <figcaption>(phrasing)
  function validateFigure(fig, V) {
    let imgs = 0;
    for (const c of fig.children) {
      if (c.tagName === 'IMG') { imgs++; continue; }
      if (c.tagName === 'FIGCAPTION') { if (c.hasAttribute('style')) V.push({ rule: 'block-style', tag: 'FIGCAPTION', msg: _t('schema.blockNoStyle') }); phrasingOnly(c, V, 'figcaption-content', 'figcaption'); continue; }
      V.push({ rule: 'figure-content', tag: c.tagName, msg: _t('schema.figureContent') });
    }
    // 修 KV-5：canonical = 恰好一个 <img>（0 或 ≥2 都不是合法 captioned image）
    if (imgs !== 1) V.push({ rule: 'figure-content', tag: 'FIGURE', msg: _t('schema.figureImgCount', { count: imgs }) });
  }

  // U0：toggle（<details>）内部校验（§2.1 规格 + §0 决策3）= 恰一个 <summary> 作首子（phrasing-only）
  // + 正文 = flow（逐块 validateBlock，可嵌块 / 再嵌 details —— Schema 唯一允许块嵌套处）。open 属性放行。
  function validateDetails(el, V) {
    const kids = [...el.children];
    const summaries = kids.filter((c) => c.tagName === 'SUMMARY');
    if (summaries.length !== 1) {
      V.push({ rule: 'details-summary', tag: 'DETAILS', msg: _t('schema.detailsSummaryCount', { count: summaries.length }) });
    } else if (kids[0].tagName !== 'SUMMARY') {
      V.push({ rule: 'details-summary', tag: 'DETAILS', msg: _t('schema.summaryFirst') });
    }
    for (const c of kids) {
      if (c.tagName === 'SUMMARY') { if (c.hasAttribute('style')) V.push({ rule: 'block-style', tag: 'SUMMARY', msg: _t('schema.blockNoStyle') }); phrasingOnly(c, V, 'details-summary-content', 'summary'); } // 修 KV-3
      else validateBlock(c, V); // 正文=flow：逐块校验（可嵌块 / 再嵌 details）
    }
  }

  function validateBlock(el, V) {
    const t = el.tagName;
    // 修 P2-2：块级禁 style（带 style 的块 → 不符合 → 走基础编辑；显示仍按原生，不在这剥色）。行内 span style 仍合法。
    if (el.hasAttribute('style')) V.push({ rule: 'block-style', tag: t, msg: _t('schema.blockNoStyle') });
    if (t === 'DIV') {
      if (!el.classList.contains('ws-callout')) { V.push({ rule: 'block-tag', tag: t, msg: _t('schema.bareDivNotBlock') }); return; }
      childrenAreMultiPara(el, V); return;
    }
    if (t === 'FIGURE') { validateFigure(el, V); return; }
    if (!TOP_BLOCKS.has(t)) { V.push({ rule: 'block-tag', tag: t, msg: _t('schema.notInBlockSet', { tag: t }) }); return; }
    if (t === 'P' || t === 'H1' || t === 'H2' || t === 'H3' || t === 'H4') {
      if (hasBlockDescendant(el)) V.push({ rule: 'nested-block', tag: t, msg: _t('schema.leafNoBlock', { tag: t }) }); // 修 KV-2：不信 overlay 标记
    } else if (t === 'BLOCKQUOTE') {
      childrenAreMultiPara(el, V); // 决策4：引用 = 多段文字
    } else if (t === 'UL' || t === 'OL') {
      validateList(el, V);
    } else if (t === 'TABLE') {
      validateTable(el, V);
    } else if (t === 'DETAILS') {
      validateDetails(el, V); // U0：toggle 内部（summary + 正文 flow）
    }
    // HR / IMG：void，v1 不深验
  }

  // 修 P1-3：head 白名单（§4.1）。只放 meta[charset]/meta[name=...]（禁 http-equiv）、<title>、
  // <style data-ws-schema-css>；禁 <base>/<link>/作者 <style>/<script>。base+meta-refresh 是导航劫持向量。
  function validateHead(head, V) {
    for (const c of head.children) {
      const t = c.tagName;
      if (t === 'META') { if (c.hasAttribute('http-equiv')) V.push({ rule: 'head-meta-http-equiv', tag: 'META', msg: _t('schema.noMetaHttpEquiv') }); continue; }
      if (t === 'TITLE') continue;
      if (t === 'STYLE') { if (!c.hasAttribute('data-ws-schema-css')) V.push({ rule: 'head-style', tag: 'STYLE', msg: _t('schema.headStyleOnly') }); continue; }
      if (t === 'BASE') { V.push({ rule: 'head-base', tag: 'BASE', msg: _t('schema.noBase') }); continue; }
      if (t === 'LINK') { V.push({ rule: 'head-link', tag: 'LINK', msg: _t('schema.noLink') }); continue; }
      if (isScript(c)) continue; // 全局 script 闸已抓，不重复记
      V.push({ rule: 'head-tag', tag: t, msg: _t('schema.headNotAllowed', { tag: t }) });
    }
  }

  function validate(doc) {
    const V = [];
    // 全局安全/铁律（不信 meta，只查内容）
    doc.querySelectorAll('*').forEach((el) => {
      if (isScript(el)) V.push({ rule: 'script', tag: 'SCRIPT', msg: _t('schema.noScript') });
      // 修 P0（本轮）：<template> 直接拒。表格上下文里的 <template> 不会被 validateTable 检查、其 .content
      //   （querySelectorAll('*') 不下探）可藏 <script>/onerror → 原本判 conform。fail-closed 从根上封死。
      if (isTemplate(el)) V.push({ rule: 'template', tag: 'TEMPLATE', msg: _t('schema.noTemplate') });
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) V.push({ rule: 'event-attr', tag: el.tagName, msg: _t('schema.noEventAttr', { attr: a.name }) });
      }
      // 修 P0（本轮）：危险 URL scheme 不再只查 <a> href——所有承载 URL 的属性都查（img/source 的 src/srcset、xlink:href）。
      if (el.hasAttribute('href') && hrefUnsafe(el.getAttribute('href'))) V.push({ rule: 'unsafe-href', tag: el.tagName, msg: _t('schema.unsafeHref') });
      if (el.hasAttribute('src') && srcUnsafe(el.getAttribute('src'))) V.push({ rule: 'unsafe-src', tag: el.tagName, msg: _t('schema.unsafeSrc') });
      if (el.hasAttribute('xlink:href') && srcUnsafe(el.getAttribute('xlink:href'))) V.push({ rule: 'unsafe-src', tag: el.tagName, msg: _t('schema.unsafeXlink') });
      if (el.hasAttribute('srcset')) {
        for (const cand of el.getAttribute('srcset').split(',')) {
          const u = cand.trim().split(/\s+/)[0];
          if (u && srcUnsafe(u)) { V.push({ rule: 'unsafe-src', tag: el.tagName, msg: _t('schema.unsafeSrcset') }); break; }
        }
      }
      // 修 P1（本轮）：行内 style 值校验（块级带 style 已被 block-style 抓；这里管值——覆盖层劫持/外链/老式执行向量）
      if (el.hasAttribute('style') && STYLE_DANGER.test(el.getAttribute('style'))) V.push({ rule: 'style-value', tag: el.tagName, msg: _t('schema.dangerStyleValue') });
    });
    if (doc.head) validateHead(doc.head, V);
    // 修 P2（本轮）：body 顶层的裸文本节点（非空白）也是违规——顶层必须是块，否则块编辑器无法把它纳入块模型（幽灵内容）。
    if (doc.body) for (const n of doc.body.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) V.push({ rule: 'top-text', tag: '#text', msg: _t('schema.topText') }); }
      else if (n.nodeType === 1) validateBlock(n, V);
    }
    return { conform: V.length === 0, violations: V };
  }

  const api = { validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
