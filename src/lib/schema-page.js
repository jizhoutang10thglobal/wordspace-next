// 分页文档页面模型：纸张/方向/边距的单一真相源 + 分页点纯计算（对齐 ui-demo src/lib/page.ts）。
// 纯逻辑、无 DOM/Electron 依赖。产品口径（Colin 2026-07-08 拍板）：分页不是独立 Schema，
// 是 Schema 1 文档的可选版式设置——入盘格式 = head 里 <style data-ws-schema-css="page"> 的标准
// @page CSS（本就在 Schema 1 head 白名单内）。带且可解析 → 分页视图/分页导出；写坏了只是分页
// 不生效，不降级不换 schema（见 docs/features/paged-doc.md）。
// buildPageCss(cfg) 生成 canonical 块；parsePageCss(text) 严格解析（确定性：解析不出 → 非分页文档）。
// 双导出：node require / 渲染层 window.WS2SchemaPage。
(function (global) {
  // 纸张尺寸（mm，纵向 宽×高）。key 同时是 @page size 关键字（CSS 标准值）。
  const PAGE_SIZES = {
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
    Letter: { w: 215.9, h: 279.4 },
    Legal: { w: 215.9, h: 355.6 },
  };
  const ORIENTATIONS = ['portrait', 'landscape'];
  const MM_PER_IN = 25.4;
  const PX_PER_MM = 96 / MM_PER_IN; // 96dpi：A4 宽 210mm → 794px（与 pdf-export A4_WIDTH_PX 一致）

  const DEFAULT_PAGE = Object.freeze({
    size: 'A4',
    orientation: 'portrait',
    margin: Object.freeze({ top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }), // Word 默认 1in
  });

  // 边距预设（mm）。宽 = 上下普通、左右加宽（Word 同款语义）。custom 不在此表。
  const MARGIN_PRESETS = {
    normal: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
    narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
    wide: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
  };

  // 页间灰缝高度（屏显视觉，打印不存在）。
  const PAGE_GAP_PX = 24;

  // mm 数值 → 入盘字符串：至多 1 位小数、去尾零（25.4→"25.4"，25→"25"）。
  function fmt(n) {
    const r = Math.round(n * 10) / 10;
    return String(r);
  }

  // 纸张外框（mm，已按方向换算）
  function pageDims(cfg) {
    const s = PAGE_SIZES[cfg.size];
    return cfg.orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
  }

  // 页几何（px @96dpi）：分页引擎 / 导出用。
  function pageBoxPx(cfg) {
    const d = pageDims(cfg);
    const m = cfg.margin;
    const mm2px = (v) => v * PX_PER_MM;
    return {
      pageW: mm2px(d.w), pageH: mm2px(d.h),
      contentW: mm2px(d.w - m.left - m.right),
      contentH: mm2px(d.h - m.top - m.bottom),
      marginTop: mm2px(m.top), marginRight: mm2px(m.right),
      marginBottom: mm2px(m.bottom), marginLeft: mm2px(m.left),
    };
  }

  // canonical page CSS：只有一条 @page（纸张+边距）。屏显纸面版式由分页引擎运行时给（不入盘）；
  // 打印辅助规则（break-inside 等）由导出时烤进打印 HTML（PAGED_PRINT_CSS），同样不入盘。
  // 手动分页符已删（Colin 2026-07-09 拍板）——canonical 不再有 .ws-page-break。
  function buildPageCss(cfg) {
    const m = cfg.margin;
    return '@page{size:' + cfg.size + ' ' + cfg.orientation + ';' +
      'margin:' + fmt(m.top) + 'mm ' + fmt(m.right) + 'mm ' + fmt(m.bottom) + 'mm ' + fmt(m.left) + 'mm}';
  }

  // 导出打印 HTML 的分页辅助（烤进临时打印文件、不入盘）：
  //   body 版式还原为 @page 内容区（中和 baseline 的 max-width/padding，否则页边距会被加倍）；
  //   顶层块整块换页 + tr/li 边界断行（与屏显块级分页/块内切分同口径；超页高块 avoid 不可满足时
  //   Chromium 自动放行、在 tr/li 边界找断点）；无空格长串在纸内折行、pre 用 pre-wrap（与屏显同口径）。
  const PAGED_PRINT_CSS =
    'body{max-width:none;width:auto;margin:0;padding:0;overflow-wrap:anywhere}\n' +
    'body>*{break-inside:avoid}\n' +
    'tr,li{break-inside:avoid}\n' +
    'pre{white-space:pre-wrap;overflow-wrap:anywhere}';

  // ---- 严格解析（确定性来源）----
  // 接受面刻意窄：仅一条 @page（size 白名单 + 可选方向 + margin 1/2/4 值、单位必须 mm）。
  // 出现别的选择器 / at-rule / 危险 token / 语法残渣 → null（不认，不是分页文档）。
  const DANGER = /(url\s*\(|expression\s*\(|@import|-moz-binding|behavior\s*:|javascript:|position\s*:\s*(fixed|sticky|absolute))/i;

  function parseMargin(str) {
    const parts = String(str).trim().split(/\s+/);
    if (parts.length !== 1 && parts.length !== 2 && parts.length !== 4) return null;
    const vals = [];
    for (const p of parts) {
      const m = /^(\d+(?:\.\d+)?)mm$/.exec(p);
      if (!m) return null; // 单位必须 mm（canonical；cm/in/px 一律不认，保持确定性）
      vals.push(parseFloat(m[1]));
    }
    if (vals.length === 1) return { top: vals[0], right: vals[0], bottom: vals[0], left: vals[0] };
    if (vals.length === 2) return { top: vals[0], right: vals[1], bottom: vals[0], left: vals[1] };
    return { top: vals[0], right: vals[1], bottom: vals[2], left: vals[3] };
  }

  function parsePageCss(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    if (DANGER.test(text)) return null;
    // 拆规则：selector{body} 序列。嵌套花括号不存在于接受面里，简单扫描即可。
    const rules = [];
    let rest = text.trim();
    while (rest) {
      const m = /^([^{}]+)\{([^{}]*)\}\s*/.exec(rest);
      if (!m) return null; // 语法残渣（含注释/嵌套/裸文本）→ 不认
      rules.push({ sel: m[1].trim(), body: m[2].trim() });
      rest = rest.slice(m[0].length);
    }
    if (rules.length !== 1 || rules[0].sel !== '@page') return null; // 只认「恰好一条 @page」
    let size = null, orientation = 'portrait', margin = null;
    for (const decl of rules[0].body.split(';')) {
      const d = decl.trim();
      if (!d) continue;
      const kv = /^([a-z-]+)\s*:\s*(.+)$/i.exec(d);
      if (!kv) return null;
      const prop = kv[1].toLowerCase(); const val = kv[2].trim();
      if (prop === 'size') {
        const sm = /^([A-Za-z0-9]+)(?:\s+(portrait|landscape))?$/.exec(val);
        if (!sm || !PAGE_SIZES[sm[1]]) return null; // 纸张必须在白名单（自定义 mm 尺寸 v2 再说）
        size = sm[1];
        if (sm[2]) orientation = sm[2];
      } else if (prop === 'margin') {
        margin = parseMargin(val);
        if (!margin) return null;
      } else {
        return null; // @page 里只认 size/margin（marks/bleed/@top-center 等一律不认）
      }
    }
    if (!size) return null;
    return { size, orientation, margin: margin || { ...DEFAULT_PAGE.margin } };
  }

  // ==========================================================================
  // 分页点纯计算（语义 = ui-demo src/lib/page.ts 的 paginateBlocks/computeInnerSplits，逐行移植）
  // ==========================================================================

  // 超高块的「块内切分点」：沿块内后代元素边界（li/tr/pre 行…）把超页高的块切成多页。
  // - atomTops：候选切分后代的 top（相对块顶、未被推挤的原始坐标；内部会排序）；
  // - blockH：块总高；pageContentH：页内容高；startOffset：块顶在起始页已用高度
  //   （超高块按 paginateBlocks 规则总从新页顶开始 → 通常 0）。
  // 返回升序切分序列：atom = 下一页首元素在排序后 atomTops 的下标，top = 其原始坐标，
  // fill = 切点上方当前页收尾的剩余留白。语义 = Word：每页装到「最后一个还装得下的边界」；
  // 某段内部再无边界（单张超页高图）→ 停止，剩余部分拉长纸面兜底。
  function computeInnerSplits(atomTops, blockH, pageContentH, startOffset) {
    if (!(pageContentH > 0)) return [];
    const tops = [...atomTops].sort((a, b) => a - b);
    const cuts = [];
    let lastCut = 0;
    let pageEnd = pageContentH - Math.max(0, startOffset || 0);
    while (pageEnd < blockH) {
      let pick = -1;
      for (let i = 0; i < tops.length; i++) {
        // 切点必须严格推进（>1px 防同点重切死循环）且落在当前页内
        if (tops[i] > lastCut + 1 && tops[i] <= pageEnd) pick = i;
      }
      if (pick < 0) break;
      cuts.push({ atom: pick, top: tops[pick], fill: pageEnd - tops[pick] });
      lastCut = tops[pick];
      pageEnd = lastCut + pageContentH;
    }
    return cuts;
  }

  // 块级分页：从页顶累计块高（含块间距，由调用方计入 blockHeights），
  // 下一块放不下（累计 + 块高 > pageContentH）→ 整块推到下一页，块永不被劈开。
  // - 超页高的单块例外：起点仍从新页开始。给了 innerCutTops[i]（块内切分点 top 序列，
  //   来自 computeInnerSplits）→ 每个切点占一页、块尾从最后切点起算；没给/切不动 →
  //   跨 ceil(h/页高) 页拉长纸面，下一块从它结束处所在页继续累计；
  // - 恰好填满一页（累计 == 页高）不切，下一块自然落到新页（gap = 0）。
  // 返回：pageOfBlock（每块起始页号 0-based）/ gapBefore（块 i 开新页时 = 上一页剩余留白 px，
  // 不切页 = null）/ pageCount / pageStartBlocks / lastFill（末页尾部剩余留白）。
  function paginateBlocks(blockHeights, pageContentH, innerCutTops) {
    innerCutTops = innerCutTops || [];
    const n = blockHeights.length;
    const pageOfBlock = new Array(n).fill(0);
    const gapBefore = new Array(n).fill(null);
    if (!(pageContentH > 0)) {
      // 防御：页高非法 → 全落第 1 页
      return { pageOfBlock, gapBefore, pageCount: 1, pageStartBlocks: [0], lastFill: 0 };
    }
    const pageStartBlocks = [0];
    let page = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const h = Math.max(0, blockHeights[i]);
      if (y > 0 && y + h > pageContentH) {
        gapBefore[i] = Math.max(0, pageContentH - y);
        page++;
        y = 0;
        pageStartBlocks.push(i);
      }
      pageOfBlock[i] = page;
      if (h > pageContentH) {
        const cuts = innerCutTops[i];
        if (cuts && cuts.length) {
          // 块内切分：每个切点开一页，块尾 = 总高 - 最后切点（尾段仍超页高 = 不可切拉长 → 视为整页满）
          for (let s = 0; s < cuts.length; s++) pageStartBlocks.push(i);
          page += cuts.length;
          y = Math.min(h - cuts[cuts.length - 1], pageContentH);
        } else {
          // 无切分点（单张超页高图等）：跨页拉长纸面，占 ceil(h/页高) 页
          const span = Math.ceil(h / pageContentH);
          for (let s = 1; s < span; s++) pageStartBlocks.push(i);
          page += span - 1;
          y = h - (span - 1) * pageContentH;
        }
      } else {
        y += h;
      }
    }
    const pageCount = page + 1;
    const lastFill = Math.max(0, pageContentH - y);
    return { pageOfBlock, gapBefore, pageCount, pageStartBlocks, lastFill };
  }

  // ---- 页眉/页脚文字（分页文档 Word 式）：长度上限 + HTML 转义（纯逻辑，屏显与导出共用一份，同口径）----
  // 页眉页脚是用户输入，入 printToPDF 的 headerTemplate/footerTemplate 与覆盖层前必须过这两关：
  //   · clampHF：单行、砍到 HF_MAXLEN（防超长串 × 页数 拖垮覆盖层/导出模板；对任意来路的磁盘文档也防御性截断）；
  //   · escapeHtml：转义 & < > " '（headerTemplate 是 HTML 字符串 sink，不转义 = 打印路径注入面，P0）。
  //     覆盖层 sink 走 element.textContent（浏览器自动转义），不用手动 escape；escapeHtml 专给字符串模板 sink。
  const HF_MAXLEN = 200;
  function clampHF(s) {
    if (s == null) return '';
    return String(s).replace(/[\r\n]+/g, ' ').slice(0, HF_MAXLEN); // 单行：换行折成空格，再砍长度
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // printToPDF 页眉/页脚模板（纯逻辑，pdf-export 调用）：文字先 clampHF 再 escapeHtml 进 HTML 字符串 sink
  // （P0 注入面：用户输入不转义 = 打印路径注入）。文字居左（对齐内容左边距 padMm）+ 页码居中共存。
  // 返回 { display, headerTemplate, footerTemplate }：display=是否开 displayHeaderFooter；空模板给非空占位
  // （否则 Chromium 印默认标题/日期）。放这里 = node 可单测「转义真发生」，不焊死在带 electron 的 pdf-export。
  function buildHfTemplates(opts) {
    opts = opts || {};
    const hdr = clampHF(opts.header), ftr = clampHF(opts.footer), nums = !!opts.pageNumbers;
    const pad = ((Number.isFinite(opts.padMm) ? opts.padMm : 25.4)) + 'mm';
    // 左文字用 in-flow inline-block（保证 div 有高——纯 absolute 子元素会塌成 0 高、Chromium 可能不渲染，
    // 是本仓「string 测试绿但导出实际不显」的经典坑）；空时用零宽空格兜高。页码用 absolute 覆盖 padding 盒全宽
    // （left:0/right:0 相对 padding 盒 = 整页宽 → 真页面居中，不受左右边距不对称影响）。
    const tpl = (leftHtml, centerHtml) =>
      '<div style="width:100%;font-size:9px;color:#777;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
      'position:relative;box-sizing:border-box;padding:0 ' + pad + ';">' +
      (centerHtml ? '<span style="position:absolute;left:0;right:0;text-align:center;">' + centerHtml + '</span>' : '') +
      '<span style="display:inline-block;">' + (leftHtml || '&#8203;') + '</span>' +
      '</div>';
    const pageNum = nums ? '<span class="pageNumber"></span> / <span class="totalPages"></span>' : '';
    return {
      display: !!(nums || hdr || ftr),
      headerTemplate: hdr ? tpl(escapeHtml(hdr), '') : '<span></span>',
      footerTemplate: (ftr || pageNum) ? tpl(escapeHtml(ftr), pageNum) : '<span></span>',
    };
  }

  const api = {
    PAGE_SIZES, ORIENTATIONS, DEFAULT_PAGE, MARGIN_PRESETS, PX_PER_MM, PAGE_GAP_PX, PAGED_PRINT_CSS, HF_MAXLEN,
    pageDims, pageBoxPx, buildPageCss, parsePageCss, computeInnerSplits, paginateBlocks, clampHF, escapeHtml, buildHfTemplates,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2SchemaPage = api;
})(typeof window !== 'undefined' ? window : globalThis);
