// 监听各工作区根的文件系统变化（外部增/删/改名/移动），去抖后通知 renderer 重读该根的树 + reconcile 标签。
// 跟 doc-watcher 互补：doc-watcher 只盯「当前打开文档所在目录」、为外部改内容时重载编辑器；这个盯「根、
// 递归」、为侧栏文件树实时跟随磁盘。
//
// 多根版：每根一个独立 watcher（rootId → {watcher, timer, pending}），互不干扰；移除根时单独关它的。
// recursive：mac/win 原生支持（FSEvents / ReadDirectoryChangesW）；Linux（CI e2e 在 ubuntu 跑）Node 20+ 支持。
// 不支持的平台 fs.watch 会抛 → 捕获后放弃监听，靠 renderer 的「聚焦兜底」（isAlive=false 的根聚焦时全量刷新）。
// 去抖默认 200ms：外部批量操作（解压 / git checkout / 拖一堆文件）会爆一串事件，coalesce 成一次重读；
// delayMs 可注入（ipc 层按上次扫描耗时自适应——大根扫一次几秒，就别 200ms 一趟趟排队）。
//
// 大根性能（Wendi 卡顿修复）：事件带的路径不再扔掉——
// ① isNoise 命中（.DS_Store / .git·node_modules 内部 / bundle 内部…扫描根本看不见的路径）→ 事件直接丢弃，
//    连去抖都不排（云盘/系统 churn 的大头在这，以前每条都换来一次全量重扫）；
// ② 其余路径收进 pending，去抖结束把列表交给 onChange(changedRels)——调用方据此做子树级重扫；
// ③ 拿不到路径（平台给 null）或 pending 爆表（MAX_PENDING）→ onChange(null) = 全量重扫，行为同旧版。
const fs = require('fs');
const path = require('path');

const watchers = new Map(); // rootId → { watcher, timer, pending:Set, overflow:bool }
const DEBOUNCE_MS = 200;
const MAX_PENDING = 128;

function unwatch(rootId) {
  const w = watchers.get(rootId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  if (w.watcher) { try { w.watcher.close(); } catch (e) { /* 已关 */ } }
  watchers.delete(rootId);
}

// 开始盯 rootId 的 rootPath；任意子孙变化（去抖后）调一次 onChange(changedRels|null)（调用方自己闭包 rootId）。
// changedRels：去抖窗口内收集到的变化相对路径（'/' 分隔）；null = 没拿到路径/爆表，按全量处理。
// 同 rootId 重复 watch（重新定位换路径）会先关旧的。onError（可选）：watcher 挂了（根被删/盘被拔时
// mac/win 都可能发 error）先注销再回调，让调用方复查根还在不在、该标失联标失联——别让树静默冻结。
// opts.isNoise(rel)：命中即丢弃事件；opts.delayMs()：每次调度时取去抖时长（默认 200）。
function watch(rootId, rootPath, onChange, onError, opts = {}) {
  unwatch(rootId);
  if (!rootPath || typeof rootPath !== 'string') return;
  try {
    const entry = { watcher: null, timer: null, pending: new Set(), overflow: false };
    entry.flush = () => {
      entry.timer = null;
      const changed = entry.overflow ? null : [...entry.pending];
      entry.pending.clear();
      entry.overflow = false;
      onChange(changed && changed.length ? changed : null);
    };
    entry.watcher = fs.watch(rootPath, { recursive: true }, (_event, filename) => {
      const rel = typeof filename === 'string' && filename ? filename.split(path.sep).join('/') : null;
      if (rel && opts.isNoise && opts.isNoise(rel)) return; // 噪音：这个事件不可能改变树，整条丢弃
      if (!rel || entry.pending.size >= MAX_PENDING) entry.overflow = true;
      else entry.pending.add(rel);
      if (entry.timer) clearTimeout(entry.timer);
      const delay = Math.max(0, (opts.delayMs ? +opts.delayMs() : 0) || DEBOUNCE_MS);
      entry.timer = setTimeout(entry.flush, delay);
    });
    // 修 SB-2/MP-4：FSWatcher 是 EventEmitter，'error' 无监听 = 主进程未捕获异常崩溃。
    // 根被外部删除/改名时 Windows 会发 EPERM error → 注销该根的监听 + 通知调用方复查。
    entry.watcher.on('error', () => {
      unwatch(rootId);
      if (onError) onError();
    });
    watchers.set(rootId, entry);
  } catch (e) {
    // recursive 不支持 → 放弃监听，靠 renderer 聚焦兜底
  }
}

// 该根的 watcher 是否活着（false = 平台不支持/已挂 → renderer 聚焦时要自己全量刷新兜底）。
function isAlive(rootId) {
  const w = watchers.get(rootId);
  return !!(w && w.watcher);
}

// 有在途去抖就立即冲掉（触发 onChange）——renderer 聚焦时调，把「改盘后马上切回 app」的等待去掉，
// 也让 e2e 的 focus 触发保持确定性。没有在途去抖 = no-op。返回 isAlive。
function flush(rootId) {
  const w = watchers.get(rootId);
  if (w && w.timer) {
    clearTimeout(w.timer);
    w.flush();
  }
  return isAlive(rootId);
}

function closeAll() {
  for (const id of [...watchers.keys()]) unwatch(id);
}

module.exports = { watch, unwatch, closeAll, isAlive, flush };
