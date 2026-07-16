/* src/editor/mention.js — 文档互链「创建面」的提及菜单（WS2Mention）。
 * 架构（抄 find.js / basic-edit.js 的父层浮层套路）：
 *   · 菜单 UI 在**父层** document.body（position:fixed，锚在 iframe 内 caret rect + frame offset）——
 *     iframe sandbox 不跑脚本，一切逻辑在父层操作 contentDocument。
 *   · 触发（@ / [[ / 【【 / 斜杠 / 气泡）、键盘导航由 blockedit 在 contentDocument 上驱动，转调这里的
 *     handleKey/updateQuery；本模块只管：拉候选（U2 的 ws-links-query）、渲染菜单、选中后插入/包裹。
 *   · 铁律 1：落盘字节 = 纯净 <a href="相对路径">标题</a>（+一个普通空格落 caret）——**零 class、零 contenteditable、
 *     零 &nbsp;**（ui-demo 那些是 demo 妥协）；提及淡底/断链红线是编辑态装饰，走 U4 的 CSS Highlight，不落盘。
 * 双导出：renderer 里作 window.WS2Mention 全局。
 */
(function (root) {
  'use strict';

  var st = null;   // 当前会话状态；null = 关闭
  var menuEl = null;
  var listEl = null;

  function isOpen() { return !!st; }

  // ---- 菜单 DOM（父层，data-ws2-ui 让它不被块编辑器/序列化误当内容）----
  function ensureMenu() {
    if (menuEl && document.body.contains(menuEl)) return;
    menuEl = document.createElement('div');
    menuEl.className = 'ws-mention-menu';
    menuEl.setAttribute('data-ws2-ui', '');
    listEl = document.createElement('div');
    listEl.className = 'ws-mention-list';
    menuEl.appendChild(listEl);
    // 菜单上按下鼠标不要让编辑器失焦/塌选区（对齐 fmtbar 按钮）
    menuEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.body.appendChild(menuEl);
  }

  // iframe 内坐标 → 父层视口坐标（frame 矩形偏移）。
  function positionAt(rect) {
    if (!st) return;
    var fr = st.frame.getBoundingClientRect();
    var top = fr.top + rect.top;
    var left = fr.left + rect.left;
    // 贴着屏幕：菜单高度可能超出视口下缘 → 往上翻；水平别出右缘。
    menuEl.style.left = Math.max(6, Math.min(left, window.innerWidth - 280)) + 'px';
    menuEl.style.top = top + 'px';
    menuEl.style.visibility = 'hidden'; // 先量高度再决定是否上翻
    menuEl.style.display = 'block';
    var h = menuEl.getBoundingClientRect().height;
    // 下方放不下 → 翻到 caret 行上方（rect.above = caret 行顶，iframe 内坐标）
    if (top + h > window.innerHeight - 8) menuEl.style.top = Math.max(6, fr.top + rect.above - h) + 'px';
    menuEl.style.visibility = 'visible';
  }

  var ICONS = { html: '📄', md: '📝', pdf: '📕', image: '🖼', sheet: '📊', slides: '📽', word: '📄', other: '📎' };

  function render() {
    if (!st) return;
    listEl.innerHTML = '';
    if (!st.items.length) {
      var empty = document.createElement('div');
      empty.className = 'ws-mention-empty';
      empty.textContent = st.loading ? window.wsT('common.loading') : window.wsT('link.noMatchDoc');
      listEl.appendChild(empty);
      return;
    }
    // 同名冲突检测：同 basename（文件名）在候选里出现 >1 次 → 这些候选全强制显示完整路径消歧
    // （哪怕在根目录）。子目录文件本就显示路径（有目录信息，天然可区分）。
    var baseCount = {};
    st.items.forEach(function (it) { if (it.kind === 'doc') { var b = it.rel.split('/').pop(); baseCount[b] = (baseCount[b] || 0) + 1; } });
    st.items.forEach(function (it, i) {
      // B 跨根：其他空间组的首项上方插一个空间名分节头（非交互）
      if (it.groupFirst) { var hd = document.createElement('div'); hd.className = 'ws-mention-group'; hd.textContent = it.rootName || window.wsT('link.otherSpace'); listEl.appendChild(hd); }
      var row = document.createElement('div');
      row.className = 'ws-mention-item' + (i === st.active ? ' is-active' : '');
      row.setAttribute('data-idx', String(i));
      if (it.kind === 'doc') {
        var ico = document.createElement('span'); ico.className = 'ws-mention-ico'; ico.textContent = ICONS[it.fileKind] || ICONS.other;
        var main = document.createElement('div'); main.className = 'ws-mention-main';
        var t = document.createElement('div'); t.className = 'ws-mention-title'; t.textContent = it.title;
        main.appendChild(t);
        // 同名消歧：子目录文件显示路径；同名冲突强制显示；**跨根候选恒显示路径**（有分节头给空间名，这里给根内位置）。
        var hasDup = baseCount[it.rel.split('/').pop()] > 1;
        if (!it.current || it.rel.indexOf('/') >= 0 || hasDup) { var p = document.createElement('div'); p.className = 'ws-mention-path'; p.textContent = it.rel; main.appendChild(p); }
        row.appendChild(ico); row.appendChild(main);
      } else {
        var t2 = document.createElement('div'); t2.className = 'ws-mention-title ws-mention-action'; t2.textContent = it.title;
        row.appendChild(t2);
      }
      row.addEventListener('mousedown', function (e) { e.preventDefault(); });
      row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pick(it); });
      listEl.appendChild(row);
    });
    // B：跨卷根不可建链 → 底部灰字提示（拒绝路径可见，L8）
    if (st.crossVolNames && st.crossVolNames.length) {
      var note = document.createElement('div'); note.className = 'ws-mention-volnote';
      note.textContent = window.wsT('link.crossVolNote', { names: st.crossVolNames.join(window.wsT('link.nameSep')) });
      listEl.appendChild(note);
    }
    // V3：超大根（简化模式）链接索引降级 → 底部灰字提示（拒绝路径可见）
    if (st.degradedNames && st.degradedNames.length) {
      var dnote = document.createElement('div'); dnote.className = 'ws-mention-volnote';
      dnote.textContent = window.wsT('link.degradedNote', { names: st.degradedNames.join(window.wsT('link.nameSep')) });
      listEl.appendChild(dnote);
    }
    // 让选中项可见
    var active = listEl.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  // 拉候选（U2 索引）：同根文档，标题/路径模糊匹配；末尾「新建 query」（有 query 时）+「网址链接…」。
  function matches(title, rel, q) { return !q || title.toLowerCase().indexOf(q) >= 0 || rel.toLowerCase().indexOf(q) >= 0; }
  // 候选**一次会话拉一次**（打开菜单时；菜单开着这几百毫秒里根内文件不会变）→ 缓存进 st.allDocs/allOthers；
  // 每次打字在缓存上**同步**筛（applyFilter），不再每键发 ipc——根除「并发 linksCandidates 乱序返回、空 query 旧响应盖掉筛过列表」的竞态。
  function fetchCandidates() {
    if (!st) return;
    var rootId = st.rootId;
    st.loading = true; render();
    // B 跨根：一次拉所有 live 根的候选分组（源根在最前）。单根用户 → 只有一组、行为与现状一致。
    Promise.resolve(window.ws2.linksCandidatesAll(rootId)).then(function (groups) {
      if (!st || st.rootId !== rootId) return; // 会话已变
      st.groups = (groups || []).map(function (g) {
        return { rootId: g.rootId, rootName: g.rootName, current: g.rootId === rootId, sameVol: !!g.sameVol, degraded: !!g.degraded, docs: g.docs || [], others: g.others || [] };
      });
      st.loading = false;
      applyFilter();
    }).catch(function () { if (st) { st.groups = []; st.loading = false; applyFilter(); } });
  }
  function applyFilter() {
    if (!st) return;
    var q = st.query.trim().toLowerCase();
    var out = [];
    var crossVolNames = [];
    var degradedNames = [];
    (st.groups || []).forEach(function (g) {
      // V3：超大根链接索引降级 → 不列候选，底部灰字提示「文件夹过大，链接功能不可用」
      if (g.degraded) { degradedNames.push(g.rootName); return; }
      // 跨卷根：不给建链（B 拍板）→ 不列候选，只在底部灰字提示（哑失败=用户以为没做，L8）
      if (!g.current && !g.sameVol) { if (g.docs.length || g.others.length) crossVolNames.push(g.rootName); return; }
      var self = function (rel) { return g.current && rel === st.fromRel; }; // 自链只在源根内排除（别的根同 rel 是别的文件）
      var docs = g.docs.filter(function (d) { return !self(d.rel) && matches(d.title, d.rel, q); });
      var others = g.others.filter(function (o) { return !self(o.rel) && matches(o.title, o.rel, q); });
      docs.concat(others).forEach(function (f) {
        out.push({ kind: 'doc', rootId: g.rootId, rootName: g.rootName, current: g.current, rel: f.rel, title: f.title, fileKind: f.kind });
      });
    });
    out = out.slice(0, 12); // 文档在前、其它文件在后；源根组在最前。跨根后放宽到 12，让其他空间候选有机会露出
    // 标每组首项（渲染分节头用）：源根组不加头；其他空间组首项加空间名头
    var lastRoot = null;
    out.forEach(function (it) { it.groupFirst = (!it.current && it.rootId !== lastRoot); lastRoot = it.rootId; });
    if (st.query.trim() && window.__wsCreateLinkedDoc) out.push({ kind: 'create', title: window.wsT('link.createNamed', { query: st.query.trim() }) });
    out.push({ kind: 'url', title: window.wsT('link.urlLink') });
    st.crossVolNames = crossVolNames;
    st.degradedNames = degradedNames;
    st.items = out;
    if (st.active > out.length - 1) st.active = out.length - 1;
    if (st.active < 0) st.active = 0;
    render();
  }

  // ---- 打开 ----
  // ctx: { frame, doc(contentDocument), win, blockEl, caretRect{top,left,above}, rootId, fromRel,
  //        mode:'insert'|'wrap', trig(0|1|2), anchorOff(块内字符偏移=提及区起点), trigLen(触发符长度), savedRange?, onDone? }
  function open(ctx) {
    ensureMenu();
    st = {
      frame: ctx.frame, doc: ctx.doc, win: ctx.win, blockEl: ctx.blockEl,
      rootId: ctx.rootId, fromRel: ctx.fromRel, mode: ctx.mode || 'insert', trig: ctx.trig || 0,
      anchorOff: ctx.anchorOff || 0, trigLen: ctx.trigLen || 0, // insert：从 anchorOff 起、跳过 trigLen 即 query
      savedRange: ctx.savedRange || null, onDone: ctx.onDone || null,
      query: '', active: 0, items: [], loading: true, reqSeq: 0,
    };
    positionAt(ctx.caretRect);
    render();
    fetchCandidates(); // 拉一次候选，之后打字同步筛
  }

  function close() {
    st = null;
    if (menuEl) menuEl.style.display = 'none';
  }

  function updateQuery(q) { if (!st) return; st.query = q; st.active = 0; applyFilter(); }

  // 菜单开着时 blockedit 把导航键转给这里；返回 true = 已消费（blockedit 不再处理）。
  function handleKey(e) {
    if (!st) return false;
    if (e.isComposing || e.keyCode === 229) return false; // 组字中：全归输入法
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(); return true; }
    if (k === 'Enter') { e.preventDefault(); if (st.items[st.active]) pick(st.items[st.active]); else close(); return true; }
    if (k === 'ArrowDown') { e.preventDefault(); st.active = Math.min(st.active + 1, st.items.length - 1); render(); return true; }
    if (k === 'ArrowUp') { e.preventDefault(); st.active = Math.max(0, st.active - 1); render(); return true; }
    // 移动光标的键：关菜单、交原生（caret 移出 query 锚区后 query 就失锚，别硬留着菜单让 query 与 DOM 漂移，审查 #5）
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') { close(); return false; }
    if (st.mode === 'wrap') {
      // wrap（气泡「链接」）：选中文字才是链接文字，query 是**虚拟**的不落正文——字符/Backspace 拦下、自己维护。
      // ⚠已知限制：中文 IME 组字会绕过 preventDefault、替换掉选中文字（wrap 场景 ASCII 筛可用、中文筛会毁选区）。
      if (k === 'Backspace') { e.preventDefault(); if (st.query.length === 0) { close(); return true; } st.query = st.query.slice(0, -1); st.active = 0; applyFilter(); return true; }
      if (k && k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); st.query = st.query + k; st.active = 0; applyFilter(); return true; }
      return false;
    }
    // insert 模式：字符/Backspace 交给正文默认（落进 @后面），onInput → syncFromDom 从 **DOM 真相** 派生 query，
    // 删到触发符之前时 syncFromDom 自动 close。任何输入法（keydown/组字/insertText/粘贴）都被 DOM 派生统一捕获。
    return false;
  }
  // wrap 用虚拟 query 才需要组字回调；insert 由 onInput 的 syncFromDom 统一从 DOM 派生（不重复计入）。
  function handleComposition(data) { if (st && st.mode === 'wrap' && data) { st.query = st.query + data; st.active = 0; applyFilter(); } }

  // insert 模式：菜单开着时每次输入都从 **DOM 真相** 重算 query（blockEl 里 anchor 到 caret 的文本，去掉触发符）。
  function syncFromDom() {
    if (!st || st.mode === 'wrap') return;
    var before = beforeCaretStr();
    if (before == null || before.length < st.anchorOff) { close(); return; } // 读不到 / caret 移到锚点之前
    if (st.trigLen > 0) {
      var trig = before.substr(st.anchorOff, st.trigLen);
      var oks = st.trig === 1 ? ['@', '＠'] : ['[[', '【【']; // i18n-exempt（触发符匹配用户输入，含全角 IME 变体，须字面）
      if (oks.indexOf(trig) < 0) { close(); return; } // 触发符被删/改 → 关
    }
    var q = before.slice(st.anchorOff + st.trigLen);
    if (q.indexOf('\n') >= 0 || q.length > 60) { close(); return; } // 跨行/太长 = 不是真提及
    st.query = q; st.active = 0; applyFilter();
  }
  function beforeCaretStr() {
    if (!st) return null;
    var sel = st.doc.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var caret = sel.getRangeAt(0);
    if (!st.blockEl.contains(caret.startContainer)) return null;
    var r = st.doc.createRange();
    r.selectNodeContents(st.blockEl);
    try { r.setEnd(caret.startContainer, caret.startOffset); } catch (e) { return null; }
    return r.toString();
  }

  // ---- 选中 → 落地 ----
  function pick(it) {
    if (!st || !it) return;
    var ctx = st;
    close();
    // ① 先定目标（校验/新建/网址都在动正文之前——任何失败分支都不碰正文，用户输入不凭空蒸发）
    if (it.kind === 'url') {
      var url = window.prompt ? window.prompt(window.wsT('link.urlPrompt'), 'https://') : null;
      if (!url) return;
      // 过 safeHref（与气泡链接路径一致）：挡 javascript:/data:/file: 等危险 scheme 写进磁盘 href（审查 #3/#6）。
      var safe = (window.WS2Format && window.WS2Format.safeHref) ? window.WS2Format.safeHref(url) : url;
      if (!safe) { if (window.alert) window.alert(window.wsT('link.badUrl')); return; }
      finish(ctx, safe, safe, /*external*/true);
      return;
    }
    if (it.kind === 'create') {
      // 新建在当前文档同目录、插链接进当前文档、随后跳去编辑新文档（Colin 2026-07-09）。标题=query。
      var title = ctx.query.trim() || window.wsT('common.untitledDoc');
      var mk = (window.__wsCreateLinkedDoc ? window.__wsCreateLinkedDoc(ctx.rootId, ctx.fromRel, title) : Promise.resolve(null));
      Promise.resolve(mk).then(function (res) {
        if (!res || !res.rel) { if (window.__wsToast) window.__wsToast(window.wsT('link.createFailed')); return; }
        var href = window.WS2Links.relHref(ctx.fromRel, res.rel);
        finish(ctx, href, title, false, { created: res.rel, createdAbs: res.abs });
        if (window.__wsToast) window.__wsToast(window.wsT('link.createdAndLinked', { title: title }));
      });
      return;
    }
    // 文档：同根 → 相对路径（U1）；跨根（B）→ 绝对相对（relHrefAbs，经 wsAbs 取两端 abs）
    if (it.rootId != null && it.rootId !== ctx.rootId) {
      Promise.all([window.ws2.wsAbs(ctx.rootId, ctx.fromRel), window.ws2.wsAbs(it.rootId, it.rel)]).then(function (ab) {
        var href = (ab[0] && ab[1]) ? window.WS2Links.relHrefAbs(ab[0], ab[1]) : null;
        if (!href) { if (window.__wsToast) window.__wsToast(window.wsT('link.crossSpaceLinkFail')); return; }
        finish(ctx, href, it.title, false);
      }).catch(function () {});
      return;
    }
    var href2 = window.WS2Links.relHref(ctx.fromRel, it.rel);
    finish(ctx, href2, it.title, false);
  }

  // 把链接真正写进正文（wrap 包裹选中文字 / insert 插入）。落盘字节纯净。
  function finish(ctx, href, title, external, extra) {
    var doc = ctx.doc, blockEl = ctx.blockEl;
    var sel = doc.getSelection();
    // wrap 模式（气泡「链接」）：恢复保存的选区，整体套 <a>
    if (ctx.mode === 'wrap' && ctx.savedRange) {
      try {
        sel.removeAllRanges(); sel.addRange(ctx.savedRange);
        doc.execCommand('createLink', false, href); // 用选中文字当链接文字，保留用户文字
      } catch (e) {}
      afterInsert(ctx, extra, title);
      return;
    }
    // insert 模式：先删掉 anchor→caret 之间的内容（触发符+query，或 trig=0 时 IME 泄漏进正文的 query 文本），再插。
    if (!sel || sel.rangeCount === 0 || !blockEl.contains(sel.getRangeAt(0).startContainer)) return;
    deleteFromAnchor(ctx, sel);
    var range = sel.getRangeAt(0);
    var a = doc.createElement('a');
    a.setAttribute('href', href); // 纯净：只有 href
    a.textContent = title;
    range.insertNode(a);
    // 后跟一个普通空格文本节点落 caret（不是 &nbsp;；空格是正常正文、可入盘）
    var space = doc.createTextNode(' ');
    a.parentNode.insertBefore(space, a.nextSibling);
    var after = doc.createRange();
    after.setStartAfter(space); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    afterInsert(ctx, extra, title);
  }

  // 删掉 blockEl 里 [anchorOff, caret) 的内容：触发符+query（trig>0），或 trig=0 时 IME 泄漏进正文的 query 文本。
  // 锚在 openMention 时刻钉死的字符偏移（不用 lastIndexOf 每次重找——query 里含 @、caret 被移走都不会删错，审查 #1/#2）。
  function deleteFromAnchor(ctx, sel) {
    var doc = ctx.doc, el = ctx.blockEl;
    var caret = sel.getRangeAt(0);
    var pos = charOffsetToPos(ctx, ctx.anchorOff);
    if (!pos) return;
    var del = doc.createRange();
    try { del.setStart(pos.node, pos.offset); del.setEnd(caret.startContainer, caret.startOffset); }
    catch (e) { return; }
    if (del.collapsed) return; // anchor 就在 caret 处（trig=0 无泄漏）：无需删
    del.deleteContents();
    sel.removeAllRanges(); sel.addRange(del); // 折叠在删除起点 = 插入点
  }
  // 块内字符偏移 off → (textNode, offsetInNode)。
  function charOffsetToPos(ctx, off) {
    var doc = ctx.doc, el = ctx.blockEl;
    var acc = 0;
    var NF = (ctx.win && ctx.win.NodeFilter) ? ctx.win.NodeFilter.SHOW_TEXT : 4;
    var walker = doc.createTreeWalker(el, NF);
    var node;
    while ((node = walker.nextNode())) {
      var len = (node.textContent || '').length;
      if (acc + len >= off) return { node: node, offset: off - acc };
      acc += len;
    }
    return { node: el, offset: el.childNodes.length };
  }

  function afterInsert(ctx, extra, title) {
    if (ctx.onDone) { try { ctx.onDone({ inserted: true, created: extra && extra.created, createdAbs: extra && extra.createdAbs, title: title }); } catch (e) {} }
  }

  function reposition() {
    // 简化：切文档/滚动时直接关（提及是瞬时操作，重定位价值低，切文档态必失效）。
    if (st) close();
  }

  root.WS2Mention = {
    open: open, close: close, isOpen: isOpen, handleKey: handleKey,
    handleComposition: handleComposition, syncFromDom: syncFromDom, reposition: reposition,
  };
})(typeof window !== 'undefined' ? window : this);
