// i18n 调用点 key 存在性门（真 app 版，第三道门，补 scan/parity 够不着的失效模式）。
// scan 只查硬编码中文、parity 只比 zh/en 字典两侧，都不查「调用点的 key 是否真存在」——key 打错
// （t('menu.fil') 而非 menu.file）能过前两门，然后运行时显示裸 key 名给用户。这道门守这个。
//
// acorn 找所有 t / wsT / _t / window.wsT 调用，第一个实参是字符串字面量、长得像 ns.key 的，
// 检查它在合并 zh 字典里存在。不存在 = 阻断。动态 key（非字面量）列出供人工核，不阻断。
// index.html 的 data-i18n* 属性值也一并检查。
import * as acorn from 'acorn';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const I18N = join(SRC, 'i18n');

// 合并 zh 已知 key 集（命名空间前缀）。
const known = new Set();
for (const f of readdirSync(join(I18N, 'zh')).filter((n) => n.endsWith('.js'))) {
  const ns = f.replace(/\.js$/, '');
  for (const k of Object.keys(require(join(I18N, 'zh', f)))) known.add(ns + '.' + k);
}

const CALLEES = new Set(['t', 'wsT', '_t', 'tImperative', 'coreT']);
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9_]+$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (relative(SRC, p).split('\\').join('/') === 'i18n') continue; // 字典本体不算调用点
      walk(p, out);
    } else if (/\.js$/.test(name)) out.push(p);
  }
  return out;
}

const missing = [];
const dynamic = [];

// callee 名：t / wsT / _t，或成员访问 window.wsT / i18n.t / X.t。
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property && callee.property.type === 'Identifier') return callee.property.name;
  return null;
}

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  let ast;
  try { ast = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true, locations: true }); }
  catch { try { ast = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'module', locations: true }); } catch { continue; } }

  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && CALLEES.has(calleeName(node.callee)) && node.arguments.length) {
      const a0 = node.arguments[0];
      if (a0.type === 'Literal' && typeof a0.value === 'string') {
        if (KEY_SHAPE.test(a0.value) && !known.has(a0.value)) missing.push(`${rel}:${a0.loc.start.line}  ${a0.value}`);
      } else if (a0.type !== 'Literal') {
        dynamic.push(`${rel}:${a0.loc.start.line}`);
      }
    }
    for (const k in node) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(ast);
}

// index.html 的 data-i18n / -title / -ph / -aria 属性值
const dom = new JSDOM(readFileSync(join(SRC, 'renderer', 'index.html'), 'utf8'));
for (const el of dom.window.document.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-ph],[data-i18n-aria]')) {
  for (const attr of ['data-i18n', 'data-i18n-title', 'data-i18n-ph', 'data-i18n-aria']) {
    const key = el.getAttribute(attr);
    if (key && KEY_SHAPE.test(key) && !known.has(key)) missing.push(`index.html(@${attr})  ${key}`);
  }
}

if (missing.length) {
  console.error(`✗ i18n-usage: ${missing.length} 处调用了字典里不存在的 key（会把裸 key 名显示给用户，阻断）：`);
  for (const m of missing) console.error('  ' + m);
  process.exit(1);
}
console.log(`✓ i18n-usage: 所有静态 t()/wsT() 调用 + data-i18n 属性的 key 都存在于字典${dynamic.length ? `（另有 ${dynamic.length} 处动态 key，静态查不了）` : ''}`);
