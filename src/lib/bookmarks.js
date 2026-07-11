// 收藏夹纯逻辑（spec docs/browser-feature-spec.md §2.2 / §4.9）。全部纯函数（state 进 state 出），
// 持久化/对话框在主进程 browser-store / ipc；不带 require('electron')——node:test 直接单测。
// 语义镜像 ui-demo/src/mock/bookmarks.ts（互通硬契约：Netscape 两端逻辑一字别改语义）。
//
// state = { folders: [{ id, name }], bookmarks: [{ id, title, url, folderId, addedAt(ms), favicon? }] }
// BM_BAR = 「书签栏」固定文件夹：☆/⌘D 默认落这里；不可改名/删除。

const BM_BAR = 'bm-bar';
let idSeq = 0;
const uid = (p, ts) => p + '-' + Number(ts || 0).toString(36) + '-' + ++idSeq;

function emptyState() {
  return { folders: [{ id: BM_BAR, name: '书签栏' }], bookmarks: [] };
}
// 载入/操作前兜底：保证书签栏文件夹存在且形状合法。
function sanitize(state) {
  const s = state && typeof state === 'object' ? state : {};
  let folders = Array.isArray(s.folders)
    ? s.folders.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
    : [];
  if (!folders.some((f) => f.id === BM_BAR)) folders = [{ id: BM_BAR, name: '书签栏' }, ...folders];
  const ids = new Set(folders.map((f) => f.id));
  // favicon 只留 http(s) 或有限长 data:（主进程存的是 data:URL）——拒 javascript: 和无上限 data:
  // （sanitize 是「载入前防旧数据毒化」的兜底,磁盘被塞多 MB data:URL 会永久重持久化+每次全量推 renderer,P2-5）。
  const okFavicon = (f) => typeof f === 'string' && f && (/^https?:\/\//i.test(f) || (/^data:image\//i.test(f) && f.length <= 256 * 1024));
  const bookmarks = Array.isArray(s.bookmarks)
    ? s.bookmarks
        .filter((b) => b && typeof b.url === 'string' && /^https?:\/\//i.test(b.url) && ids.has(b.folderId))
        .map((b) => ({
          id: typeof b.id === 'string' && b.id ? b.id : uid('bm', b.addedAt),
          title: typeof b.title === 'string' && b.title.trim() ? b.title : b.url,
          url: b.url,
          folderId: b.folderId,
          addedAt: typeof b.addedAt === 'number' ? b.addedAt : 0,
          ...(okFavicon(b.favicon) ? { favicon: b.favicon } : {}),
        }))
    : [];
  return { folders, bookmarks };
}

function isBookmarked(state, url) {
  return state.bookmarks.some((b) => b.url === url);
}
function add(state, { title, url, folderId, favicon, ts }) {
  const id = uid('bm', ts);
  const fid = folderId && state.folders.some((f) => f.id === folderId) ? folderId : BM_BAR;
  const bm = { id, title: title || url, url, folderId: fid, addedAt: ts || 0 };
  if (favicon) bm.favicon = favicon;
  return { state: { folders: state.folders, bookmarks: [bm, ...state.bookmarks] }, id };
}
// ⌘D/☆ 取消收藏：**跨全部文件夹**删该 url（spec §4.9 语义注意）。
function removeByUrl(state, url) {
  return { folders: state.folders, bookmarks: state.bookmarks.filter((b) => b.url !== url) };
}
function removeOne(state, id) {
  return { folders: state.folders, bookmarks: state.bookmarks.filter((b) => b.id !== id) };
}
function update(state, id, patch) {
  const allow = {};
  if (patch && typeof patch.title === 'string' && patch.title.trim()) allow.title = patch.title; // 纯空白标题不算改（穿过「空值回退 url」的 UI 约定）
  if (patch && typeof patch.url === 'string' && /^https?:\/\//i.test(patch.url)) allow.url = patch.url;
  if (patch && typeof patch.folderId === 'string' && state.folders.some((f) => f.id === patch.folderId)) allow.folderId = patch.folderId;
  return { folders: state.folders, bookmarks: state.bookmarks.map((b) => (b.id === id ? { ...b, ...allow } : b)) };
}
function addFolder(state, name, ts) {
  const id = uid('bmf', ts);
  return { state: { folders: [...state.folders, { id, name: name || '新文件夹' }], bookmarks: state.bookmarks }, id };
}
function renameFolder(state, id, name) {
  if (id === BM_BAR || !name) return state; // 书签栏固定
  return { folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)), bookmarks: state.bookmarks };
}
// 删文件夹连同其中书签；BM_BAR 拒绝。
function removeFolder(state, id) {
  if (id === BM_BAR) return state;
  return {
    folders: state.folders.filter((f) => f.id !== id),
    bookmarks: state.bookmarks.filter((b) => b.folderId !== id),
  };
}

// ---- Netscape Bookmark File Format（互通硬契约）----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const sec = (ms) => Math.floor(ms / 1000); // ADD_DATE 是 Unix 秒

function toNetscapeHtml(state) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  for (const f of state.folders) {
    const isBar = f.id === BM_BAR;
    lines.push(`    <DT><H3${isBar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${esc(f.name)}</H3>`);
    lines.push('    <DL><p>');
    for (const b of state.bookmarks.filter((x) => x.folderId === f.id)) {
      lines.push(`        <DT><A HREF="${esc(b.url)}" ADD_DATE="${sec(b.addedAt)}">${esc(b.title)}</A>`);
    }
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join('\n');
}

// 宽松解析（Netscape HTML 闭标签故意不闭合，绝不能当 XML 解）。主进程无 DOM → 按 token 流的宽容解析：
// 扫 <h3…>（文件夹，配合 <dl>/</dl> 深度栈定归属）和 <a href…>（书签）。行为对齐 ui-demo 的 DOMParser 版：
// 每个 h3 是一个（扁平化的）文件夹、其紧随 DL 里的 a 归它；PERSONAL_TOOLBAR_FOLDER 归书签栏；
// h3 之外的裸 a 落书签栏；只收 http(s)；ADD_DATE 秒→毫秒；同文件夹同 url 去重。
function parseNetscapeHtml(html, ts) {
  const src = String(html || '');
  const folders = []; // { id, name }（不含书签栏）
  const bookmarks = [];
  const seen = new Set();
  // token：h3 开标签+内文 / dl 开 / dl 关 / a 标签+内文。h3/a 的内文取到对应闭标签或下一个 <（容忍不闭合）。
  // a 内文取到 </a> 或下一个**结构标签**为止（内嵌 <em>/<b> 不算边界,否则「Title <em>x</em>」标题被截成「Title」,P2-7）。
  const re = /<h3([^>]*)>([\s\S]*?)(?:<\/h3>|(?=<))|<dl[^>]*>|<\/dl>|<a\s([^>]*)>([\s\S]*?)(?:<\/a>|(?=<dt\b|<dl\b|<\/dl\b|<h3\b|<a\s))/gi;
  // 文件夹栈：进 h3 记「待入栈」，它的 <dl> 到来时入栈；</dl> 弹栈。栈顶 = 当前归属文件夹（null=书签栏层）。
  const stack = [];
  let pendingFolder;
  let m;
  while ((m = re.exec(src))) {
    const tok = m[0];
    if (tok[1] === 'h' || tok[1] === 'H') {
      const attrs = m[1] || '';
      const name = unesc((m[2] || '').trim()) || '文件夹';
      const isBar = /personal_toolbar_folder\s*=\s*["']?true/i.test(attrs);
      if (isBar) pendingFolder = { id: BM_BAR, name };
      else {
        pendingFolder = { id: uid('imf', ts), name };
        folders.push(pendingFolder);
      }
    } else if (/^<dl/i.test(tok)) {
      stack.push(pendingFolder || null); // 无 h3 的 DL（最外层）归 null=书签栏
      pendingFolder = undefined;
    } else if (/^<\/dl/i.test(tok)) {
      stack.pop();
      pendingFolder = undefined; // 清悬挂 h3（h3 后没 DL 就来了 </dl>）,否则它会劫持后续无关 DL 的书签（P2-6）
    } else {
      const attrs = m[3] || '';
      // ⚠ href 正则要有属性名边界（(?:^|\s)）——否则 `data-href="..."` 或 base64 ICON 尾巴以 `href=` 收尾时
      // 会抢在真 HREF 之前匹配到,整条书签被静默吞掉（P2-1,互通契约主路径）。
      const href = /(?:^|\s)href\s*=\s*"([^"]*)"/i.exec(attrs) || /(?:^|\s)href\s*=\s*'([^']*)'/i.exec(attrs) || /(?:^|\s)href\s*=\s*([^\s>]+)/i.exec(attrs);
      const url = href ? unesc(href[1]) : '';
      if (!/^https?:\/\//i.test(url)) continue;
      const top = stack.length ? stack[stack.length - 1] : null;
      const folderId = top ? top.id : BM_BAR;
      if (seen.has(folderId + '|' + url)) continue;
      seen.add(folderId + '|' + url);
      const add_ = /(?:^|\s)add_date\s*=\s*["']?(\d+)/i.exec(attrs);
      bookmarks.push({
        id: uid('imb', ts),
        title: unesc(String(m[4] || '').replace(/<[^>]*>/g, '').trim()) || url, // strip 内嵌标签（<em> 等）,取纯文本标题
        url,
        folderId,
        addedAt: add_ ? Number(add_[1]) * 1000 : ts || 0,
      });
    }
  }
  // 空文件夹也保留（对齐 ui-demo：收藏页里显示「空」；侧栏收藏区本来就不渲染空文件夹）。
  return { folders, bookmarks };
}

// 导入合并（Colin 2026-07-10 拍板）：对方书签栏并入我们的书签栏；其他文件夹**追加为新文件夹，
// 重名不合并**——重名加「名字 2」式后缀；同文件夹同 url 跳过；返回 { state, parsed, added }。
function importNetscape(state, html, ts) {
  const { folders, bookmarks } = parseNetscapeHtml(html, ts);
  if (!bookmarks.length) return { state, parsed: 0, added: 0 };
  const taken = new Set(state.folders.map((f) => f.name));
  const renamed = folders.map((f) => {
    let name = f.name;
    let n = 2;
    while (taken.has(name)) name = `${f.name} ${n++}`;
    taken.add(name);
    return name === f.name ? f : { ...f, name };
  });
  // 同文件夹同 url 去重（实际只会命中书签栏——非书签栏导入文件夹是全新 id）
  const existing = new Set(state.bookmarks.map((b) => b.folderId + '|' + b.url));
  const fresh = bookmarks.filter((b) => !existing.has(b.folderId + '|' + b.url));
  return {
    state: { folders: [...state.folders, ...renamed], bookmarks: [...state.bookmarks, ...fresh] },
    parsed: bookmarks.length,
    added: fresh.length,
  };
}

module.exports = {
  BM_BAR,
  emptyState,
  sanitize,
  isBookmarked,
  add,
  removeByUrl,
  removeOne,
  update,
  addFolder,
  renameFolder,
  removeFolder,
  toNetscapeHtml,
  parseNetscapeHtml,
  importNetscape,
};
