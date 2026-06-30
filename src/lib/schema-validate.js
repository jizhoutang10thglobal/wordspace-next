// Schema #1 确定性校验器 v1：判一份 HTML 是否符合 Schema #1。合规判定的唯一权威。
// 纯函数。**调用方必须传「磁盘字节 reparse 出的 Document」，不是编辑器活 DOM**（§4.3 铁律③）。
// §4.3 铁律：① 绝不因 <meta wordspace-schema> 自称就放行——本函数压根不看 meta，只查内容；
//           ② 状态只认属性（data-checked），不认视觉（::before）；③ 判 reparse DOM。
// 输出 { conform:boolean, violations:[{rule, msg, tag}] }。见 docs/schema-1-draft-v0.md §2/§4.3/§7。
// 双导出 + 依赖 schema-model（PHRASING_TAGS 单一来源）。
(function (global) {
  const model = (typeof require === 'function') ? require('./schema-model.js') : (global.WS2SchemaModel || {});
  const PHRASING = model.PHRASING_TAGS || new Set();

  const TOP_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE', 'DETAILS', 'IMG']);
  const UNSAFE_HREF = /^\s*(javascript|data|vbscript|file):/i;

  function isPhrasing(el) { return PHRASING.has(el.tagName); }
  // 容器（blockquote / callout）允许的子：phrasing 节点，或一段 <p>（决策4：多段文字），不许列表/别的块。
  function childrenAreMultiPara(el, V) {
    for (const c of el.children) {
      if (c.tagName === 'P') { if (model.hasBlockLevelDescendant(c)) V.push({ rule: 'nested-block', tag: 'P', msg: '容器内的 <p> 不能再含块级' }); continue; }
      if (!isPhrasing(c)) V.push({ rule: 'nested-block', tag: c.tagName, msg: '容器（callout/quote）只允许多段 <p> + 行内，不允许列表/别的块' });
    }
  }

  function validateList(ul, V) {
    const isTodo = ul.classList.contains('ws-todo');
    for (const c of ul.children) {
      if (c.tagName !== 'LI') { V.push({ rule: 'list-child', tag: c.tagName, msg: 'ul/ol 直接子只能是 <li>' }); continue; }
      if (isTodo) {
        const dc = c.getAttribute('data-checked');
        if (dc !== null && dc !== 'true' && dc !== 'false') V.push({ rule: 'todo-checked', tag: 'LI', msg: 'data-checked 只能是 true/false，当前: ' + dc });
      }
      // li 内容 = phrasing + 可选尾随子列表；子列表递归
      for (const sub of c.children) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') validateList(sub, V);
        else if (!isPhrasing(sub)) V.push({ rule: 'li-content', tag: sub.tagName, msg: '<li> 内只能是行内 + 尾随子列表' });
      }
    }
  }

  function validateTable(tbl, V) {
    tbl.querySelectorAll('td,th').forEach((cell) => {
      if (cell.hasAttribute('colspan') || cell.hasAttribute('rowspan')) V.push({ rule: 'table-merge', tag: cell.tagName, msg: '禁合并格 colspan/rowspan' });
    });
  }

  function validateBlock(el, V) {
    const t = el.tagName;
    if (t === 'DIV') {
      if (!el.classList.contains('ws-callout')) { V.push({ rule: 'block-tag', tag: t, msg: '裸 <div> 不是合法块（只有 div.ws-callout）' }); return; }
      childrenAreMultiPara(el, V); return;
    }
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

  function validate(doc) {
    const V = [];
    // 全局安全/铁律（不信 meta，只查内容）
    doc.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'SCRIPT') V.push({ rule: 'script', tag: 'SCRIPT', msg: '禁脚本' });
      for (const a of el.attributes) {
        if (/^on/i.test(a.name)) V.push({ rule: 'event-attr', tag: el.tagName, msg: '禁内联事件属性 ' + a.name });
      }
      if (el.tagName === 'A' && UNSAFE_HREF.test(el.getAttribute('href') || '')) V.push({ rule: 'unsafe-href', tag: 'A', msg: '危险链接 href' });
    });
    // 顶层块
    const body = doc.body;
    if (body) for (const c of body.children) validateBlock(c, V);
    return { conform: V.length === 0, violations: V };
  }

  const api = { validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
