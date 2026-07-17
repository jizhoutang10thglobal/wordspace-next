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
 * 本文件实现：断链装饰（step 1）+ 站内链接悬停预览卡（step 2）+ 断链点击/悬停修复卡（step 3-4）。
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
      d.addEventListener('keydown', onKeyDown, false); // Esc 也要在 iframe 内收（点断链后焦点在 iframe，事件不冒泡过边界）
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
    installEsc();
  }
  // Esc 关卡（父层浮层惯例，抄 find.js；ui-demo 无此键，真 app 补上算修缺口不算行为偏离——§5.3）。
  var escWired = false;
  function installEsc() {
    if (escWired) return;
    document.addEventListener('keydown', onKeyDown, false); // 父层焦点时（如悬停卡）也能 Esc 关
    escWired = true;
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
  function onKeyDown(e) { if (e.key === 'Escape' && cardEl && cardEl.style.display === 'block') closeCard(); }
  function resolveAndShow(a, href, g) {
    var docPath = (typeof window.__wsDocPath === 'function') ? window.__wsDocPath() : null;
    var resolve = window.ws2 && window.ws2.resolveDocLink;
    if (!docPath || !resolve) return;
    Promise.resolve(resolve(docPath, href)).then(function (r) {
      if (g !== hoverGen) return;                       // 已移开 / 换文档
      if (!r || r.error || !r.insideRoot) return;       // 工作区外 / 解析失败：不弹
      if (r.exists === false) { buildRepairCard(a, r, g); return; } // 断链 → 修复卡（§5.3）
      renderCard(a, r, g);
    }).catch(function () {});
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function openBtn(r) {
    var b = el('button', 'ws-linkview-act', window.wsT('common.open'));
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
        // 摘要排除标题那个 h1（已作卡片标题显示，别重复）
        var kids = d.body ? Array.prototype.slice.call(d.body.children).filter(function (b) { return b !== h1; }).slice(0, 4) : [];
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
    cardEl.appendChild(el('div', 'ws-linkview-note', window.wsT('link.nonDocFileNote')));
    var foot = el('div', 'ws-linkview-foot');
    foot.appendChild(el('span', 'ws-linkview-path', r.rel));
    foot.appendChild(openBtn(r));
    cardEl.appendChild(foot);
  }

  // ---- 断链修复卡（step 3-4，§5.3）----
  // 点断链（shell.js onDocLinkClick）或 hover 断链 350ms → 同一张卡。含：重新指向候选（≤3，同根同名
  // 文档）+ 恒有「新建」（可创作类型才给：html/md）。修复动作走 __wsBeforeDocEdit/__wsAfterDocEdit 收口。
  function showRepair(a, r) {
    var g = ++hoverGen;
    clearTimeout(closeTimer); clearTimeout(openTimer);
    buildRepairCard(a, r, g);
  }
  function repairItem(icon, label, onClick) {
    var b = el('button', 'ws-linkview-repair-item');
    b.appendChild(el('span', null, icon));
    b.appendChild(el('span', 'ws-linkview-title-text', label));
    b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(); });
    return b;
  }
  function buildRepairCard(a, r, g) {
    ensureCard();
    cardEl.className = 'ws-linkview-card is-broken';
    cardEl.innerHTML = '';
    var titleRow = el('div', 'ws-linkview-title is-broken');
    titleRow.appendChild(el('span', null, '⚠'));
    titleRow.appendChild(el('span', 'ws-linkview-title-text', window.wsT('link.brokenTitle')));
    cardEl.appendChild(titleRow);
    cardEl.appendChild(el('div', 'ws-linkview-path', r.rel));
    cardEl.appendChild(el('div', 'ws-linkview-note', window.wsT('link.brokenNote')));
    var repairs = el('div', 'ws-linkview-repairs');
    cardEl.appendChild(repairs);
    hoverAnchor = a; positionCard(a);
    // 候选优先级（§5.3 U7 升级）：doc-id 全库匹配（原文件被外部改名/移动到哪了）> 同名文档 > 新建。
    var Links = window.WS2Links;
    var ctx = window.__wsDocContext && window.__wsDocContext();
    var sourceRel = ctx && ctx.rel;
    var mtP = (sourceRel && window.ws2 && window.ws2.linksMovedTarget) ? Promise.resolve(window.ws2.linksMovedTarget(r.rootId, sourceRel, r.rel)) : Promise.resolve(null);
    var qP = (window.ws2 && window.ws2.linksQuery) ? Promise.resolve(window.ws2.linksQuery(r.rootId)) : Promise.resolve([]);
    Promise.all([mtP, qP]).then(function (res) {
      if (g !== hoverGen) return;
      var moved = res[0], list = res[1] || [], added = {};
      // ① doc-id 反查到的现址：原文件已移动/改名到这里（最强候选，置顶）
      if (moved) { repairs.appendChild(repairItem('↪', window.wsT('link.repointMoved', { target: moved }), function () { doRepoint(a, r, moved); })); added[moved] = 1; }
      // ② 同根同名文档（linksQuery 只回文档 → pdf/图片天然不入）
      var want = Links.baseOf(r.rel);
      (list).filter(function (f) { return f.rel !== r.rel && !added[f.rel] && Links.baseOf(f.rel) === want; })
        .slice(0, 3)
        .forEach(function (c) { repairs.appendChild(repairItem('↩', window.wsT('link.repoint', { target: c.rel }), function () { doRepoint(a, r, c.rel); })); });
      // ③ 「新建」——仅对编辑器可创作的类型（html/md）；断链指向 pdf/图片等无从「新建」。
      if (r.kind === 'html' || r.kind === 'md') {
        var dir = Links.dirOf(r.rel);
        repairs.appendChild(repairItem('＋', window.wsT('link.createIn', { dir: dir || window.wsT('link.rootDir'), name: r.name }), function () { doCreate(a, r); })); // i18n-exempt（＋ 是新建按钮字形，非可翻译文案；title 已 wsT）
      }
      // ①②③ 都是「系统的智能猜测」（可能没有 / 猜错）。下面两条是恒有的手动兜底：
      // 系统找不到时让用户自己在 Finder 里指、或彻底断了就删掉链接（保留文字）——分隔线区隔。
      var sep = el('div', 'ws-linkview-repair-sep'); repairs.appendChild(sep);
      repairs.appendChild(repairItem('📁', window.wsT('link.browsePick'), function () { doPickAndRepoint(a, r); }));
      repairs.appendChild(repairItem('✕', window.wsT('link.deleteLinkKeepText'), function () { doDeleteLink(a); }));
      positionCard(a); // 内容高度变了 → 重新夹取 left/top
    }).catch(function () {});
  }
  // 手动兜底①：浏览选文件 → 同工作区则重新指向；工作区外无法建相对链接（提示）。
  function doPickAndRepoint(a, r) {
    var ctx = window.__wsDocContext && window.__wsDocContext();
    if (!ctx || !window.ws2 || !window.ws2.pickFile) return;
    Promise.resolve(window.ws2.pickFile()).then(function (abs) {
      if (!abs) return; // 用户取消
      return Promise.resolve(window.ws2.classifyFile(abs)).then(function (m) {
        if (!m || m.rootId !== ctx.rootId || m.rel == null) {
          if (window.__wsToast) window.__wsToast(window.wsT('link.fileOutsideWorkspace'));
          closeCard(); return;
        }
        doRepoint(a, r, m.rel); // 复用重新指向（保尾缀 + 编辑收口 + 自愈）
      });
    }).catch(function () {});
  }
  // 手动兜底②：文件确实没了 → 拆掉 <a>、保留其文字（unwrap），断链装饰随之消失。
  function doDeleteLink(a) {
    var d = cd();
    if (!d || !d.contains(a)) { if (window.__wsToast) window.__wsToast(window.wsT('link.linkGone')); closeCard(); return; }
    if (window.__wsBeforeDocEdit) window.__wsBeforeDocEdit();
    var parent = a.parentNode;
    while (a.firstChild) parent.insertBefore(a.firstChild, a); // 文字移出到原位
    parent.removeChild(a);
    if (window.__wsAfterDocEdit) window.__wsAfterDocEdit();
    if (window.__wsToast) window.__wsToast(window.wsT('link.linkDeleted'));
    closeCard();
    scan(frame);
  }
  // 重新指向：flush 待定编辑 → 保留原 href 尾缀 → relHref 重算只改这一条 <a> → 标脏+checkpoint → 装饰自愈。
  // candRel 属于 r.rootId（linksMovedTarget / linksQuery 都查的 r.rootId）。目标与当前文档同根 → 同根 relHref；
  // 跨根（A）→ relHrefAbs（两端 abs 经 wsAbs 取，tree 域）。跨根算不出（不同磁盘卷）→ 提示、不动。
  function doRepoint(a, r, candRel) {
    var ctx = window.__wsDocContext && window.__wsDocContext();
    var d = cd();
    if (!ctx || !d || !d.contains(a)) { // <a> 已不在当前文档（切走 / 块删）→ 不动任何东西（§5.3）
      if (window.__wsToast) window.__wsToast(window.wsT('link.linkGoneNoRepoint'));
      closeCard(); return;
    }
    var Links = window.WS2Links;
    var suffix = Links.splitHrefSuffix(a.getAttribute('href') || '')[1]; // #锚点/?查询 尾缀保留（L2）
    var targetRoot = (r.rootId != null) ? r.rootId : ctx.rootId;
    var hrefP;
    if (targetRoot === ctx.rootId) {
      hrefP = Promise.resolve(Links.relHref(ctx.rel, candRel) + suffix);
    } else { // 跨根重新指向：绝对相对（A）
      hrefP = Promise.all([window.ws2.wsAbs(ctx.rootId, ctx.rel), window.ws2.wsAbs(targetRoot, candRel)])
        .then(function (ab) { var h = ab[0] && ab[1] ? Links.relHrefAbs(ab[0], ab[1]) : null; return h ? h + suffix : null; });
    }
    hrefP.then(function (newHref) {
      if (!newHref) { if (window.__wsToast) window.__wsToast(window.wsT('link.crossSpaceCalcFail')); closeCard(); return; }
      if (!d.contains(a)) { if (window.__wsToast) window.__wsToast(window.wsT('link.linkGoneNoRepoint')); closeCard(); return; } // 异步窗口内切走了
      if (window.__wsBeforeDocEdit) window.__wsBeforeDocEdit();
      a.setAttribute('href', newHref);
      if (window.__wsAfterDocEdit) window.__wsAfterDocEdit();
      if (window.__wsToast) window.__wsToast(window.wsT('link.repointed', { target: candRel }));
      closeCard();
      scan(frame); // 即时自愈，别等存盘/reindex
    }).catch(function () { closeCard(); });
  }
  // 新建：目录=断链目标目录、名=目标名去扩展、扩展名按断链后缀（.md→.md 否则 .html）。不切走当前标签页。
  function doCreate(a, r) {
    var ctx = window.__wsDocContext && window.__wsDocContext();
    var create = window.__wsCreateLinkedDoc;
    if (!ctx || !create) { if (window.__wsToast) window.__wsToast(window.wsT('link.createFailed')); return; }
    var name = r.name.replace(/\.(html?|md)$/i, '');
    var ext = /\.md$/i.test(r.name) ? '.md' : '.html';
    closeCard();
    Promise.resolve(create(ctx.rootId, r.rel, name, ext)).then(function (res) { // fromRel=r.rel → dirOf 落到目标目录
      if (!res) { if (window.__wsToast) window.__wsToast(window.wsT('link.createFailed')); return; }
      if (window.__wsToast) window.__wsToast(window.wsT('link.createdNamed', { name: name }));
      scan(frame); // 目标现已存在 → 断链自愈
    }).catch(function () { if (window.__wsToast) window.__wsToast(window.wsT('link.createFailed')); });
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

  var api = { scan: scan, detach: detach, reposition: reposition, showRepair: showRepair };
  if (typeof window !== 'undefined') window.WS2LinkView = api;
})();
