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

  // 切/关文档统一收口（shell.js detachEditors 调）：清高亮 + 作废在飞的 scan。
  // （后续 step：这里还要关悬停卡/修复卡 + 清 hover 定时器。）
  function detach() {
    scanGen++; // 作废在飞的异步 scan
    clearHighlights();
    frame = null;
  }

  // 缩放/resize 时重定位浮层（当前无卡，空实现；step 2 加卡后关卡即可）。
  function reposition() { /* no cards yet */ }

  var api = { scan: scan, detach: detach, reposition: reposition };
  if (typeof window !== 'undefined') window.WS2LinkView = api;
})();
