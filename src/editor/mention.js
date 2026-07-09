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
      empty.textContent = st.loading ? '加载中…' : '无匹配文档';
      listEl.appendChild(empty);
      return;
    }
    st.items.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'ws-mention-item' + (i === st.active ? ' is-active' : '');
      row.setAttribute('data-idx', String(i));
      if (it.kind === 'doc') {
        var ico = document.createElement('span'); ico.className = 'ws-mention-ico'; ico.textContent = ICONS[it.fileKind] || ICONS.other;
        var main = document.createElement('div'); main.className = 'ws-mention-main';
        var t = document.createElement('div'); t.className = 'ws-mention-title'; t.textContent = it.title;
        main.appendChild(t);
        // 同名消歧：路径含目录才显示
        if (it.rel.indexOf('/') >= 0) { var p = document.createElement('div'); p.className = 'ws-mention-path'; p.textContent = it.rel; main.appendChild(p); }
        row.appendChild(ico); row.appendChild(main);
      } else {
        var t2 = document.createElement('div'); t2.className = 'ws-mention-title ws-mention-action'; t2.textContent = it.title;
        row.appendChild(t2);
      }
      row.addEventListener('mousedown', function (e) { e.preventDefault(); });
      row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pick(it); });
      listEl.appendChild(row);
    });
    // 让选中项可见
    var active = listEl.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  // 拉候选（U2 索引）：同根文档，标题/路径模糊匹配；末尾「新建 query」（有 query 时）+「网址链接…」。
  function refreshItems() {
    if (!st) return Promise.resolve();
    var rootId = st.rootId, fromRel = st.fromRel, query = st.query.trim().toLowerCase();
    st.loading = true; render();
    return Promise.resolve(window.ws2.linksQuery(rootId)).then(function (docs) {
      if (!st || st.rootId !== rootId) return; // 会话已变
      var out = [];
      (docs || []).forEach(function (d) {
        if (d.rel === fromRel) return; // 不列自己
        if (query && d.title.toLowerCase().indexOf(query) < 0 && d.rel.toLowerCase().indexOf(query) < 0) return;
        out.push({ kind: 'doc', rel: d.rel, title: d.title, fileKind: d.kind });
      });
      out = out.slice(0, 8);
      if (st.query.trim() && window.__wsCreateLinkedDoc) out.push({ kind: 'create', title: '新建「' + st.query.trim() + '」' });
      out.push({ kind: 'url', title: '网址链接…' });
      st.items = out; st.loading = false;
      if (st.active > out.length - 1) st.active = out.length - 1;
      if (st.active < 0) st.active = 0;
      render();
    }).catch(function () { if (st) { st.items = []; st.loading = false; render(); } });
  }

  // ---- 打开 ----
  // ctx: { frame, doc(contentDocument), win, blockEl, caretRect{top,left,bottomAbove}, rootId, fromRel,
  //        mode:'insert'|'wrap', trig(0|1|2), savedRange?, onDone?(result) }
  function open(ctx) {
    ensureMenu();
    st = {
      frame: ctx.frame, doc: ctx.doc, win: ctx.win, blockEl: ctx.blockEl,
      rootId: ctx.rootId, fromRel: ctx.fromRel, mode: ctx.mode || 'insert', trig: ctx.trig || 0,
      savedRange: ctx.savedRange || null, onDone: ctx.onDone || null,
      query: '', active: 0, items: [], loading: true,
    };
    positionAt(ctx.caretRect);
    render();
    refreshItems();
  }

  function close() {
    st = null;
    if (menuEl) menuEl.style.display = 'none';
  }

  function updateQuery(q) { if (!st) return; st.query = q; st.active = 0; refreshItems(); }

  // 菜单开着时 blockedit 把导航键转给这里；返回 true = 已消费（blockedit 不再处理）。
  function handleKey(e) {
    if (!st) return false;
    if (e.isComposing || e.keyCode === 229) return false; // 组字中：全归输入法
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(); return true; }
    if (k === 'Enter') { e.preventDefault(); if (st.items[st.active]) pick(st.items[st.active]); else close(); return true; }
    if (k === 'ArrowDown') { e.preventDefault(); st.active = Math.min(st.active + 1, st.items.length - 1); render(); return true; }
    if (k === 'ArrowUp') { e.preventDefault(); st.active = Math.max(0, st.active - 1); render(); return true; }
    if (k === 'Backspace') {
      if (st.trig === 0) e.preventDefault(); // 斜杠/气泡入口：query 纯虚拟，别删正文/选区
      if (st.query.length === 0) { close(); return true; } // 删到触发符 → 关（trig>0 时触发符本身交给正文默认删）
      st.query = st.query.slice(0, -1); st.active = 0; refreshItems();
      return true;
    }
    if (k && k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (st.trig === 0) e.preventDefault(); // 斜杠/气泡：查询字符不落进正文（wrap 会毁选区）
      st.query = st.query + k; st.active = 0; refreshItems();
      return true;
    }
    return false;
  }
  // IME 组好的字（compositionend）→ 进 query（trig>0 时这些字也已落进正文，插入时按 DOM 真相删掉）。
  function handleComposition(data) { if (st && data) { st.query = st.query + data; st.active = 0; refreshItems(); } }

  // ---- 选中 → 落地 ----
  function pick(it) {
    if (!st || !it) return;
    var ctx = st;
    close();
    // ① 先定目标（校验/新建/网址都在动正文之前——任何失败分支都不碰正文，用户输入不凭空蒸发）
    if (it.kind === 'url') {
      var url = window.prompt ? window.prompt('链接地址', 'https://') : null;
      if (!url) return;
      finish(ctx, url, url, /*external*/true);
      return;
    }
    if (it.kind === 'create') {
      // 新建在当前文档同目录、不切走标签页；标题=query。走既有新建 ipc（渲染层 sidebar 钩子）。
      var title = ctx.query.trim() || '未命名文档';
      var mk = (window.__wsCreateLinkedDoc ? window.__wsCreateLinkedDoc(ctx.rootId, ctx.fromRel, title) : Promise.resolve(null));
      Promise.resolve(mk).then(function (rel) {
        if (!rel) { if (window.__wsToast) window.__wsToast('新建失败'); return; }
        var href = window.WS2Links.relHref(ctx.fromRel, rel);
        finish(ctx, href, title, false, { created: rel });
      });
      return;
    }
    // 文档：href = 从当前文档到目标的相对路径（U1）
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
    // insert 模式：trig>0 先用 DOM 真相删掉「触发符+query」，再插；trig=0 caret 已就位直接插。
    if (!sel || sel.rangeCount === 0 || !blockEl.contains(sel.getRangeAt(0).startContainer)) return;
    if (ctx.trig > 0) deleteTrigger(ctx, sel);
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

  // DOM 真相定位「触发符+query」整段删除（不按计数回删——IME/移光标/粘贴会让计数与 DOM 失同步）。
  function deleteTrigger(ctx, sel) {
    var doc = ctx.doc, el = ctx.blockEl;
    var caret = sel.getRangeAt(0);
    var scan = doc.createRange();
    scan.selectNodeContents(el);
    try { scan.setEnd(caret.startContainer, caret.startOffset); } catch (e) { return; }
    var before = scan.toString();
    var trigs = ctx.trig === 1 ? ['@', '＠'] : ['[[', '【【'];
    var idx = -1, tlen = ctx.trig;
    for (var ti = 0; ti < trigs.length; ti++) { var i = before.lastIndexOf(trigs[ti]); if (i > idx) { idx = i; tlen = trigs[ti].length; } }
    if (idx < 0) return;
    if (before.length - (idx + tlen) > Math.max(ctx.query.length + 8, 24)) return; // 只认 caret 附近的触发符
    var acc = 0;
    var walker = doc.createTreeWalker(el, (ctx.win && ctx.win.NodeFilter ? ctx.win.NodeFilter.SHOW_TEXT : 4));
    var node;
    while ((node = walker.nextNode())) {
      var len = (node.textContent || '').length;
      if (acc + len > idx) {
        var del = doc.createRange();
        del.setStart(node, idx - acc);
        del.setEnd(caret.startContainer, caret.startOffset);
        del.deleteContents();
        sel.removeAllRanges(); sel.addRange(del); // 折叠在删除起点 = 插入点
        return;
      }
      acc += len;
    }
  }

  function afterInsert(ctx, extra, title) {
    if (ctx.onDone) { try { ctx.onDone({ inserted: true, created: extra && extra.created, title: title }); } catch (e) {} }
  }

  function reposition() {
    // 简化：切文档/滚动时直接关（提及是瞬时操作，重定位价值低，切文档态必失效）。
    if (st) close();
  }

  root.WS2Mention = {
    open: open, close: close, isOpen: isOpen, handleKey: handleKey,
    handleComposition: handleComposition, reposition: reposition,
  };
})(typeof window !== 'undefined' ? window : this);
