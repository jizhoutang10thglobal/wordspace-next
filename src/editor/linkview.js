/* src/editor/linkview.js —— 文档互链「消费面」（U4）：断链装饰 + 悬停预览卡 + 断链修复卡。
 *
 * 与 mention.js（创建面）分开：消费面生命周期 = 整个文档 session（装饰常驻、hover 随时触发、
 * 修复卡有宽限期），跟创建面瞬时的 open→pick→close 状态机不同，塞一起会互相污染。
 *
 * 架构照抄 find.js（实测 spike 过）：
 *   · 断链装饰 = CSS Custom Highlight `::highlight(ws-broken)`——range 建在 iframe 的
 *     contentDocument、highlight 设在 iframe window、`::highlight` 规则用 constructable
 *     stylesheet 注进 iframe 的 adoptedStyleSheets（inline <style> 会被 sandbox iframe 的
 *     style-src CSP 拦，constructable 是纯 CSSOM、不受限、不进序列化 → 铁律1：装饰不落盘）。
 *   · 所有对象必须取自 iframe realm（cw/cd/hlApi/HLCtor），跨 realm 会被 adoptedStyleSheets
 *     和 CSS.highlights 拒。
 *   · 内链淡底 chip 做不了（::highlight 画在文本 run 上，无 border-radius/padding）——按冻结
 *     决策「显示按原生」，有效内链不加任何装饰，只对断链圈 range。
 *
 * 本文件当前实现：断链装饰（step 1）。悬停卡 / 修复卡（step 2-4）后续接。
 */
(function () {
  'use strict';

  var HL = 'ws-broken';
  // ::highlight 能做的：字色/底色/下划线（含 dashed + text-underline-offset）；做不了圆角/padding。
  // 断链验收标准（§5.2）：红字 #b91c1c + 淡红底 #fdf3f2 + 红虚线下划线 offset 3px——三项全在能力内。
  var HL_CSS =
    '::highlight(' + HL + '){color:#b91c1c;background-color:#fdf3f2;' +
    'text-decoration:underline dashed;text-underline-offset:3px;}';

  var frame = null;       // 当前目标 doc-frame（<iframe id="doc-frame">）
  var brokenSheet = null; // 注进 iframe 的 constructable stylesheet
  var scanGen = 0;        // 每次 scan 自增；异步解析回来时校验，防切文档串味（L12/竞态）
  // ---- 悬停预览卡（step 2）状态 ----
  var cardEl = null;
  var openTimer = null, closeTimer = null;
  var hoverGen = 0;       // 每次 hover 意图自增；异步解析/读盘回来校验，防移开后旧卡冒出
  var hoverAnchor = null; // 当前已展示卡的 <a>
  var wiredDoc = null;    // 已挂 mouseover/mouseout 的 contentDocument（换文档重挂）
  var ICONS = { html: '📄', md: '📝', pdf: '📕', image: '🖼', sheet: '📊', slides: '📽', word: '📄', other: '📎' };
  function snippet(t, max) { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max) + '…' : t; }

  // ---- realm 访问器（照抄 find.js:35-38；所有 Highlight/Range/Sheet 对象必须取自 iframe realm）----
  function cw() { try { return frame && frame.contentWindow; } catch (e) { return null; } }
  function cd() { try { return frame && frame.contentDocument; } catch (e) { return null; } }
  function hlApi() { var w = cw(); return w && w.CSS && w.CSS.highlights ? w.CSS.highlights : null; }
  function HLCtor() { var w = cw(); return w && w.Highlight ? w.Highlight : null; }

  // ---- constructable stylesheet 注入（照抄 find.js:96-107，只换 HL_CSS）----
  function ensureSheet() {
    var w = cw(), d = cd();
    if (!w || !d) return;
    try {
      if (!brokenSheet || d.adoptedStyleSheets.indexOf(brokenSheet) < 0) {
        var SheetCtor = w.CSSStyleSheet || CSSStyleSheet;
        brokenSheet = new SheetCtor();
        brokenSheet.replaceSync(HL_CSS);
        d.adoptedStyleSheets = [].concat(d.adoptedStyleSheets, brokenSheet);
      }
    } catch (e) { /* 老 Chromium 无 constructable stylesheet：红线画不出，断链检测/修复仍在 */ }
  }

  function clearHighlights() {
    var api = hlApi();
    if (!api) return;
    try { api.delete(HL); } catch (e) {}
  }

  // 逐个 .add()（Highlight 是 Set-like）——不用 new Highlight(...ranges) 变参展开（撞引擎实参上限）。
  function makeHighlight(Ctor, ranges) {
    var h = new Ctor();
    for (var i = 0; i < ranges.length; i++) { try { h.add(ranges[i]); } catch (e) {} }
    return h;
  }

  function setBroken(ranges) {
    var api = hlApi(), Ctor = HLCtor();
    if (!api || !Ctor) return;
    if (!ranges.length) { clearHighlights(); return; }
    ensureSheet();
    try { api.set(HL, makeHighlight(Ctor, ranges)); } catch (e) {}
  }

  // ---- 断链扫描（step 1）：扫 a[href] → 相对链接 → 异步解析 → insideRoot&&!exists 的圈红虚线 ----
  // 触发时机：文档加载完成（wireEditor/attachBasic 尾）+ links-index-updated 推送（目标增删后自愈）。
  function scan(f) {
    if (f) frame = f;
    var d = cd();
    if (!d) return;
    // 悬停监听按 contentDocument 挂一次（换文档=新 doc，旧监听随旧 doc 失效；换文档时 wiredDoc 重置）
    if (d !== wiredDoc) {
      d.addEventListener('mouseover', onOver, false);
      d.addEventListener('mouseout', onOut, false);
      wiredDoc = d;
    }
    var Links = window.WS2Links;
    var resolve = window.ws2 && window.ws2.resolveDocLink;
    var docPath = (typeof window.__wsDocPath === 'function') ? window.__wsDocPath() : null;
    // 临时 / 无盘文档没有解析基准 → 不标断链（也不该有相对互链）。
    if (!Links || !resolve || !docPath) { clearHighlights(); return; }

    var anchors = [];
    var all = d.querySelectorAll('a[href]');
    for (var i = 0; i < all.length; i++) {
      var href = all[i].getAttribute('href');
      if (href && Links.classifyScheme(href) === 'relative') anchors.push({ a: all[i], href: href });
    }
    var g = ++scanGen;
    if (!anchors.length) { setBroken([]); return; }

    // 逐个并发异步解析（断链谓词严格 = insideRoot===true && exists===false，别写 r.miss/r.outside）。
    Promise.all(anchors.map(function (x) {
      return Promise.resolve(resolve(docPath, x.href)).then(function (r) {
        return (r && r.insideRoot === true && r.exists === false) ? x.a : null;
      }).catch(function () { return null; });
    })).then(function (results) {
      if (g !== scanGen) return;      // await 期间又扫了一次 / 切了文档 → 本次作废
      if (cd() !== d) return;         // iframe 文档已换 → 别把旧断链集合标到新文档
      var ranges = [];
      for (var j = 0; j < results.length; j++) {
        if (!results[j]) continue;
        try { var rg = d.createRange(); rg.selectNodeContents(results[j]); ranges.push(rg); } catch (e) {}
      }
      setBroken(ranges);
    });
  }

  // ---- 悬停预览卡（step 2）----
  // 卡 DOM 在父层 document.body（data-ws2-ui 防块编辑器误当内容；mousedown preventDefault 防塌 iframe 选区）。
  function ensureCard() {
    if (cardEl && document.body.contains(cardEl)) return;
    cardEl = document.createElement('div');
    cardEl.className = 'ws-linkview-card';
    cardEl.setAttribute('data-ws2-ui', '');
    cardEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
    cardEl.addEventListener('mouseenter', function () { clearTimeout(closeTimer); }); // 进卡不关（§5.1）
    cardEl.addEventListener('mouseleave', function () { closeTimer = setTimeout(closeCard, 200); }); // 出卡 200ms 关
    document.body.appendChild(cardEl);
  }
  function closeCard() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    hoverGen++; // 作废在飞的解析/读盘
    hoverAnchor = null;
    if (cardEl) cardEl.style.display = 'none';
  }
  // 定位：命中链接 rect（iframe 坐标）+ frame offset → 链接下方 +8，left 夹取（§5.1）。
  function positionCard(a) {
    if (!cardEl || !frame) return;
    var fr = frame.getBoundingClientRect();
    var r = a.getBoundingClientRect();
    var left = Math.min(Math.max(12, fr.left + r.left - 8), window.innerWidth - 312);
    cardEl.style.left = left + 'px';
    cardEl.style.top = (fr.top + r.bottom + 8) + 'px';
    cardEl.style.display = 'block';
  }
  function onOver(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    // web/anchor/越根/临时 → 不弹卡（只对站内相对链接）
    if (!href || !window.WS2Links || window.WS2Links.classifyScheme(href) !== 'relative') return;
    if (a === hoverAnchor) { clearTimeout(closeTimer); return; } // 已在这条上：别重开、别关
    clearTimeout(closeTimer); clearTimeout(openTimer);
    var g = ++hoverGen;
    openTimer = setTimeout(function () { resolveAndShow(a, href, g); }, 350); // §5.1：350ms 开
  }
  function onOut(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    clearTimeout(openTimer);                    // 350ms 内移开 → 不开
    closeTimer = setTimeout(closeCard, 250);    // 已开的 → 250ms 宽限关（§5.1）
  }
  function resolveAndShow(a, href, g) {
    var docPath = (typeof window.__wsDocPath === 'function') ? window.__wsDocPath() : null;
    var resolve = window.ws2 && window.ws2.resolveDocLink;
    if (!docPath || !resolve) return;
    Promise.resolve(resolve(docPath, href)).then(function (r) {
      if (g !== hoverGen) return;                       // 已移开 / 换文档
      if (!r || r.error || !r.insideRoot) return;       // 工作区外 / 解析失败：不弹
      if (r.exists === false) return;                   // 断链：step 3 修复卡接管（暂不弹）
      renderCard(a, r, g);
    }).catch(function () {});
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function openBtn(r) {
    var b = el('button', 'ws-linkview-act', '打开');
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (window.__wsOpenResolved) window.__wsOpenResolved(r);
      closeCard();
    });
    return b;
  }
  function renderCard(a, r, g) {
    ensureCard();
    if ((r.kind === 'html' || r.kind === 'md') && window.ws2 && window.ws2.readDoc) {
      Promise.resolve(window.ws2.readDoc(r.abs)).then(function (html) {
        if (g !== hoverGen) return;
        buildDocCard(r, html); hoverAnchor = a; positionCard(a);
      }).catch(function () {
        if (g !== hoverGen) return;
        buildDocCard(r, null); hoverAnchor = a; positionCard(a);
      });
    } else {
      buildFileCard(r); hoverAnchor = a; positionCard(a);
    }
  }
  function buildDocCard(r, html) {
    cardEl.className = 'ws-linkview-card';
    cardEl.innerHTML = '';
    var title = r.name, snippets = [];
    if (html) {
      try {
        var d = new DOMParser().parseFromString(html, 'text/html');
        var h1 = d.querySelector('h1'), tt = d.querySelector('title');
        title = (h1 && h1.textContent.trim()) || (tt && tt.textContent.trim()) || r.name;
        var kids = d.body ? Array.prototype.slice.call(d.body.children, 0, 4) : [];
        snippets = kids.map(function (b) { return snippet(b.textContent, 72); }).filter(Boolean);
      } catch (e) {}
    }
    var titleRow = el('div', 'ws-linkview-title');
    titleRow.appendChild(el('span', null, ICONS[r.kind] || ICONS.other));
    titleRow.appendChild(el('span', 'ws-linkview-title-text', title));
    cardEl.appendChild(titleRow);
    if (snippets.length) {
      var sn = el('div', 'ws-linkview-snippet');
      snippets.forEach(function (s) { sn.appendChild(el('div', null, s)); });
      cardEl.appendChild(sn);
    }
    var foot = el('div', 'ws-linkview-foot');
    foot.appendChild(el('span', 'ws-linkview-path', r.rel));
    foot.appendChild(openBtn(r));
    cardEl.appendChild(foot);
  }
  function buildFileCard(r) {
    cardEl.className = 'ws-linkview-card';
    cardEl.innerHTML = '';
    var titleRow = el('div', 'ws-linkview-title');
    titleRow.appendChild(el('span', null, ICONS[r.kind] || ICONS.other));
    titleRow.appendChild(el('span', 'ws-linkview-title-text', r.name));
    cardEl.appendChild(titleRow);
    cardEl.appendChild(el('div', 'ws-linkview-note', '非文档文件，打开后转交系统对应程序。'));
    var foot = el('div', 'ws-linkview-foot');
    foot.appendChild(el('span', 'ws-linkview-path', r.rel));
    foot.appendChild(openBtn(r));
    cardEl.appendChild(foot);
  }

  // 切/关文档统一收口（shell.js detachEditors 调）：清高亮 + 关卡 + 清定时器 + 作废在飞异步。
  function detach() {
    scanGen++; // 作废在飞的异步 scan
    clearHighlights();
    closeCard();
    frame = null; wiredDoc = null;
  }
  // 缩放/滚动/resize：直接关卡（最省心的正确解，抄 mention.reposition）。
  function reposition() { closeCard(); }

  var api = { scan: scan, detach: detach, reposition: reposition };
  if (typeof window !== 'undefined') window.WS2LinkView = api;
})();
