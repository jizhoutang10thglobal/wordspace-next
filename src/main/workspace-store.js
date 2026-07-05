// 持久化「上次打开的工作区文件夹」+「每个工作区的标签/置顶」，重启后自动恢复。照 recents.js：
// 一个 userData 下的小 JSON，只从主进程读写，store 路径作参数传入 → node:test 用 tmpdir 直接驱动。
// 损坏/缺失返回 null/空（不抛）。标签按根存（tabsByRoot[root]={entries,activeRel}），换工作区各自保留。
// 迁移：v0.4.0 的旧 pinsByRoot[root]=[rel] → 合成 {open:false,pinned:true} entries（一次性，读时转）。
const fs = require('fs/promises');
const path = require('path');
const { kindOf } = require('../lib/file-tree');

async function readRaw(storeFile) {
  try {
    const parsed = JSON.parse(await fs.readFile(storeFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function writeRaw(storeFile, raw) {
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  // 修 MP-11：原子写（tmp+rename）——裸 writeFile 写一半崩溃/断电 → JSON 损坏 → 下次启动 readRaw 吞成 {}，
  // 工作区/标签/置顶全静默重置。rename 是原子的，坏了也只坏 tmp、正本完好。
  const tmp = storeFile + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2), 'utf8');
  await fs.rename(tmp, storeFile);
}

// 一条 entry 合法 = 有字符串 rel（工作区内）或字符串 abs（工作区外文件）且 open||pinned（丢幽灵/坏数据）。
// 放行无 rel 的外部标签——否则它每次 setTabs 都被静默扔掉、重启恢复落空。
// web 条目（abs 以 'web:' 开头）额外要求 url 是 string 或 null——缺失/数字等坏数据 → 丢该条,
// 避免恢复出无 URL 的死标签（KD-3）。
const WEB_PREFIX = 'web:';
function isWebAbs(e) {
  return typeof e.abs === 'string' && e.abs.indexOf(WEB_PREFIX) === 0;
}
function validEntry(e) {
  if (!e || (typeof e.rel !== 'string' && typeof e.abs !== 'string')) return false;
  if (!(e.open === true || e.pinned === true)) return false;
  if (isWebAbs(e) && !(typeof e.url === 'string' || e.url === null)) return false;
  return true;
}
function sanitize(state) {
  let entries = Array.isArray(state && state.entries) ? state.entries.filter(validEntry) : [];
  const activeRel = state && typeof state.activeRel === 'string' ? state.activeRel : null;
  // 空白新标签页（web 且 url===null 且未置顶）只保留激活中那一条——否则每次 Cmd+T 后改点别的都留一条,
  // 重启不消、机械累积侵蚀侧栏 Arc 观感（KD-3）。激活中的空白新标签页要留（恢复出「新标签页」态）。
  entries = entries.filter((e) => {
    const blankNewtab = isWebAbs(e) && e.url === null && !e.pinned;
    return !blankNewtab || (e.rel || e.abs) === activeRel;
  });
  return { entries, activeRel };
}

async function load(storeFile) {
  const raw = await readRaw(storeFile);
  return typeof raw.root === 'string' ? raw : null;
}

async function save(storeFile, root) {
  const raw = await readRaw(storeFile); // 保留 tabsByRoot，别被覆盖
  raw.root = root;
  raw.savedAt = Date.now();
  await writeRaw(storeFile, raw);
  return { root };
}

// 取某根的标签状态 { entries, activeRel }。无则尝试迁移旧 pinsByRoot；再无则空。
async function getTabs(storeFile, root) {
  const raw = await readRaw(storeFile);
  const cur = raw.tabsByRoot && raw.tabsByRoot[root];
  if (cur && Array.isArray(cur.entries)) return sanitize(cur);
  // 迁移：旧 pinsByRoot[root] 的 rel 列表 → pinned（未开）entries
  const oldPins = raw.pinsByRoot && raw.pinsByRoot[root];
  if (Array.isArray(oldPins) && oldPins.length) {
    const entries = oldPins
      .filter((r) => typeof r === 'string')
      .map((rel) => {
        const title = rel.split('/').pop();
        return { rel, kind: kindOf(title), title, open: false, pinned: true };
      });
    return { entries, activeRel: null };
  }
  return { entries: [], activeRel: null };
}

async function setTabs(storeFile, root, state) {
  const raw = await readRaw(storeFile);
  if (!raw.tabsByRoot || typeof raw.tabsByRoot !== 'object') raw.tabsByRoot = {};
  raw.tabsByRoot[root] = sanitize(state);
  await writeRaw(storeFile, raw);
  return raw.tabsByRoot[root];
}

async function clear(storeFile) {
  await fs.rm(storeFile, { force: true }).catch(() => {});
}

module.exports = { load, save, clear, getTabs, setTabs };
