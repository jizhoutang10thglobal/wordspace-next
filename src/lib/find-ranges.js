/* src/lib/find-ranges.js
 * 纯逻辑：在一个 DOM 子树里按（大小写不敏感）子串收集所有匹配的 Range。
 * 无 electron / 无 CSS Highlight —— 可用 jsdom 单测（S1 教训：纯逻辑与 Electron 解耦）。
 * 「把匹配画成高亮」在 src/editor/find.js（CSS Custom Highlight，走 e2e 像素门）。
 * 双导出：renderer 里作 window.WS2FindRanges 全局；node:test 里 require。
 */
(function (root) {
  'use strict';

  // rootEl: 搜索根（真 app = iframe 的 body；单测 = jsdom body）。
  // query: 查询串（大小写不敏感、非重叠匹配）。
  // opts.skipSelector: 命中它的元素子树整段跳过——默认跳过编辑器注入 iframe 的浮层
  //   [data-ws2-ui]（grip / 块菜单 / 斜杠菜单等），免得把 UI 文字也搜进去。
  // ⚠ 已知限制（v1，与 ui-demo 同）：只在**单个文本节点内** indexOf 匹配。查询词若被行内标签
  //   切成两段（如 "wor<b>ld</b>" 搜 "world"）或跨块，抓不到。Schema 文档的行内标签通常整词包裹
  //   （<b>词</b>），跨节点漏匹配是低频情形；真跨节点匹配要把文本铺平+记节点边界，是后续增强。
  function buildMatchRanges(rootEl, query, opts) {
    var q = (query == null ? '' : String(query)).toLowerCase();
    if (!rootEl || !q) return [];
    var doc = rootEl.ownerDocument;
    if (!doc) return [];
    var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    var NF = (view && view.NodeFilter) || (typeof NodeFilter !== 'undefined' ? NodeFilter : null);
    var SHOW_TEXT = NF ? NF.SHOW_TEXT : 0x4;
    var ACCEPT = NF ? NF.FILTER_ACCEPT : 1;
    var REJECT = NF ? NF.FILTER_REJECT : 2;
    var skip = opts && 'skipSelector' in opts ? opts.skipSelector : '[data-ws2-ui]';

    var walker = doc.createTreeWalker(rootEl, SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p) return REJECT;
        if (skip && p.closest && p.closest(skip)) return REJECT;
        var v = n.nodeValue;
        return v && v.trim() ? ACCEPT : REJECT;
      },
    });

    var ranges = [];
    var node;
    while ((node = walker.nextNode())) {
      var text = (node.nodeValue || '').toLowerCase();
      var from = 0;
      for (;;) {
        var i = text.indexOf(q, from);
        if (i < 0) break;
        var r = doc.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + q.length);
        ranges.push(r);
        from = i + q.length; // 非重叠：下一次从本次匹配之后找起
      }
    }
    return ranges;
  }

  var api = { buildMatchRanges: buildMatchRanges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WS2FindRanges = api;
})(typeof window !== 'undefined' ? window : globalThis);
