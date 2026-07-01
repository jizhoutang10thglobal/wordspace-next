let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let dirty = false;
let undoMgr = null;
let blockEdit = null; // 当前文档的块编辑内核（WS2BlockEdit.attach 返回）；换文档前 detach 防堆叠
let loadGen = 0;       // 每次载入/重载自增；旧的 frame.onload 闭包据此作废，防并发载入（如外部连改 + 重载）交叉 wireEditor

// ---- 临时文档（从「标签页 +」/ Cmd+T 新建，未落盘；对齐 ui-demo 的临时未保存文档）----
// app 的文档 = 磁盘文件，本没有「内存里未落盘」的位置。这里补一个：临时文档 docPath=null，内容只活在
// iframe / tempStore 里，手动保存（走 SaveModal → wsNewDoc）才落盘变成真文件。tempStore 让临时文档切标签
// 不丢——单编辑器一次只 live 一个，切走前 stash 序列化回 store、切回按 store 重渲染。
let tempDoc = null;          // 当前活跃临时文档 { id, base }（base = 默认文件名 / 面包屑名）
const tempStore = new Map(); // id('temp:…') → { base, html }：所有临时文档内容
let tempSeq = 0;
function genTempId() { return 'temp:' + (++tempSeq) + ':' + Date.now().toString(36); }
// 主进程只认「有没有未保存」这个布尔（关窗提示用）：活跃脏 || 存在任何临时文档 = 未保存。
function syncAppDirty() { window.ws2.setDirty(dirty || !!tempDoc || tempStore.size > 0); }

const frame = document.getElementById('doc-frame');
const home = document.getElementById('home');
const docHeader = document.getElementById('doc-header');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const docStatus = document.getElementById('doc-status');
const viewer = document.getElementById('viewer');
const saveBtn = document.getElementById('save-btn');
const exportBtn = document.getElementById('export-btn');

let savedTimer = null; // 「✓ 已保存」淡出定时器（保存成功后闪一下再消失）
function setDirty(v) {
  dirty = v;
  saveBtn.disabled = !(tempDoc || (docPath && v)); // 临时文档没 docPath 也能存（走 SaveModal）
  syncAppDirty();
  // 任何脏态变化都终结上一次「✓ 已保存」的余晖——否则它的定时器会跨文档/重载串台（切文档后还挂在新文档
  // 面包屑上、或外部重载后压住清洁态）。save() 是先 setDirty(false) 再 flashSaved()，这里清掉无妨（flash 紧接重置）。
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = null; }
  if (v) {
    dirtyDot.textContent = '● 未保存';
    dirtyDot.className = 'ws-dirty';
    dirtyDot.hidden = false;
  } else {
    dirtyDot.className = 'ws-dirty';
    dirtyDot.hidden = true;
  }
}
// 保存成功的正向反馈：原地（面包屑里脏态那个位置）闪「✓ 已保存」绿字，~1.6s 后淡出。
// 不是弹窗：保存高频，模态太重；复用用户已经盯着的位置给即时确认，Cmd+S / 点按钮两条路都覆盖。
function flashSaved() {
  if (savedTimer) clearTimeout(savedTimer);
  dirtyDot.textContent = '✓ 已保存';
  dirtyDot.className = 'ws-dirty ws-saved';
  dirtyDot.hidden = false;
  savedTimer = setTimeout(() => {
    dirtyDot.classList.add('ws-fade'); // opacity → 0（CSS transition）
    savedTimer = setTimeout(() => { dirtyDot.hidden = true; dirtyDot.className = 'ws-dirty'; savedTimer = null; }, 320);
  }, 1600);
}
const markDirty = () => setDirty(true);

// AI 占位（斜杠 /ai 或格式气泡 ✦AI 触发）——本地编辑器暂无 AI，仅提示开发中（用父窗口弹窗，
// 因 iframe sandbox 无 allow-modals）。
function showAiSoon() { window.alert('AI 功能开发中'); }

// 仅用于显示的纯文件名：跨平台按 / 或 \ 切（Windows 路径用反斜杠）。真正加载用的 URL 一律走
// 主进程的 window.ws2.pathInfo（Node url.pathToFileURL），renderer 不自己拼 file:// URL。
function baseName(p) { return p.split(/[\\/]/).pop(); }

function injectBase(doc, dirUrl) {
  const base = doc.createElement('base');
  base.href = dirUrl;
  base.setAttribute('data-ws2-ui', '');
  doc.head.prepend(base);
}

// 文档载入后接线块编辑器（真实 file:// 与 srcdoc 两种载入方式通用）。
// ---- 文档视图缩放（触控板捏合 + Cmd±/0）----
// 几何放大整个文档视图（放大镜，不是改字号——改字号会重排）。只缩放 iframe 的 body（内容），编辑器浮层
// 在 documentElement 不受影响、保持原大小且坐标自洽（实测点击/光标/手柄在 0.75x~1.5x 各档都准）。
// 经构造样式表（adoptedStyleSheets）注入、纯 CSSOM、不进序列化 → 不写盘、不碰用户文档内容（保真安全）。
const ZOOM_MIN = 0.5, ZOOM_MAX = 3, ZOOM_STEP = 0.1;
let zoomFactor = 1;
let zoomSheet = null; // 绑定当前 contentDocument；换文档/重载后在 wireEditor 里置空重建
function applyZoom() {
  const cd = frame.contentDocument, cw = frame.contentWindow;
  if (!cd || !cw) return;
  try {
    if (!zoomSheet || !cd.adoptedStyleSheets.includes(zoomSheet)) {
      zoomSheet = new (cw.CSSStyleSheet || CSSStyleSheet)();
      cd.adoptedStyleSheets = [...cd.adoptedStyleSheets, zoomSheet];
    }
    // factor===1 写空规则：绝不能用 body{zoom:1} 盖掉用户文档自带的 body{zoom}（渲染视图也不能动用户的值，
    // 否则文档自带缩放版式被悄悄压平）。只有用户主动缩放（factor!=1）时才注入我们的 zoom。
    zoomSheet.replaceSync(zoomFactor === 1 ? '' : `body{zoom:${zoomFactor};}`);
  } catch (e) { /* 构造样式表不可用：放弃缩放，不影响编辑 */ }
}
// 缩放快捷键 Cmd/Ctrl +=/-/0：iframe 与父层 shell 都挂一份，焦点在哪都能缩放（否则点过保存按钮后按 Cmd+ 无反应）
function handleZoomKey(e) {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const k = e.key.toLowerCase();
  if (k === '=' || k === '+') { e.preventDefault(); setZoom(zoomFactor + ZOOM_STEP); return true; }
  if (k === '-') { e.preventDefault(); setZoom(zoomFactor - ZOOM_STEP); return true; }
  if (k === '0') { e.preventDefault(); setZoom(1); return true; }
  return false;
}
function setZoom(z) {
  zoomFactor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  applyZoom();
  if (blockEdit) blockEdit.reposition(); // 缩放后手柄/气泡按新内容尺寸重定位
}

// 块编辑内核（WS2BlockEdit）跑在父层、操作 iframe 的 contentDocument（iframe sandbox 不跑脚本）。
function wireEditor() {
  const doc = frame.contentDocument;
  if (undoMgr && undoMgr.timer) clearTimeout(undoMgr.timer); // 取消上个文档悬挂的 checkpoint 定时器（防 stale 闭包）
  undoMgr = new WS2Undo.UndoManager(doc);
  try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  try { doc.execCommand('styleWithCSS', false, false); } catch (e) {} // 语义标签优先（<b>/<i>），颜色走 CSSOM span（KTD2）

  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  blockEdit = WS2BlockEdit.attach(doc, {
    win: frame.contentWindow, undoMgr, markDirty, onAiSoon: showAiSoon,
  });

  // 输入：标脏 + 调度 undo checkpoint（连续打字塌成一个 op）
  doc.addEventListener('input', () => { markDirty(); if (undoMgr.scheduleCheckpoint) undoMgr.scheduleCheckpoint(); });
  // 粘贴：只取纯文本（不带外部样式/脚本）
  doc.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    doc.execCommand('insertText', false, text);
  });
  // 全局快捷键（Cmd/Ctrl）：撤销/重做/保存/加粗斜体下划线。块内 Enter/Backspace/斜杠/Esc 由 blockEdit 处理。
  doc.addEventListener('keydown', (e) => {
    if (handleZoomKey(e)) return; // 缩放键 Cmd/Ctrl +=/-/0（与父层共用一份逻辑）
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); const changed = e.shiftKey ? undoMgr.redo() : undoMgr.undo(); if (changed) { if (blockEdit) blockEdit.reset(); markDirty(); } }
    else if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'b') { e.preventDefault(); doc.execCommand('bold'); markDirty(); }
    else if (k === 'i') { e.preventDefault(); doc.execCommand('italic'); markDirty(); }
    else if (k === 'u') { e.preventDefault(); doc.execCommand('underline'); markDirty(); }
  });

  // 触控板捏合：Chromium 把捏合手势映射成带 ctrlKey 的 wheel。拦掉浏览器自带页面缩放，按 deltaY 连续无极调。
  doc.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const d = Math.max(-50, Math.min(50, e.deltaY)); // 限幅：鼠标滚轮一格 deltaY 常达 ±100+，不限会算出 0/负乘子一步砸到边界
    setZoom(zoomFactor * (1 - d * 0.01)); // 乘法步进：缩放观感更线性
  }, { passive: false });

  // 新 contentDocument → 旧缩放样式表失效，按当前 zoomFactor 重挂（外部重载保留缩放；openDoc 已先复位 100%）
  zoomSheet = null;
  applyZoom();
}

function prepFrame(asDirty) {
  home.hidden = true;
  docHeader.hidden = false;
  if (docStatus) docStatus.hidden = false; // 本地状态标
  closeViewer();
  frame.hidden = false;
  docName.textContent = docInfo.name;
  docName.title = docInfo.name; // 名字过长被截断时，悬停显示全名
  exportBtn.disabled = false; // 开了文档就能导出（不像保存要脏才亮）
  setDirty(!!asDirty);
}

// ---- 非 HTML 文件的应用内查看器（#1）：图片/PDF 直接预览，其余 → 外部打开卡片 ----
const KIND_LABEL = { word: 'Word 文档', pdf: 'PDF', image: '图片', sheet: '表格', slides: '演示文稿', other: '文件' };
const EXT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
function bigIconSvg() {
  return '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
}
function closeViewer() {
  if (!viewer) return;
  viewer.hidden = true;
  viewer.innerHTML = '';
}
function openExternalBtn(node, cls) {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = EXT_SVG + '<span>用默认程序打开</span>';
  // 工作区内走 rel（assertInsideWorkspace 守卫）；工作区外（「打开」按钮选的）没 rel，走吃 abs 的那条。
  b.onclick = () => (node.rel ? window.ws2.wsOpenExternal(node.rel) : window.ws2.openExternalAbs(node.abs));
  return b;
}
// node = { name, rel, abs, kind } —— rel 来自侧栏文件树；「打开」按钮选的工作区外文件 rel 为 null、走 abs
async function showViewer(node) {
  if (tempDoc) { stashActiveTemp(); tempDoc = null; }
  else if (dirty && !confirm('当前文档有未保存的修改，确定丢弃并打开这个文件？')) return;
  // 退出编辑器态：停 watch、拆块编辑、清 docPath（非可编辑文件没有保存目标）
  window.ws2.unwatchDoc();
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  docPath = null;
  docInfo = null;
  setDirty(false);
  frame.hidden = true;
  frame.removeAttribute('src');
  home.hidden = true;
  docHeader.hidden = true;
  if (docStatus) docStatus.hidden = true;
  exportBtn.disabled = true; // 非 html 不能导出
  if (window.__sbHooks) window.__sbHooks.onOpen(node.abs); // 侧栏高亮当前查看的文件

  const kind = node.kind || 'other';
  viewer.innerHTML = '';
  if (kind === 'image' || kind === 'pdf') {
    let url = null;
    // 工作区内走 rel，工作区外走 abs（「打开」按钮选的）；取不到就退化成外部打开卡片。
    try { url = node.rel ? await window.ws2.wsFileUrl(node.rel) : await window.ws2.fileUrlAbs(node.abs); } catch (e) { /* 退化成卡片 */ }
    if (url) {
      if (kind === 'pdf') {
        // PDF.js 渲染（连续滚动 canvas + 自己的一行工具栏）；替代 Chromium 内置 viewer（B7 合并工具栏 / B8 无预览栏）
        await window.WS2PdfViewer.mount(viewer, url, { fileName: node.name, openExternalEl: openExternalBtn(node, 'fv-open') });
        return;
      }
      const bar = document.createElement('div');
      bar.className = 'fv-bar';
      const name = document.createElement('span');
      name.className = 'fv-name';
      name.textContent = node.name;
      name.title = node.name; // 名字过长被截断时，悬停显示全名
      const tag = document.createElement('span');
      tag.className = 'fv-tag';
      tag.textContent = '图片 · 只读';
      const sp = document.createElement('div');
      sp.className = 'fv-sp';
      bar.append(name, tag, sp, openExternalBtn(node, 'fv-open'));
      viewer.appendChild(bar);
      const scroll = document.createElement('div');
      scroll.className = 'imgv-scroll';
      const img = document.createElement('img');
      img.className = 'imgv-img';
      img.src = url;
      img.alt = node.name;
      scroll.appendChild(img);
      viewer.appendChild(scroll);
      viewer.hidden = false;
      return;
    }
  }
  // Word/表格/演示/其他（或图片/PDF 取 URL 失败）→ 外部打开卡片
  const wrap = document.createElement('div');
  wrap.className = 'efp';
  const card = document.createElement('div');
  card.className = 'efp-card';
  const ico = document.createElement('div');
  ico.className = 'efp-ico';
  ico.innerHTML = bigIconSvg();
  const name = document.createElement('div');
  name.className = 'efp-name ws-truncate';
  name.textContent = node.name;
  name.title = node.name; // 名字过长被截断时，悬停显示全名
  const meta = document.createElement('div');
  meta.className = 'efp-meta ws-truncate';
  meta.textContent = (KIND_LABEL[kind] || '文件') + ' · ' + (node.rel || node.name);
  const note = document.createElement('p');
  note.className = 'efp-note';
  note.textContent = '这不是 HTML 文档，Wordspace 不能直接编辑它。可以一键用默认程序打开。';
  card.append(ico, name, meta, note, openExternalBtn(node, 'efp-open'));
  wrap.appendChild(card);
  viewer.appendChild(wrap);
  viewer.hidden = false;
}
window.__shellShowViewer = showViewer;

// 打开真实文件：iframe 直接指向 file:// URL（主进程 pathInfo 算，跨平台正确），
// 文档拥有自己的 CSP 上下文、相对资源天然解析。
function loadFromFile(opts) {
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  const gen = ++loadGen;
  frame.onload = () => { if (gen !== loadGen) return; wireEditor(); };
  frame.removeAttribute('srcdoc');
  frame.src = docInfo.fileUrl;
  prepFrame(opts && opts.asDirty);
}

// 外部磁盘改动后重新载入磁盘版本（Bug2：用 Claude 等外部工具改完，自动刷新渲染）。
// 同一 file:// URL 直接赋 frame.src 不会重导航 → 先 about:blank 再设回，强制刷新一次。
// loadGen 守卫：若重载途中又来一次载入（外部连续改动 / 同时打开别的文档），旧 onload 作废，
// 不把 wireEditor 跑在 about:blank 或错误文档上。setDirty(false) 放到真正载完磁盘版本后才清。
function reloadDoc() {
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  const gen = ++loadGen;
  frame.onload = () => {
    if (gen !== loadGen) return; // 被更晚的载入抢占
    frame.onload = () => { if (gen !== loadGen) return; wireEditor(); setDirty(false); };
    frame.src = docInfo.fileUrl;
  };
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';
}

// 载入一段 HTML 内容（历史恢复）：srcdoc + 注入 <base> 让相对资源指向原文件目录（用 docInfo.dirUrl）
function loadFromHtml(html, opts) {
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  const gen = ++loadGen;
  frame.onload = () => { if (gen !== loadGen) return; if (docInfo && docInfo.dirUrl) injectBase(frame.contentDocument, docInfo.dirUrl); wireEditor(); };
  frame.removeAttribute('src');
  frame.srcdoc = html;
  prepFrame(opts && opts.asDirty);
}

// ===== 临时文档引擎 =====
// 切走当前活跃文档前的守卫：活跃是临时文档 → 序列化存回（随便走、不丢）；活跃是脏的真文件 → 问一下
// （单编辑器切走 = 丢编辑，跟 openDoc 的脏守卫一致）。返回 false = 用户取消、别切。
function canLeaveActive() {
  if (tempDoc) { stashActiveTemp(); return true; }
  if (dirty && !confirm('当前文档有未保存的修改，确定丢弃并切换？')) return false;
  return true;
}
// 新建一个临时文档并渲染：生成 id、存进 tempStore、渲染。返回 id 给侧栏建标签（取消切换则返回 null）。
function shellNewTemp(base, html) {
  if (!canLeaveActive()) return null;
  const id = genTempId();
  tempStore.set(id, { base: base || '无标题文档', html });
  renderTemp(id);
  return id;
}
// 切回一个已存在的临时文档（点它的标签）。
function shellReopenTemp(id) {
  if (!tempStore.has(id)) return;
  if (!canLeaveActive()) return;
  renderTemp(id);
}
// 渲染某临时文档进编辑器（切走守卫由 canLeaveActive 处理过）。
function renderTemp(id) {
  const rec = tempStore.get(id);
  if (!rec) return;
  window.ws2.unwatchDoc(); // 临时文档没有磁盘监听目标
  docPath = null;
  docInfo = { name: rec.base };
  tempDoc = { id, base: rec.base };
  zoomFactor = 1;
  loadFromHtml(rec.html, { asDirty: true }); // srcdoc 渲染；临时 = 未保存 = 脏（面包屑显「● 未保存」）
  docName.textContent = rec.base;
  docName.title = rec.base;
  exportBtn.disabled = true; // 临时文档没落盘、不能导出（保存后才亮）
}
// 把当前活跃临时文档的编辑内容序列化存回 tempStore（切走 / 保存前调，防单编辑器切标签丢内容）。
function stashActiveTemp() {
  if (!tempDoc) return;
  try {
    const html = WS2Serialize.serializeDocument(frame.contentDocument);
    const rec = tempStore.get(tempDoc.id) || { base: tempDoc.base };
    tempStore.set(tempDoc.id, { base: rec.base, html });
  } catch (e) { /* 序列化失败：留上一次 stash */ }
}
// 保存对话框要用的当前活跃临时文档快照（id/base/最新 html）。侧栏 SaveModal 读它。
function shellActiveTemp() {
  if (!tempDoc) return null;
  let html;
  try { html = WS2Serialize.serializeDocument(frame.contentDocument); }
  catch (e) { html = (tempStore.get(tempDoc.id) || {}).html || ''; }
  return { id: tempDoc.id, base: tempDoc.base, html };
}
// 临时文档已落盘（SaveModal 存完）→ 就地把编辑器指向真文件（不重载，内容与刚序列化的一致）。
async function shellFinalizeTemp(id, abs, name) {
  tempStore.delete(id);
  if (!tempDoc || tempDoc.id !== id) return; // 保存的不是当前活跃项（当前流程不会发生）：只清 store
  let info;
  try { info = await window.ws2.pathInfo(abs); } catch (e) { info = { name }; }
  tempDoc = null;
  docPath = abs;
  docInfo = info;
  docName.textContent = name;
  docName.title = name;
  window.ws2.watchDoc(abs);
  exportBtn.disabled = false;
  setDirty(false);
  flashSaved();
}
// 丢弃一个临时文档（未保存关闭选「不保存」）。是活跃项则清编辑器脏态，免得回落时误弹脏守卫。
function shellDiscardTemp(id) {
  tempStore.delete(id);
  if (tempDoc && tempDoc.id === id) { tempDoc = null; setDirty(false); }
}

async function openDoc(p) {
  // 没真打开成 → 撤销 onOpenFile 设的 __pendingColdOpen，否则它会一直抑制后续 loadTabs 的「恢复激活标签」
  // （如 app 已开 + 当前文档脏，第二实例双击别的文件、用户点「取消」时会走到这）。
  // 离开活跃临时文档：序列化存回 tempStore（不弹脏守卫，切回它还在）；真文件仍走原脏守卫。
  if (tempDoc) { stashActiveTemp(); tempDoc = null; }
  else if (dirty && !confirm('当前文档有未保存的修改，确定丢弃并打开新文档？')) { window.__pendingColdOpen = null; return; }
  let info;
  try {
    // 校验文件存在 + UTF-8（拒非 UTF-8 防损坏）；再取跨平台 file:// URL / 文件名 / 目录URL
    await window.ws2.readDoc(p);
    info = await window.ws2.pathInfo(p);
  } catch (e) {
    alert('无法打开文件：' + p + '\n' + (e.message || e));
    window.__pendingColdOpen = null;
    return;
  }
  docPath = p;
  docInfo = info;
  zoomFactor = 1; // 新文档从 100% 开始（wireEditor 会按这个重挂缩放）
  loadFromFile();
  window.ws2.watchDoc(p); // 盯外部磁盘改动（Bug2）；换文档时主进程会重指向到新路径
  // 先建标签/高亮（onOpen 内会清 __pendingColdOpen）。放在 recents 之前，且 recents 设成尽力而为：
  // recents 写盘失败（userData 只读/满）不该把建标签和清标记一起拖死——否则冷启动标签丢 + 标记泄漏。
  if (window.__sbHooks) window.__sbHooks.onOpen(docPath);
  else window.__pendingColdOpen = null; // 无侧栏（单文件态）：没有 onOpen 来清，自己清，免得泄漏到将来开工作区
  try { await window.ws2.recentsAdd(p); } catch (e) { /* recents 是尽力而为，失败不影响打开 */ }
  renderRecents();
}

// 给侧栏（sidebar.js）用：当前打开文件被改名/移动后，把 app 内部状态指向新路径（不重载内容，
// 只换保存目标 + watcher + 面包屑/高亮）。被删则回到空态。
function shellRetargetDoc(newAbs, newName) {
  docPath = newAbs;
  docInfo = Object.assign({}, docInfo, { name: newName });
  docName.textContent = newName;
  docName.title = newName; // 名字过长被截断时，悬停显示全名
  window.ws2.watchDoc(newAbs);
  if (window.__sbHooks) window.__sbHooks.onOpen(docPath);
}
function shellCloseDoc() {
  window.ws2.unwatchDoc();
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  docPath = null;
  docInfo = null;
  tempDoc = null;
  setDirty(false);
  frame.hidden = true;
  frame.removeAttribute('src');
  docHeader.hidden = true;
  if (docStatus) docStatus.hidden = true;
  closeViewer();
  exportBtn.disabled = true;
  home.hidden = false;
}
window.__shellRetargetDoc = shellRetargetDoc;
window.__shellCloseDoc = shellCloseDoc;
window.__shellDocPath = () => docPath;
window.__shellIsDirty = () => dirty; // 给侧栏关标签时的脏检查
window.__shellDiscard = () => setDirty(false); // 已确认丢弃 → 清脏，切下一个时不再追问
// 临时文档桥（侧栏 sidebar.js 用）：建/切/取快照/落盘就位/丢弃。
window.__shellNewTemp = shellNewTemp;
window.__shellReopenTemp = shellReopenTemp;
window.__shellActiveTemp = shellActiveTemp;
window.__shellFinalizeTemp = shellFinalizeTemp;
window.__shellDiscardTemp = shellDiscardTemp;
window.__shellIsTemp = () => !!tempDoc; // 当前活跃的是不是临时文档
window.__shellSaveActive = () => save(); // 「保存并关闭」里保存已落盘的脏文档用（返回 promise）

// 「打开」按钮：选任意文件 → 按 kind 分流。html 进编辑器（openDoc 漏斗，含建标签）；图片/PDF/其它走
// 应用内查看器 showViewer（图片·PDF 预览、其余给「默认程序打开」卡片）。工作区内的文件 onOpen 会建标签
// （像浏览器开标签页）；工作区外的能预览但不进标签（产品决策 B）。
async function pickAndOpen() {
  const p = await window.ws2.pickFile();
  if (!p) return;
  let meta;
  try { meta = await window.ws2.classifyFile(p); }
  catch (e) { meta = { kind: 'other', name: baseName(p), rel: null }; }
  if (meta.kind === 'html') {
    openDoc(p);
  } else {
    showViewer({ abs: p, rel: meta.rel, name: meta.name || baseName(p), kind: meta.kind });
  }
}

async function save() {
  // 临时文档：没有落盘目标 → 弹「保存到哪里」（侧栏 SaveModal，它有文件树 + wsNewDoc）。
  if (tempDoc) { if (window.__sbHooks && window.__sbHooks.openSaveModal) window.__sbHooks.openSaveModal(false); return; }
  if (!docPath || !dirty) return;
  const html = WS2Serialize.serializeDocument(frame.contentDocument);
  let result;
  try {
    result = await window.ws2.saveDoc(docPath, html);
  } catch (e) {
    alert('保存失败：' + (e.message || e));
    return;
  }
  setDirty(false);
  if (result && result.archiveWarning) {
    alert('文件已保存，但历史版本归档失败（本次保存没有进入历史记录）：\n' + result.archiveWarning);
  } else {
    flashSaved(); // 归档警告已经弹了 alert 就不再闪「已保存」，免得自相矛盾
  }
}

async function renderRecents() {
  const list = await window.ws2.recents();
  const ul = document.getElementById('recent-list');
  ul.innerHTML = '';
  for (const r of list) {
    const li = document.createElement('li');
    li.textContent = baseName(r.path) + ' ' + r.path;
    li.onclick = () => openDoc(r.path);
    ul.appendChild(li);
  }
}

document.getElementById('open-btn').onclick = pickAndOpen;
const homeOpenBtn = document.getElementById('home-open');
if (homeOpenBtn) homeOpenBtn.onclick = pickAndOpen;
saveBtn.onclick = save;
window.addEventListener('resize', () => { if (blockEdit) blockEdit.reposition(); }); // 窗口尺寸变 → 手柄/气泡跟上
window.addEventListener('keydown', handleZoomKey); // 焦点在父层 shell（点过保存按钮/首页）时也能 Cmd± 缩放（iframe 内事件不冒泡到这）

// 外部磁盘改动（Bug2）：是当前文档才处理；有未保存改动先问，免得静默覆盖用户的编辑。
window.ws2.onDocChanged((p) => {
  if (!docPath || p !== docPath) return;
  if (dirty && !confirm('这个文件在外部被改动了，但你有未保存的修改。\n重新加载会丢弃你的修改、改用磁盘上的新版本，继续吗？')) return;
  reloadDoc();
});

// 主进程发来「打开这个文件」（Finder 双击 / 文件关联 / 第二实例）。冷启动时这跟侧栏「恢复上次工作区」
// 并发：同步先标记 __pendingColdOpen，让 loadTabs 知道「这个文件该占 viewer，别拿上次激活标签抢」；
// 标签实际创建在 sidebar onOpen 里等恢复跑完才做（见 sidebar.js restoreReady）。
window.ws2.onOpenFile((p) => { window.__pendingColdOpen = p; openDoc(p); });
window.ws2.onMenu((cmd) => {
  if (cmd === 'open') pickAndOpen();
  if (cmd === 'save') save();
  if (cmd === 'export-pdf') exportPdf();
  if (cmd === 'undo' && undoMgr) { if (undoMgr.undo()) { if (blockEdit) blockEdit.reset(); markDirty(); } }
  if (cmd === 'redo' && undoMgr) { if (undoMgr.redo()) { if (blockEdit) blockEdit.reset(); markDirty(); } }
  if (cmd === 'new-tab' && window.__sbHooks && window.__sbHooks.newTab) window.__sbHooks.newTab();          // Cmd+T
  if (cmd === 'close-tab' && window.__sbHooks && window.__sbHooks.closeActiveTab) window.__sbHooks.closeActiveTab(); // Cmd+W
  if (cmd === 'find-file' && window.__sbHooks && window.__sbHooks.focusFilter) window.__sbHooks.focusFilter();        // Cmd+F
});

// 导出 PDF。只有一种样式：Wordspace 所见即所得——把当前文档 + 编辑器排版烤成静态 HTML 再印，
// 跟 app 里看到的一致。有未保存改动先落盘（印的是磁盘版本）。
// （底层还有个「直印源文件」的打印原语，只在测试/内部用、不接 UI，见 main/pdf-export.js。）
let exporting = false; // single-flight：连按不并发开多个隐藏窗口/叠多个对话框
async function exportPdf() {
  if (exporting || !docPath) return;
  exporting = true; // 必须在 await save() 之前置位——否则脏文档连按时第二次调用会在 save 的 await 让出期溜过守卫
  try {
    if (dirty) { await save(); if (dirty) return; } // save 失败（仍脏）→ 不导出
    const html = buildWordspacePrintHtml(); // 可能抛错（文档未就绪），下面 catch 兜
    const res = await window.ws2.exportPdf(docPath, 'wordspace', html);
    if (res && res.error) alert('导出 PDF 失败：' + res.error);
  } catch (e) {
    alert('导出 PDF 失败：' + ((e && e.message) || e));
  } finally {
    exporting = false;
  }
}

// Mode 2「Wordspace 样式」：把当前文档 + 编辑器排版烤成一份静态打印 HTML，让导出跟 app 里看到的一致。
// 剥覆盖层(data-ws2-ui)/交互态属性，保留 data-ws2-canvas/root（EDITOR_CSS 要靠它们定位），内联 EDITOR_CSS、
// 去掉文档自带 CSP（否则内联 <style> 被 style-src 拦）。主进程那边 js:false 印、文档脚本不跑——跟编辑器一致。
// 不注入 <base>：临时打印文件写在源文件同目录，相对资源 + 文档自带 <base> 都跟编辑器 file:// 直载时一致解析
// （注入反而会顶掉文档自带的 base，把图片解析错）。仅这份临时打印文档去 CSP，用户原文件分毫不动。
function buildWordspacePrintHtml() {
  const cd = frame.contentDocument;
  // 防 Bug2 外部重载把 contentDocument 切到 about:blank/半载时克隆出空壳 → 导出空白 PDF 却报成功
  if (!cd || !cd.querySelector('[data-ws2-canvas],[data-ws2-root]')) {
    throw new Error('文档尚未就绪（可能正在重新加载），请稍后再导出');
  }
  const root = cd.documentElement.cloneNode(true);
  root.querySelectorAll('[data-ws2-ui]').forEach((n) => n.remove());
  root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  ['data-ws2-editing', 'data-ws2-selected', 'data-ws2-ce', 'data-ws2-drop', 'data-ws2-eid'].forEach((a) =>
    root.querySelectorAll('[' + a + ']').forEach((n) => n.removeAttribute(a)));
  root.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').forEach((n) => n.remove());
  const head = root.querySelector('head') || root;
  const style = cd.createElement('style'); style.textContent = WS2BlockEdit.EDITOR_CSS; head.appendChild(style);
  // 保留原 doctype：无 doctype 的 quirks 文档别被强塞标准模式（盒模型/行高会变、跟编辑器不一致）
  const dt = cd.doctype;
  const doctypeStr = dt ? '<!DOCTYPE ' + dt.name
    + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '')
    + (dt.systemId ? (dt.publicId ? '' : ' SYSTEM') + ' "' + dt.systemId + '"' : '') + '>' : '';
  return doctypeStr + '\n' + root.outerHTML;
}

// 导出按钮 → 直接导出（Wordspace 所见即所得），单一路径、无样式菜单。
exportBtn.onclick = () => { if (!exportBtn.disabled) exportPdf(); };

renderRecents();

// 品牌页脚版本号（#3）：真实 app 版本。
(async () => {
  try {
    const v = await window.ws2.appVersion();
    const el = document.getElementById('ws-ver');
    if (el && v) el.textContent = 'v' + v;
  } catch (e) { /* 取不到就留空 */ }
})();
