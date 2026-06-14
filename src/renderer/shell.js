let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let dirty = false;
let undoMgr = null;

const frame = document.getElementById('doc-frame');
const home = document.getElementById('home');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const saveBtn = document.getElementById('save-btn');
const historyBtn = document.getElementById('history-btn');

function setDirty(v) {
  dirty = v;
  dirtyDot.hidden = !v;
  saveBtn.disabled = !v || !docPath;
  window.ws2.setDirty(v);
}
const markDirty = () => setDirty(true);

// 仅用于显示的纯文件名：跨平台按 / 或 \ 切（Windows 路径用反斜杠）。真正加载用的 URL 一律走
// 主进程的 window.ws2.pathInfo（Node url.pathToFileURL），renderer 不自己拼 file:// URL。
function baseName(p) { return p.split(/[\\/]/).pop(); }

function injectBase(doc, dirUrl) {
  const base = doc.createElement('base');
  base.href = dirUrl;
  base.setAttribute('data-ws2-ui', '');
  doc.head.prepend(base);
}

function injectUiStyle(doc) {
  const style = doc.createElement('style');
  style.setAttribute('data-ws2-ui', '');
  style.textContent = '[data-ws2-block="locked"]:hover { outline: 1px dashed #ccc; }';
  doc.documentElement.appendChild(style);
}

// 文档载入后接线编辑器（真实 file:// 与 srcdoc 两种载入方式通用）
function wireEditor() {
  const doc = frame.contentDocument;
  injectUiStyle(doc);
  WS2Blocks.applyEditable(doc);
  try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  try { doc.execCommand('styleWithCSS', false, true); } catch (e) {}
  undoMgr = new WS2Undo.UndoManager(doc);
  if (window.WS2Toolbar) WS2Toolbar.attach(doc, undoMgr, markDirty);
  if (window.WS2Slash) WS2Slash.attach(doc, undoMgr, markDirty);
  if (window.WS2Drag) WS2Drag.attach(doc, undoMgr, markDirty);
  doc.addEventListener('input', () => {
    markDirty();
    undoMgr.scheduleCheckpoint();
    // 编辑中新产生的块（如斜杠菜单插入的分隔线）即时标注，保证有手柄可拖可删
    WS2Blocks.markBlocks(doc.body);
  });
  doc.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    doc.execCommand('insertText', false, text);
  });
  doc.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); const changed = e.shiftKey ? undoMgr.redo() : undoMgr.undo(); if (changed) markDirty(); }
    if (k === 's') { e.preventDefault(); save(); }
    if (k === 'b') { e.preventDefault(); doc.execCommand('bold'); undoMgr.checkpoint(); markDirty(); }
    if (k === 'i') { e.preventDefault(); doc.execCommand('italic'); undoMgr.checkpoint(); markDirty(); }
    if (k === 'u') { e.preventDefault(); doc.execCommand('underline'); undoMgr.checkpoint(); markDirty(); }
  }, true);
}

function prepFrame(asDirty) {
  home.hidden = true;
  frame.hidden = false;
  docName.textContent = docInfo.name;
  historyBtn.disabled = false;
  setDirty(!!asDirty);
}

// 打开真实文件：iframe 直接指向 file:// URL（主进程 pathInfo 算，跨平台正确），
// 文档拥有自己的 CSP 上下文、相对资源天然解析
function loadFromFile(opts) {
  frame.onload = () => wireEditor();
  frame.removeAttribute('srcdoc');
  frame.src = docInfo.fileUrl;
  prepFrame(opts && opts.asDirty);
}

// 载入一段 HTML 内容（历史恢复）：srcdoc + 注入 <base> 让相对资源指向原文件目录（用 docInfo.dirUrl）
function loadFromHtml(html, opts) {
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

function formatTs(ts) {
  // 2026-06-12T08-30-22-123Z -> 2026-06-12 08:30:22
  return ts.replace('T', ' ').slice(0, 19).replace(/ (\d\d)-(\d\d)-(\d\d)/, ' $1:$2:$3');
}

async function showHistory() {
  const modal = document.getElementById('history-modal');
  const ul = document.getElementById('history-list');
  ul.innerHTML = '';
  const versions = await window.ws2.historyList(docPath);
  if (versions.length === 0) {
    const li = document.createElement('li');
    li.textContent = '还没有历史版本（保存一次后产生）';
    ul.appendChild(li);
  }
  for (const v of versions) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = formatTs(v.ts);
    const btn = document.createElement('button');
    btn.textContent = '恢复';
    btn.onclick = async () => {
      const content = await window.ws2.historyRead(docPath, v.id);
      loadFromHtml(content, { asDirty: true });
      modal.hidden = true;
    };
    li.append(label, btn);
    ul.appendChild(li);
  }
  modal.hidden = false;
}

document.getElementById('open-btn').onclick = pickAndOpen;
saveBtn.onclick = save;
historyBtn.onclick = showHistory;
document.getElementById('history-close').onclick = () => { document.getElementById('history-modal').hidden = true; };

window.ws2.onOpenFile((p) => openDoc(p));
window.ws2.onMenu((cmd) => {
  if (cmd === 'open') pickAndOpen();
  if (cmd === 'save') save();
  if (cmd === 'undo' && undoMgr) { if (undoMgr.undo()) markDirty(); }
  if (cmd === 'redo' && undoMgr) { if (undoMgr.redo()) markDirty(); }
});

renderRecents();
