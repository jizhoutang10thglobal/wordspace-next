/* src/lib/links.js
 * 文档互链的**纯路径代数**（无 DOM / 无 electron / 无 parse5）——可在 node:test、主进程、renderer 三处共用。
 * 行为权威 = ui-demo/src/lib/links.ts（Colin 三轮实测验收），逐字移植其语义；对称性质由 test/links.test.js
 * 的 50 断言钉死（`resolveHref(from, relHref(from, to)) === to` 对任意合法文件名）。
 *
 * 磁盘 href = 纯净的**根内相对路径**（'../notes/x.html'），零自定义属性——浏览器裸开可跳、md 原生、Schema 合规。
 * 写/读必须严格对称：文件名里合法的 % # ? 会撞 URL 语法、':' 开头段会被误判 scheme（对抗审查 L1）。
 * 双导出：renderer 里作 window.WS2Links 全局；node/主进程 require。
 */
(function (root) {
  'use strict';

  /** 上级目录（根内路径），'a/b/c.html' → 'a/b'，根级文件 → ''。 */
  function dirOf(path) {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i) : '';
  }

  /** 文件名（含扩展名）。 */
  function baseOf(path) {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
  }

  /** 规范化一条根内路径：解 './'、'..'，越过根顶（.. 多了）返回 null（跨根/越界，v1 不可解析）。 */
  function normalizePath(path) {
    const out = [];
    for (const seg of path.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (!out.length) return null;
        out.pop();
      } else {
        out.push(seg);
      }
    }
    return out.join('/');
  }

  // 写端按段最小转义 + './' 消歧；读端按段解码。见文件头 L1。
  const escSeg = (s) => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
  const unescSeg = (s) => {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s; // 不是我们写的编码（手写 href 带裸 %）→ 原样当字面量
    }
  };

  /** 把 href 拆成 [路径部分, 尾缀(#锚点/?查询,含分隔符)]。写端已转义文件名内的 #/?，裸 #/? 必是真分隔符。 */
  function splitHrefSuffix(href) {
    const m = href.match(/[#?].*$/);
    return m ? [href.slice(0, m.index), m[0]] : [href, ''];
  }

  /**
   * 把某文档里的相对 href 解析成根内路径。fromPath = 链接所在文件的根内路径。
   * 绝对 URL（http/https/mailto…）/锚点(#)/根绝对(/)/越界(..多) → null（不是文档内互链）。
   */
  function resolveHref(fromPath, href) {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
      return null;
    }
    const clean = splitHrefSuffix(href)[0];
    if (!clean) return null;
    const decoded = clean.split('/').map(unescSeg).join('/');
    return normalizePath((dirOf(fromPath) ? dirOf(fromPath) + '/' : '') + decoded);
  }

  /** 计算 fromPath → toPath 的文档相对 href（同根内路径）。输出已按段转义。 */
  function relHref(fromPath, toPath) {
    const from = dirOf(fromPath).split('/').filter(Boolean);
    const to = toPath.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    const ups = from.length - i;
    const rel = '../'.repeat(ups) + to.slice(i).map(escSeg).join('/');
    const out = rel || escSeg(baseOf(toPath));
    // 首段含 ':' 且无 '../' 前缀 → 被读端误判成 scheme（'draft:v2.html'）→ 前缀 './' 消歧
    return !out.startsWith('.') && out.split('/')[0].includes(':') ? './' + out : out;
  }

  /**
   * 分类一个文档里的 href（给点击守卫 U0 用；纯逻辑、可单测）。返回：
   *  - { kind:'web',   url }   http/https/mailto/tel → 系统程序打开
   *  - { kind:'anchor', id }   页内锚点 #foo → iframe 内滚动（不导航、不接管）
   *  - { kind:'doc',   path }  可解析的根内相对路径 → 应用内 openDoc 漏斗
   *  - { kind:'ignore' }       空 / 根绝对 / file: 等其它 scheme / 越界 → 拦下不动作（绝不让 iframe 裸导航）
   */
  function linkTarget(fromPath, href) {
    const h = (href == null ? '' : String(href)).trim();
    if (!h) return { kind: 'ignore' };
    if (/^(https?|mailto|tel):/i.test(h)) return { kind: 'web', url: h };
    if (h.charAt(0) === '#') return { kind: 'anchor', id: h.slice(1) };
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { kind: 'ignore' }; // file:/其它 scheme：不导航
    const path = resolveHref(fromPath, h); // 相对路径（含 / 开头会被 resolveHref 判 null）
    return path ? { kind: 'doc', path, suffix: splitHrefSuffix(h)[1] } : { kind: 'ignore' };
  }

  /**
   * 只看 href 字符串本身分类（不解析路径，不需要 fromPath）——给 U0 点击守卫在 renderer 做快速分流，
   * 相对路径的真实解析（abs/rel/kind/exists）交给主进程（它才有 fs + activeRoot）。
   *  'web'      http/https/mailto/tel → 系统程序
   *  'anchor'   #foo → iframe 内滚动（不导航、不接管）
   *  'relative' 文档相对路径 → 交主进程解析后 openDoc/showViewer/断链
   *  'ignore'   空 / 根绝对(/) / file: 等其它 scheme → 拦下不动作（绝不让 iframe 裸导航）
   */
  function classifyScheme(href) {
    const h = (href == null ? '' : String(href)).trim();
    if (!h) return 'ignore';
    if (/^(https?|mailto|tel):/i.test(h)) return 'web';
    if (h.charAt(0) === '#') return 'anchor';
    // 前导 '/'（根绝对）或 '\'（Windows UNC：'\\host\share' 会被 WHATWG URL 规范成 //host → 出站 SMB，
    // 泄漏 NTLM 哈希）都不是文档内相对链接 → ignore，绝不送去主进程解析。file:/其它 scheme 同理。
    if (h.charAt(0) === '/' || h.charAt(0) === '\\' || /^[a-z][a-z0-9+.-]*:/i.test(h)) return 'ignore';
    return 'relative';
  }

  /** moved 映射反向（撤销重写用）。 */
  function invertMoves(moved) {
    const inv = new Map();
    for (const [k, v] of moved) inv.set(v, k);
    return inv;
  }

  const api = {
    dirOf, baseOf, normalizePath, splitHrefSuffix, resolveHref, relHref, linkTarget, classifyScheme,
    invertMoves, escSeg, unescSeg,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WS2Links = api;
})(typeof window !== 'undefined' ? window : globalThis);
