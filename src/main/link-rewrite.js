/* src/main/link-rewrite.js —— U5 改名/移动 → 自动重写引用的「字节保真」核心（纯逻辑，无 electron/fs）。
 *
 * 铁律：只 splice href/url 的「值」那几个字节，文件其余字节（空白/引号风格/其它属性/实体/非合规野生
 * HTML）一字不动。测试钉死「重写前后除被改的 url 外逐字节相同」。
 *
 * 解析只为「定位」：rehype-parse 给 <a> 元素级 position（含字节 offset）→ 在其开标签内 scoped 正则找
 * href 值区间；remark-parse 给 md link 节点 position → 在 [text](url) 里定位 url 值。都不重序列化。
 *
 * 算法（handoff §5.4，L2/L3）：按文件迭代，解析基准 = 该文件「自身路径」。对每个 url：
 *   resolve(ownOld, path) → target；targetNew = moves.get(target) ?? target；ownNew 同理；
 *   两头都没动 → 跳过；尾缀（#锚/?查询）原样保留；newHref = relHref(ownNew, targetNew) + 尾缀。
 * 文件夹整体移动 = moves 覆盖子树每个孩子 → 子树内部互链旧解析+新重算天然抵消（no-op，不写）。
 *
 * ⚠ 已知限制：md 只重写 inline 链接 `[t](url)` / `[t](<url>)` / `[t](url "title")`；引用式
 *   `[t][ref]` + `[ref]: url` 的定义行不重写（少见，记欠账）。html 覆盖 <a href>（<area>/SVG 后续）。
 */
'use strict';
const wsLinks = require('../lib/links');

// ---- ESM 解析器动态 import 缓存（仿 md-adapter / link-index；主进程 CJS→ESM 官方路径）----
let htmlParserP = null;
let mdParserP = null;
function loadHtmlParser() {
  if (!htmlParserP) {
    htmlParserP = Promise.all([import('unified'), import('rehype-parse')])
      .then(([{ unified }, { default: rehypeParse }]) => { const proc = unified().use(rehypeParse); return (s) => proc.parse(s); })
      .catch((e) => { htmlParserP = null; throw e; });
  }
  return htmlParserP;
}
function loadMdParser() {
  if (!mdParserP) {
    mdParserP = Promise.all([import('unified'), import('remark-parse')])
      .then(([{ unified }, { default: remarkParse }]) => { const proc = unified().use(remarkParse); return (s) => proc.parse(s); })
      .catch((e) => { mdParserP = null; throw e; });
  }
  return mdParserP;
}

// 右往左应用互不重叠的 splice（保后段 offset 不被前段改动挪动）。
function applySplices(raw, splices) {
  splices.sort((a, b) => b.start - a.start);
  let out = raw;
  for (const s of splices) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

// 收集 html 里每个 <a href> 的「值」字节区间。scoped 到该元素开标签内找 href，绝不误匹配正文/别的元素。
function collectHtmlHrefSpans(raw, tree) {
  const spans = [];
  const walk = (node) => {
    if (node.type === 'element' && node.tagName === 'a' && node.properties && node.properties.href != null && node.position) {
      const s = node.position.start.offset;
      const gt = raw.indexOf('>', s); // 开标签结束（href 值含裸 '>' 极罕见、按需后续加固）
      if (gt >= 0) {
        const openTag = raw.slice(s, gt + 1);
        const m = openTag.match(/(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (m) {
          const quoted = m[2] != null || m[3] != null;
          const val = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
          const valStart = s + m.index + m[1].length + (quoted ? 1 : 0); // 跳过起始引号
          spans.push({ start: valStart, end: valStart + val.length, rawUrl: val });
        }
      }
    }
    for (const c of node.children || []) walk(c);
  };
  walk(tree);
  return spans;
}

// 收集 md inline link 的 url 值字节区间。node 覆盖 `[text](url ...)`，在其内定位 url（含 <bracketed>）。
function collectMdUrlSpans(raw, tree) {
  const spans = [];
  const walk = (node) => {
    if (node.type === 'link' && node.position) {
      const s = node.position.start.offset, e = node.position.end.offset;
      const slice = raw.slice(s, e);
      const m = slice.match(/\]\(\s*(<([^>]*)>|[^\s)]*)/); // ](  →  <url> 或裸 url（到空格/')'止）
      if (m && m[1]) {
        const isAngle = m[1].charAt(0) === '<';
        const inner = isAngle ? m[2] : m[1];
        const grpStart = m.index + (m[0].length - m[1].length); // group1 在 slice 内起点
        const abs = s + grpStart + (isAngle ? 1 : 0);
        spans.push({ start: abs, end: abs + inner.length, rawUrl: inner });
      }
    }
    for (const c of node.children || []) walk(c);
  };
  walk(tree);
  return spans;
}

// ---- C 跨根：绝对路径域重写引擎 ----
// rel 包装（rewriteContent）用的虚拟根：把 rel 抬成 abs 走同一引擎；单根 → relHrefSmart 恒同根 → 短形式，
// 与旧 rel 域输出逐字节相同（既有 14 字节保真单测继续走 rewriteContent 验证同一引擎）。
const VIRTUAL_ROOT = '/__ws2rewrite_root__';

function rootOf(abs, rootDirs) {
  for (const rd of rootDirs) { if (abs === rd || abs.indexOf(rd + '/') === 0) return rd; }
  return null;
}
// 目标新址 → href：同根写**短形式**（relHref，N5：同根别写成绕出根顶的长形式，否则被判断成断链）；
// 跨根写 abs 形式（relHrefAbs）。目标不在任何根下 → 外部链接、不该由本机器动（调用方已先跳过）。
function relHrefSmart(ownNewAbs, targetAbs, rootDirs) {
  const ro = rootOf(ownNewAbs, rootDirs), rt = rootOf(targetAbs, rootDirs);
  if (ro && rt && ro === rt) return wsLinks.relHref(ownNewAbs.slice(ro.length + 1), targetAbs.slice(rt.length + 1));
  return wsLinks.relHrefAbs(ownNewAbs, targetAbs);
}

// abs 域重写引擎：ownOldAbs/ownNewAbs = 文件重写前/后的绝对路径（自己被移动时 old != new，跨根移动 old/new 在不同根）；
// movesAbs = Map(absOld → absNew)；rootDirs = 所有 live 根的绝对路径（判短/长形式 + 只重写「解析到某根下」的目标）。
// **只重写目标落在某个根下的链接**——外部链接（解析到无根处）一律不碰（这条同时让 rel 包装保持旧「越界不动」语义）。
async function rewriteContentAbs(raw, ownOldAbs, ownNewAbs, movesAbs, isMd, rootDirs) {
  const src = String(raw == null ? '' : raw);
  let tree;
  try {
    const parse = isMd ? await loadMdParser() : await loadHtmlParser();
    tree = parse(src);
  } catch (e) { return { content: src, changed: false, count: 0 }; }
  const spans = isMd ? collectMdUrlSpans(src, tree) : collectHtmlHrefSpans(src, tree);
  const splices = [];
  for (const sp of spans) {
    const parts = wsLinks.splitHrefSuffix(sp.rawUrl); // [path, 尾缀]
    const absTarget = wsLinks.resolveHrefAbs(ownOldAbs, parts[0]); // 同根/跨根统一 abs 解析；外链/锚点/根绝对 → null
    if (absTarget == null) continue;
    if (rootOf(absTarget, rootDirs) == null) continue; // 目标在工作区外 → 不碰（保「越界不动」语义）
    const has = movesAbs.get(absTarget);
    const absTargetNew = has != null ? has : absTarget;
    if (absTargetNew === absTarget && ownNewAbs === ownOldAbs) continue; // 两头都没动
    const newHref = relHrefSmart(ownNewAbs, absTargetNew, rootDirs) + parts[1];
    if (newHref === sp.rawUrl) continue; // 子树内部互链等：算出来没变 → 不写
    splices.push({ start: sp.start, end: sp.end, text: newHref });
  }
  if (!splices.length) return { content: src, changed: false, count: 0 };
  return { content: applySplices(src, splices), changed: true, count: splices.length };
}

// rel 域包装（保留原签名/语义，既有单测走它）。ownOldRel/ownNewRel = 单根内路径；moves = Map(oldRel → newRel)。
// 虚拟根 → 引擎里恒同根 → 短形式，逐字节等于旧实现。
async function rewriteContent(raw, ownOldRel, ownNewRel, moves, isMd) {
  const R = VIRTUAL_ROOT;
  const movesAbs = new Map();
  for (const [o, n] of moves) movesAbs.set(R + '/' + o, R + '/' + n);
  return rewriteContentAbs(raw, R + '/' + ownOldRel, R + '/' + ownNewRel, movesAbs, isMd, [R]);
}

module.exports = { rewriteContent, rewriteContentAbs, relHrefSmart, applySplices, collectHtmlHrefSpans, collectMdUrlSpans, loadHtmlParser, loadMdParser };
