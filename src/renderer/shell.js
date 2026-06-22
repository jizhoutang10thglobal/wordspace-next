let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let dirty = false;
let undoMgr = null;
let blockEdit = null; // 当前文档的块编辑内核（WS2BlockEdit.attach 返回）；换文档前 detach 防堆叠
let loadGen = 0;       // 每次载入/重载自增；旧的 frame.onload 闭包据此作废，防并发载入（如外部连改 + 重载）交叉 wireEditor

const frame = document.getElementById('doc-frame');
const home = document.getElementById('home');
const docHeader = document.getElementById('doc-header');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const saveBtn = document.getElementById('save-btn');

let savedTimer = null; // 「✓ 已保存」淡出定时器（保存成功后闪一下再消失）
function setDirty(v) {
  dirty = v;
  saveBtn.disabled = !v || !docPath;
  window.ws2.setDirty(v);
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
  frame.hidden = false;
  docName.textContent = docInfo.name;
  setDirty(!!asDirty);
}

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
  frame.onload = () => { if (gen !== loadGen) return; injectBase(frame.contentDocument, docInfo.dirUrl); wireEditor(); };
  frame.removeAttribute('src');
  frame.srcdoc = html;
  prepFrame(opts && opts.asDirty);
}

async function openDoc(p) {
  if (dirty && !confirm('当前文档有未保存的修改，确定丢弃并打开新文档？')) return;
  let info;
  try {
    // 校验文件存在 + UTF-8（拒非 UTF-8 防损坏）；再取跨平台 file:// URL / 文件名 / 目录URL
    await window.ws2.readDoc(p);
    info = await window.ws2.pathInfo(p);
  } catch (e) {
    alert('无法打开文件：' + p + '\n' + (e.message || e));
    return;
  }
  docPath = p;
  docInfo = info;
  zoomFactor = 1; // 新文档从 100% 开始（wireEditor 会按这个重挂缩放）
  loadFromFile();
  window.ws2.watchDoc(p); // 盯外部磁盘改动（Bug2）；换文档时主进程会重指向到新路径
  await window.ws2.recentsAdd(p);
  renderRecents();
}

async function pickAndOpen() {
  const p = await window.ws2.pickFile();
  if (p) openDoc(p);
}

async function save() {
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

window.ws2.onOpenFile((p) => openDoc(p));
window.ws2.onMenu((cmd) => {
  if (cmd === 'open') pickAndOpen();
  if (cmd === 'save') save();
  if (cmd === 'undo' && undoMgr) { if (undoMgr.undo()) { if (blockEdit) blockEdit.reset(); markDirty(); } }
  if (cmd === 'redo' && undoMgr) { if (undoMgr.redo()) { if (blockEdit) blockEdit.reset(); markDirty(); } }
});

renderRecents();
