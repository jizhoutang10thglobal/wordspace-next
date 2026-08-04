const { JSDOM } = require('jsdom');
const S = require('./src/editor/serialize.js');
const dom = new JSDOM('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p>hi</p></body></html>');
const doc = dom.window.document;
doc.documentElement.setAttribute('data-ws2-picking', '');   // openSlash(el,false) 干的事
doc.body.firstChild.setAttribute('data-ws2-dropindent', '2'); // E4 的标记（对照组）
const out = S.serializeDocument(doc);
console.log(out.split('\n')[1].slice(0, 120));
console.log('picking 漏进磁盘?', /data-ws2-picking/.test(out));
console.log('dropindent 漏进磁盘?', /data-ws2-dropindent/.test(out));
