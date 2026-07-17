// 网页标签的纯决策逻辑（无 electron 依赖 → node:test 直接可测）。
// web-tabs.js（主进程,要 electron）消费这里；把「判定」从「副作用」里剥出来单测。
(function () {
  // ---- 权限：默认拒绝,白名单放行（spec §10.2/§11.5「默认全拒」= default-deny + 极小白名单）----
  // Electron 不设 handler 默认全放行 → 必须显式判。白名单只放三个无隐私面的低风险项：
  // fullscreen（视频全屏）/ pointerLock（少数交互页）/ clipboard-sanitized-write（网页「复制」按钮）。
  // 摄像头/麦克风/地理位置/通知/剪贴板读/设备(WebUSB/HID/Serial/BT)一律拒，v1 不做授权 UI。
  var PERMISSION_ALLOW = { fullscreen: 1, pointerLock: 1, 'clipboard-sanitized-write': 1 };
  function permissionAllowed(permission) {
    return !!PERMISSION_ALLOW[permission];
  }

  // ---- 导航 scheme 守卫（spec §11.3 loadURL 白名单的判定核）----
  // 只放行 http/https。file:/javascript:/data:/自定义 scheme 一律拒——will-navigate/will-redirect/
  // will-frame-navigate 三处都用它,favicon fetch 也用它。
  function isAllowedNavUrl(url) {
    if (typeof url !== 'string') return false;
    var m = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!m) return false; // 无 scheme 的相对导航不该发生在顶层,保守拒
    var s = m[1].toLowerCase();
    return s === 'http' || s === 'https';
  }

  // ---- 导出 PDF 默认文件名清洗（页面标题可能含路径分隔/控制字符）----
  function safeFilename(suggested) {
    var base = String(suggested == null ? '' : suggested)
      .replace(/[/\\:*?"<>|]/g, '_')
      .trim()
      .replace(/^\.+$/, '');
    return (base || 'webpage').slice(0, 80);
  }

  // ---- did-fail-load / render-process-gone 分类 ----
  // -3 ERR_ABORTED = 用户中断导航,不是错误（经典新手 bug:在这弹错误页）。子 frame 失败不弹主错误页。
  function classifyLoadFailure(errorCode, isMainFrame) {
    if (errorCode === -3) return 'ignore'; // ERR_ABORTED
    if (!isMainFrame) return 'ignore';
    return 'error-page';
  }
  // render-process-gone：clean-exit/killed 可能是我们自己的销毁,不算崩溃。
  function isRealCrash(reason) {
    return reason !== 'clean-exit' && reason !== 'killed';
  }

  // ---- favicon 事件去重 ----
  // setBounds 可能触发多余 page-favicon-updated（URL 没变也发）→ 按 URL 去重。
  // 且只放行 http/https（恶意页声明 file:// 图标会让主进程 fetch 读本地文件）。
  function pickFavicon(favicons, prevUrl) {
    if (!Array.isArray(favicons)) return null;
    // 取**第一个 http(s)** 图标,别只看 [0]——现代站点常把内联 SVG data:-URI 图标放首位,
    // 后面才是 http .ico;只判 [0] 会让这类站永远回落地球图标（P2-4）。file:/data: 跳过（安全）。
    for (var i = 0; i < favicons.length; i++) {
      var url = favicons[i];
      if (isAllowedNavUrl(url)) return url === prevUrl ? null : url; // 命中的这个若没变则跳过（去重）
    }
    return null;
  }

  // ---- 网页缩放（spec §4.6：步长 0.1、范围 0.5–2.0、复位 1.0；每标签独立）----
  function nextZoom(current, dir) {
    var cur = typeof current === 'number' && current > 0 ? current : 1;
    if (dir === 'reset') return 1;
    var step = dir === 'out' ? -0.1 : 0.1;
    var next = Math.round((cur + step) * 10) / 10;
    return Math.min(2, Math.max(0.5, next));
  }

  // ---- User-Agent 归一（反 CAPTCHA，Wendi 2026-07-14 报的浏览器搜索反复弹人机验证）----
  // Electron 默认 UA 带两个标准 Chrome UA 里不存在的 token：`<appName>/<ver>` 和 `Electron/<ver>`。
  // Google 反滥用把非标准 UA 当自动化/bot 信号 → /sorry 拦截页 + reCAPTCHA。剥掉这两个 token 归一成
  // 标准 Chrome UA（内核本就是 Chromium，不是伪装、不动 navigator）。appName 由调用方传 app.getName()——
  // dev 下是 'wordspace-next'、打包后是 'Wordspace Next'（含空格），运行时取值两种形态都覆盖，正则转义特殊字符。
  function browserUA(defaultUA, appName) {
    if (typeof defaultUA !== 'string' || !defaultUA) return '';
    var ua = defaultUA.replace(/\sElectron\/\S+/i, '');
    if (appName) {
      var esc = String(appName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ua = ua.replace(new RegExp('\\s' + esc + '/\\S+', 'i'), '');
    }
    return ua.replace(/\s{2,}/g, ' ').trim();
  }

  var API = {
    permissionAllowed: permissionAllowed,
    browserUA: browserUA,
    isAllowedNavUrl: isAllowedNavUrl,
    safeFilename: safeFilename,
    classifyLoadFailure: classifyLoadFailure,
    isRealCrash: isRealCrash,
    pickFavicon: pickFavicon,
    nextZoom: nextZoom,
    PERMISSION_ALLOW: PERMISSION_ALLOW,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2WebPolicy = API;
})();
