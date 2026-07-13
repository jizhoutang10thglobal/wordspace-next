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

// 重写一个文件的内容（纯字符串进出）。ownOldRel = 文件重写前的根内路径（解析既有 href 的基准）；
// ownNewRel = 重写后的路径（自己被移动时 != old）。moves = Map(oldRel → newRel)。
// 返回 { content, changed, count }。解析失败 / 无命中 → 原样返回、changed=false。
async function rewriteContent(raw, ownOldRel, ownNewRel, moves, isMd) {
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
    const target = wsLinks.resolveHref(ownOldRel, parts[0]); // 外链/锚点/越界 → null
    if (target == null) continue;
    const has = moves.get(target);
    const targetNew = has != null ? has : target;
    if (targetNew === target && ownNewRel === ownOldRel) continue; // 两头都没动
    const newHref = wsLinks.relHref(ownNewRel, targetNew) + parts[1];
    if (newHref === sp.rawUrl) continue; // 子树内部互链等：算出来没变 → 不写
    splices.push({ start: sp.start, end: sp.end, text: newHref });
  }
  if (!splices.length) return { content: src, changed: false, count: 0 };
  return { content: applySplices(src, splices), changed: true, count: splices.length };
}

module.exports = { rewriteContent, applySplices, collectHtmlHrefSpans, collectMdUrlSpans, loadHtmlParser, loadMdParser };
