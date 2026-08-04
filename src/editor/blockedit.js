(function (global) {
  // WS2BlockEdit —— ui-demo（main）式 Notion 块编辑内核，取代 heyhtml 自由画布。
  // 跑在父层 renderer，操作 iframe 的 contentDocument（iframe sandbox 无 allow-scripts，不跑脚本）。
  // 「块」= 块容器（blockRoot）的顶层子元素（排除 data-ws2-ui 覆盖层）。blockRoot 默认 <body>，
  // 但会穿透居中/限宽包裹容器（见 pickBlockRoot），否则被 <div class="wrap"> 包住的文档会塌成单块。
  // 所有编辑 UI（⋮⋮ 手柄 / 块菜单 /
  // 斜杠菜单 / 格式气泡）都是 iframe 内的 data-ws2-ui 节点，存盘时 serialize 剥除（不入磁盘）。
  // 选中/编辑态走 data-ws2-selected / data-ws2-editing 属性（serialize 白名单剥除），不包裹用户元素（保真）。
  // 排版样式经 adoptedStyleSheets 注入（构造样式表 = CSSOM，CSP 不拦、且不进序列化 → 存盘干净）。

  const fmt = (typeof WS2Format !== 'undefined') ? WS2Format
    : (typeof require !== 'undefined' ? require('./format.js') : null);
  // 内容模型适配纯函数（schema-model）：闭合的单一来源——叶子判定 / 可否合并 / 列表拍平。
  const SM = (typeof WS2SchemaModel !== 'undefined') ? WS2SchemaModel
    : (typeof require !== 'undefined' ? require('../lib/schema-model.js') : null);
  // 覆盖层（⋮⋮手柄/块菜单/斜杠菜单/格式气泡）的 data-ws2-ui 值用这个 sentinel——serialize.cleanRoot
  // 按它精确删，用户自带 data-ws2-ui="任意值" 不受影响（F1）。单一来源 = serialize.OVERLAY_VAL。
  const WS2_OVERLAY = (((typeof WS2Serialize !== 'undefined') ? WS2Serialize
    : (typeof require !== 'undefined' ? require('./serialize.js') : {})).OVERLAY_VAL) || '__ws2-overlay__';
  // 图片摄入纯逻辑 + 降采样管线（doc-images）：类型白名单 / 降采样 / canonical html / ingestImage。
  const II = (typeof WS2ImageIngest !== 'undefined') ? WS2ImageIngest
    : (typeof require !== 'undefined' ? require('../lib/image-ingest.js') : null);
  // i18n：renderer 全局 t()（node/test 上下文无 wsT 时回退 key，防 require 期崩）。
  const T = (k, p) => (global.wsT ? global.wsT(k, p) : k);

  // 斜杠 / 块操作的类型表（对齐 ui-demo SLASH_ITEMS）。labelKey 走 editor 命名空间、展示时 t() 解析。
  const SLASH_ITEMS = [
    { key: 'text', labelKey: 'blockText', tag: 'p' },
    { key: 'h1', labelKey: 'blockH1', tag: 'h1' },
    { key: 'h2', labelKey: 'blockH2', tag: 'h2' },
    { key: 'h3', labelKey: 'blockH3', tag: 'h3' },
    { key: 'h4', labelKey: 'blockH4', tag: 'h4' },
    { key: 'list', labelKey: 'blockBulletList', tag: 'ul' },
    { key: 'quote', labelKey: 'blockQuote', tag: 'blockquote' },
    // 下标引用已全改成 itemByKey('text')（U3 重构），重排/加项安全。
    { key: 'numbered', labelKey: 'blockNumberedList', tag: 'ol' },
    { key: 'todo', labelKey: 'blockTodoList', tag: 'ul', cls: 'ws-todo' },
    { key: 'callout', labelKey: 'blockCallout', tag: 'div', cls: 'ws-callout' },
    { key: 'toggle', labelKey: 'blockToggle', tag: 'details' }, // 可折叠块（Notion toggle）：newBlock 造 <details open><summary><p>，插入后光标落 summary
    { key: 'table', labelKey: 'blockTable', tag: 'table', kw: 'biaoge grid' }, // 表格块（Schema Table v1）：newBlock 造 canonical 种子（thead 1×3 + tbody 2×3），kw=拼音/同义词补充过滤
    { key: 'image', labelKey: 'blockImage', tag: null, image: true }, // 异步插入（走父层选图），不经 newBlock 同步造块
    { key: 'divider', labelKey: 'blockDivider', tag: 'hr' },
    { key: 'ai', labelKey: 'aiGenerate', tag: null, ai: true },
  ];
  const slashLabel = (it) => T('editor.' + it.labelKey);
  const filterSlash = (q) => {
    const s = (q || '').toLowerCase();
    return SLASH_ITEMS.filter((it) => !s || slashLabel(it).toLowerCase().includes(s) || it.key.includes(s) || (it.kw && it.kw.includes(s)));
  };
  const itemByKey = (k) => SLASH_ITEMS.find((it) => it.key === k); // 按 key 取（不依赖下标——加 h4 后下标会移）

  // 顶层块类型推断（标签 → ui-demo 块类型）
  function classify(el) {
    if (!el || el.nodeType !== 1) return 'other';
    const t = el.tagName;
    if (t === 'H1' || t === 'H2' || t === 'H3' || t === 'H4') return 'heading'; // U7：H4 封顶（h5/h6 = 不符合 Schema，由校验器判，不在此当 heading）
    if (t === 'P') return 'text';
    if (t === 'UL' || t === 'OL') return 'list';
    if (t === 'BLOCKQUOTE') return 'quote';
    if (t === 'HR') return 'divider';
    if (t === 'IMG') return 'image';
    // 带说明的图 <figure><img><figcaption> 也是图片原子块——不认的话会被当装饰块('other')，
    // 选中/块菜单/说明编辑全接不上（doc-images）。要求含 <img> 以排除非图 figure。
    if (t === 'FIGURE' && el.querySelector && el.querySelector('img')) return 'image';
    if (t === 'DETAILS') return 'toggle'; // 可折叠块：容器本身不可文字编辑（灰选中/拖拽/删），summary + 正文块另行可编辑
    if (t === 'TABLE') return 'table'; // 表格块：容器本身不可文字编辑（灰选/拖拽/整删原样，ED-A2），编辑能力下放 TD/TH（cell 级）
    return 'other';
  }
  // 可文字编辑的块：标题/正文/列表/引用 + 含直接文字的 div（callout/裸文本容器）。其余（图片/分隔线/
  // 复杂结构 div = designed）= 不可编辑、整块灰选中。
  function isEditableEl(el) {
    const c = classify(el);
    if (c === 'heading' || c === 'text' || c === 'list' || c === 'quote') return true;
    // callout（div.ws-callout）恒可编辑——即使被清空也要能再点进去（否则空 callout 成死块陷阱）
    if (el && el.classList && el.classList.contains('ws-callout')) return true;
    if (c === 'other' && fmt && fmt.isTextEditable(el)) return true;
    return false;
  }
  // 叶子文字块 = 可安全做「节点级拼接」（合并）的块。单一来源 = schema-model（已对抗加固：正向白名单，
  // 空 <ul>/void 块/透明包裹块都判非叶子——对它做 appendChild 平搬会产非法嵌套 / 吞文字）。合并前必须把关。
  function isLeafTextBlock(el) { return SM.isLeafTextBlock(el); }

  // 表格「数据行」集合（KTD7）：过滤分页 spacer 行（data-ws2-ui + .ws-page-spacer 双保险）——一切行列
  // 运算/导航/被罩集只认数据行，否则加列塞错行、Enter 跳进幽灵行（只在开分页的文档偶发）。
  // 嵌套表格不存在于合规文档（cell phrasing-only），querySelectorAll 不需要防嵌套。纯函数可单测。
  function tableRowsOf(table) { return [...table.querySelectorAll('tr')].filter((r) => !r.hasAttribute('data-ws2-ui') && !(r.classList && r.classList.contains('ws-page-spacer'))); }
  function rowCellsOf(tr) { return [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); }
  function firstCellOf(table) { return cellAt(table, 0, 0); }
  // cell 坐标 / 定点取格（都在过滤后的数据行集合上，KTD7）。
  function cellPosOf(table, cell) {
    const rows = tableRowsOf(table);
    for (let r = 0; r < rows.length; r++) { const c = rowCellsOf(rows[r]).indexOf(cell); if (c >= 0) return { row: r, col: c }; }
    return null;
  }
  function cellAt(table, row, col) { const tr = tableRowsOf(table)[row]; return tr ? (rowCellsOf(tr)[col] || null) : null; }
  // 线性被罩集（KTD3）：同表两格间按行主序展开的 cell 跨度（含两端，自动纠序）。高亮与删除共用这
  // 一个来源 = 「所见即所删」不靠两处循环各自维护；也免掉逐格 intersectsNode 的 O(全表) Range 开销。
  // 找不到任一端点（落在 tr 层等退化态）返 null。
  function cellSpanOf(table, sC, eC) {
    const rows = tableRowsOf(table);
    let sp = null, ep = null;
    for (let r = 0; r < rows.length; r++) {
      const cs = rowCellsOf(rows[r]);
      const si = cs.indexOf(sC), ei = cs.indexOf(eC);
      if (si >= 0) sp = { row: r, col: si };
      if (ei >= 0) ep = { row: r, col: ei };
    }
    if (!sp || !ep) return null;
    if (sp.row > ep.row || (sp.row === ep.row && sp.col > ep.col)) { const t = sp; sp = ep; ep = t; }
    const out = [];
    for (let r = sp.row; r <= ep.row; r++) {
      const cs = rowCellsOf(rows[r]);
      const from = r === sp.row ? sp.col : 0, to = r === ep.row ? ep.col : cs.length - 1;
      for (let c = from; c <= to; c++) if (cs[c]) out.push(cs[c]);
    }
    return out;
  }
  // 键盘导航目标（纯逻辑，可 jsdom 单测；单次全表遍历——这是逐击热路径，别一击三扫）。dir：next/prev
  //（Tab 序，行内先行）、down/up（同列跨行）、enter（下一行同列，末行要建行）。
  // 返回 {cell} / {newRow:true, col}（需建行）/ {exit:'up'|'down'}（越出表界）/ null。
  function cellNavTarget(table, cell, dir) {
    const rows = tableRowsOf(table);
    let pos = null;
    for (let r = 0; r < rows.length; r++) { const c = rowCellsOf(rows[r]).indexOf(cell); if (c >= 0) { pos = { row: r, col: c }; break; } }
    if (!pos) return null;
    const at = (r, c) => { const tr = rows[r]; return tr ? (rowCellsOf(tr)[c] || null) : null; };
    const nCols = rowCellsOf(rows[pos.row]).length;
    if (dir === 'next') {
      if (pos.col + 1 < nCols) return { cell: at(pos.row, pos.col + 1) };
      if (pos.row + 1 < rows.length) return { cell: at(pos.row + 1, 0) };
      return { newRow: true, col: 0 }; // 末格 Tab → 建行、落新行首格
    }
    if (dir === 'prev') {
      if (pos.col - 1 >= 0) return { cell: at(pos.row, pos.col - 1) };
      if (pos.row - 1 >= 0) { const pc = rowCellsOf(rows[pos.row - 1]); return { cell: pc[pc.length - 1] || null }; }
      return { exit: 'up' }; // 首格 Shift+Tab → 跳出到上一块
    }
    if (dir === 'down') { return (pos.row + 1 < rows.length) ? { cell: at(pos.row + 1, pos.col) } : { exit: 'down' }; }
    if (dir === 'up') { return (pos.row - 1 >= 0) ? { cell: at(pos.row - 1, pos.col) } : { exit: 'up' }; }
    if (dir === 'enter') { return (pos.row + 1 < rows.length) ? { cell: at(pos.row + 1, pos.col) } : { newRow: true, col: pos.col }; } // 末行 Enter → 建行、落同列
    return null;
  }

  // 表格种子（Schema Table v1 canonical，与 ai-guide 的 AI 生成契约同形）：<table class="ws-table"> +
  // thead 一行 th[scope=col] + tbody 数据行，空格带 <br>（光标落得进；<td><br></td> 校验合规）。
  // 矩形不变式在此源头成立。纯函数、可 jsdom 单测。
  // 行/列 DOM 手术（U5，纯函数可 jsdom 单测）。op：row-above/row-below/row-del/col-left/col-right/col-del。
  // 全部走过滤后的数据行集合（KTD7，spacer 行不参与也不被数）；每步保矩形；thead 特判：新行恒落 tbody
  //（表头行上/下插行都落 tbody 首位——thead ≤1 行是硬约束）、插列在表头行产 th[scope=col]；新格继承同列的
  // ws-al-* 对齐 class（列样板）。返回「落点格」（调用方 enterCell），{deletedTable:true}=退化态需删整表，null=拒绝。
  function tableEditOp(doc, table, cell, op) {
    const rows = tableRowsOf(table);
    const pos = cellPosOf(table, cell);
    if (!pos) return null;
    const row = pos.row, col = pos.col;
    const curRow = rows[row];
    const inThead = !!(curRow.parentElement && curRow.parentElement.tagName === 'THEAD');
    const anyTbody = () => { let tb = [...table.children].find((c) => c.tagName === 'TBODY'); if (!tb) { tb = doc.createElement('tbody'); table.appendChild(tb); } return tb; };
    const alClasses = (el) => el ? [...(el.classList || [])].filter((c) => c.indexOf('ws-al-') === 0) : [];
    const buildRow = (nCols, templateRow) => {
      const tr = doc.createElement('tr');
      for (let c = 0; c < nCols; c++) {
        const td = mkTableCell(doc, 'td');
        alClasses(templateRow ? rowCellsOf(templateRow)[c] : null).forEach((cl) => td.classList.add(cl));
        tr.appendChild(td);
      }
      return tr;
    };
    if (op === 'row-above' || op === 'row-below') {
      const nCols = rowCellsOf(curRow).length;
      const template = inThead ? (rows.find((r) => r.parentElement && r.parentElement.tagName !== 'THEAD') || null) : curRow;
      const tr = buildRow(nCols, template);
      if (inThead) { const tb = anyTbody(); tb.insertBefore(tr, tb.firstChild); }
      else if (op === 'row-above') curRow.parentElement.insertBefore(tr, curRow);
      else curRow.parentElement.insertBefore(tr, curRow.nextSibling);
      return rowCellsOf(tr)[Math.min(col, nCols - 1)] || null;
    }
    if (op === 'row-del') {
      const parent = curRow.parentElement;
      curRow.remove();
      if (parent && !parent.querySelector('tr')) parent.remove(); // 空壳（thead/tbody）整删，不留 <thead></thead>
      const rest = tableRowsOf(table);
      if (!rest.length) return { deletedTable: true }; // 删光 → 升级删整表（绝不留 <table></table> ghost）
      if (!inThead && !rest.some((r) => r.parentElement && r.parentElement.tagName === 'TBODY')) {
        // 删掉最后一个数据行、表头尚存 → 自动补一空行（tbody ≥1 文法；Colin 拍板的退化收敛）
        const nCols = rowCellsOf(rest[0]).length;
        const tb = anyTbody(); const tr = buildRow(nCols, null); tb.appendChild(tr);
        return rowCellsOf(tr)[Math.min(col, nCols - 1)] || null;
      }
      const t = rest[Math.min(row, rest.length - 1)];
      const cs = rowCellsOf(t);
      return cs[Math.min(col, cs.length - 1)] || null;
    }
    if (op === 'col-left' || op === 'col-right') {
      const at = op === 'col-left' ? col : col + 1;
      for (const r of rows) {
        const cs = rowCellsOf(r);
        const isHead = !!(r.parentElement && r.parentElement.tagName === 'THEAD');
        const nc = mkTableCell(doc, isHead ? 'th' : 'td');
        if (isHead) nc.setAttribute('scope', 'col');
        alClasses(cs[col]).forEach((cl) => nc.classList.add(cl)); // 新列继承参照列对齐
        const ref = cs[at] || null;
        if (ref) r.insertBefore(nc, ref); else r.appendChild(nc);
      }
      const nr = tableRowsOf(table)[row];
      return nr ? (rowCellsOf(nr)[at] || null) : null;
    }
    if (op === 'col-del') {
      if (rowCellsOf(curRow).length <= 1) return { deletedTable: true }; // 删最后一列 → 升级删整表
      for (const r of rows) { const c = rowCellsOf(r)[col]; if (c) c.remove(); }
      const nr = tableRowsOf(table)[row];
      if (!nr) return { deletedTable: true };
      const cs = rowCellsOf(nr);
      return cs[Math.min(col, cs.length - 1)] || null;
    }
    return null;
  }

  // 空格的 canonical 形态 = <td/th><br></td>（<br> 让光标落得进）——种子/建行共用的契约。
  function mkTableCell(doc, tag) { const c = doc.createElement(tag); c.appendChild(doc.createElement('br')); return c; }
  function tableSeed(doc, cols, bodyRows) {
    cols = cols || 3; bodyRows = bodyRows || 2;
    const table = doc.createElement('table'); table.className = 'ws-table';
    const thead = doc.createElement('thead'); const htr = doc.createElement('tr');
    for (let c = 0; c < cols; c++) { const th = mkTableCell(doc, 'th'); th.setAttribute('scope', 'col'); htr.appendChild(th); }
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    for (let r = 0; r < bodyRows; r++) { const tr = doc.createElement('tr'); for (let c = 0; c < cols; c++) tr.appendChild(mkTableCell(doc, 'td')); tbody.appendChild(tr); }
    table.appendChild(tbody);
    return table;
  }

  // 真正承载「块」的容器。多数「像样」的文档把正文包在一个居中/限宽的容器里
  // （<body> 底下只有这一个 <div class="wrap"> / <main> 之类）。若死认 <body> 为块容器，
  // 整篇会塌成单个不可编辑块——点哪都进不去编辑。这是真实文档最常见的结构（容器 div 做居中限宽），
  // 必须穿透。规则：从 body 向下钻，当当前容器「只有一个实体元素孩子」、那孩子是无语义包裹容器
  // （div/section/article/main）、且它自己还含元素孩子（钻下去确有块）时，下钻一层；否则停。
  // 处理 body>div.wrap>[blocks] 乃至多层嵌套；单个纯文字 div 不钻（它本身就是可编辑块）。
  const WRAP_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN']);
  function realEls(el) {
    const out = [];
    for (const c of el.children) {
      if (c.nodeType === 1 && !(c.hasAttribute && c.hasAttribute('data-ws2-ui'))) out.push(c);
    }
    return out;
  }
  function pickBlockRoot(body) {
    let root = body;
    for (let depth = 0; depth < 8; depth++) { // 上限防异常深嵌套
      const kids = realEls(root);
      if (kids.length !== 1) break;
      const only = kids[0];
      if (!WRAP_TAGS.has(only.tagName)) break;     // 独子不是无语义容器（如它本身是 <p>/<ul>）→ 停
      if (realEls(only).length === 0) break;        // 纯文字容器：它自己就是可编辑块，别钻成空
      root = only;
    }
    return root;
  }

  // §0 决策：编辑器不主动套装饰排版（原 docHasAuthorStyles + data-ws2-canvas 那套 Notion 居中窄栏已删）。
  // 显示永远按 .html 原生；让块渲染正确的最小语义 CSS（margin/callout/todo）由 Schema baseline 随文件入盘（U5）。

  function caretRangeAtPoint(doc, x, y) {
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) { const r = doc.createRange(); r.setStart(pos.offsetNode, pos.offset); r.collapse(true); return r; }
    }
    return null;
  }
  function isCaretAtEnd(doc, el) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.endContainer)) return false;
    const after = doc.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(el, el.childNodes.length);
    return after.toString().trim() === '';
  }
  function isCaretAtStart(doc, el) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.startContainer)) return false;
    const before = doc.createRange();
    before.setStart(el, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    return before.toString() === '';
  }
  // 严格块末判定：光标右侧确无任何可见字符/元素（最多容一个末尾填充 <br>——浏览器给空块/末行补的占位）。
  // 区别于 isCaretAtEnd 的 trim()——后者把尾随空格/块内 <br> 也当块末，会让「段内按 →/Delete」误触发
  // 跨块跳转/前向合并（对抗验证 B 组）。破坏性操作（跨块右移、前向合并、Enter 劈块分流）必须用这个严格版。
  function isCaretAtRealEnd(doc, el) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const caret = sel.getRangeAt(0);
    if (!el.contains(caret.endContainer)) return false;
    const after = doc.createRange();
    after.setStart(caret.endContainer, caret.endOffset);
    after.setEnd(el, el.childNodes.length);
    const frag = after.cloneContents(); // 克隆、不动原 DOM
    const last = frag.lastChild;
    if (last && last.nodeType === 1 && last.tagName === 'BR') frag.removeChild(last); // 去掉一个末尾填充 br
    return (frag.textContent || '') === '' && !frag.querySelector('*'); // 不 trim：尾随空格算「有内容」
  }

  function attach(doc, deps) {
    deps = deps || {};
    const win = deps.win || doc.defaultView;
    const undoMgr = deps.undoMgr || null;
    const markDirtyRaw = deps.markDirty || (() => {});
    // 每次标脏顺带同步 toggle 空态标记（结构变更：增删块 / 拖拽 / 转换 / 粘贴都会经过这里，P3-7）
    const markDirty = (...a) => { try { refreshToggleEmpty(); } catch (x) {} try { normalizeHostLi(); } catch (x) {} return markDirtyRaw(...a); };
    const onAiSoon = deps.onAiSoon || (() => {});
    const pickImages = deps.pickImages || null; // 图片插入：() => Promise<[{name,mime,base64}]>（父层原生选择器，U3）
    const body = doc.body;
    let live = true; // detach 后置 false：图片摄入是 async，插入前查它防「图插进已换掉的文档」（shell loadGen 竞态）
    // 块容器：穿透居中/限宽包裹容器（见 pickBlockRoot）。撤销/重做会整体重写 body.innerHTML、
    // 重建包裹节点 → 旧引用失效，故在 reset() 里重算（let 而非 const）。
    let blockRoot = pickBlockRoot(body);

    // ---- 注入排版样式表（构造样式表 / adoptedStyleSheets，CSP-safe、不进序列化）----
    // 空块/图片说明占位文案随语言：EDITOR_CSS 是模块期定的静态常量，占位文本在 attach 期用 t() 拼进来
    //（走 adoptedStyleSheets 不入序列化；切文档重 attach 时取当前语言）。cssEsc 防文案里的引号/反斜杠破 CSS 串。
    const cssEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const placeholderCss =
      "p[data-ws2-editing]:empty::before{content:'" + cssEsc(T('editor.emptyBlockPlaceholder')) + "';color:#8a8f96;pointer-events:none;}" +
      "figcaption[data-ws2-ce]:empty::before{content:'" + cssEsc(T('editor.figcaptionPlaceholder')) + "';color:#8a8f96;pointer-events:none;}" +
      // 空 toggle 的占位（对拍 T17：Notion 写 "Empty toggle. Click or drop blocks inside."，我们原来是
      // 一行纯空白、看不出这里能放东西）。**编辑器 chrome、不入盘**——浏览器直开时不该出现这行提示。
      // 判据：展开态且体内只有一个空叶子块。:has() 在 Chromium 可用；不可用时仅退化为无占位。
      "details[open][data-ws2-empty] > :not(summary)::before{content:'" + cssEsc(T('editor.emptyTogglePlaceholder')) + "';color:#8a8f96;pointer-events:none;}" +
      // 空 toggle 的三角淡一档（Notion 同款区分：一眼看出这个折叠块里没东西）
      "details[data-ws2-empty] > summary::before{border-color:#c4c8cd;}" +
      // E5：从「+」唤起块类型选择器时，该空块的占位改成「输入以筛选…」（Notion 实测同款：
      // 它那会儿显示 "Type to filter…" 而不是平时的 "Press ‘space’ for AI or ‘/’ for commands"）。
      // 优先级要压过上面那条通用空块占位 —— 靠属性选择器多一个条件自然更高。
      "[data-ws2-picking] [data-ws2-editing]:empty::before{content:'" + cssEsc(T('editor.pickerFilterPlaceholder')) + "' !important;color:#8a8f96;pointer-events:none;}";
    let sheet = null;
    try {
      sheet = new (win.CSSStyleSheet || CSSStyleSheet)();
      sheet.replaceSync(EDITOR_CSS + placeholderCss);
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), sheet];
    } catch (e) {
      // 退路：构造样式表不可用时，用一个 data-ws2-ui 的 <style>（仍不入序列化，因 data-ws2-ui 整节点剥除）
      const st = doc.createElement('style');
      st.setAttribute('data-ws2-ui', WS2_OVERLAY);
      st.textContent = EDITOR_CSS + placeholderCss;
      (doc.head || doc.documentElement).appendChild(st);
    }
    // §0：编辑器不套 canvas 装饰排版（已删）。data-ws2-root 仍打——只驱动「空块占一行高度」这种编辑可用性 CSS（非装饰），存盘剥除。
    const BASELINE_CSS =
      ':where(body){max-width:820px;margin:0 auto;padding:48px 60px;box-sizing:border-box;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;' +
        'font-size:16px;line-height:1.75;color:#37352f;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}' +
      ':where(h1){font-size:1.875em;line-height:1.3;font-weight:700;letter-spacing:-.011em;margin:1.35em 0 .45em}' +
      ':where(h2){font-size:1.5em;line-height:1.35;font-weight:600;letter-spacing:-.008em;margin:1.25em 0 .4em}' +
      ':where(h3){font-size:1.25em;line-height:1.4;font-weight:600;margin:1.1em 0 .35em}' +
      ':where(h4){font-size:1.125em;line-height:1.45;font-weight:600;margin:1em 0 .3em}' +
      ':where(body>h1:first-child,body>h2:first-child,body>h3:first-child){margin-top:.2em}' +
      ':where(p){margin:.5em 0}' +
      ':where(ul,ol){margin:.5em 0;padding-left:1.7em}' +
      // 嵌套 marker（2026-08-04 复跑对拍**更正**）：Notion 实测——
      //   编号列表 **每一层都是十进制**（1. 2. 3.，逐层重新从 1 起），**没有** a./i. 那套字母/罗马循环；
      //   圆点列表才逐级循环 •/◦/▪（disc/circle/square）。
      // ⚠ 上一批曾按「1./a./i.」加过 ol 的循环规则，那是**没量就改**的产物（a./i. 是 Word/Google Docs 的
      //   惯例，不是 Notion 的）。已删除——`ol` 不写 list-style-type，浏览器默认就是逐层十进制，正好对。
      //   实证：Notion 二级项 marker 字面值 `--pseudoBefore--content: "1." / "2." / "3."`。
      // 零权重 :where() 保证 ws-todo 的 list-style:none 与用户自定义样式照常压过它。
      ':where(ul ul){list-style-type:circle}' +
      ':where(ul ul ul){list-style-type:square}' +
      ':where(ul ul ul ul){list-style-type:disc}' +
      ':where(ul ul ul ul ul){list-style-type:circle}' +
      ':where(ul ul ul ul ul ul){list-style-type:square}' +
      ':where(li){margin:.3em 0}' +
      ':where(li>ul,li>ol){margin:.15em 0}' +
      ':where(blockquote){margin:.7em 0;padding:2px 0 2px 14px;border-left:3px solid #d9d7d2}' +
      ':where(table){border-collapse:collapse;margin:.8em 0}' +
      ':where(th,td){border:1px solid #e3e2de;padding:7px 12px;text-align:left;vertical-align:top}' +
      ':where(th){background:#f7f6f3;font-weight:600}' +
      ':where(code){font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.875em;background:#f2f1ee;border-radius:4px;padding:.15em .4em}' +
      ':where(pre){background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;overflow-x:auto;line-height:1.6}' +
      ':where(pre code){background:none;padding:0;font-size:.875em}' +
      ':where(hr){border:none;border-top:1px solid #e3e2de;margin:2em 0}' +
      ':where(a){color:#1a73e8;text-decoration-color:rgba(26,115,232,.35);text-underline-offset:2px}' +
      // 顶层图片各占一行（对拍 I8）：img 默认 inline，多张顶层图会并排挤成一行，与「图片是顶层块」
      // 的编辑器模型自相矛盾（选中/拖拽/方向键都按 1 个块处理）。直接后果实测过：第二张图的 ⋮⋮ 手柄
      // 被画在第一张图的图面上，用户无法凭视觉分清手柄属于哪块。
      ':where(img){max-width:100%;height:auto;display:block}' +
      // ⚠ 豁免行内图片：IMG 同时是合法 phrasing（schema-model.js 的 PHRASING_TAGS 含 IMG），
      // <p>文字 <img> 文字</p> 是合规内容。不豁免的话它会被打断成三行 = 静默的保真损伤
      // （比并排挤成一行更糟，因为坏了没人看得见）。用后代组合子以覆盖 <p><a><img></a></p> 这类包一层的。
      // 零权重 :where() + 源序在后 → 同权重下后者胜，行内态压过上面的 block。
      ':where(:is(p,h1,h2,h3,h4,li,td,th,blockquote,figcaption,summary,.ws-callout) img){display:inline}' +
      ':where(figure){margin:1em 0}' +
      ':where(figure>img){display:block}' +
      ':where(figcaption){margin-top:6px;font-size:.875em;line-height:1.5;color:#78716c;text-align:center}';
    const TODO_CSS = '.ws-todo{list-style:none}.ws-todo ul:not(.ws-todo){list-style:disc}.ws-todo ol:not(.ws-todo){list-style:decimal}.ws-todo>li{list-style:none;position:relative;padding-left:4px}.ws-todo>li::before{content:"";position:absolute;left:-22px;top:.38em;width:16px;height:16px;box-sizing:border-box;border:1.5px solid #8a857c;border-radius:4px;background:#fff;cursor:pointer}.ws-todo>li[data-checked="true"]{color:#9b9891}.ws-todo>li[data-checked="true"]:not(:has(ul,ol)){text-decoration:line-through}.ws-todo>li[data-checked="true"] :is(ul,ol){color:#37352f}.ws-todo>li[data-checked="true"]::before{content:"\\2713";border-color:#1a73e8;background:#1a73e8;color:#fff;font-size:11px;line-height:13px;text-align:center}';
    const CALLOUT_CSS = '.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;margin:14px 0}.ws-callout>p{margin:6px 0}.ws-callout>p:first-child{margin-top:0}.ws-callout>p:last-child{margin-bottom:0}';
    // toggle（<details>）入盘语义 CSS：干掉原生三角（双配方 list-style + webkit marker）+ 细线 chevron + 正文缩进。
    // 随 serialize 存盘 → app 外任何浏览器打开都渲染成折叠块、零 JS 折叠（R10）。校验器 head 白名单按 data-ws-schema-css 属性放行。
    // chevron 对齐 ui-demo 的 lucide 细线视觉（Wendi 2026-07-24「实心大三角丑、不 blend in」）：border 两边画「›」，
    // 纯 CSS 零资源（文档自带 CSP 也拦不到，S4 教训不用 data:URI 图）。折叠指右 -45°、展开指下 45°；
    // 几何：盒 .42em 居中于首行（margin-top=(1.75-.42)/2≈.67em），水平 .2+.42+.48=1.1em 占位与旧版等宽（正文缩进 22px 不变）。
    // 线粗 1.5px = ui-demo lucide strokeWidth 2.2 @24viewBox×16px 的实际渲染粗细；hover 墨色加深（纸方墨圆）。
    // 旧文档 attach 时 refreshSemanticStyles ①升级路径按内容 diff 自动覆写，无需迁移。
    const TOGGLE_CSS = 'details{margin:8px 0}details>summary{list-style:none;cursor:pointer;display:flex;align-items:flex-start;gap:6px}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"";flex:none;box-sizing:border-box;width:.42em;height:.42em;margin:.67em .48em 0 .2em;border-right:1.5px solid #8a8f96;border-bottom:1.5px solid #8a8f96;border-radius:.5px;transform:rotate(-45deg);transition:transform .15s ease,border-color .15s ease}details>summary:hover::before{border-color:#37352f}details[open]>summary::before{transform:rotate(45deg)}details>*:not(summary){margin-left:22px}';
    // §0 决策1 固定色板（块级上色 class；也是入盘 color CSS 的单一来源）。
    const TEXT_COLORS = ['#1c1d1f', '#d93025', '#b06000', '#1e8e3e', '#1a73e8', '#8430ce'];
    const COLOR_CSS = TEXT_COLORS.map((c) => '.ws-color-' + c.slice(1) + '{color:' + c + '}').join('');
    // Track2 方案B（2026-07-24 拍板，§1.3 例外）：段落整块缩进 = 有限 class 原语（照 ws-color 四段式）。
    // position:relative+left 保文档流不重排；不用 transform（Retina 合成层亚像素抖）、不用 margin/padding（挤动下方块）。
    const INDENT_MAX = 6;
    const INDENT_STEP = 24; // px/档，整数像素
    const INDENT_CSS = Array.from({ length: INDENT_MAX }, (_, i) =>
      '.ws-indent-' + (i + 1) + '{position:relative;left:' + ((i + 1) * INDENT_STEP) + 'px}').join('');
    // 表格 cell 对齐入盘 CSS（U6/KTD8：唯一新增的语义 pair——边框/内距已在 BASELINE_CSS）。文法：ws-al-* 是 cell 级 class。
    const ALIGN_CSS = '.ws-al-center{text-align:center}.ws-al-right{text-align:right}';
    blockRoot.setAttribute('data-ws2-root', '');
    ensureSchemaBaseline(); // baseline 排版底线入盘（v2：字体/行高/标题节奏/块间距；旧文件静默升级；不 markDirty）
    refreshSemanticStyles(); // 旧文件的 todo/callout v1 语义 CSS → 同步升级到当前版（同上不 markDirty）
    try { normalizeHostLi(); } catch (x) {} // 「空壳宿主行」在 **attach 时**就修（照上面两条静默升级的先例，不 markDirty）
    // ⚠ 只挂在 markDirty 上不够：已经被写坏的老文档要等用户敲一下才自愈，打开时照样是「一行两个勾选框」。

    // ---- 状态 ----
    let selectedEl = null;   // 灰选中的不可编辑块
    let editingEl = null;    // 正在文字编辑的块
    let hoverEl = null;      // 鼠标悬停的块（驱动 ⋮⋮ 定位）
    let hoverRow = null;     // 悬停块为列表时的悬停行 <li>（U1 行级手柄；非列表块恒 null）
    // 手柄的**作用对象**单一真相源（对拍 I4）：手柄画在谁旁边，点它/拖它/点「+」就作用于谁。
    // 此前「画」看 hoverRow||hoverEl（onMouseMove 无条件跟手）、「做」看 selectedEl||hoverEl（选中优先），
    // 两套口径不同源 —— 选中图片后悬停别的块，手柄画到新块旁却仍删/拖那张图（P1，见 docs/features/doc-images.md）。
    // 由 positionGrip 唯一写入、setGutterVisible(false) 唯一清除，别在别处赋值。
    let gripEl = null;       // 手柄当前锚定的**块**
    let gripRow = null;      // 锚点是 <li> 时的行作用域目标（非行锚恒 null）
    let menuRow = null;      // U3 行作用域菜单的目标行（仅行模式非空；随 closeBlockMenu 清）
    let slash = null;        // { blockEl, query, active }
    let dragFrom = null;     // 拖拽重排的源块
    let fmtShown = false;    // 格式气泡是否显示——「粘住」用：选区折叠后不立即关，直到离开该块
    let dragStart = null;    // 拖拽选择起点 {x,y}（mousedown 记、mouseup 清）；用来分辨「点击」vs「拖选」
    let wallDropped = false; // 本次拖选是否已摘掉编辑块的 contenteditable（放倒「跨块选区被钉死在单块里」那道墙）
    let listSplitPending = false; // U6：list 回车交原生分裂后，一次性 input 里剥新 li 的克隆 id/data-checked（防栈叠）
    let cellEl = null;       // 正在编辑的表格单元格 TD/TH（第四状态，仿 captionEl：generic 块级分支对它 inert，KTD1）
    let cellPad = { top: 0, bottom: 0 }; // 当前编辑格的上下 padding（enterCell 时缓存，↑↓ 视觉行判定用）
    let captionEl = null;    // 正在编辑的图片说明 figcaption（不同于 editingEl/selectedEl：块级破坏性键盘分支对它 inert）
    let captionOrig = '';    // 进说明编辑时的原文本（判是否真变、决定要不要 checkpoint）
    let captionWasNew = false; // 本次说明由「加说明」新建（空白失焦即撤销=降回裸 img，且不留空撤销步）

    // ---- 覆盖层节点（data-ws2-ui，存盘剥除）----
    function mk(tag, cls) { const n = doc.createElement(tag); n.setAttribute('data-ws2-ui', WS2_OVERLAY); n.setAttribute('contenteditable', 'false'); if (cls) n.className = cls; return n; }

    // ⋮⋮ 手柄（单个浮动，跟随 hover/选中块）
    const grip = mk('div', 'ws-grip');
    grip.style.position = 'absolute';
    grip.style.display = 'none';
    grip.setAttribute('draggable', 'true');
    grip.title = T('editor.gripTip');
    grip.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
    doc.documentElement.appendChild(grip);

    // U4「+」快捷插入钮（gutter 里紧挨手柄左侧，同显同隐；作用对象与手柄一致 = 行或块）
    const plus = mk('div', 'ws-plus');
    plus.style.position = 'absolute';
    plus.style.display = 'none';
    plus.title = T('editor.plusTip');
    plus.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    doc.documentElement.appendChild(plus);
    // 手柄与「+」永远同显同隐（分开控制必漏一处 → 幽灵按钮），显隐一律走这个口子。
    // 手柄不可见 = 没有作用对象：一起清 gripEl/gripRow，否则隐藏后残留的旧目标会在下次显示前被用上。
    function setGutterVisible(show) { const v = show ? 'flex' : 'none'; grip.style.display = v; plus.style.display = v; if (!show) { gripEl = null; gripRow = null; } }

    // 格式气泡
    const fmtbar = mk('div', 'ws-fmtbar');
    fmtbar.style.display = 'none';
    doc.documentElement.appendChild(fmtbar);

    // 焦点接盘（⌘A 全篇第二级）：放墙 exitEdit 摘掉 contenteditable 会把键盘焦点甩出 iframe，
    // 后续 Backspace/⌘X 就进不了 doc 的 keydown、跨块删管线够不着（e2e 实锤）。全篇选中后把焦点
    // 停在这个隐形 UI 元素上（sentinel data-ws2-ui：serialize 整删、零入盘污染；opacity:0 不可见但可编程 focus）。
    const focusCatcher = mk('span');
    focusCatcher.setAttribute('tabindex', '-1');
    focusCatcher.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;outline:none;pointer-events:none;';
    doc.documentElement.appendChild(focusCatcher);

    // 块操作菜单
    const blockMenu = mk('div', 'ws-blockmenu');
    blockMenu.style.position = 'absolute';
    blockMenu.style.display = 'none';
    doc.documentElement.appendChild(blockMenu);

    // 斜杠菜单
    const slashMenu = mk('div', 'ws-slashmenu');
    slashMenu.style.position = 'absolute';
    slashMenu.style.display = 'none';
    doc.documentElement.appendChild(slashMenu);

    // cell 拒收提示小签（Colin 2026-08-03：拒收必须可感知；纸方墨圆——墨色圆角、淡入淡出、不抖不闪红）。
    // 有意不用 __wsToast：提示要**锚在被拒的格上**（空间归因清晰），全局 toast 看不出是哪格拒了什么。
    const cellNope = mk('div', 'ws-cellnope');
    doc.documentElement.appendChild(cellNope);
    let cellNopeTimer = null;
    function showCellNope(cell) {
      cellNope.textContent = T('editor.cellTextOnly');
      const r = cell.getBoundingClientRect(); const { sx, sy } = vp();
      cellNope.style.left = (r.left + sx) + 'px';
      cellNope.style.top = (r.top + sy - 34) + 'px';
      cellNope.classList.remove('ws-cellnope--on');
      void cellNope.offsetWidth; // 重启过渡（连续触发时从头淡入）
      cellNope.classList.add('ws-cellnope--on');
      if (cellNopeTimer) global.clearTimeout(cellNopeTimer);
      cellNopeTimer = global.setTimeout(() => { cellNope.classList.remove('ws-cellnope--on'); }, 1600);
    }

    const docOf = () => doc;
    function topBlocks() { return [...blockRoot.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')); }
    // Track2 方案B：ws-indent 三 helper（互斥语义靠 stripIndent 先清全量，照 ws-color 的 forEach-remove 套路）。
    // ⚠ 必须留在 attach() 内——INDENT_MAX/ensureIndentStyle 都是 attach 局部量，放模块层一按 Tab 就 ReferenceError。
    function indentLevelOf(el) { for (let n = INDENT_MAX; n >= 1; n--) if (el.classList.contains('ws-indent-' + n)) return n; return 0; }
    function stripIndent(el) { for (let n = 1; n <= INDENT_MAX; n++) el.classList.remove('ws-indent-' + n); }
    function setIndentLevel(el, n) { stripIndent(el); if (n > 0) { el.classList.add('ws-indent-' + n); ensureIndentStyle(); } }
    // 表格门控（KTD7）说明：无表格文档 100% 走旧路径这一保证由结构自动成立——所有 cell 入口都先要求
    // closest('td,th') 命中（无表文档恒 null）+ blockOf/classify==='table' 复核（更强判据），不需要、也不要
    // 加全文档 querySelector('table') 的显式门（每次点击 O(全文档) 白扫，simplify 审查已证它改不了任何结果）。
    // ---- toggle 嵌套作用域（scoped block-root，U6）：<details> 体是自己的编辑作用域，与已发版多根 keyOf=rootId:rel 同心智 ----
    // 作用域根 = 直接子元素是「块」的容器：blockRoot 或 <details>（其子 = summary + 正文块）。
    function scopeRootOf(node) {
      let el = node; if (el && el.nodeType === 3) el = el.parentElement;
      while (el && el !== blockRoot) { if (el.tagName === 'DETAILS') return el; el = el.parentElement; }
      return blockRoot;
    }
    // 作用域内的「块」= 作用域根的直接元素子（排除覆盖层 + summary）。
    function blocksInScope(root) { return [...root.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui') && c.tagName !== 'SUMMARY'); }
    function summaryOf(det) { return (det && [...det.children].find((c) => c.tagName === 'SUMMARY')) || null; }
    // 把块上卷到它所属的顶层块（blockRoot 的直接子）——跨作用域整块删 / 顶层操作用。
    function topScopeOf(el) { while (el && el.parentElement && el.parentElement !== blockRoot) el = el.parentElement; return (el && el.parentElement === blockRoot) ? el : null; }
    function blockOf(node) {
      let el = node; if (el && el.nodeType === 3) el = el.parentElement;
      if (!el) return null;
      // 门控：文档无 <details> → 原扁平逻辑（既有 200+ e2e 零风险，对抗验证要求）
      if (!blockRoot.querySelector('details')) {
        while (el.parentElement && el.parentElement !== blockRoot) el = el.parentElement;
        return (el.parentElement === blockRoot && !el.hasAttribute('data-ws2-ui')) ? el : null;
      }
      // 有 toggle：停在 parent 是作用域根（blockRoot 或 details）的元素 = scoped 块
      while (el.parentElement && el.parentElement !== blockRoot && el.parentElement.tagName !== 'DETAILS') el = el.parentElement;
      if (el.hasAttribute('data-ws2-ui')) return null;
      const p = el.parentElement;
      if (p !== blockRoot && !(p && p.tagName === 'DETAILS')) return null; // 作用域外 / 空白
      if (el.tagName === 'SUMMARY') return p; // summary 节点 → 归属其 details（供跨块删保护 / 灰选整块）
      return el;
    }

    // 列表块内的悬停行解析（U1 行级手柄）：纯按 clientY 找行——同 Y 命中多个嵌套层级取**最深**
    // （父项的盒子包含嵌套行，浅层命中永远成立，取深层才是指针真正所在的行）。
    // ⚠ 不能用 closest('li')：鼠标在嵌套行的勾选框 gutter 上时命中的是嵌套 <ul> 容器（勾选框画在
    // 它 padding 里），closest 往上爬到父项 → 手柄跳走「躲鼠标」（Colin 试玩实抓）。Y 语义也与
    // Notion 一致：手柄跟指针所在行，与 X 无关。
    function rowOf(target, listEl, clientY) {
      let best = null, bestD = Infinity, bestDepth = -1;
      for (const li of listEl.querySelectorAll('li')) {
        const r = li.getBoundingClientRect();
        const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        let depth = 0;
        for (let p = li.parentElement; p && p !== listEl; p = p.parentElement) depth++;
        if (d < bestD || (d === bestD && depth > bestDepth)) { bestD = d; bestDepth = depth; best = li; }
      }
      return best;
    }

    // ---- 定位 ----
    function vp() { return { sx: (win.scrollX || 0), sy: (win.scrollY || 0) }; }
    // gutter 的**锚点**也要像显隐那样收成单一出口（P2-3）：此前 enterEdit/onScroll 只认 hoverEl，
    // 手柄跳回列表首行、而「+」/菜单/拖拽仍作用于 hoverRow 指的那一行 = 画的和做的不是同一行。
    function gutterAnchor() {
      if (hoverRow && hoverRow.isConnected) return hoverRow;
      return selectedEl || hoverEl;
    }
    function positionGrip(el) {
      if (!el || !el.isConnected) { setGutterVisible(false); return; } // 防已删块的幽灵手柄
      const r = el.getBoundingClientRect();
      const { sx, sy } = vp();
      // 行锚（U1）：<li> 的横向锚取其所在列表左缘——li.left-28 会正压 ws-todo 勾选框（勾选框
      // 画在 li 左缘外侧的 gutter 里）；锚父列表则顶层行手柄落列表外侧、嵌套行仍随缩进右移。
      const xr = (el.tagName === 'LI' && el.parentElement) ? el.parentElement.getBoundingClientRect() : r;
      grip.style.left = (xr.left + sx - 28) + 'px';
      plus.style.left = (xr.left + sx - 50) + 'px'; // U4：「+」在手柄左侧一格（22px 宽 + 间距）
      // 手柄对块首行的视觉中线（#86）：按首行行高把 22px 手柄垂直居中——标题行高大时手柄不再顶在块顶。
      const cs = doc.defaultView.getComputedStyle(el);
      let lh = parseFloat(cs.lineHeight);
      if (!lh || Number.isNaN(lh)) lh = (parseFloat(cs.fontSize) || 15) * 1.5;
      const top = (r.top + sy + Math.max(0, (Math.min(lh, r.height) - 22) / 2)) + 'px';
      grip.style.top = top; plus.style.top = top;
      gripRow = (el.tagName === 'LI') ? el : null;
      gripEl = gripRow ? (blockOf(el) || el) : el;
      setGutterVisible(true);
    }
    function showFmtAt(left, top) {
      const { sx, sy } = vp();
      fmtbar.style.position = 'absolute';
      fmtbar.style.left = (left + sx) + 'px';
      // 视口顶部保护：选区/块在文档顶部时（如首块），上方 46px 放不下会把气泡推到屏外、按钮点不到。
      // 之前被 canvas padding-top 掩盖（块被推下），§0 删 canvas 后块贴顶暴露此缺陷。clamp 到视口顶 +6。
      fmtbar.style.top = Math.max(top + sy - 46, sy + 6) + 'px';
      fmtbar.style.display = 'flex';
      fmtShown = true;
    }
    function positionFmtbar() {
      const sel = doc.getSelection();
      // ① 编辑态有非折叠选区 → 跟随选区
      if (editingEl && sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) { showFmtAt(r.left + r.width / 2, r.top); return; }
      }
      // ② 块选中（非编辑）→ 浮块上方
      if (!editingEl && selectedEl && isEditableEl(selectedEl)) {
        const r = selectedEl.getBoundingClientRect();
        showFmtAt(r.left + Math.min(r.width / 2, 180), r.top); return;
      }
      // ③ 粘住：已显示且仍在编辑同一块（选区折叠，如刚点了格式按钮/移光标）→ 保持显示、锚到块上方，
      //    直到离开该块（点别的块/空白/Esc）才关。这样「改一下不会马上关掉气泡」。
      if (fmtShown && editingEl) {
        const r = editingEl.getBoundingClientRect();
        showFmtAt(r.left + Math.min(r.width / 2, 180), r.top); return;
      }
      // ④ 拖选出来的跨块 / homeless 选区（无 editingEl，但有非折叠选区）→ 也弹气泡，否则跨块选完没法
      //    点加粗/取色。拖动中（dragStart 还在）不弹，免得跟着手抖闪。
      if (!editingEl && !dragStart && sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (r.width || r.height) { showFmtAt(r.left + r.width / 2, r.top); return; }
      }
      fmtbar.style.display = 'none'; fmtShown = false;
    }

    // ---- 选中 / 编辑 ----
    function clearSelectedAttr() { const p = body.querySelector('[data-ws2-selected]'); if (p) p.removeAttribute('data-ws2-selected'); }

    // 跨块拖选的「块级高亮」（Wendi 2026-07-22 引入；Colin 2026-07-24 二轮改**精确模式**：「鼠标从哪
    // 到哪，高亮就从哪到哪，不加不减」）——只有内容**完全被选区罩住**的行单位才整行标 data-ws2-rangesel
    //（蓝底+隐原生 ::selection）；端点块部分选中保持原生文字高亮，不补全、不上卷。行单位 = 顶层块、
    // toggle 的 summary 行、toggle 体内块（整个 toggle 被罩时标 details 本身）。唯一例外：端点落在
    // table 内 → 该 table 整行蓝（部分裁剪表格必产非合规，删除只能整删=ED-A2，高亮预示之，所见即所删）。
    // data-ws2-rangesel 进 serialize 白名单剥除（纯交互态、绝不入盘）。
    let rangeSelEls = [];
    function clearRangeSel() { if (rangeSelEls.length) { rangeSelEls.forEach((el) => el.removeAttribute && el.removeAttribute('data-ws2-rangesel')); rangeSelEls = []; } }
    function refreshRangeSel() {
      clearRangeSel();
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (!sBlk || !eBlk) return;
      const covered = (el) => {
        // 元素内容完全 ⊆ 选区 = 块内容在选区**外**的溢出部分为空（无文字、无媒体原子）。不用
        // compareBoundaryPoints 比端点——(p.firstChild,0) 会被判在 (p,0) 之后，「从文字头选到文字尾」
        // 的整块选中会被误判未全罩。溢出法对空块/端点贴边全部正确（Range.setEnd 早于 start 时自动塌陷）。
        try {
          const br = doc.createRange(); br.selectNodeContents(el);
          const before = br.cloneRange(); try { before.setEnd(r.startContainer, r.startOffset); } catch (x) { before.collapse(true); }
          const after = br.cloneRange(); try { after.setStart(r.endContainer, r.endOffset); } catch (x) { after.collapse(false); }
          const hasStuff = (rg) => rg.toString().trim() !== '' || !!rg.cloneContents().querySelector('img,figure,table,details,video,hr');
          return !hasStuff(before) && !hasStuff(after);
        } catch (x) { return false; }
      };
      const mark = (m) => { m.setAttribute('data-ws2-rangesel', ''); rangeSelEls.push(m); };
      if (sBlk === eBlk) {
        // 同表跨格（U4/KTD3）：完全被罩的 cell 整格蓝（预示清内容）；端点部分格保持原生文字高亮。
        if (sBlk.tagName === 'TABLE') {
          const sC = cellOfNode(r.startContainer), eC = cellOfNode(r.endContainer);
          if (sC && eC && sC !== eC) {
            // 线性跨度中的内部格必然全罩（Range 连续），covered() 只需判两端——selectionchange 是逐击热路径
            const span = cellSpanOf(sBlk, sC, eC);
            if (span) for (const c of span) { if (c === sC || c === eC ? covered(c) : true) mark(c); }
          }
        }
        return; // 其余单块内情形：原生文字高亮已够，不标块级
      }
      const walk = (root) => {
        for (const b of blocksInScope(root)) {
          if (!r.intersectsNode || !r.intersectsNode(b)) continue; // 选区外的块直接跳（intersectsNode 现代 Chromium 恒有）
          if (b.tagName === 'DETAILS') {
            if (covered(b)) { mark(b); continue; }        // 整个 toggle 被罩 → details 整行蓝
            const sm = summaryOf(b);
            if (sm && covered(sm)) mark(sm);              // summary 行被罩 → 整行蓝（预示解散）
            walk(b);                                      // 体内行各自判（不上卷）
            continue;
          }
          if (covered(b)) { mark(b); continue; }
          if (b.tagName === 'TABLE') mark(b);             // 端点在表格内 → 整行蓝预示整删（ED-A2）
        }
      };
      walk(blockRoot);
    }

    function selectBlock(el) {
      exitCell();
      exitEdit();
      clearSelectedAttr();
      selectedEl = el;
      if (el) el.setAttribute('data-ws2-selected', '');
      // 灰选必然把手柄挪到该块（20+ 个调用点本来就手写 selectBlock(x)+positionGrip(x) 这一对；收进来
      // 才能让「手柄旁 = 作用对象」成为恒真式）。少数没配对的旧点（插 hr / 菜单转为 / 折叠恢复）
      // 此前会留下手柄指向别的块，现在一并对齐。
      if (el) positionGrip(el);
      positionFmtbar();
    }
    function deselect() {
      exitCell();
      exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      hoverEl = null; hoverRow = null; setGutterVisible(false); // 清悬停引用，防删块后幽灵手柄
      closeBlockMenu();
      fmtbar.style.display = 'none'; fmtShown = false;
    }
    function enterEdit(el, caret) {
      exitCell();
      if (editingEl && editingEl !== el) exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      editingEl = el;
      fmtShown = false; // 进新编辑上下文：气泡先不粘（等用户选文字才弹）
      hoverEl = el; positionGrip(gutterAnchor()); // 编辑态保留手柄（P2-3：锚点走单一出口，行悬停态优先，别跳回块首）
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ws2-ce', '');
      el.setAttribute('data-ws2-editing', '');
      el.focus({ preventScroll: true }); // 不触发原生「聚焦滚进视野」（会把整块对齐→点击时文档跳，Wendi 2026-07-22）
      placeCaret(el, caret);
      scrollCaretIntoViewIfNeeded(); // 只在光标越出视口时最小滚动露出它（键盘导航到屏外块仍可见）
      positionFmtbar();
    }
    function exitEdit() {
      if (!editingEl) return;
      const el = editingEl; editingEl = null;
      if (el.hasAttribute('data-ws2-ce')) { el.removeAttribute('contenteditable'); el.removeAttribute('data-ws2-ce'); }
      el.removeAttribute('data-ws2-editing');
      fmtShown = false; fmtbar.style.display = 'none'; // 离开编辑 → 关气泡
    }
    // ---- 表格 cell 编辑（第四状态，KTD1）：contenteditable 挂 TD/TH、绝不挂 table；不设 editingEl/selectedEl，
    // generic 块级分支（Esc→selectBlock、applySlash、fmtbar「转为」、topBlocks 导航）对它天然 inert——失败模式
    // =功能缺失，不是「漏一处 guard → 非矩形 → 整篇降级」。selectedEl 永不允许是 TD/TH（灰选 Backspace 删单格=缺格）。----
    function cellTableOf(cell) { return cell && cell.closest ? cell.closest('table') : null; }
    function cellOfNode(n) { const el2 = n && (n.nodeType === 3 ? n.parentElement : n); return el2 && el2.closest ? el2.closest('td,th') : null; }
    function enterCell(cell, caret) {
      if (captionEl) { try { captionEl.blur(); } catch (x) {} } // 先收尾说明编辑：blur→persistCaption 会 selectBlock(figure)+exitCell，留到 cell.focus() 才触发会反噬清掉刚设的 cell 状态（对抗审查 conf100）
      if (cellEl && cellEl !== cell) exitCell();
      if (editingEl) exitEdit();
      clearSelectedAttr(); selectedEl = null;
      closeBlockMenu();
      fmtShown = false; fmtbar.style.display = 'none';
      cellEl = cell;
      cell.setAttribute('contenteditable', 'true');
      cell.setAttribute('data-ws2-ce', '');   // serialize 据此摘 contenteditable，入盘干净
      cell.setAttribute('data-ws2-cell', ''); // cell 编辑态标记（EDITOR_CSS 高亮；已登记 WS2_MARKERS 剥除）
      const tbl = cellTableOf(cell);
      if (tbl && hoverEl !== tbl) { hoverEl = tbl; positionGrip(tbl); } // 手柄锚整表；格间移动锚不变，别每击强制布局
      else if (tbl) hoverEl = tbl;
      // ↑↓ 视觉行判定要扣 cell padding——在进入时读一次缓存（padding 随 baseline 恒定），别逐击 getComputedStyle
      try { const cs0 = doc.defaultView.getComputedStyle(cell); cellPad = { top: parseFloat(cs0.paddingTop) || 0, bottom: parseFloat(cs0.paddingBottom) || 0 }; } catch (x) { cellPad = { top: 0, bottom: 0 }; }
      cell.focus({ preventScroll: true });
      placeCaret(cell, caret); // TD/TH 无列表/透明容器分支，placeCaret 语义完全一致（复用单一实现）
      scrollCaretIntoViewIfNeeded();
    }
    function exitCell() {
      if (!cellEl) return;
      const c = cellEl; cellEl = null; // 先置空再摘属性；detached 节点的属性操作亦安全（不抛）
      if (c.hasAttribute('data-ws2-ce')) { c.removeAttribute('contenteditable'); c.removeAttribute('data-ws2-ce'); }
      c.removeAttribute('data-ws2-cell');
    }
    // 从 cell 编辑态上卷到「整表灰选」的**统一出口**——三条路径都到这个终态：⌘A 第二档 / Esc / 点 ⋮⋮ 开块菜单。
    // 必须一并清掉格内那段原生蓝底：留着它，屏幕上标的是「某个格的文字被选中」、实际作用对象却是整张表；
    // 更实的后果是 onCopy 会因为选区非折叠而绕开「灰选整块」分支走行内分支 —— 同一个肉眼一模一样的状态，
    // ⌘C 拿到的东西随进入路径而不同（对抗审查实测三个入口各得一种结果）。
    // 清 range 前先把焦点停进 focusCatcher：照 selectWholeDoc 的既有顺序（那里注释写明「焦点变化会把
    // contenteditable 的旧选区折叠，顺序反了选区会被 focus 冲掉」）。
    function clearStaleCellSelection() {
      try { focusCatcher.focus({ preventScroll: true }); } catch (e) { /* 老内核无 options */ }
      const s = doc.getSelection(); if (s) s.removeAllRanges();
    }
    function selectTableFromCell(tbl) {
      exitCell(); selectBlock(tbl); positionGrip(tbl); clearStaleCellSelection();
    }
    // 建新数据行（KTD4）：恒落 tbody（无则建，header-only md 产物在此收敛）、恒产 TD、列数取末数据行、每格 <br>。
    // undo 序 = checkpoint→mutate→checkpoint（KTD6，todo 勾选 U20/check-3 同款先例：先冲掉 500ms 防抖窗口内的
    // pending 打字成独立快照，否则一次 undo 连字带行一起吞）。
    function appendTableRow(table) {
      const rows = tableRowsOf(table);
      const nCols = rows.length ? rowCellsOf(rows[rows.length - 1]).length : 3;
      if (undoMgr) undoMgr.checkpoint(); // 前置检查点必须在一切 DOM 变更（含补建 tbody）之前——否则 header-only 表建行被劈成两个 undo 步、单次 undo 留幽灵空 tbody（对抗审查 conf100）
      const lastRow = rows[rows.length - 1] || null;
      let tbody = (lastRow && lastRow.parentElement && lastRow.parentElement.tagName === 'TBODY') ? lastRow.parentElement
        : ([...table.children].filter((c) => c.tagName === 'TBODY').pop() || null); // 多 tbody 合规表：接到末数据行所在段/末段，别落第一个 tbody 表中间
      if (!tbody) { tbody = doc.createElement('tbody'); table.appendChild(tbody); }
      const tr = doc.createElement('tr');
      for (let i = 0; i < nCols; i++) tr.appendChild(mkTableCell(doc, 'td'));
      tbody.appendChild(tr);
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
      return tr;
    }
    // 表界跳出（方向键/Shift+Tab）：作用域感知——表在 toggle 体内时跳体内邻块/summary，顶层跳顶层邻块。
    function exitToNeighbor(tbl, dir) {
      const scope = scopeRootOf(tbl);
      const blocks = (scope === blockRoot) ? topBlocks() : blocksInScope(scope);
      const idx = blocks.indexOf(tbl);
      if (idx < 0) return;
      let target = dir === 'up' ? blocks[idx - 1] : blocks[idx + 1];
      if (!target && scope !== blockRoot) target = dir === 'up' ? summaryOf(scope) : scope.nextElementSibling;
      if (!target || (target.hasAttribute && target.hasAttribute('data-ws2-ui'))) return; // 文档首/末 → 不动
      if (target.tagName === 'SUMMARY' || isEditableEl(target)) enterEdit(target, { mode: dir === 'up' ? 'end' : 'start' });
      else { selectBlock(target); positionGrip(target); }
    }

    // 全篇跨块选区（⌘A 第二级）：退出编辑放墙（同拖选跨块），range 罩住首尾内容块——
    // 首尾锚点用内容块而非 body（覆盖层 data-ws2-ui 挂在 body 末尾，别把 UI 圈进选区）。
    function selectWholeDoc() {
      exitCell();
      if (editingEl) exitEdit();
      clearSelectedAttr(); selectedEl = null;
      closeBlockMenu(); // P2-4：这条路径不走 deselect，行菜单会留在屏上、menuRow 指向随后被删掉的行
      const blocks = [...body.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui'));
      if (!blocks.length) return;
      const r = doc.createRange();
      // 锚点放**首尾块内**（不是 body 层的 before/after）——deleteSelection 用 blockOf(锚点) 找端块，
      // body 层锚点会被判「块外选区」直接 return false（实锤:全篇退格纹丝不动）。块内锚点与拖选
      // 产生的选区同形,跨块删/剪切管线原样通。
      const last = blocks[blocks.length - 1];
      r.setStart(blocks[0], 0);
      r.setEnd(last, last.childNodes.length);
      const sel = doc.getSelection();
      if (!sel) return;
      // 先把焦点停进接盘（焦点变化会把 contenteditable 的旧选区折叠），再设全篇 range——
      // 顺序反了选区会被 focus 冲掉。焦点留在 iframe 内,后续 Backspace/⌘X 才进得了 keydown。
      try { focusCatcher.focus({ preventScroll: true }); } catch { /* 老内核无 options */ }
      sel.removeAllRanges(); sel.addRange(r);
    }
    function placeCaret(el, caret) {
      const sel = doc.getSelection(); if (!sel) return;
      let range = null;
      caret = caret || { mode: 'end' };
      if (caret.mode === 'keep') return; // 保留已有选区（点选文字后进编辑，别折叠它）
      // 列表：contenteditable 在 <ul> 上，但光标要落到 <li> 内（否则打字落 ul 直接子级 = 裸文本）
      let target = el;
      if ((el.tagName === 'UL' || el.tagName === 'OL')) { const li = el.querySelector('li'); if (li) target = li; }
      // 透明内容容器（div.lead>p 之类）：自己没直接文字、只裹块级内容时，光标下钻进里面第一个块，
      // 别停在容器层（否则键盘进入 start/end 模式打字会在容器直接子级产生裸文本）。
      while ((target.tagName === 'DIV' || target.tagName === 'SECTION' || target.tagName === 'ARTICLE' || target.tagName === 'MAIN')
        && ![...target.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        && target.firstElementChild) {
        target = target.firstElementChild;
      }
      if (caret.mode === 'point' && caret.x != null) {
        const pt = caretRangeAtPoint(doc, caret.x, caret.y);
        if (pt && el.contains(pt.startContainer)) range = pt;
      }
      if (!range) { range = doc.createRange(); range.selectNodeContents(target); range.collapse(caret.mode === 'start'); }
      sel.removeAllRanges(); sel.addRange(range);
    }
    // 只在光标真落到视口外时最小滚动露出它——修 Wendi 2026-07-22「点击时文档上下跳」：enterEdit 的 el.focus()
    // 原生「聚焦滚进视野」会把整块对齐、部分露出的块被一把顶进来 → 文档大跳。改成 focus 不滚 + 光标可见就不动，
    // 只有光标越出视口（键盘方向键/退格合并到屏外块）才按最小量滚回，键盘导航仍不丢光标。
    function scrollCaretIntoViewIfNeeded() {
      const sel = doc.getSelection(); if (!sel || !sel.rangeCount) return;
      let r = sel.getRangeAt(0).getBoundingClientRect();
      if ((!r || (!r.height && !r.top && !r.bottom)) && editingEl) r = editingEl.getBoundingClientRect();
      if (!r || (!r.height && !r.width)) return;
      const vh = win.innerHeight || doc.documentElement.clientHeight || 0;
      const m = 8;
      if (r.top < m) win.scrollBy(0, r.top - m);
      else if (r.bottom > vh - m) win.scrollBy(0, r.bottom - (vh - m));
    }

    // ---- 块操作（复用 format.js）----
    // 待办勾选框样式烤进存盘文件：首次出现待办时往 <head> 注一个 <style id=ws-todo-style>（真实内容、
    // 随 serialize 存盘，不像 EDITOR_CSS 那样不入盘）。这样 .html 在 app 外用任何浏览器打开，待办也渲染成
    // checklist。幂等（按 id 查重），用 ::before 画框故无需 JS。
    // 待办/callout 的入盘语义 CSS 常量（v2 与 baseline 排版底线同调：勾选框对 1.75 行高垂直居中、
    // 灰阶与 baseline 同色板）。旧文件里的 v1 版本在 attach 时由 refreshSemanticStyles 静默升级。
    function ensureTodoStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="todo"]')) return; // 属性查重（不靠固定 id，防作者内容碰撞，S9）
      const st = doc.createElement('style');
      st.id = 'ws-todo-style';
      st.setAttribute('data-ws-schema-css', 'todo'); // U5：标 schema baseline 语义 CSS——存盘保留 + 校验器 head 白名单认它合规
      st.textContent = TODO_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    // U5：callout 框 CSS 烤进存盘文件（修 C1：原 callout 无入盘 CSS、存盘成无样式纯文本）。照 ensureTodoStyle 范式。
    // 最小语义版：只给提示框的底/边/内距/外距（让 callout 渲染成框），不碰字色字号（那是装饰、按原生）。
    function ensureCalloutStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="callout"]')) return; // 属性查重（S9）
      const st = doc.createElement('style');
      st.id = 'ws-callout-style';
      st.setAttribute('data-ws-schema-css', 'callout');
      st.textContent = CALLOUT_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    // toggle chevron/marker CSS 烤进存盘文件（照 ensureTodoStyle/ensureCalloutStyle 范式，属性查重，S9）。
    function ensureToggleStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="toggle"]')) return; // 属性查重
      const st = doc.createElement('style');
      st.id = 'ws-toggle-style';
      st.setAttribute('data-ws-schema-css', 'toggle');
      st.textContent = TOGGLE_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    // attach 时对齐语义 CSS 与文档现状（两件事，都不 markDirty——样式归编辑器托管、不算用户
    // 编辑，下次真实编辑保存时随文件落盘）：
    // ① 升级：旧文件带着 v1 版语义 CSS（老勾选框偏上、老灰阶）→ 覆写成当前版；
    // ② 补注：文档里**存在**语义块（ws-todo/ws-callout/ws-color-*）但 head 缺对应入盘 CSS →
    //    补上。这类文件真实存在：md 转换产物（adapter 的 head 只有 charset/meta/title）、外部
    //    AI 生成时漏带语义 CSS 的合规文档、手写文件——原来它们在编辑器里靠 EDITOR_CSS 看着
    //    正常，存盘后浏览器直开却是裸样式（callout 变纯文本、待办变圆点列表）。
    function refreshSemanticStyles() {
      if (!doc) return;
      const host = doc.head || doc.documentElement;
      const pairs = [
        ['todo', TODO_CSS, 'ws-todo-style', 'ul.ws-todo'],
        ['callout', CALLOUT_CSS, 'ws-callout-style', '.ws-callout'],
        ['toggle', TOGGLE_CSS, 'ws-toggle-style', 'details'],
        ['color', COLOR_CSS, 'ws-color-style', '[class*="ws-color-"]'],
        ['indent', INDENT_CSS, 'ws-indent-style', '[class*="ws-indent-"]'],
        ['align', ALIGN_CSS, 'ws-align-style', '[class*="ws-al-"]'], // U6：存量 ws-al 表（AI 生成/手写）缺 style 时 attach 补注
      ];
      for (const [kind, css, id, presentSel] of pairs) {
        let st = host.querySelector('style[data-ws-schema-css="' + kind + '"]');
        if (st) { if (st.textContent !== css) st.textContent = css; continue; } // ① 升级
        if (!doc.querySelector(presentSel)) continue;
        st = doc.createElement('style'); // ② 补注
        st.id = id;
        st.setAttribute('data-ws-schema-css', kind);
        st.textContent = css;
        host.appendChild(st);
      }
    }
    // 按块的 schema class 注入对应入盘语义 CSS（创建/转换块时调）。
    function ensureBlockStyle(cls) {
      if (cls === 'ws-todo') ensureTodoStyle();
      else if (cls === 'ws-callout') ensureCalloutStyle();
    }
    // baseline 排版底线 v2（§0 决策2 演进,Colin 2026-07-05 拍：基础样式要好看,参考 Notion/Obsidian）：
    // v1 只管宽度+留白,其余全吃浏览器 UA 默认(衬线体/紧行高/默认边距)——「裸 markdown 感」的根源。
    // v2 = 完整的排版地板：字体栈/字号/行高/标题层级节奏(上重下轻)/段落列表引用表格代码的间距与底线样式,
    // 色彩只用中性灰阶(正文墨色/边框灰),不带任何装饰性彩色——好看的「白纸」,不是主题(主题=Template)。
    // 跟「删 canvas」仍不矛盾——canvas 是编辑器运行时强套、不入盘的装饰;baseline 是入盘随文件走的格式
    // 底线,app 外任何浏览器打开同样好看。全部 :where() 零权重 → 作者自带样式永远优先(只是地板)。
    // 已有 v1 baseline 的旧文件在 attach 时静默升级成 v2(内容对不上就覆写,样式归编辑器托管,同 v1 惯例
    // 不 markDirty,下次真实编辑保存时随文件落盘)。⚠ 820px/48px 是 e2e 锚点(fidelity/align/app.spec),别动。
    function ensureSchemaBaseline() {
      if (!doc) return;
      const head = doc.head || doc.documentElement;
      const existing = head.querySelector('style[data-ws-schema-css="baseline"]'); // 属性查重（不靠固定 id，S9）
      if (existing) {
        if (existing.textContent !== BASELINE_CSS) existing.textContent = BASELINE_CSS; // v1 旧文件 → 静默升级 v2
        return;
      }
      const st = doc.createElement('style');
      st.id = 'ws-schema-baseline';
      st.setAttribute('data-ws-schema-css', 'baseline');
      st.textContent = BASELINE_CSS;
      head.appendChild(st);
    }
    // U6（§0 决策1 + A2）：固定色板文字色 CSS 入盘。块级上色用 class 不写 style（块 style 非法），
    // 显示按原生（class + 入盘 CSS 随文件走，app 外浏览器也显示）。class 名 = ws-color-<hex 去#>。
    function ensureColorStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="color"]')) return; // 属性查重（S9）
      const st = doc.createElement('style');
      st.id = 'ws-color-style';
      st.setAttribute('data-ws-schema-css', 'color');
      st.textContent = COLOR_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    // Track2 方案B：ws-indent-* 缩进 CSS 入盘（照 ensureColorStyle 逐字，color→indent）。
    function ensureIndentStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="indent"]')) return; // 属性查重（S9）
      const st = doc.createElement('style');
      st.id = 'ws-indent-style';
      st.setAttribute('data-ws-schema-css', 'indent');
      st.textContent = INDENT_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    // U6：cell 对齐 text-align CSS 入盘（照 ensureColorStyle 范式，属性查重 S9）。app 外浏览器直开同样生效。
    function ensureAlignStyle() {
      if (!doc || (doc.head || doc.documentElement).querySelector('style[data-ws-schema-css="align"]')) return;
      const st = doc.createElement('style');
      st.id = 'ws-align-style';
      st.setAttribute('data-ws-schema-css', 'align');
      st.textContent = ALIGN_CSS;
      (doc.head || doc.documentElement).appendChild(st);
      markDirty();
    }
    function newBlock(item) {
      let el;
      if (item.tag === 'hr') { el = doc.createElement('hr'); }
      // U9/create-2：种空产物、不种 i18n 占位文本——applySlash 非空块分支光标折叠到占位**之前**，占位会前插+入盘（「买菜列表项」）。
      else if (item.tag === 'ul' || item.tag === 'ol') { el = doc.createElement(item.tag); if (item.cls) el.className = item.cls; const li = doc.createElement('li'); li.appendChild(doc.createElement('br')); el.appendChild(li); } // 空 li 补 br（U1：ws-todo 空 li 无 br 零高落不住 caret）
      else if (item.tag === 'div' && item.cls === 'ws-callout') { el = doc.createElement('div'); el.className = 'ws-callout'; el.appendChild(doc.createElement('br')); }
      else if (item.tag === 'blockquote') { el = doc.createElement('blockquote'); el.appendChild(doc.createElement('br')); }
      else if (item.tag && item.tag[0] === 'h') { el = doc.createElement(item.tag); el.appendChild(doc.createElement('br')); }
      else if (item.tag === 'details') { el = doc.createElement('details'); el.setAttribute('open', ''); el.appendChild(doc.createElement('summary')); el.appendChild(doc.createElement('p')); ensureToggleStyle(); } // 折叠块种子：<details open><summary></summary><p></p></details>（默认展开，光标由 applySlash 落 summary）
      else if (item.tag === 'table') { el = tableSeed(doc); } // 表格种子（边框/内距样式已在 BASELINE_CSS 随 ensureSchemaBaseline 入盘，无需独立 style pair）
      else { el = doc.createElement('p'); }
      ensureBlockStyle(item.cls);
      return el;
    }
    // U12/U13：列表项出列/outdent 前，把它的后继兄弟收编进它自己的子列表（继承父列表 tag/class）——
    // 否则后继项留在原父列表里、文档顺序跑到出列项之前（keys-5 错序）。无后继则 no-op。
    function absorbTrailingSiblings(li) {
      if (!li || !li.nextElementSibling) return;
      const parentList = li.parentElement;
      if (!parentList) return;
      let sub = li.lastElementChild;
      if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
        sub = doc.createElement(parentList.tagName.toLowerCase());
        if (parentList.className) sub.className = parentList.className;
        li.appendChild(sub);
      }
      while (li.nextElementSibling) sub.appendChild(li.nextElementSibling);
    }
    // 光标落 li **自身文字**末尾（在其嵌套子列表之前）——outdent/收编后 li 追加了子列表，
    // selectNodeContents(li).collapse(false) 会落到子列表之后、打字进错位置（对抗审查 P2）。
    function caretAtLiTextEnd(li) {
      let anchor = null;
      for (const n of li.childNodes) { if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) break; anchor = n; }
      try { const r = doc.createRange(); if (anchor) r.setStartAfter(anchor); else r.setStart(li, 0); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {}
    }
    // 把 src 的内容并进 target 末尾，返回接合点节点（光标该停它前面）。**不设光标、不 checkpoint**——
    // 调用方通常要先 enterEdit（它会重置选区），顺序反了光标会被冲掉。
    // 三条加固都收在这儿，别再各写一份（此前散在三处，改一处漏两处）：
    //  ① 目标只有一个占位 <br> → 先剥掉，免得并入后留前导空行（对抗审查 Finding C）
    //  ② 目标自带嵌套子列表 → 内容插在子列表【前】，否则文字会吊到子项下面（Finding B）
    //  ③ 返回 joinAt 供调用方定位光标（src 非空时恒非 null）
    function mergeLiInto(target, src) {
      const nested = target.querySelector(':scope > ul, :scope > ol');
      // 剥目标的占位 <br>：判据必须和 normalizeHostLi 同源——**只看子列表之前那一段**。
      // 旧判据是 `childNodes.length === 1`，而被 normalizeHostLi 补过占位的空壳宿主行是 [<br>, <ul>]，
      // 长度 2、判据不成立 → 并进来的文字被压到第二行、上面留一个空行，勾选框贴着那个空行——
      // 正是这次要修的「勾选框和文字对不上」同一类症状。（发版把关 W-1，两个修复互相踩。）
      const own = [];
      for (const n of target.childNodes) { if (n === nested) break; own.push(n); }
      if (own.length === 1 && own[0].nodeName === 'BR') own[0].remove();
      const joinAt = src.firstChild;
      while (src.firstChild) { if (nested) target.insertBefore(src.firstChild, nested); else target.appendChild(src.firstChild); }
      src.remove();
      return joinAt;
    }
    // 列表里**视觉上的最后一行** = 沿末项的子列表一路下钻到最深（对抗审查 ADV-4）。
    // 「最后一个直接子 li」不等于「上一行」：它带子项时，屏幕上它下面还压着一堆子行。
    // Notion 实测（fixture 对拍fixture-ADV4）：`- A / 　- A1 / 　- A2 / 段落文字`，段落行首退格
    // 得到 `A2段落文字` —— 并进最深的那一行，不是并进 A。并进 A 会让文字**跳到子项上方**，
    // 子项越多跳得越远（十个子项就跳十行），用户会读成「我的文字被搬走了」。
    function lastVisibleLi(list) {
      let li = [...list.children].reverse().find((c) => c.tagName === 'LI') || null;
      for (;;) {
        const sub = li && li.querySelector(':scope > ul, :scope > ol');
        const deeper = sub ? [...sub.children].reverse().find((c) => c.tagName === 'LI') : null;
        if (!deeper) return li;
        li = deeper;
      }
    }
    function caretBefore(node) {
      if (!node || !node.parentNode) return;
      try { const r = doc.createRange(); r.setStartBefore(node); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {}
    }
    function insertAfter(refEl, item) {
      const el = newBlock(item);
      if (refEl && refEl.after) refEl.after(el); else blockRoot.appendChild(el);
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
      return el;
    }
    // U4/A（Colin 2026-08-04 拍板严格对齐 Notion）：在列表的某一行处插入空正文块。
    // Notion 实测：「+」永远插一个普通文本块（与当前块是不是列表行无关），所以在列表中间插就得
    // 把列表劈成 [前段列表][新段落][后段列表]；切点在首/末则退化成插到整个列表前/后、不产空列表。
    function insertParaAtRow(list, row, above) {
      const lis = [...list.children].filter((x) => x.tagName === 'LI');
      const cut = lis.indexOf(row) + (above ? 0 : 1);
      // 不塞 <br>：与 newBlock('text') 的 `<p></p>` 对齐，否则 :empty 不成立 → 占位文案（含 E5 的
      // 「输入以筛选…」）在列表行这条路上一个都不显示（发版把关 W-4）。
      const p = doc.createElement('p');
      const tail = lis.slice(cut);
      if (cut === 0) list.before(p);
      else if (!tail.length) list.after(p);
      else {
        const nl = doc.createElement(list.tagName);
        if (list.className) nl.className = list.className;
        tail.forEach((li) => nl.appendChild(li));
        list.after(p); p.after(nl);
      }
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
      return p;
    }
    // U4「+」的 ⌥ 点击用：插到参照块**上方**（无参照 → 落作用域最前，别悄悄掉到文末）
    function insertBeforeBlock(refEl, item) {
      const el = newBlock(item);
      if (refEl && refEl.before) refEl.before(el); else blockRoot.insertBefore(el, blockRoot.firstChild);
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
      return el;
    }

    // ---- 图片块（doc-images）：斜杠 / 粘贴 / 拖放三入口共用的摄入→插入管线 ----
    function ingestErrorMsg(reason) {
      return reason === 'budget' ? T('editor.imageTooLarge')
        : reason === 'type' ? T('editor.imageUnsupported')
        : T('editor.imageDecodeFailed');
    }
    function base64ToFile(name, mime, b64) {
      const bin = atob(b64 || '');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], name || 'image', { type: mime });
    }
    const altOf = (name) => String(name || '').replace(/\.[^.]+$/, ''); // 文件名去扩展 = alt（可访问性 + 检索）
    function buildImageEl(src, alt) {
      const img = doc.createElement('img');
      img.setAttribute('src', src);            // src 恒为本地生成 data: URL（base64 字母表无引号）
      img.setAttribute('alt', alt || '');      // DOM setAttribute 序列化时自动转义 → 入盘即 canonical
      return img;
    }
    // OS 拖放落点：Y 最近块；clientY 在其上半且非首块 → 插到前一块之后；否则最近块之后；空文档 → null(append)。
    function dropAnchor(clientY) {
      const blocks = topBlocks();
      if (!blocks.length) return null;
      let best = null;
      for (let i = 0; i < blocks.length; i++) {
        const r = blocks[i].getBoundingClientRect();
        const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        if (!best || dist < best.dist) best = { i: i, dist: dist, mid: (r.top + r.bottom) / 2 };
      }
      return (best.i > 0 && clientY < best.mid) ? blocks[best.i - 1] : blocks[best.i];
    }
    // 逐张摄入→插图片块。整批共用一个 checkpoint（= 一步 undo），replaceEmpty 时先插后删空锚块也归这一步；
    // 全批失败不 checkpoint（不留空撤销步）。checkpoint 在 DOM 变更后打（本仓 undo 约定，见 insertAfter/undo.js）。
    async function insertImages(files, anchorEl, replaceEmpty) {
      if (!files || !files.length || !II) return;
      let after = anchorEl, inserted = 0;
      for (const f of files) {
        let r;
        try { r = await II.ingestImage(f); } catch (e) { r = { ok: false, reason: 'decode' }; }
        if (!live) return; // 摄入期间文档被换掉 → 别插进已 detach 的旧文档（shell loadGen 竞态）
        if (!r || !r.ok) { if (global.__wsToast) global.__wsToast(ingestErrorMsg(r && r.reason)); continue; }
        const el = buildImageEl(r.src, altOf(f.name));
        if (after && after.after) after.after(el); else blockRoot.appendChild(el);
        selectBlock(el); positionGrip(el);
        after = el; inserted++;
      }
      if (inserted > 0) {
        if (replaceEmpty && anchorEl && anchorEl.parentNode) anchorEl.remove(); // 空段落原地替换（已拍板②）
        if (undoMgr) undoMgr.checkpoint();
        markDirty();
      }
    }
    // 斜杠「图片」：父层原生选图（可取消——取消绝不 checkpoint，否则留空撤销步）→ File[] → insertImages
    async function pickAndInsertImage(anchorEl, replaceEmpty) {
      if (!pickImages) { if (global.__wsToast) global.__wsToast(T('editor.imagePickerUnavailable')); return; }
      let picked;
      try { picked = await pickImages(); } catch (e) { picked = null; }
      if (!live || !picked || !picked.length) return;
      const files = picked.map((p) => { try { return base64ToFile(p.name, p.mime, p.base64); } catch (e) { return null; } }).filter(Boolean);
      await insertImages(files, anchorEl, replaceEmpty);
    }

    // ---- 图片说明（figcaption，U5）：加说明 → figure；空说明失焦 → 降回裸 <img>（canonical 双向收敛）----
    // 「加说明」：裸 <img> 包成 <figure><img><figcaption>，进说明编辑。el 可为 <img> 或已有 <figure>。
    function addCaption(el) {
      let figure, img;
      if (el.tagName === 'IMG') {
        img = el; figure = doc.createElement('figure');
        img.replaceWith(figure); figure.appendChild(img); // figure 占 img 原位，img 移进去
      } else if (el.tagName === 'FIGURE') {
        figure = el; img = figure.querySelector('img');
      } else return;
      let cap = figure.querySelector('figcaption');
      const wasNew = !cap;
      if (!cap) { cap = doc.createElement('figcaption'); figure.appendChild(cap); }
      enterCaptionEdit(cap, wasNew);
    }
    // 进说明编辑：只给 figcaption 开 contenteditable + data-ws2-ce（serialize 据此移除 contenteditable→入盘干净），
    // 不设 editingEl/selectedEl——让块级破坏性键盘分支保持 inert（对齐 ui-demo「说明里 Backspace 不删整块」）。
    function enterCaptionEdit(cap, wasNew) {
      exitCell(); // 与其他状态入口同款前奏——漏了它 = cell 键盘分支在说明编辑下仍活着（模式泄漏）
      if (captionEl && captionEl !== cap) captionEl.blur(); // 收尾上一个
      clearSelectedAttr(); selectedEl = null; closeBlockMenu();
      captionEl = cap; captionOrig = cap.textContent || ''; captionWasNew = !!wasNew;
      cap.setAttribute('contenteditable', 'true');
      cap.setAttribute('data-ws2-ce', '');
      cap.addEventListener('blur', persistCaption, { once: true });
      cap.focus();
      const r = doc.createRange(); r.selectNodeContents(cap); r.collapse(false); // 光标落末尾
      const sel = doc.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(r); }
    }
    function persistCaption() {
      if (!captionEl) return;
      const cap = captionEl; captionEl = null;
      cap.removeAttribute('contenteditable'); cap.removeAttribute('data-ws2-ce');
      const figure = cap.parentElement;
      if (!figure || figure.tagName !== 'FIGURE') return;
      const text = (cap.textContent || '').trim();
      const img = figure.querySelector('img');
      if (!text) {
        if (img) { figure.replaceWith(img); selectBlock(img); positionGrip(img); } // 空说明 → 降回裸 img
        // 新建又清空 = 净无变化，不 checkpoint（不留空撤销步）；原本有说明被清空才算一步
        if (!captionWasNew) { if (undoMgr) undoMgr.checkpoint(); markDirty(); }
      } else {
        cap.textContent = text; // 归一去首尾空白
        selectBlock(figure); positionGrip(figure);
        if (captionWasNew || text !== (captionOrig || '').trim()) { if (undoMgr) undoMgr.checkpoint(); markDirty(); }
      }
    }

    // 「摘子树 → 转块 → 接回」这类复合操作期间**绝不能落快照**——快照记的是当时的 DOM，子树在 DOM 外时
    // 落一次，undo 就会精准回到「子项已消失」的中间态并被自动保存写进磁盘（对抗审查 P1-1，实测丢内容）。
    let ckSuppressed = false;
    const ckpt = () => { if (!ckSuppressed && undoMgr) undoMgr.checkpoint(); };
    function turnInto(el, item) {
      if (!el) return el;
      if (el.tagName === 'SUMMARY') el = el.parentElement || el; // P0：编辑 summary 时「转为」→ 作用于整个 toggle（否则 retag 掉 summary → 零 summary 非合规字节）
      // toggle→文本（U9/R2）：源是 <details>、目标非 details → summary 内容 → 目标块，正文块提到其后（零内容丢失）。
      // 必须在下面 containerLines 计算之前——否则 details 的 summary+正文会被误当「多段容器」拍平。
      if (el.tagName === 'DETAILS' && item.tag !== 'details') {
        const summary = summaryOf(el);
        const bodyBlocks = blocksInScope(el);
        const tgtTag = (item.tag && item.tag[0] === 'h') ? item.tag : (item.tag === 'blockquote' ? 'blockquote' : 'p');
        const target = doc.createElement(tgtTag);
        if (summary) { while (summary.firstChild) target.appendChild(summary.firstChild); }
        el.replaceWith(target);
        let ref = target;
        for (const b of bodyBlocks) { ref.after(b); ref = b; } // 正文块按序提到 target 之后
        ckpt(); markDirty();
        return target;
      }
      // 修 P1：源是「多段容器块」(callout/quote 含 <p> 子) 时，先把内部块拍平成「行」——否则块级 <p> 被
      // 原样搬进目标块，产 <ul><li><p>..</p></li> / <p><p>..</p></p> 等非法结构（闭合破坏）。列表源(<ul>/<ol>)
      // 由下面既有的 flattenListToPhrasing 分支处理，这里只管非列表容器；转容器目标(引用/callout)保留 <p> 不拍。
      const LEAF_TARGETS = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1 };
      const containerLines = (el.tagName !== 'UL' && el.tagName !== 'OL' && SM.hasBlockLevelDescendant(el))
        ? SM.flattenBlocksToLines(el) : null;
      if (item.tag === 'ul' || item.tag === 'ol') {
        // 转列表：retag 后原内容裸挂在 <ul>/<ol> 下（非法 + Enter 失灵）→ 包进单个 <li>；容器块每段各成一 <li>。
        const next = fmt.retagElement(el, item.tag);
        if (item.cls) next.className = item.cls; else next.removeAttribute('class');
        if (item.cls === 'ws-todo') ensureTodoStyle();
        else next.querySelectorAll('li[data-checked]').forEach((li) => li.removeAttribute('data-checked')); // A3：todo→普通列表，清残留勾选态
        // 空 li（无元素子且无非空白文字）在 ws-todo list-style:none 下无 line box、高度 0、落不住 caret、
        // 后续输入被静默吞掉（create-1）→ 补 <br> 占位。containerLines 与 else 两条建 li 路径都要过（容器块含真空 <p></p> 时同样中招）。
        // 无「可视内容」（无非空白文字、且无 br/img/hr 等占行元素——空的 <b></b> 等空行内元素不算）→ 补 <br>，
        // 否则 ws-todo 空 li 零高、落不住 caret、吞输入（create-1；对抗审查 P3：空行内元素夹在 <br> 间会漏补）。
        const padLi = (li) => { if (!li.textContent.trim() && !li.querySelector('br,img,hr,input,figure')) li.appendChild(doc.createElement('br')); };
        if (containerLines) {
          while (next.firstChild) next.removeChild(next.firstChild);
          for (const line of containerLines) { const li = doc.createElement('li'); li.appendChild(line); padLi(li); next.appendChild(li); } // 容器每段 → 一个 <li>（空段补 br）
        } else if (!next.querySelector('li')) {
          // U10/create-3：内容含顶层 <br>（如 todo→文本往返产物「甲<br>乙<br>丙」）→ 按 <br> 拆行、每行一个 <li>，
          // 别塞进单个 li 塌成一项（回程往返销毁列表结构）。空行跳过（对齐粘贴防悬空守卫），≥2 行才走多 li。
          const groups = []; let cur = [];
          for (const n of [...next.childNodes]) { if (n.nodeName === 'BR') { groups.push(cur); cur = []; } else cur.push(n); }
          groups.push(cur);
          const nonEmpty = groups.filter((g) => g.some((n) => (n.textContent || '').trim() || n.nodeType === 1));
          while (next.firstChild) next.removeChild(next.firstChild);
          if (nonEmpty.length >= 2) {
            for (const g of nonEmpty) { const li = doc.createElement('li'); g.forEach((n) => li.appendChild(n)); padLi(li); next.appendChild(li); }
          } else {
            const li = doc.createElement('li'); (nonEmpty[0] || []).forEach((n) => li.appendChild(n)); padLi(li); next.appendChild(li);
          }
        }
        ckpt(); markDirty();
        return next;
      }
      if (item.tag === 'hr') {
        const next = fmt.retagElement(el, 'hr');
        ckpt(); markDirty();
        return next;
      }
      if (item.tag === 'details') {
        // 文本→toggle：源块行内内容 → summary；正文块提到 det 里。U17/create-6：列表源不再把所有项拍进 summary，
        // 改为「首项 → summary，其余项各成一个正文 <p>」；并复制源块 id 等用户属性到 det（不走 retagElement 会丢锚点）。
        const det = doc.createElement('details'); det.setAttribute('open', '');
        const summary = doc.createElement('summary');
        const bodyBlocks = [];
        if (containerLines) { containerLines.forEach((line, i) => { if (i > 0) summary.appendChild(doc.createElement('br')); summary.appendChild(line); }); }
        else if (el.tagName === 'UL' || el.tagName === 'OL') {
          [...el.querySelectorAll('li')].forEach((li, i) => {
            const frag = doc.createDocumentFragment();
            for (const n of [...li.childNodes]) { if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) continue; frag.appendChild(n.cloneNode(true)); } // 取该项行内内容（跳嵌套子列表）
            if (i === 0) summary.appendChild(frag);
            else { const p = doc.createElement('p'); if (frag.firstChild) p.appendChild(frag); else p.appendChild(doc.createElement('br')); bodyBlocks.push(p); }
          });
        }
        else { while (el.firstChild) summary.appendChild(el.firstChild); }
        if (!summary.firstChild) summary.appendChild(doc.createElement('br')); // U17 对抗审查：首项行内为空（仅嵌套子列表 / 空 li）→ 补 <br>，避免不可见空标题
        det.appendChild(summary);
        if (bodyBlocks.length) bodyBlocks.forEach((b) => det.appendChild(b)); else det.appendChild(doc.createElement('p'));
        if (el.tagName === 'UL' || el.tagName === 'OL') { for (const a of [...el.attributes]) { if (a.name.indexOf('data-ws2') !== 0 && a.name !== 'class') det.setAttribute(a.name, a.value); } } // U17/create-6：仅**列表源**复制 id 等用户属性（锚点不断）；段落→toggle 维持既有「不迁移 id」行为（toggle.spec.js U9），ws2 哨兵/class 不带
        el.replaceWith(det);
        ensureToggleStyle();
        ckpt(); markDirty();
        return det;
      }
      // 修 A1：源是列表、目标非列表（正文/标题/引用/callout）→ 先把 li 拍平成 phrasing，
      // 否则 retag 后 <li> 孤儿挂在 <blockquote>/<p> 下（非法 HTML）。
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const frag = SM.flattenListToPhrasing(el);
        const nx = fmt.retagElement(el, item.tag);
        if (item.tag !== 'ol') nx.removeAttribute('start'); // 列表源这条分支同样要剥（retagElement 保全属性 → <p start="2"> 垃圾属性，对拍 N8）
        while (nx.firstChild) nx.removeChild(nx.firstChild);
        nx.appendChild(frag);
        if (item.cls) nx.className = item.cls; else if (nx.classList) { nx.classList.remove('ws-callout'); nx.classList.remove('ws-todo'); } // U16/create-5：只摘语义 class（ws-callout/ws-todo），用户自定义 class 保留
        ensureBlockStyle(item.cls);
        ckpt(); markDirty();
        return nx;
      }
      const next = fmt.retagElement(el, item.tag); // p / h1 / h2 / h3 / blockquote / div(callout)
      if (item.tag !== 'ol') next.removeAttribute('start'); // retagElement 保全属性 → 非 ol 产物会拖着 start="2" 这种垃圾属性（对拍 N8）
      // 修 P1：容器块 → 叶子块(p/h1-4)：内部 <p> 不能进叶子块，拍平成 <br> 分隔的 phrasing。
      // → 容器目标(引用/callout)：保留内部 <p>（两者都放行多段 <p>），不拍。
      if (containerLines && LEAF_TARGETS[item.tag]) {
        while (next.firstChild) next.removeChild(next.firstChild);
        containerLines.forEach((line, i) => { if (i > 0) next.appendChild(doc.createElement('br')); next.appendChild(line); });
      }
      if (item.cls) next.className = item.cls; else if (next.classList) { next.classList.remove('ws-callout'); next.classList.remove('ws-todo'); } // U16/create-5：只摘语义 class，用户自定义 class 保留
      ensureBlockStyle(item.cls);
      ckpt(); markDirty();
      return next;
    }
    // Step 2（Colin 2026-07-23，方案 B 第 2 步）：从当前选区解析出「整块 <ul>/<ol> 里被选中的直接子 li 连续跨度」。
    // 折叠光标 → 光标所在那一行；跨 li 选区 → 首末 li 之间的连续跨度；落在嵌套子项 → 上卷到含它的顶层 li。返回 li 数组或 null。
    function selectedListLines(ul) {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const r = sel.getRangeAt(0);
      const allLis = [...ul.children].filter((c) => c.tagName === 'LI');
      if (!allLis.length) return null;
      if (r.collapsed) { // 折叠光标 = 光标所在那一行（嵌套子项上卷到顶层 li）
        let e = r.startContainer; e = e && (e.nodeType === 3 ? e.parentElement : e); e = e && e.closest ? e.closest('li') : null;
        while (e && e.parentElement !== ul) { const up = e.parentElement && e.parentElement.closest ? e.parentElement.closest('li') : null; if (!up || up === e) { e = null; break; } e = up; }
        return e ? [e] : null;
      }
      // 非折叠：取与选区**内容有非零交集**的直接子 li——按内容区间比，排除「只碰边界、零字符选中」的 li。
      // （对抗审查：三击整行 / Home+Shift+↓ 会把 range 末端停在下一行最前沿 end=LI#next:0；用起止容器映射会误多抽一行。）
      // compareBoundaryPoints 常量：END_TO_START=3（比 r.start vs liR.end）、START_TO_END=1（比 r.end vs liR.start）。
      const hit = allLis.filter((li) => {
        const liR = doc.createRange(); liR.selectNodeContents(li);
        return r.compareBoundaryPoints(3, liR) < 0 && r.compareBoundaryPoints(1, liR) > 0; // r.start<liR.end && r.end>liR.start（严格重叠）
      });
      if (!hit.length) return null;
      const i = allLis.indexOf(hit[0]), j = allLis.indexOf(hit[hit.length - 1]);
      return allLis.slice(i, j + 1);
    }
    // 「转为」只作用于选中的行：把 <ul>/<ol> 在选中 li 跨度处劈成 [前列表][选中行]（[后列表]），让选中 li 独占原 <ul>，
    // 再复用整块 turnInto——产物、class 迁移、data-checked 清理、conform 全走既有逻辑，零重复。全选（跨全部 li）= 整块转换。
    function turnIntoLines(ul, lis, item) {
      // 目标就是当前列表类型（选中行「转为」它已经是的类型）→ 空操作，别把一张列表劈成三张（对抗审查 LOW）。
      if (item.tag === ul.tagName.toLowerCase() && ((item.cls === 'ws-todo') === ul.classList.contains('ws-todo'))) return ul;
      const allLis = [...ul.children].filter((c) => c.tagName === 'LI');
      const firstIdx = allLis.indexOf(lis[0]), lastIdx = allLis.indexOf(lis[lis.length - 1]);
      if (firstIdx < 0 || lastIdx < 0) return null; // 传进来的行不是本列表的直接子项（如嵌套行）→ 拒绝，绝不悄悄整块转（P1-2）
      // 选中行的**嵌套子列表**先摘下来（对拍 F12：不摘的话 flattenListToPhrasing 会把整棵子树拍进产物文字里，
      // 子项作为独立条目彻底消失 = 丢内容）。转成列表类目标时不摘（子树本就该继续挂着）。
      // ⚠ 这一段必须在下面的「整块捷径」**之前**（对抗审查 ADV-1，实机复现：子项数直接归 0）。
      //   原来它在捷径之后 → 当选中行**恰好是这张列表唯一的顶层行**时 `firstIdx===0 && lastIdx===len-1`
      //   成立、直接 `return turnInto(ul, item)`，整棵子树被拍成 `<p>父<br>子一<br>孙</p>`，待办勾选态一起没，
      //   1.2 秒后自动保存写盘。而且 **E1 自己会制造这个条件**：剥掉中间一行后，剩下那半张就是单行列表，
      //   下一次行首退格就炸。turnIntoLines 是**行级**入口，整块转换有 turnInto 这个独立入口（调用点已分流），
      //   所以行级路径无论列表里有几行，都必须保子树。
      const LEAF_LIKE = { p: 1, h1: 1, h2: 1, h3: 1, h4: 1, blockquote: 1, div: 1 };
      const detached = [];
      if (LEAF_LIKE[item.tag]) {
        for (const li of lis) {
          for (const c of [...li.children]) if (c.tagName === 'UL' || c.tagName === 'OL') { detached.push(c); c.remove(); }
        }
      }
      // 前段要继承原列表的 start（分割点**之前**的序号一个都不该变——Notion 同款，对拍 N8 实测）；
      // 后段不带 start = 从 1 重启（这半边本来就对齐 Notion）。tail 传 false。
      const mkUl = (keepStart) => {
        const u = doc.createElement(ul.tagName);
        if (ul.className) u.className = ul.className;
        if (keepStart && ul.hasAttribute('start')) u.setAttribute('start', ul.getAttribute('start'));
        return u;
      };
      if (firstIdx > 0) { const b = mkUl(true); for (let k = 0; k < firstIdx; k++) b.appendChild(allLis[k]); ul.before(b); }
      if (lastIdx < allLis.length - 1) { const a = mkUl(false); for (let k = lastIdx + 1; k < allLis.length; k++) a.appendChild(allLis[k]); ul.after(a); }
      // 子树在 DOM 外期间抑制 checkpoint（P1-1）：否则 turnInto 内部那次快照记下「子项已消失」的中间态，
      // 一次 undo 就落到它、并被自动保存写进磁盘。接回子树后再统一落一次。
      ckSuppressed = detached.length > 0;
      let nx;
      try { nx = turnInto(ul, item); } finally { ckSuppressed = false; } // ul 只剩选中 li → 产物替换 ul、留原位
      // 摘下的子树接回产物之后：段落之下无法承载嵌套，故层级降一级成顶层列表（内容零丢失，缩进降级见 spec）。
      let ref = nx;
      for (const sub of detached) { ref.after(sub); ref = sub; }
      // 行上的 id 迁到产物上（对抗审查 ADV-7）：`collectLiLines` 只克隆 li 的 childNodes、从不带 li 自身属性，
      // 而 retagElement 保的是 <ul> 的属性——于是一次行首退格就把该行的 id 锚点静默销毁，跨文档
      // #anchor 链接断链且没有任何提示。E1 之前这条路只在菜单「转为」时走，现在是日常按键，必须保。
      // 只在产物自己没有 id 时迁（产物已有 id = 继承自 <ul> 的块锚点，那个更不能覆盖）。
      if (lis.length === 1 && lis[0].id && nx && nx.nodeType === 1 && !nx.id) nx.id = lis[0].id;
      if (nx && nx.nodeType === 1 && !nx.firstChild) nx.appendChild(doc.createElement('br')); // 空产物必带 <br>，否则光标落不进去（E2 分支早有同款保险，这里补齐）
      if (detached.length) { if (undoMgr) undoMgr.checkpoint(); markDirty(); }
      return nx;
    }
    function removeBlock(el) {
      const scope = scopeRootOf(el); // U6：作用域感知——toggle 体内删块按体内计数；≥1 块铁则（summary-only 死胡同）
      const blocks = (scope === blockRoot) ? topBlocks() : blocksInScope(scope);
      if (blocks.length <= 1) {
        // 删到作用域只剩一块 → 清空成空正文进编辑，避免空白死状态
        const p = fmt.retagElement(el, 'p'); p.innerHTML = '';
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        enterEdit(p, { mode: 'start' });
        return;
      }
      const idx = blocks.indexOf(el);
      el.remove();
      if (undoMgr) undoMgr.checkpoint(); markDirty();
      deselect();
    }

    // ---- 格式气泡内容（对齐 ui-demo FormatToolbar）----
    // 选区是否落在同一块级元素内（折叠选区视为安全）。跨块用 execCommand 改结构会产生非法嵌套/
    // 写坏文档——对齐 wrapInlineStyle 的「跨块拒绝」保真红线；B/I/U/S/行内代码/链接此前都缺这道守卫。
    function selWithinOneBlock() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      const r = sel.getRangeAt(0);
      if (r.collapsed) return true; // 折叠选区：execCommand 作用于光标处，安全
      const a = fmt.nearestBlock(r.startContainer, body);
      return !!a && a === fmt.nearestBlock(r.endContainer, body);
    }
    // 粗/斜/下划线/删除线：自由跨块——把选区按块切成子段，逐块聚焦+选中该段+execCommand，作用到选区里
    // 每个块的部分（不受块限制，这是用户要的）。实测 execCommand 逐块跑不写坏文档（已 fact-check）。
    // 临时设可编辑的块打 data-ws2-ce，serialize 会剥掉 contenteditable，存盘干净。
    function execText(cmd) {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      if (sel.isCollapsed) { doc.execCommand(cmd, false, null); markDirty(); persistEditing(); return; } // 折叠：作用于光标
      const full = sel.getRangeAt(0);
      // cell 分支（U4/R1 另一半）：选区两端同在一个 td/th → 直接对该 cell 执行——原实现按 blockOf 上卷到
      // TABLE 被 isEditableEl 跳过 = fmtbar 死按钮。execCommand bold/italic 只产 phrasing，cell 内合法。
      // 跨格/半跨（一端在表内）格式化不作用：选区语义归清内容/整删，混合格式化 v1 不做。
      {
        const sCell2 = cellOfNode(full.startContainer), eCell2 = cellOfNode(full.endContainer);
        if (sCell2 && sCell2 === eCell2) {
          const blk2 = blockOf(sCell2);
          if (blk2 && classify(blk2) === 'table') {
            // 真实路径里选区来自 cell 编辑态（cellEl===sCell2、contenteditable 已在）；罕见的无 cell 态格内
            // 选区先 enterCell（mode:keep 保留选区）——统一走状态机，不手搓临时 contenteditable（防 desync）。
            if (cellEl !== sCell2) { // focus 可能折叠选区——照 onMouseUp 恢复范式，先存端点再重设
              const sc0 = full.startContainer, so0 = full.startOffset, ec0 = full.endContainer, eo0 = full.endOffset;
              enterCell(sCell2, { mode: 'keep' });
              try { const rr = doc.createRange(); rr.setStart(sc0, so0); rr.setEnd(ec0, eo0); const s2 = doc.getSelection(); s2.removeAllRanges(); s2.addRange(rr); } catch (x) {}
            }
            try { doc.execCommand('styleWithCSS', false, false); } catch (x) {}
            doc.execCommand(cmd, false, null);
            markDirty(); persistEditing();
            return;
          }
        } else if (sCell2 || eCell2) return;
      }
      // 作用域感知（U6）：跨作用域（选区横跨 summary/正文/外层）格式化会注入跨界 span → 非合规，直接拒绝（安全）。
      if (scopeRootOf(full.startContainer) !== scopeRootOf(full.endContainer)) return;
      const tops = blocksInScope(scopeRootOf(full.startContainer));
      let i = tops.indexOf(blockOf(full.startContainer)), j = tops.indexOf(blockOf(full.endContainer));
      if (i < 0 || j < 0) { doc.execCommand(cmd, false, null); markDirty(); persistEditing(); return; } // 兜底
      if (i > j) { const t = i; i = j; j = t; }
      const sC = full.startContainer, sO = full.startOffset, eC = full.endContainer, eO = full.endOffset;
      for (let k = i; k <= j; k++) {
        const blk = tops[k];
        if (!isEditableEl(blk)) continue; // 图片/分隔线等跳过
        const wasCE = blk.getAttribute('contenteditable') === 'true';
        if (!wasCE) { blk.setAttribute('contenteditable', 'true'); blk.setAttribute('data-ws2-ce', ''); }
        blk.focus();
        const r = doc.createRange();
        if (k === i) r.setStart(sC, sO); else r.setStart(blk, 0);
        if (k === j) r.setEnd(eC, eO); else r.setEnd(blk, blk.childNodes.length);
        const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
        try { doc.execCommand('styleWithCSS', false, false); } catch (e) {}
        doc.execCommand(cmd, false, null);
        if (!wasCE) { blk.removeAttribute('contenteditable'); blk.removeAttribute('data-ws2-ce'); } // 还原临时可编辑块
      }
      if (editingEl && editingEl.isConnected) editingEl.focus(); // 焦点还给原编辑块（别丢到末块）
      markDirty(); persistEditing();
    }
    // 删非折叠选区：覆盖「拖选没进编辑态」和「跨块选区」——这俩原生删不掉（选区横跨多个各自独立的
    // contenteditable 块，或没有任何 contenteditable 宿主），用户只能一个字一个字删（Wendi Bug4/5）。
    // 返回 true=已处理（调用方 preventDefault）；false=交原生（如编辑态单块内选区，原生删得了）。
    function deleteSelection() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
      const r = sel.getRangeAt(0);
      const sumOf = (n) => { const e = n && (n.nodeType === 3 ? n.parentElement : n); return e && e.closest ? e.closest('summary') : null; };
      // 对抗审查（沿袭 U23）：端点**锚在 details 元素本身**（selectWholeDoc 把 ⌘A 端点锚在首/末块元素上）时，
      // 该 details 是整体在选区一侧、不是「部分进入体内」——若 detOf 用 closest('details') 会把它自己算进去 →
      // 「⌘A 全选删」在首/末为 toggle 的文档里误判。故端点是 DETAILS 本身 → 取其外层 details 或 null，绝不算它自己。
      const detOf = (n) => { let e = n && (n.nodeType === 3 ? n.parentElement : n); if (!e || !e.closest) return null; if (e.tagName === 'DETAILS') return e.parentElement && e.parentElement.closest ? e.parentElement.closest('details') : null; return e.closest('details'); };
      // 裁空列表 de-list（bug6，定义上移供 toggle 分支共用）：整列表无文字 → 就地换空 <p>，防非法空 <ul>/悬空勾选框。
      const fixEmptyList = (b) => { if (b && (b.tagName === 'UL' || b.tagName === 'OL') && b.parentNode && (b.textContent || '').trim() === '' && !b.querySelector('img, figure, table')) { const np = doc.createElement('p'); b.parentNode.replaceChild(np, b); return np; } return b; };
      // ── U26（Colin 2026-07-24「toggle 块操作与其他块同步」）：同一 toggle 内跨 summary↔正文的删除——
      // 旧 U23 一致化空操作是 deferred 的临时保守解（a254cb6），现收账：全覆盖=整删 toggle（「全选标题+内容
      // 按 Delete」= 用户要整个 toggle 消失）；部分覆盖=裁剪式删除（summary 裁尾、中间正文块删、末块裁头），
      // **绝不合并**（summary 吞正文 = 非合规红线不破），正文删空补 <p>（≥1 块铁则）。Range 恒文档序正向 ⇒
      // 跨界时 start 必在 summary（首子）、end 在正文。
      const sSum = sumOf(r.startContainer), eSum = sumOf(r.endContainer);
      const sDet = detOf(r.startContainer), eDet = detOf(r.endContainer);
      if (sSum !== eSum && sDet && sDet === eDet && sSum === summaryOf(sDet) && !eSum) {
        const sum = sSum;
        const bodyBlocks = blocksInScope(sDet);
        const eBlk0 = blockOf(r.endContainer);
        const ei = bodyBlocks.indexOf(eBlk0);
        if (ei < 0) return false; // 防御：end 不在体内顶层块（理论不可达）→ 不碰
        let covered = false, preEmpty = false; // preEmpty = summary 起点前无文字（summary 整行被罩）
        try {
          const preR = doc.createRange(); preR.setStart(sum, 0); preR.setEnd(r.startContainer, r.startOffset);
          const postR = doc.createRange(); postR.setStart(r.endContainer, r.endOffset); postR.setEnd(eBlk0, eBlk0.childNodes.length);
          preEmpty = preR.toString().trim() === '';
          covered = preEmpty && ei === bodyBlocks.length - 1
            && postR.toString().trim() === '' && !postR.cloneContents().querySelector('img,figure,table,details,video,hr');
        } catch (x) { covered = false; }
        if (covered) {
          const nb = sDet.nextElementSibling, pb = sDet.previousElementSibling;
          sDet.remove();
          markDirty(); if (undoMgr) undoMgr.checkpoint();
          const anchor = (nb && !(nb.hasAttribute && nb.hasAttribute('data-ws2-ui'))) ? nb : pb;
          if (anchor && isEditableEl(anchor)) enterEdit(anchor, { mode: 'start' });
          else if (anchor) { selectBlock(anchor); positionGrip(anchor); }
          else deselect();
          return true;
        }
        // 末端体内块裁头（三分支共用）
        const trimEnd = () => {
          let eb = eBlk0;
          if (isEditableEl(eb)) {
            const r2 = doc.createRange(); r2.setStart(eb, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents();
            eb = fixEmptyList(eb);
            if ((eb.textContent || '').trim() === '' && !eb.querySelector('img,figure,table,details')) { eb.remove(); eb = null; } // 裁空即删
          } else { eb.remove(); eb = null; } // 结构末块（img/table/嵌套 toggle）→ 整删（ED-A2）
          return eb;
        };
        if (preEmpty) {
          // 精确契约（Colin 2026-07-24 二轮）：summary 整行被罩 = toggle 解散——壳删掉、幸存体内块**原样提升**
          //（去壳不转造，内容零丢失）。选区起点即 summary 头 ⇒ 前面无断口、无合并对象，光标落提升后首块头。
          for (let k = ei - 1; k >= 0; k--) bodyBlocks[k].remove();
          trimEnd();
          const rest = blocksInScope(sDet);
          rest.forEach((b) => sDet.parentElement.insertBefore(b, sDet));
          const pb = sDet.previousElementSibling && rest.length === 0 ? sDet.previousElementSibling : null;
          const nb2 = sDet.nextElementSibling;
          sDet.remove();
          markDirty(); if (undoMgr) undoMgr.checkpoint();
          const anchor = rest.find((b) => isEditableEl(b)) || rest[0] || pb || nb2 || null;
          if (anchor && isEditableEl(anchor)) enterEdit(anchor, { mode: 'start' });
          else if (anchor) { selectBlock(anchor); positionGrip(anchor); }
          else deselect();
          return true;
        }
        // summary 部分被罩：裁剪、toggle 存活、跨壁不并（summary 吞正文 = 非合规红线不破）
        const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sum, sum.childNodes.length); r1.deleteContents(); // summary 裁尾
        for (let k = ei - 1; k >= 0; k--) bodyBlocks[k].remove(); // start 在 summary ⇒ end 块之前的正文块全在选区内 → 整删
        trimEnd();
        if (blocksInScope(sDet).length === 0) sDet.appendChild(doc.createElement('p')); // ≥1 正文块铁则
        markDirty(); if (undoMgr) undoMgr.checkpoint();
        enterEdit(sum, { mode: 'end' });
        return true;
      }
      // U26：跨 details 外边界（一端在内一端在外/分属不同 toggle）不再空操作——落进下面管线端点上卷、
      // toggle 整删。与块级高亮 refreshRangeSel 同款上卷 = 所见即所删（高亮早已把整个 toggle 标蓝，
      // 删除兑现承诺）；对齐 table 的 ED-A2「结构端点整块删」先例。flashNope 空操作反馈随之退役。
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (!sBlk || !eBlk) return false; // 选区落在块外/覆盖层 → 不碰
      // 同表跨格选区（U4/KTD3，Colin 2026-08-03）：清内容不动结构——线性被罩集与原生高亮一致；全罩格清空
      // 为 <br>，端点格按 range 裁剪（cell phrasing-only ⇒ 裁剪安全、绝无非矩形）。纯内容删除 = 单 checkpoint 一步 undo。
      if (sBlk === eBlk && sBlk.tagName === 'TABLE') {
        const sC = cellOfNode(r.startContainer), eC = cellOfNode(r.endContainer);
        if (sC && eC && sC !== eC) {
          const hit = cellSpanOf(sBlk, sC, eC); // 与高亮同一来源（所见即所删）
          if (!hit || !hit.length) return false;
          if (undoMgr) undoMgr.checkpoint(); // KTD6：先结算 500ms 防抖窗口内的打字债，否则一次 undo 连字带清格一起吞
          for (const c of hit) {
            if (c === sC) { try { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(c, c.childNodes.length); r1.deleteContents(); } catch (x) {} }
            else if (c === eC) { try { const r2 = doc.createRange(); r2.setStart(c, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); } catch (x) {} }
            else { while (c.firstChild) c.removeChild(c.firstChild); }
            if (!c.firstChild) c.appendChild(doc.createElement('br')); // 空格占位，光标落得进
          }
          markDirty(); if (undoMgr) undoMgr.checkpoint();
          enterCell(sC, { mode: 'end' });
          return true;
        }
        // 端点在表元素层（表-only 文档 ⌘A 全篇锚 (table,0)-(table,len)）且选区罩住整表 → ED-A2 整删——
        // 否则「全选后删除/打字覆盖」silent no-op（correctness+adversarial 同报）。删成空文档则补空 <p> 进编辑。
        if (!sC || !eC) {
          try {
            const whole = doc.createRange(); whole.selectNodeContents(sBlk);
            if (r.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 && r.compareBoundaryPoints(Range.END_TO_END, whole) >= 0) {
              const nb = sBlk.nextElementSibling, pb = sBlk.previousElementSibling;
              exitCell();
              sBlk.remove();
              if (blocksInScope(blockRoot).length === 0) {
                const p = doc.createElement('p'); p.appendChild(doc.createElement('br')); blockRoot.appendChild(p);
                markDirty(); if (undoMgr) undoMgr.checkpoint();
                enterEdit(p, { mode: 'start' });
                return true;
              }
              markDirty(); if (undoMgr) undoMgr.checkpoint();
              const anchor2 = (nb && !(nb.hasAttribute && nb.hasAttribute('data-ws2-ui'))) ? nb : pb;
              if (anchor2 && isEditableEl(anchor2)) enterEdit(anchor2, { mode: 'start' });
              else if (anchor2) { selectBlock(anchor2); positionGrip(anchor2); }
              else deselect();
              return true;
            }
          } catch (x) {}
          return false;
        }
        return false; // 同格内选区 → 原生（cell contenteditable 删得动）
      }
      if (sBlk === eBlk) {
        if (editingEl === sBlk) return false;  // 编辑态单块内选区 → 原生删得了
        if (!isEditableEl(sBlk)) return false; // 不可编辑块 → 不碰
        // 无编辑态的单块拖选：进编辑（保留选区）→ 重设选区 → execCommand 删
        const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
        enterEdit(sBlk, { mode: 'keep' });
        try { const cr = doc.createRange(); cr.setStart(sc, so); cr.setEnd(ec, eo); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
        doc.execCommand('delete'); markDirty(); if (undoMgr) undoMgr.scheduleCheckpoint();
        return true;
      }
      // 跨块（作用域感知，U6）。跨作用域走下面精确版（Colin 2026-07-24 二轮）；同作用域沿用原管线。
      const sScope = scopeRootOf(r.startContainer), eScope = scopeRootOf(r.endContainer);
      const crossScope = sScope !== eScope;
      // ── 精确跨作用域删除（Colin 2026-07-24 二轮拍板）：「从哪删到哪」——起块裁尾、末块裁头、完全罩住的
      // 顶层单位整删；summary 整行被罩 = toggle 解散（壳删、幸存体内块**原样提升**，去壳不转造）；summary
      // 只被裁一半 = toggle 存活、跨壁不并（不吸不漏）；table 端点整删（部分裁剪必产非合规，ED-A2，高亮已
      // 整行蓝预示）。合并「以上块为准」：断口两端同层且 canMerge → 下块剩余并入上块（上块是列表 → 并进
      // 最后一项）。旧「端点上卷整块删」随精确契约废除。──
      if (crossScope) {
        const tops = blocksInScope(blockRoot);
        const sTop = topScopeOf(sBlk), eTop = topScopeOf(eBlk);
        const i = tops.indexOf(sTop), j = tops.indexOf(eTop);
        if (i < 0 || j < 0 || i > j) return false;
        let frontEnd = null, backEnd = null, anchorFallback = null;
        // ── 前端（sTop）──
        if (sTop.tagName === 'DETAILS') {
          const sum = summaryOf(sTop);
          if (sBlk === sTop) { // start 在 summary 内（blockOf(summary)=details）：summary 裁尾；体内块全在选区内 → 删光补 p
            try { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sum, sum.childNodes.length); r1.deleteContents(); } catch (x) {}
            blocksInScope(sTop).forEach((b) => b.remove());
            sTop.appendChild(doc.createElement('p')); // ≥1 正文块铁则
            anchorFallback = sum; // toggle 存活、跨壁不并，光标落 summary 尾
          } else { // start 在体内块：summary 在选区前 → toggle 存活；起块裁尾、体内后续块删
            const bb = blocksInScope(sTop), bi = bb.indexOf(sBlk);
            if (bi < 0) return false;
            for (let k = bb.length - 1; k > bi; k--) bb[k].remove();
            if (isEditableEl(sBlk)) {
              try { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sBlk, sBlk.childNodes.length); r1.deleteContents(); } catch (x) {}
              anchorFallback = fixEmptyList(sBlk); // 列表裁空 de-list；体内唯一块留空=铁则等效
            } else { sBlk.remove(); anchorFallback = sum; }
            if (blocksInScope(sTop).length === 0) { const np = doc.createElement('p'); sTop.appendChild(np); anchorFallback = np; }
          }
        } else if (isEditableEl(sTop)) {
          try { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sTop, sTop.childNodes.length); r1.deleteContents(); } catch (x) {}
          frontEnd = fixEmptyList(sTop);
          anchorFallback = frontEnd;
        } else { // 端点落在 table/img 等结构块内 → 整删（ED-A2；高亮已整行蓝预示）
          anchorFallback = sTop.previousElementSibling;
          sTop.remove();
        }
        // ── 中间（完全罩住）整删 ──
        for (let k = j - 1; k > i; k--) { const m = tops[k]; if (m && m.parentElement === blockRoot) m.remove(); }
        // ── 后端（eTop）──
        if (eTop.tagName === 'DETAILS') {
          const sum = summaryOf(eTop);
          if (eBlk === eTop) { // end 在 summary 内：summary 裁头、toggle 存活、体内不动、跨壁不并
            try { const r2 = doc.createRange(); r2.setStart(sum, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); } catch (x) {}
          } else { // end 在体内块 ⇒ summary 整行夹在选区中 → 解散：壳删、被罩体内块删、末块裁头、幸存原样提升
            const bb = blocksInScope(eTop), ei2 = bb.indexOf(eBlk);
            if (ei2 >= 0) for (let k = ei2 - 1; k >= 0; k--) bb[k].remove();
            if (isEditableEl(eBlk)) {
              try { const r2 = doc.createRange(); r2.setStart(eBlk, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); } catch (x) {}
              const eb = fixEmptyList(eBlk);
              if ((eb.textContent || '').trim() === '' && !eb.querySelector('img,figure,table,details')) eb.remove(); // 裁空即删
            } else if (eBlk !== eTop) eBlk.remove();
            const rest = blocksInScope(eTop);
            rest.forEach((b) => eTop.parentElement.insertBefore(b, eTop)); // 幸存体内块原样提升（去壳不转造）
            eTop.remove();
            backEnd = (rest.length && isEditableEl(rest[0])) ? rest[0] : null;
          }
        } else if (isEditableEl(eTop)) {
          try { const r2 = doc.createRange(); r2.setStart(eTop, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); } catch (x) {}
          backEnd = fixEmptyList(eTop);
          if (backEnd && (backEnd.textContent || '').trim() === '' && !backEnd.querySelector('img,figure,table,details')) { backEnd.remove(); backEnd = null; } // 裁空即删
        } else { eTop.remove(); } // table/img 末端整删
        // ── 合并：以上块为准（同层 + 白名单）──
        const finishAt = (el, prefixEnd2) => {
          markDirty(); if (undoMgr) undoMgr.checkpoint();
          enterEdit(el, { mode: 'keep' });
          try { const cr = doc.createRange(); if (prefixEnd2 && prefixEnd2.parentNode) cr.setStartAfter(prefixEnd2); else cr.setStart(el, 0); cr.collapse(true); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
        };
        if (frontEnd && backEnd && frontEnd.parentElement && frontEnd.parentElement === backEnd.parentElement) {
          if (SM.canMerge(frontEnd, backEnd)) {
            const pe = frontEnd.lastChild;
            while (backEnd.firstChild) frontEnd.appendChild(backEnd.firstChild);
            backEnd.remove();
            finishAt(frontEnd, pe);
            return true;
          }
          if ((frontEnd.tagName === 'UL' || frontEnd.tagName === 'OL') && SM.isLeafTextBlock(backEnd)) {
            const lis = [...frontEnd.children].filter((c) => c.tagName === 'LI');
            const last = lis[lis.length - 1];
            if (last) { // 上块是列表 → 下块剩余并进最后一项（Notion 同款）
              const pe = last.lastChild;
              while (backEnd.firstChild) last.appendChild(backEnd.firstChild);
              backEnd.remove();
              finishAt(frontEnd, pe);
              return true;
            }
          }
        }
        markDirty(); if (undoMgr) undoMgr.checkpoint();
        const anc = frontEnd || anchorFallback || backEnd;
        if (anc && anc.tagName === 'SUMMARY') enterEdit(anc, { mode: 'end' });
        else if (anc && isEditableEl(anc)) enterEdit(anc, { mode: (anc === backEnd && !frontEnd && !anchorFallback) ? 'start' : 'end' });
        else if (anc && anc.parentElement) { selectBlock(anc); positionGrip(anc); }
        else {
          const rest2 = blocksInScope(blockRoot); const a2 = rest2[Math.min(i, rest2.length - 1)] || rest2[0] || null;
          if (a2 && isEditableEl(a2)) enterEdit(a2, { mode: 'start' });
          else if (a2) { selectBlock(a2); positionGrip(a2); }
          else deselect();
        }
        return true;
      }
      // ── 同作用域（纯顶层块之间 / 同一 toggle 体内块之间）：原管线 ──
      const scopeRoot = sScope;
      const tops = blocksInScope(scopeRoot);
      let sB = sBlk, eB = eBlk;
      const i = tops.indexOf(sB), j = tops.indexOf(eB);
      if (i < 0 || j < 0 || i > j) return false;
      // 修 ED-A2/A3：端点是结构块（table/figure/img）时 Range 部分裁剪会削出非合规 → 只对可编辑叶子块
      // 部分裁剪，结构端点整块删。
      const sEditable = isEditableEl(sB), eEditable = isEditableEl(eB);
      if (sEditable) { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sB, sB.childNodes.length); r1.deleteContents(); } // 裁起块：选区起点→块末
      if (eEditable) { const r2 = doc.createRange(); r2.setStart(eB, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); }                       // 裁末块：块首→选区终点
      for (let k = j - 1; k > i; k--) { const m = tops[k]; if (m && m.parentElement === scopeRoot) m.remove(); }                            // 删中间整块（作用域内）
      // 修 bug6：裁空的列表端点就地换空 <p>（de-list，定义已上移到函数顶部）。放在合并前——
      // 两端都成空 <p> 时下面的 canMerge 会把它们并成一个干净空块（对齐"选全部再删=一个空块"）。
      sB = fixEmptyList(sB); eB = fixEmptyList(eB);
      const prefixEnd = sEditable ? sB.lastChild : null; // 接合点（合并前 prefix 末尾）
      if (sEditable && eEditable && SM.canMerge(sB, eB)) { // 两端都是存活的叶子文字块才节点级拼接
        while (eB.firstChild) sB.appendChild(eB.firstChild); // 末块剩余并入起块
        eB.remove();
      } else if (sEditable && eEditable && (sB.tagName === 'UL' || sB.tagName === 'OL') && SM.isLeafTextBlock(eB) && sB.parentElement === eB.parentElement) {
        // 合并以上块为准（Colin 2026-07-24 二轮）：上块是列表 → 下块剩余并进最后一项（Notion 同款，原先留两截）
        const lis = [...sB.children].filter((c) => c.tagName === 'LI');
        const last = lis[lis.length - 1];
        if (last) { const pe2 = last.lastChild; while (eB.firstChild) last.appendChild(eB.firstChild); eB.remove(); markDirty(); if (undoMgr) undoMgr.checkpoint(); enterEdit(sB, { mode: 'keep' }); try { const cr = doc.createRange(); if (pe2 && pe2.parentNode) cr.setStartAfter(pe2); else cr.setStart(last, 0); cr.collapse(true); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {} return true; }
      }
      if (!eEditable) eB.remove(); // 结构端点整删（ED-A2）
      if (!sEditable) sB.remove();
      // toggle 体 ≥1 块铁则：作用域删空 → 补一个空 <p>（summary-only 是死胡同）
      if (scopeRoot !== blockRoot && blocksInScope(scopeRoot).length === 0) scopeRoot.appendChild(doc.createElement('p'));
      markDirty(); if (undoMgr) undoMgr.checkpoint();
      // 光标/选中落点：优先存活的起块，其次存活的末块，再次删除处附近块
      let anchor = sEditable && sB.parentElement ? sB : (eEditable && eB.parentElement ? eB : null);
      if (!anchor) { const rest = blocksInScope(scopeRoot); anchor = rest[Math.min(i, rest.length - 1)] || rest[0] || null; }
      if (anchor && isEditableEl(anchor)) {
        enterEdit(anchor, { mode: 'keep' });
        try { const cr = doc.createRange(); if (anchor === sB && prefixEnd && prefixEnd.parentNode === sB) cr.setStartAfter(prefixEnd); else cr.setStart(anchor, 0); cr.collapse(true); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
      } else if (anchor) { selectBlock(anchor); positionGrip(anchor); }
      return true;
    }
    // 在光标处把当前编辑块劈成两个同类型同 class 的顶层块（换段）。非折叠选区先删再劈。光标落后块块首。
    // 用来取代「段落中间按 Enter 交原生」——原生在 contenteditable 的 <p> 里回车会塞嵌套 <p>，写坏文档（Bug7）。
    function splitBlock() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || !editingEl) return false;
      if (editingEl.tagName === 'SUMMARY') return false; // U13 防御纵深：绝不劈 summary（否则产第二个 summary → 非合规）
      if (editingEl.tagName === 'DETAILS') return false; // details 容器本身不可编辑，别劈
      if (!sel.isCollapsed) doc.execCommand('delete'); // 选中文字后回车：先删选区，再在塌陷点劈
      const r = sel.getRangeAt(0);
      const el = editingEl;
      if (!el.contains(r.endContainer)) return false;
      const tail = doc.createRange();              // 光标 → 块末 = 后半段
      tail.setStart(r.endContainer, r.endOffset);
      tail.setEnd(el, el.childNodes.length);
      const frag = tail.extractContents();         // 后半段从原块移出（extractContents 会正确劈开跨界的行内标签，如 <b>）
      const nx = doc.createElement(el.tagName);
      if (el.className) nx.className = el.className;
      nx.appendChild(frag);
      // 剥后块及其后代的 id：劈透明包裹块（div.lead>p#id）或含 id 的行内元素时，extractContents 会连 id 一起
      // 克隆 → 文档出现重复 id（坏锚点/选择器/getElementById）。前块保留原 id，后块去重（对齐 duplicateBlock，A 组）。
      if (nx.id) nx.removeAttribute('id');
      nx.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
      el.after(nx);
      if (undoMgr) undoMgr.checkpoint(); markDirty();
      enterEdit(nx, { mode: 'start' });
      return true;
    }
    function applyColor(prop, value) {
      // 颜色/高亮：用 CSSOM span（KTD2）。wrapInlineStyle 内部已含跨块拒绝。
      if (fmt.wrapInlineStyle(doc, prop, value)) { markDirty(); persistEditing(); }
    }
    function addLink() {
      // U3 气泡「链接」：有文件身份 + 有选区 → 文档选择菜单（wrap 模式：选中文字整体变链接、保留用户文字）；
      // 无身份（临时/工作区外）或无选区 → 退回网址 prompt（iframe sandbox 无 allow-modals，用父窗口 global.prompt）。
      const ctx = docCtx();
      const sel = doc.getSelection();
      const hasSel = sel && sel.rangeCount && !sel.isCollapsed && selWithinOneBlock();
      if (mentionApi() && ctx && ctx.rootId != null && hasSel) {
        const blk = editingEl || blockOf(sel.getRangeAt(0).startContainer);
        // 气泡链接：菜单锚到「链接」按钮正下方（用户点这里，菜单像从按钮掉下来）——
        // 而不是选区下方（Colin 2026-07-09：点上方按钮、菜单落在选区下隔着一整行=手感很远）。
        const linkBtn = fmtbar.querySelector('button[title="' + T('editor.link') + '"]');
        let anchor = null;
        if (linkBtn) { const b = linkBtn.getBoundingClientRect(); if (b.height) anchor = { top: b.bottom + 6, left: b.left, above: b.top }; }
        openMention(blk, 0, 'wrap', sel.getRangeAt(0).cloneRange(), anchor);
        return;
      }
      const url = global.prompt ? global.prompt(T('editor.linkUrlPrompt'), 'https://') : null;
      if (!url) return;
      const href = fmt.safeHref(url);
      if (!href) { if (global.alert) global.alert(T('editor.linkNotAllowed')); return; }
      doc.execCommand('createLink', false, href);
      markDirty(); persistEditing();
    }
    // U6（§0 决策1）：高亮用 <mark>（行内、语义对、无 CSS 也黄底）；多色靠 mark 行内 style（校验器允许行内 style）。
    function wrapMark(bg) {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!fmt.clampRangeToBlock(doc, range, body)) return; // 跨块拒绝 + 列表项 Shift+End 幽灵边界夹回起块（否则高亮没反应）
      const mk = doc.createElement('mark');
      if (bg) mk.style.background = bg;
      try { range.surroundContents(mk); } catch (e) { mk.appendChild(range.extractContents()); range.insertNode(mk); }
      markDirty(); persistEditing();
    }
    function wrapCode() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!fmt.clampRangeToBlock(doc, range, body)) return; // 跨块拒绝 + 列表项 Shift+End 幽灵边界夹回起块
      const code = doc.createElement('code');
      try { range.surroundContents(code); } catch (e) { code.appendChild(range.extractContents()); range.insertNode(code); }
      markDirty(); persistEditing();
    }
    function persistEditing() { /* DOM 即模型：编辑直接改 DOM，无需额外落库；标脏即可 */ }

    function fmtBtn(title, html, on) {
      const b = doc.createElement('button'); b.setAttribute('data-ws2-ui', WS2_OVERLAY); b.className = 'ws-fmtbar-btn'; b.title = title; b.innerHTML = html;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
      return b;
    }
    function buildFmtbar() {
      fmtbar.innerHTML = '';
      // 转为▾
      const turn = fmtBtn(T('editor.turnInto'), '<span class="ws-fmtbar-text">' + T('editor.turnInto') + ' <svg style="vertical-align:-2px" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>', () => { if (cellEl) return; openTurnMenu(); }); // cell 态禁「转为」（KTD5：cell 放不下块级转换）
      turn.className = 'ws-fmtbar-btn ws-fmtbar-text';
      fmtbar.appendChild(turn);
      fmtbar.appendChild(sepEl());
      fmtbar.appendChild(fmtBtn(T('editor.bold'), '<b>B</b>', () => execText('bold')));
      fmtbar.appendChild(fmtBtn(T('editor.italic'), '<i>I</i>', () => execText('italic')));
      fmtbar.appendChild(fmtBtn(T('editor.underline'), '<u>U</u>', () => execText('underline')));
      fmtbar.appendChild(fmtBtn(T('editor.strike'), '<s>S</s>', () => execText('strikeThrough')));
      fmtbar.appendChild(fmtBtn(T('editor.inlineCode'), '<span style="font-family:monospace">&lt;&gt;</span>', () => wrapCode()));
      fmtbar.appendChild(sepEl());
      fmtbar.appendChild(colorHolder(T('editor.textColorShort'), false));
      fmtbar.appendChild(colorHolder(T('editor.highlightShort'), true));
      fmtbar.appendChild(fmtBtn(T('editor.link'), '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>', () => addLink()));
      fmtbar.appendChild(sepEl());
      const ai = fmtBtn('AI', '<span class="ws-fmtbar-ai">✦ AI</span>', () => onAiSoon());
      ai.className = 'ws-fmtbar-btn ws-fmtbar-ai';
      fmtbar.appendChild(ai);
    }
    function sepEl() { const s = doc.createElement('span'); s.setAttribute('data-ws2-ui', WS2_OVERLAY); s.className = 'ws-fmtbar-sep'; return s; }
    // TEXT_COLORS 声明已上移到语义 CSS 常量区（attach 早期 refreshSemanticStyles 要用,躲 TDZ）。
    const HILITE_COLORS = ['#fff3bf', '#ffd8d8', '#d7f0db', '#d6e4ff', '#eadcff', '#eceef0'];
    function colorHolder(title, hilite) {
      const holder = doc.createElement('span'); holder.setAttribute('data-ws2-ui', WS2_OVERLAY); holder.className = 'ws-fmtbar-holder';
      const btn = fmtBtn(title, hilite
        ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l3-1 11-11-2-2L4 18z"/><path d="M14 7l3 3"/></svg>'
        : '<span class="ws-fmtbar-aglyph">A</span>', () => togglePop(pop));
      const pop = doc.createElement('div'); pop.setAttribute('data-ws2-ui', WS2_OVERLAY); pop.className = 'ws-fmtbar-swatches'; pop.style.display = 'none';
      (hilite ? HILITE_COLORS : TEXT_COLORS).forEach((c) => {
        const sw = doc.createElement('button'); sw.setAttribute('data-ws2-ui', WS2_OVERLAY); sw.className = 'ws-fmtbar-swatch'; sw.style.background = c;
        sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (hilite) wrapMark(c); else applyColor('color', c); pop.style.display = 'none'; });
        pop.appendChild(sw);
      });
      holder.appendChild(btn); holder.appendChild(pop);
      return holder;
    }
    function togglePop(pop) {
      const open = pop.style.display !== 'none';
      fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; });
      pop.style.display = open ? 'none' : 'flex';
    }
    // 当前编辑/选中块对应的「转为」菜单项 key——打开菜单时高亮它（Wendi 2026-07-22：看不出当前是几级标题）。
    // 直接看 tagName（classify 把 H1–H4 都归 'heading'、分不出级），列表按 ws-todo class 区分待办。
    function turnMenuActiveKey() {
      const el = editingEl || selectedEl; if (!el) return null;
      const t = el.tagName;
      if (t === 'P') return 'text';
      if (t === 'H1' || t === 'H2' || t === 'H3' || t === 'H4') return t.toLowerCase();
      if (t === 'BLOCKQUOTE') return 'quote';
      if (t === 'OL') return 'numbered';
      if (t === 'UL') return (el.classList && el.classList.contains('ws-todo')) ? 'todo' : 'list';
      if (t === 'DETAILS') return 'toggle';
      return null;
    }
    function markTurnMenuActive(menu) {
      const cur = turnMenuActiveKey();
      menu.querySelectorAll('.ws-fmtbar-menu-item').forEach((it) => it.classList.toggle('ws-fmtbar-menu-item--on', it.dataset.key === cur));
    }
    function openTurnMenu() {
      let menu = fmtbar.querySelector('.ws-fmtbar-menu');
      if (!menu) {
        menu = doc.createElement('div'); menu.setAttribute('data-ws2-ui', WS2_OVERLAY); menu.className = 'ws-fmtbar-menu';
        menu.style.display = 'none'; // 必须先 none，否则 togglePopMenu 把默认 display='' 误判成「已开」→ 首次点反而隐藏
        // 标题给全 H1–H4（此前漏了 H4，与斜杠菜单不一致——Wendi 2026-07-22「我只有 123，它没有 4」）。
        [['text', 'blockText'], ['h1', 'blockH1'], ['h2', 'blockH2'], ['h3', 'blockH3'], ['h4', 'blockH4'], ['quote', 'blockQuote'], ['list', 'blockBulletList'], ['numbered', 'blockNumberedList'], ['todo', 'blockTodoList'], ['toggle', 'blockToggle']].forEach(([key, labelKey]) => {
          const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', WS2_OVERLAY); it.className = 'ws-fmtbar-menu-item'; it.dataset.key = key; it.textContent = T('editor.' + labelKey);
          it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          it.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const item = SLASH_ITEMS.find((x) => x.key === key);
            const target = editingEl || selectedEl;
            if (target && item) {
              // Step 2：列表 + 选区只覆盖部分行 → 只抽那几行（turnIntoLines）；整列表选中或非列表 → 整块 turnInto。
              let nx;
              if (target.tagName === 'UL' || target.tagName === 'OL') {
                const lines = selectedListLines(target);
                const allCount = [...target.children].filter((c) => c.tagName === 'LI').length;
                nx = (lines && lines.length && lines.length < allCount) ? turnIntoLines(target, lines, item) : turnInto(target, item);
              } else { nx = turnInto(target, item); }
              menu.style.display = 'none';
              if (nx && nx.tagName === 'DETAILS') { const s = nx.querySelector('summary'); enterEdit(s || nx, { mode: 'end' }); } else if (editingEl) enterEdit(nx, { mode: 'end' }); else selectBlock(nx);
            }
          });
          menu.appendChild(it);
        });
        fmtbar.appendChild(menu);
      }
      markTurnMenuActive(menu); // 菜单缓存复用，每次打开都按当前块刷新高亮（不能只在建时标一次）
      togglePopMenu(menu);
    }
    function togglePopMenu(menu) { const open = menu.style.display !== 'none'; fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; }); menu.style.display = open ? 'none' : 'block'; }

    // ---- 块操作菜单 ----
    // 块菜单条目图标（#84 对齐 ui-demo BlockActionMenu：lucide 15px stroke1.8）
    const MENU_ICON = {
      text: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
      heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
      quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
      plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    };
    const menuIcon = (k) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + MENU_ICON[k] + '</svg>';
    // 菜单作用对象标记（对拍 T6）：「删除本行/本列」实际作用于 menuCell 所在的行/列，而开菜单时
    // selectBlock 把灰选打在**整张表**上、目标行列零标记 —— 画的对象和做的对象不是同一个，误删风险。
    // 这两个属性是纯交互态：serialize 的剥除白名单已收编（同一份白名单也被 undo 快照复用，
    // 见 undo.js「与存盘同一白名单」——所以 undo/redo 也不会把它们复活）。
    function clearMenuScope() {
      if (!doc) return;
      doc.querySelectorAll('[data-ws2-menurow],[data-ws2-menucol],[data-ws2-menucell]').forEach((n) => {
        n.removeAttribute('data-ws2-menurow'); n.removeAttribute('data-ws2-menucol'); n.removeAttribute('data-ws2-menucell');
      });
    }
    function markMenuScope(table, cell) {
      clearMenuScope();
      if (!table || !cell) return;
      const tr = cell.parentElement;
      if (tr && tr.tagName === 'TR') tr.setAttribute('data-ws2-menurow', '');
      // 交点格（= menuCell）单独标：菜单里的**对齐三态只作用于这一个格**，而行/列底色铺满整行整列——
      // 不标出交点，对齐按钮就成了反向的「画的≠做的」（对抗审查抓出）。
      // ⚠ 同时更正一处错注释：行与列两条规则给的是同一个 background 属性、同一色值，同元素上**不会叠深**，
      // 「交点自然更深」是想当然，必须显式给它一条自己的规则。
      cell.setAttribute('data-ws2-menucell', '');
      const pos = cellPosOf(table, cell);
      if (!pos) return;
      // 列 = 各数据行的同列索引格（行列增删走的也是这个口径，两处必须同源，否则标错格比不标更坏）
      tableRowsOf(table).forEach((r) => {
        const c = rowCellsOf(r)[pos.col];
        if (c) c.setAttribute('data-ws2-menucol', '');
      });
    }
    // U3 行级作用域菜单（plan 2026-08-03-002）：删掉一行 —— 掏空的列表按位置收敛
    //（嵌套子列表移除、宿主行保留；顶层列表 de-list 成空段落进编辑，顺带满足 toggle 体「≥1 块」铁则）。
    function removeRow(row) {
      if (!row || !row.isConnected || !row.parentElement) { deselect(); return; } // P2-4：行已被别的路径删掉（如 ⌘A 全删）→ 收摊，别抛
      const list = row.parentElement;
      const hostLi = list && list.parentElement && list.parentElement.tagName === 'LI' ? list.parentElement : null;
      row.remove();
      if (!list.querySelector('li')) {
        if (hostLi) {
          const top = blockOf(hostLi) || hostLi.closest('ul,ol');
          list.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty(); deselect();
          if (top) enterEdit(top, { mode: 'start' }); // P3-6：只放 Range 不进编辑 → 文档零 contenteditable、后续键入全丢
          caretAtLiTextEnd(hostLi);
          return;
        }
        const p = doc.createElement('p'); p.appendChild(doc.createElement('br'));
        list.replaceWith(p);
        if (undoMgr) undoMgr.checkpoint(); markDirty(); deselect();
        enterEdit(p, { mode: 'start' });
        return;
      }
      if (undoMgr) undoMgr.checkpoint(); markDirty(); deselect();
    }
    // el = 作用块；row = 行作用域目标 <li>（行锚手柄开菜单时给，Esc 灰选入口不给 = 块作用域）
    function openBlockMenu(el, row) {
      // 表格行列操作的「当前格」快照：必须在 selectBlock（会 exitCell）之前取——菜单项点击时 cellEl 早已清空
      const menuCell = (cellEl && el.contains && el.contains(cellEl)) ? cellEl : null;
      const rowMode = !!(row && row.tagName === 'LI' && classify(el) === 'list' && el.contains(row));
      if (rowMode) {
        // 作用域诚实可见：高亮那一行、不圈整张列表。**不设 selectedEl**——它是「块灰选」状态，
        // 塞个 <li> 进去会让 Delete 键 / removeBlock 的 topBlocks 计数按块语义误伤（li 不是顶层块）。
        exitCell(); exitEdit(); clearSelectedAttr(); selectedEl = null;
        menuRow = row; row.setAttribute('data-ws2-selected', '');
        positionFmtbar();
      } else selectBlock(el);
      // 作用行/列标记（对拍 T6）：rowMode 只在 list 上成立、menuCell 只在 table 上成立，两者互斥。
      if (menuCell && classify(el) === 'table') markMenuScope(el, menuCell); else clearMenuScope();
      // 第三条通向「整表灰选」的路径（另两条是 ⌘A 二档与 Esc）：从格内点 ⋮⋮ 开菜单，selectBlock 已
      // exitCell，格内那段原生蓝底同样要清——否则同一个可见状态下 ⌘C 的产出随进入路径而不同（对抗审查实测）。
      if (menuCell) clearStaleCellSelection();
      blockMenu.innerHTML = '';
      // 菜单头标注作用对象的块类型（对拍：Notion 菜单头写 "To-do list"/"Numbered list"，我们此前没有，
      // 用户看不出这菜单管的是哪种块）。复用既有块类型词条，零新增 i18n key。
      const headKey = (() => {
        if (rowMode) { const pl = row.parentElement; return pl.tagName === 'OL' ? 'blockNumberedList' : (pl.classList.contains('ws-todo') ? 'blockTodoList' : 'blockBulletList'); }
        const c = classify(el);
        if (c === 'toggle') return 'blockToggle';
        if (c === 'table') return 'blockTable';
        if (c === 'quote') return 'blockQuote';
        if (c === 'image') return 'blockImage';
        if (c === 'divider') return 'blockDivider';
        if (c === 'heading') return 'blockH' + (el.tagName[1] || '1');
        if (c === 'list') return el.tagName === 'OL' ? 'blockNumberedList' : (el.classList.contains('ws-todo') ? 'blockTodoList' : 'blockBulletList');
        if (el.classList && el.classList.contains('ws-callout')) return 'blockCallout';
        return c === 'text' ? 'blockText' : null;
      })();
      if (headKey) {
        const head = doc.createElement('div');
        head.setAttribute('data-ws2-ui', WS2_OVERLAY);
        head.className = 'ws-blockmenu-head';
        head.textContent = T('editor.' + headKey);
        blockMenu.appendChild(head);
      }
      const add = (label, on, danger, icon) => {
        const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', WS2_OVERLAY); it.className = 'ws-blockmenu-item' + (danger ? ' ws-blockmenu-danger' : '');
        it.innerHTML = (icon ? menuIcon(icon) : '') + '<span></span>';
        it.lastElementChild.textContent = label; // label 走 textContent（不进 innerHTML 拼接）
        it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        it.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
        blockMenu.appendChild(it); return it;
      };
      // 「转为」：行模式抽出该行转（复用 #346 的 turnIntoLines，前后剩余项仍是原列表）；块模式整块转。
      const sub = (label, item, icon) => add(label, () => {
        const nx = rowMode ? turnIntoLines(el, [row], item) : turnInto(el, item);
        closeBlockMenu(); if (nx) selectBlock(nx); // turnIntoLines 对非直接子项返回 null（P1-2），此时零变更
      }, false, icon);
      // 修 ED-B1：「转为」只对文字承载块给（table/img/hr 等结构块转正文会把表格文字黏成团 / 图片直接消失、
      // 属性搬到 h2 上）。非可编辑块只留插入/复制/删除。
      // 嵌套行不给「转为」组（P1-2）：嵌套 li 不是顶层列表的直接子项，抽不出去；产物也无法存在于嵌套层
      // （Schema 的 li 只装行内内容或子列表，同「+」那条结构性分歧）。删除/插入/复制/上色对嵌套行都是对的，照给。
      const rowNested = rowMode && row.parentElement !== el;
      if (isEditableEl(el) && !rowNested) {
        sub(T('editor.turnToText'), itemByKey('text'), 'text'); sub(T('editor.turnToHeading'), itemByKey('h2'), 'heading'); sub(T('editor.turnToQuote'), itemByKey('quote'), 'quote');
        const sep = doc.createElement('div'); sep.setAttribute('data-ws2-ui', WS2_OVERLAY); sep.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep);
      } else if (classify(el) === 'toggle') {
        // 选中的 toggle → 转文本/标题（U9：toggle→text，summary 内容成段、正文块提到其后，零丢失）
        sub(T('editor.turnToText'), itemByKey('text'), 'text'); sub(T('editor.turnToHeading'), itemByKey('h2'), 'heading');
        const sep = doc.createElement('div'); sep.setAttribute('data-ws2-ui', WS2_OVERLAY); sep.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep);
      } else if (classify(el) === 'table' && menuCell) {
        // 表格（U5/U6）：行/列增删 + cell 对齐。「当前行/列」= 打开菜单那一刻正在编辑的格（menuCell 快照）。
        const tOp = (labelKey, op, danger) => add(T('editor.' + labelKey), () => {
          closeBlockMenu();
          if (undoMgr) undoMgr.checkpoint(); // KTD6 前置：先结算 500ms 防抖窗口内的打字债
          const res = tableEditOp(doc, el, menuCell, op);
          if (res && res.deletedTable) { removeBlock(el); return; } // 退化态升级删整表（removeBlock 自带尾检查点+锚点收敛）
          if (!res) return;
          if (undoMgr) undoMgr.checkpoint();
          markDirty();
          enterCell(res, { mode: 'start' }); // 焦点显式还给落点格（悬空焦点 = macOS IME 唤不起）
        }, !!danger, danger ? 'trash' : 'plus');
        tOp('tableRowAbove', 'row-above'); tOp('tableRowBelow', 'row-below');
        tOp('tableColLeft', 'col-left'); tOp('tableColRight', 'col-right');
        tOp('tableDelRow', 'row-del', true); tOp('tableDelCol', 'col-del', true);
        const sepT = doc.createElement('div'); sepT.setAttribute('data-ws2-ui', WS2_OVERLAY); sepT.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sepT);
        // 对齐三态（U6）：per-cell ws-al-*（文法即 cell 级）；左 = 清 class（默认态零字节）
        const aligns = doc.createElement('div'); aligns.setAttribute('data-ws2-ui', WS2_OVERLAY); aligns.className = 'ws-blockmenu-aligns';
        [['alignLeft', null], ['alignCenter', 'ws-al-center'], ['alignRight', 'ws-al-right']].forEach(([k, cls]) => {
          const b = doc.createElement('button'); b.setAttribute('data-ws2-ui', WS2_OVERLAY); b.className = 'ws-blockmenu-alignbtn';
          b.textContent = T('editor.' + k);
          if ((cls && menuCell.classList.contains(cls)) || (!cls && !menuCell.classList.contains('ws-al-center') && !menuCell.classList.contains('ws-al-right'))) b.classList.add('ws-blockmenu-alignbtn--on');
          b.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
          b.addEventListener('click', (ev) => {
            ev.preventDefault(); ev.stopPropagation(); closeBlockMenu();
            if (undoMgr) undoMgr.checkpoint(); // KTD6 前置
            menuCell.classList.remove('ws-al-center'); menuCell.classList.remove('ws-al-right');
            if (cls) { menuCell.classList.add(cls); ensureAlignStyle(); }
            if (!menuCell.getAttribute('class')) menuCell.removeAttribute('class'); // 空 class 剥掉，存盘干净
            if (undoMgr) undoMgr.checkpoint();
            markDirty();
            enterCell(menuCell, { mode: 'end' });
          });
          aligns.appendChild(b);
        });
        blockMenu.appendChild(aligns);
        const sepT2 = doc.createElement('div'); sepT2.setAttribute('data-ws2-ui', WS2_OVERLAY); sepT2.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sepT2);
      }
      // 图片块（无说明）：加说明 → figure/figcaption + 进说明编辑（doc-images U5）
      if (classify(el) === 'image' && !(el.querySelector && el.querySelector('figcaption'))) {
        add(T('editor.addCaption'), () => { closeBlockMenu(); addCaption(el); }, false, 'text');
      }
      // 插入 / 复制 / 删除：行模式作用于该行（新行插同列表、复制行、删行），块模式维持既有整块语义。
      add(T('editor.insertBelow'), () => {
        if (rowMode) {
          const li = doc.createElement('li'); li.appendChild(doc.createElement('br')); row.after(li);
          if (undoMgr) undoMgr.checkpoint(); markDirty(); closeBlockMenu();
          enterEdit(el, { mode: 'start' }); caretAtLiTextEnd(li);
          return;
        }
        const nx = insertAfter(el, itemByKey('text')); closeBlockMenu(); enterEdit(nx, { mode: 'start' });
      }, false, 'plus');
      add(T('editor.duplicate'), () => {
        closeBlockMenu(); // P3-5：先关菜单清掉行高亮，否则 cloneNode 把 data-ws2-selected 一起拷进副本
        const c = fmt.duplicateBlock(rowMode ? row : el); // 对 <li> 同样适用（克隆后剥 id，防锚点重复）
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        if (c && !rowMode) selectBlock(c);
      }, false, 'copy');
      add(T('common.delete'), () => { closeBlockMenu(); if (rowMode) removeRow(row); else removeBlock(el); }, true, 'trash');
      // 颜色行（#85：前面补分隔线，对齐 ui-demo 删除与色板之间的 sep）。只给文字承载块——
      // 原子块（图片/分隔线）上色无意义（上色本就 gated 在 isEditableEl，露空色板是误导，对齐 ui-demo）。
      if (isEditableEl(el)) {
        const sep2 = doc.createElement('div'); sep2.setAttribute('data-ws2-ui', WS2_OVERLAY); sep2.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep2);
        const colors = doc.createElement('div'); colors.setAttribute('data-ws2-ui', WS2_OVERLAY); colors.className = 'ws-blockmenu-colors';
        TEXT_COLORS.forEach((c) => { const sw = doc.createElement('button'); sw.setAttribute('data-ws2-ui', WS2_OVERLAY); sw.className = 'ws-blockmenu-swatch'; sw.style.background = c;
          sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          // A2/§0决策1：块级上色用 ws-color class（不写 el.style——块 style 被校验器判非法）。默认色=清 class。
          sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const tgt = rowMode ? row : el; TEXT_COLORS.forEach((c2) => tgt.classList.remove('ws-color-' + c2.slice(1))); if (c !== TEXT_COLORS[0]) { tgt.classList.add('ws-color-' + c.slice(1)); ensureColorStyle(); } if (!tgt.getAttribute('class')) tgt.removeAttribute('class'); if (undoMgr) undoMgr.checkpoint(); markDirty(); closeBlockMenu(); });
          colors.appendChild(sw); });
        blockMenu.appendChild(colors);
      }
      const r = grip.getBoundingClientRect(); const { sx, sy } = vp();
      blockMenu.style.left = (r.left + sx) + 'px';
      blockMenu.style.top = (r.bottom + sy + 4) + 'px';
      blockMenu.style.display = 'block';
    }
    // 单一关闭出口——所有调用点全走它，两种作用域标记都在这里统一清
    function closeBlockMenu() {
      blockMenu.style.display = 'none';
      clearMenuScope(); // T6：表格作用行/列/交点格标记
      if (menuRow) { menuRow.removeAttribute('data-ws2-selected'); menuRow = null; } // U3：行作用域高亮随菜单退场
    }

    // ---- 斜杠菜单 ----
    // typed=true：用户真打了字面「/」（确认时要把「/query」删掉）。
    // typed=false：从 gutter「+」唤起（E5）——块里**没有**那个「/」，删了就会啃掉上一块的内容。
    function openSlash(blockEl, typed) {
      slash = { blockEl, query: '', active: 0, typed: typed !== false };
      // 占位改成「输入以筛选…」（Notion 同款）。⚠ 标记挂在**文档根**上、绝不挂到块上——
      // 挂块上等于在正文里做了一次 DOM 变更，undo 管理器会把它记成独立一步，
      // 于是「插入 + 弹选择器」要按两次撤销才回得去（既有门 list-row-plus「undo 一步还原」当场翻红）。
      if (!slash.typed) doc.documentElement.setAttribute('data-ws2-picking', '');
      renderSlash();
    }
    function closeSlash() {
      // 属性没设就别写 DOM——`/` 那条路根本不设它，白写一次徒增变更（且这里曾因批量替换把函数体
      // 换成了对自身的递归调用，所有斜杠路径静默全挂：菜单能弹、选完毫无反应）
      if (doc.documentElement.hasAttribute('data-ws2-picking')) doc.documentElement.removeAttribute('data-ws2-picking');
      slash = null;
      slashMenu.style.display = 'none';
    }
    function renderSlash() {
      if (!slash) { slashMenu.style.display = 'none'; return; }
      const items = filterSlash(slash.query);
      slashMenu.innerHTML = '';
      if (!items.length) { const e = doc.createElement('div'); e.setAttribute('data-ws2-ui', WS2_OVERLAY); e.className = 'ws-slashmenu-empty'; e.textContent = T('editor.noMatch'); slashMenu.appendChild(e); }
      items.forEach((it, i) => {
        const b = doc.createElement('button'); b.setAttribute('data-ws2-ui', WS2_OVERLAY); b.className = 'ws-slashmenu-item' + (i === slash.active ? ' active' : ''); b.textContent = slashLabel(it);
        b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); applySlash(it.key); });
        slashMenu.appendChild(b);
      });
      const sel = doc.getSelection();
      let rect = null;
      if (sel && sel.rangeCount) { const rr = sel.getRangeAt(0).getClientRects(); rect = rr.length ? rr[0] : (sel.getRangeAt(0).startContainer.parentElement && sel.getRangeAt(0).startContainer.parentElement.getBoundingClientRect()); }
      if (rect) { const { sx, sy } = vp(); slashMenu.style.left = (rect.left + sx) + 'px'; slashMenu.style.top = (rect.bottom + sy + 6) + 'px'; }
      slashMenu.style.display = 'block';
    }
    function applySlash(key) {
      const cur = slash; closeSlash();
      if (!cur) return;
      const it = SLASH_ITEMS.find((x) => x.key === key);
      if (!it) return;
      // 删掉已输入的「/query」
      const sel = doc.getSelection();
      // 删掉筛选时打进块里的字。从「+」唤起时**只删 query**、不删那多出来的一个字符——块里根本没有
      // 字面「/」，删它就是删自己没插入的东西。
      // ⚠ 老实说一句：**这条今天是防御性的、没有门能咬住它**。变异自检实测把 `typed` 判断去掉（恒 +1）
      //   七条门全绿——因为我们每个块是独立 contenteditable，`selection.modify` 跨不出块边界，
      //   多删的那一下打在空气上。真正的价值在于：哪天块模型改成单一 contenteditable，这个 +1 就是
      //   一条会啃掉上一块内容的丢数据 bug。别因为「测不出来」就把它删掉。
      // 反过来 `+ 0` 也不对：从「+」进来时打的筛选字同样落在块里，不删就残留成正文（E5-3 实测，能翻红）。
      const back = cur.query.length + (cur.typed ? 1 : 0);
      if (back && sel && sel.rangeCount) { for (let i = 0; i < back; i++) sel.modify('extend', 'backward', 'character'); doc.execCommand('delete'); }
      if (it.ai) { onAiSoon(); return; }
      const el = cur.blockEl;
      const empty = !el || (el.textContent || '').trim() === '';
      // 容器块（callout）即使为空也不许被「空块原地替换」吞掉（对拍 C13）：用户在框内敲 / 选一个**插入**项，
      // 产物却是承载它的容器被换掉——画的（框内插入）和做的（整框替换）不是同一个对象；且没有任何反向
      // 入口能把产物变回 callout，只能靠 undo。改成插到框后：Schema 明令禁止 callout 里放列表/表格
      // （childrenAreMultiPara 只允许 phrasing 或 <p>），所以「插进框内」这个 Notion 式终态我们做不了，
      // 「插到框后」是约束下的非破坏解。
      // ⚠ 不能用 isLeafTextBlock 当守卫：LEAF_TEXT_TAGS 含 DIV、空 callout 无块级后代 → 判 true，拦不住。
      // ⚠ 必须共用一个判据：下面有**四个**替换站点、三种机制（图片 remove / details turnInto /
      //   table replaceWith / generic turnInto），各写各的必漏一处；其中图片那条最狠——insertImages 会把
      //   锚块整个 remove 掉，callout 连壳都不剩。（hr 那条是无条件 insertAfter，本就不吃这个判据。）
      const canReplace = empty && isEditableEl(el) && !(el && el.classList && el.classList.contains('ws-callout'));
      // 图片：异步取文件后插入。空块原地替换（已拍板②）。不在此 checkpoint——picker 可取消。
      if (it.image) { pickAndInsertImage(el, canReplace); return; }
      // 折叠块：空块原地变身（turnInto，与其他块类型一致——旧 insertAfter 会把空段落留在原地、details 落到
      // 下一行，光标肉眼可见往下坠一行 + 留空段落垃圾，Wendi 2026-07-24 视频）；非空块维持插到下方。光标落 summary。
      if (it.tag === 'details') { const nx = canReplace ? turnInto(el, it) : insertAfter(el, it); const s = nx.querySelector('summary'); enterEdit(s || nx, { mode: 'start' }); }
      else if (it.tag === 'table') {
        // 表格（U1）：空锚块原地替换（对齐 details「不留空段垃圾」的心智；不走 turnInto——retag p→table 会产非法结构），
        // 非空插下方。U1 阶段落灰选整表（cell 尚不可编辑）；U2 起改「落首格进编辑」。
        let nx;
        if (canReplace) { nx = newBlock(it); el.replaceWith(nx); if (undoMgr) undoMgr.checkpoint(); markDirty(); }
        else nx = insertAfter(el, it);
        const fc = firstCellOf(nx);
        if (fc) enterCell(fc, { mode: 'start' }); else { selectBlock(nx); positionGrip(nx); } // R3：造出即编辑、光标落首格
      }
      else if (it.tag === 'hr') { const nx = insertAfter(el, it); selectBlock(nx); }
      else if (canReplace) { const nx = turnInto(el, it); enterEdit(nx, { mode: 'start' }); }
      else { const nx = insertAfter(el, it); enterEdit(nx, { mode: 'start' }); }
    }

    // ---- U3 文档互链「创建面」：提及菜单接线（菜单浮层在父层 WS2Mention，这里只做触发 + caret rect + 文档上下文）----
    function mentionApi() { return (typeof global !== 'undefined' && global.WS2Mention) || null; }
    function docCtx() { return (typeof global !== 'undefined' && global.__wsDocContext) ? global.__wsDocContext() : null; }
    // caret 之前 el 内的最后 n 个字符（识别 @ / [[ 触发）
    function textBeforeCaret(el, n) {
      const sel = doc.getSelection();
      if (!sel || !sel.rangeCount) return '';
      const caret = sel.getRangeAt(0);
      if (!el.contains(caret.startContainer)) return '';
      const scan = doc.createRange();
      scan.selectNodeContents(el);
      try { scan.setEnd(caret.startContainer, caret.startOffset); } catch (e) { return ''; }
      return scan.toString().slice(-n);
    }
    function caretRectInFrame(fallbackBlock) {
      const sel = doc.getSelection();
      let r = null;
      if (sel && sel.rangeCount) {
        const r0 = sel.getRangeAt(0);
        const rr = r0.getClientRects();
        r = rr.length ? rr[0] : (r0.startContainer && r0.startContainer.parentElement && r0.startContainer.parentElement.getBoundingClientRect());
        if (r && r.width === 0 && r.height === 0) r = null; // 折叠选区可能给零矩形（execCommand delete 后）
      }
      // 兜底：拿不到 caret 矩形（删完 /query 后折叠选区无矩形）→ 用作用块矩形，菜单落块下方
      if (!r && fallbackBlock) { const br = fallbackBlock.getBoundingClientRect(); r = { bottom: br.bottom, top: br.top, left: br.left, width: 1, height: br.height }; }
      if (!r) return null;
      return { top: r.bottom + 6, left: r.left, above: r.top }; // iframe 内坐标；父层加 frame offset
    }
    // 打开提及菜单：blockEl=作用块，trig（0=斜杠/气泡入口，1=@，2=[[），mode insert|wrap，savedRange（wrap 用）
    // caret 在 blockEl 内的字符偏移（块起点→caret 的文本长度）。给提及菜单钉死 query 锚点。
    function caretOffset(el) {
      const sel = doc.getSelection();
      if (!sel || !sel.rangeCount) return 0;
      const caret = sel.getRangeAt(0);
      if (!el.contains(caret.startContainer)) return 0;
      const r = doc.createRange(); r.selectNodeContents(el);
      try { r.setEnd(caret.startContainer, caret.startOffset); } catch (e) { return 0; }
      return r.toString().length;
    }
    function openMention(blockEl, trig, mode, savedRange, anchorRect) {
      const M = mentionApi(); if (!M) return;
      const rect = anchorRect || caretRectInFrame(blockEl); if (!rect) return; // wrap 传按钮锚点；否则抓 caret rect（await 后可能变）
      const trigLen = trig || 0; // @=1、[[=2、斜杠/气泡=0
      const anchorOff = Math.max(0, caretOffset(blockEl) - trigLen); // 提及区起点：insert 时 = 触发符起点；trig=0 = 当前 caret
      const doOpen = (ctx) => {
        if (!ctx || ctx.rootId == null) { if (global.__wsToast) global.__wsToast(T('editor.mentionUnsupportedTempDoc')); return; }
        M.open({
          frame: win.frameElement, doc, win, blockEl,
          caretRect: rect, rootId: ctx.rootId, fromRel: ctx.rel,
          mode: mode || 'insert', trig: trig || 0, trigLen, anchorOff, savedRange: savedRange || null,
          onDone: (res) => {
            markDirty(); if (undoMgr) undoMgr.checkpoint();
            // @新建：链接已插进当前文档 → 跳去编辑新文档（先存当前文档，shell 里做）。
            if (res && res.createdAbs && global.__wsOpenCreatedDoc) global.__wsOpenCreatedDoc(res.createdAbs);
          },
        });
      };
      const ctx = docCtx();
      if (ctx && ctx.rootId != null) { doOpen(ctx); return; }
      // docContext 还没算好（刚打开文档就 @）：等一次异步就绪再开，别误报「工作区外」（审查 D）
      const ready = (typeof global !== 'undefined' && global.__wsDocContextReady) ? global.__wsDocContextReady() : Promise.resolve(null);
      Promise.resolve(ready).then(() => doOpen(docCtx()));
    }
    // @ / [[ / 【【 触发（走 input/compositionend，不靠 keydown 的 e.key——Windows 中文 IME 只给 'Process'）。
    function maybeMentionTrigger() {
      const M = mentionApi();
      if (!M || M.isOpen() || slash || !editingEl) return;
      const two = textBeforeCaret(editingEl, 2);
      const one = two.slice(-1);
      let trig = 0;
      if (two === '[[' || two === '【【') trig = 2; // i18n-exempt（触发符匹配用户输入，含全角 IME 变体，须字面不翻）
      else if (one === '@' || one === '＠') trig = 1; // i18n-exempt（同上，触发符字面）
      if (!trig) return;
      openMention(editingEl, trig, 'insert', null);
    }

    // ---- 监听器（父层挂到 iframe doc）----
    // 待办勾选框 gutter 命中判定（mousedown 与 click 两处共用，避免判据漂移，U5）：命中返回该行 li，否则 null。
    // U24/check-4：几何收敛。勾选框 ::before 是 left:-22px width:16px（相对 li border-box 左缘）→ 框体 [li.left-22, li.left-6]。
    // ① X 带 = 框体 ±4px 缓冲 = [li.left-26, li.left-2]；右缘距文字左缘（li.left+4）留 6px 非勾选区，消「文字左缘零缓冲误触」。
    // ② Y 吸附最近直接子 li（±YTOL 容差），消项间 margin 死区；缝隙等距时吸附上方项（文档序更前）。
    function todoGutterHit(e) {
      const todoUl = e.target && e.target.closest ? e.target.closest('ul.ws-todo') : null;
      if (!todoUl) return null;
      const lis = [...todoUl.children].filter((x) => x.tagName === 'LI');
      if (!lis.length) return null;
      const YTOL = 6; // 覆盖项间 .3em(~5px) margin 的一半有余，消死区又不过界误勾大片空白
      let li = null, best = Infinity;
      for (const x of lis) {
        const r = x.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { li = x; break; } // 落在 li 内 → 就是它
        const d = Math.abs(e.clientY - (r.top + r.bottom) / 2);
        if (d < best) { best = d; li = x; } // 缝隙里取中心最近的；平局用 < 保留先到的=上方项
      }
      if (!li) return null;
      const r = li.getBoundingClientRect();
      if (e.clientY < r.top - YTOL || e.clientY > r.bottom + YTOL) return null; // 离最近 li 也太远 → 不算勾选
      return (e.clientX >= r.left - 26 && e.clientX <= r.left - 2) ? li : null;
    }

    // 鼠标按下：记起点，开始判断是「点击」还是「拖选」。点编辑器 UI（气泡/手柄/菜单）不算。
    function onMouseDown(e) {
      if (e.button !== 0) return; // 只管左键
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      // 点菜单外任何地方 → 关斜杠菜单（Wendi 2026-07-22：以前点别处不关、只能删掉「/」才关，反直觉）。
      // 上面已对 data-ws2-ui 覆盖层（含斜杠菜单及其项）early-return，故点菜单项走不到这、不会误关。
      if (slash) closeSlash();
      if (e.target && e.target.closest && e.target.closest('figcaption')) return; // 说明编辑：交原生放光标/选词，不启块拖选
      // 待办勾选：点 gutter（勾选框）→ 切 data-checked、不放光标（判定见 todoGutterHit，与 onClick 共用，U5）。
      const gLi = todoGutterHit(e);
      if (gLi) {
        e.preventDefault();
        if (undoMgr) undoMgr.checkpoint(); // U20/check-3：改 data-checked 前先冲掉 pending 打字（500ms 防抖窗口内的输入）成独立快照，否则勾选与打字并进同一快照、一次 undo 双双回滚
        // U26/visual-5：取消勾选删属性、不写 data-checked="false"（脏字节、diff 噪音、三态负担）。CSS/判定只认 "true"，
        // "false" 与无属性等价 → 存量老文档下次翻转时自然清洗。
        if (gLi.getAttribute('data-checked') === 'true') gLi.removeAttribute('data-checked'); else gLi.setAttribute('data-checked', 'true');
        if (undoMgr) undoMgr.checkpoint();
        markDirty();
        return;
      }
      dragStart = { x: e.clientX, y: e.clientY };
      wallDropped = false;
    }
    function onMouseMove(e) {
      // 拖选进行中：按住左键移动超过阈值 → 摘掉当前编辑块的 contenteditable（放倒墙），让选区自由跨块。
      // 纯点击（不移动）不摘墙，保留「点同一块原生移光标」「IME 组词」等。选区此刻已起、摘墙不打断它。
      if (dragStart && !wallDropped && (e.buttons & 1) &&
          (Math.abs(e.clientX - dragStart.x) > 4 || Math.abs(e.clientY - dragStart.y) > 4)) {
        wallDropped = true;
        if (editingEl) exitEdit();
        if (cellEl) exitCell(); // 起点在 cell 内的拖动同样摘墙（方案 B）——「从 cell 拖出做跨块选区」才活；mouseUp 同格再恢复
      }
      // 在手柄/菜单/气泡上移动：保持现状（手柄在块外 margin，移过去若隐藏就点不到了）
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      const el = blockOf(e.target);
      // U1 行级手柄：列表块内手柄逐行跟随（锚 hoverRow），其余块仍锚整块。
      // ⚠ A 阶段中间态（只在 feat/ux-granularity 隔离分支）：拖拽/菜单仍以 hoverEl（整块）为
      // 作用对象，B/C 单元逐步下沉到行——进 main 前必须整体完成。
      const row = (el && classify(el) === 'list') ? rowOf(e.target, el, e.clientY) : null;
      if (el && (el !== hoverEl || row !== hoverRow)) { hoverEl = el; hoverRow = row; positionGrip(row || el); } // 编辑态也更新（能对当前/别的块开菜单·拖拽）
      // 移到块外空白/gutter 间隙：不立即隐藏（停在最后悬停块、保证可点）；隐藏交给进编辑/离开文档。
    }
    // 鼠标抬起：收尾一次拖选。单块内选区 → 恢复进编辑（保留选区，可打字替换/气泡走编辑态分支）；
    // 跨块/homeless 选区 → 留着、弹气泡。纯点击（没摘墙）→ 交给 onClick 走进编辑。
    function onMouseUp() {
      if (!dragStart) return;
      const dropped = wallDropped;
      dragStart = null; wallDropped = false;
      if (!dropped) return;
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return; // 拖了但没选到东西
      const r = sel.getRangeAt(0);
      // 同 cell 拖选（U2 方案 B）：摘墙时已 exitCell，松手时选区局限在原格内 → 恢复该格编辑并保留选区
      // （镜像下面单块恢复、粒度下沉到 cell）——「cell 内选词替换」与「从 cell 拖出跨块选区」都活着。
      const sCell = cellOfNode(r.startContainer), eCell = cellOfNode(r.endContainer);
      if (sCell && sCell === eCell) {
        const cBlk = blockOf(sCell);
        if (cBlk && classify(cBlk) === 'table') {
          const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
          enterCell(sCell, { mode: 'keep' });
          try { const cr = doc.createRange(); cr.setStart(sc, so); cr.setEnd(ec, eo); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
          positionFmtbar();
          return;
        }
      }
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (sBlk && sBlk === eBlk && isEditableEl(sBlk)) {
        const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
        enterEdit(sBlk, { mode: 'keep' });
        try { const cr = doc.createRange(); cr.setStart(sc, so); cr.setEnd(ec, eo); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
      }
      positionFmtbar();
    }
    function onDocLeave() { if (!selectedEl && !editingEl) { hoverEl = null; hoverRow = null; setGutterVisible(false); } }
    // 折叠持久化（KD4/R8）：原生 toggle 事件 → markDirty 触发自动保存；绝不 checkpoint（折叠不是撤销步 KD5）。
    function onToggle(e) {
      if (!e.target || e.target.tagName !== 'DETAILS') return;
      if (e.target.__wsFindReveal) { e.target.__wsFindReveal = false; return; } // 查找揭示触发的展开：只读，不标 dirty、不落盘（P2）
      markDirty();
    }
    function onClick(e) {
      // 点到覆盖层（手柄/菜单/气泡）自身：交给它们各自的 handler，这里忽略
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      // 待办勾选框 gutter：mousedown 已切 data-checked，这下 click 只吞掉——绝不进编辑/放光标、绝不再 toggle（U5/check-1）。
      if (todoGutterHit(e)) { e.preventDefault(); return; }
      // 刚用鼠标拖选了文字（单块或跨块）→ 松手的这下 click 触发时选区仍非折叠 → 一律保留、什么都不做，
      // 否则会把选区折叠掉、气泡闪退（这是用户报的根因）。纯点击时 mousedown 已先把选区折叠成光标，不受影响。
      const _sel = doc.getSelection();
      if (_sel && !_sel.isCollapsed && _sel.rangeCount > 0) return;
      // 点图片说明（figcaption）→ 进说明编辑；不走块选中（否则 blockOf 上卷到 figure、选中整张图）。
      const capT = e.target && e.target.closest && e.target.closest('figcaption');
      if (capT && classify(capT.parentElement) === 'image') { if (captionEl !== capT) enterCaptionEdit(capT, false); return; }
      // toggle 标题（summary）：拦原生折叠；点 chevron 区（内容左缘 20px 内）折叠，点文字进 summary 编辑放光标。
      // 不走 blockOf（会上卷到 details 灰选中整块）。folding 由我们控（原生 toggle 事件仍会 → markDirty）。
      const sumT = e.target && e.target.closest && e.target.closest('summary');
      if (sumT && sumT.parentElement && sumT.parentElement.tagName === 'DETAILS') {
        e.preventDefault();
        const det = sumT.parentElement;
        const sr = sumT.getBoundingClientRect();
        // 折叠热区（对拍 T4：Notion 是块左缘 +8 起的 24×24 语义按钮；我们原来是左缘起 20px 的裸判定、
        // 且热区自身无悬停反馈）。这里把命中口径对齐成同尺寸方形区，视觉反馈由 CSS 的 summary::before 承担。
        if ((e.clientX - sr.left) < 24) { det.open = !det.open; if (editingEl !== sumT) { try { sumT.blur(); } catch (x) {} } return; } // chevron 区 → 折叠；非编辑态 blur summary（防折叠后按空格被原生激活重开，P3）
        if (editingEl !== sumT) enterEdit(sumT, { mode: 'point', x: e.clientX, y: e.clientY });
        return;
      }
      // 表格单元格（U2/KTD1）：点中 td/th → 进 cell 编辑。必须在 blockOf 上卷**之前**（上卷会吃成整表灰选）。
      // 门控由结构成立：无表文档 closest('td,th') 恒 null；blockOf+classify 复核该表是真块（不在覆盖层/块外）。点表格边框缝隙/margin
      // 落不进 td/th → 走下面 blockOf 的整表灰选（既有行为）。
      const cellT = e.target && e.target.closest && e.target.closest('td,th');
      if (cellT) {
        const cellBlk = blockOf(cellT);
        if (cellBlk && classify(cellBlk) === 'table') {
          if (cellEl === cellT) return; // 已编辑此格的纯点击 → 交原生移光标
          enterCell(cellT, { mode: 'point', x: e.clientX, y: e.clientY });
          return;
        }
      }
      const el = blockOf(e.target);
      if (!el) {
        // 文末续写：点最后一块下方、且在文档列水平范围内的空白 → 进末块(若空可编辑)或末尾新建正文块
        // （对齐 ui-demo ws-canvas-tail）。列左右侧边距的点击仍是取消选中。
        const blocks = topBlocks();
        // 空文档（无任何块）：点一下就建第一个正文块进编辑，避免「打开空 HTML 后点不进去」死状态
        if (blocks.length === 0) { const p = doc.createElement('p'); blockRoot.appendChild(p); if (undoMgr) undoMgr.checkpoint(); markDirty(); enterEdit(p, { mode: 'start' }); return; }
        const last = blocks[blocks.length - 1];
        const br = blockRoot.getBoundingClientRect();
        if (last && e.clientY > last.getBoundingClientRect().bottom && e.clientX >= br.left && e.clientX <= br.right) {
          if (isEditableEl(last) && (last.textContent || '').trim() === '') enterEdit(last, { mode: 'end' });
          else { const nx = insertAfter(last, itemByKey('text')); enterEdit(nx, { mode: 'start' }); }
          return;
        }
        deselect(); return;
      }
      closeBlockMenu();
      if (isEditableEl(el)) {
        if (editingEl === el) return; // 已编辑此块的纯点击 → 交原生移光标，别重置
        enterEdit(el, { mode: 'point', x: e.clientX, y: e.clientY });
      } else { selectBlock(el); positionGrip(el); }
    }
    function onKeyDown(e) {
      // 图片说明（figcaption）编辑中：Enter/Esc 收尾失焦，其它键交原生编辑文字——绝不落到块级
      // Enter 新建块 / Backspace 删块分支（ui-demo 踩过：说明里退格删了整张图）。
      if (captionEl) {
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); captionEl.blur(); }
        return;
      }
      // 表格 cell 编辑态（U2 骨架，U3 赋全键盘语义）：cellEl 分支整体前置——否则 generic Tab 吞噬/
      // 方向键 topBlocks 导航/Esc→selectBlock 都会误伤。生存不变式：cellEl 可能已被跨块整删（ED-A2）/
      // 拖拽/undo 变 detached → 静默退出走 generic，绝不操作死表。
      if (cellEl) {
        if (!cellEl.isConnected) { exitCell(); }
        else {
          if (e.isComposing || e.keyCode === 229) return; // IME 组词一律交原生（仓内铁律）
          const cTbl = cellTableOf(cellEl);
          // 选区跨出本格（程序化设置/罕见路径——拖选已在摘墙时 exitCell）：本分支绝不接管，退出 cell 态
          // 放行 generic 管线（deleteSelection 的 ED-A2 整删/打字覆盖），照 summary U26 同款处理。
          const selX = doc.getSelection();
          const crossOut = !!(cTbl && selX && selX.rangeCount && !selX.isCollapsed && (() => { const rr = selX.getRangeAt(0); return !cellEl.contains(rr.startContainer) || !cellEl.contains(rr.endContainer); })());
          if (!cTbl || crossOut) { exitCell(); }
          else {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); selectTableFromCell(cTbl); return; } // Esc 上卷=灰选整表；selectedEl 永不为 TD
            // ⌘A 三档（列表三档先例）：① 选本格内容 → ② 灰选整表（删除语义=整删，矩形安全）→ ③ 全篇（走非编辑态 generic）
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
              e.preventDefault();
              const sel = doc.getSelection();
              const norm = (s) => (s || '').replace(/\s+/g, '');
              const cellText = norm(cellEl.textContent);
              const allInCell = sel && cellText.length > 0 && norm(sel.toString()) === cellText;
              if (cellText.length > 0 && !allInCell && sel) { const r = doc.createRange(); r.selectNodeContents(cellEl); sel.removeAllRanges(); sel.addRange(r); return; }
              selectTableFromCell(cTbl); // 空格/已全选 → 第二档整表（统一出口，含清残留选中）；再按一次 = generic 全篇
              return;
            }
            // Enter：跳下一行同列；末行建新行（恒落 tbody 恒产 TD，KTD4）。绝不交原生（td 里 insertParagraph 塞 <div> = 非合规）。
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const t2 = cellNavTarget(cTbl, cellEl, 'enter');
              if (t2 && t2.cell) enterCell(t2.cell, { mode: 'end' });
              else if (t2 && t2.newRow) { const tr = appendTableRow(cTbl); const cs = rowCellsOf(tr); const tc = cs[Math.min(t2.col, cs.length - 1)]; if (tc) enterCell(tc, { mode: 'start' }); }
              return;
            } // Shift+Enter 落到分支末尾交原生 <br>（phrasing 合法，KTD4）
            // Tab / Shift+Tab：移格；末格 Tab 建行；首格 Shift+Tab 跳出到上一块。
            if (e.key === 'Tab') {
              e.preventDefault();
              const t2 = cellNavTarget(cTbl, cellEl, e.shiftKey ? 'prev' : 'next');
              if (t2 && t2.cell) enterCell(t2.cell, { mode: 'end' });
              else if (t2 && t2.newRow) { const tr = appendTableRow(cTbl); const c0 = rowCellsOf(tr)[0]; if (c0) enterCell(c0, { mode: 'start' }); }
              else if (t2 && t2.exit === 'up') exitToNeighbor(cTbl, 'up');
              return;
            }
            // ←→：格内交原生；格首/末边界跨格（严格边界判定，尾随空格不算格末——B 组教训）；表界跳出。
            if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const sel = doc.getSelection();
              if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
              if (e.key === 'ArrowRight') {
                if (!isCaretAtRealEnd(doc, cellEl)) return;
                e.preventDefault();
                const t2 = cellNavTarget(cTbl, cellEl, 'next');
                if (t2 && t2.cell) enterCell(t2.cell, { mode: 'start' });
                else exitToNeighbor(cTbl, 'down'); // 末格 → 跳出（建行只给 Tab/Enter，方向键是纯导航零写入）
              } else {
                if (!isCaretAtStart(doc, cellEl)) return;
                e.preventDefault();
                const t2 = cellNavTarget(cTbl, cellEl, 'prev');
                if (t2 && t2.cell) enterCell(t2.cell, { mode: 'end' });
                else exitToNeighbor(cTbl, 'up');
              }
              return;
            }
            // ↑↓：多行文字格首/末视觉行才跨（caret rect 判定，照 generic 跨块上下）；同列跨行；表界跳出。
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const sel = doc.getSelection();
              if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
              const er = cellEl.getBoundingClientRect();
              // 首/末视觉行判定必须扣掉 td/th 的 padding（baseline 7px 上下）——拿整个 border-box 比，
              // 单行格的 caret 会被误判「不在末行」直接哑掉。padding 在 enterCell 缓存（cellPad），不逐击读。
              const contentTop = er.top + cellPad.top;
              const contentBottom = er.bottom - cellPad.bottom;
              const box = sel.getRangeAt(0).getBoundingClientRect();
              const degenerate = box.height === 0 && box.top === 0;
              const caret = degenerate ? { top: contentTop, bottom: contentBottom } : box;
              const lh = (degenerate ? Math.min(er.height, 24) : box.height) || 20;
              if (e.key === 'ArrowDown') {
                if (caret.bottom < contentBottom - lh * 0.5) return; // 非末行 → 原生
                e.preventDefault();
                const t2 = cellNavTarget(cTbl, cellEl, 'down');
                if (t2 && t2.cell) enterCell(t2.cell, { mode: 'start' });
                else exitToNeighbor(cTbl, 'down');
              } else {
                if (caret.top > contentTop + lh * 0.5) return;
                e.preventDefault();
                const t2 = cellNavTarget(cTbl, cellEl, 'up');
                if (t2 && t2.cell) enterCell(t2.cell, { mode: 'end' });
                else exitToNeighbor(cTbl, 'up');
              }
              return;
            }
            // Backspace：格内删字/选区删交原生（CE root=TD 原生跨不出格 = 格首天然 no-op）。唯一结构例外
            // （Colin 拍板 2026-08-03）：整行为空 + 非唯一 tbody 数据行 + 光标在该行首格 → 删该行（Tab 误建行的
            // 对称逆操作，保矩形、恰一 undo 步、光标回上一行末格）。
            if (e.key === 'Backspace') {
              // O(1) 判据在前（首格 col0 + tbody），全表扫描只在真要删行时才做——这是逐击热路径
              const sel = doc.getSelection();
              const tr0 = cellEl.parentElement;
              if (sel && sel.rangeCount && sel.isCollapsed && !cellEl.previousElementSibling
                  && tr0 && tr0.parentElement && tr0.parentElement.tagName === 'TBODY'
                  && isCaretAtStart(doc, cellEl)) {
                const rowEmpty = rowCellsOf(tr0).every((c) => (c.textContent || '').trim() === '' && !c.querySelector('img'));
                if (rowEmpty && tableRowsOf(tr0.parentElement).length > 1) { // KTD7 同一过滤谓词（tableRowsOf 对 tbody 同样适用）
                  e.preventDefault();
                  const rows = tableRowsOf(cTbl);
                  const prevRow = rows[rows.indexOf(tr0) - 1] || null;
                  if (undoMgr) undoMgr.checkpoint(); // KTD6：先结算 pending 打字债
                  exitCell();
                  tr0.remove();
                  if (undoMgr) undoMgr.checkpoint();
                  markDirty();
                  if (prevRow) { const pc = rowCellsOf(prevRow); const tc = pc[pc.length - 1]; if (tc) { enterCell(tc, { mode: 'end' }); return; } }
                  const fc2 = firstCellOf(cTbl); if (fc2) enterCell(fc2, { mode: 'start' });
                  return;
                }
              }
              return; // 交原生（格内删字；格首 no-op）
            }
            // 其余键交原生：TD contenteditable 内的文字输入/Delete 格内删字/Shift+Enter 软换行
          }
        }
      }
      // 提及菜单开着时：导航键（↑↓Enter/Esc/Backspace/query 字符）先给它，消费了就不再走块编辑（IME 组字键它会放行）
      { const M = mentionApi(); if (M && M.isOpen() && M.handleKey(e)) return; }
      // 斜杠菜单开启时：导航
      if (slash) {
        if (e.isComposing || e.keyCode === 229) return; // IME 组词中：交原生（compositionstart 已关菜单兜底），别把组词键当 query
        if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
        if (e.key === 'Enter') { e.preventDefault(); const items = filterSlash(slash.query); const it = items[slash.active]; if (it) applySlash(it.key); else { closeSlash(); } return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); const n = filterSlash(slash.query).length; slash.active = Math.min(slash.active + 1, n - 1); renderSlash(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); slash.active = Math.max(0, slash.active - 1); renderSlash(); return; }
        if (e.key === 'Backspace') { if (slash.query.length === 0) { closeSlash(); } else { slash.query = slash.query.slice(0, -1); slash.active = 0; renderSlash(); } return; }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { slash.query += e.key; slash.active = 0; renderSlash(); return; }
        // 光标移动键（←→/Home/End/PageUp-Down）或其它键 → 关菜单、交原生：caret 移走后再 applySlash 会从错位删字
        closeSlash();
        return;
      }
      // toggle 标题（summary）编辑：拦原生折叠激活 + 定义边界。summary 放不了块——不触发 slash、不走 generic 块键盘。
      if (editingEl && editingEl.tagName === 'SUMMARY') {
        if (e.isComposing || e.keyCode === 229) return; // IME 组字交原生
        // U26：summary 编辑态下选区跨出 summary（拖进正文/外层）的删除/剪切/打字覆盖——绝不交原生
        //（原生对跨 contenteditable 边界的选区会半删 summary、正文纹丝不动 = 半应用），走 deleteSelection
        // 新契约（同 toggle 内裁剪/全覆盖整删/跨界上卷整删），与非编辑态拖选的 generic 路由行为一致。
        {
          const sel0 = doc.getSelection();
          if (sel0 && sel0.rangeCount && !sel0.isCollapsed) {
            const rr = sel0.getRangeAt(0);
            if (!editingEl.contains(rr.startContainer) || !editingEl.contains(rr.endContainer)) {
              if (e.key === 'Backspace' || e.key === 'Delete') { if (deleteSelection()) { e.preventDefault(); return; } }
              else if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
                e.preventDefault();
                try { doc.execCommand('copy'); } catch (x) {}
                if (!deleteSelection()) { try { doc.execCommand('delete'); } catch (x) {} }
                markDirty(); return;
              }
              else if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                if (deleteSelection()) { e.preventDefault(); try { doc.execCommand('insertText', false, e.key); } catch (x) {} markDirty(); return; }
              }
            }
          }
        }
        if (e.key === 'Enter') {
          // 对拍 T14：Notion 在 toggle 内**新建一个空块**作为首个子块（你按 Enter 是要写新东西，
          // 不是要跳到已有内容上）。我们原来跳到已存在的首个体内块 = 光标神秘位移。
          // 已有首块本就是空叶子时不再多插一个（否则连按堆空块）。
          e.preventDefault(); e.stopPropagation();
          const det = editingEl.parentElement;
          const first = det && [...det.children].find((c) => c.nodeType === 1 && c.tagName !== 'SUMMARY');
          const firstEmpty = first && SM.isLeafTextBlock(first) && (first.textContent || '').trim() === '';
          if (firstEmpty) { enterEdit(first, { mode: 'start' }); return; }
          const np = doc.createElement('p'); np.appendChild(doc.createElement('br'));
          if (first) first.before(np); else det.appendChild(np);
          if (!det.open) det.open = true; // 折叠态下按 Enter 新建 → 展开，否则新块看不见
          if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(np, { mode: 'start' });
          return;
        }
        if (e.key === ' ') { e.preventDefault(); doc.execCommand('insertText', false, ' '); return; } // 原生 summary 空格会折叠——拦默认、手动插空格
        if (e.key === 'Backspace' && isCaretAtStart(doc, editingEl)) {
          // ===== E2：折叠块标题行首退格 = 降级成文本块（对拍实证 2026-08-04，探针 E2-a/E2-b）=====
          // 旧行为：只有「标题空 + 体也空」才解包，其余一律零反馈 —— 用户找不到退出这个折叠块的办法（死胡同）。
          // Notion：① 剥掉 toggle 格式变文本块（体内块仍挂在它下面）；② 再退一次才并入上一块、体内块升顶层。
          // 我们的 <p> 不能有子块（文法所限）→ ① 一步到位：标题成段落、体内块提升为其后的兄弟。
          // 这正是既有 turnInto(details → text)（U9/R2）的语义，直接复用，与菜单「转为正文」路径同款。
          // 第二次退格：此时已是普通段落，落进下面 generic 合并分支，自动得到 Notion ② 的终态。
          e.preventDefault();
          const det = editingEl.parentElement;
          // 空 toggle 的逃生路径**保持不变**（契约 toggle.md）：整块只解包成**一个**空段落。
          // 走通用 turnInto 会得到「summary 产物 + 体内那个空块」两个空段落，凭空多一空行（发版把关 W-3）。
          const bodyBlocks = blocksInScope(det);
          if ((editingEl.textContent || '').trim() === '' && bodyBlocks.every((b) => (b.textContent || '').trim() === '' && !b.querySelector('img,hr,table,figure,ul,ol,details'))) {
            const p = doc.createElement('p'); p.appendChild(doc.createElement('br'));
            det.replaceWith(p);
            if (undoMgr) undoMgr.checkpoint(); markDirty();
            enterEdit(p, { mode: 'start' });
            return;
          }
          const nx = turnInto(det, itemByKey('text'));
          if (nx) {
            if (!nx.firstChild) nx.appendChild(doc.createElement('br')); // 空产物必带 <br>，否则光标落不进去（selection 变 null，实测）
            enterEdit(nx, { mode: 'start' });
          }
          return;
        }
        return; // 其它键（含字符/方向/'/'）交原生编辑 summary
      }
      // 触发斜杠
      if (e.key === '/' && editingEl && !e.metaKey && !e.ctrlKey) {
        const blockEl = editingEl;
        // 用父窗口 setTimeout：iframe 是 sandbox 无 allow-scripts，在 iframe window 上调度回调会被拦
        global.setTimeout(() => { if (editingEl === blockEl) openSlash(blockEl); }, 0);
        return;
      }
      // ⌘/Ctrl+A 分级全选（Notion/Typora 式，王波 2026-07-17「一次选一段、两次全篇」）：
      // 第一次全选当前块文字；已全选再按 → 放墙（exitEdit，同拖选跨块）+ 全篇跨块选区
      // （删除/剪切走下面既有 homeless 选区管线）。原生 Select All 被单块 contenteditable
      // 钉死在块内、第二级永远够不到（实测第 2/3 次纹丝不动）——这里接管。菜单「全选」已
      // 去加速器注册（main.js），真实按键在 mac/Win 都直达这里、不再被菜单吃掉。
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A') && !e.isComposing && e.keyCode !== 229) {
        const sel = doc.getSelection();
        if (editingEl && sel) {
          e.preventDefault();
          // 「块内已全选」判定剥空白比较——表格/列表的 sel.toString() 带 \t\n 分隔、textContent 没有，
          // 逐字比对会永远判「未全选」把第二级堵死。空块（无文字）第一次就直接升全篇。
          const norm = (s) => (s || '').replace(/\s+/g, '');
          // 列表内多一档分级（Colin 2026-07-23）：① 选当前行 li 内容 → ② 选整个 <ul> → ③ 全篇。
          // 列表 editingEl = 整个 <ul>，若直接走下面「一次选整块」，⌘A 一次就选全列表、随手打字覆盖整份 checklist（丢数据级）。
          if (editingEl.tagName === 'UL' || editingEl.tagName === 'OL') {
            const an = sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
            const li = an && an.closest ? an.closest('li') : null;
            if (li && editingEl.contains(li)) {
              const liRange = doc.createRange(); liRange.selectNodeContents(li);
              const subList = li.querySelector(':scope > ul, :scope > ol');
              if (subList) liRange.setEndBefore(subList); // 「本行」= li 起点到嵌套子列表之前（子列表各自独立、不算本行）
              const liText = norm(liRange.toString());
              const ulText = norm(editingEl.textContent);
              const curText = norm(sel.toString());
              if (liText.length > 0 && curText !== liText && curText !== ulText) { sel.removeAllRanges(); sel.addRange(liRange); return; } // ① 当前行
              if (curText !== ulText) { const r = doc.createRange(); r.selectNodeContents(editingEl); sel.removeAllRanges(); sel.addRange(r); return; } // ② 整个列表
              selectWholeDoc(); return; // ③ 全篇
            }
          }
          const blockText = norm(editingEl.textContent);
          const allInBlock = blockText.length > 0 && norm(sel.toString()) === blockText;
          if (blockText.length > 0 && !allInBlock) {
            const r = doc.createRange();
            r.selectNodeContents(editingEl);
            sel.removeAllRanges(); sel.addRange(r);
          } else {
            selectWholeDoc();
          }
          return;
        }
        // 非编辑态（块选中/无输入焦点）按 ⌘A：直接全篇（Notion 同款——块选中态下 ⌘A=选中所有）
        e.preventDefault();
        selectWholeDoc();
        return;
      }
      // 跨块 / 无编辑态拖选的删除 + 剪切：原生删不掉这类选区（横跨多个独立 contenteditable 块，
      // 或没有 contenteditable 宿主）→ 自己删（Wendi Bug4/5/6）。deleteSelection 返回 false 时（编辑态
      // 单块内选区）不拦、交原生。Cmd+X 先把选区复制进剪贴板再删。
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.isComposing && e.keyCode !== 229) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed && deleteSelection()) { e.preventDefault(); return; }
      }
      // 跨块/无主选区上直接打字（拖选或 ⌘A 全选后想「重打」替换）：此时 editingEl=null、焦点在不可编辑的
      // focusCatcher 上，原生没有编辑宿主 → 字被丢、毫无反应（Wendi 反馈）。先 deleteSelection 把跨块选区删成
      // 一个干净块+光标（返回 true = 它接管了跨块/无主选区），再把这个字插进落好的块。单块内编辑态选区
      // deleteSelection 返回 false → 不拦、交原生正常覆盖，不影响正常打字。
      if (e.key && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && e.keyCode !== 229) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed && deleteSelection()) {
          e.preventDefault();
          try { doc.execCommand('insertText', false, e.key); } catch (x) {}
          markDirty();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          e.preventDefault();
          try { doc.execCommand('copy'); } catch (x) {} // 复制选区到剪贴板（剪切=复制+删）
          if (!deleteSelection()) doc.execCommand('delete'); // 跨块/无主自己删；编辑态单块内 → 原生删
          markDirty();
          return;
        }
        // 灰选整块态（无选区）：⌘C 有整块分支（onCopy ①）、Backspace 有整块删，唯独 ⌘X 没有对位实现 →
        // 屏幕上「这块被选中」，⌘C 兑现、Backspace 兑现、⌘X 静默不兑现，而且剪贴板还留着**上一次的旧内容**，
        // 用户以为剪走了、到别处粘出来的却是无关东西（对抗审查实测）。补齐：复制整块 + 删整块。
        if (selectedEl && !editingEl) {
          e.preventDefault();
          try { doc.execCommand('copy'); } catch (x) {} // 触发 onCopy 的「灰选整块」分支，产出与 ⌘C 一致
          removeBlock(selectedEl);
          return;
        }
      }
      // Enter：可编辑块末尾 → 新建正文块（list 交原生新 <li>；中间交原生；IME/Shift 软换行）
      if (e.key === 'Enter' && editingEl) {
        if (e.isComposing || e.keyCode === 229 || e.shiftKey) return;
        if (classify(editingEl) === 'list') {
          // 列表内回车：空的最后一项上再回车 → 跳出列表、在 ul 后新建正文块（双回车退出，对齐常见编辑器）。
          const sel = doc.getSelection();
          const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
          const li = node && node.closest ? node.closest('li') : null;
          // U12/keys-3：嵌套空项 Enter → outdent 成宿主 li 的下一个兄弟（保持列表内、仍是列表项），
          // 而不是以顶层 editingEl 为锚把新段插到整个列表之后 + 留幽灵空嵌套 ul。出列前收编后继兄弟（keys-5 同款）。
          if (li && (li.textContent || '').trim() === '') {
            const plist = li.parentElement;
            const hostLi = plist && plist.parentElement;
            const isNested = plist && plist !== editingEl && hostLi && hostLi.tagName === 'LI';
            if (isNested) {
              // 嵌套空项 Enter → outdent 成宿主下一兄弟；**不收编后继兄弟**（那是 U13 Shift-Tab 的事，item 非空才能安全承载
              // 子列表——空项当子列表父项时 Chromium 不让在块级 ul 前打字，对抗审查实测）。后继兄弟留在宿主嵌套列表里。
              e.preventDefault();
              hostLi.after(li);
              if (!plist.querySelector('li')) plist.remove(); // 掏空的嵌套 ul 移除
              if (!li.firstChild) li.appendChild(doc.createElement('br'));
              if (undoMgr) undoMgr.checkpoint(); markDirty();
              caretAtLiTextEnd(li); // 空项无子列表 → 光标落其内，打字正常
              return;
            }
            // U15/keys-7：顶层空项且**有后继**（中间/首项）→ 脱离列表：删空项、按位置劈 ul、插空段落、光标进段落。
            // 原来只认末项（!nextElementSibling），中间空项落 native 无限堆空项、双回车退出只对末项生效。
            if (li.nextElementSibling) {
              e.preventDefault();
              const ul = editingEl;
              const prev = li.previousElementSibling;
              const next = li.nextElementSibling;
              li.remove();
              const p = doc.createElement('p'); p.appendChild(doc.createElement('br'));
              if (prev) {
                // 中间：后继项移到新同类列表，段落夹在两列表中间
                const ul2 = doc.createElement(ul.tagName); if (ul.className) ul2.className = ul.className;
                let n = next; while (n) { const nx = n.nextElementSibling; ul2.appendChild(n); n = nx; }
                ul.after(p); p.after(ul2);
              } else {
                ul.before(p); // 首项：段落插在列表前
              }
              if (undoMgr) undoMgr.checkpoint(); markDirty();
              enterEdit(p, { mode: 'start' });
              return;
            }
            if (!li.nextElementSibling) {
              // 顶层空末项 → 退出列表（双回车退出，既有行为）
              e.preventDefault();
              const ul = editingEl; li.remove();
              if (ul.querySelector('li')) { const nx = insertAfter(ul, itemByKey('text')); enterEdit(nx, { mode: 'start' }); }
              else { const p = turnInto(ul, itemByKey('text')); enterEdit(p, { mode: 'start' }); } // 列表空了 → 整块转正文
              return;
            }
          }
          // U6/keys-2：非空/非末项 → 交原生新建 <li>。原生 li split 克隆源 li 全部属性（id/data-checked），
          // 无 post-split 清理 → 已勾项回车产「天生已勾」的新项 + 重复 id 入盘坏锚点。记录分裂前直接子 li 集，
          // 一次性 input 后取差集找新 li，按内容判定剥属性：空项剥（都非空则文档序更后者剥，对齐 splitBlock 剥后块）。
          if (!listSplitPending) {
            const ul0 = li.parentElement, before0 = new Set([...li.parentElement.children].filter((x) => x.tagName === 'LI')), src0 = li; // 锚在**当前 li 所属的 ul**（可能是嵌套子列表），不是顶层 editingEl——否则嵌套项分裂的产物是孙节点、不入差集，跳过清理
            listSplitPending = true;
            const onSplit = () => {
              doc.removeEventListener('input', onSplit);
              listSplitPending = false;
              if (!ul0.isConnected) return;
              const products = [src0, ...[...ul0.children].filter((x) => x.tagName === 'LI' && !before0.has(x))].filter((x) => x && x.isConnected && x.parentElement === ul0);
              if (products.length < 2) return; // 没真分裂 / 结构异常 → 不动
              const hasContent = (x) => (x.textContent || '').trim() !== '';
              // 保留「原始内容的延续」那个 li（其 id/勾选保住），剥其余（新段）：
              //   src0 有内容（End/劈半：src0=光标前半）→ 留 src0；src0 空但有内容项（Home：内容搬去新 li）→ 留内容项；都空 → 留 src0（原项）。
              let keep = src0;
              if (!hasContent(src0)) { const nonEmpty = products.filter(hasContent); if (nonEmpty.length) keep = nonEmpty[0]; }
              for (const x of products) { if (x !== keep) { x.removeAttribute('id'); x.removeAttribute('data-checked'); } }
            };
            doc.addEventListener('input', onSplit);
          }
          return; // 非空/非末项 → 交原生（新建 <li>），分裂后 onSplit 清理克隆属性
        }
        if (!isCaretAtRealEnd(doc, editingEl)) {
          // 段落中间/块首回车 → 在光标处劈成两个同类型块（换段）。绝不交原生（原生塞嵌套 <p>，写坏文档，Bug7）。
          // 严格块末判定（尾随空格不算块末）：否则「Hello␣␣␣|」按 Enter 会走新建空块、把空格留原块（B 组）。
          if (splitBlock()) { e.preventDefault(); return; }
          return;
        }
        // toggle 体内末块回车退出（U7）：空的末正文块 → 跳出 toggle，在 details 后新建正文块（体内保留 ≥1 块）
        const escScope = scopeRootOf(editingEl);
        if (escScope !== blockRoot) {
          const bs = blocksInScope(escScope);
          if (bs[bs.length - 1] === editingEl && (editingEl.textContent || '').trim() === '') {
            e.preventDefault();
            if (bs.length > 1) editingEl.remove(); // ≥1 体块铁则：仅不止一块时删空块
            const nx = insertAfter(escScope, itemByKey('text')); // escScope=details，.after 落外层
            enterEdit(nx, { mode: 'start' });
            return;
          }
        }
        // 段末回车 → 新建空正文块（标题/引用末尾回车也续为正文，对齐 Notion；故用 itemByKey('text') 而非劈块）
        // toggle 体内非末/非空块：insertAfter 用 .after → 落体内（作用域正确，自动获得）
        e.preventDefault();
        const nx = insertAfter(editingEl, itemByKey('text'));
        enterEdit(nx, { mode: 'start' });
        return;
      }
      // 灰选整表 Enter/↓ → 进入首格编辑（键盘可达闭环 R2；R1C1 = thead 优先）。必须先于「灰选 Enter 插段落」
      // 与「灰选态方向键穿行」两个 generic 分支。
      if ((e.key === 'Enter' || e.key === 'ArrowDown') && selectedEl && !editingEl && classify(selectedEl) === 'table') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        const fc = firstCellOf(selectedEl);
        if (fc) { enterCell(fc, { mode: 'start' }); return; }
        // 退化壳表（无任何格）：Enter 维持灰选、不插段落——留给删除路径处理
        return;
      }
      // 灰选中态 Enter → 在其后插正文块
      if (e.key === 'Enter' && selectedEl && !editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        const nx = insertAfter(selectedEl, itemByKey('text'));
        enterEdit(nx, { mode: 'start' });
        return;
      }
      // Tab / Shift-Tab：仅在列表里缩进/反缩进（嵌套子列表，继承本块 ul/ol + class）；
      // 其它块也吞掉 Tab，避免它把光标跳出编辑区。
      if (e.key === 'Tab' && editingEl) {
        e.preventDefault();
        if (classify(editingEl) !== 'list') {
          // toggle 嵌套（U7）：Tab 把块嵌进前一个 <details> 体；Shift-Tab 把体内块移出到 details 后。
          // Track2 方案B（§1.3 优先级）：toggle 协调先行；顶层 indentable 块走 ws-indent 整块缩进。
          const scope = scopeRootOf(editingEl);
          const k = classify(editingEl);
          const indentable = k === 'text' || k === 'heading' || k === 'quote' || editingEl.classList.contains('ws-callout');
          if (e.shiftKey) {
            if (scope !== blockRoot) {
              // 【既有 toggle 退出逻辑，逐字保留】
              const det = scope;
              det.after(editingEl);
              if (blocksInScope(det).length === 0) det.appendChild(doc.createElement('p')); // ≥1 体块铁则
              stripIndent(editingEl); // 出 toggle 归 0 档（§1.3；DOM 变更之后、checkpoint 之前，防 undo 双偏移）
              if (undoMgr) undoMgr.checkpoint();
              markDirty();
              enterEdit(editingEl, { mode: 'keep' });
              return;
            }
            if (indentable) {
              const cur = indentLevelOf(editingEl);
              const next = Math.max(0, cur - 1);
              if (next !== cur) { setIndentLevel(editingEl, next); if (undoMgr) undoMgr.checkpoint(); markDirty(); } // 0 档再按 = 静默 no-op，不留空 undo 步
            }
            return;
          }
          const prev = editingEl.previousElementSibling;
          if (prev && prev.tagName === 'DETAILS') {
            // 【既有 toggle 嵌入逻辑，逐字保留】
            prev.setAttribute('open', ''); // 展开被嵌入的 toggle 免内容隐身
            prev.appendChild(editingEl);
            stripIndent(editingEl); // 进 toggle 剥缩进（结构嵌套取代数值缩进；DOM 变更之后、checkpoint 之前）
            if (undoMgr) undoMgr.checkpoint();
            markDirty();
            enterEdit(editingEl, { mode: 'keep' });
            return;
          }
          if (scope === blockRoot && indentable) { // 整块缩进（toggle 体内不缩，§1.3 优先级）
            const bs = topBlocks();
            const i = bs.indexOf(editingEl);
            const cur = indentLevelOf(editingEl);
            const maxAllowed = i > 0 ? indentLevelOf(bs[i - 1]) + 1 : 0; // 首块缩不了；上一块无 class 按 0 算
            const next = Math.min(cur + 1, maxAllowed, INDENT_MAX); // 允许 next<cur：向下归一化（§1.2 有意行为，别加守卫）
            if (next !== cur) { setIndentLevel(editingEl, next); if (undoMgr) undoMgr.checkpoint(); markDirty(); }
          }
          return;
        }
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        // 目标 li（U1 多选）：折叠光标 = 光标所在行；跨行选区 = 与选区内容相交的所有最外层 li。
        const allLis = [...editingEl.querySelectorAll('li')];
        let targets;
        if (sel.isCollapsed) {
          const n = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
          const one = n && n.closest ? n.closest('li') : null;
          targets = one && editingEl.contains(one) ? [one] : [];
        } else {
          targets = allLis.filter((li) => {
            // 用 li「自身内容」范围（到其嵌套子列表之前），不含子列表——否则父项会因选区落在其子项上而误判相交。
            const liR = doc.createRange();
            liR.setStart(li, 0);
            const subUl = [...li.children].find((c) => c.tagName === 'UL' || c.tagName === 'OL');
            if (subUl) liR.setEndBefore(subUl); else liR.setEnd(li, li.childNodes.length);
            return range.compareBoundaryPoints(Range.END_TO_START, liR) < 0 && range.compareBoundaryPoints(Range.START_TO_END, liR) > 0;
          });
          // 只留最外层——被其他选中 li 包含的嵌套子项随父项一起移动，不单独处理。
          targets = targets.filter((li) => !targets.some((o) => o !== li && o.contains(li)));
        }
        if (!targets.length) return;
        // 记录选区四端点，操作后原样恢复：缩进绝不动光标/选区。li reparent 后其内部文本节点引用仍有效。
        const sc0 = range.startContainer, so0 = range.startOffset, ec0 = range.endContainer, eo0 = range.endOffset;
        // 按直接父列表分组（各组内保 DOM 顺序）。
        const groups = new Map();
        for (const li of targets) { const p = li.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(li); }
        let changed = false;
        if (e.shiftKey) {
          // 同一 hostLi 下可能有多个子列表（合规文档允许一个 li 带多个直接子列表）；多组共享 hostLi 时
          // 必须接续插入（记每个 host 的上次落点），不能每组都重锚 hostLi——否则后组会插到前组之前致错序（对抗审查）。
          const lastRefByHost = new Map();
          for (const [parentList, lis] of groups) {
            const hostLi = parentList.parentElement;
            if (!hostLi || hostLi.tagName !== 'LI') continue; // 已在顶层，无法再出列
            absorbTrailingSiblings(lis[lis.length - 1]); // U13/keys-5：组末项收编后继非选中兄弟为子项，保序
            let ref = lastRefByHost.get(hostLi) || hostLi;
            for (const li of lis) { ref.after(li); ref = li; }
            lastRefByHost.set(hostLi, ref);
            if (!parentList.querySelector('li')) parentList.remove();
            changed = true;
          }
        } else {
          for (const [parentList, lis] of groups) {
            const first = lis[0];
            const prev = first.previousElementSibling;
            if (!prev || prev.tagName !== 'LI') continue; // 组首无上一项可嵌 → 该组不缩进
            let sub = prev.lastElementChild;
            if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
              // D3：子列表继承 li 的直接父列表类型/class（如 todo 缩进仍是 todo），不是顶层 editingEl 的。
              sub = doc.createElement(parentList.tagName.toLowerCase());
              if (parentList.className) sub.className = parentList.className;
              prev.appendChild(sub);
            }
            for (const li of lis) sub.appendChild(li);
            changed = true;
          }
        }
        if (changed) { if (undoMgr) undoMgr.checkpoint(); markDirty(); }
        // U19：恢复原选区（端点文本节点随 li reparent 引用不变）→ 光标/多选原样保留、不跳。
        try {
          if (sc0.isConnected && ec0.isConnected) {
            const clamp = (n, o) => Math.min(o, n.nodeType === 3 ? n.length : n.childNodes.length);
            const r = doc.createRange();
            r.setStart(sc0, clamp(sc0, so0));
            r.setEnd(ec0, clamp(ec0, eo0));
            const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
          } else if (targets[0]) { caretAtLiTextEnd(targets[0]); }
        } catch (x) { if (targets[0]) caretAtLiTextEnd(targets[0]); }
        return;
      }
      // Backspace 块首：空块删/落上一块末；非空并入上一块（按标签类型安全合并，绝不产生非法嵌套）
      if (e.key === 'Backspace' && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        if (classify(editingEl) === 'list') {
          const lsel = doc.getSelection();
          const lnode = lsel && lsel.anchorNode ? (lsel.anchorNode.nodeType === 1 ? lsel.anchorNode : lsel.anchorNode.parentElement) : null;
          const cli = lnode && lnode.closest ? lnode.closest('li') : null;
          // ===== E1：顶层列表行行首退格 = Notion「逐层剥离」的第①步（对拍实证 2026-08-04）=====
          // Notion 第一次按键**不合并**——只把这一行剥掉列表格式、原地变成文本块，列表在此处劈开；
          // 第二次才并入上一块。**终态与旧行为一致，只是推后一次按键**，所以 Wendi bug3（#319「行首退格
          // 什么都不发生」）的诉求没被推翻：第一次按键就有明确可见的反馈（marker 消失、行变文本）。
          // 空行 / 唯一行 / 已勾选待办 走同一条规则（探针 P-A/P-D/P-E 实证；勾选态随格式一并丢弃，Notion 同款）。
          // **嵌套行不走这里**：Notion 的①是「嵌套的文本块」，我们的文法表达不了（<li> 只装行内内容或子列表），
          // 只能压成 Notion 的② —— 而②（有前兄弟→并入前兄弟；无前兄弟→并入宿主行文字、后续兄弟仍留在父下）
          // 恰好就是下面既有分支 + 原生的现有行为（探针 P-C 两侧实测一致），故嵌套行一行不动。
          if (cli && cli.parentElement === editingEl && isCaretAtStart(doc, cli)) {
            e.preventDefault();
            const nx = turnIntoLines(editingEl, [cli], itemByKey('text'));
            if (nx) enterEdit(nx, { mode: 'start' });
            return; // nx 为空理论不可达（cli 已证是直接子项）；真出现也零变更，绝不落到原生把 <ul> 塌成 ghost
          }
          // 空【嵌套】项起始退格（顶层空行已被上面接管）：原生 contentEditable 会把整张 <ul>/<ol> 塌成
          // 空 <ul></ul>（残留 ghost 块——无 li 无勾选框、拖柄还在、再退格删不掉、往里打字灌进 <ul> 变非合规，
          // Wendi bug4 待办删空即中）。自己接管：有上一项→合并上去（光标落上一项末，列表保留）；
          // 嵌套首空项（U12/keys-3）→ 删空项 + 掏空的嵌套 ul 移除、光标落宿主 li 内容末尾。
          if (cli && editingEl.contains(cli) && cli.parentElement !== editingEl && (cli.textContent || '').trim() === '') {
            e.preventDefault();
            const plist = cli.parentElement; // 真实父列表（恒是嵌套子列表：顶层已分流）
            const prevLi = cli.previousElementSibling;
            cli.remove();
            if (undoMgr) undoMgr.checkpoint();
            markDirty();
            if (prevLi) {
              if (!prevLi.firstChild) prevLi.appendChild(doc.createElement('br')); // 上一项也空 → 补 <br>，否则光标落进去 selection 会变 null（实测）
              enterEdit(editingEl, { mode: 'end' });
              try { const r = doc.createRange(); r.selectNodeContents(prevLi); r.collapse(false); const s2 = doc.getSelection(); s2.removeAllRanges(); s2.addRange(r); } catch (x) {}
            } else {
              // U12：嵌套首空项——无同级 prevLi → 掏空的嵌套 ul 移除，光标落宿主 li 内容末尾（在其嵌套子列表之前）
              const hostLi = plist.parentElement;
              if (!plist.querySelector('li')) plist.remove();
              enterEdit(editingEl, { mode: 'end' });
              if (hostLi && hostLi.tagName === 'LI') {
                if (!hostLi.firstChild) hostLi.appendChild(doc.createElement('br'));
                let anchor = null;
                for (const n of hostLi.childNodes) { if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) break; anchor = n; }
                try { const r = doc.createRange(); if (anchor) r.setStartAfter(anchor); else r.setStart(hostLi, 0); r.collapse(true); const s2 = doc.getSelection(); s2.removeAllRanges(); s2.addRange(r); } catch (x) {}
              }
            }
            return;
          }
          // 嵌套非空行行首退格：**自己接管**（语义仍是 Notion 的②：并入前兄弟；无前兄弟则并入宿主行文字）。
          // 原来这里交原生——语义确实对，但 Colin 2026-08-04 实机抓到原生会往盘里写
          // `<span style="font-family: -apple-system, …">` 这种垃圾（Chromium 合并时保留「打字样式」），
          // 而且在「前兄弟是空行」时还会把结构搅成空壳宿主行。自己做就都没有。
          if (cli && editingEl.contains(cli) && cli.parentElement !== editingEl && isCaretAtStart(doc, cli)) {
            const plist = cli.parentElement;
            const hostLi = plist.parentElement;
            const prevLi = cli.previousElementSibling;
            const target = prevLi || (hostLi && hostLi.tagName === 'LI' ? hostLi : null);
            // cli 自己还带子列表时**也要并**（对抗审查 ADV-6）：原来这里 preventDefault 直接 return =
            // 零变更零反馈的**静默死键**，而 E2 这一批的立论恰恰就是「不留死胡同」，自相矛盾。
            // 三层列表里任何一个有孙项的中间行都会命中，不算罕见。并过去后孙项成为目标行的子项
            //（`<li>` 允许挂多张子列表，schema 已实证放行；门里带 conform 断言兜着）。
            if (!target) { e.preventDefault(); return; }
            e.preventDefault();
            const joinAt = mergeLiInto(target, cli);
            if (!plist.querySelector('li')) plist.remove(); // 子列表被掏空 → 移除，绝不留幽灵空 ul
            if (undoMgr) undoMgr.checkpoint();
            markDirty();
            enterEdit(editingEl, { mode: 'end' }); // 必须在设光标【之前】——enterEdit 会重置选区
            caretBefore(joinAt);
            return;
          }
          return; // 行中删字等 → 交原生
        }
        if (!isCaretAtStart(doc, editingEl)) return;
        const scope = scopeRootOf(editingEl); // U6：作用域感知合并/退格
        const blocks = (scope === blockRoot) ? topBlocks() : blocksInScope(scope);
        const idx = blocks.indexOf(editingEl);
        if (idx <= 0) {
          if (scope !== blockRoot) { e.preventDefault(); const s = summaryOf(scope); if (s) enterEdit(s, { mode: 'end' }); return; } // toggle 体首块起始退格 → 光标回 summary 末（绝不删 summary）
          return; // 顶层首块 → 原 no-op
        }
        const prev = blocks[idx - 1];
        const cur = editingEl;
        const curEmpty = (cur.textContent || '').trim() === '';
        e.preventDefault();
        if (curEmpty) {
          // 空块：直接删，光标落上一块（可编辑→末尾；否则灰选）
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          if (isEditableEl(prev)) {
            enterEdit(prev, { mode: 'end' });
            // 上一块是列表时，'end' 会把光标停在 <ul> 层（末项之后）而不是末项【内】——closest('li') 取不到项，
            // 于是下一次退格既进不了行级剥离、也进不了原生 li 合并 = 死键（E1 之后这条路径成了热路径：
            // 剥出来的空段落被删掉后就落在这里，实测连按三次退格第三次纹丝不动）。显式把光标放进末项。
            if (classify(prev) === 'list') {
              const lastLi = lastVisibleLi(prev); // ADV-4：光标也要落到视觉上的上一行（最深末行）
              if (lastLi) {
                if (!lastLi.firstChild) lastLi.appendChild(doc.createElement('br')); // 全空的 <li> 装不住 selection（会变 null，实测；空 li 退格分支早有同款补 <br>）
                caretAtLiTextEnd(lastLi);
              }
            }
          } else { selectBlock(prev); positionGrip(prev); }
          return;
        }
        if (classify(prev) === 'list') {
          if (!isLeafTextBlock(cur)) return; // B2 守卫对称（补）：cur 是容器块(callout/quote)时不能把块级 <p> 塞进 <li>（产 <li><p> 非法）
          // 上一块是列表 → **并入其末项的文字**（不是追加成新 <li>）。E1 对拍实证 2026-08-04：Notion 里
          // 「列表后接段落，段落行首退格」得到「末项文字+段落文字」拼成一项（父后行 + 分隔二 → 父后行分隔二），
          // 而不是多出一个列表项。这条也是「顶层行剥离后再退一次」落到的终态，两条路径必须同款。
          const target = lastVisibleLi(prev); // ADV-4：视觉上的上一行 = 最深末行，不是最后一个直接子项
          if (!target) return; // 空列表（无 li）→ 不吞，光标留原处
          const joinAt = mergeLiInto(target, cur); // 剥占位 <br> / 插在子列表前 两条加固都在 helper 里
          if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          caretBefore(joinAt);
          return;
        }
        // 多段 callout 首行退格（对拍 C8，P2）：cur 是容器块（有块级子节点）→ 下面的叶子-叶子拼接一律 return，
        // 键按下去零变更、连顶栏「未保存」都不亮 = 静默死键，用户既拿不到反馈也无从知道怎么退出这一步。
        // Notion 的解：**只有第一个子块脱框并进上一块，框带着剩下的继续存在**（实测双子块 callout）。
        // 单段 callout（<div class="ws-callout">文字</div>）是叶子块、走下面既有路径，两侧行为本就一致——别动它。
        // 只接管 callout：blockquote/toggle 等其它容器块未对拍，保持原样（欠账记在 docs/features/callout.md）。
        if (cur.classList && cur.classList.contains('ws-callout') && !isLeafTextBlock(cur) && isEditableEl(prev) && isLeafTextBlock(prev)) {
          const firstEl = cur.firstElementChild;
          // 「第一行」两种形态：callout 以 <p> 开头 → 供出那个 <p> 的内容；以行内内容开头（混排，外部文件才有）
          //  → 供出到第一个块级元素为止的那段行内。两种都不改 callout 的剩余子块。
          const donor = (cur.firstChild === firstEl && firstEl && isLeafTextBlock(firstEl)) ? firstEl : null;
          const src = donor || cur;
          const stopAt = donor ? null : firstEl;
          if (prev.childNodes.length === 1 && prev.firstChild.nodeName === 'BR') prev.firstChild.remove(); // 空目标块的占位 <br>，同下
          const joinAt = src.firstChild !== stopAt ? src.firstChild : null;
          while (src.firstChild && src.firstChild !== stopAt) prev.appendChild(src.firstChild);
          if (donor) donor.remove();
          if (!cur.firstElementChild && (cur.textContent || '').trim() === '') cur.remove(); // 掏空的框不留（对齐单段那半的终态）
          if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          if (joinAt && joinAt.parentNode === prev) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
          return;
        }
        if (isEditableEl(prev)) {
          // 两块都得是「叶子文字块」才做节点级拼接——否则 prev/cur 是透明包裹块（div.lead>p）时，把块级 <p>
          // 搬进 <p> 会成 <p><p>、把裸文本灌进 div 会成「容器直挂文本」，存盘即坏（A 组）。非叶子则不吞、光标留原处。
          if (!isLeafTextBlock(prev) || !isLeafTextBlock(cur)) return;
          // 空目标块的占位 <br>（`<p><br></p>`）→ 剥掉，免并入后留前导空行（对抗审查 Finding C）。
          // E1 之后这条路径变成热路径：列表行剥离成段落后再退一格，就落在这里；原来这个剥 <br> 只做在
          // 列表分支里，不补的话「空段落 + 待办」两步退完会留一行空行（Finding C 原地复发）。
          if (prev.childNodes.length === 1 && prev.firstChild.nodeName === 'BR') prev.firstChild.remove();
          // 两个叶子文字块：搬移子节点拼接（合法），光标落接合点（原 prev 末尾）
          const joinAt = cur.firstChild;
          while (cur.firstChild) prev.appendChild(cur.firstChild);
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          if (joinAt && joinAt.parentNode === prev) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
          return;
        }
        // prev 不可编辑（图片/分隔线/designed）且当前块非空：不吞内容，光标留在原处
        return;
      }
      // Delete 块末（前向合并）：把下一块并入当前块末尾，光标停在接合点。镜像上面的 Backspace 块首合并
      // （Wendi Bug7「合并段」——原来只能向后合并，块末按 Delete 撞墙没反应）。块中间交原生删字。
      if (e.key === 'Delete' && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        // U7/select-3：镜像 Backspace，让列表 Delete 前向合并不再撞墙（原来直接 return 交原生，但每个块是
        // 独立 contenteditable、原生跨不出块边界 → 末项尾/段末遇列表全 no-op，与 Backspace 侧不对称）。
        if (classify(editingEl) === 'list') {
          const s0 = doc.getSelection();
          if (!s0 || s0.rangeCount === 0 || !s0.isCollapsed) return; // 非折叠已前处理
          const n0 = s0.anchorNode ? (s0.anchorNode.nodeType === 1 ? s0.anchorNode : s0.anchorNode.parentElement) : null;
          const curLi = n0 && n0.closest ? n0.closest('li') : null;
          if (!curLi || curLi.parentElement !== editingEl) return; // 嵌套子项 / 定位不到顶层 li → 交原生
          const nextLi = curLi.nextElementSibling;
          // c) 空 li Delete → 前向并入下一 li（镜像 Backspace 空 li）
          if ((curLi.textContent || '').trim() === '' && nextLi && nextLi.tagName === 'LI') {
            e.preventDefault();
            if (curLi.childNodes.length === 1 && curLi.firstChild && curLi.firstChild.nodeName === 'BR') curLi.firstChild.remove(); // 剥空项占位 br
            // 空项被下一项内容填充 → 采纳下一项的勾选态/锚点（内容搬上来了、状态跟内容走；否则删空行会把下一任务的勾清掉，对抗审查 P3）
            if (nextLi.getAttribute('data-checked') === 'true') curLi.setAttribute('data-checked', 'true'); else curLi.removeAttribute('data-checked');
            if (!curLi.id && nextLi.id) curLi.id = nextLi.id;
            const joinAt = nextLi.firstChild;
            while (nextLi.firstChild) curLi.appendChild(nextLi.firstChild);
            nextLi.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
            if (joinAt && joinAt.parentNode === curLi) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
            else if (!curLi.firstChild) curLi.appendChild(doc.createElement('br'));
            return;
          }
          // a) 末项尾 Delete + ul 有下一叶子文字块 → 并入末项（不可并块 → 安全 no-op）。判末项 li 自身末尾（不是 ul）
          if (!nextLi && isCaretAtRealEnd(doc, curLi)) {
            const scope = scopeRootOf(editingEl);
            const bs = (scope === blockRoot) ? topBlocks() : blocksInScope(scope);
            const nb = bs[bs.indexOf(editingEl) + 1];
            if (nb && isEditableEl(nb) && isLeafTextBlock(nb)) {
              e.preventDefault();
              if (curLi.childNodes.length === 1 && curLi.firstChild && curLi.firstChild.nodeName === 'BR') curLi.firstChild.remove(); // 剥空目标末项占位 br（否则合并后留前导空行，对抗审查 P2；镜像 Backspace :1668）
              const joinAt = nb.firstChild;
              while (nb.firstChild) curLi.appendChild(nb.firstChild);
              nb.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
              if (joinAt && joinAt.parentNode === curLi) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
              return;
            }
          }
          return; // 其它 list 内 Delete（非空非末 / 中间删字）→ 交原生
        }
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return; // 非折叠选区前面已处理；这里只管折叠光标
        if (!isCaretAtRealEnd(doc, editingEl)) return; // 严格块末（尾随空格不算）——否则段内 Delete 会误吞下一段（B 组）
        const dScope = scopeRootOf(editingEl); // P1：作用域感知（原用 topBlocks → 体内块 indexOf=-1 → 误吞顶层首块）
        const blocks = (dScope === blockRoot) ? topBlocks() : blocksInScope(dScope);
        const next = blocks[blocks.indexOf(editingEl) + 1];
        if (!next) return; // 作用域末块 → 无内块可合并（绝不跨作用域）
        const cur = editingEl;
        // b) 段末 Delete、下一块是列表 → 吞列表首项（首 li 行内内容并入段落；列表剩余保留、掏空则删 ul）。
        // 首 li 含嵌套子列表 → no-op（镜像 Backspace 首 li 守卫 `!cli.querySelector 子列表`，避免 <p><ul> 非法）。
        if (classify(next) === 'list') {
          const firstLi = next.querySelector(':scope > li');
          if (firstLi && !firstLi.querySelector(':scope > ul, :scope > ol') && isLeafTextBlock(cur)) {
            e.preventDefault();
            if (cur.childNodes.length === 1 && cur.firstChild && cur.firstChild.nodeName === 'BR') cur.firstChild.remove(); // 剥空目标段落占位 br（否则合并后留前导空行，对抗审查 P2；镜像 Backspace :1668）
            if (firstLi.childNodes.length === 1 && firstLi.firstChild && firstLi.firstChild.nodeName === 'BR') firstLi.firstChild.remove();
            const joinAt = firstLi.firstChild;
            while (firstLi.firstChild) cur.appendChild(firstLi.firstChild);
            firstLi.remove();
            if (!next.querySelector(':scope > li')) next.remove(); // 列表掏空 → 删 ul
            if (undoMgr) undoMgr.checkpoint(); markDirty();
            if (joinAt && joinAt.parentNode === cur) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
            return;
          }
          return; // 首 li 空/含嵌套 / cur 非叶子 → no-op
        }
        if (!isEditableEl(next)) return; // 下一块图片/分隔线 → 不吞
        // 两块都得是叶子文字块才拼接——cur/next 是透明包裹块（div.lead>p）时平搬子节点会造 <p><p>/容器直挂裸文本（A 组）。
        if (!isLeafTextBlock(cur) || !isLeafTextBlock(next)) return;
        e.preventDefault();
        const joinAt = next.firstChild; // 接合点（合并后停在它前面 = cur 原末尾）；next 空时为 null
        while (next.firstChild) cur.appendChild(next.firstChild);
        next.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
        if (joinAt && joinAt.parentNode === cur) { try { const r = doc.createRange(); r.setStartBefore(joinAt); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {} }
        return;
      }
      // 跨块左右方向键：块末按 → 进下一块块首；块首按 ← 进上一块块末（Wendi Bug8——原生光标被各自
      // contenteditable 的块边界钉死、跨不过去）。块中间/有选区/带修饰键（Shift 扩选、Cmd 行首尾、Option 跳词）交原生。
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && editingEl && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.isComposing || e.keyCode === 229) return;
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return; // 有选区 → 交原生
        const aScope = scopeRootOf(editingEl); // P1/P2：作用域感知（原用 topBlocks → 体内块 idx=-1 → 跳到 blocks[0] 顶层块）
        const blocks = (aScope === blockRoot) ? topBlocks() : blocksInScope(aScope);
        const idx = blocks.indexOf(editingEl);
        if (e.key === 'ArrowRight') {
          if (!isCaretAtRealEnd(doc, editingEl)) return; // 严格块末（尾随空格不算）——否则段内按 → 会越过空格直接跳块（B 组）
          let next = blocks[idx + 1];
          if (!next && aScope !== blockRoot) next = aScope.nextElementSibling; // toggle 体末 → 跨到 details 后的外层块
          if (!next || next.hasAttribute('data-ws2-ui')) return;
          e.preventDefault();
          if (isEditableEl(next)) enterEdit(next, { mode: 'start' });
          else { selectBlock(next); positionGrip(next); }
        } else {
          if (!isCaretAtStart(doc, editingEl)) return; // 不在块首 → 原生
          let prev = blocks[idx - 1];
          if (!prev && aScope !== blockRoot) prev = summaryOf(aScope); // toggle 体首 → 跨回 summary
          if (!prev) return;
          e.preventDefault();
          if (prev.tagName === 'SUMMARY' || isEditableEl(prev)) enterEdit(prev, { mode: 'end' });
          else { selectBlock(prev); positionGrip(prev); }
        }
        return;
      }
      // 跨块上下方向键：末行↓→下一块、首行↑→上一块（尽量保持列位置；不可编辑块则灰选）。块中间交原生。
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
        const er = editingEl.getBoundingClientRect();
        const box = sel.getRangeAt(0).getBoundingClientRect();
        const degenerate = box.height === 0 && box.top === 0; // 空块等取不到 caret 位置
        const caret = degenerate ? { top: er.top, bottom: er.bottom, left: er.left } : box;
        const lh = (degenerate ? Math.min(er.height, 24) : box.height) || 20;
        const aScope = scopeRootOf(editingEl); // P2：作用域感知（原 topBlocks → 体内块跳顶层）
        const blocks = (aScope === blockRoot) ? topBlocks() : blocksInScope(aScope);
        const idx = blocks.indexOf(editingEl);
        if (e.key === 'ArrowDown') {
          if (caret.bottom < er.bottom - lh * 0.5) return; // 不在末行 → 原生
          let next = blocks[idx + 1];
          if (!next && aScope !== blockRoot) next = aScope.nextElementSibling; // toggle 体末 → 外层块
          if (!next || next.hasAttribute('data-ws2-ui')) return;
          e.preventDefault();
          if (isEditableEl(next)) { const nr = next.getBoundingClientRect(); enterEdit(next, { mode: 'point', x: caret.left, y: nr.top + lh * 0.5 }); }
          else { selectBlock(next); positionGrip(next); }
        } else {
          if (caret.top > er.top + lh * 0.5) return; // 不在首行 → 原生
          let prev = blocks[idx - 1];
          if (!prev && aScope !== blockRoot) prev = summaryOf(aScope); // toggle 体首 → summary
          if (!prev) return;
          e.preventDefault();
          if (prev.tagName === 'SUMMARY') enterEdit(prev, { mode: 'end' });
          else if (isEditableEl(prev)) { const pr = prev.getBoundingClientRect(); enterEdit(prev, { mode: 'point', x: caret.left, y: pr.bottom - lh * 0.5 }); }
          else { selectBlock(prev); positionGrip(prev); }
        }
        return;
      }
      // 灰选中（不可编辑块）态的方向键：继续穿过到上/下一块——否则键盘撞到图片/分隔线就卡死、过不去。
      // ↓→ = 下一块，↑← = 上一块（左右与上下同义，跟编辑态的跨块左右一致，避免落到图片上再卡住）。
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selectedEl && !editingEl && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.isComposing || e.keyCode === 229) return;
        const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
        const blocks = topBlocks();
        const idx = blocks.indexOf(selectedEl);
        const target = fwd ? blocks[idx + 1] : blocks[idx - 1];
        if (!target) return;
        e.preventDefault();
        if (isEditableEl(target)) enterEdit(target, { mode: fwd ? 'start' : 'end' });
        else { selectBlock(target); positionGrip(target); }
        return;
      }
      // Esc：编辑 → 灰选中；灰选中 → 取消
      if (e.key === 'Escape') {
        // U3 行作用域菜单开着时（无 editingEl / selectedEl，Esc 本会空转）→ 关菜单、清行高亮。
        // 只在这一态接管，块作用域的既有阶梯（editing→灰选→deselect，deselect 自带关菜单）一字不动。
        if (menuRow && !editingEl && !selectedEl) { closeBlockMenu(); e.preventDefault(); e.stopPropagation(); return; }
        if (editingEl) { const el = editingEl; exitEdit(); selectBlock(el); positionGrip(el); e.preventDefault(); e.stopPropagation(); return; }
        if (selectedEl) { deselect(); e.preventDefault(); e.stopPropagation(); return; }
      }
      // 灰选中态 Delete/Backspace → 删整块
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl && !editingEl) { e.preventDefault(); removeBlock(selectedEl); }
    }

    // toggle 空态标记（P3-7）：判据 = 展开体内只有一个叶子块且无可见内容。CSS 的 :empty 表达不了
    // 「只有一个 <br>」这种编辑过的空块，故用属性驱动；data-ws2-empty 进 serialize 白名单、绝不入盘。
    function refreshToggleEmpty() {
      const dets = blockRoot.querySelectorAll('details');
      for (const det of dets) {
        const kids = [...det.children].filter((c) => c.tagName !== 'SUMMARY' && !c.hasAttribute('data-ws2-ui'));
        const empty = kids.length === 1 && (kids[0].textContent || '').trim() === '' && !kids[0].querySelector('img,hr,table,figure,ul,ol,details');
        if (empty) det.setAttribute('data-ws2-empty', ''); else det.removeAttribute('data-ws2-empty');
      }
    }
    // 「空壳宿主行」归一（Colin 2026-08-04 实机抓到）：一个 <li> 自己没有任何内容、只裹着一个嵌套列表时，
    // 它自己的勾选框/marker 与嵌套首项的勾选框会**挤在同一行**——因为空 li 的高度几乎为 0，两个
    // ::before 绝对定位落到同一个 y 上，视觉上就是「一行里两个勾选框」。补一个占位 <br> 让宿主行占住自己
    // 那一行（Notion 里父块本来就是独立一行）。这类结构由 Tab 缩进到空行之上、或原生合并产生，
    // 所以归一放在 markDirty 这个总出口上，而不是在每个产生点各修一遍（漏一处就复发）。
    function normalizeHostLi() {
      for (const li of blockRoot.querySelectorAll('li')) {
        const sub = li.querySelector(':scope > ul, :scope > ol');
        if (!sub) continue;
        const own = [];
        for (const n of li.childNodes) { if (n === sub) break; own.push(n); }
        // 「有内容」的判据（对抗审查 ADV-3 修正了两处）：
        //  · 纯空白文本节点**算空**——外部工具/美化过的 HTML 常写成 `<li>\n  <ul>`，旧判据把 '\n  ' 当非空，
        //    于是 attach 时的自愈对这类文件静默失效，「一行两个勾选框」照样复现。
        //  · `<img>` 等元素**算有内容**——旧判据只看 textContent，图片行会被当空、上方凭空多一空行。
        const meaningful = own.some((n) => (n.nodeType === 3 && (n.textContent || '').trim() !== '')
          || (n.nodeType === 1 && n.tagName !== 'BR'));
        const brs = own.filter((n) => n.nodeType === 1 && n.tagName === 'BR');
        if (!meaningful) {
          // 空壳宿主行 → 补占位，让它占住自己那一行（否则它的 marker 与嵌套首项的挤在同一个 y）
          if (!own.some((n) => n.nodeType === 1 && n.tagName === 'BR')) li.insertBefore(doc.createElement('br'), li.firstChild);
        } else if (brs.length === 1) {
          // **反向路径**（ADV-3）：宿主行后来有了文字，占位必须撤掉，否则用户给空父行起个名字就
          // 永久多出一个空行、还随自动保存入盘。
          // 光标落点决定占位最后在文字前还是文字后（实测两种都会出现：caretAtLiTextEnd 落在它之后 →
          // `<li><br>文字<ul>`；点击把光标放到 (li,0) → `<li>文字<br><ul>`），所以两种形状都要认。
          // 保守条件：**own 区里只有这一个 <br>**，且它贴着首尾之一——用户自己敲的多行换行不会被误删。
          const b = brs[0];
          if (b === own[0] || b === own[own.length - 1]) b.remove();
        }
      }
    }
    function onInput(e) {
      refreshToggleEmpty();
      markDirty(); tryMarkdown(e);
      const M = mentionApi();
      if (M && M.isOpen()) { M.syncFromDom(); return; } // 菜单开着：从 DOM 真相重算 query（捕获任何输入法），别再触发新菜单
      maybeMentionTrigger();
    }
    // 组字提交（IME 的 ＠/【【 在 compositionend 才落定；菜单开着时组好的字进 query）
    function onCompEnd(e) {
      const M = mentionApi();
      if (M && M.isOpen()) { M.handleComposition(e.data); return; }
      maybeMentionTrigger();
    }
    // 行首 markdown：正文块里输入「marker + 空格」→ 转成对应块、清掉 marker。app 改真实 DOM、
    // 存盘读 live DOM，故可原地 turnInto（不像 ui-demo 受控编辑会被 blur 回写打架）。
    function tryMarkdown(e) {
      if (!editingEl || classify(editingEl) !== 'text') return; // 只在正文块（p）触发
      const _txt = editingEl.textContent || '';
      const m = _txt.match(/^(#{1,4}|[-*+]|\d+\.|\[[ xX]?\]|>)[\s ]/);
      if (!m) return;
      const whole = _txt.length === m[0].length; // 整块只有 marker+空格（决定清空 vs 保留后缀）
      // U18/create-7：无论整块还是前缀触发，都只在「刚敲下补全 marker 的那个空格」这一击转换——
      // 绑 inputType，否则「删字后 caret 恰停 marker 末（如『- x』删 x 剩『- 』）」会把段落误转成列表（Notion 只在敲空格那击转）。
      if (!(e && e.inputType === 'insertText' && e.data === ' ')) return;
      // U18 对抗审查（两名 reviewer 独立复现）：inputType 门只证明「敲了空格」，不证明「空格紧邻 marker」。
      // 还须 marker 落在块首文本节点、且 caret 恰停 marker 末——否则：
      // ① 既有段落（磁盘/粘贴的「- 文本」）在任意位置敲空格会被误转、并吞掉 marker；
      // ② 内容裹在行内元素里（<b>…</b>）时 marker 被打进 <b>、firstChild 非文本节点，
      //    下面 else 分支的 innerHTML='' 会清空整块丢内容。这条守卫两者都堵。
      const first0 = editingEl.firstChild;
      const sel0 = doc.getSelection();
      if (!(first0 && first0.nodeType === 3 && sel0 && sel0.anchorNode === first0 && sel0.anchorOffset === m[0].length)) return;
      const t = m[1];
      const key = t[0] === '#' ? ['h1', 'h2', 'h3', 'h4'][t.length - 1]
        : (t === '-' || t === '*' || t === '+') ? 'list'
        : /^\d+\.$/.test(t) ? 'numbered'
        : t[0] === '[' ? 'todo'
        : t === '>' ? 'quote' : null;
      if (!key) return;
      const item = SLASH_ITEMS.find((x) => x.key === key);
      if (!item) return;
      const checked = /^\[[xX]\]$/.test(t); // [x]/[X] → 首项勾选
      const startN = key === 'numbered' ? parseInt(t, 10) : 1;
      if (whole) { editingEl.innerHTML = ''; } // 清 marker（整块仅 marker+空格）
      else { first0.textContent = first0.textContent.slice(m[0].length); } // 前缀：guard 已保证 first0 是块首文本节点，只删其 marker+空格、保留其余（含后续行内元素）
      const conv = turnInto(editingEl, item);
      if (checked) { const li = conv.querySelector('li'); if (li) li.setAttribute('data-checked', 'true'); }
      if (key === 'numbered' && startN > 1 && conv.tagName === 'OL') conv.setAttribute('start', String(startN)); // 非 1 起始序号（校验器不拦 ol[start]）
      enterEdit(conv, { mode: whole ? 'start' : 'end' });
    }
    function closeFmtPops() { fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; }); }
    function onSelectionChange() { closeFmtPops(); positionFmtbar(); refreshRangeSel(); } // 选区一动就收起开着的颜色/转为弹层（防指向旧状态）+ 刷新跨块块级高亮
    function onCompStart() { if (slash) closeSlash(); } // IME 组词开始 → 关斜杠菜单，根除 query/DOM 漂移
    function onScroll() { const a = gutterAnchor(); if (a) positionGrip(a); positionFmtbar(); if (blockMenu.style.display !== 'none') closeBlockMenu(); }

    // grip 交互
    grip.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    // 作用对象一律取 gripEl/gripRow（= 手柄画在谁旁边）。行锚手柄=行作用域；块锚（Esc 灰选/悬停非列表块）=块作用域。
    // openBlockMenu 内部会 selectBlock(gripEl)，于是灰选当场转移到手柄所指的块 —— 对齐 Notion「点手柄 halo 跟着走」。
    grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (gripEl) openBlockMenu(gripEl, gripRow); });
    // U4「+」：作用对象跟手柄同口径（行锚=插同列表新行；块=插空正文块）。⌥ 点击插到上方（对齐 Notion）。
    plus.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }); // 别把焦点/选区从当前块夺走
    plus.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      closeBlockMenu();
      const el = gripEl; if (!el) return;
      const row = gripRow;
      const above = !!e.altKey;
      if (row && row.tagName === 'LI' && classify(el) === 'list' && el.contains(row)) {
        const list = row.parentElement;
        if (list === el) {
          // 顶层行：严格对齐 Notion —— 插普通正文块（中间行则把列表劈开）
          const p = insertParaAtRow(list, row, above);
          enterEdit(p, { mode: 'start' });
          hoverEl = p; hoverRow = null; positionGrip(p);
          openSlash(p, false); // E5：插完立刻弹块类型选择器（Notion 实测同款；typed=false = 块里没有字面「/」）
          return;
        }
        // 嵌套行：**结构性分歧**（非产品选择）——Schema 的 <li> 只许装行内内容或嵌套列表，
        // 段落无法存在于嵌套层；退而插同层新行（最接近的可用行为）。见 todo-list.md 有意分歧。
        const li = doc.createElement('li'); li.appendChild(doc.createElement('br'));
        if (above) row.before(li); else row.after(li);
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        enterEdit(el, { mode: 'start' }); caretAtLiTextEnd(li);
        hoverRow = li; positionGrip(li);
        return;
      }
      const nx = above ? insertBeforeBlock(el, itemByKey('text')) : insertAfter(el, itemByKey('text'));
      enterEdit(nx, { mode: 'start' });
      hoverEl = nx; hoverRow = null; positionGrip(nx);
      openSlash(nx, false); // E5：同上——「+」是全局 gutter 行为，所有块类型旁边点都该弹
    });
    // U2 行级拖拽：行悬停起拖 = 拖单行（dragFrom 可以是 <li>）；块灰选（Esc）优先 = 仍拖整块。
    grip.addEventListener('dragstart', (e) => { if (cellEl) exitCell(); dragFrom = gripRow || gripEl; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'block'); } catch (x) {} if (dragFrom && dragFrom.tagName === 'LI') { try { e.dataTransfer.setDragImage(dragFrom, 12, 12); } catch (x) {} } } }); // 拖块前退出 cell 编辑（镜像摘墙 exitCell），防僵尸编辑态；行拖拽幽灵图=整行
    grip.addEventListener('dragend', () => { dragFrom = null; clearDrop(); });
    // 落点态是三个属性（线 / 缩进量 / 父行高亮），必须一起清——只清一个会留下幽灵高亮或错位的线
    function clearDrop() {
      const p = body.querySelector('[data-ws2-drop]');
      if (p) { p.removeAttribute('data-ws2-drop'); p.removeAttribute('data-ws2-dropindent'); }
      const q = body.querySelector('[data-ws2-dropparent]');
      if (q) q.removeAttribute('data-ws2-dropparent');
    }
    // 修 ED-A5：外部拖放（dragFrom 为空=不是内部块拖拽）一律吞掉，别让浏览器默认 insertFromDrop 把带任意
    // 标签的富 HTML（div/h1/span style/a…）插进 contenteditable → 落盘非合规。粘贴那道「只取纯文本」的闸在
    // drop 路径不存在，这里补上（拖放直接拒绝，用户仍可 Cmd+V 走纯文本粘贴）。
    // ===== 内部富复制粘贴（Wendi bug5①，Colin 2026-07-22 拍板）=====
    // 复制：把选中内容清成「本编辑器自己的、已合规」HTML，打隐形哨兵 data-ws2-clip 进剪贴板。
    // 粘贴：带哨兵 = 本编辑器内部复制的 → **保留格式**（待办/标题/列表/引用 + 行内 B/I/U/链接）；
    //   不带哨兵 = 外部来源（Word/Notion/网页）→ **仍走纯文本兜底**（ED-A4 合规红线，绝不让外部富文本污染文档）。
    // 内部内容粘贴时再过一遍 cleanRoot（与存盘同一套白名单）剥编辑器标记（纵深防御，不盲信剪贴板）。
    const SER_MOD = (typeof WS2Serialize !== 'undefined') ? WS2Serialize
      : (typeof require !== 'undefined' ? require('./serialize.js') : null);
    function cleanInPlace(node) { if (SER_MOD && SER_MOD.cleanRoot) SER_MOD.cleanRoot(node); return node; }
    function cleanClone(node) { return cleanInPlace(node.cloneNode(true)); }
    const CLIP = 'data-ws2-clip';

    function onCopy(e) {
      const cd = e.clipboardData; if (!cd || !cd.setData) return; // 无剪贴板 API → 交原生
      const sel = doc.getSelection();
      // ① 灰选中的不可编辑块（图片等），无文字选区 → 复制该整块
      if ((!sel || sel.isCollapsed) && selectedEl) {
        cd.setData('text/html', '<div ' + CLIP + '="b">' + cleanClone(selectedEl).outerHTML + '</div>');
        cd.setData('text/plain', selectedEl.textContent || '');
        e.preventDefault(); return;
      }
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return; // 无选区 → 交原生
      const r = sel.getRangeAt(0);
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (!sBlk || !eBlk) return; // 落在块外/覆盖层 → 交原生（不接管）
      const norm = (s) => (s || '').replace(/\s+/g, '');
      const sameBlock = sBlk === eBlk;
      // 同表跨格复制（U4/KTD3）：v1 = 纯文本（矩形区域 TSV/子表是后续项）。绝不落行内分支——cloneContents
      // 会带出裸 <tr>/<td> 片段、经 CLIP 粘回产非法结构。同格内选区仍走行内分支（phrasing 安全）。
      if (sameBlock && sBlk.tagName === 'TABLE') {
        const sC3 = cellOfNode(r.startContainer), eC3 = cellOfNode(r.endContainer);
        // 用 range.toString() 不用 sel.toString()——焦点格是 contenteditable 宿主时，selection.toString()
        // 只序列化宿主内的半截（Range 端点本身没被钳制，实测）。
        if (!sC3 || sC3 !== eC3) { cd.setData('text/plain', r.toString() || sel.toString()); e.preventDefault(); return; }
      }
      // 整块判定（选中覆盖了整个块的文字，如选完一整行待办）→ 当块级复制、保留块类型（正是 Wendi 的场景）。
      // TABLE 永不做 wholeBlock 升级：其余格为空时「格内全选」会误判成整表复制，粘贴克隆整表/⌘X 只删字却剪走整表（对抗审查 conf100）
      const wholeBlock = sameBlock && sBlk.tagName !== 'TABLE' && norm(sel.toString()).length > 0 && norm(sel.toString()) === norm(sBlk.textContent);
      // U3/clip-1：同一列表块内跨 li 选区 → 走块级打包（保留待办项类型 + 勾选态），别落行内分支携带裸 <li>。
      // blockOf 把整个 <ul> 当一个块 → 选部分项时 sameBlock && !wholeBlock 会误入行内分支、cloneContents 出裸 li，
      // 粘进段落成 <p>…<li> 非法嵌套、整篇降级、勾选语义丢失。单 li 内选区（sLi===eLi）不进此分支、维持行内。
      if (sameBlock && (sBlk.tagName === 'UL' || sBlk.tagName === 'OL')) {
        const kids = [...sBlk.children].filter((c) => c.tagName === 'LI');
        // 归一到 sBlk 的**直接子** li：选区落在嵌套子项时 closest('li') 取到的是最深 li（不在 kids 里），
        // 直接 indexOf 会得 -1 → kids[-1].cloneNode 抛 TypeError、onCopy 崩、复制静默回落原生丢待办格式。
        const topLiOf = (n) => {
          let li = n && n.nodeType === 1 ? n : (n && n.parentElement);
          li = li && li.closest ? li.closest('li') : null;
          while (li && li.parentElement !== sBlk) { const up = li.parentElement && li.parentElement.closest ? li.parentElement.closest('li') : null; if (!up || up === li) { li = null; break; } li = up; }
          return li;
        };
        // 端点落在 li 边界外（endContainer=ul 本身）→ 回落首/末项。
        const sLi = topLiOf(r.startContainer) || kids[0], eLi = topLiOf(r.endContainer) || kids[kids.length - 1];
        let i = sLi ? kids.indexOf(sLi) : -1, j = eLi ? kids.indexOf(eLi) : -1;
        if (i >= 0 && j >= 0 && sLi !== eLi) { // 都归到顶层 kids 且跨项才走块级；退化情形（i/j=-1，如空列表）安全回落

          if (i > j) { const t = i; i = j; j = t; }
          const listFrag = doc.createElement(sBlk.tagName);
          if (sBlk.className) listFrag.className = sBlk.className;
          for (let k = i; k <= j; k++) listFrag.appendChild(kids[k].cloneNode(true));
          cleanInPlace(listFrag);
          cd.setData('text/html', '<div ' + CLIP + '="b">' + listFrag.outerHTML + '</div>');
          cd.setData('text/plain', sel.toString());
          e.preventDefault(); return;
        }
      }
      if (sameBlock && !wholeBlock) {
        // ② 行内：选一段字 → 保留 B/I/U/S/行内代码/链接/颜色等行内格式。
        // cloneContents 只克隆选中节点：选中「<b> 里的字」时得到纯文本、丢掉 <b> → 把选区逐层裹进它所在的
        // 行内格式祖先(到块为止)，把格式补回来。跨越 <b> 边界的选区 commonAncestor=块，循环不触发、cloneContents 已含 <b>。
        let frag = r.cloneContents();
        const INLINE_FMT = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, CODE: 1, A: 1, MARK: 1, SUB: 1, SUP: 1, SPAN: 1 };
        let anc = r.commonAncestorContainer;
        anc = anc && anc.nodeType === 1 ? anc : (anc && anc.parentElement);
        while (anc && anc !== sBlk && INLINE_FMT[anc.tagName]) { const wrap = anc.cloneNode(false); wrap.appendChild(frag); frag = wrap; anc = anc.parentElement; }
        const w = doc.createElement('span'); w.appendChild(frag); cleanInPlace(w);
        cd.setData('text/html', '<span ' + CLIP + '="i">' + w.innerHTML + '</span>');
        cd.setData('text/plain', sel.toString());
        e.preventDefault(); return;
      }
      // ③ 块级：取选区罩住的**完整**顶层块 i..j（整块，不做部分裁剪 → 每个剪贴板块都是完整合规块）
      const sScope = scopeRootOf(r.startContainer), eScope = scopeRootOf(r.endContainer);
      const crossScope = sScope !== eScope;
      const scopeRoot = crossScope ? blockRoot : sScope;
      const tops = blocksInScope(scopeRoot);
      const sB = crossScope ? topScopeOf(sBlk) : sBlk, eB = crossScope ? topScopeOf(eBlk) : eBlk;
      let i = tops.indexOf(sB), j = tops.indexOf(eB);
      if (i < 0 || j < 0) return;
      if (i > j) { const t = i; i = j; j = t; }
      let html = '';
      for (let k = i; k <= j; k++) html += cleanClone(tops[k]).outerHTML;
      cd.setData('text/html', '<div ' + CLIP + '="b">' + html + '</div>');
      cd.setData('text/plain', sel.toString());
      e.preventDefault();
    }

    // 跨文档粘贴：把待办/callout/toggle 的语义 CSS 注进目标文档 head（否则粘进还没这类块的文档，勾选框/折叠不渲染）。
    function ensurePastedStyles(el) {
      if (!el || el.nodeType !== 1) return;
      const hit = (sel) => (el.matches && el.matches(sel)) || (el.querySelector && el.querySelector(sel));
      if (hit('ul.ws-todo')) ensureTodoStyle();
      if (hit('.ws-callout')) ensureCalloutStyle();
      if (el.tagName === 'DETAILS' || hit('details')) ensureToggleStyle();
      if (hit('[class*="ws-indent-"]')) ensureIndentStyle();
    }

    // 行内富粘贴：把行内 HTML 手动插到光标处（execCommand('insertHTML') 在本 contenteditable 里是哑的 no-op，
    // 实测不插——改手动 range.insertNode，可靠且不会造块嵌套；undo 由调用方 checkpoint 兜）。
    function insertInlineAtCaret(innerHtml) {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const tpl = doc.createElement('template'); tpl.innerHTML = innerHtml;
      // 纵深防御（clip-1）：片段含块级元素 → 绝不行内 range.insertNode（会造 <p><li>/<p><p> 非法嵌套），改走块级。
      // 裸 <li> 先裹进 <ul>（li 不能当顶层块；任一 li 带 data-checked 则视为 ws-todo）。
      if (tpl.content.querySelector('li,ul,ol,p,div,h1,h2,h3,h4,h5,h6,blockquote,details,table,figure,hr')) {
        const kids = [...tpl.content.children].filter((c) => c.nodeType === 1);
        const bareLis = kids.filter((c) => c.tagName === 'LI');
        let blocks = kids;
        if (kids.length && bareLis.length === kids.length) {
          const ul = doc.createElement('ul');
          if (bareLis.some((li) => li.hasAttribute('data-checked'))) ul.className = 'ws-todo';
          kids.forEach((li) => ul.appendChild(li));
          blocks = [ul];
        }
        if (blocks.length) { insertBlocksAtCaret(blocks); return; }
      }
      const r = sel.getRangeAt(0);
      if (!r.collapsed) r.deleteContents();
      const nodes = [...tpl.content.childNodes];
      r.insertNode(tpl.content);
      const lastNode = nodes[nodes.length - 1];
      if (lastNode) { try { const nr = doc.createRange(); nr.setStartAfter(lastNode); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); } catch (x) { /* 光标落点尽力而为 */ } }
    }

    // 块级富粘贴：把完整块序列按已拍板落点插入（Colin 2026-07-22）：
    //   空正文块 → 整块换成粘贴内容；光标块首 → 插在前；块末 → 插在后；块中 → splitBlock 劈开插中间；
    //   灰选中块 → 插其后；无编辑无选中 → 追加末尾。光标落最后一块末尾。
    function insertBlocksAtCaret(blocks) {
      if (!blocks.length) return;
      // U21/clip-4：插入前对每个块（含后代）去重 id——文档中已存在同 id（同文档复制粘贴）或本批次已占用才剥，
      // 跨文档粘贴不撞 id 则保留（护住互链锚点价值）。对齐 splitBlock 剥后块 id 的先例。
      const seenIds = new Set();
      for (const b of blocks) {
        const withId = [];
        if (b.getAttribute && b.getAttribute('id')) withId.push(b);
        if (b.querySelectorAll) withId.push(...b.querySelectorAll('[id]'));
        for (const el of withId) {
          const id = el.getAttribute('id');
          if (!id) continue;
          if (doc.getElementById(id) || seenIds.has(id)) el.removeAttribute('id');
          else seenIds.add(id);
        }
      }
      blocks.forEach(ensurePastedStyles);
      const last = blocks[blocks.length - 1];
      const frag = doc.createDocumentFragment();
      blocks.forEach((b) => frag.appendChild(b));
      if (editingEl && classify(editingEl) === 'text' && (editingEl.textContent || '').trim() === '') {
        const host = editingEl; exitEdit(); host.replaceWith(frag); // 空正文块整块替换（不留空行，对齐 Notion）
      } else if (editingEl) {
        if (isCaretAtStart(doc, editingEl)) editingEl.before(frag);
        else if (isCaretAtRealEnd(doc, editingEl)) editingEl.after(frag);
        else { const beforeHalf = editingEl; if (splitBlock()) beforeHalf.after(frag); else beforeHalf.after(frag); } // 块中：劈开，插在前半之后（=后半之前）
      } else if (selectedEl) { selectedEl.after(frag); }
      else { blockRoot.appendChild(frag); }
      if (last && last.isConnected) { if (isEditableEl(last)) enterEdit(last, { mode: 'end' }); else selectBlock(last); }
    }

    // 修 ED-A4：粘贴只取纯文本，且多行文本自己按 \n 劈成同类型兄弟块——不交给 execCommand 处理换行。
    // 原来 shell 的 paste 用 execCommand('insertText', 带换行的文本)：Chromium 会把 \n 转成段落切分、
    // 在标题块里塞 <p>（<h2><p>..</p></h2>），reparse 后原样保留 → 持久非合规；段落块里也多出垃圾空 <p> + 活 DOM/磁盘分叉。
    function onPaste(e) {
      // cell 上下文输入闸（U4/KTD5）：一切粘贴形态压成单行纯文本落格（cell phrasing-only 红线；多行 join(' ')
      // = SUMMARY 守卫同款；内部富 clip 也走 text/plain = 压 textContent）；纯图剪贴板拒收 + 可感知提示
      //（Colin 拍板 2026-08-03）。放在最前——cell 态绝不允许流进块级/行内富粘贴管线。
      if (cellEl && cellEl.isConnected) {
        e.preventDefault();
        const cd0 = e.clipboardData || (typeof window !== 'undefined' && window.clipboardData);
        const t0 = cd0 && cd0.getData ? cd0.getData('text/plain') : '';
        const lines0 = String(t0 || '').replace(/\r\n?/g, '\n').split('\n');
        if (String(t0 || '').trim()) {
          doc.execCommand('insertText', false, lines0.join(' '));
          if (undoMgr) undoMgr.scheduleCheckpoint();
          markDirty();
          return;
        }
        // html-only 剪贴板（有些来源只给 text/html 不给 text/plain）→ 取纯文本兜底压单行；真没有文字才算拒收
        const h0 = cd0 && cd0.getData ? cd0.getData('text/html') : '';
        if (String(h0 || '').trim()) {
          const tpl0 = doc.createElement('template'); tpl0.innerHTML = h0;
          const flat0 = (tpl0.content.textContent || '').replace(/\s+/g, ' ').trim();
          if (flat0) { doc.execCommand('insertText', false, flat0); if (undoMgr) undoMgr.scheduleCheckpoint(); markDirty(); return; }
        }
        let hasFile = false;
        if (cd0 && cd0.items) { for (const it of cd0.items) { if (it.kind === 'file') { hasFile = true; break; } } }
        if (!hasFile && cd0 && II) hasFile = II.pickImageFiles(cd0).length > 0;
        if (hasFile || String(h0 || '').trim()) showCellNope(cellEl); // 有货但放不进（图片/纯标记 HTML）——可感知拒收，绝不静默
        return;
      }
      // 内部富粘贴优先：剪贴板 HTML 带本编辑器哨兵 → 保留格式（外部无哨兵的 HTML 一律不走这、落纯文本兜底）。
      const richHtml = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData('text/html') : '';
      if (richHtml && richHtml.indexOf(CLIP) !== -1) {
        const tpl = doc.createElement('template'); tpl.innerHTML = richHtml;
        const clip = tpl.content.querySelector('[' + CLIP + ']');
        if (clip) {
          e.preventDefault();
          const mode = clip.getAttribute(CLIP); // 先读哨兵值,再清——cleanInPlace 会把 data-ws2-clip 本身剥掉
          cleanInPlace(clip); // 纵深防御：再按存盘白名单剥一遍编辑器标记（含哨兵）
          if (mode === 'i' && editingEl && editingEl.tagName !== 'DETAILS') {
            insertInlineAtCaret(clip.innerHTML);
          } else {
            const blocks = [...clip.children].filter((c) => c.nodeType === 1);
            // U3/clip-1：单一列表包粘进**同类**列表编辑态 → 逐项并入当前 li 之后（保留 data-checked），
            // 别走 insertBlocksAtCaret（它对列表目标会 splitBlock 劈出 2-3 个相邻 ul，违反 bug2「绝不建新 ul」）。
            // 类型必须一致（tag + ws-todo 与否）：否则 ws-todo 项并进普通 ul 会留下不渲染的死 data-checked、
            // ol 项并进 todo 丢编号语义——跨类型改走块级插入（自成一块，保住各自语义）。
            let merged = false;
            const bt = blocks.length === 1 ? blocks[0] : null;
            const sameListType = bt && editingEl && editingEl.tagName === bt.tagName && editingEl.classList.contains('ws-todo') === bt.classList.contains('ws-todo');
            if (bt && (bt.tagName === 'UL' || bt.tagName === 'OL') && editingEl && classify(editingEl) === 'list' && sameListType) {
              const s1 = doc.getSelection();
              const n1 = s1 && s1.anchorNode ? (s1.anchorNode.nodeType === 1 ? s1.anchorNode : s1.anchorNode.parentElement) : null;
              let li = n1 && n1.closest ? n1.closest('li') : null;
              const srcLis = [...blocks[0].children].filter((c) => c.tagName === 'LI');
              if (li && editingEl.contains(li) && srcLis.length) {
                for (const sLi of srcLis) { li.after(sLi); li = sLi; }
                ensurePastedStyles(editingEl);
                const rr = doc.createRange(); rr.selectNodeContents(li); rr.collapse(false);
                s1.removeAllRanges(); s1.addRange(rr);
                merged = true;
              }
            }
            if (merged) { /* 已逐项并入当前列表 */ }
            else if (blocks.length) insertBlocksAtCaret(blocks);
            else if (editingEl) insertInlineAtCaret(clip.innerHTML); // 行内哨兵但非编辑态兜底
          }
          if (undoMgr) undoMgr.checkpoint();
          markDirty();
          return;
        }
      }
      const cd = e.clipboardData || (typeof window !== 'undefined' && window.clipboardData);
      const text = cd && cd.getData ? cd.getData('text/plain') : '';
      // 文本优先（已拍板①）：有可用文本 → 走下面纯文本粘贴不变；仅当无文本时才收图片（纯图剪贴板）。
      // 纯图常只在 cd.items 暴露、不在 cd.files，故 items 兜底不能省。
      if (!String(text || '').trim() && cd && II) {
        let files = II.pickImageFiles(cd);
        if (!files.length && cd.items) {
          for (const it of cd.items) { if (it.kind === 'file') { const f = it.getAsFile(); if (f && II.acceptsImageType(f.type)) files.push(f); } }
        }
        if (files.length) {
          e.preventDefault();
          const anchor = editingEl || selectedEl || null;
          const replaceEmpty = !!anchor && isEditableEl(anchor) && classify(anchor) === 'text' && (anchor.textContent || '').trim() === '';
          insertImages(files, anchor, replaceEmpty);
          return;
        }
      }
      e.preventDefault();
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      // U22/clip-5 扩展：单行也走 todo 识别——只有「单行且**不是** todo marker」才走字面文本早返回；
      // 单行 `- [ ] x` / `- [x] x` 落到下面 U22 判断里转成待办（对齐打字 markdown 快捷键的直觉）。
      if (lines.length <= 1 && !/^- \[( |x|X)\] /.test(lines[0] || '')) { doc.execCommand('insertText', false, lines[0] || ''); return; }
      // bug2：无编辑目标（灰选 / 光标在块内但未 enterEdit）时先进编辑，别直接 lines.join(' ') 把多行拼成一行。
      if (!editingEl) {
        const s0 = doc.getSelection();
        const fromSel = s0 && s0.anchorNode ? blockOf(s0.anchorNode) : null;
        const tgt = (selectedEl && isEditableEl(selectedEl) && selectedEl) || (fromSel && isEditableEl(fromSel) && fromSel) || null;
        if (tgt) enterEdit(tgt, { mode: 'end' });
      }
      // 实在无块可放（无光标）/ summary（放不下块，多行会劈出第二个 summary → 非合规）→ 只能合成单行。U13。
      if (!editingEl || editingEl.tagName === 'SUMMARY') { doc.execCommand('insertText', false, lines.join(' ')); return; }
      // U22/clip-5：外部纯文本多行**全部非空行**都匹配「- [ ] / - [x] 」→ 识别成 todo（只认纯文本模式、不引入外部富 HTML，
      // 不违反 ED-A4）。任一行不匹配 → 整段回落既有纯文本粘贴（不做混合解析）。目标是**普通** bullet/numbered 列表则维持字面（本轮不扩）。
      {
        const TODO_LINE = /^- \[( |x|X)\] (.*)$/;
        const nonEmpty = lines.filter((l) => l.trim() !== '');
        if (nonEmpty.length && nonEmpty.every((l) => TODO_LINE.test(l))) {
          const isList = classify(editingEl) === 'list';
          const isTodo = isList && editingEl.classList.contains('ws-todo');
          if (!isList || isTodo) {
            const items = nonEmpty.map((l) => { const m = l.match(TODO_LINE); return { checked: /[xX]/.test(m[1]), text: m[2] }; });
            const mkLi = (it) => { const li = doc.createElement('li'); if (it.text) li.textContent = it.text; if (it.checked) li.setAttribute('data-checked', 'true'); if (!li.firstChild) li.appendChild(doc.createElement('br')); return li; };
            if (isTodo) { // 目标 todo 列表：逐行建 li 追加到当前 li 之后，仍单个 ul
              const s1 = doc.getSelection();
              const n1 = s1 && s1.anchorNode ? (s1.anchorNode.nodeType === 1 ? s1.anchorNode : s1.anchorNode.parentElement) : null;
              let li = n1 && n1.closest ? n1.closest('li') : null;
              if (li && editingEl.contains(li)) {
                // 对抗审查：目标 li 为空（刚建的 todo 就一个空项）→ 首个 item 就地填入、不留空 checkbox 行
                // （对齐 insertBlocksAtCaret「空块整块替换、不留空行」原则）；非空则全部追加到其后（既有行为）。
                let idx = 0;
                if (!(li.textContent || '').trim() && !li.querySelector('img,figure,hr,input')) {
                  while (li.firstChild) li.removeChild(li.firstChild);
                  if (items[0].text) li.appendChild(doc.createTextNode(items[0].text));
                  if (items[0].checked) li.setAttribute('data-checked', 'true'); else li.removeAttribute('data-checked');
                  if (!li.firstChild) li.appendChild(doc.createElement('br'));
                  idx = 1;
                }
                for (let k = idx; k < items.length; k++) { const nli = mkLi(items[k]); li.after(nli); li = nli; }
                const r = doc.createRange(); r.selectNodeContents(li); r.collapse(false); s1.removeAllRanges(); s1.addRange(r);
                ensureTodoStyle(); if (undoMgr) undoMgr.checkpoint(); markDirty(); return;
              }
            }
            const ul = doc.createElement('ul'); ul.className = 'ws-todo'; // 非列表目标：构造 ws-todo 块插入
            items.forEach((it) => ul.appendChild(mkLi(it)));
            ensureTodoStyle();
            insertBlocksAtCaret([ul]);
            if (undoMgr) undoMgr.checkpoint(); markDirty(); return;
          }
        }
      }
      // bug2 列表：每行一个新 <li>（同一 ul 内、继承 li 类型），绝不建新 <ul>、绝不丢行。
      // （通用 splitBlock 按 editingEl.tagName=UL 建块 → 会造出新 <ul> 且后续行灌进空 ul 丢失，multi-bullet 并成一行。）
      if (classify(editingEl) === 'list') {
        const s1 = doc.getSelection();
        const n1 = s1 && s1.anchorNode ? (s1.anchorNode.nodeType === 1 ? s1.anchorNode : s1.anchorNode.parentElement) : null;
        let li = n1 && n1.closest ? n1.closest('li') : null;
        if (li && editingEl.contains(li)) {
          doc.execCommand('insertText', false, lines[0]); // 第一行接当前 li（尊重光标处）
          for (let i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue; const nli = doc.createElement('li'); nli.textContent = lines[i]; li.after(nli); li = nli; } // 跳过空行/结尾换行：绝不建悬空空 <li>（无文字→点不进删不掉，回归 bug）
          const r = doc.createRange(); r.selectNodeContents(li); r.collapse(false); // 光标落最后一个新 li 末尾
          const s2 = doc.getSelection(); s2.removeAllRanges(); s2.addRange(r);
          if (undoMgr) undoMgr.checkpoint(); markDirty();
          return;
        }
      }
      doc.execCommand('insertText', false, lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (splitBlock()) { if (lines[i]) doc.execCommand('insertText', false, lines[i]); } // splitBlock 劈出同类型新块（不嵌套）+ 光标移到新块首
        else if (lines[i]) doc.execCommand('insertText', false, ' ' + lines[i]);
      }
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
    }
    // ---- U2 行级拖拽（plan 2026-08-03-002）----
    const isRowDrag = () => !!(dragFrom && dragFrom.tagName === 'LI');
    // 同类列表判定：标签一致 + todo 语义一致。
    const sameListType = (a, b) => !!a && !!b && a.tagName === b.tagName && a.classList.contains('ws-todo') === b.classList.contains('ws-todo');

    // ---- E3/E4：跨类型落点 + 落点横向偏移决定嵌套层级（对拍实证 2026-08-04）----
    // Notion 实测三条（每条都真拖过、看过落点指示线）：
    //  ① **跨类型允许且被拖的行类型不变**——圆点行拖进待办列表仍是圆点行（Notion 每块自带类型、没有列表容器）。
    //     我们是 <ul> 容器模型 → 要保住类型只能**在落点把目标列表劈开**，插一张源类型的列表。视觉终态与 Notion 一致。
    //  ② **缩进层级由落点的 x 决定，参照系是【页面内容列左缘】**（= 顶层段落文字左缘），不是列表行文字左缘。
    //     实测：落在内容列左缘 → 兄弟（depth 0）；右移 28px → 成为上一行的子项。约 26px 一级。
    //  ③ **层级被「上一行深度 + 1」钳死**——落点右移 220px（理论 8 级）实测仍只嵌一级。
    // 缩进步长 = **我们自己**每级的实际缩进（`:where(ul,ol){padding-left:1.7em}` = 27.2px）。
    // ⚠ 别直接抄 Notion 的 26：那是 Notion 自己版式下的数，拿来当我们的步长会让指示线逐级偏移
    //（5 级时差 6px，发版把关 W-5 实测）。语义仍是「右移一格 = 深一层」，与 Notion 一致。
    const WS2_INDENT_UNIT = 27.2;
    // 内容列左缘：顶层块（段落）的文字起点。取 blockRoot 的内容盒左缘，与段落渲染同源。
    function contentLeft() {
      const r = blockRoot.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(blockRoot).paddingLeft) || 0;
      return r.left + pad;
    }
    // 行深度：从该 li 往上数到它所属的**顶层**列表为止（顶层行=0）
    function rowDepth(li) {
      let d = 0;
      for (let p = li.parentElement; p && p !== blockRoot; p = p.parentElement) {
        if (p.tagName === 'LI') d++;
      }
      return d;
    }
    // 落点解析：给定指针位置，算出「线画在哪一行的上/下」「锚行（线上方那一行）」「目标深度」。
    // 锚行为 null（落在整个列表最前面）时深度恒 0。
    function resolveDrop(e, listEl) {
      const tr = rowOf(e.target, listEl, e.clientY);
      if (!tr || tr === dragFrom || (dragFrom.contains && dragFrom.contains(tr))) return null;
      const r = tr.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      // 线上方那一行：落在 tr 下半区 → 就是 tr；落在上半区 → 视觉顺序上 tr 的前一行
      let anchor = tr;
      if (before) {
        const rows = [...listEl.querySelectorAll('li')].filter((x) => x !== dragFrom && !(dragFrom.contains && dragFrom.contains(x)));
        const i = rows.indexOf(tr);
        anchor = i > 0 ? rows[i - 1] : null;
      }
      const maxDepth = anchor ? rowDepth(anchor) + 1 : 0;
      // **下钳**（对抗审查 ADV-5）：只上钳不够——指针再往左 depth 都能取到 0，哪怕线正画在一堆嵌套
      // 子行中间。那样「画的和做的」在退级方向就不一致了：线画在 C1 与 C2 之间，行却落到整棵子树之后。
      // 合法区间是 [线下方那一行的深度, 锚行深度+1]（与 Notion 一致）——比下方那行还浅，会把它孤儿化。
      const want0 = (ev) => Math.round((ev.clientX - contentLeft()) / WS2_INDENT_UNIT);
      const rows = [...listEl.querySelectorAll('li')].filter((x) => x !== dragFrom && !(dragFrom.contains && dragFrom.contains(x)));
      const idx = rows.indexOf(tr);
      const below = before ? tr : (idx >= 0 && idx + 1 < rows.length ? rows[idx + 1] : null);
      const minDepth = Math.min(below ? rowDepth(below) : 0, maxDepth); // 防御：min 不得超过 max
      const depth = Math.max(minDepth, Math.min(want0(e), maxDepth));
      return { tr, before, anchor, depth };
    }
    // 把 row 放进 destList 的指定位置；destList 与 row 源类型不同 → **在落点劈开 destList**，
    // 插一张源类型的单行列表（Notion「类型不变」在容器模型下的等价实现）。
    function placeRow(destList, refLi, after, row, srcList) {
      if (sameListType(destList, srcList)) {
        if (!refLi) destList.insertBefore(row, destList.firstChild);
        else if (after) refLi.after(row); else refLi.before(row);
        return;
      }
      const kids = [...destList.children].filter((c) => c.tagName === 'LI');
      const cut = refLi ? kids.indexOf(refLi) + (after ? 1 : 0) : 0;
      const tail = kids.slice(cut);
      const nl = doc.createElement(srcList.tagName);
      if (srcList.className) nl.className = srcList.className;
      nl.appendChild(row);
      if (cut === 0) destList.before(nl);
      else if (!tail.length) destList.after(nl);
      else {
        const rest = doc.createElement(destList.tagName);
        if (destList.className) rest.className = destList.className;
        tail.forEach((li) => rest.appendChild(li));
        destList.after(nl); nl.after(rest);
      }
    }
    // 按解析出的深度落位。depth > 锚行深度 → 成为锚行的首个子项（没有子列表就建一张源类型的）；
    // depth === 锚行深度 → 锚行的下一个兄弟；depth < 锚行深度 → 上溯到该深度的祖先行、插在它之后。
    function dropAtDepth(d, row, srcList) {
      if (!d.anchor) { placeRow(d.tr.parentElement, d.tr, false, row, srcList); return; }
      const ad = rowDepth(d.anchor);
      if (d.depth > ad) {
        let sub = d.anchor.querySelector(':scope > ul, :scope > ol');
        if (sub && sameListType(sub, srcList)) { sub.insertBefore(row, sub.firstChild); return; }
        const nl = doc.createElement(srcList.tagName);
        if (srcList.className) nl.className = srcList.className;
        nl.appendChild(row);
        if (sub) sub.before(nl); else d.anchor.appendChild(nl); // 已有异类子列表 → 并排放一张（li 允许多个子列表）
        return;
      }
      let ref = d.anchor;
      for (let k = ad; k > d.depth; k--) { const host = ref.parentElement && ref.parentElement.parentElement; if (host && host.tagName === 'LI') ref = host; else break; }
      placeRow(ref.parentElement, ref, true, row, srcList);
    }
    // 行拖拽 dragover：指示线亮在目标行上/下半区，并把**目标缩进量**写进 --ws2-drop-indent（对齐 Notion：
    // 线的左端随缩进右移、末端带一个圆点标层级）。目标是非列表块 → 指示线亮块上/下（drop = 拆出成单行列表）。
    function rowDragOver(e) {
      clearDrop();
      const el = blockOf(e.target);
      if (!el || el === dragFrom || (dragFrom.contains && dragFrom.contains(el))) return;
      if (classify(el) === 'list') {
        const d = resolveDrop(e, el);
        if (!d) return;
        d.tr.setAttribute('data-ws2-drop', d.before ? 'top' : 'bottom');
        // 线画在 tr 的边上，但缩进要表达的是【目标深度】——所以偏移量是「目标深度 − tr 自身深度」，
        // 单位跟落点解析同一个常量（改一处必改另一处，否则画的和落的对不上）。
        const rel = d.depth - rowDepth(d.tr);
        if (rel) d.tr.setAttribute('data-ws2-dropindent', String(Math.max(-8, Math.min(8, rel)))); // 表扩到 ±8（原 ±5：≥6 层嵌套时线画得比实际落位浅，发版把关 W-6）
        if (d.anchor && d.depth > rowDepth(d.anchor)) d.anchor.setAttribute('data-ws2-dropparent', '');
      } else {
        const r = el.getBoundingClientRect();
        el.setAttribute('data-ws2-drop', e.clientY < r.top + r.height / 2 ? 'top' : 'bottom');
      }
    }
    // 行拖拽 drop：①落进列表 → 按解析出的深度落位（含跨类型劈开、含嵌套）；②非列表块旁 → 拆出成同类型单行列表块；
    // 无效目标（自子树/落回自己）→ 零变更零 checkpoint。挪走后源列表掏空 → 移除
    //（嵌套 ul 移除保宿主 li；toggle 体内列表移除后体空 → 补空 p 保 ≥1 体块铁则）。
    function rowDrop(e) {
      const el = blockOf(e.target);
      if (!el || el === dragFrom || (dragFrom.contains && dragFrom.contains(el))) return;
      const srcList = dragFrom.parentElement;
      const srcScope = scopeRootOf(srcList);
      let moved = false;
      if (classify(el) === 'list') {
        const d = resolveDrop(e, el);
        if (d) { dropAtDepth(d, dragFrom, srcList); moved = true; }
      } else {
        const nl = doc.createElement(srcList.tagName);
        if (srcList.className) nl.className = srcList.className;
        nl.appendChild(dragFrom);
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) el.before(nl); else el.after(nl);
        moved = true;
      }
      if (!moved) return;
      if (srcList !== dragFrom.parentElement && !srcList.querySelector('li')) {
        srcList.remove();
        if (srcScope !== blockRoot && blocksInScope(srcScope).length === 0) srcScope.appendChild(doc.createElement('p'));
      }
      hoverEl = blockOf(dragFrom); hoverRow = dragFrom; positionGrip(dragFrom);
      if (undoMgr) undoMgr.checkpoint();
      markDirty();
    }
    function draggingFile() { return (typeof global !== 'undefined' && global.__wsDragFile) || null; }
    const dtHasFiles = (dt) => !!dt && !!dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
    function onDragOver(e) {
      if (!dragFrom && draggingFile()) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'; return; } // U3-B6：侧栏文件拖进来 → 接受、dropEffect link
      // OS 图片文件拖入（doc-images）：dragover 阶段读不到 MIME、只看得到 'Files'，先放行；drop 时按白名单过滤。
      if (!dragFrom && dtHasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }
      if (!dragFrom) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault();
      if (isRowDrag()) { rowDragOver(e); return; } // U2：行拖拽走行级指示线
      const el = blockOf(e.target); if (!el || el === dragFrom) return; clearDrop(); el.setAttribute('data-ws2-drop', el.compareDocumentPosition(dragFrom) & Node.DOCUMENT_POSITION_PRECEDING ? 'bottom' : 'top');
    }
    function onDrop(e) {
      const f = draggingFile();
      if (!dragFrom && f) { e.preventDefault(); dropFileLink(e, f); if (typeof global !== 'undefined') global.__wsDragFile = null; return; } // U3-B6：插链接，用完清全局
      // OS 文件拖入（doc-images）：图片 → 摄入插块；非图片文件维持拒绝但要说出来（别静默）。
      if (!dragFrom && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        const imgs = II ? II.pickImageFiles(e.dataTransfer) : [];
        if (!imgs.length) { if (global.__wsToast) global.__wsToast(T('editor.dropImagesOnly')); return; }
        insertImages(imgs, dropAnchor(e.clientY), false);
        return;
      }
      if (!dragFrom) { e.preventDefault(); return; }
      e.preventDefault();
      if (isRowDrag()) { rowDrop(e); clearDrop(); dragFrom = null; return; } // U2：行拖拽
      const el = blockOf(e.target); // scoped：落在 toggle 体内块 → el 是体内块，.before/.after 落体内（进/出/内自动获得，U8/R6）
      // 自嵌守卫：details 不能拖进自己的体（无限嵌套）。
      if (el && el !== dragFrom && !(dragFrom.contains && dragFrom.contains(el))) {
        const srcScope = scopeRootOf(dragFrom); // 源作用域（判拖出后 ≥1 体块铁则）
        const before = el.compareDocumentPosition(dragFrom) & Node.DOCUMENT_POSITION_PRECEDING;
        if (before) el.after(dragFrom); else el.before(dragFrom);
        if (srcScope !== blockRoot && srcScope !== scopeRootOf(dragFrom) && blocksInScope(srcScope).length === 0) srcScope.appendChild(doc.createElement('p')); // 拖出后源 toggle 空了 → 补空 p
        if (undoMgr) undoMgr.checkpoint(); markDirty();
      }
      clearDrop(); dragFrom = null;
    }
    // U3-B6：把侧栏拖来的文件插成链接。落点=drop 处 caret；落在装饰/空白/边距 → 最近可编辑块末尾兜底
    //（静默失败 = 用户以为没做出来，L8）；跨根/无身份/自链 → 明确 toast，绝不静默。
    function dropFileLink(e, file) {
      const ctx = docCtx();
      if (!ctx || ctx.rootId == null) { if (global.__wsToast) global.__wsToast(T('editor.linkUnsupportedTempDoc')); return; }
      const crossRoot = file.rootId !== ctx.rootId; // B：跨文件夹空间拖入 → relHrefAbs（同卷才建）
      if (!crossRoot && file.rel === ctx.rel) { if (global.__wsToast) global.__wsToast(T('editor.linkSelfNotAllowed')); return; }
      let range = caretRangeAtPoint(doc, e.clientX, e.clientY);
      let host = range && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
      let blk = host ? blockOf(host) : null;
      if (!blk || !isEditableEl(blk)) {
        let best = null;
        for (const b of topBlocks()) {
          if (!isEditableEl(b)) continue;
          const r = b.getBoundingClientRect();
          const dist = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
          if (!best || dist < best.dist) best = { b, dist };
        }
        if (!best) { if (global.__wsToast) global.__wsToast(T('editor.noTextBlockForLink')); return; }
        blk = best.b;
        range = doc.createRange(); range.selectNodeContents(blk); range.collapse(false); // 落到块末
      }
      // 别把 <a> 插成 <ul>/<ol> 直接子级（= 非合规结构 → 整篇降级基础编辑，审查 #4）：落点直接落在列表层时收敛到最后一个 <li> 末尾。
      const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      if (startEl && (startEl.tagName === 'UL' || startEl.tagName === 'OL')) {
        const lis = startEl.querySelectorAll(':scope > li');
        const li = lis.length ? lis[lis.length - 1] : null;
        if (li) { range = doc.createRange(); range.selectNodeContents(li); range.collapse(false); }
      }
      const label = (file.title || file.rel).replace(/\.[^.]+$/, ''); // 文件名去扩展当链接文字
      const insertAt = (href) => { // 落点已定；href 算好（同根同步 / 跨根异步）后插入
        const a = doc.createElement('a');
        a.setAttribute('href', href); // 纯净：只有 href
        a.textContent = label;
        range.insertNode(a);
        const space = doc.createTextNode(' '); a.parentNode.insertBefore(space, a.nextSibling);
        const after = doc.createRange(); after.setStartAfter(space); after.collapse(true);
        const sel = doc.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(after); }
        markDirty(); if (undoMgr) undoMgr.checkpoint();
      };
      if (!crossRoot) { insertAt(global.WS2Links.relHref(ctx.rel, file.rel)); return; }
      // 跨根（B）：同卷才建；两端 abs 经 wsAbs 取 → relHrefAbs
      Promise.resolve(global.ws2.wsSameVolume ? global.ws2.wsSameVolume(ctx.rootId, file.rootId) : true).then((ok) => {
        if (!ok) { if (global.__wsToast) global.__wsToast(T('editor.crossVolumeUnsupported')); return; }
        return Promise.all([global.ws2.wsAbs(ctx.rootId, ctx.rel), global.ws2.wsAbs(file.rootId, file.rel)]).then((ab) => {
          const href = (ab[0] && ab[1]) ? global.WS2Links.relHrefAbs(ab[0], ab[1]) : null;
          if (!href) { if (global.__wsToast) global.__wsToast(T('editor.crossRootLinkFailed')); return; }
          insertAt(href);
        });
      }).catch(() => {});
    }

    buildFmtbar();
    doc.addEventListener('mousedown', onMouseDown, true);
    try { refreshToggleEmpty(); } catch (x) {} // attach 期先算一次（打开就带空 toggle 的文档，P3-7）
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('click', onClick);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('input', onInput);
    doc.addEventListener('selectionchange', onSelectionChange);
    doc.addEventListener('compositionstart', onCompStart);
    doc.addEventListener('compositionend', onCompEnd);
    doc.addEventListener('scroll', onScroll, true);
    doc.addEventListener('dragover', onDragOver);
    doc.addEventListener('drop', onDrop);
    doc.addEventListener('paste', onPaste);
    doc.addEventListener('copy', onCopy); // 内部富复制：⌘C 写带哨兵的干净 HTML（⌘X 走 keydown 里的 execCommand('copy') 也经此）
    doc.addEventListener('toggle', onToggle, true); // 折叠事件不冒泡→捕获相 + 委托 doc（撑过 innerHTML 重写/嵌套/后加 toggle）
    doc.documentElement.addEventListener('mouseleave', onDocLeave);

    function detach() {
      live = false; // 停掉 in-flight 图片摄入的插入（见 insertImages）
      exitCell(); // 别把 cell 编辑态属性留给下个文档
      if (captionEl) { captionEl.removeAttribute('contenteditable'); captionEl.removeAttribute('data-ws2-ce'); captionEl = null; } // 别把编辑态属性留给下个文档
      doc.documentElement.removeEventListener('mouseleave', onDocLeave);
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseup', onMouseUp);
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('input', onInput);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('compositionstart', onCompStart);
      doc.removeEventListener('scroll', onScroll, true);
      doc.removeEventListener('dragover', onDragOver);
      doc.removeEventListener('drop', onDrop);
      doc.removeEventListener('paste', onPaste);
      doc.removeEventListener('copy', onCopy);
      doc.removeEventListener('toggle', onToggle, true);
      exitEdit();
      if (cellNopeTimer) { global.clearTimeout(cellNopeTimer); cellNopeTimer = null; }
      try { closeSlash(); } catch (x) {} // 卸载前清掉选择器态：只 remove 覆盖层不清 data-ws2-picking，切文档时若还要存一次盘就漏（ADV-2）
      [grip, fmtbar, blockMenu, slashMenu, cellNope].forEach((n) => n.remove());
    }

    // 撤销/重做后 body.innerHTML 被整体重写，旧的元素引用全失效 → 清空状态、收起所有覆盖层。
    function reset() {
      closeSlash();
      editingEl = null; selectedEl = null; hoverEl = null; hoverRow = null; menuRow = null; dragFrom = null; fmtShown = false; captionEl = null; cellEl = null; // undo/redo 重写 body → 旧 figcaption/cell 引用失效
      body.querySelectorAll('[data-ws2-cell]').forEach((el) => el.removeAttribute('data-ws2-cell')); // 快照经 cleanedBodyHtml 已剥，此为兜底
      blockRoot = pickBlockRoot(body); // undo/redo 重写了 body.innerHTML、重建了包裹节点 → 旧引用失效，重算
      blockRoot.setAttribute('data-ws2-root', ''); // 重算后块容器换了节点，重新打标（空块占高度用，非装饰）
      const s = body.querySelector('[data-ws2-selected]'); if (s) s.removeAttribute('data-ws2-selected');
      const d = body.querySelector('[data-ws2-drop]'); if (d) d.removeAttribute('data-ws2-drop');
      rangeSelEls = []; body.querySelectorAll('[data-ws2-rangesel]').forEach((el) => el.removeAttribute('data-ws2-rangesel')); // undo/redo 重写 body → 旧引用失效,按属性清
      setGutterVisible(false); fmtbar.style.display = 'none'; closeBlockMenu();
    }

    // U8/clip-3：undo/redo 用 body.innerHTML 整体重写、正在编辑的块被销毁、焦点回落非可编辑 BODY →
    // 后续打字无宿主被静默吞。runUndoRedo 在重写**前** snapshotEdit 记录编辑块结构路径，reset 后 restoreEdit
    // 按同路径在新 body 里重进编辑（mode:'end'）。光标精确位置不还原（v1 取舍）。
    function blockPathOf(el) {
      const path = []; let n = el;
      while (n && n !== body) { const p = n.parentNode; if (!p) return null; path.unshift(Array.prototype.indexOf.call(p.children, n)); n = p; }
      return n === body ? path : null;
    }
    function snapshotEdit() {
      if (cellEl) return { path: blockPathOf(cellEl), id: cellEl.id || null, kind: 'cell' }; // U7：cell 编辑态也入快照——undo 重写后按路径回原格
      return editingEl ? { path: blockPathOf(editingEl), id: editingEl.id || null } : null;
    }
    function restoreEdit(snap) {
      // U7：cell 编辑态恢复（对抗审查 correctness+julik 交叉印证）——undo/redo 重写 body 后按 id/结构路径重新
      // 定位原格 enterCell（光标落格末；精确位置不还原沿用全局 v1 取舍）。格已被撤没 → 走下面通用兜底。
      if (snap && snap.kind === 'cell') {
        let n = null;
        if (snap.id) { const byId = doc.getElementById(snap.id); if (byId && body.contains(byId)) n = byId; }
        if (!n && snap.path) { let m = body; for (const i of snap.path) { if (!m || !m.children || i < 0 || i >= m.children.length) { m = null; break; } m = m.children[i]; } n = m; }
        if (n && (n.tagName === 'TD' || n.tagName === 'TH')) {
          const b = blockOf(n);
          if (b && classify(b) === 'table') { enterCell(n, { mode: 'end' }); return; }
        }
      }
      let target = null;
      // ① 优先按 id 精确找：锚点块（有 id）跨 body.innerHTML 重写稳定，避开「pre-undo 下标套 post-undo 树 → 落无关块」（对抗审查 P2）。
      if (snap && snap.id) { const byId = doc.getElementById(snap.id); if (byId && body.contains(byId) && isEditableEl(byId)) target = byId; }
      // ② 退结构路径（无 id 时）：仍是 v1 取舍——编辑块上方结构变动时同一下标语义已变、可能落相邻块，见 spec 欠账。
      if (!target && snap && snap.path) { let n = body; for (const i of snap.path) { if (!n || !n.children || i < 0 || i >= n.children.length) { n = null; break; } n = n.children[i]; } if (n && isEditableEl(n)) target = n; }
      // ③ 兜底：首个可编辑块，保证打字有宿主（绝不落非可编辑 body/hr/figure/details → 吞字）。
      if (!target) target = topBlocks().find((b) => isEditableEl(b)) || null;
      if (target) enterEdit(target, { mode: 'end' });
    }

    // reposition：缩放/窗口尺寸变后重定位手柄+气泡。编辑态 selectedEl=null、当前块在 hoverEl，故跟 onScroll 一样
    // 用 hoverEl 兜底（否则编辑中缩放，手柄会漂在缩放前的旧坐标）。
    return { detach, reset, deselect, snapshotEdit, restoreEdit, reposition: () => { if (selectedEl) positionGrip(selectedEl); else if (hoverEl) positionGrip(hoverEl); positionFmtbar(); } };
  }

  // ===== 注入到 iframe 的编辑器样式（ui-demo Canvas.css 移植；选择器既命中 .ws-* 也命中裸标签）=====
  // i18n-exempt-start（EDITOR_CSS 是注入 iframe 的编辑器 CSS，其中的中文全是 CSS 注释 / dev 说明，非用户可见文案，不翻）
  const EDITOR_CSS = `
  /* §0：编辑器不套 canvas 装饰排版（max-width/居中/字号/颜色那套已删）；显示按 .html 原生，
     让块渲染正确的最小语义 CSS（margin/callout/todo）由 Schema baseline 随文件入盘（U5）。
     下面只保留「编辑器内」功能渲染（待办勾选框 + 编辑态高亮/占位/空块高度），均不入序列化。 */
  /* U11/create-4：class-scoped——todo 语义只按 class 生效。todo 列表（含 Tab 缩进产生的嵌套 ws-todo 子列表，D3）无圆点；
     裸嵌套非 todo 列表（转换路径产物）显式恢复圆点/编号，否则继承父 ws-todo 的 list-style:none 成无 marker 裸文本。 */
  ul.ws-todo { list-style:none; }
  ul.ws-todo ul:not(.ws-todo) { list-style:disc; }
  ul.ws-todo ol:not(.ws-todo) { list-style:decimal; }
  .ws-todo > li { list-style:none;position:relative;padding-left:4px; }
  .ws-todo > li::before { content:'';position:absolute;left:-22px;top:0.38em;width:16px;height:16px;box-sizing:border-box;border:1.5px solid #8a857c;border-radius:4px;background:#fff;cursor:pointer; }
  /* U14/check-2：勾选视觉传播反制。text-decoration:line-through 按 CSS 装饰传播规则会绘穿全部 in-flow 后代、
     无法从后代 text-decoration:none 取消 → 含子列表的勾选项**不给自身加 line-through**（只变灰），避免划穿未勾子项；
     叶子勾选项（无子列表）照常灰+划线。嵌套列表 color 显式重置回正文色（color 是继承属性、会下渗）。 */
  .ws-todo > li[data-checked="true"] { color:#9b9891; }
  .ws-todo > li[data-checked="true"]:not(:has(ul,ol)) { text-decoration:line-through; }
  .ws-todo > li[data-checked="true"] :is(ul,ol) { color:#37352f; }
  .ws-todo > li[data-checked="true"]::before { content:'✓';border-color:#1a73e8;background:#1a73e8;color:#fff;font-size:11px;line-height:13px;text-align:center; }

  [contenteditable='true']{outline:none;}
  /* 空块/图片说明的占位文案（:empty::before content）随语言，在 attach 期用 t() 拼进 adoptedStyleSheets，不写死在这。 */
  /* 空块也占一行高度——否则非编辑态的空块（没占位符）塌成 0 高，连按 Enter 建的空白行全叠在一处、看着「换不了行」。
     必须用 1lh（＝该块自己的 line-height），不能用固定的 1.6em：各块行高不同（p=1.75、h1=1.3…），固定 em 对不上，
     导致空块比有字的块矮一截（p 实测 25.6 vs 28）——于是块在「空↔有字」间翻转时下面所有行会跳 2.4px（Wendi 2026-07-22
     报「上下插入时这行会上下抖动、纵坐标没固定住」的根因）。1lh 让空块精确等于有字时的一行高，翻转零位移。纯渲染、不进序列化。 */
  [data-ws2-root] > p:empty, [data-ws2-root] > h1:empty, [data-ws2-root] > h2:empty,
  [data-ws2-root] > h3:empty, [data-ws2-root] > blockquote:empty, [data-ws2-root] > .ws-callout:empty{min-height:1lh;}
  /* 选中/编辑高亮只用 box-shadow + background（不影响布局），绝不用 padding/margin——否则 padding 把文字推右。 */
  [data-ws2-selected]:not([data-ws2-editing]){border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.16),0 0 0 6px rgba(0,0,0,.05);background:rgba(0,0,0,.03);}
  /* 图片块选中框:暗色文档=对 html 施 invert 滤镜、并对 img 二次施同款把图还原真色——这层双反色会把
     裸 <img> 上的黑阴影再翻回黑、在暗底上隐身(figure/文字块只单反色→白→可见,故只有裸图看不见)。
     改用 accent 蓝:过「invert+hue-rotate」仍是蓝(配方保色相)、明暗两态都看得见。 */
  img[data-ws2-selected]:not([data-ws2-editing]),
  figure[data-ws2-selected]:not([data-ws2-editing]){box-shadow:0 0 0 2px #1a73e8,0 0 0 5px rgba(26,115,232,.28);}
  [data-ws2-editing]{border-radius:4px;background:rgba(0,0,0,.015);}
  /* 表格 cell 编辑（U2）：悬停 cursor:text = 可编辑性的最低发现性；编辑格 inset 蓝环（不占布局、纸方墨圆克制）。 */
  td:hover,th:hover{cursor:text;}
  [data-ws2-cell]{outline:none;border-radius:2px;box-shadow:inset 0 0 0 2px rgba(26,115,232,.4);background:rgba(26,115,232,.04);}
  /* cell 拒收提示小签（U4）：墨色圆角、200ms 淡入淡出、不占布局不推文字（纸方墨圆：克制的反馈）。 */
  .ws-cellnope{position:absolute;padding:5px 10px;background:#37352f;color:#fff;font-size:12px;line-height:1.4;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.18);opacity:0;transform:translateY(2px);transition:opacity .2s ease,transform .2s ease;pointer-events:none;z-index:100000;font-family:-apple-system,system-ui,"PingFang SC",sans-serif;white-space:nowrap;}
  .ws-cellnope--on{opacity:1;transform:translateY(0);}
  /* 落点指示线（E4 对齐 Notion）：蓝线 + 左端一个圆点标缩进层级；线的左端随目标层级右移一个缩进单位。
     ⚠ 只能用 ::after —— .ws-todo > li::before 是勾选框，用 ::before 会把待办行的勾选框顶掉。
     ⚠ 缩进量走 data-ws2-dropindent **属性**、绝不写 inline style：块级 style 即非合规，
     自动保存万一撞上拖拽窗口就会把整篇判成降级（CLAUDE.md 高频路径）。 */
  [data-ws2-drop]{position:relative;}
  [data-ws2-drop]::after{content:'';position:absolute;left:0;right:0;height:7px;pointer-events:none;z-index:5;
    background:linear-gradient(#1a73e8,#1a73e8) center/100% 2px no-repeat,
               radial-gradient(circle at 3.5px 3.5px, #1a73e8 0 3.5px, transparent 3.5px) left center/7px 7px no-repeat;}
  [data-ws2-drop='top']::after{top:-4px;}
  [data-ws2-drop='bottom']::after{bottom:-4px;}
  [data-ws2-dropindent='1']::after{left:27.2px;}
  [data-ws2-dropindent='2']::after{left:54.4px;}
  [data-ws2-dropindent='3']::after{left:81.6px;}
  [data-ws2-dropindent='4']::after{left:108.8px;}
  [data-ws2-dropindent='5']::after{left:136.0px;}
  [data-ws2-dropindent='6']::after{left:163.2px;}
  [data-ws2-dropindent='7']::after{left:190.4px;}
  [data-ws2-dropindent='8']::after{left:217.6px;}
  [data-ws2-dropindent='-1']::after{left:-27.2px;}
  [data-ws2-dropindent='-2']::after{left:-54.4px;}
  [data-ws2-dropindent='-3']::after{left:-81.6px;}
  [data-ws2-dropindent='-4']::after{left:-108.8px;}
  [data-ws2-dropindent='-5']::after{left:-136.0px;}
  [data-ws2-dropindent='-6']::after{left:-163.2px;}
  [data-ws2-dropindent='-7']::after{left:-190.4px;}
  [data-ws2-dropindent='-8']::after{left:-217.6px;}
  /* 将成为子项时，父行整行淡蓝底（Notion 同款，告诉用户「进的是这一行下面」） */
  [data-ws2-dropparent]{border-radius:3px;background:rgba(26,115,232,.10);box-shadow:0 0 0 3px rgba(26,115,232,.10);}
  /* 跨块拖选的块级高亮（Wendi 2026-07-22）：整行蓝底(box-shadow 外扩到左右边距、不占布局)，罩住的块内
     隐掉原生 ::selection→只剩整行蓝(对齐 Notion「哪几行都选中」)。绝不用 padding/margin(推文字)。 */
  /* 菜单作用对象（对拍 T6）：菜单开着时标出「删除本行/本列」到底会动哪一行、哪一列。
     用底色而非 outline——outline 在 border-collapse 的表格上会被相邻格边框切断、看不出整行整列。
     交点格另有一条更强的规则（见下）——同色同属性在同一元素上**不会**叠深，别指望那个。纯交互态、存盘剥除。 */
  tr[data-ws2-menurow]>td,tr[data-ws2-menurow]>th{background:rgba(29,111,191,.10);}
  td[data-ws2-menucol],th[data-ws2-menucol]{background:rgba(29,111,191,.10);}
  /* 交点格 = 对齐三态的真实作用对象。必须比行/列更强，且不能指望「两条同色规则叠深」——那不会发生。
     ⚠ 选择器必须显式带上 tr[data-ws2-menurow]> 前缀：光写 td[data-ws2-menucell] 是 (0,1,1)，
     会被上面的 tr[data-ws2-menurow]>td (0,1,2) 压过去，交点格拿到的还是行的色（实测翻过车）。 */
  tr[data-ws2-menurow]>td[data-ws2-menucell],tr[data-ws2-menurow]>th[data-ws2-menucell],
  td[data-ws2-menucell],th[data-ws2-menucell]{background:rgba(29,111,191,.24);box-shadow:inset 0 0 0 2px rgba(29,111,191,.55);}
  [data-ws2-rangesel]{border-radius:3px;background:rgba(26,115,232,.16);box-shadow:0 0 0 4px rgba(26,115,232,.16);}
  [data-ws2-rangesel] *::selection, [data-ws2-rangesel]::selection{background:transparent;}
  [data-ws2-rangesel] ::-moz-selection, [data-ws2-rangesel]::-moz-selection{background:transparent;}
  /* U23/select-4：跨 toggle 边界删除被拦成空操作时的反馈——高亮块闪一下橙红（不推布局、不用 transform 免劫持包含块）。 */

  .ws-grip{align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;color:#8a8f96;cursor:grab;background:transparent;z-index:99998;animation:ws-grip-in 120ms ease;}
  @keyframes ws-grip-in{from{opacity:0}to{opacity:1}}
  .ws-grip:hover{background:#f0f1f3;color:#5a5f66;}
  .ws-grip:active{cursor:grabbing;}
  /* U4「+」快捷插入：与手柄同尺寸同淡墨、cursor:pointer（可点不可拖，与 ⋮⋮ 的 grab 区分） */
  .ws-plus{align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;color:#8a8f96;cursor:pointer;background:transparent;z-index:99998;animation:ws-grip-in 120ms ease;}
  .ws-plus:hover{background:#f0f1f3;color:#5a5f66;}
  /* 块菜单头：标注作用对象的块类型（对拍 Notion 的 "To-do list" 头）。弱化成标签色，不抢菜单项。 */
  .ws-blockmenu-head{padding:6px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:#9a9ea5;}

  .ws-fmtbar{align-items:center;gap:1px;height:32px;padding:0 4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:99999;font-family:-apple-system,system-ui,"PingFang SC",sans-serif;}
  .ws-fmtbar-btn{display:flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 5px;border:none;background:transparent;border-radius:3px;color:#5a5f66;font-size:12px;font-weight:500;cursor:pointer;}
  .ws-fmtbar-btn:hover{background:#f0f1f3;color:#1c1d1f;}
  .ws-fmtbar-text{font-size:12px;white-space:nowrap;}
  .ws-fmtbar-sep{width:1px;height:16px;background:#eceef0;margin:0 3px;display:inline-block;}
  .ws-fmtbar-aglyph{font-weight:700;text-decoration:underline;text-decoration-color:#1a73e8;text-underline-offset:2px;}
  .ws-fmtbar-ai{gap:4px;color:#1a73e8;font-size:12px;font-weight:500;}
  .ws-fmtbar-ai:hover{background:rgba(26,115,232,.08);}
  .ws-fmtbar-holder{position:relative;display:inline-flex;}
  .ws-fmtbar-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:100000;min-width:132px;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);}
  .ws-fmtbar-menu-item{display:flex;align-items:center;width:100%;height:30px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-fmtbar-menu-item:hover{background:#f0f1f3;}
  /* 当前块类型高亮 + 右侧勾（Wendi 2026-07-22：看不出当前是几级标题） */
  .ws-fmtbar-menu-item--on{color:#1a73e8;font-weight:600;}
  .ws-fmtbar-menu-item--on::after{content:'\\2713';margin-left:auto;color:#1a73e8;}
  .ws-fmtbar-swatches{position:absolute;top:calc(100% + 6px);left:0;z-index:100000;gap:4px;padding:7px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);}
  .ws-fmtbar-swatch{width:20px;height:20px;border-radius:3px;border:1px solid #e4e6e9;cursor:pointer;padding:0;}

  .ws-blockmenu{min-width:168px;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:100000;}
  .ws-blockmenu-item{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-blockmenu-item svg{color:#8a8f96;flex:none;}
  .ws-blockmenu-danger svg{color:#d93025;}
  .ws-blockmenu-item:hover{background:#f0f1f3;}
  .ws-blockmenu-danger{color:#d93025;}
  .ws-blockmenu-danger:hover{background:#fce8e6;}
  .ws-blockmenu-sep{height:1px;background:#eceef0;margin:4px 6px;}
  .ws-blockmenu-colors{display:flex;gap:5px;padding:5px 8px 3px;}
  .ws-blockmenu-swatch{width:18px;height:18px;border-radius:3px;border:1px solid #e4e6e9;cursor:pointer;padding:0;}
  /* 表格 cell 对齐三态（U6）：一行三钮，当前态描蓝（纸方墨圆——小、方、克制）。 */
  .ws-blockmenu-aligns{display:flex;gap:4px;padding:5px 8px;}
  .ws-blockmenu-alignbtn{flex:1;height:26px;border:1px solid #e4e6e9;background:transparent;border-radius:5px;font-size:12px;color:#5a5f66;cursor:pointer;padding:0 4px;}
  .ws-blockmenu-alignbtn:hover{background:#f0f1f3;color:#1c1d1f;}
  .ws-blockmenu-alignbtn--on{color:#1a73e8;border-color:#1a73e8;font-weight:600;}

  .ws-slashmenu{min-width:184px;max-height:290px;overflow-y:auto;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:100000;}
  .ws-slashmenu-item{display:block;width:100%;height:32px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-slashmenu-item:hover,.ws-slashmenu-item.active{background:#f0f1f3;}
  .ws-slashmenu-empty{padding:8px 10px;font-size:12px;color:#8a8f96;}
  `;
  // i18n-exempt-end

  const api = { attach, classify, isEditableEl, pickBlockRoot, tableSeed, tableRowsOf, rowCellsOf, firstCellOf, cellPosOf, cellAt, cellNavTarget, cellSpanOf, tableEditOp, EDITOR_CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BlockEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
