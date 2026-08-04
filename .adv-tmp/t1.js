const { JSDOM } = require('jsdom');
const S = require('/Users/ctlandu/Documents/GitHub/wordspace-next-ux-align/src/editor/serialize.js');

const dom = new JSDOM('<!DOCTYPE html><html><head><title>t</title></head><body><p data-ws2-editing=""></p></body></html>');
const doc = dom.window.document;
// simulate: gutter "+" opened the block-type picker
doc.documentElement.setAttribute('data-ws2-picking', '');
// simulate: drop markers set (for comparison — these ARE in WS2_MARKERS)
doc.body.firstChild.setAttribute('data-ws2-drop', 'top');
doc.body.firstChild.setAttribute('data-ws2-dropindent', '2');

const out = S.serializeDocument(doc);
console.log(out);
console.log('--- picking leaked to disk?', /data-ws2-picking/.test(out));
console.log('--- drop stripped?', !/data-ws2-drop/.test(out));
