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
  if (!cells[name]) throw new Error('browser-store 未 init: ' + name);
  return cells[name];
}

async function writeCell(c) {
  c.dirty = false;
  const json = JSON.stringify(c.dump(c.data), null, 2);
  const tmp = c.file + '.tmp';
  try {
    await fsp.mkdir(path.dirname(c.file), { recursive: true });
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, c.file); // 原子：坏了只坏 tmp，正本完好
  } catch (e) {
    console.error('[browser-store] write failed:', c.file, e && e.message);
  }
}
function schedule(c) {
  c.dirty = true;
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => { c.timer = null; writeCell(c); }, DEBOUNCE_MS);
}
// 退出前同步冲盘（before-quit）：防抖窗内的最后变更不能丢。
function flushSync() {
  for (const name of Object.keys(cells)) {
    const c = cells[name];
    if (!c.dirty && !c.timer) continue;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
    c.dirty = false;
    try {
      fs.mkdirSync(path.dirname(c.file), { recursive: true });
      const tmp = c.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(c.dump(c.data), null, 2), 'utf8');
      fs.renameSync(tmp, c.file);
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

module.exports = { init, flushSync, getBookmarks, setBookmarks, getHistory, setHistory, getSettings, setEngine };
