// WS2Pagination —— 分页文档的 V4 分页引擎（Word 式「每页物理高严格 = 一张纸」）。
// 跑在父层 renderer、操作 sandbox iframe 的 contentDocument（同 blockedit 惯例）：
// 样式走 adoptedStyleSheets（CSSOM，不入序列化）；注入的节点打 data-ws2-ui sentinel
// （serialize.cleanRoot 按值整删）；内容元素上的推挤（paddingTop/marginTop）打 data-ws-pushed
// 标记（serialize.cleanRoot / buildWordspacePrintHtml 剥除样式）——分页产物绝不进持久化数据。
//
// 结构（对齐 ui-demo Canvas.tsx 的 V4 recalc，见 docs/features/paged-doc.md）：
//   · 纸面 = body（白纸、宽 = 纸张 px、padding = 页边距、灰底画在 html 上）；
//   · 块级分页 = 给「开新页的块」加运行时 marginTop 推挤（不插流内兄弟节点——否则会
//     搅乱 blockedit 的兄弟遍历/margin 折叠账；推挤量补偿实测的折叠间距，页高恒等）；
//   · 超高块带留白分页 = 块内切分点「真推内容」：li 等元素加 paddingTop、表格插 spacer 行、
//     pre 沿逻辑行（\n/<br>）插 display:block 的 spacer span；
//   · 每个页界画一个覆盖层「留白遮罩」（白底盖住块自身延续的灰底/边框 + 灰缝 + 页码 chip），
//     覆盖层原点 = 纸（body）padding 盒、pointer-events:none（铁则④）。
//
// 四铁则（ui-demo V4 血泪，移植必守）：
//   ① 清理走「选择器全量扫荡」——contenteditable 回车会分裂元素并继承 style/data-ws-pushed，
//      按引用清理永远漏掉克隆、padding 越积越大。每轮 recalc 先扫掉全部推挤痕迹再测量。
//   ② 灰缝锚定「实测推挤位置」——推完量锚点真实 rect 画缝，内容在哪缝在哪，不用几何网格反推。
//   ③ 扫荡→测量→重推同帧（rAF/RO 回调在绘制前）完成，无闪烁；末态不变时 RO 不再触发 → 收敛。
//   ④ 覆盖层坐标原点 = 纸 padding 盒（body position:relative + overlay inset:0）。
//
// 缩放共存：shell 的 body{zoom} 会让 getBoundingClientRect 返回视觉 px——统一用
// 「实测 body 宽 / body.offsetWidth」反推有效缩放，全部几何换算回 CSS px 再算分页。
(function (global) {
  const WSPage = (typeof WS2SchemaPage !== 'undefined') ? WS2SchemaPage
    : (typeof require !== 'undefined' ? require('../lib/schema-page.js') : null);
  const WS2_OVERLAY = (((typeof WS2Serialize !== 'undefined') ? WS2Serialize
    : (typeof require !== 'undefined' ? require('./serialize.js') : {})).OVERLAY_VAL) || '__ws2-overlay__';
  const BlockEditRef = () => (typeof WS2BlockEdit !== 'undefined') ? WS2BlockEdit
    : (typeof require !== 'undefined' ? require('./blockedit.js') : null);

  const GAP = WSPage ? WSPage.PAGE_GAP_PX : 24;
  // i18n：renderer 全局 t()（node/test 上下文无 wsT 时回退 key，防 require 期崩）。
  const T = (k, p) => (global.wsT ? global.wsT(k, p) : k);

  // 覆盖层/纸面样式（运行时，不入盘）。纸方墨圆：方角白纸 + 1px 细边（box-shadow 画）+ 淡阴影。
  const CHROME_CSS =
    ':where(html){background:#efeeeb}' +
    '.ws-pgn-overlay{position:absolute;inset:0;pointer-events:none;z-index:2}' +
    // 留白遮罩：白底整段盖住页界（fill+页底边距+灰缝+页顶边距），把超高块延续的灰底/边框切断
    '.ws-page-void{position:absolute;left:0;right:0;background:#fff}' +
    // 灰缝：左右各伸出 1px 把纸边线切断（纸边线 = body 的 box-shadow 1px 环）
    '.ws-page-gutter{position:relative;box-sizing:border-box;margin-left:-1px;margin-right:-1px;' +
      'background:#efeeeb;border-top:1px solid rgba(0,0,0,.08);border-bottom:1px solid rgba(0,0,0,.08);' +
      'display:flex;align-items:center;justify-content:center}' +
    '.ws-page-chip{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:10px;' +
      'line-height:15px;color:#9b9891;background:#efeeeb;padding:0 7px;border-radius:8px}';

  // 超高块的切分候选原子（V4）：干净几何下采集（调用方保证已扫荡掉一切推挤痕迹）。
  // 列表=li（含嵌套；同顶去重保留外层，整棵子树一起推）、表格=tr（跳过 spacer）、
  // pre=逻辑行（\n 之后 / <br> 之后），其余块级后代兜底。top 为相对块顶的干净 CSS px 坐标。
  // atom.kind：'el'（paddingTop 推）/ 'tr'（插 spacer 行）/ 'pre'（插 display:block spacer span）。
  function collectCutAtoms(doc, host, zoom) {
    const base = host.getBoundingClientRect().top;
    const rel = (v) => (v - base) / zoom;
    const atoms = [];
    host.querySelectorAll('li, p, blockquote, figure, hr, h1, h2, h3, h4').forEach((e) => {
      if (e.closest('table') || e.closest('pre')) return;
      if (e.hasAttribute('data-ws2-ui')) return;
      atoms.push({ top: rel(e.getBoundingClientRect().top), kind: 'el', el: e });
    });
    host.querySelectorAll('tr').forEach((e) => {
      if (e.classList.contains('ws-page-spacer')) return;
      atoms.push({ top: rel(e.getBoundingClientRect().top), kind: 'tr', el: e });
    });
    // pre 逻辑行：真 app 没有 .ws-code-line 行元素，pre 是整块——沿真实换行（\n / <br>）取切点，
    // 推挤 = 在该文本位置插 display:block 的 spacer span（pre-wrap 的视觉折行不算切点，Word 同款粒度；
    // 一段 \n 之间的折行区超页高时由 computeInnerSplits 的「切不动→拉长」兜底）。
    const pres = host.tagName === 'PRE' ? [host] : [...host.querySelectorAll('pre')];
    for (const pre of pres) {
      const walker = doc.createTreeWalker(pre, 4 /* NodeFilter.SHOW_TEXT */);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('[data-ws2-ui]')) continue;
        const text = node.nodeValue || '';
        let idx = text.indexOf('\n');
        while (idx !== -1) {
          const off = idx + 1;
          if (off < text.length) {
            const r = doc.createRange();
            r.setStart(node, off); r.setEnd(node, Math.min(off + 1, text.length));
            const rr = r.getBoundingClientRect();
            if (rr.height > 0) atoms.push({ top: rel(rr.top), kind: 'pre', node, offset: off });
          }
          idx = text.indexOf('\n', idx + 1);
        }
      }
      pre.querySelectorAll('br').forEach((br) => {
        const r = doc.createRange();
        try { r.setStartAfter(br); r.setEnd(br.parentNode, Math.min(r.startOffset + 1, br.parentNode.childNodes.length)); } catch (e) { return; }
        const rr = r.getBoundingClientRect();
        if (rr.height > 0) atoms.push({ top: rel(rr.top), kind: 'pre', node: br, offset: -1 }); // offset -1 = 插在 br 之后
      });
    }
    atoms.sort((a, b) => a.top - b.top);
    const out = [];
    for (const a of atoms) if (!out.length || a.top - out[out.length - 1].top > 1) out.push(a);
    return out;
  }

  function attach(doc, deps) {
    const win = deps.win || doc.defaultView;
    const config = deps.config;
    const box = WSPage.pageBoxPx(config);
    const gapUnit = box.marginBottom + GAP + box.marginTop; // 页底边距 + 灰缝 + 页顶边距

    // ---- 样式：纸面（静态）+ 末页补白 min-height（recalc 动态改写）----
    let paperSheet = null, dynSheet = null;
    const paperCss = () =>
      CHROME_CSS +
      'body{box-sizing:border-box;width:' + box.pageW + 'px;max-width:none;margin:24px auto;' +
        'padding:' + box.marginTop + 'px ' + box.marginRight + 'px ' + box.marginBottom + 'px ' + box.marginLeft + 'px;' +
        'background:#fff;border-radius:0;position:relative;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 14px rgba(0,0,0,.06);overflow-wrap:anywhere}' +
      // 分页下 pre 折行（不横向顶破纸面；与导出 PAGED_PRINT_CSS 同口径）
      'pre{white-space:pre-wrap;overflow-wrap:anywhere;overflow-x:visible}';
    try {
      paperSheet = new (win.CSSStyleSheet || CSSStyleSheet)();
      paperSheet.replaceSync(paperCss());
      dynSheet = new (win.CSSStyleSheet || CSSStyleSheet)();
      dynSheet.replaceSync('body{min-height:' + box.pageH + 'px}');
      doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets || []), paperSheet, dynSheet];
    } catch (e) { /* 构造样式表不可用：无纸面视觉，编辑不受影响 */ }

    // ---- 覆盖层（页界留白遮罩宿主；data-ws2-ui 存盘整删；铁则④：挂在 body 下、原点=纸 padding 盒）----
    const overlay = doc.createElement('div');
    overlay.setAttribute('data-ws2-ui', WS2_OVERLAY);
    overlay.setAttribute('contenteditable', 'false');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.className = 'ws-pgn-overlay';
    doc.body.appendChild(overlay);

    let lastPageCount = 1;
    let lastMinH = -1;

    // 铁则①：选择器全量扫荡——清掉一切推挤痕迹（含回车分裂继承出来的克隆），回到干净几何。
    function sweep() {
      doc.body.querySelectorAll('[data-ws-pushed]').forEach((n) => {
        n.style.paddingTop = '';
        n.style.marginTop = '';
        n.removeAttribute('data-ws-pushed');
        if (!n.getAttribute('style')) n.removeAttribute('style');
      });
      const sel = doc.getSelection();
      const selNode = (sel && sel.rangeCount) ? sel.getRangeAt(0).startContainer : null;
      doc.body.querySelectorAll('.ws-page-spacer').forEach((n) => {
        // pre 的 spacer span 移除后顺手合并两侧被 splitText 劈开的文本节点（防长会话碎片化），
        // 但光标正落在其中一侧时跳过合并（合并会丢 selection），留到光标移走的下一轮。
        const prev = n.previousSibling, next = n.nextSibling;
        n.remove();
        if (prev && next && prev.nodeType === 3 && next.nodeType === 3
          && selNode !== prev && selNode !== next) {
          prev.appendData(next.data);
          next.remove();
        }
      });
      overlay.textContent = '';
    }

    function recalc() {
      const body = doc.body;
      if (!body || !body.isConnected) return;
      sweep();

      const BE = BlockEditRef();
      const blockRoot = (BE && BE.pickBlockRoot) ? BE.pickBlockRoot(body) : body;
      const blocks = [...blockRoot.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui'));

      const bodyRect = body.getBoundingClientRect();
      const zoom = body.offsetWidth > 0 ? (bodyRect.width / body.offsetWidth) : 1; // 实测反推有效缩放（shell 注 body{zoom}）
      const originTop = bodyRect.top + box.marginTop * zoom; // 页内容区顶（body padding 盒顶 + 页顶边距）
      const relY = (v) => (v - originTop) / zoom;

      // 测量（干净几何、内容坐标 CSS px）。块高用「相邻块顶差」——真 app 的块是裸元素、
      // 兄弟 margin 会折叠，rect 高不含间距；顶差把折叠后的实际间距记在前一块头上。
      const tops = [], bottoms = [];
      for (const el of blocks) {
        const r = el.getBoundingClientRect();
        tops.push(relY(r.top));
        bottoms.push(relY(r.bottom));
      }
      const heights = [blocks.length ? Math.max(0, tops[0]) : 0]; // 伪块 0 = 首块前导空隙（首块 margin）
      for (let i = 0; i < blocks.length; i++) {
        if (i < blocks.length - 1) heights.push(Math.max(0, tops[i + 1] - tops[i]));
        else {
          const cs = win.getComputedStyle(blocks[i]);
          heights.push(Math.max(0, bottoms[i] - tops[i] + (parseFloat(cs.marginBottom) || 0)));
        }
      }

      // 超高块：干净几何下采集切分原子 → computeInnerSplits 算切分计划；切不动（单张超页高图 /
      // pre 单段折行区超页高）→ innerCutTops 给 null → paginateBlocks 走跨页拉长兜底。
      const innerCutTops = [null];
      const plans = [null];
      blocks.forEach((el, i) => {
        const h = heights[i + 1];
        if (h <= box.contentH) { innerCutTops.push(null); plans.push(null); return; }
        const atoms = collectCutAtoms(doc, el, zoom);
        const cuts = WSPage.computeInnerSplits(atoms.map((a) => a.top), h, box.contentH);
        innerCutTops.push(cuts.length ? cuts.map((c) => c.top) : null);
        plans.push(cuts.length ? { atoms, cuts } : null);
      });

      const r = WSPage.paginateBlocks(heights, box.contentH, innerCutTops);

      // ---- 真推内容 ----
      // 块级切页：开新页的块加运行时 marginTop。推挤量 = 实测折叠间距 g + fill + gapUnit
      // （marginTop 会替换掉原折叠 margin → 补回 g，块顶恰落到下一页内容区顶，每页恒一张纸）。
      const pends = []; // { anchorEl, fill, page, kind } —— 推完统一实测锚点画缝（铁则②）
      blocks.forEach((el, i) => {
        const g = r.gapBefore[i + 1];
        if (g === null) return;
        const prevBottom = i > 0 ? bottoms[i - 1] : 0;
        const collapsed = Math.max(0, tops[i] - prevBottom); // 干净几何下的实际块间距（含折叠）
        el.style.marginTop = (collapsed + g + gapUnit) + 'px';
        el.setAttribute('data-ws-pushed', '');
        pends.push({ anchorEl: el, fill: g, page: r.pageOfBlock[i + 1] + 1, kind: 'block' });
      });
      // 块内切分：li/其余元素 paddingTop、表格插 spacer 行、pre 插 display:block spacer span。
      blocks.forEach((el, i) => {
        const plan = plans[i + 1];
        if (!plan) return;
        const startPage = r.pageOfBlock[i + 1]; // 0-based 块起始页
        plan.cuts.forEach((cut, k) => {
          const atom = plan.atoms[cut.atom];
          if (!atom) return;
          const push = cut.fill + gapUnit;
          let anchor = null;
          if (atom.kind === 'tr' && atom.el.isConnected) {
            const spacer = doc.createElement('tr');
            spacer.className = 'ws-page-spacer';
            spacer.setAttribute('data-ws2-ui', WS2_OVERLAY);
            spacer.setAttribute('contenteditable', 'false');
            spacer.setAttribute('aria-hidden', 'true');
            const td = doc.createElement('td');
            td.setAttribute('colspan', '99');
            td.setAttribute('style', 'height:' + push + 'px;padding:0;border:0;background:transparent');
            spacer.appendChild(td);
            atom.el.parentElement && atom.el.parentElement.insertBefore(spacer, atom.el);
            anchor = spacer;
          } else if (atom.kind === 'pre') {
            const spacer = doc.createElement('span');
            spacer.className = 'ws-page-spacer';
            spacer.setAttribute('data-ws2-ui', WS2_OVERLAY);
            spacer.setAttribute('contenteditable', 'false');
            spacer.setAttribute('aria-hidden', 'true');
            spacer.setAttribute('style', 'display:block;height:' + push + 'px;padding:0;margin:0');
            try {
              if (atom.offset === -1) { // <br> 之后
                if (!atom.node.isConnected) return;
                atom.node.parentNode.insertBefore(spacer, atom.node.nextSibling);
              } else {
                if (!atom.node.isConnected) return;
                const rest = atom.node.splitText(atom.offset);
                rest.parentNode.insertBefore(spacer, rest);
              }
            } catch (e) { return; }
            anchor = spacer;
          } else if (atom.kind === 'el' && atom.el.isConnected) {
            atom.el.style.paddingTop = push + 'px';
            atom.el.setAttribute('data-ws-pushed', '');
            anchor = atom.el;
          }
          if (anchor) pends.push({ anchorEl: anchor, fill: cut.fill, page: startPage + k + 2, kind: 'inner' });
        });
      });

      // ---- 铁则②：推完统一实测锚点位置，缝画在腾出的空档里（内容在哪缝在哪）----
      // 坐标原点 = 纸 padding 盒（overlay inset:0；body 无 border → padding 盒 = rect 盒）。
      const paperTop = body.getBoundingClientRect().top;
      const frag = doc.createDocumentFragment();
      for (const p of pends) {
        const zoneH = p.fill + gapUnit;
        const anchorTop = (p.anchorEl.getBoundingClientRect().top - paperTop) / zoom;
        // 块级推挤：锚点 = 被推的块，空档在它上方；块内推挤：锚点（paddingTop 元素顶 / spacer 顶）= 空档起点
        const top = p.kind === 'block' ? (anchorTop - zoneH) : anchorTop;
        const mask = doc.createElement('div');
        mask.className = 'ws-page-void' + (p.kind === 'inner' ? ' ws-inner-void' : '');
        mask.style.top = top + 'px';
        mask.style.height = zoneH + 'px';
        const gutter = doc.createElement('div');
        gutter.className = 'ws-page-gutter' + (p.kind === 'inner' ? ' ws-inner-gutter' : '');
        gutter.style.height = GAP + 'px';
        gutter.style.marginTop = (p.fill + box.marginBottom) + 'px';
        const chip = doc.createElement('span');
        chip.className = 'ws-page-chip';
        chip.textContent = T('editor.pageNumber', { page: p.page });
        gutter.appendChild(chip);
        mask.appendChild(gutter);
        frag.appendChild(mask);
      }
      overlay.appendChild(frag);

      // ---- 末页补白：纸总高 = 页数×(纸高+缝) − 缝（min-height 兜住，短文档/末页收在整页底）----
      lastPageCount = r.pageCount;
      const minH = r.pageCount * (box.pageH + GAP) - GAP;
      if (dynSheet && Math.abs(minH - lastMinH) > 0.5) {
        lastMinH = minH;
        try { dynSheet.replaceSync('body{min-height:' + minH + 'px}'); } catch (e) {}
      }
    }

    // 内容/窗口变化重算：rAF 合帧，扫荡→测量→重推同帧完成（铁则③）；末态不变时 RO 不再触发 → 收敛。
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = (win.requestAnimationFrame || global.requestAnimationFrame || setTimeout)(() => { raf = 0; recalc(); });
    };
    let ro = null;
    try {
      ro = new win.ResizeObserver(schedule);
      ro.observe(doc.body);
      const blockRoot0 = (BlockEditRef() && BlockEditRef().pickBlockRoot) ? BlockEditRef().pickBlockRoot(doc.body) : doc.body;
      if (blockRoot0 !== doc.body) ro.observe(blockRoot0);
    } catch (e) { /* 无 RO：退化为 input/resize 触发 */ }
    doc.addEventListener('input', schedule);
    win.addEventListener('resize', schedule);

    // 页间空白/页底留白可点：点到纸面空白（body/html/包裹容器，不在任何块内）→ 光标路由到
    // 上方最近块（合成一次块内点击，复用 blockedit 的 enterEdit 全套判定）。点最后一块下方的
    // 空白 blockedit 自己已处理（文末续写），这里只接管「页间」的死区。
    function onGapClick(e) {
      const t = e.target;
      if (!t || (t.closest && t.closest('[data-ws2-ui]'))) return;
      if (t !== doc.body && t !== doc.documentElement) {
        // 包裹容器（blockRoot != body）上的点击也算空白；块内点击不管
        const BE = BlockEditRef();
        const rootNow = (BE && BE.pickBlockRoot) ? BE.pickBlockRoot(doc.body) : doc.body;
        if (t !== rootNow) return;
      }
      const rootNow2 = (BlockEditRef() && BlockEditRef().pickBlockRoot) ? BlockEditRef().pickBlockRoot(doc.body) : doc.body;
      const blocks = [...rootNow2.children].filter((c) => c.nodeType === 1 && !c.hasAttribute('data-ws2-ui'));
      if (!blocks.length) return;
      const last = blocks[blocks.length - 1];
      if (e.clientY > last.getBoundingClientRect().bottom) return; // 文末空白：blockedit 的续写分支管
      let above = null;
      for (const b of blocks) { if (b.getBoundingClientRect().bottom <= e.clientY) above = b; else break; }
      if (!above) return;
      const ar = above.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX, ar.left + 4), ar.right - 4);
      const y = ar.bottom - Math.min(8, ar.height / 2);
      try {
        above.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      } catch (err) { /* 路由失败不致命 */ }
    }
    doc.addEventListener('click', onGapClick);

    schedule();

    return {
      refresh: schedule,
      pages: () => lastPageCount,
      detach() {
        try { if (ro) ro.disconnect(); } catch (e) {}
        doc.removeEventListener('input', schedule);
        doc.removeEventListener('click', onGapClick);
        win.removeEventListener('resize', schedule);
        if (raf) { try { (win.cancelAnimationFrame || global.cancelAnimationFrame || clearTimeout)(raf); } catch (e) {} raf = 0; }
        try { sweep(); } catch (e) {}
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        try {
          doc.adoptedStyleSheets = (doc.adoptedStyleSheets || []).filter((s) => s !== paperSheet && s !== dynSheet);
        } catch (e) {}
      },
    };
  }

  const api = { attach, collectCutAtoms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2Pagination = api;
})(typeof window !== 'undefined' ? window : globalThis);
