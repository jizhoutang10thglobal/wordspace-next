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
    e = {
      fileCount: 0, dirCount: 0, payloadBytes: 0, lastReadMs: 0, maxReadMs: 0, reads: 0,
      scopedReads: 0, lastScopedMs: 0, dirReads: 0, lastDirReadMs: 0, watchEvents: 0,
      cloud: cloudKind(p), lastCostMs: 0,
    };
    byPath.set(p, e);
  }
  return e;
}

// extra（V4 补盲区，诊断 §7「fileCount 不含目录 / 无 IPC payload 体积指标」）：dirCount = 目录数，
// bytes = IPC 载荷估算字节（O(N) 从 rel 长度估，不真序列化——真 stringify 会给普通根加不该有的成本，红线）。
function recordRead(rootPath, ms, fileCount, extra) {
  const e = entryOf(rootPath);
  e.lastReadMs = Math.round(ms);
  e.maxReadMs = Math.max(e.maxReadMs, Math.round(ms));
  e.fileCount = fileCount;
  if (extra) {
    if (extra.dirCount != null) e.dirCount = extra.dirCount;
    if (extra.bytes != null) e.payloadBytes = extra.bytes;
  }
  e.reads++;
  e.lastCostMs = Math.round(ms);
}

// 单层读取（readDir，lazy 模式浏览）计数。lazy 根「未展开层的变化不触发扫描」= dirReads 不涨（V2 验收锚点）。
function recordDirRead(rootPath, ms) {
  const e = entryOf(rootPath);
  e.dirReads++;
  e.lastDirReadMs = Math.round(ms);
}

// 子树级重扫（readSubtrees）跟全量分开记——fileCount/lastReadMs 保持「全量」语义，诊断面板别被子树数污染。
function recordScoped(rootPath, ms) {
  const e = entryOf(rootPath);
  e.scopedReads++;
  e.lastScopedMs = Math.round(ms);
  e.lastCostMs = Math.round(ms);
}

function recordWatch(rootPath) {
  entryOf(rootPath).watchEvents++;
}

// 自适应去抖：上次扫描（全量或子树）花了多久，去抖至少给它 2 倍喘息、封顶 3s——大根全量扫一次
// 要几秒时别 200ms 一趟趟排队；扫描便宜（子树级）时自动回落 200ms 的灵敏度。
function suggestDebounceMs(rootPath) {
  const e = byPath.get(rootPath);
  const last = e ? e.lastCostMs : 0;
  return Math.min(3000, Math.max(200, last * 2));
}

function snapshot() {
  return [...byPath.entries()].map(([p, e]) => ({ path: p, ...e }));
}

module.exports = { recordRead, recordScoped, recordDirRead, recordWatch, suggestDebounceMs, snapshot, cloudKind };
