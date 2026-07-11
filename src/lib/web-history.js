// 浏览历史纯逻辑（spec docs/browser-feature-spec.md §4.8）。主进程在导航事件里 record/touchTitle，
// 历史页/补全走 removeOne/clearRange/search。不带 require('electron')——node:test 直接单测。
//
// 形状：{ id, url, title, visitedAt(ms) }，新的在前。契约：
//   - 只记 http(s)（about:blank/file://错误页/wordspace://newtab 自动不进）；
//   - 同 url **60 秒内连续访问**合并为一条（更新标题和时间，不堆重复）——只看头部条目；
//   - 上限 500 条（FIFO 淘汰最老）；
//   - back/forward 不记（由调用方 web-tabs.js 用跳记标志控制，不在这里）。

const CAP = 500;
const MERGE_MS = 60 * 1000;
let idSeq = 0;
const mkId = (ts) => 'h' + Number(ts).toString(36) + '-' + ++idSeq;

function recordable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// 记一次访问。头部条目同 url 且 60s 内 → 合并（补标题、刷时间）；否则新条目置顶。
function record(list, { url, title, ts }) {
  if (!recordable(url)) return Array.isArray(list) ? list : [];
  const prev = Array.isArray(list) ? list : [];
  const head = prev[0];
  const t = ts || 0;
  if (head && head.url === url && t - head.visitedAt < MERGE_MS) {
    return [{ ...head, title: title || head.title, visitedAt: t }, ...prev.slice(1)];
  }
  return [{ id: mkId(t), url, title: title || url, visitedAt: t }, ...prev].slice(0, CAP);
}

// page-title-updated 比 did-navigate 晚到：头部条目同 url 且 60s 内 → 补写真实标题（复用合并语义）。
function touchTitle(list, url, title, ts) {
  if (!title || !recordable(url) || !Array.isArray(list) || !list.length) return list || [];
  const head = list[0];
  if (head.url !== url || (ts || 0) - head.visitedAt >= MERGE_MS) return list;
  return [{ ...head, title }, ...list.slice(1)];
}

function removeOne(list, id) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && e.id !== id);
}

// 范围清除（历史页「清除浏览数据」）：删**该时间段内**（比 cutoff 新）的记录，更老的保留。
const RANGE_MS = { '1h': 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
function clearRange(list, range, now) {
  if (!Array.isArray(list)) return [];
  if (range === 'all') return [];
  const ms = RANGE_MS[range];
  if (!ms) return list;
  const cutoff = (now || 0) - ms;
  return list.filter((e) => e && e.visitedAt < cutoff);
}

// 补全用搜索：标题/URL 包含（不分大小写），最近优先（list 本身新在前），**同 url 去重只出最近一条**
// （spec §4.8：地址栏补全的 search 额外做同 url 去重；历史页自己过全量列表，不走这里）。
function search(list, term, limit = 8) {
  const t = String(term || '').trim().toLowerCase();
  if (!t || !Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (!e || seen.has(e.url)) continue;
    if ((e.title || '').toLowerCase().includes(t) || (e.url || '').toLowerCase().includes(t)) {
      seen.add(e.url);
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// 从磁盘载入时的清洗：坏形状/不可记 url 直接丢，防旧数据毒化。缺 id 的补一个（旧格式迁移）。
function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && recordable(e.url))
    .map((e) => ({
      id: typeof e.id === 'string' && e.id ? e.id : mkId(e.visitedAt || 0),
      url: e.url,
      title: typeof e.title === 'string' && e.title ? e.title : e.url,
      visitedAt: typeof e.visitedAt === 'number' ? e.visitedAt : 0,
    }))
    .slice(0, CAP);
}

module.exports = { record, touchTitle, removeOne, clearRange, search, sanitize, recordable, CAP, MERGE_MS };
