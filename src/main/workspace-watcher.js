// 监听整个工作区根的文件系统变化（外部增/删/改名/移动），去抖后通知 renderer 重读树 + reconcile 标签。
// 跟 doc-watcher 互补：doc-watcher 只盯「当前打开文档所在目录」、为外部改内容时重载编辑器；这个盯「整个根、
// 递归」、为侧栏文件树实时跟随磁盘。
//
// 单例：同一时刻只盯一个根，换工作区先关上一个（同 doc-watcher）。
// recursive：mac/win 原生支持（FSEvents / ReadDirectoryChangesW）；Linux（CI e2e 在 ubuntu 跑）Node 20+ 支持。
// 不支持的平台 fs.watch 会抛 → 捕获后放弃监听，靠 renderer 的「窗口重新聚焦时刷新」兜底。
// 去抖 200ms：外部批量操作（解压 / git checkout / 拖一堆文件）会爆一串事件，coalesce 成一次重读。
const fs = require('fs');

let watcher = null;
let timer = null;
const DEBOUNCE_MS = 200;

function close() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (watcher) { try { watcher.close(); } catch (e) { /* 已关 */ } watcher = null; }
}

// 开始盯 root；任意子孙变化（去抖后）调一次 onChange()。
function watch(root, onChange) {
  close();
  if (!root || typeof root !== 'string') return;
  try {
    watcher = fs.watch(root, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; onChange(); }, DEBOUNCE_MS);
    });
  } catch (e) {
    watcher = null; // recursive 不支持 → 放弃监听，靠 renderer 聚焦兜底
  }
}

module.exports = { watch, close };
