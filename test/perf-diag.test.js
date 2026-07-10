const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const diag = require('../src/main/perf-diag.js');

test('recordRead 累积每根的 readTree 耗时/文件数/次数，maxReadMs 取峰值', () => {
  const p = '/tmp/ws2-diag-a-' + Math.random().toString(36).slice(2);
  diag.recordRead(p, 120.7, 300);
  diag.recordRead(p, 80.2, 305);
  const e = diag.snapshot().find((x) => x.path === p);
  assert.equal(e.reads, 2);
  assert.equal(e.fileCount, 305); // 最近一次
  assert.equal(e.lastReadMs, 80); // 四舍五入
  assert.equal(e.maxReadMs, 121); // 峰值是第一次
});

test('recordWatch 数每根 watcher 触发次数', () => {
  const p = '/tmp/ws2-diag-b-' + Math.random().toString(36).slice(2);
  diag.recordWatch(p);
  diag.recordWatch(p);
  diag.recordWatch(p);
  const e = diag.snapshot().find((x) => x.path === p);
  assert.equal(e.watchEvents, 3);
});

test('cloudKind：CloudStorage / iCloud 前缀判定，本地返回空', () => {
  const home = os.homedir();
  assert.equal(diag.cloudKind(path.join(home, 'Library/CloudStorage/OneDrive-Personal/x')), 'CloudStorage');
  assert.equal(diag.cloudKind(path.join(home, 'Library/CloudStorage/GoogleDrive-me/x')), 'CloudStorage');
  assert.equal(diag.cloudKind(path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs/x')), 'iCloud');
  assert.equal(diag.cloudKind('/Users/x/Desktop/proj'), '');
});

test('snapshot 里每根带 cloud 标记（云盘根一眼可辨）', () => {
  const home = os.homedir();
  const cloud = path.join(home, 'Library/CloudStorage/OneDrive-Personal/proj-' + Math.random().toString(36).slice(2));
  diag.recordRead(cloud, 900, 24000);
  const e = diag.snapshot().find((x) => x.path === cloud);
  assert.equal(e.cloud, 'CloudStorage');
});
