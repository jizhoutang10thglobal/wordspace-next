// 监听当前打开文档的磁盘变化（Bug2：用 Claude 等外部工具改完文件后，app 自动重载渲染）。
// 单例：同一时刻只盯一个文档；换文档时 watch() 会先关上一个。
//
// 设计取舍：
// - 盯**所在目录**而非文件本身，按 basename 过滤——很多编辑器/工具是「写临时文件 + rename 覆盖」
//   （原子保存），直接 fs.watch 文件会因 inode 被替换而失聪；盯目录则稳。
// - 去抖 180ms：外部一次保存常触发多个 change 事件，coalesce 成一次。
// - 自存盘抑制：app 自己保存也会改盘，noteSelfWrite() 打时间戳，窗口内的变化忽略，不回灌重载。

const fs = require('fs');
const path = require('path');

let watcher = null;
let watchedPath = null;
let timer = null;
let lastSelfWrite = 0;
const SELF_WRITE_MS = 800; // 自存盘后这段时间内的盘变化视为自己写的，不当外部改动
const DEBOUNCE_MS = 180;

// app 自己保存前调用：标记，使紧随其后的盘变化不触发外部重载。
function noteSelfWrite() { lastSelfWrite = Date.now(); }

function close() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (watcher) { try { watcher.close(); } catch (e) { /* 已关 */ } watcher = null; }
  watchedPath = null;
}

// 开始盯 p；外部改动（去抖、排除自存盘、文件仍在）时调用 onChange(p)。
function watch(p, onChange) {
  close();
  if (!p || typeof p !== 'string') return;
  watchedPath = p;
  const dir = path.dirname(p);
  const base = path.basename(p);
  try {
    watcher = fs.watch(dir, (event, filename) => {
      if (filename && path.basename(filename) !== base) return; // 只关这个文件
      if (Date.now() - lastSelfWrite < SELF_WRITE_MS) return;    // 自存盘引发，跳过
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 文件仍存在才通知（被删/重命名走了就不重载到空）
        fs.access(watchedPath, fs.constants.F_OK, (err) => { if (!err) onChange(watchedPath); });
      }, DEBOUNCE_MS);
    });
    watcher.on('error', () => close()); // 目录被删等 → 静默放弃，不崩主进程
  } catch (e) {
    // 极少数目录不可 watch：放弃监听，不影响正常编辑
    watcher = null;
    watchedPath = null;
  }
}

module.exports = { watch, close, noteSelfWrite, _state: () => ({ watchedPath, watching: !!watcher }) };
