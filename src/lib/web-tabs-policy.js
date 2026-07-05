// 网页标签的纯决策逻辑（无 electron 依赖 → node:test 直接可测,CLAUDE.md S1）。
// web-tabs.js（主进程,要 electron）消费这里；把「判定」从「副作用」里剥出来单测。
(function () {
  var path = require('path');

  // ---- 权限：默认拒绝,白名单放行（KD-4）----
  // Electron 不设 handler 默认全放行 → 必须显式判。v1 白名单只放这三个低风险项,其余(摄像头/麦克风/
  // 定位/通知/剪贴板读/设备)一律拒,自绘询问条留 follow-up。
  var PERMISSION_ALLOW = { fullscreen: 1, pointerLock: 1, 'clipboard-sanitized-write': 1 };
  function permissionAllowed(permission) {
    return !!PERMISSION_ALLOW[permission];
  }

  // ---- 导航 scheme 守卫（KD-4 file:// 三层封死之一）----
  // 只放行 http/https。file:/javascript:/data:/自定义 scheme 一律拒——will-navigate/will-redirect/
  // will-frame-navigate 三处都用它,favicon fetch 也用它。
  function isAllowedNavUrl(url) {
    if (typeof url !== 'string') return false;
    var m = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (!m) return false; // 无 scheme 的相对导航不该发生在顶层,保守拒
    var s = m[1].toLowerCase();
    return s === 'http' || s === 'https';
  }

  // ---- 下载文件名清洗（KD-4 / U3 安全）----
  // 恶意服务器可用 Content-Disposition: filename="../../../.ssh/authorized_keys" 逃逸下载目录。
  // path.basename 剥掉所有路径分隔符和 ..;空/纯点名回落 'download'。
  function safeFilename(suggested) {
    var base = path.basename(String(suggested == null ? '' : suggested));
    // basename 之后仍可能是 '..' 或 '' 或全空白 → 兜底
    base = base.replace(/^\.+$/, '').trim();
    return base || 'download';
  }
  // 目标路径必须落在下载目录内（第二道:即便文件名清洗漏了,解析后路径越界也拒）。
  function isInsideDir(dir, target) {
    var rel = path.relative(path.resolve(dir), path.resolve(target));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
  // 同名去重：dir 里已存在 name 时追加 " (n)"（对齐 Chrome,setSavePath 会跳过 Chromium 自带去重）。
  // existsFn(absPath)->bool 由调用方注入（主进程用 fs.existsSync;测试注入假集合）。
  function uniqueName(dir, name, existsFn) {
    var target = path.join(dir, name);
    if (!existsFn(target)) return target;
    var ext = path.extname(name);
    var stem = name.slice(0, name.length - ext.length);
    for (var n = 1; n < 10000; n++) {
      var cand = path.join(dir, stem + ' (' + n + ')' + ext);
      if (!existsFn(cand)) return cand;
    }
    return path.join(dir, stem + ' (' + Date.now() + ')' + ext);
  }

  // ---- did-fail-load / render-process-gone 分类（KD-14）----
  // 返回 'ignore' | 'error-page' | 'badge'（前台错误页 / 后台角标由调用方按是否激活再分）。
  // -3 ERR_ABORTED = 用户中断导航,不是错误（经典新手 bug:在这弹错误页）。子 frame 失败不弹主错误页。
  function classifyLoadFailure(errorCode, isMainFrame) {
    if (errorCode === -3) return 'ignore'; // ERR_ABORTED
    if (!isMainFrame) return 'ignore';
    return 'error-page';
  }
  // render-process-gone：clean-exit/killed 可能是我们自己的休眠销毁,不算崩溃。
  function isRealCrash(reason) {
    return reason !== 'clean-exit' && reason !== 'killed';
  }

  // ---- favicon 事件去重（KD-11）----
  // Electron 42 前 setBounds 会触发多余 page-favicon-updated（URL 没变也发）→ 按 URL 去重。
  // 且只放行 http/https（恶意页声明 file:// 图标会让主进程 net.fetch 读本地文件）。
  function pickFavicon(favicons, prevUrl) {
    if (!Array.isArray(favicons) || !favicons.length) return null;
    var url = favicons[0];
    if (!isAllowedNavUrl(url)) return null; // file:/data: 图标拒绝
    if (url === prevUrl) return null; // 没变,跳过
    return url;
  }

  // ---- 菜单命令按 (activeKind × viewState) 路由（KD-7）----
  // viewState: 'live'(有 view) | 'placeholder'(恢复未加载) | 'newtab'(url=null)。
  // 返回动作字符串,renderer/main 据此分派。
  function routeMenuCmd(activeKind, viewState, cmd) {
    if (activeKind !== 'web') return null; // 非 web 走原有 doc 路由（调用方负责）
    if (viewState === 'newtab') {
      // 新标签页 surface：只有地址栏,导航/查找/导出全 no-op
      return 'noop';
    }
    if (viewState === 'placeholder') {
      if (cmd === 'reload') return 'web-first-load'; // 占位态 reload=触发首次加载
      if (cmd === 'export-pdf' || cmd === 'find-file') return 'disabled';
      if (cmd === 'save' || cmd === 'undo' || cmd === 'redo') return 'noop';
      return 'noop';
    }
    // live
    switch (cmd) {
      case 'save': return 'noop';
      case 'export-pdf': return 'web-pdf';
      case 'undo': return 'web-undo';
      case 'redo': return 'web-redo';
      case 'find-file': return 'web-find';
      case 'reload': return 'web-reload';
      default: return null;
    }
  }

  var API = {
    permissionAllowed: permissionAllowed,
    isAllowedNavUrl: isAllowedNavUrl,
    safeFilename: safeFilename,
    isInsideDir: isInsideDir,
    uniqueName: uniqueName,
    classifyLoadFailure: classifyLoadFailure,
    isRealCrash: isRealCrash,
    pickFavicon: pickFavicon,
    routeMenuCmd: routeMenuCmd,
    PERMISSION_ALLOW: PERMISSION_ALLOW,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2WebPolicy = API;
})();
