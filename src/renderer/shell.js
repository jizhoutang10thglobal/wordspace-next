let docPath = null;
let docInfo = null; // 当前文档的跨平台派生值 { fileUrl, dirUrl, name }，主进程算（见 window.ws2.pathInfo）
let dirty = false;
let undoMgr = null;
let canvas = null; // 当前文档的画布控制器（HVE_Core），取代旧块流 applyEditable
let savedRange = null; // iframe 内最近一次有效选区——常驻工具栏跨帧执行命令前要恢复它

const frame = document.getElementById('doc-frame');
const home = document.getElementById('home');
const docName = document.getElementById('doc-name');
const dirtyDot = document.getElementById('dirty-dot');
const saveBtn = document.getElementById('save-btn');
const historyBtn = document.getElementById('history-btn');
const modeBtn = document.getElementById('mode-btn');
const toolbarEl = document.getElementById('toolbar');

function setDirty(v) {
  dirty = v;
  dirtyDot.hidden = !v;
  saveBtn.disabled = !v || !docPath;
  window.ws2.setDirty(v);
}
const markDirty = () => setDirty(true);

// 常驻工具栏只建一次（父层 app chrome）；每次开文档由 wireEditor 用 setContext 换上下文。
const toolbar = WS2Toolbar.create(toolbarEl, { markDirty });

// 记录 iframe 内最近一次落在正文里的选区。工具栏按钮在父层、点击会让 iframe 失焦，
// 跨帧执行命令前要把这个选区恢复回去。
function saveRange() {
  const doc = frame.contentDocument;
  const sel = doc && doc.getSelection && doc.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (doc.body && doc.body.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
  }
}

// 仅用于显示的纯文件名：跨平台按 / 或 \ 切（Windows 路径用反斜杠）。真正加载用的 URL 一律走
// 主进程的 window.ws2.pathInfo（Node url.pathToFileURL），renderer 不自己拼 file:// URL。
function baseName(p) { return p.split(/[\\/]/).pop(); }

function injectBase(doc, dirUrl) {
  const base = doc.createElement('base');
  base.href = dirUrl;
  base.setAttribute('data-ws2-ui', '');
  doc.head.prepend(base);
}

// 文档载入后接线编辑器（真实 file:// 与 srcdoc 两种载入方式通用）
function wireEditor() {
  const doc = frame.contentDocument;
  undoMgr = new WS2Undo.UndoManager(doc);
  // 画布控制器取代旧 blocks.applyEditable：进入编辑模式（不再把 body 设成 contenteditable）
  canvas = WS2Canvas.create(doc, { undoMgr, markDirty });
  canvas.enable();
  // 选择内核：悬停虚线 / 点击实线 / Esc 选父 / 点空白取消（in-doc CSSOM 覆盖框）
  const selection = WS2Selection.attach(doc, canvas, { refresh: () => toolbar.refresh() });
  // 内联改字：双击文字元素 → contenteditable + 聚焦；Esc / 外点退出还原。Esc 走 capture +
  // stopPropagation（编辑态下先于 selection 的 Esc-选父，见 KTD7）。
  // openLinkDialog 暂不传 → 双击 <a> 直接编辑锚文本（fall through）；完整链接弹窗路由是后续，
  // 工具栏现在没暴露 open-link 方法（openLink 只能从工具栏按钮触发），等暴露后再接。
  const textEdit = WS2TextEdit.attach(doc, { markDirty, onEnter: () => {}, onExit: () => {} });
  modeBtn.textContent = '预览';
  try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  try { doc.execCommand('styleWithCSS', false, true); } catch (e) {}
  savedRange = null;
  // 常驻工具栏换上下文到当前文档：跨帧执行命令 + 取最近选区恢复 + 被选元素（块操作 retarget）
  toolbar.setContext({ doc, win: frame.contentWindow, getRange: () => savedRange, undoMgr, canvas,
    getSelectedEl: () => selection.current(), isTextEditing: () => textEdit.isEditing() });
  doc.addEventListener('selectionchange', () => { saveRange(); toolbar.refresh(); });
  doc.addEventListener('mousedown', () => toolbar.closePops());
  if (window.WS2Slash) WS2Slash.attach(doc, undoMgr, markDirty);
  // 智能对齐线 + 吸附（HVE_AlignGuide）：拖动中算被拖框与其它顶层元素的边/中心对齐，画品红线 +
  // 距离标注、阈值内吸附。覆盖节点走 in-doc CSSOM（KTD2）。
  const alignGuide = window.WS2AlignGuide ? WS2AlignGuide.attach(doc) : null;
  // 自由拖动（HVE_DragMove）：抓被选元素拖到任意位置，首拖转 absolute，整次拖动一个 undo op。
  // 文字编辑态由 isEditing 门住（mousedown 放光标，不启动拖动）。
  if (window.WS2Drag) WS2Drag.attach(doc, {
    getSelectedEl: () => selection.current(),
    isEditing: () => textEdit.isEditing(),
    undoMgr, markDirty, win: frame.contentWindow, guide: alignGuide,
  });
  doc.addEventListener('input', () => {
    markDirty();
    undoMgr.scheduleCheckpoint();
    // 画布模型不需要重标块；选中态是真实元素 ref、由 input 改不动结构，无需刷新
  });
  doc.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    doc.execCommand('insertText', false, text);
  });
  // 方向键 nudge 的合并窗口状态：一连串快速 nudge 塌成一个 undo op，500ms 静默 / 切元素 / 非 nudge 键收尾。
  let nudgeTimer = null;
  let nudgeEl = null;
  let nudgeBefore = null; // 这段合并窗口首帧的 pre-nudge cssText（合并 op 的 before）
  function commitNudge() {
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
    if (nudgeEl) { undoMgr.commit(); nudgeEl = null; nudgeBefore = null; }
  }

  doc.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // 方向键 nudge（KTD7 单一 keydown 表）：非 mod + 有元素选中 + 非文字编辑 + 是方向键 → 微调。
    // 文字编辑态不拦（isEditing 门）：让光标移动，这是承重回归（R2）。
    if (!mod && !textEdit.isEditing()) {
      const d = WS2Drag.nudgeDelta(e.key, e.shiftKey);
      const el = d ? selection.current() : null;
      if (d && el) {
        e.preventDefault();
        if (el !== nudgeEl) {
          commitNudge(); // 切元素先收尾上一段
          nudgeBefore = el.style.cssText; // 转绝对前的快照（合并 op 的 before）
          // 整段 nudge 用稳定 key（不带方向），混向连按也塌成一个 op
          undoMgr.beginCoalesce('nudge');
          WS2Drag.ensureAbsolute(el, frame.contentWindow, doc);
          nudgeEl = el;
        }
        const base = { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 };
        const next = WS2Drag.applyDelta(base, d.dx, d.dy);
        el.style.left = next.left + 'px'; // CSSOM（KTD2）
        el.style.top = next.top + 'px';
        undoMgr.recordStyleOp(el, nudgeBefore, el.style.cssText, 'nudge');
        markDirty();
        if (nudgeTimer) clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(commitNudge, 500); // 静默 500ms 收一个 op
        return;
      }
    }
    if (nudgeEl) commitNudge(); // 任何非 nudge 键 / 切走选中 → 先收尾合并窗口
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
  toolbarEl.hidden = false;
  docName.textContent = docInfo.name;
  historyBtn.disabled = false;
  modeBtn.disabled = false;
  setDirty(!!asDirty);
}

// 编辑/预览切换：预览态停用画布交互（disable），编辑态恢复（enable）。
function toggleMode() {
  if (!canvas) return;
  if (canvas.getState().enabled) {
    canvas.disable();
    modeBtn.textContent = '编辑';
  } else {
    canvas.enable();
    modeBtn.textContent = '预览';
  }
}

// 打开真实文件：iframe 直接指向 file:// URL（主进程 pathInfo 算，跨平台正确），
// 文档拥有自己的 CSP 上下文、相对资源天然解析
function loadFromFile(opts) {
  // 设 src 是同步、onload 异步：先失活工具栏 + 清旧选区，免得加载窗口期工具栏还指向上一个文档
  savedRange = null;
  toolbar.setContext({});
  frame.onload = () => wireEditor();
  frame.removeAttribute('srcdoc');
  frame.src = docInfo.fileUrl;
  prepFrame(opts && opts.asDirty);
}

// 载入一段 HTML 内容（历史恢复）：srcdoc + 注入 <base> 让相对资源指向原文件目录（用 docInfo.dirUrl）
function loadFromHtml(html, opts) {
  savedRange = null;
  toolbar.setContext({});
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
modeBtn.onclick = toggleMode;
document.getElementById('history-close').onclick = () => { document.getElementById('history-modal').hidden = true; };

window.ws2.onOpenFile((p) => openDoc(p));
window.ws2.onMenu((cmd) => {
  if (cmd === 'open') pickAndOpen();
  if (cmd === 'save') save();
  if (cmd === 'undo' && undoMgr) { if (undoMgr.undo()) markDirty(); }
  if (cmd === 'redo' && undoMgr) { if (undoMgr.redo()) markDirty(); }
});

renderRecents();
