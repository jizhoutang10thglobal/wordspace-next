// 地址栏 omnibox：判定「用户输入的是 URL 还是搜索词」+ 显示态美化。纯逻辑，双模导出。
// 决策链移植 Min urlParser（真验证域名,不是「有没有点」）；安全红线来自 plan KD-4/KD-12：
//   - 地址栏只放行 http/https 导航；file: / javascript: / data: / 自定义 scheme 一律 blocked（绝不 loadURL）。
//   - 无 scheme 时靠 IANA TLD 快照 + IP/localhost/端口 真验证域名,验不过 → 搜索。
// 返回统一形状 { kind: 'url'|'search'|'blocked', url }：
//   url    → 直接 loadURL(url)
//   search → loadURL(url)（url 已是搜索引擎结果页）
//   blocked→ 调用方什么都不做（危险 scheme）
(function () {
  var Tld = (typeof require !== 'undefined')
    ? require('./tld-set')
    : (typeof window !== 'undefined' ? window.WS2Tld : { isKnownTld: function () { return false; } });

  // scheme://authority（http/https/file/ftp/自定义）——冒号后带 //
  var AUTHORITY_SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
  // 无 authority 的 scheme（mailto:/javascript:/data:/about:）——冒号后紧跟非数字。
  // 用「非数字」把 host:port（localhost:3000 / example.com:8080）排除在 scheme 判定外。
  var OPAQUE_SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?=[^0-9])/i;
  var ALLOWED_NAV_SCHEMES = { http: 1, https: 1 };
  // 显示/搜索无争议的安全 scheme（about: 用于内部页,不进地址栏导航但也不该被当搜索）——v1 只认 http/https 导航,
  // 其余带 scheme 的一律 blocked（含 file:/javascript:/data:/自定义）。
  var IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;
  var HAS_SPACE_RE = /\s/;

  function searchUrl(q, template) {
    var t = template || 'https://www.bing.com/search?q=%s'; // KD-12 默认引擎 = Bing（待 Colin 拍板）
    return t.replace('%s', encodeURIComponent(q));
  }

  // 主机名是否是「真域名/IP/本机」——决定无 scheme 输入走 URL 还是搜索。
  function isNavigableHost(host) {
    if (!host) return false;
    if (host === 'localhost') return true;
    if (IPV4_RE.test(host)) {
      // 四段都 0-255
      var parts = host.split('.');
      for (var i = 0; i < 4; i++) { if (Number(parts[i]) > 255) return false; }
      return true;
    }
    if (host.indexOf(':') !== -1 && host.charAt(0) !== '[') {
      // host:port（IPv6 带 [] 另算）——去掉端口再判
      host = host.split(':')[0];
      if (host === 'localhost' || IPV4_RE.test(host)) return true;
    }
    var labels = host.split('.');
    if (labels.length < 2) return false;               // 单标签(无点)不是域名 → 搜索
    for (var j = 0; j < labels.length; j++) { if (!labels[j]) return false; } // 空标签(a..b / .a / a.) 无效
    return Tld.isKnownTld(labels[labels.length - 1]);   // 末段是已知 TLD 才算域名
  }

  function parse(raw, opts) {
    opts = opts || {};
    var input = String(raw == null ? '' : raw).trim();
    if (!input) return { kind: 'blocked', url: null };   // 空输入：什么都不做

    var m = input.match(AUTHORITY_SCHEME_RE) || input.match(OPAQUE_SCHEME_RE);
    if (m) {
      var scheme = m[1].toLowerCase();
      if (ALLOWED_NAV_SCHEMES[scheme]) return { kind: 'url', url: input }; // http://[::1] 等一并放行
      return { kind: 'blocked', url: null };             // file:/javascript:/data:/自定义 → 拒绝
    }

    // IPv6 无 scheme:[::1] / [::1]:8080
    if (input.charAt(0) === '[') {
      var end = input.indexOf(']');
      if (end > 0) return { kind: 'url', url: 'http://' + input };
    }

    // 含空格 → 一定是搜索（域名不含空格）
    if (HAS_SPACE_RE.test(input)) return { kind: 'search', url: searchUrl(input, opts.searchTemplate) };

    // 取 host 部分（去掉 path/query）验证是不是真域名
    var host = input.split('/')[0];
    if (isNavigableHost(host)) {
      // localhost / IP:port 补 http；真域名补 https（KD-12）。先去端口再判本机/IP。
      var hostname = host.split(':')[0];
      var scheme2 = (hostname === 'localhost' || IPV4_RE.test(hostname)) ? 'http' : 'https';
      return { kind: 'url', url: scheme2 + '://' + input };
    }
    return { kind: 'search', url: searchUrl(input, opts.searchTemplate) };
  }

  // 显示态美化：去 scheme / www. / 尾斜杠（编辑态另存完整 URL）。http 与 https 显示无差别（v1 无锁标记,KD-12）。
  function pretty(url) {
    if (typeof url !== 'string' || !url) return '';
    var s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (s.charAt(s.length - 1) === '/' && s.indexOf('/') === s.length - 1) s = s.slice(0, -1); // 只去「纯域名」的尾斜杠
    return s;
  }

  // Arc 润滑②(Cmd+Shift+C 拷链接):清洗追踪参数——拷出去分享的链接干净,不带 utm/点击指纹。
  // 只删已知追踪键,别的 query 一律不动(有些站点 ?id= 是功能参数)。解析失败原样返回。
  var TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|yclid|msclkid|mc_eid|igshid|spm|ref_src)$/i;
  function cleanShareUrl(raw) {
    if (typeof raw !== 'string' || !raw) return raw;
    try {
      var u = new URL(raw);
      var del = [];
      u.searchParams.forEach(function (_v, k) { if (TRACKING_PARAM.test(k)) del.push(k); });
      for (var i = 0; i < del.length; i++) u.searchParams.delete(del[i]);
      return u.toString();
    } catch (e) { return raw; }
  }

  var API = { parse: parse, pretty: pretty, searchUrl: searchUrl, isNavigableHost: isNavigableHost, cleanShareUrl: cleanShareUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2UrlInput = API;
})();
