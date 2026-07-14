// 文档互链索引（主进程，**可丢弃缓存**——永远是磁盘的从属，任何「信索引不信磁盘」的捷径都是返工点）。
// 多根：每个根一份 { rel → { mtime, size, ino, title, kind, outLinks:[{rel,snippet}] } }。相对链接只会落在
// 文档自己的根子树内（根不嵌套 + resolveHref 越界判 null），所以出链目标 rel 与源同根，反链在根内算。
//
// 无 electron / 无 DOM（主进程没有 DOMParser）：HTML 用 unified + rehype-parse（都是本仓已声明依赖，仿 md-adapter
// 动态 import ESM 缓存；不直接 import hast-util-from-html——那是 rehype-parse 的传递依赖、本仓没声明）；
// .md 先过 md-adapter.mdToHtml 再同一口径抽。持久化交给调用方给 storeFile（原子写），node:test 用 tmpdir 直测。
'use strict';
const fsp = require('fs/promises');
const path = require('path');
const { kindOf } = require('../lib/file-tree');
const wsLinks = require('../lib/links'); // resolveHref/relHref（U1）
const mdAdapter = require('./md-adapter');
const docIdLib = require('../lib/doc-id'); // U7 双层身份修复锚

const INDEX_VERSION = 1;
const DOC_RE = /\.(html?|md)$/i;
// 抽 snippet 时认定的「块」边界：链接所在块的纯文本做反链上下文（对齐 ui-demo snippetOf）。
const BLOCK_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'figcaption', 'summary', 'div', 'section', 'article', 'pre']);

// ---- HTML → hast 解析器（unified + rehype-parse，动态 import 缓存）----
let parserPromise = null;
function loadParser() {
  // import 失败不缓存 rejected promise（否则一次瞬时失败 → 整个索引永久哑）：reject 时清回 null 以便下次重试。
  if (!parserPromise) {
    parserPromise = Promise.all([import('unified'), import('rehype-parse')])
      .then(([{ unified }, { default: rehypeParse }]) => { const proc = unified().use(rehypeParse); return (html) => proc.parse(html); })
      .catch((e) => { parserPromise = null; throw e; });
  }
  return parserPromise;
}
// 启动时预热解析器（main.js whenReady 调）：把首次冷 `import()` 提前到启动、别等第一次开文档才做——
// 一来第一次反链/索引更快；二来避开「首次开文档触发冷 ESM import 在主进程里瞬时打断 app.evaluate」的
// 测试竞态（U6 反链面板让每次开文档都建索引后暴露：`Execution context was destroyed`）。
function warm() { return loadParser().catch(() => {}); }

const SKIP_TEXT = new Set(['script', 'style', 'template', 'noscript']); // 这些子树是源码/非可见内容，别混进 title/snippet
function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  if (node.type === 'element' && SKIP_TEXT.has(node.tagName)) return '';
  let s = '';
  for (const c of node.children || []) s += textOf(c);
  return s;
}
function snippetClamp(s, max = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// 从完整 HTML 文档串抽 { title, links:[{href, snippet}] }。纯字符串进出，可单测。
// title = 首个 <h1> 文本 → <title> → ''（调用方用文件名兜底）。snippet = 链接所在块纯文本。
async function extractDocMeta(html) {
  const fromHtml = await loadParser();
  let tree;
  try { tree = fromHtml(String(html == null ? '' : html)); }
  catch (e) { return { title: '', links: [] }; }
  let firstH1 = '';
  let titleTag = '';
  const links = [];
  const blockText = new Map(); // 块节点 → 纯文本记忆化（同块多链接不重算，审查 D）
  const btext = (n) => { if (!n) return ''; if (blockText.has(n)) return blockText.get(n); const t = textOf(n); blockText.set(n, t); return t; };
  // 携带「最近块祖先」下行：命中 a[href] 时取该块文本做 snippet。
  const walk = (node, block) => {
    if (node.type === 'element') {
      const tag = node.tagName;
      if (tag === 'h1' && !firstH1) firstH1 = textOf(node);
      else if (tag === 'title' && !titleTag) titleTag = textOf(node);
      if (BLOCK_TAGS.has(tag)) block = node; // 进入更近的块
      if (tag === 'a' && node.properties && node.properties.href != null) {
        links.push({ href: String(node.properties.href), snippet: snippetClamp(btext(block || node)) });
      }
    }
    for (const c of node.children || []) walk(c, block);
  };
  walk(tree, null);
  return { title: (firstH1 || titleTag || '').trim(), links };
}

// 读一个文档文件 → { title, outLinks:[{rel,snippet}] }，或 **null = 读失败**（上层跳过、下轮重试）。
// 关键（审查 A）：读字节失败（EACCES/EBUSY/竞态删除）≠「文档没链接」——绝不把失败当成一次成功的空解析提交，
// 否则带着有效 stat 戳固化空条目、mtime 不变就永不重读，出链/反链永久丢失（违背「disk is truth」）。
async function readDocMeta(abs, ownRel) {
  let raw;
  try { raw = await fsp.readFile(abs, 'utf8'); }
  catch (e) { return null; } // 读字节失败 → 跳过、下轮重试
  const docId = mdAdapter.isMdPath(abs) ? null : docIdLib.readDocId(raw); // U7：html 从 raw 读 doc-id（md frontmatter 欠账）
  let html = raw;
  if (mdAdapter.isMdPath(abs)) { try { html = await mdAdapter.mdToHtml(raw, { title: baseNoExt(abs) }); } catch (e) { html = raw; } } // md 转换失败：退化按原文抽（不毒化）
  const { title, links } = await extractDocMeta(html);
  const seen = new Set();
  const outLinks = [];
  for (const { href, snippet } of links) {
    const rel = wsLinks.resolveHref(ownRel, href); // 同根内目标 rel；外链/锚点/越界 → null
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    outLinks.push({ rel, snippet });
  }
  return { title: title || baseNoExt(abs), outLinks, docId };
}
function baseNoExt(p) { return path.basename(p).replace(DOC_RE, ''); }

// ---- 递归列出一个根下满足 predicate(name) 的文件，返回 [{rel, abs}]（rel 用 / 分隔）----
async function listFilesMatching(rootPath, predicate) {
  const out = [];
  async function rec(dirAbs, relPrefix) {
    let ents;
    try { ents = await fsp.readdir(dirAbs, { withFileTypes: true }); }
    catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue; // 跳隐藏（.git/.ws2-trash 等）
      const abs = path.join(dirAbs, e.name);
      const rel = relPrefix ? relPrefix + '/' + e.name : e.name;
      if (e.isDirectory()) await rec(abs, rel);
      else if (e.isFile() && predicate(e.name)) out.push({ rel, abs });
    }
  }
  await rec(rootPath, '');
  return out;
}
function listDocs(rootPath) { return listFilesMatching(rootPath, (n) => DOC_RE.test(n)); }
// 非文档文件（pdf/图片/表格等）：@菜单里列在文档之后（链接任何文件都合法，点击时非文档走系统程序）。
async function listNonDocFiles(rootPath) {
  const files = await listFilesMatching(rootPath, (n) => !DOC_RE.test(n));
  return files.map((f) => { const name = path.basename(f.rel); return { rel: f.rel, kind: kindOf(f.rel), title: name.replace(/\.[^.]+$/, '') || name }; }); // 去任意扩展名（baseNoExt 只去 .html/.md）
}

// ---- 索引状态：Map<rootId, { path, docs: Map<rel, entry> }> ----
// entry = { mtime, size, ino, title, kind, outLinks:[{rel,snippet}] }
const index = new Map();

function getRoot(rootId) {
  let r = index.get(rootId);
  if (!r) { r = { path: null, docs: new Map() }; index.set(rootId, r); }
  return r;
}

// 增量刷新一个根：stat 每个文档，mtime/size/ino 任一变（或新文件）才重读；消失的删掉。返回是否有变更。
async function refreshRoot(rootId, rootPath) {
  const r = getRoot(rootId);
  r.path = rootPath;
  const files = await listDocs(rootPath);
  const live = new Set();
  let changed = false;
  await Promise.all(files.map(async ({ rel, abs }) => {
    live.add(rel);
    let st;
    try { st = await fsp.stat(abs, { bigint: true }); } catch { return; }
    const mtime = String(st.mtimeNs), size = Number(st.size), ino = String(st.ino); // 纳秒精度：同毫秒内原地改动也检出
    const prev = r.docs.get(rel);
    if (prev && prev.mtime === mtime && prev.size === size && prev.ino === ino) return; // 没变
    const meta = await readDocMeta(abs, rel);
    if (!meta) return; // 读失败：不写条目、不推进 stat 戳 → 保留旧条目、下轮重试（审查 A）
    // _prevOut：重建前旧出链（带 targetDocId），给 U7 carry-forward 用；post-pass 后删除、不入盘。
    r.docs.set(rel, { mtime, size, ino, kind: kindOf(rel), title: meta.title, outLinks: meta.outLinks, docId: meta.docId, _prevOut: prev ? prev.outLinks : null });
    changed = true;
  }));
  for (const rel of [...r.docs.keys()]) { if (!live.has(rel)) { r.docs.delete(rel); changed = true; } } // 删消失的
  // U7 修复锚快照：给每条出链记「目标当前 docId」；目标已消失（断链）→ 沿用重建前的旧快照（carry-forward）。
  // 这样目标被外部改名/移动后（rel 变了但 docId 随字节不变），修复卡靠这个稳定 id 反查现址。
  for (const [, e] of r.docs) {
    const prevMap = e._prevOut ? new Map(e._prevOut.map((l) => [l.rel, l.targetDocId])) : null;
    for (const l of e.outLinks) {
      const tgt = r.docs.get(l.rel);
      if (tgt) l.targetDocId = tgt.docId || null;                              // 目标在 → 快照现 id
      else if (prevMap && prevMap.has(l.rel)) l.targetDocId = prevMap.get(l.rel); // 目标没了 → 沿用旧快照
      // 目标没了且本轮没重建（未变文档）：l.targetDocId 保持对象上已有的旧值
    }
    if ('_prevOut' in e) delete e._prevOut; // 不入盘
  }
  return changed;
}

function rebuildRoot(rootId, rootPath) {
  index.delete(rootId); // 丢缓存，全量重建
  return refreshRoot(rootId, rootPath);
}
function removeRoot(rootId) { index.delete(rootId); }

// @菜单候选：某根全部文档 { rel, title, kind }（标题排序留给 renderer/调用方）。
function query(rootId) {
  const r = index.get(rootId);
  if (!r) return [];
  return [...r.docs.entries()].map(([rel, e]) => ({ rel, title: e.title, kind: e.kind }));
}

// ⚠ 已知限制（plan §6 拍板延后）：大小写不敏感 FS（macOS APFS/Windows 默认）上，手写 href 大小写与磁盘不一致
// （href="notes.html" 而磁盘是 Notes.html）时，outLinks 存 href 原样大小写、docs 键用磁盘大小写 → backlinks/titleOf 的
// === 精确比对会漏（反链丢、出链在 U4 显示成断链/无标题），但链接点击仍能打开（FS 不敏感）。真解要 FS 大小写敏感性探测
// + NFC/NFD 归一（在 case-sensitive FS 上乱 casefold 会把真断链误判成有效），非平凡 → 留后续；U4 断链修复卡兜底。
// 反链：根内哪些文档链到 (rootId, targetRel)。返回 [{rel, title, snippet}]（每源一条，取首个命中链接的 snippet）。
function backlinks(rootId, targetRel) {
  const r = index.get(rootId);
  if (!r) return [];
  const out = [];
  for (const [rel, e] of r.docs) {
    if (rel === targetRel) continue; // 自链不算
    const hit = e.outLinks.find((l) => l.rel === targetRel);
    if (hit) out.push({ rel, title: e.title, snippet: hit.snippet });
  }
  return out;
}

// 文件夹反链（U6 删除守卫）：夹外文档里，哪些链到「夹内任意文档」。**夹内互链不算**（删整夹一起走）。
// 返回 [{rel, title, snippet}]（每个外部来源一条，取首个命中夹内的链接的 snippet）。dirRel = 文件夹根内路径。
function dirBacklinks(rootId, dirRel) {
  const r = index.get(rootId);
  if (!r || !dirRel) return [];
  const prefix = dirRel + '/';
  const under = (rel) => rel.indexOf(prefix) === 0; // 夹内（文件夹本身不是文档，不会等于 rel）
  const out = [];
  for (const [rel, e] of r.docs) {
    if (under(rel)) continue; // 夹内来源不算外部引用
    const hit = e.outLinks.find((l) => under(l.rel));
    if (hit) out.push({ rel, title: e.title, snippet: hit.snippet });
  }
  return out;
}

// U-CR0 跨根移动守卫：条目自身「指向源根的出链」计数——移去别的根后这些相对链接会失效
//（跨根自动重写要等 C 阶段；在此之前先拦一道，别静默损坏）。
// 文件 = 它全部 outLinks 条数（换根后基准变了、全断）；文件夹 = 夹内文档指向「夹外」的链接条数
//（夹内互链一起搬、相对路径不变、不算——与 dirBacklinks 的夹外语义对称）。
function ownOutlinks(rootId, rel, isDir) {
  const r = index.get(rootId);
  if (!r || !rel) return 0;
  if (!isDir) {
    const e = r.docs.get(rel);
    return e ? e.outLinks.length : 0;
  }
  const prefix = rel + '/';
  const under = (x) => x.indexOf(prefix) === 0;
  let n = 0;
  for (const [drel, e] of r.docs) {
    if (!under(drel)) continue; // 只看夹内文档的出链
    for (const l of e.outLinks) if (!under(l.rel)) n++; // 指向夹外 = 换根后会断
  }
  return n;
}

function titleOf(rootId, rel) {
  const r = index.get(rootId);
  const e = r && r.docs.get(rel);
  return e ? e.title : null;
}

// U7：按 doc-id 反查当前文件 rel（全库匹配修复锚）。找不到 / 没 id → null。
function relOfDocId(rootId, docId) {
  if (!docId) return null;
  const r = index.get(rootId);
  if (!r) return null;
  for (const [rel, e] of r.docs) { if (e.docId === docId) return rel; }
  return null;
}

// U7 修复卡：断链的目标搬去哪了？靠 source→target 出链快照的 doc-id 全库反查现址
// （目标被外部改名/移动后 rel 变了、docId 随字节不变 → 仍能找到）。找不到 / 没搬 → null。
function movedTarget(rootId, sourceRel, targetRel) {
  const r = index.get(rootId);
  const src = r && r.docs.get(sourceRel);
  if (!src) return null;
  const l = src.outLinks.find((x) => x.rel === targetRel);
  if (!l || !l.targetDocId) return null;
  const rel = relOfDocId(rootId, l.targetDocId);
  return (rel && rel !== targetRel) ? rel : null;
}

// ---- 持久化（可丢弃缓存的热启动优化）：按根 path 存（跨会话稳定，rootId 是会话号）。原子写，损坏/版本不符 → 忽略全量重建 ----
// read-modify-write（审查 B）：只覆盖内存中各根的条目，保留本会话没加载进内存的根的缓存——否则全量覆盖会把
// 「已打开但本会话没先碰过」的根的持久化缓存抹掉，多根热启动优化失效。keepPaths 给定时剪掉已不在注册表的根（防无界增长）。
async function save(storeFile, keepPaths) {
  let byPath = {};
  try { const p = JSON.parse(await fsp.readFile(storeFile, 'utf8')); if (p && p.version === INDEX_VERSION && p.byPath) byPath = p.byPath; }
  catch { /* 无/损坏 → 从空开始 */ }
  for (const r of index.values()) {
    if (!r.path) continue;
    byPath[r.path] = { docs: [...r.docs.entries()].map(([rel, e]) => [rel, e]) };
  }
  if (keepPaths) { for (const k of Object.keys(byPath)) if (!keepPaths.has(k)) delete byPath[k]; }
  const tmp = storeFile + '.tmp';
  await fsp.mkdir(path.dirname(storeFile), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify({ version: INDEX_VERSION, byPath }), 'utf8');
  await fsp.rename(tmp, storeFile);
}
// 把某根的持久化缓存喂进内存（若 path 命中且版本对）。返回是否命中（未命中 → 调用方 refreshRoot 全量建）。
async function hydrate(storeFile, rootId, rootPath) {
  let parsed;
  try { parsed = JSON.parse(await fsp.readFile(storeFile, 'utf8')); }
  catch { return false; }
  if (!parsed || parsed.version !== INDEX_VERSION || !parsed.byPath) return false;
  const saved = parsed.byPath[rootPath];
  if (!saved || !Array.isArray(saved.docs)) return false;
  const r = getRoot(rootId);
  r.path = rootPath;
  r.docs = new Map(saved.docs);
  return true;
}

module.exports = {
  extractDocMeta, readDocMeta, listDocs, listNonDocFiles,
  refreshRoot, rebuildRoot, removeRoot,
  query, backlinks, dirBacklinks, ownOutlinks, titleOf, relOfDocId, movedTarget, warm,
  save, hydrate,
  _index: index, // 测试用
};
