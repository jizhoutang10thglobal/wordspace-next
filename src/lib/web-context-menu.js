// 网页 view 右键菜单的纯逻辑 builder（无 electron 依赖 → node:test 直接可测，CLAUDE.md S1）。
// web-tabs.js 的 context-menu 挂钩把 Electron 的 params 子集喂进来，这里只算「该出哪些条目」；
// 真正的 electron 副作用（Menu.popup / wc.copy 等）在 web-tabs.js 的 executeCtxAction 里。
// 安全红线：链接/图片地址类条目只对 http(s) 出现，危险 scheme（javascript:/data:/file:）整节不出现。
(function () {
  // 默认的 http(s) 判定——ctx.isAllowedUrl 没注入时用它（main 会注入 policy.isAllowedNavUrl，逻辑等价）。
  function defaultIsAllowedUrl(url) {
    if (typeof url !== 'string') return false;
    var m = url.match(/^([a-z][a-z0-9+.-]*):/i);
    return !!m && (m[1].toLowerCase() === 'http' || m[1].toLowerCase() === 'https');
  }

  // 选中文字进搜索菜单 label：折叠空白 + 截断到 20 字，超出补 …。
  // 按码点(Array.from)截断,不按 UTF-16 code unit——否则 emoji/星平面字符会被从 surrogate pair 中间切断、留孤立代理码渲染成□。
  function truncForLabel(text) {
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    var cps = Array.from(s);
    return cps.length > 20 ? cps.slice(0, 20).join('') + '…' : s;
  }

  // 把「分节数组」拼成菜单 template：空节丢弃，节与节之间恰一条分隔符，无前导/尾随/连续分隔符。
  function joinSections(sections) {
    var kept = sections.filter(function (s) { return Array.isArray(s) && s.length; });
    var out = [];
    for (var i = 0; i < kept.length; i++) {
      if (i > 0) out.push({ type: 'separator' });
      for (var j = 0; j < kept[i].length; j++) out.push(kept[i][j]);
    }
    return out;
  }

  // params: { linkURL, srcURL, mediaType, selectionText, isEditable, x, y }（Electron context-menu params 子集）
  // ctx:    { canGoBack, canGoForward, pageUrl, isAllowedUrl? }
  function buildCtxTemplate(params, ctx) {
    params = params || {};
    ctx = ctx || {};
    var isAllowedUrl = typeof ctx.isAllowedUrl === 'function' ? ctx.isAllowedUrl : defaultIsAllowedUrl;

    var link = [];
    if (params.linkURL && isAllowedUrl(params.linkURL)) {
      link.push({ id: 'open-link', label: '在新标签页打开链接', args: { url: params.linkURL } });
      link.push({ id: 'open-link-bg', label: '在后台标签页打开链接', args: { url: params.linkURL } });
      link.push({ id: 'copy-link', label: '拷贝链接', args: { url: params.linkURL } });
    }

    var image = [];
    if (params.mediaType === 'image') {
      image.push({ id: 'copy-image', label: '拷贝图片', args: { x: params.x, y: params.y } });
      if (params.srcURL && isAllowedUrl(params.srcURL)) {
        image.push({ id: 'copy-image-url', label: '拷贝图片地址', args: { url: params.srcURL } });
        image.push({ id: 'save-image', label: '图片存到下载', args: { url: params.srcURL } });
      }
    }

    var selection = [];
    var selText = String(params.selectionText == null ? '' : params.selectionText);
    if (selText.trim()) {
      selection.push({ id: 'copy-selection', label: '拷贝', args: { text: selText } });
      selection.push({ id: 'search-selection', label: '用 Bing 搜索「' + truncForLabel(selText) + '」', args: { text: selText } });
    }

    var editable = [];
    if (params.isEditable) {
      editable.push({ id: 'cut', label: '剪切' });
      editable.push({ id: 'copy', label: '拷贝' });
      editable.push({ id: 'paste', label: '粘贴' });
      editable.push({ id: 'select-all', label: '全选' });
    }

    var nav = [
      { id: 'nav-back', label: '返回', enabled: !!ctx.canGoBack },
      { id: 'nav-forward', label: '前进', enabled: !!ctx.canGoForward },
      { id: 'reload', label: '重新加载' },
    ];

    var page = [
      { id: 'copy-page-url', label: '拷贝页面链接', args: { url: ctx.pageUrl || '' } },
      { id: 'clip-page', label: '存为文档' },
      { id: 'export-pdf', label: '导出 PDF' },
    ];

    return joinSections([link, image, selection, editable, nav, page]);
  }

  var API = { buildCtxTemplate: buildCtxTemplate, truncForLabel: truncForLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2CtxMenu = API;
})();
