// 监听当前打开文档的磁盘变化（Bug2：用 Claude 等外部工具改完文件后，app 自动重载渲染）。
// 单例：同一时刻只盯一个文档；换文档时 watch() 会先关上一个。
//
// 设计取舍：
// - 盯**所在目录**而非文件本身，按 basename 过滤——很多编辑器/工具是「写临时文件 + rename 覆盖」
//   （原子保存），直接 fs.watch 文件会因 inode 被替换而失聪；盯目录则稳。
// - 去抖 180ms：外部一次保存常触发多个 change 事件，coalesce 成一次。
// - 自存盘 / 去重靠 **mtime**，不用时间窗：noteSelfWrite() 在 app 写完后把新 mtime 记成「已知」，
//   watcher 只在磁盘 mtime ≠ 已知值时才重载。这样自存盘（mtime 已知）不回灌；而任何外部改动都有
//   不同 mtime、一定被捕获——不会像固定时间窗那样把「保存后紧跟的外部编辑」误吞掉。
//   （注：盯目录时，监听回调在写期间就可能触发，时间窗会有竞态；mtime 去重无此问题，CI 也稳。）

const fs = require('fs');
const path = require('path');

let watcher = null;
let watchedPath = null;
let timer = null;
let lastMtimeMs = 0; // 「已知」mtime：基线 + app 自己每次写完更新；磁盘 mtime 与它不同才算外部改动
const DEBOUNCE_MS = 180;

// app 自己保存写完后调用：把刚写出的 mtime 记为已知，使这次盘变化不被当成外部改动重载。
function noteSelfWrite() {
  if (!watchedPath) return;
  try { lastMtimeMs = fs.statSync(watchedPath).mtimeMs; } catch (e) { /* 读不到就算了，下次 stat 兜底 */ }
}

function close() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (watcher) { try { watcher.close(); } catch (e) { /* 已关 */ } watcher = null; }
  watchedPath = null;
}

// 开始盯 p；外部改动（去抖 + 目标文件 mtime 真变了、不等于已知值）时调用 onChange(p)。
function watch(p, onChange) {
  close();
  if (!p || typeof p !== 'string') return;
  watchedPath = p;
  try { lastMtimeMs = fs.statSync(p).mtimeMs; } catch (e) { lastMtimeMs = 0; } // 基线 mtime
  const dir = path.dirname(p);
  const base = path.basename(p);
  try {
    watcher = fs.watch(dir, (event, filename) => {
      if (filename && path.basename(filename) !== base) return; // 只关这个文件（filename 缺失时靠下面 mtime 兜底）
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 比对目标文件 mtime：没了/读不到 → 不重载到空；mtime == 已知值（自存盘 / 同目录他文件事件 /
        // 重复事件）→ 跳过；不同 → 是外部改动，更新已知值并通知。
        fs.stat(watchedPath, (err, st) => {
          if (err) return;
          if (st.mtimeMs === lastMtimeMs) return;
          lastMtimeMs = st.mtimeMs;
          onChange(watchedPath);
        });
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
