const { JSDOM } = require('jsdom');
const be = require('../src/editor/blockedit.js');
const S = require('../src/editor/serialize.js');

function mk(bodyHtml) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHtml + '</body></html>',
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window, doc = win.document;
  if (!doc.execCommand) doc.execCommand = () => false;
  const SP = win.Selection && win.Selection.prototype;
  if (SP && !SP.modify) SP.modify = function () {};
  const rect = () => ({ top:0,left:0,right:0,bottom:0,width:0,height:0,x:0,y:0 });
  win.Element.prototype.getBoundingClientRect = rect;
  win.Range.prototype.getBoundingClientRect = rect;
  win.Range.prototype.getClientRects = () => [];
  const dirty = { n: 0 };
  const ck = { n: 0, states: [] };
  const undoMgr = { checkpoint: () => { ck.n++; ck.states.push(S.cleanedBodyHtml(doc.body)); }, scheduleCheckpoint: () => {} };
  const api = be.attach(doc, { win, undoMgr, markDirty: () => { dirty.n++; }, host: doc.body });
  return { dom, win, doc, dirty, ck, api };
}
function enter(doc, target) {
  const V = doc.defaultView;
  target.dispatchEvent(new V.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  target.dispatchEvent(new V.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
}
function caretStart(doc, node) {
  const r = doc.createRange();
  const w = doc.createTreeWalker(node, 4);
  const first = w.nextNode();
  if (first) r.setStart(first, 0); else r.setStart(node, 0);
  r.collapse(true);
  const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
}
function caretEnd(doc, node) {
  const r = doc.createRange(); r.selectNodeContents(node); r.collapse(false);
  const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
}
function key(doc, k, opts) {
  const ev = new doc.defaultView.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
  doc.dispatchEvent(ev);
  return ev;
}
function where(doc) {
  const s = doc.getSelection();
  if (!s || !s.rangeCount) return 'NO-SELECTION';
  const r = s.getRangeAt(0);
  let n = r.startContainer;
  const name = n.nodeType === 3 ? ('#text"' + n.data + '"') : n.nodeName;
  let path = [];
  for (let e = (n.nodeType===3?n.parentElement:n); e && e.nodeName !== 'BODY'; e = e.parentElement) path.unshift(e.nodeName);
  return path.join('>') + ' @ ' + name + ':' + r.startOffset;
}
const clean = (doc) => S.cleanedBodyHtml(doc.body);
module.exports = { mk, enter, caretStart, caretEnd, key, clean, where };
