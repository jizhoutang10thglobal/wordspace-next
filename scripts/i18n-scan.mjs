// CJK 硬编码扫描门（真 app 版，i18n 防漂移的核心）。
// 用 **acorn AST**（不是裸 grep）只报「字符串/模板字面量」里的中日韩字符 → 代码注释天然不进 AST，
// 仓库大量中文注释不受影响（这正是必须用 AST 的原因）。index.html 用 jsdom：text/属性里的 CJK 若没有
// 对应 data-i18n* 标注就报（标注了的允许留中文当 fallback）。
//
// 报红 = 门失败。豁免：① 文件级白名单（src/i18n/ 字典本体）；② 行内 `// i18n-exempt`（该行的字符串跳过）；
// ③ 区域 `// i18n-exempt-start` … `// i18n-exempt-end`（成块的豁免，如 doc-templates 的模板正文 HTML）。
// 变异自检：往任一源文件塞一句硬编码中文 → 必报红；往白名单文件/exempt 区塞 → 不报。
import * as acorn from 'acorn';
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CJK = /[㐀-鿿　-〿＀-￯]/; // 汉字 + 中日韩标点 + 全角标点

// 文件级白名单（相对 src/）。改这里要在 PR 说明为什么豁免。
const FILE_WHITELIST = ['i18n/'];
function isWhitelisted(rel) {
  return FILE_WHITELIST.some((w) => (w.endsWith('/') ? rel.startsWith(w) : rel === w));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.js$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];

// ---- .js：acorn AST ----
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  if (isWhitelisted(rel)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // 收集 exempt 标记：行内（该行末）+ 区域（start..end 之间的行，含标记行本身）。
  const exemptLine = new Set();
  const exemptRegion = new Set();
  let inRegion = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('i18n-exempt-start')) inRegion = true;
    if (inRegion) exemptRegion.add(i + 1); // 1-based
    if (lines[i].includes('i18n-exempt-end')) inRegion = false;
    if (/\/\/.*i18n-exempt(?!-)/.test(lines[i])) exemptLine.add(i + 1);
  }

  let ast;
  try {
    ast = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true, locations: true });
  } catch (e1) {
    try {
      ast = acorn.parse(text, { ecmaVersion: 2022, sourceType: 'module', locations: true });
    } catch (e2) {
      violations.push(`${rel}: 解析失败(${e2.message}) —— 扫描门无法覆盖此文件，请修语法或调整 sourceType`);
      continue;
    }
  }

  const hits = [];
  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && CJK.test(node.value)) {
      hits.push({ line: node.loc.start.line, sample: node.value });
    } else if (node.type === 'TemplateLiteral') {
      for (const q of node.quasis) {
        const raw = q.value && q.value.cooked != null ? q.value.cooked : q.value.raw;
        if (raw && CJK.test(raw)) hits.push({ line: q.loc.start.line, sample: raw });
      }
    }
    for (const k in node) {
      const v = node[k];
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(ast);

  for (const h of hits) {
    if (exemptLine.has(h.line) || exemptRegion.has(h.line)) continue;
    violations.push(`${rel}:${h.line}  ${String(h.sample).replace(/\s+/g, ' ').slice(0, 50)}`);
  }
}

// ---- index.html：jsdom（text/属性里的 CJK 需有对应 data-i18n* 标注，否则报） ----
const htmlFile = join(SRC, 'renderer', 'index.html');
const html = readFileSync(htmlFile, 'utf8');
const dom = new JSDOM(html);
const doc = dom.window.document;
const ATTR_MAP = { title: 'data-i18n-title', placeholder: 'data-i18n-ph', 'aria-label': 'data-i18n-aria' };
// 文本节点：CJK 且父元素无 data-i18n → 报
const tw = doc.createTreeWalker(doc.body || doc.documentElement, dom.window.NodeFilter.SHOW_TEXT);
let n;
while ((n = tw.nextNode())) {
  const t = n.textContent || '';
  if (!CJK.test(t)) continue;
  const parent = n.parentElement;
  if (parent && parent.hasAttribute('data-i18n')) continue; // 已标注,允许留中文 fallback
  violations.push(`index.html(text)  ${t.replace(/\s+/g, ' ').trim().slice(0, 40)}  —— 需给父元素加 data-i18n`);
}
// 属性：title/placeholder/aria-label 里的 CJK 需有对应 data-i18n-* 标注
for (const el of doc.querySelectorAll('*')) {
  for (const [attr, marker] of Object.entries(ATTR_MAP)) {
    const v = el.getAttribute(attr);
    if (v && CJK.test(v) && !el.hasAttribute(marker)) {
      violations.push(`index.html(@${attr})  ${v.slice(0, 40)}  —— 需加 ${marker}`);
    }
  }
}

if (violations.length) {
  console.error(`✗ i18n-scan: ${violations.length} 处硬编码 CJK 未提取（报红 = 门失败）：`);
  for (const v of violations) console.error('  ' + v);
  console.error('\n提取到 src/i18n/<ns>/*.js + 用 window.wsT()/t() 替换；确不该翻的加 // i18n-exempt 或 data-i18n* 标注。');
  process.exit(1);
}
console.log('✓ i18n-scan: 0 处硬编码 CJK（src/*.js + index.html 的用户可见文案已全部提取/标注）');
