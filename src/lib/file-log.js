// 极简文件日志（给 electron-updater 当 logger，落 userData/logs/updater.log）。
// 纯 Node、不带 require('electron')；所有 fs 错误全吞——日志绝不能反噬 app。
// 接口按 electron-updater 的 logger 约定：info/warn/error/debug 四个方法。
const fs = require('fs');
const path = require('path');

function stringify(a) {
  if (a instanceof Error) return a.stack || a.message || String(a);
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function createFileLogger(file, opts) {
  const maxBytes = (opts && opts.maxBytes) || 512 * 1024;
  let dirReady = false;
  function ensureDir() {
    if (dirReady) return true;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); dirReady = true; } catch { /* 只读盘等：放弃日志 */ }
    return dirReady;
  }
  function write(level, args) {
    if (!ensureDir()) return;
    try {
      try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.old'); } catch { /* 首次无文件 */ }
      fs.appendFileSync(file, new Date().toISOString() + ' [' + level + '] ' + args.map(stringify).join(' ') + '\n');
    } catch { /* 写失败不抛 */ }
  }
  return {
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    debug: (...a) => write('debug', a),
    path: file,
  };
}

module.exports = { createFileLogger };
