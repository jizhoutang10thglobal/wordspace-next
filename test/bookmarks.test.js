// 收藏夹纯逻辑单测（spec §2.2/§4.9：CRUD / 书签栏固定 / Netscape 互通 / 导入重名后缀不合并）。
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../src/lib/bookmarks');

const T0 = 1_800_000_000_000;
const withData = () => {
  let s = B.emptyState();
  let r = B.addFolder(s, '工作', T0);
  s = r.state;
  const workId = r.id;
  s = B.add(s, { title: 'Bing', url: 'https://www.bing.com/', ts: T0 }).state; // → 书签栏
  s = B.add(s, { title: '周报', url: 'https://a.com/weekly', folderId: workId, ts: T0 + 1000 }).state;
  return { s, workId };
};

test('emptyState/sanitize：书签栏文件夹恒在、不可丢', () => {
  assert.ok(B.emptyState().folders.some((f) => f.id === B.BM_BAR));
  const s = B.sanitize({ folders: [{ id: 'x', name: 'X' }], bookmarks: 'bad' });
  assert.strictEqual(s.folders[0].id, B.BM_BAR); // 补回且在最前
  assert.deepStrictEqual(s.bookmarks, []);
  // 无主书签（folderId 不存在）被清掉；非 http(s) url 被清掉
  const s2 = B.sanitize({
    folders: [{ id: B.BM_BAR, name: '书签栏' }],
    bookmarks: [
      { id: 'b1', title: 'ok', url: 'https://a.com/', folderId: B.BM_BAR, addedAt: T0 },
      { id: 'b2', title: 'orphan', url: 'https://b.com/', folderId: 'ghost', addedAt: T0 },
      { id: 'b3', title: 'bad', url: 'file:///etc/passwd', folderId: B.BM_BAR, addedAt: T0 },
    ],
  });
  assert.deepStrictEqual(s2.bookmarks.map((b) => b.id), ['b1']);
});

test('add：默认落书签栏；未知 folderId 回落书签栏；isBookmarked 按 url', () => {
  let s = B.emptyState();
  s = B.add(s, { title: 'A', url: 'https://a.com/', ts: T0 }).state;
  assert.strictEqual(s.bookmarks[0].folderId, B.BM_BAR);
  s = B.add(s, { title: 'B', url: 'https://b.com/', folderId: 'nope', ts: T0 }).state;
  assert.strictEqual(s.bookmarks[0].folderId, B.BM_BAR);
  assert.ok(B.isBookmarked(s, 'https://a.com/'));
  assert.ok(!B.isBookmarked(s, 'https://c.com/'));
});

test('removeByUrl：跨全部文件夹删该 url（⌘D 取消收藏语义）', () => {
  let { s, workId } = withData();
  s = B.add(s, { title: '同址', url: 'https://www.bing.com/', folderId: workId, ts: T0 + 2000 }).state;
  assert.strictEqual(s.bookmarks.filter((b) => b.url === 'https://www.bing.com/').length, 2);
  s = B.removeByUrl(s, 'https://www.bing.com/');
  assert.strictEqual(s.bookmarks.filter((b) => b.url === 'https://www.bing.com/').length, 0);
  assert.strictEqual(s.bookmarks.length, 1); // 别的不受伤
});

test('update：title/url/folderId 白名单 patch；坏 url / 未知文件夹不生效', () => {
  const { s, workId } = withData();
  const id = s.bookmarks.find((b) => b.title === 'Bing').id;
  let s2 = B.update(s, id, { title: '必应', folderId: workId, url: 'javascript:alert(1)' });
  const b = s2.bookmarks.find((x) => x.id === id);
  assert.strictEqual(b.title, '必应');
  assert.strictEqual(b.folderId, workId);
  assert.strictEqual(b.url, 'https://www.bing.com/'); // 坏 url 拒
  s2 = B.update(s2, id, { folderId: 'ghost' });
  assert.strictEqual(s2.bookmarks.find((x) => x.id === id).folderId, workId);
});

test('renameFolder/removeFolder：书签栏固定不可改名不可删；删文件夹连同其中书签', () => {
  const { s, workId } = withData();
  assert.strictEqual(B.renameFolder(s, B.BM_BAR, '改名'), s);
  assert.strictEqual(B.removeFolder(s, B.BM_BAR), s);
  const renamed = B.renameFolder(s, workId, '工作台');
  assert.strictEqual(renamed.folders.find((f) => f.id === workId).name, '工作台');
  const removed = B.removeFolder(s, workId);
  assert.ok(!removed.folders.some((f) => f.id === workId));
  assert.ok(!removed.bookmarks.some((b) => b.folderId === workId)); // 连同书签
  assert.ok(removed.bookmarks.some((b) => b.folderId === B.BM_BAR)); // 书签栏的还在
});

test('Netscape 导出：DOCTYPE/结构/书签栏 PERSONAL_TOOLBAR_FOLDER/实体转义/ADD_DATE 秒', () => {
  let { s } = withData();
  s = B.add(s, { title: 'A & B <tag>', url: 'https://x.com/?a=1&b="q"', ts: T0 }).state;
  const html = B.toNetscapeHtml(s);
  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.ok(html.includes('PERSONAL_TOOLBAR_FOLDER="true"'));
  assert.ok(html.includes('A &amp; B &lt;tag&gt;'));
  assert.ok(html.includes('ADD_DATE="' + Math.floor(T0 / 1000) + '"'));
  assert.ok(!html.includes('<tag>'));
});

test('Netscape 往返：导出再导进空库，文件夹/书签/归属/时间全保', () => {
  const { s } = withData();
  const html = B.toNetscapeHtml(s);
  const r = B.importNetscape(B.emptyState(), html, T0 + 9999);
  assert.strictEqual(r.parsed, 2);
  assert.strictEqual(r.added, 2);
  const bar = r.state.bookmarks.filter((b) => b.folderId === B.BM_BAR);
  assert.deepStrictEqual(bar.map((b) => b.title), ['Bing']);
  assert.strictEqual(bar[0].addedAt, T0); // ADD_DATE 秒→毫秒（截到秒）
  const work = r.state.folders.find((f) => f.name === '工作');
  assert.ok(work && work.id !== B.BM_BAR);
  assert.deepStrictEqual(r.state.bookmarks.filter((b) => b.folderId === work.id).map((b) => b.title), ['周报']);
});

test('导入 Chrome 式文件：嵌套子文件夹归属正确、非 http 链接丢弃、无 h3 的裸 a 落书签栏', () => {
  const chrome = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    '    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>',
    '    <DL><p>',
    '        <DT><A HREF="https://top.com/" ADD_DATE="1700000000">Top</A>',
    '        <DT><H3 ADD_DATE="1700000000">子夹</H3>',
    '        <DL><p>',
    '            <DT><A HREF="https://sub.com/" ADD_DATE="1700000000">Sub</A>',
    '            <DT><A HREF="ftp://bad.com/">Bad</A>',
    '        </DL><p>',
    '        <DT><A HREF="https://top2.com/" ADD_DATE="1700000000">Top2</A>',
    '    </DL><p>',
    '</DL><p>',
  ].join('\n');
  const r = B.importNetscape(B.emptyState(), chrome, T0);
  assert.strictEqual(r.parsed, 3);
  const sub = r.state.folders.find((f) => f.name === '子夹');
  assert.ok(sub);
  assert.deepStrictEqual(r.state.bookmarks.filter((b) => b.folderId === sub.id).map((b) => b.title), ['Sub']);
  // 子夹结束后回到书签栏层
  assert.deepStrictEqual(
    r.state.bookmarks.filter((b) => b.folderId === B.BM_BAR).map((b) => b.title).sort(),
    ['Top', 'Top2'],
  );
  // 无 h3 的裸列表
  const bare = B.importNetscape(B.emptyState(), '<a href="https://x.com/">X</a>', T0);
  assert.strictEqual(bare.added, 1);
  assert.strictEqual(bare.state.bookmarks[0].folderId, B.BM_BAR);
});

test('导入重名文件夹：不合并，加「名字 2」式后缀（Colin 拍板）；书签栏例外天然共用', () => {
  let { s } = withData(); // 已有「工作」
  const incoming = [
    '<DL><p>',
    '  <DT><H3>工作</H3>',
    '  <DL><p><DT><A HREF="https://new.com/" ADD_DATE="1700000000">新条目</A></DL><p>',
    '  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>',
    '  <DL><p><DT><A HREF="https://barnew.com/" ADD_DATE="1700000000">BarNew</A></DL><p>',
    '</DL><p>',
  ].join('\n');
  const r = B.importNetscape(s, incoming, T0 + 5000);
  const works = r.state.folders.filter((f) => f.name === '工作' || f.name === '工作 2');
  assert.strictEqual(works.length, 2); // 原「工作」+ 新「工作 2」，没合并
  const w2 = r.state.folders.find((f) => f.name === '工作 2');
  assert.deepStrictEqual(r.state.bookmarks.filter((b) => b.folderId === w2.id).map((b) => b.title), ['新条目']);
  // 对方书签栏并入我们书签栏
  assert.ok(r.state.bookmarks.some((b) => b.folderId === B.BM_BAR && b.url === 'https://barnew.com/'));
  // 再导一次同名 → 「工作 3」
  const r2 = B.importNetscape(r.state, incoming, T0 + 6000);
  assert.ok(r2.state.folders.some((f) => f.name === '工作 3'));
});

test('导入去重：同文件夹同 url 跳过，toast 数字 = 净新增；全重复 added=0', () => {
  const { s } = withData();
  const dupe = [
    '<DL><p>',
    '  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bar</H3>',
    '  <DL><p>',
    '    <DT><A HREF="https://www.bing.com/" ADD_DATE="1700000000">Bing 重复</A>',
    '    <DT><A HREF="https://fresh.com/" ADD_DATE="1700000000">新的</A>',
    '  </DL><p>',
    '</DL><p>',
  ].join('\n');
  const r = B.importNetscape(s, dupe, T0);
  assert.strictEqual(r.parsed, 2);
  assert.strictEqual(r.added, 1); // bing 已在书签栏 → 跳过
  const all = B.importNetscape(r.state, dupe, T0);
  assert.strictEqual(all.added, 0);
  // 解析不出 → parsed 0
  assert.strictEqual(B.importNetscape(s, '<p>not bookmarks</p>', T0).parsed, 0);
});

test('导入实体解码：&amp; 等在标题/URL 还原', () => {
  const html = '<DL><p><DT><A HREF="https://x.com/?a=1&amp;b=2">A &amp; B</A></DL><p>';
  const r = B.importNetscape(B.emptyState(), html, T0);
  assert.strictEqual(r.state.bookmarks[0].url, 'https://x.com/?a=1&b=2');
  assert.strictEqual(r.state.bookmarks[0].title, 'A & B');
});

test('导入 href 边界(P2-1)：data-href/base64 ICON 尾巴不抢真 HREF', () => {
  const r1 = B.importNetscape(B.emptyState(), '<DT><A data-href="javascript:evil" HREF="http://good.example/">good</A>', T0);
  assert.strictEqual(r1.added, 1);
  assert.strictEqual(r1.state.bookmarks[0].url, 'http://good.example/');
  // base64 ICON 以 href= 收尾（前面是非空白字符）
  const r2 = B.importNetscape(B.emptyState(), '<DT><A ICON="data:image/png;base64,AAAhref=" HREF="http://real.example/">x</A>', T0);
  assert.strictEqual(r2.added, 1);
  assert.strictEqual(r2.state.bookmarks[0].url, 'http://real.example/');
});

test('导入标题内嵌标签(P2-7)：<em> 被 strip,取完整纯文本', () => {
  const r = B.importNetscape(B.emptyState(), '<DT><A HREF="http://a.example/">Title with <em>markup</em> tail</A>', T0);
  assert.strictEqual(r.state.bookmarks[0].title, 'Title with markup tail');
});

test('导入 </dl> 清 pendingFolder(P2-6)：畸形空文件夹不劫持后续书签', () => {
  const html = '<DL><p><DT><H3>Sub</H3></DL><p> <DL><p><DT><A HREF="http://stray.example/">s</A></DL><p>';
  const r = B.importNetscape(B.emptyState(), html, T0);
  const stray = r.state.bookmarks.find((b) => b.url === 'http://stray.example/');
  assert.strictEqual(stray.folderId, 'bm-bar'); // 归书签栏,不归 Sub
});

test('sanitize favicon 校验(P2-5)：javascript: 和超长 data: 被剔,http/合理 data: 保留;纯空白标题回退 url', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
  const s = B.sanitize({
    folders: [{ id: B.BM_BAR, name: '书签栏' }],
    bookmarks: [
      { id: 'b1', title: 'ok', url: 'https://a.com/', folderId: B.BM_BAR, addedAt: T0, favicon: 'javascript:alert(1)' },
      { id: 'b2', title: '   ', url: 'https://b.com/', folderId: B.BM_BAR, addedAt: T0, favicon: big },
      { id: 'b3', title: 'g', url: 'https://c.com/', folderId: B.BM_BAR, addedAt: T0, favicon: 'https://c.com/f.ico' },
    ],
  });
  assert.strictEqual(s.bookmarks.find((b) => b.id === 'b1').favicon, undefined); // javascript: 剔
  assert.strictEqual(s.bookmarks.find((b) => b.id === 'b2').favicon, undefined); // 超长 data: 剔
  assert.strictEqual(s.bookmarks.find((b) => b.id === 'b2').title, 'https://b.com/'); // 纯空白标题回退 url
  assert.strictEqual(s.bookmarks.find((b) => b.id === 'b3').favicon, 'https://c.com/f.ico'); // http favicon 留
});

test('update 纯空白标题不生效(P2-5)', () => {
  let st = B.emptyState();
  st = B.add(st, { title: '原标题', url: 'https://a.com/', ts: T0 }).state;
  const id = st.bookmarks[0].id;
  st = B.update(st, id, { title: '   ' });
  assert.strictEqual(st.bookmarks[0].title, '原标题'); // 空白不改
});
