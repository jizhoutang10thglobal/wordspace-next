// 浏览历史纯逻辑（U6 尾:历史进 Cmd+P）。主进程在导航事件里 add/touchTitle,命令面板搜索时 search。
// 不带 require('electron')——vitest/node:test 可直接单测（同 doc-loader/url-input 的解耦老规矩）。
//
// 形状:{ url, title, ts }。只记 http/https(about:blank/file:///错误页不进历史)。
// 同 url 去重置顶(像 Chrome:重访一个站不会刷屏,只把它顶到最近),封顶 CAP 条防无限膨胀。

const CAP = 300;

function recordable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// 记一次访问:同 url 的旧条目移除、新条目置顶(保留旧标题当 fallback——did-navigate 时新页标题还没到)。
function add(list, { url, title, ts }) {
  if (!recordable(url)) return list;
  const prev = Array.isArray(list) ? list : [];
  const old = prev.find((e) => e && e.url === url);
  const rest = prev.filter((e) => e && e.url !== url);
  rest.unshift({ url, title: title || (old && old.title) || url, ts: ts || 0 });
  return rest.slice(0, CAP);
}

// page-title-updated 比 did-navigate 晚到:给同 url 条目补真实标题。
function touchTitle(list, url, title) {
  if (!title || !recordable(url) || !Array.isArray(list)) return list || [];
  return list.map((e) => (e && e.url === url ? { ...e, title } : e));
}

// 命令面板搜索:标题/URL 都匹配,最近优先(list 本身就是最近在前),空词不回(面板空态归文件)。
function search(list, term, limit = 6) {
  const t = String(term || '').trim().toLowerCase();
  if (!t || !Array.isArray(list)) return [];
  return list
    .filter((e) => e && ((e.title || '').toLowerCase().includes(t) || (e.url || '').toLowerCase().includes(t)))
    .slice(0, limit);
}

// 从磁盘载入时的清洗:坏形状/不可记 url 直接丢,防旧数据毒化。
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && recordable(e.url))
    .map((e) => ({ url: e.url, title: typeof e.title === 'string' && e.title ? e.title : e.url, ts: typeof e.ts === 'number' ? e.ts : 0 }))
    .slice(0, CAP);
}

module.exports = { add, touchTitle, search, sanitize, recordable, CAP };
