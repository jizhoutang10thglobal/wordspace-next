const { JSDOM } = require('jsdom');
const V = require('./src/lib/schema-validate.js');
const R = require('./src/lib/schema-registry.js');
const base = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>t</title></head><body><p>hi</p></body></html>';
for (const attr of ['', ' data-ws2-picking=""']) {
  const html = base.replace('<html lang="zh-CN"', '<html lang="zh-CN"' + attr);
  const d = new JSDOM(html).window.document;
  let r;
  try { r = R.classify(d); } catch (e) { r = { err: e.message }; }
  console.log(JSON.stringify(attr || '(baseline)'), '→', JSON.stringify(r && (r.conform !== undefined ? { conform: r.conform, id: r.id } : r)));
}
