let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let dirty = false;
let undoMgr = null;
let blockEdit = null; // 当前文档的块编辑内核（WS2BlockEdit.attach 返回）；换文档前 detach 防堆叠

const frame = document.getElementById('doc-frame');
const home = document.getElementById('home');
const docHeader = document.getElementById('doc-header');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const saveBtn = document.getElementById('save-btn');

function setDirty(v) {
  dirty = v;
  dirtyDot.hidden = !v;
  saveBtn.disabled = !v || !docPath;
  window.ws2.setDirty(v);
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
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); const changed = e.shiftKey ? undoMgr.redo() : undoMgr.undo(); if (changed) { if (blockEdit) blockEdit.reset(); markDirty(); } }
    else if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'b') { e.preventDefault(); doc.execCommand('bold'); markDirty(); }
    else if (k === 'i') { e.preventDefault(); doc.execCommand('italic'); markDirty(); }
    else if (k === 'u') { e.preventDefault(); doc.execCommand('underline'); markDirty(); }
  });
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
  frame.onload = () => wireEditor();
  frame.removeAttribute('srcdoc');
  frame.src = docInfo.fileUrl;
  prepFrame(opts && opts.asDirty);
}

// 外部磁盘改动后重新载入磁盘版本（Bug2：用 Claude 等外部工具改完，自动刷新渲染）。
// 同一 file:// URL 直接赋 frame.src 不会重导航 → 先 about:blank 再设回，强制刷新一次。
function reloadDoc() {
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  frame.onload = () => { frame.onload = () => wireEditor(); frame.src = docInfo.fileUrl; };
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';
  setDirty(false); // 重载到磁盘版本 = 干净状态
}

// 载入一段 HTML 内容（历史恢复）：srcdoc + 注入 <base> 让相对资源指向原文件目录（用 docInfo.dirUrl）
function loadFromHtml(html, opts) {
  if (blockEdit) { blockEdit.detach(); blockEdit = null; }
  frame.onload = () => { injectBase(frame.contentDocument, docInfo.dirUrl); wireEditor(); };
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
