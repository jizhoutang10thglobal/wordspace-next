// 浏览器数据持久化（spec §10.4）：userData 下三个小 JSON——
//   browser-bookmarks.json  { version, folders[], bookmarks[] }
//   browser-history.json    { version, entries[] }（cap 500，web-history.sanitize 兜底）
//   browser-settings.json   { version, engine }
// 写策略：变更防抖 ~500ms + 临时文件 rename 原子写（照 workspace-store 先例）；退出前 flushSync。
// 只从主进程读写；路径作参数传入 → node:test 可用 tmpdir 直接驱动。
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const bookmarksLib = require('../lib/bookmarks');
const webHistory = require('../lib/web-history');
const engines = require('../lib/search-engines');

const DEBOUNCE_MS = 500;
let dir = null;
const cells = {}; // name -> { data, dirty, timer, file, wrap, unwrap }

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
function mkCell(name, file, load, dump) {
  const raw = readJson(file);
  cells[name] = { data: load(raw), dirty: false, timer: null, file, dump };
  return cells[name];
}

function init(userDataDir) {
  dir = userDataDir;
  mkCell('bookmarks', path.join(dir, 'browser-bookmarks.json'),
    (raw) => bookmarksLib.sanitize(raw),
    (data) => ({ version: 1, folders: data.folders, bookmarks: data.bookmarks }));
  mkCell('history', path.join(dir, 'browser-history.json'),
    (raw) => webHistory.sanitize(raw && raw.entries),
    (data) => ({ version: 1, entries: data }));
  mkCell('settings', path.join(dir, 'browser-settings.json'),
    (raw) => ({ engine: engines.validKey(raw && raw.engine) }),
    (data) => ({ version: 1, engine: data.engine }));
}
function cell(name) {
  if (!cells[name]) throw new Error('browser-store not initialized: ' + name); // 内部不变量错误(开发者向)，非用户可见，按仓库惯例用英文
  return cells[name];
}

let writeSeq = 0;
async function writeCell(c) {
  // ⚠ dirty 不在开头清（P2-5）：若 quit 落在下面 await 窗口,早清 dirty 会让 flushSync 跳过、
  // 异步写随进程退出被截断 → 该轮变更丢。改成落盘成功后、且 data 引用没再换（无新变更）才清。
  const data = c.data; // 快照引用：setX 是换引用（c.data = 新对象）,据此判有没有新变更
  const json = JSON.stringify(c.dump(data), null, 2);
  // 唯一 tmp（P2-5）：原来 async writeCell 与 flushSync 共用 `c.file+'.tmp'`,并发写同名 tmp 再各自
  // rename 会撕裂正本、下次 load 被 sanitize 清空。带 pid+seq 保证不撞。
  const tmp = c.file + '.' + process.pid + '.' + (++writeSeq) + '.tmp';
  try {
    await fsp.mkdir(path.dirname(c.file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, c.file); // 原子：坏了只坏 tmp，正本完好
    if (c.data === data) c.dirty = false; // 落盘后 data 没再变 → 清 dirty；变了则留 dirty,下轮再写
  } catch (e) {
    console.error('[browser-store] write failed:', c.file, e && e.message);
    try { await fsp.rm(tmp, { force: true }); } catch { /* 清残留 tmp */ }
  }
}
function schedule(c) {
  c.dirty = true;
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => { c.timer = null; writeCell(c); }, DEBOUNCE_MS);
}

// ---- 变更通知（P3-11）----
// 收藏是用户数据 → **不设条数上限**（静默丢弃比膨胀更糟）。唯一要防的放大器是「每次变更把全量 state
// 灌 renderer」：改成 leading-edge 防抖合并——首次变更立即推（单次操作零延迟、星标即时反馈,与旧行为一致）,
// NOTIFY_MS 窗口内的后续变更合并成一次 trailing 推。磁盘写早已防抖（schedule），这里补上「推送」这一半。
const NOTIFY_MS = 200;
const subs = {}; // name -> { fn, timer, pending }
function subscribe(name, fn) {
  subs[name] = { fn: typeof fn === 'function' ? fn : null, timer: null, pending: false };
}
function notify(name) {
  const s = subs[name];
  if (!s || !s.fn) return;
  if (s.timer) { s.pending = true; return; }   // 窗口内：合并,等 trailing 一次推
  s.fn(cell(name).data);                        // leading：立即推（不延迟单次变更）
  s.timer = setTimeout(() => {
    s.timer = null;
    if (s.pending) { s.pending = false; s.fn(cell(name).data); } // trailing：窗口内有更多变更 → 补推最终态
  }, NOTIFY_MS);
}
// 退出前同步冲盘（before-quit）：防抖窗内的最后变更不能丢。用独立 `.sync.tmp`,不与 async 撞。
function flushSync() {
  for (const name of Object.keys(cells)) {
    const c = cells[name];
    if (!c.dirty) continue; // dirty=true 就冲（含 async writeCell await 窗口内被 quit 打断的情形）
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
    try {
      fs.mkdirSync(path.dirname(c.file), { recursive: true });
      const tmp = c.file + '.sync.tmp';
      fs.writeFileSync(tmp, JSON.stringify(c.dump(c.data), null, 2), 'utf8');
      fs.renameSync(tmp, c.file);
      c.dirty = false;
    } catch (e) {
      console.error('[browser-store] flush failed:', c.file, e && e.message);
    }
  }
}

// ---- 收藏 ----
function getBookmarks() { return cell('bookmarks').data; }
function setBookmarks(state) {
  const c = cell('bookmarks');
  c.data = state;
  schedule(c);
  notify('bookmarks'); // 防抖合并推 renderer（P3-11）
  return c.data;
}
// ---- 历史 ----
function getHistory() { return cell('history').data; }
function setHistory(entries) {
  const c = cell('history');
  c.data = entries;
  schedule(c);
  return c.data;
}
// ---- 设置 ----
function getSettings() { return { ...cell('settings').data }; }
function setEngine(key) {
  const c = cell('settings');
  c.data = { ...c.data, engine: engines.validKey(key) };
  schedule(c);
  return { ...c.data };
}

module.exports = { init, flushSync, subscribe, getBookmarks, setBookmarks, getHistory, setHistory, getSettings, setEngine };
