// browser-store 单测（P3-11）：收藏无条数上限 + 变更推送 leading-edge 防抖合并。
// 纯 Node（browser-store 不 require('electron')，init 吃 tmpdir）。
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const store = require('../src/main/browser-store');
const B = require('../src/lib/bookmarks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-bmstore-'));

test('P3-11 收藏无条数上限：塞 6000 条全留（不静默丢弃）', () => {
  store.init(freshDir());
  let s = B.emptyState();
  const bms = [];
  for (let i = 0; i < 6000; i++) bms.push({ id: 'b' + i, title: 't' + i, url: 'https://x' + i + '.com/', folderId: B.BM_BAR, addedAt: 1 });
  s = { folders: s.folders, bookmarks: bms };
  store.setBookmarks(s);
  assert.strictEqual(store.getBookmarks().bookmarks.length, 6000); // 无 cap 截断
});

test('P3-11 变更推送 leading-edge 防抖合并：一串快速变更只推 leading+trailing 两次', async () => {
  store.init(freshDir());
  let pushes = 0;
  store.subscribe('bookmarks', () => { pushes++; });
  // 同一 tick 内 5 次快速连续变更
  let s = B.emptyState();
  for (let i = 0; i < 5; i++) {
    s = B.add(s, { title: 'B' + i, url: 'https://x' + i + '.com/', ts: 1 }).state;
    store.setBookmarks(s);
  }
  assert.strictEqual(pushes, 1, 'leading：第一次变更应立即推一次');
  await sleep(320); // > NOTIFY_MS(200)
  assert.strictEqual(pushes, 2, 'trailing：窗口内其余 4 次应合并成 1 次补推（不是 5 次）');
  // 推的是最终全量 state
  assert.strictEqual(store.getBookmarks().bookmarks.length, 5);
});

test('P3-11 单次变更只推一次（leading，无多余 trailing）', async () => {
  store.init(freshDir());
  let pushes = 0;
  store.subscribe('bookmarks', () => { pushes++; });
  store.setBookmarks(B.add(B.emptyState(), { title: 'A', url: 'https://a.com/', ts: 1 }).state);
  assert.strictEqual(pushes, 1);
  await sleep(320);
  assert.strictEqual(pushes, 1, '窗口内无更多变更 → 不补推');
});
