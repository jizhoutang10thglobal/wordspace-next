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

// ================= U2：下载记录第四 cell（spec §4.11 / P3）=================
// 把原始记录直接写盘再 init，测 load-sanitize；roundtrip 用 flushSync 冲盘（跳过 500ms 防抖）。
function writeDownloadsFile(dir, entries) {
  fs.writeFileSync(path.join(dir, 'browser-downloads.json'), JSON.stringify({ version: 1, entries }), 'utf8');
}
const termEntry = (id, extra = {}) => ({
  id, filename: id + '.pdf', sourceUrl: 'https://x/' + id + '.pdf',
  sizeBytes: 100, receivedBytes: 100, state: 'completed', startedAt: 1, savePath: '/dl/' + id + '.pdf', ...extra,
});

test('U2 下载 cell：存→读 roundtrip 字段无损（含 savePath）', () => {
  const dir = freshDir();
  store.init(dir);
  const entries = [termEntry('d1'), termEntry('d2', { state: 'canceled', receivedBytes: 40 })];
  store.setDownloads(entries);
  store.flushSync();   // 冲盘（否则 500ms 防抖没落地）
  store.init(dir);     // 重开 = 重新 load
  assert.deepStrictEqual(store.getDownloads(), entries); // 白名单 8 字段全无损
});

test('U2 下载 cell：load 时 downloading → interrupted（spec §4.11 退出中断，P3 核心）', () => {
  const dir = freshDir();
  writeDownloadsFile(dir, [
    termEntry('d1', { state: 'downloading', receivedBytes: 40, sizeBytes: 1000 }),
    termEntry('d2', { state: 'completed' }),
  ]);
  store.init(dir);
  const out = store.getDownloads();
  assert.strictEqual(out.find((e) => e.id === 'd1').state, 'interrupted'); // 在途翻中断
  assert.strictEqual(out.find((e) => e.id === 'd1').receivedBytes, 40);     // 中断点如实保留
  assert.strictEqual(out.find((e) => e.id === 'd2').state, 'completed');    // 终态不动
});

test('U2 下载 cell：坏形状条目 load 时静默剔除', () => {
  const dir = freshDir();
  writeDownloadsFile(dir, [
    { filename: 'noid.pdf', state: 'completed' },      // 缺 id
    termEntry('d2'),                                   // 唯一合法
    { id: 'd3', filename: 'x', state: 'bogus' },       // state 不在枚举
    null,                                              // 非对象
  ]);
  store.init(dir);
  const out = store.getDownloads();
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'd2');
});

test('U2 下载 cell：CAP 在 load 时应用——101 条（全终态）挤到 100，挤最老端', () => {
  // 【CAP 放哪的决策记录】放在 cell 的 load lambda（capDownloads(sanitizeDownloads(...))），不放 setDownloads。
  //   ① load 后经 sanitize 已全终态（在途都翻了 interrupted），挤最老终态不会误伤在途 → 放 load 安全且可测。
  //   ② 运行时 CAP（含「在途绝不挤」保护）归 U3 的 push 侧；「在途不挤」由 test/downloads.test.js 直测 capDownloads。
  //   ③ 镜像 web-history 先例：sanitize 的 slice(0,CAP) = load 端，record 的 slice(0,CAP) = mutation 端；
  //      setDownloads 保持薄（照 setHistory），运行时插入的裁剪交给 U3。
  const dir = freshDir();
  const entries = [];
  for (let i = 0; i < 101; i++) entries.push(termEntry('e' + i, { startedAt: 101 - i })); // e0 最新在前 … e100 最老在末
  writeDownloadsFile(dir, entries);
  store.init(dir);
  const out = store.getDownloads();
  assert.strictEqual(out.length, 100);
  assert.strictEqual(out[0].id, 'e0');            // 最新保留
  assert.ok(!out.some((e) => e.id === 'e100'));   // 最老被挤
});

test('U2 下载 cell：setDownloads 触发 notify(downloads) leading-edge 推送', () => {
  const dir = freshDir();
  store.init(dir);
  let pushes = 0;
  let last = null;
  store.subscribe('downloads', (data) => { pushes++; last = data; });
  const entries = [termEntry('d1', { state: 'downloading', receivedBytes: 0 })];
  store.setDownloads(entries);
  assert.strictEqual(pushes, 1);       // leading 立即推（进度环/popover 要 live 更新）
  assert.strictEqual(last, entries);   // 推的是最新 data 引用
});
