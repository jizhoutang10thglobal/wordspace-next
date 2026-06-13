let docPath = null;
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

function dirOf(p) { return p.slice(0, p.lastIndexOf('/') + 1); }

function injectBase(doc, p) {
  const base = doc.createElement('base');
  base.href = 'file://' + dirOf(p);
  base.setAttribute('data-ws2-ui', '');
  doc.head.prepend(base);
}

function injectUiStyle(doc) {
  const style = doc.createElement('style');
  style.setAttribute('data-ws2-ui', '');
  style.textContent = '[data-ws2-block="locked"]:hover { outline: 1px dashed #ccc; }';
  doc.documentElement.appendChild(style);
}

function loadIntoFrame(html, p, opts) {
  const asDirty = opts && opts.asDirty;
  home.hidden = true;
  frame.hidden = false;
  frame.onload = () => {
    const doc = frame.contentDocument;
    injectBase(doc, p);
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
  };
  frame.srcdoc = html;
  docName.textContent = p.split('/').pop();
  historyBtn.disabled = false;
  setDirty(!!asDirty);
}

async function openDoc(p) {
  if (dirty && !confirm('当前文档有未保存的修改，确定丢弃并打开新文档？')) return;
  let html;
  try {
    html = await window.ws2.readDoc(p);
  } catch (e) {
    alert('无法打开文件：' + p + '\n' + (e.message || e));
    return;
  }
  docPath = p;
  loadIntoFrame(html, p);
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
    li.textContent = r.path.split('/').pop() + ' ' + r.path;
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
      loadIntoFrame(content, docPath, { asDirty: true });
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
