// 持久化「打开的文件夹们」+ 全局标签/置顶，重启后自动恢复。照 recents.js：
// 一个 userData 下的小 JSON，只从主进程读写，store 路径作参数传入 → node:test 用 tmpdir 直接驱动。
// 损坏/缺失返回空（不抛）。
//
// v2 schema（多根）：
//   { version: 2,
//     roots: [{ id: 'r1', path: '/abs/…' }],   // 有序 = 侧栏显示序；id 稳定（重新定位换 path 不换 id）
//     nextRootId: 2,                            // 自增计数，保证 id 不复用
//     tabs: { entries: [{ rootId?, rel?, abs?, kind, title, open, pinned }], activeRel },
//     savedAt }
// 标签是全局单一集合（不再按根分桶）——多根同时开着，桶的语义没了。
//
// v1 迁移（读时转，首次写盘固化）：{ root, tabsByRoot: {[absRoot]:{entries,activeRel}}, pinsByRoot }
//   → roots=[{id:'r1',path:root}]，r1 桶的 rel entries 补 rootId、activeRel 由裸 rel 升 'r1:rel'。
//   其他历史根的旧桶不迁移（老语义是「重开那个文件夹时恢复」，新模型里都同时开着、没有重开）；
//   v1 字段原样留在文件里不删，回退安全。
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

// read-modify-write 串行化：saveRoots 和 setTabs 都是「读整文件→改一角→写回」，并发交错会互相 clobber
// （browser 分支在 workspace.json 上真踩过）。单进程内一条 promise 链就够。
let chain = Promise.resolve();
function serialized(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

// 一条 entry 合法 = 工作区内（rel + rootId 都是字符串）或工作区外（abs 字符串），且 open||pinned。
// v2 里 rel 无 rootId 视为坏数据丢弃（迁移在 sanitize 之前已补好 rootId）。
function validEntry(e) {
  if (!e || (e.open !== true && e.pinned !== true)) return false;
  if (typeof e.rel === 'string') return typeof e.rootId === 'string';
  return typeof e.abs === 'string';
}
function sanitize(state) {
  const entries = Array.isArray(state && state.entries) ? state.entries.filter(validEntry) : [];
  const activeRel = state && typeof state.activeRel === 'string' ? state.activeRel : null;
  return { entries, activeRel };
}
function validRoot(r) {
  return r && typeof r.id === 'string' && typeof r.path === 'string';
}

// 把 v1 桶迁成 v2 全局 tabs（rootId 归到 r1）。
function migrateV1Tabs(raw, rootId) {
  const bucket = raw.tabsByRoot && raw.tabsByRoot[raw.root];
  if (bucket && Array.isArray(bucket.entries)) {
    const entries = bucket.entries.map((e) =>
      e && typeof e.rel === 'string' ? { ...e, rootId } : e,
    );
    let activeRel = typeof bucket.activeRel === 'string' ? bucket.activeRel : null;
    // v1 的 activeRel：内部=裸 rel、外部=abs。裸 rel 升格带根前缀；abs 原样。
    if (activeRel && entries.some((e) => e && e.rel === activeRel)) activeRel = rootId + ':' + activeRel;
    return { entries, activeRel };
  }
  // 更老的 pinsByRoot（v0.4.0）：rel 列表 → pinned（未开）entries
  const oldPins = raw.pinsByRoot && raw.pinsByRoot[raw.root];
  if (Array.isArray(oldPins) && oldPins.length) {
    const entries = oldPins
      .filter((r) => typeof r === 'string')
      .map((rel) => {
        const title = rel.split('/').pop();
        return { rootId, rel, kind: kindOf(title), title, open: false, pinned: true };
      });
    return { entries, activeRel: null };
  }
  return { entries: [], activeRel: null };
}

// 读出 v2 视图（v1 就地迁移成视图，不写盘——首次 saveRoots/setTabs 才固化）。
function toV2View(raw) {
  if (Array.isArray(raw.roots)) {
    return {
      roots: raw.roots.filter(validRoot),
      nextRootId: Number.isInteger(raw.nextRootId) ? raw.nextRootId : raw.roots.length + 1,
      tabs: sanitize(raw.tabs),
    };
  }
  if (typeof raw.root === 'string' && raw.root) {
    return {
      roots: [{ id: 'r1', path: raw.root }],
      nextRootId: 2,
      tabs: sanitize(migrateV1Tabs(raw, 'r1')),
    };
  }
  return { roots: [], nextRootId: 1, tabs: { entries: [], activeRel: null } };
}

async function loadState(storeFile) {
  return toV2View(await readRaw(storeFile));
}

async function saveRoots(storeFile, roots, nextRootId) {
  return serialized(async () => {
    const raw = await readRaw(storeFile);
    // v1 首次写盘前先把旧标签迁进来，别让「先 saveRoots 后 setTabs」的窗口把旧标签丢了。
    if (!Array.isArray(raw.roots)) raw.tabs = toV2View(raw).tabs;
    raw.version = 2;
    raw.roots = roots.filter(validRoot).map((r) => ({ id: r.id, path: r.path }));
    raw.nextRootId = Number.isInteger(nextRootId) ? nextRootId : raw.roots.length + 1;
    raw.savedAt = Date.now();
    await writeRaw(storeFile, raw);
    return toV2View(raw);
  });
}

async function getTabs(storeFile) {
  return (await loadState(storeFile)).tabs;
}

async function setTabs(storeFile, state) {
  return serialized(async () => {
    const raw = await readRaw(storeFile);
    if (!Array.isArray(raw.roots)) {
      // v1 文件上来先 setTabs（理论顺序不该发生，防御）：先固化迁移视图再覆盖 tabs。
      const view = toV2View(raw);
      raw.roots = view.roots;
      raw.nextRootId = view.nextRootId;
    }
    raw.version = 2;
    raw.tabs = sanitize(state);
    await writeRaw(storeFile, raw);
    return raw.tabs;
  });
}

// P3-07 树展开态（缓存语义，rel 失效即弃）：{ expandedByRoot: { [rootId]: [rel...] }, collapsedRoots: [rootId] }。
// 存「偏离默认的那部分」——目录默认收起，故存「被展开的目录」；根默认展开，故存「被收起的根」。cap 每根 500。
const TREE_STATE_CAP = 500;
function sanitizeTreeState(ts) {
  const expandedByRoot = {};
  const src = ts && ts.expandedByRoot;
  if (src && typeof src === 'object') {
    for (const rootId of Object.keys(src)) {
      if (typeof rootId !== 'string') continue;
      const rels = Array.isArray(src[rootId]) ? src[rootId].filter((r) => typeof r === 'string').slice(0, TREE_STATE_CAP) : [];
      expandedByRoot[rootId] = rels;
    }
  }
  const collapsedRoots = Array.isArray(ts && ts.collapsedRoots) ? ts.collapsedRoots.filter((r) => typeof r === 'string') : [];
  return { expandedByRoot, collapsedRoots };
}
async function getTreeState(storeFile) {
  return sanitizeTreeState((await readRaw(storeFile)).treeState);
}
async function setTreeState(storeFile, treeState) {
  return serialized(async () => {
    const raw = await readRaw(storeFile);
    raw.treeState = sanitizeTreeState(treeState);
    await writeRaw(storeFile, raw);
    return raw.treeState;
  });
}

async function clear(storeFile) {
  await fs.rm(storeFile, { force: true }).catch(() => {});
}

module.exports = { loadState, saveRoots, getTabs, setTabs, getTreeState, setTreeState, clear };
