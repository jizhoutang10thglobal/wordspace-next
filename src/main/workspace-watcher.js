// 监听各工作区根的文件系统变化（外部增/删/改名/移动），去抖后通知 renderer 重读该根的树 + reconcile 标签。
// 跟 doc-watcher 互补：doc-watcher 只盯「当前打开文档所在目录」、为外部改内容时重载编辑器；这个盯「根、
// 递归」、为侧栏文件树实时跟随磁盘。
//
// 多根版：每根一个独立 watcher（rootId → {watcher, timer}），互不干扰；移除根时单独关它的。
// recursive：mac/win 原生支持（FSEvents / ReadDirectoryChangesW）；Linux（CI e2e 在 ubuntu 跑）Node 20+ 支持。
// 不支持的平台 fs.watch 会抛 → 捕获后放弃监听，靠 renderer 的「窗口重新聚焦时刷新」兜底。
// 去抖 200ms：外部批量操作（解压 / git checkout / 拖一堆文件）会爆一串事件，coalesce 成一次重读。
// 根数量有上限（ipc 层 MAX_ROOTS=8），递归 watcher 的资源占用可控。
const fs = require('fs');

const watchers = new Map(); // rootId → { watcher, timer }
const DEBOUNCE_MS = 200;

function unwatch(rootId) {
  const w = watchers.get(rootId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  if (w.watcher) { try { w.watcher.close(); } catch (e) { /* 已关 */ } }
  watchers.delete(rootId);
}

// 开始盯 rootId 的 rootPath；任意子孙变化（去抖后）调一次 onChange()（调用方自己闭包 rootId）。
// 同 rootId 重复 watch（重新定位换路径）会先关旧的。onError（可选）：watcher 挂了（根被删/盘被拔时
// mac/win 都可能发 error）先注销再回调，让调用方复查根还在不在、该标失联标失联——别让树静默冻结。
function watch(rootId, rootPath, onChange, onError) {
  unwatch(rootId);
  if (!rootPath || typeof rootPath !== 'string') return;
  try {
    const entry = { watcher: null, timer: null };
    entry.watcher = fs.watch(rootPath, { recursive: true }, () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { entry.timer = null; onChange(); }, DEBOUNCE_MS);
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

function closeAll() {
  for (const id of [...watchers.keys()]) unwatch(id);
}

module.exports = { watch, unwatch, closeAll };
