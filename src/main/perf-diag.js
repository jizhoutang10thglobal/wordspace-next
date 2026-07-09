// 性能诊断探针（最小版）——主进程侧收集每个根的真实成本，供「诊断面板」(renderer, Cmd+Shift+D) 读取。
// 背景：Wendi 报「两文件夹贼卡」，但我们本地量不出她环境的真实规模/形状（她的桌面 + 谷歌网盘）。云盘
// stat/readTree/watcher-churn 三个假设都已被本地实测推翻，唯一测得的成本是 readTree 随文件数线性涨。
// 这个探针让她复现卡顿时能直接读到：每根文件数、readTree 耗时、watcher 触发次数、是否云盘——诊断用，非产品功能。
const os = require('os');
const path = require('path');

const byPath = new Map(); // rootPath → { fileCount, lastReadMs, maxReadMs, reads, watchEvents, cloud }

// 云盘判定（纯路径前缀，够诊断用）：新版 OneDrive/Google Drive/Dropbox 都挂在 ~/Library/CloudStorage 下；
// iCloud 在 ~/Library/Mobile Documents。命中 = 提示「这个根在云盘同步目录里」。
function cloudKind(p) {
  const home = os.homedir();
  if (p.startsWith(path.join(home, 'Library', 'CloudStorage'))) return 'CloudStorage';
  if (p.startsWith(path.join(home, 'Library', 'Mobile Documents'))) return 'iCloud';
  return '';
}

function entryOf(p) {
  let e = byPath.get(p);
  if (!e) {
    e = { fileCount: 0, lastReadMs: 0, maxReadMs: 0, reads: 0, watchEvents: 0, cloud: cloudKind(p) };
    byPath.set(p, e);
  }
  return e;
}

function recordRead(rootPath, ms, fileCount) {
  const e = entryOf(rootPath);
  e.lastReadMs = Math.round(ms);
  e.maxReadMs = Math.max(e.maxReadMs, Math.round(ms));
  e.fileCount = fileCount;
  e.reads++;
}

function recordWatch(rootPath) {
  entryOf(rootPath).watchEvents++;
}

function snapshot() {
  return [...byPath.entries()].map(([p, e]) => ({ path: p, ...e }));
}

module.exports = { recordRead, recordWatch, snapshot, cloudKind };
