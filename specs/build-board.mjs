#!/usr/bin/env node
// 读 specs/*.md 的 frontmatter，生成 Feature Board（4 列：想法/待开发/开发中/已完成）。
// 零依赖（只用 node 内置）。真相源 = specs/*.md；本脚本只渲染，不改 spec。
// 本地预览：node specs/build-board.mjs，然后开 out/index.html。
// CI：.github/workflows/board.yml 跑它 → 发 GitHub Pages。
// 放在 specs/ 内（而非 scripts/）是有意的：scripts/、package.json 改动会触发 release.yml 签名发版，
// specs/** 在 paths-ignore 里，改看板不会白发一版 app。
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECS_DIR = dirname(fileURLToPath(import.meta.url)); // 本脚本就在 specs/ 里
const ROOT = join(SPECS_DIR, '..');
const OUT_DIR = join(ROOT, 'out'); // 已在 .gitignore（不新增 ignore 项，避免触发 release）
const REPO = 'jizhoutang10thglobal/wordspace-next';

// 状态 → 列（顺序即列序）。spec frontmatter 的 status 取这四个 key 之一。
const COLUMNS = [
  { key: 'idea', label: '想法', hint: '只有想法 / 标题' },
  { key: 'todo', label: '待开发', hint: 'spec 写好，可 pickup' },
  { key: 'doing', label: '开发中', hint: '有人在做' },
  { key: 'done', label: '已完成', hint: '开发完、上线' },
];
const STATUS_KEYS = new Set(COLUMNS.map((c) => c.key));

// 极简 frontmatter 解析：flat `key: value`，value 去引号；body = 第二个 --- 之后全部。
// 约定：frontmatter 里别写行内 # 注释（value = 冒号后整行）。
function parse(md, file) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) return { fm: {}, body: md.trim(), file };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[k] = v;
  }
  return { fm, body: m[2].trim(), file };
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// body 第一段非标题文字作卡片简介
function brief(body) {
  const p = body.split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#')) || '';
  return p.replace(/\s+/g, ' ');
}

function ownerBadge(o) {
  const owner = (o || '').trim();
  if (!owner) return '<span class="owner none">未认领</span>';
  return `<span class="owner o-${esc(owner)}">${esc(owner)}</span>`;
}

function card(s) {
  const id = esc(s.fm.id || s.file.replace(/\.md$/, ''));
  const title = esc(s.fm.title || id);
  const specUrl = `https://github.com/${REPO}/blob/main/specs/${encodeURIComponent(s.file)}`;
  const demo = s.fm.demo ? `<div class="demo">🎬 ${esc(s.fm.demo)}</div>` : '';
  let shot = '';
  if (s.fm.screenshot) {
    const rel = s.fm.screenshot.replace(/^\/+/, '');
    const src = join(ROOT, rel);
    if (existsSync(src)) {
      const outName = 'assets/' + basename(rel);
      copyFileSync(src, join(OUT_DIR, outName));
      shot = `<a class="shotlink" href="${outName}" target="_blank" rel="noopener"><img class="shot" src="${outName}" alt="${title}" loading="lazy"></a>`;
    } else {
      shot = `<div class="shot missing">截图待补：${esc(rel)}</div>`;
    }
  }
  return `<a class="card" href="${specUrl}" target="_blank" rel="noopener">
      <div class="cardhead"><span class="cid">${id}</span>${ownerBadge(s.fm.owner)}</div>
      <div class="ctitle">${title}</div>
      ${demo}${shot}
      <div class="brief">${esc(brief(s.body))}</div>
    </a>`;
}

// 读所有 spec（排除 README，本脚本是 .mjs 自然不会被当 spec），按 id 排序
const specs = readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .map((f) => parse(readFileSync(join(SPECS_DIR, f), 'utf8'), f))
  .sort((a, b) => String(a.fm.id || a.file).localeCompare(String(b.fm.id || b.file)));

const warnings = specs
  .filter((s) => !STATUS_KEYS.has(s.fm.status))
  .map((s) => `${s.file}: status="${s.fm.status || '(空)'}" 不在 ${[...STATUS_KEYS].join('/')}，已归到「想法」`);

// 先建好输出目录（card() 复制截图要往里写）
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, 'assets'), { recursive: true });

const cols = COLUMNS.map((col) => {
  const items = specs.filter((s) => (STATUS_KEYS.has(s.fm.status) ? s.fm.status : 'idea') === col.key);
  return `<section class="col col-${col.key}">
      <h2>${col.label}<span class="count">${items.length}</span></h2>
      <p class="colhint">${col.hint}</p>
      <div class="cards">${items.map(card).join('\n') || '<div class="empty">—</div>'}</div>
    </section>`;
}).join('\n');

const CSS = `
  :root { --bg:#fafafa; --card:#fff; --line:#e6e6e6; --ink:#1a1a1a; --mut:#888; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,"PingFang SC",Segoe UI,sans-serif; color:var(--ink); background:var(--bg); }
  header { padding:28px 32px 12px; }
  h1 { margin:0; font-size:22px; font-weight:600; }
  .sub { margin:6px 0 0; color:var(--mut); font-size:13px; }
  .board { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; padding:16px 32px 48px; align-items:start; }
  .col { background:#f2f2f2; border-radius:10px; padding:12px; min-height:120px; }
  .col h2 { margin:0; font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px; }
  .count { background:#ddd; color:#555; font-size:12px; border-radius:10px; padding:1px 8px; font-weight:500; }
  .colhint { margin:2px 0 12px; color:var(--mut); font-size:12px; }
  .col-done h2 { color:#1a7f37; } .col-doing h2 { color:#9a6700; } .col-todo h2 { color:#0969da; } .col-idea h2 { color:#6e7781; }
  .cards { display:flex; flex-direction:column; gap:10px; }
  .empty { color:#ccc; text-align:center; padding:18px 0; }
  .card { display:block; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; text-decoration:none; color:inherit; transition:box-shadow .12s,border-color .12s; }
  .card:hover { box-shadow:0 2px 10px rgba(0,0,0,.07); border-color:#d0d0d0; }
  .cardhead { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .cid { font:600 11px ui-monospace,Menlo,monospace; color:var(--mut); letter-spacing:.5px; }
  .owner { font-size:11px; border-radius:10px; padding:1px 8px; }
  .owner.none { background:#f0f0f0; color:#aaa; }
  .o-colin { background:#e8f0fe; color:#1967d2; } .o-wendi { background:#fde8f3; color:#b3308a; }
  .ctitle { font-size:15px; font-weight:600; line-height:1.4; margin-bottom:6px; }
  .demo { font-size:12px; color:var(--mut); margin-bottom:8px; }
  .shot { width:100%; border-radius:5px; border:1px solid var(--line); display:block; margin-bottom:8px; }
  .shot.missing { font-size:11px; color:#bbb; background:#fafafa; border:1px dashed var(--line); padding:14px; text-align:center; }
  .brief { font-size:13px; color:#444; line-height:1.6; }
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wordspace Next · Feature Board</title>
<style>${CSS}</style></head>
<body>
<header>
  <h1>Wordspace Next · Feature Board</h1>
  <p class="sub">真相源 = <code>specs/*.md</code>，本页由 <code>specs/build-board.mjs</code> 自动生成 · 共 ${specs.length} 条 spec</p>
</header>
<main class="board">${cols}</main>
</body></html>`;

writeFileSync(join(OUT_DIR, 'index.html'), html);
console.log(`✓ Feature Board 生成: out/index.html（${specs.length} 条 spec）`);
if (warnings.length) { console.log('⚠ 警告:'); warnings.forEach((w) => console.log('  - ' + w)); }
