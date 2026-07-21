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
    { key: 'image', labelKey: 'blockImage', tag: null, image: true }, // 异步插入（走父层选图），不经 newBlock 同步造块
    { key: 'divider', labelKey: 'blockDivider', tag: 'hr' },
    { key: 'ai', labelKey: 'aiGenerate', tag: null, ai: true },
  ];
  const slashLabel = (it) => T('editor.' + it.labelKey);
  const filterSlash = (q) => {
    const s = (q || '').toLowerCase();
    return SLASH_ITEMS.filter((it) => !s || slashLabel(it).toLowerCase().includes(s) || it.key.includes(s));
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
    const markDirty = deps.markDirty || (() => {});
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
      "figcaption[data-ws2-ce]:empty::before{content:'" + cssEsc(T('editor.figcaptionPlaceholder')) + "';color:#8a8f96;pointer-events:none;}";
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
      ':where(img){max-width:100%;height:auto}' +
      ':where(figure){margin:1em 0}' +
      ':where(figure>img){display:block}' +
      ':where(figcaption){margin-top:6px;font-size:.875em;line-height:1.5;color:#78716c;text-align:center}';
    const TODO_CSS = '.ws-todo{list-style:none}.ws-todo>li{list-style:none;position:relative;padding-left:4px}.ws-todo>li::before{content:"";position:absolute;left:-22px;top:.38em;width:16px;height:16px;box-sizing:border-box;border:1.5px solid #cfccc6;border-radius:4px;background:#fff}.ws-todo>li[data-checked="true"]{color:#9b9891;text-decoration:line-through}.ws-todo>li[data-checked="true"]::before{content:"\\2713";border-color:#1a73e8;background:#1a73e8;color:#fff;font-size:11px;line-height:13px;text-align:center}';
    const CALLOUT_CSS = '.ws-callout{background:#f7f6f3;border:1px solid #e8e6e1;border-radius:8px;padding:14px 16px;margin:14px 0}.ws-callout>p{margin:6px 0}.ws-callout>p:first-child{margin-top:0}.ws-callout>p:last-child{margin-bottom:0}';
    // toggle（<details>）入盘语义 CSS：干掉原生三角（双配方 list-style + webkit marker）+ 纸方墨圆旋转 chevron + 正文缩进。
    // 随 serialize 存盘 → app 外任何浏览器打开都渲染成折叠块、零 JS 折叠（R10）。校验器 head 白名单按 data-ws-schema-css 属性放行。
    const TOGGLE_CSS = 'details{margin:8px 0}details>summary{list-style:none;cursor:pointer;display:flex;align-items:flex-start;gap:6px}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"\\25B6";display:inline-block;flex:none;margin-top:.2em;font-size:.7em;color:#8a8f96;transition:transform .12s ease}details[open]>summary::before{transform:rotate(90deg)}details>*:not(summary){margin-left:18px}';
    // §0 决策1 固定色板（块级上色 class；也是入盘 color CSS 的单一来源）。
    const TEXT_COLORS = ['#1c1d1f', '#d93025', '#b06000', '#1e8e3e', '#1a73e8', '#8430ce'];
    const COLOR_CSS = TEXT_COLORS.map((c) => '.ws-color-' + c.slice(1) + '{color:' + c + '}').join('');
    blockRoot.setAttribute('data-ws2-root', '');
    ensureSchemaBaseline(); // baseline 排版底线入盘（v2：字体/行高/标题节奏/块间距；旧文件静默升级；不 markDirty）
    refreshSemanticStyles(); // 旧文件的 todo/callout v1 语义 CSS → 同步升级到当前版（同上不 markDirty）

    // ---- 状态 ----
    let selectedEl = null;   // 灰选中的不可编辑块
    let editingEl = null;    // 正在文字编辑的块
    let hoverEl = null;      // 鼠标悬停的块（驱动 ⋮⋮ 定位）
    let slash = null;        // { blockEl, query, active }
    let dragFrom = null;     // 拖拽重排的源块
    let fmtShown = false;    // 格式气泡是否显示——「粘住」用：选区折叠后不立即关，直到离开该块
    let dragStart = null;    // 拖拽选择起点 {x,y}（mousedown 记、mouseup 清）；用来分辨「点击」vs「拖选」
    let wallDropped = false; // 本次拖选是否已摘掉编辑块的 contenteditable（放倒「跨块选区被钉死在单块里」那道墙）
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

    const docOf = () => doc;
    function topBlocks() { return [...blockRoot.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui')); }
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

    // ---- 定位 ----
    function vp() { return { sx: (win.scrollX || 0), sy: (win.scrollY || 0) }; }
    function positionGrip(el) {
      if (!el || !el.isConnected) { grip.style.display = 'none'; return; } // 防已删块的幽灵手柄
      const r = el.getBoundingClientRect();
      const { sx, sy } = vp();
      grip.style.left = (r.left + sx - 28) + 'px';
      // 手柄对块首行的视觉中线（#86）：按首行行高把 22px 手柄垂直居中——标题行高大时手柄不再顶在块顶。
      const cs = doc.defaultView.getComputedStyle(el);
      let lh = parseFloat(cs.lineHeight);
      if (!lh || Number.isNaN(lh)) lh = (parseFloat(cs.fontSize) || 15) * 1.5;
      grip.style.top = (r.top + sy + Math.max(0, (Math.min(lh, r.height) - 22) / 2)) + 'px';
      grip.style.display = 'flex';
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
    function selectBlock(el) {
      exitEdit();
      clearSelectedAttr();
      selectedEl = el;
      if (el) el.setAttribute('data-ws2-selected', '');
      positionFmtbar();
    }
    function deselect() {
      exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      hoverEl = null; grip.style.display = 'none'; // 清悬停引用，防删块后幽灵手柄
      closeBlockMenu();
      fmtbar.style.display = 'none'; fmtShown = false;
    }
    function enterEdit(el, caret) {
      if (editingEl && editingEl !== el) exitEdit();
      clearSelectedAttr();
      selectedEl = null;
      editingEl = el;
      fmtShown = false; // 进新编辑上下文：气泡先不粘（等用户选文字才弹）
      hoverEl = el; positionGrip(el); // 编辑态保留手柄、指向当前块（可开块菜单/拖拽，对齐 ui-demo 常驻手柄）
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('data-ws2-ce', '');
      el.setAttribute('data-ws2-editing', '');
      el.focus();
      placeCaret(el, caret);
      positionFmtbar();
    }
    function exitEdit() {
      if (!editingEl) return;
      const el = editingEl; editingEl = null;
      if (el.hasAttribute('data-ws2-ce')) { el.removeAttribute('contenteditable'); el.removeAttribute('data-ws2-ce'); }
      el.removeAttribute('data-ws2-editing');
      fmtShown = false; fmtbar.style.display = 'none'; // 离开编辑 → 关气泡
    }
    // 全篇跨块选区（⌘A 第二级）：退出编辑放墙（同拖选跨块），range 罩住首尾内容块——
    // 首尾锚点用内容块而非 body（覆盖层 data-ws2-ui 挂在 body 末尾，别把 UI 圈进选区）。
    function selectWholeDoc() {
      if (editingEl) exitEdit();
      clearSelectedAttr(); selectedEl = null;
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
    function newBlock(item) {
      let el;
      if (item.tag === 'hr') { el = doc.createElement('hr'); }
      else if (item.tag === 'ul' || item.tag === 'ol') { el = doc.createElement(item.tag); if (item.cls) el.className = item.cls; const li = doc.createElement('li'); li.textContent = T('editor.listItem'); el.appendChild(li); }
      else if (item.tag === 'div' && item.cls === 'ws-callout') { el = doc.createElement('div'); el.className = 'ws-callout'; el.textContent = T('editor.calloutContent'); }
      else if (item.tag === 'blockquote') { el = doc.createElement('blockquote'); el.textContent = T('editor.quoteContent'); }
      else if (item.tag && item.tag[0] === 'h') { el = doc.createElement(item.tag); el.textContent = T('editor.newHeading'); }
      else if (item.tag === 'details') { el = doc.createElement('details'); el.setAttribute('open', ''); el.appendChild(doc.createElement('summary')); el.appendChild(doc.createElement('p')); ensureToggleStyle(); } // 折叠块种子：<details open><summary></summary><p></p></details>（默认展开，光标由 applySlash 落 summary）
      else { el = doc.createElement('p'); }
      ensureBlockStyle(item.cls);
      return el;
    }
    function insertAfter(refEl, item) {
      const el = newBlock(item);
      if (refEl && refEl.after) refEl.after(el); else blockRoot.appendChild(el);
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

    function turnInto(el, item) {
      if (!el) return el;
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
        if (undoMgr) undoMgr.checkpoint(); markDirty();
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
        if (containerLines) {
          while (next.firstChild) next.removeChild(next.firstChild);
          for (const line of containerLines) { const li = doc.createElement('li'); li.appendChild(line); next.appendChild(li); } // 容器每段 → 一个 <li>
        } else if (!next.querySelector('li')) {
          const li = doc.createElement('li');
          while (next.firstChild) li.appendChild(next.firstChild);
          next.appendChild(li); // 空内容时得到 <ul><li></li></ul>（合法、可继续编辑）
        }
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return next;
      }
      if (item.tag === 'hr') {
        const next = fmt.retagElement(el, 'hr');
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return next;
      }
      if (item.tag === 'details') {
        // 文本→toggle（U9/R2）：源块行内内容 → summary；正文=空 <p>。容器源(callout/quote)拍平成行、列表源拍平 phrasing。
        const det = doc.createElement('details'); det.setAttribute('open', '');
        const summary = doc.createElement('summary');
        if (containerLines) { containerLines.forEach((line, i) => { if (i > 0) summary.appendChild(doc.createElement('br')); summary.appendChild(line); }); }
        else if (el.tagName === 'UL' || el.tagName === 'OL') { summary.appendChild(SM.flattenListToPhrasing(el)); }
        else { while (el.firstChild) summary.appendChild(el.firstChild); }
        det.appendChild(summary); det.appendChild(doc.createElement('p'));
        el.replaceWith(det);
        ensureToggleStyle();
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return det;
      }
      // 修 A1：源是列表、目标非列表（正文/标题/引用/callout）→ 先把 li 拍平成 phrasing，
      // 否则 retag 后 <li> 孤儿挂在 <blockquote>/<p> 下（非法 HTML）。
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const frag = SM.flattenListToPhrasing(el);
        const nx = fmt.retagElement(el, item.tag);
        while (nx.firstChild) nx.removeChild(nx.firstChild);
        nx.appendChild(frag);
        if (item.cls) nx.className = item.cls; else if (nx.classList && nx.classList.contains('ws-callout')) nx.classList.remove('ws-callout');
        ensureBlockStyle(item.cls);
        if (undoMgr) undoMgr.checkpoint(); markDirty();
        return nx;
      }
      const next = fmt.retagElement(el, item.tag); // p / h1 / h2 / h3 / blockquote / div(callout)
      // 修 P1：容器块 → 叶子块(p/h1-4)：内部 <p> 不能进叶子块，拍平成 <br> 分隔的 phrasing。
      // → 容器目标(引用/callout)：保留内部 <p>（两者都放行多段 <p>），不拍。
      if (containerLines && LEAF_TARGETS[item.tag]) {
        while (next.firstChild) next.removeChild(next.firstChild);
        containerLines.forEach((line, i) => { if (i > 0) next.appendChild(doc.createElement('br')); next.appendChild(line); });
      }
      if (item.cls) next.className = item.cls; else if (next.classList && next.classList.contains('ws-callout')) next.classList.remove('ws-callout');
      ensureBlockStyle(item.cls);
      if (undoMgr) undoMgr.checkpoint(); markDirty();
      return next;
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
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (!sBlk || !eBlk) return false; // 选区落在块外/覆盖层 → 不碰
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
      // 跨块（作用域感知，U6）：同作用域 → 用该作用域块列表（含 toggle 体内）；跨作用域 → 上卷到顶层块，
      // details 端点 isEditableEl=false → 整块删（保护其 summary，绝不部分裁剪成非合规）。
      const sScope = scopeRootOf(r.startContainer), eScope = scopeRootOf(r.endContainer);
      const crossScope = sScope !== eScope;
      const scopeRoot = crossScope ? blockRoot : sScope;
      const tops = blocksInScope(scopeRoot);
      const sB = crossScope ? topScopeOf(sBlk) : sBlk, eB = crossScope ? topScopeOf(eBlk) : eBlk;
      const i = tops.indexOf(sB), j = tops.indexOf(eB);
      if (i < 0 || j < 0 || i > j) return false;
      // 修 ED-A2/A3（推广到作用域）：端点是结构块（table/details/figure/img）时 Range 部分裁剪会削 summary/table
      // → 落盘非合规。只对可编辑叶子块部分裁剪，结构端点整块删。
      const sEditable = isEditableEl(sB), eEditable = isEditableEl(eB);
      if (sEditable) { const r1 = doc.createRange(); r1.setStart(r.startContainer, r.startOffset); r1.setEnd(sB, sB.childNodes.length); r1.deleteContents(); } // 裁起块：选区起点→块末
      if (eEditable) { const r2 = doc.createRange(); r2.setStart(eB, 0); r2.setEnd(r.endContainer, r.endOffset); r2.deleteContents(); }                       // 裁末块：块首→选区终点
      for (let k = j - 1; k > i; k--) { const m = tops[k]; if (m && m.parentElement === scopeRoot) m.remove(); }                            // 删中间整块（作用域内）
      const prefixEnd = sEditable ? sB.lastChild : null; // 接合点（合并前 prefix 末尾）
      if (sEditable && eEditable && SM.canMerge(sB, eB)) { // 两端都是存活的叶子文字块才节点级拼接
        while (eB.firstChild) sB.appendChild(eB.firstChild); // 末块剩余并入起块
        eB.remove();
      }
      if (!eEditable) eB.remove(); // 结构末块整删
      if (!sEditable) sB.remove(); // 结构起块整删
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
      if (!selWithinOneBlock()) return; // 跨块拒绝：否则 extractContents 把块级元素拽进 <mark>
      const range = sel.getRangeAt(0);
      const mk = doc.createElement('mark');
      if (bg) mk.style.background = bg;
      try { range.surroundContents(mk); } catch (e) { mk.appendChild(range.extractContents()); range.insertNode(mk); }
      markDirty(); persistEditing();
    }
    function wrapCode() {
      const sel = doc.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      if (!selWithinOneBlock()) return; // 跨块拒绝：否则 extractContents 会把块级元素拽进 <code>
      const range = sel.getRangeAt(0);
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
      const turn = fmtBtn(T('editor.turnInto'), '<span class="ws-fmtbar-text">' + T('editor.turnInto') + ' <svg style="vertical-align:-2px" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>', () => openTurnMenu());
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
    function openTurnMenu() {
      let menu = fmtbar.querySelector('.ws-fmtbar-menu');
      if (menu) { togglePopMenu(menu); return; }
      menu = doc.createElement('div'); menu.setAttribute('data-ws2-ui', WS2_OVERLAY); menu.className = 'ws-fmtbar-menu';
      menu.style.display = 'none'; // 必须先 none，否则 togglePopMenu 把默认 display='' 误判成「已开」→ 首次点反而隐藏
      [['text', 'blockText'], ['h1', 'blockH1'], ['h2', 'blockH2'], ['h3', 'blockH3'], ['quote', 'blockQuote'], ['list', 'blockBulletList'], ['numbered', 'blockNumberedList'], ['todo', 'blockTodoList'], ['toggle', 'blockToggle']].forEach(([key, labelKey]) => {
        const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', WS2_OVERLAY); it.className = 'ws-fmtbar-menu-item'; it.textContent = T('editor.' + labelKey);
        it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        it.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const item = SLASH_ITEMS.find((x) => x.key === key);
          const target = editingEl || selectedEl;
          if (target && item) { const nx = turnInto(target, item); menu.style.display = 'none'; if (nx && nx.tagName === 'DETAILS') { const s = nx.querySelector('summary'); enterEdit(s || nx, { mode: 'end' }); } else if (editingEl) enterEdit(nx, { mode: 'end' }); else selectBlock(nx); }
        });
        menu.appendChild(it);
      });
      fmtbar.appendChild(menu);
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
    function openBlockMenu(el) {
      selectBlock(el);
      blockMenu.innerHTML = '';
      const add = (label, on, danger, icon) => {
        const it = doc.createElement('button'); it.setAttribute('data-ws2-ui', WS2_OVERLAY); it.className = 'ws-blockmenu-item' + (danger ? ' ws-blockmenu-danger' : '');
        it.innerHTML = (icon ? menuIcon(icon) : '') + '<span></span>';
        it.lastElementChild.textContent = label; // label 走 textContent（不进 innerHTML 拼接）
        it.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        it.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
        blockMenu.appendChild(it); return it;
      };
      const sub = (label, item, icon) => add(label, () => { const nx = turnInto(el, item); closeBlockMenu(); selectBlock(nx); }, false, icon);
      // 修 ED-B1：「转为」只对文字承载块给（table/img/hr 等结构块转正文会把表格文字黏成团 / 图片直接消失、
      // 属性搬到 h2 上）。非可编辑块只留插入/复制/删除。
      if (isEditableEl(el)) {
        sub(T('editor.turnToText'), itemByKey('text'), 'text'); sub(T('editor.turnToHeading'), itemByKey('h2'), 'heading'); sub(T('editor.turnToQuote'), itemByKey('quote'), 'quote');
        const sep = doc.createElement('div'); sep.setAttribute('data-ws2-ui', WS2_OVERLAY); sep.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep);
      } else if (classify(el) === 'toggle') {
        // 选中的 toggle → 转文本/标题（U9：toggle→text，summary 内容成段、正文块提到其后，零丢失）
        sub(T('editor.turnToText'), itemByKey('text'), 'text'); sub(T('editor.turnToHeading'), itemByKey('h2'), 'heading');
        const sep = doc.createElement('div'); sep.setAttribute('data-ws2-ui', WS2_OVERLAY); sep.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep);
      }
      // 图片块（无说明）：加说明 → figure/figcaption + 进说明编辑（doc-images U5）
      if (classify(el) === 'image' && !(el.querySelector && el.querySelector('figcaption'))) {
        add(T('editor.addCaption'), () => { closeBlockMenu(); addCaption(el); }, false, 'text');
      }
      add(T('editor.insertBelow'), () => { const nx = insertAfter(el, itemByKey('text')); closeBlockMenu(); enterEdit(nx, { mode: 'start' }); }, false, 'plus');
      add(T('editor.duplicate'), () => { const c = fmt.duplicateBlock(el); if (undoMgr) undoMgr.checkpoint(); markDirty(); closeBlockMenu(); if (c) selectBlock(c); }, false, 'copy');
      add(T('common.delete'), () => { closeBlockMenu(); removeBlock(el); }, true, 'trash');
      // 颜色行（#85：前面补分隔线，对齐 ui-demo 删除与色板之间的 sep）。只给文字承载块——
      // 原子块（图片/分隔线）上色无意义（上色本就 gated 在 isEditableEl，露空色板是误导，对齐 ui-demo）。
      if (isEditableEl(el)) {
        const sep2 = doc.createElement('div'); sep2.setAttribute('data-ws2-ui', WS2_OVERLAY); sep2.className = 'ws-blockmenu-sep'; blockMenu.appendChild(sep2);
        const colors = doc.createElement('div'); colors.setAttribute('data-ws2-ui', WS2_OVERLAY); colors.className = 'ws-blockmenu-colors';
        TEXT_COLORS.forEach((c) => { const sw = doc.createElement('button'); sw.setAttribute('data-ws2-ui', WS2_OVERLAY); sw.className = 'ws-blockmenu-swatch'; sw.style.background = c;
          sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
          // A2/§0决策1：块级上色用 ws-color class（不写 el.style——块 style 被校验器判非法）。默认色=清 class。
          sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); TEXT_COLORS.forEach((c2) => el.classList.remove('ws-color-' + c2.slice(1))); if (c !== TEXT_COLORS[0]) { el.classList.add('ws-color-' + c.slice(1)); ensureColorStyle(); } if (undoMgr) undoMgr.checkpoint(); markDirty(); closeBlockMenu(); });
          colors.appendChild(sw); });
        blockMenu.appendChild(colors);
      }
      const r = grip.getBoundingClientRect(); const { sx, sy } = vp();
      blockMenu.style.left = (r.left + sx) + 'px';
      blockMenu.style.top = (r.bottom + sy + 4) + 'px';
      blockMenu.style.display = 'block';
    }
    function closeBlockMenu() { blockMenu.style.display = 'none'; }

    // ---- 斜杠菜单 ----
    function openSlash(blockEl) {
      slash = { blockEl, query: '', active: 0 };
      renderSlash();
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
      const cur = slash; slash = null; slashMenu.style.display = 'none';
      if (!cur) return;
      const it = SLASH_ITEMS.find((x) => x.key === key);
      if (!it) return;
      // 删掉已输入的「/query」
      const sel = doc.getSelection();
      if (sel && sel.rangeCount) { for (let i = 0; i < cur.query.length + 1; i++) sel.modify('extend', 'backward', 'character'); doc.execCommand('delete'); }
      if (it.ai) { onAiSoon(); return; }
      const el = cur.blockEl;
      const empty = !el || (el.textContent || '').trim() === '';
      // 图片：异步取文件后插入。空块原地替换（已拍板②）。不在此 checkpoint——picker 可取消。
      if (it.image) { pickAndInsertImage(el, empty && isEditableEl(el)); return; }
      if (it.tag === 'details') { const nx = insertAfter(el, it); const s = nx.querySelector('summary'); enterEdit(s || nx, { mode: 'start' }); } // 折叠块：插入后光标落 summary（不是整块 details）
      else if (it.tag === 'hr') { const nx = insertAfter(el, it); selectBlock(nx); }
      else if (empty && isEditableEl(el)) { const nx = turnInto(el, it); enterEdit(nx, { mode: 'start' }); }
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
    // 鼠标按下：记起点，开始判断是「点击」还是「拖选」。点编辑器 UI（气泡/手柄/菜单）不算。
    function onMouseDown(e) {
      if (e.button !== 0) return; // 只管左键
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      if (e.target && e.target.closest && e.target.closest('figcaption')) return; // 说明编辑：交原生放光标/选词，不启块拖选
      // 待办勾选：点 .ws-todo 列表的左侧勾选框 gutter（clientX 在内容左缘之外）→ 切 data-checked，不放光标。
      // 点 ::before 时 e.target 是 li，点 padding 时是 ul，故按 Y 兜底找该行 li。
      const todoUl = e.target && e.target.closest ? e.target.closest('ul.ws-todo') : null;
      if (todoUl) {
        // 先定位该行 li（点 ::before 时 target=li，点 ul padding 时=ul，按 Y 兜底找该行）
        let li = e.target.closest('li');
        if (!li || li.parentElement !== todoUl) {
          li = null;
          for (const x of todoUl.children) {
            if (x.tagName !== 'LI') continue;
            const r = x.getBoundingClientRect();
            if (e.clientY >= r.top && e.clientY <= r.bottom) { li = x; break; }
          }
        }
        // 勾选框 gutter = li 内容左缘左侧（::before left:-20..-5）。判 clientX 落在 li 左缘附近及左侧。
        // 不硬编码 ul padding：§0 删 canvas 后 ul 回默认 padding(40)≠旧 canvas 的 22，原 `ul.left+22` 边界失效、点不中勾选框。
        if (li && li.parentElement === todoUl && e.clientX < li.getBoundingClientRect().left + 4) {
          e.preventDefault();
          li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
          if (undoMgr) undoMgr.checkpoint();
          markDirty();
          return;
        }
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
      }
      // 在手柄/菜单/气泡上移动：保持现状（手柄在块外 margin，移过去若隐藏就点不到了）
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
      const el = blockOf(e.target);
      if (el && el !== hoverEl) { hoverEl = el; positionGrip(el); } // 编辑态也更新（能对当前/别的块开菜单·拖拽）
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
      const sBlk = blockOf(r.startContainer), eBlk = blockOf(r.endContainer);
      if (sBlk && sBlk === eBlk && isEditableEl(sBlk)) {
        const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
        enterEdit(sBlk, { mode: 'keep' });
        try { const cr = doc.createRange(); cr.setStart(sc, so); cr.setEnd(ec, eo); sel.removeAllRanges(); sel.addRange(cr); } catch (x) {}
      }
      positionFmtbar();
    }
    function onDocLeave() { if (!selectedEl && !editingEl) { hoverEl = null; grip.style.display = 'none'; } }
    // 折叠持久化（KD4/R8）：原生 toggle 事件 → markDirty 触发自动保存；绝不 checkpoint（折叠不是撤销步 KD5）。
    function onToggle(e) { if (e.target && e.target.tagName === 'DETAILS') markDirty(); }
    function onClick(e) {
      // 点到覆盖层（手柄/菜单/气泡）自身：交给它们各自的 handler，这里忽略
      if (e.target && e.target.closest && e.target.closest('[data-ws2-ui]')) return;
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
        if ((e.clientX - sr.left) < 20) { det.open = !det.open; return; } // chevron 区 → 折叠
        if (editingEl !== sumT) enterEdit(sumT, { mode: 'point', x: e.clientX, y: e.clientY });
        return;
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
      // 提及菜单开着时：导航键（↑↓Enter/Esc/Backspace/query 字符）先给它，消费了就不再走块编辑（IME 组字键它会放行）
      { const M = mentionApi(); if (M && M.isOpen() && M.handleKey(e)) return; }
      // 斜杠菜单开启时：导航
      if (slash) {
        if (e.isComposing || e.keyCode === 229) return; // IME 组词中：交原生（compositionstart 已关菜单兜底），别把组词键当 query
        if (e.key === 'Escape') { e.preventDefault(); slash = null; slashMenu.style.display = 'none'; return; }
        if (e.key === 'Enter') { e.preventDefault(); const items = filterSlash(slash.query); const it = items[slash.active]; if (it) applySlash(it.key); else { slash = null; slashMenu.style.display = 'none'; } return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); const n = filterSlash(slash.query).length; slash.active = Math.min(slash.active + 1, n - 1); renderSlash(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); slash.active = Math.max(0, slash.active - 1); renderSlash(); return; }
        if (e.key === 'Backspace') { if (slash.query.length === 0) { slash = null; slashMenu.style.display = 'none'; } else { slash.query = slash.query.slice(0, -1); slash.active = 0; renderSlash(); } return; }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { slash.query += e.key; slash.active = 0; renderSlash(); return; }
        // 光标移动键（←→/Home/End/PageUp-Down）或其它键 → 关菜单、交原生：caret 移走后再 applySlash 会从错位删字
        slash = null; slashMenu.style.display = 'none';
        return;
      }
      // toggle 标题（summary）编辑：拦原生折叠激活 + 定义边界。summary 放不了块——不触发 slash、不走 generic 块键盘。
      if (editingEl && editingEl.tagName === 'SUMMARY') {
        if (e.isComposing || e.keyCode === 229) return; // IME 组字交原生
        if (e.key === 'Enter') { // → 首正文块（U7 再扩：空末块退出等）
          e.preventDefault(); e.stopPropagation();
          const det = editingEl.parentElement;
          const bodyEl = det && [...det.children].find((c) => c.nodeType === 1 && c.tagName !== 'SUMMARY');
          if (bodyEl) enterEdit(bodyEl, { mode: 'start' });
          return;
        }
        if (e.key === ' ') { e.preventDefault(); doc.execCommand('insertText', false, ' '); return; } // 原生 summary 空格会折叠——拦默认、手动插空格
        if (e.key === 'Backspace' && isCaretAtStart(doc, editingEl)) {
          e.preventDefault();
          const det = editingEl.parentElement;
          const bodyEmpty = blocksInScope(det).every((b) => (b.textContent || '').trim() === '');
          if ((editingEl.textContent || '').trim() === '' && bodyEmpty) {
            const p = doc.createElement('p'); det.replaceWith(p); // 空 toggle：解包成空正文（逃生，键盘可删）
            if (undoMgr) undoMgr.checkpoint(); markDirty(); enterEdit(p, { mode: 'start' });
          }
          return; // 非空：拦住不让 generic 合并 details
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
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        const sel = doc.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          e.preventDefault();
          try { doc.execCommand('copy'); } catch (x) {} // 复制选区到剪贴板（剪切=复制+删）
          if (!deleteSelection()) doc.execCommand('delete'); // 跨块/无主自己删；编辑态单块内 → 原生删
          markDirty();
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
          if (li && (li.textContent || '').trim() === '' && !li.nextElementSibling) {
            e.preventDefault();
            const ul = editingEl; li.remove();
            if (ul.querySelector('li')) { const nx = insertAfter(ul, itemByKey('text')); enterEdit(nx, { mode: 'start' }); }
            else { const p = turnInto(ul, itemByKey('text')); enterEdit(p, { mode: 'start' }); } // 列表空了 → 整块转正文
            return;
          }
          return; // 非空/非末项 → 交原生（新建 <li>）
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
          const scope = scopeRootOf(editingEl);
          if (e.shiftKey) {
            if (scope !== blockRoot) { const det = scope; det.after(editingEl); if (blocksInScope(det).length === 0) det.appendChild(doc.createElement('p')); if (undoMgr) undoMgr.checkpoint(); markDirty(); enterEdit(editingEl, { mode: 'keep' }); } // ≥1 体块铁则
          } else {
            const prev = editingEl.previousElementSibling;
            if (prev && prev.tagName === 'DETAILS') { prev.setAttribute('open', ''); prev.appendChild(editingEl); if (undoMgr) undoMgr.checkpoint(); markDirty(); enterEdit(editingEl, { mode: 'keep' }); } // 展开被嵌入的 toggle 免内容隐身
          }
          return;
        }
        const sel = doc.getSelection();
        const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
        const li = node && node.closest ? node.closest('li') : null;
        if (!li || !editingEl.contains(li)) return;
        if (e.shiftKey) {
          const parentList = li.parentElement;
          const hostLi = parentList && parentList.parentElement;
          if (hostLi && hostLi.tagName === 'LI') {
            hostLi.after(li);
            if (parentList && !parentList.querySelector('li')) parentList.remove();
            if (undoMgr) undoMgr.checkpoint(); markDirty();
          }
        } else {
          const prev = li.previousElementSibling;
          if (prev && prev.tagName === 'LI') {
            let sub = prev.lastElementChild;
            if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
              // D3：子列表继承 li 的直接父列表类型/class（如 todo 缩进仍是 todo），不是顶层 editingEl 的。
              const parentList = li.parentElement;
              sub = doc.createElement(parentList.tagName.toLowerCase());
              if (parentList.className) sub.className = parentList.className;
              prev.appendChild(sub);
            }
            sub.appendChild(li);
            if (undoMgr) undoMgr.checkpoint(); markDirty();
          }
        }
        try { const r = doc.createRange(); r.selectNodeContents(li); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (x) {}
        return;
      }
      // Backspace 块首：空块删/落上一块末；非空并入上一块（按标签类型安全合并，绝不产生非法嵌套）
      if (e.key === 'Backspace' && editingEl) {
        if (e.isComposing || e.keyCode === 229) return;
        if (classify(editingEl) === 'list') return; // 列表内 Backspace 交原生（删项/退格），不走块级合并
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
          if (isEditableEl(prev)) enterEdit(prev, { mode: 'end' }); else { selectBlock(prev); positionGrip(prev); }
          return;
        }
        if (classify(prev) === 'list') {
          if (!isLeafTextBlock(cur)) return; // B2 守卫对称（补）：cur 是容器块(callout/quote)时不能把块级 <p> 塞进 <li>（产 <li><p> 非法）
          // 上一块是列表：当前块内容作为新 <li> 追加（不能把裸文本塞进 <ul>）
          const li = doc.createElement('li');
          while (cur.firstChild) li.appendChild(cur.firstChild);
          prev.appendChild(li);
          cur.remove(); if (undoMgr) undoMgr.checkpoint(); markDirty();
          enterEdit(prev, { mode: 'end' });
          try { const r = doc.createRange(); r.selectNodeContents(li); r.collapse(true); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (x) {}
          return;
        }
        if (isEditableEl(prev)) {
          // 两块都得是「叶子文字块」才做节点级拼接——否则 prev/cur 是透明包裹块（div.lead>p）时，把块级 <p>
          // 搬进 <p> 会成 <p><p>、把裸文本灌进 div 会成「容器直挂文本」，存盘即坏（A 组）。非叶子则不吞、光标留原处。
          if (!isLeafTextBlock(prev) || !isLeafTextBlock(cur)) return;
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
        if (classify(editingEl) === 'list') return; // 列表内交原生（删项/删字）
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return; // 非折叠选区前面已处理；这里只管折叠光标
        if (!isCaretAtRealEnd(doc, editingEl)) return; // 严格块末（尾随空格不算）——否则段内 Delete 会误吞下一段（B 组）
        const blocks = topBlocks();
        const next = blocks[blocks.indexOf(editingEl) + 1];
        if (!next) return;
        if (classify(next) === 'list' || !isEditableEl(next)) return; // 下一块是列表/图片/分隔线 → 不吞
        const cur = editingEl;
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
        const blocks = topBlocks();
        const idx = blocks.indexOf(editingEl);
        if (e.key === 'ArrowRight') {
          if (!isCaretAtRealEnd(doc, editingEl)) return; // 严格块末（尾随空格不算）——否则段内按 → 会越过空格直接跳块（B 组）
          const next = blocks[idx + 1]; if (!next) return;
          e.preventDefault();
          if (isEditableEl(next)) enterEdit(next, { mode: 'start' });
          else { selectBlock(next); positionGrip(next); }
        } else {
          if (!isCaretAtStart(doc, editingEl)) return; // 不在块首 → 原生
          const prev = blocks[idx - 1]; if (!prev) return;
          e.preventDefault();
          if (isEditableEl(prev)) enterEdit(prev, { mode: 'end' });
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
        const blocks = topBlocks();
        const idx = blocks.indexOf(editingEl);
        if (e.key === 'ArrowDown') {
          if (caret.bottom < er.bottom - lh * 0.5) return; // 不在末行 → 原生
          const next = blocks[idx + 1]; if (!next) return;
          e.preventDefault();
          if (isEditableEl(next)) { const nr = next.getBoundingClientRect(); enterEdit(next, { mode: 'point', x: caret.left, y: nr.top + lh * 0.5 }); }
          else { selectBlock(next); positionGrip(next); }
        } else {
          if (caret.top > er.top + lh * 0.5) return; // 不在首行 → 原生
          const prev = blocks[idx - 1]; if (!prev) return;
          e.preventDefault();
          if (isEditableEl(prev)) { const pr = prev.getBoundingClientRect(); enterEdit(prev, { mode: 'point', x: caret.left, y: pr.bottom - lh * 0.5 }); }
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
        if (editingEl) { const el = editingEl; exitEdit(); selectBlock(el); positionGrip(el); e.preventDefault(); e.stopPropagation(); return; }
        if (selectedEl) { deselect(); e.preventDefault(); e.stopPropagation(); return; }
      }
      // 灰选中态 Delete/Backspace → 删整块
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEl && !editingEl) { e.preventDefault(); removeBlock(selectedEl); }
    }

    function onInput() {
      markDirty(); tryMarkdown();
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
    function tryMarkdown() {
      if (!editingEl || classify(editingEl) !== 'text') return; // 只在正文块（p）触发
      const m = (editingEl.textContent || '').match(/^(#{1,4}|[-*]|1\.|\[\s?\]|>)[\s ]$/);
      if (!m) return;
      const t = m[1];
      const key = t[0] === '#' ? ['h1', 'h2', 'h3', 'h4'][t.length - 1]
        : (t === '-' || t === '*') ? 'list'
        : t === '1.' ? 'numbered'
        : t[0] === '[' ? 'todo'
        : t === '>' ? 'quote' : null;
      if (!key) return;
      const item = SLASH_ITEMS.find((x) => x.key === key);
      if (!item) return;
      editingEl.innerHTML = ''; // 清掉 marker
      enterEdit(turnInto(editingEl, item), { mode: 'start' });
    }
    function closeFmtPops() { fmtbar.querySelectorAll('.ws-fmtbar-swatches, .ws-fmtbar-menu').forEach((p) => { p.style.display = 'none'; }); }
    function onSelectionChange() { closeFmtPops(); positionFmtbar(); } // 选区一动就收起开着的颜色/转为弹层（防指向旧状态）
    function onCompStart() { if (slash) { slash = null; slashMenu.style.display = 'none'; } } // IME 组词开始 → 关斜杠菜单，根除 query/DOM 漂移
    function onScroll() { if (selectedEl) positionGrip(selectedEl); else if (hoverEl) positionGrip(hoverEl); positionFmtbar(); if (blockMenu.style.display !== 'none') closeBlockMenu(); }

    // grip 交互
    grip.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const el = selectedEl || hoverEl; if (el) openBlockMenu(el); });
    grip.addEventListener('dragstart', (e) => { dragFrom = selectedEl || hoverEl; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'block'); } catch (x) {} } });
    grip.addEventListener('dragend', () => { dragFrom = null; clearDrop(); });
    function clearDrop() { const p = body.querySelector('[data-ws2-drop]'); if (p) p.removeAttribute('data-ws2-drop'); }
    // 修 ED-A5：外部拖放（dragFrom 为空=不是内部块拖拽）一律吞掉，别让浏览器默认 insertFromDrop 把带任意
    // 标签的富 HTML（div/h1/span style/a…）插进 contenteditable → 落盘非合规。粘贴那道「只取纯文本」的闸在
    // drop 路径不存在，这里补上（拖放直接拒绝，用户仍可 Cmd+V 走纯文本粘贴）。
    // 修 ED-A4：粘贴只取纯文本，且多行文本自己按 \n 劈成同类型兄弟块——不交给 execCommand 处理换行。
    // 原来 shell 的 paste 用 execCommand('insertText', 带换行的文本)：Chromium 会把 \n 转成段落切分、
    // 在标题块里塞 <p>（<h2><p>..</p></h2>），reparse 后原样保留 → 持久非合规；段落块里也多出垃圾空 <p> + 活 DOM/磁盘分叉。
    function onPaste(e) {
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
      // 单行 / 非编辑态 / summary（放不了块，多行会劈出第二个 summary → 非合规）→ 合成单行插入。U13。
      if (!editingEl || lines.length <= 1 || editingEl.tagName === 'SUMMARY') { doc.execCommand('insertText', false, lines.join(' ')); return; }
      doc.execCommand('insertText', false, lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (splitBlock()) { if (lines[i]) doc.execCommand('insertText', false, lines[i]); } // splitBlock 劈出同类型新块（不嵌套）+ 光标移到新块首
        else if (lines[i]) doc.execCommand('insertText', false, ' ' + lines[i]);
      }
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
      e.preventDefault(); const el = blockOf(e.target); if (!el || el === dragFrom) return; clearDrop(); el.setAttribute('data-ws2-drop', el.compareDocumentPosition(dragFrom) & Node.DOCUMENT_POSITION_PRECEDING ? 'bottom' : 'top');
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
    doc.addEventListener('toggle', onToggle, true); // 折叠事件不冒泡→捕获相 + 委托 doc（撑过 innerHTML 重写/嵌套/后加 toggle）
    doc.documentElement.addEventListener('mouseleave', onDocLeave);

    function detach() {
      live = false; // 停掉 in-flight 图片摄入的插入（见 insertImages）
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
      doc.removeEventListener('toggle', onToggle, true);
      exitEdit();
      [grip, fmtbar, blockMenu, slashMenu].forEach((n) => n.remove());
    }

    // 撤销/重做后 body.innerHTML 被整体重写，旧的元素引用全失效 → 清空状态、收起所有覆盖层。
    function reset() {
      slash = null; slashMenu.style.display = 'none';
      editingEl = null; selectedEl = null; hoverEl = null; dragFrom = null; fmtShown = false; captionEl = null; // undo/redo 重写 body → 旧 figcaption 引用失效
      blockRoot = pickBlockRoot(body); // undo/redo 重写了 body.innerHTML、重建了包裹节点 → 旧引用失效，重算
      blockRoot.setAttribute('data-ws2-root', ''); // 重算后块容器换了节点，重新打标（空块占高度用，非装饰）
      const s = body.querySelector('[data-ws2-selected]'); if (s) s.removeAttribute('data-ws2-selected');
      const d = body.querySelector('[data-ws2-drop]'); if (d) d.removeAttribute('data-ws2-drop');
      grip.style.display = 'none'; fmtbar.style.display = 'none'; closeBlockMenu();
    }

    // reposition：缩放/窗口尺寸变后重定位手柄+气泡。编辑态 selectedEl=null、当前块在 hoverEl，故跟 onScroll 一样
    // 用 hoverEl 兜底（否则编辑中缩放，手柄会漂在缩放前的旧坐标）。
    return { detach, reset, deselect, reposition: () => { if (selectedEl) positionGrip(selectedEl); else if (hoverEl) positionGrip(hoverEl); positionFmtbar(); } };
  }

  // ===== 注入到 iframe 的编辑器样式（ui-demo Canvas.css 移植；选择器既命中 .ws-* 也命中裸标签）=====
  // i18n-exempt-start（EDITOR_CSS 是注入 iframe 的编辑器 CSS，其中的中文全是 CSS 注释 / dev 说明，非用户可见文案，不翻）
  const EDITOR_CSS = `
  /* §0：编辑器不套 canvas 装饰排版（max-width/居中/字号/颜色那套已删）；显示按 .html 原生，
     让块渲染正确的最小语义 CSS（margin/callout/todo）由 Schema baseline 随文件入盘（U5）。
     下面只保留「编辑器内」功能渲染（待办勾选框 + 编辑态高亮/占位/空块高度），均不入序列化。 */
  ul.ws-todo, ul.ws-todo ul, ul.ws-todo ol { list-style:none; }
  .ws-todo > li { list-style:none;position:relative;padding-left:4px; }
  .ws-todo > li::before { content:'';position:absolute;left:-22px;top:0.38em;width:16px;height:16px;box-sizing:border-box;border:1.5px solid #cfccc6;border-radius:4px;background:#fff;cursor:pointer; }
  .ws-todo > li[data-checked="true"] { color:#9b9891;text-decoration:line-through; }
  .ws-todo > li[data-checked="true"]::before { content:'✓';border-color:#1a73e8;background:#1a73e8;color:#fff;font-size:11px;line-height:13px;text-align:center; }

  [contenteditable='true']{outline:none;}
  /* 空块/图片说明的占位文案（:empty::before content）随语言，在 attach 期用 t() 拼进 adoptedStyleSheets，不写死在这。 */
  /* 空块也占一行高度——否则非编辑态的空块（没占位符）塌成 0 高，连按 Enter 建的空白行全叠在一处、看着「换不了行」。
     用 em 跟字号缩放（空标题行更高）。纯渲染、不进序列化。 */
  [data-ws2-root] > p:empty, [data-ws2-root] > h1:empty, [data-ws2-root] > h2:empty,
  [data-ws2-root] > h3:empty, [data-ws2-root] > blockquote:empty, [data-ws2-root] > .ws-callout:empty{min-height:1.6em;}
  /* 选中/编辑高亮只用 box-shadow + background（不影响布局），绝不用 padding/margin——否则 padding 把文字推右。 */
  [data-ws2-selected]:not([data-ws2-editing]){border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.16),0 0 0 6px rgba(0,0,0,.05);background:rgba(0,0,0,.03);}
  /* 图片块选中框:暗色文档=对 html 施 invert 滤镜、并对 img 二次施同款把图还原真色——这层双反色会把
     裸 <img> 上的黑阴影再翻回黑、在暗底上隐身(figure/文字块只单反色→白→可见,故只有裸图看不见)。
     改用 accent 蓝:过「invert+hue-rotate」仍是蓝(配方保色相)、明暗两态都看得见。 */
  img[data-ws2-selected]:not([data-ws2-editing]),
  figure[data-ws2-selected]:not([data-ws2-editing]){box-shadow:0 0 0 2px #1a73e8,0 0 0 5px rgba(26,115,232,.28);}
  [data-ws2-editing]{border-radius:4px;background:rgba(0,0,0,.015);}
  [data-ws2-drop='top']{box-shadow:0 -2px 0 0 #1a73e8;}
  [data-ws2-drop='bottom']{box-shadow:0 2px 0 0 #1a73e8;}

  .ws-grip{align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;color:#8a8f96;cursor:grab;background:transparent;z-index:99998;animation:ws-grip-in 120ms ease;}
  @keyframes ws-grip-in{from{opacity:0}to{opacity:1}}
  .ws-grip:hover{background:#f0f1f3;color:#5a5f66;}
  .ws-grip:active{cursor:grabbing;}

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
  .ws-fmtbar-menu-item{display:block;width:100%;height:30px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-fmtbar-menu-item:hover{background:#f0f1f3;}
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

  .ws-slashmenu{min-width:184px;max-height:290px;overflow-y:auto;padding:4px;background:#fff;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);z-index:100000;}
  .ws-slashmenu-item{display:block;width:100%;height:32px;padding:0 10px;border:none;background:transparent;border-radius:5px;font-size:13px;color:#1c1d1f;text-align:left;cursor:pointer;}
  .ws-slashmenu-item:hover,.ws-slashmenu-item.active{background:#f0f1f3;}
  .ws-slashmenu-empty{padding:8px 10px;font-size:12px;color:#8a8f96;}
  `;
  // i18n-exempt-end

  const api = { attach, classify, isEditableEl, pickBlockRoot, EDITOR_CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2BlockEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);
