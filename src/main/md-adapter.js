// Markdown ↔ HTML 适配器（Feature: markdown 文件阅读编辑器，设计见 docs/design/2026-07-02-markdown-backend.md）。
// 架构：编辑器/校验器格式无关，格式只活在磁盘 IO 两端——read-doc 处 mdToHtml、save-doc 处 htmlToMd，
// 中间全链路（校验分流/块编辑/基础编辑）不动。纯字符串进出、不碰 fs/ipc，node:test 可直测。
//
// 语义层（标题/段落/列表/引用/表格/粗斜删码链）走纯 Markdown（GFM 默认开）；表现层 Markdown 无语法
// （下划线/文字色/高亮/callout/toggle）→「HTML 岛」原样穿透（CommonMark 允许内嵌 HTML）。
// 不 sanitize：md 里的 <script> 等原样转出来，由校验器判非合规 → 走基础编辑（分流靠校验器，不靠转换器）。
//
// ⚠ unified 生态是 ESM-only、主进程是 CJS → 动态 import() 加载 + 模块级缓存（Node CJS→ESM 官方路径；
// 打包态可用性由 e2e/markdown.spec.js 在真 Electron 里兜底）。
'use strict';

// 行内标签集合复用校验器同源（schema-model 是纯 CJS 模块）：判「单元格里是不是块级内容」与校验器口径一致
const { PHRASING_TAGS: PHRASING } = require('../lib/schema-model.js');
const i18n = require('../lib/i18n');

let enginePromise = null;

function loadEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const [
      { unified },
      { default: remarkParse }, { default: remarkGfm }, { default: remarkRehype },
      { default: rehypeRaw }, { default: rehypeStringify },
      { default: rehypeParse }, { default: rehypeRemark }, { default: remarkStringify },
      { toHtml }, { defaultHandlers },
    ] = await Promise.all([
      import('unified'),
      import('remark-parse'), import('remark-gfm'), import('remark-rehype'),
      import('rehype-raw'), import('rehype-stringify'),
      import('rehype-parse'), import('rehype-remark'), import('remark-stringify'),
      import('hast-util-to-html'), import('hast-util-to-mdast'),
    ]);

    // ---- hast 小工具（手写遍历，不引 unist-util-visit）----
    const isEl = (n, tag) => n && n.type === 'element' && (!tag || n.tagName === tag);
    function walk(node, fn) {
      fn(node);
      if (node.children) for (const c of [...node.children]) walk(c, fn);
    }
    const hasClass = (n, cls) => {
      const c = n.properties && n.properties.className;
      return Array.isArray(c) ? c.includes(cls) : c === cls;
    };

    // ---- md→html 方向：GFM 产物规范化成 Schema #1 canonical 形态 ----
    // ① 任务列表：<ul class="contains-task-list"><li class="task-list-item"><input checkbox> …
    //    → <ul class="ws-todo"><li data-checked="true|false">…（app canonical，校验器/编辑器都认这个；
    //    GFM 原生的 <input> 不是 phrasing、会被校验器判 li-content 违规）。
    // ② 松散列表：md 里项与项之间有空行 → <li><p>…</p></li>，校验器判违规（li 内只能行内+尾随子列表）。
    //    规范化：li 里的 <p> 拆掉、多段用 <br> 连（规范化可接受，origin 决策 3）。
    function rehypeWsNormalize() {
      return (tree) => {
        walk(tree, (node) => {
          if (isEl(node, 'ul') && hasClass(node, 'contains-task-list')) {
            node.properties.className = ['ws-todo'];
          }
          if (isEl(node, 'li')) {
            if (hasClass(node, 'task-list-item')) {
              delete node.properties.className;
              const checked = extractCheckbox(node);
              if (checked !== null) node.properties.dataChecked = checked ? 'true' : 'false';
            }
            unwrapLiParagraphs(node);
          }
        });
      };
    }
    // li 里找 GFM checkbox（紧凑列表直接子 / 松散列表在 <p> 里——p 前可能还有换行文本节点），摘掉并回传勾选态。
    function extractCheckbox(li) {
      const scopes = [li, ...li.children.filter((c) => isEl(c, 'p'))];
      for (const scope of scopes) {
        for (let i = 0; i < scope.children.length; i++) {
          const c = scope.children[i];
          if (isEl(c, 'input') && c.properties && c.properties.type === 'checkbox') {
            const checked = c.properties.checked != null && c.properties.checked !== false;
            scope.children.splice(i, 1);
            // GFM 在 checkbox 后跟一个空格文本节点，一并吃掉
            const next = scope.children[i];
            if (next && next.type === 'text' && /^\s/.test(next.value)) next.value = next.value.replace(/^\s+/, '');
            return checked;
          }
        }
      }
      return null;
    }
    function unwrapLiParagraphs(li) {
      if (!li.children.some((c) => isEl(c, 'p'))) return;
      const out = [];
      for (const c of li.children) {
        if (isEl(c, 'p')) {
          if (out.some((n) => n.type === 'element' || (n.type === 'text' && n.value.trim()))) {
            out.push({ type: 'element', tagName: 'br', properties: {}, children: [] });
          }
          out.push(...c.children);
        } else if (c.type === 'text' && !c.value.trim()) {
          // 丢掉松散列表里 p 之间的换行占位文本
        } else {
          out.push(c);
        }
      }
      li.children = out;
    }

    // ---- html→md 方向 ----
    // 只转 body 内容：head（charset/title/编辑器注入的 <style data-ws-schema-css>）是载入时再生的，不进 .md。
    function rehypeBodyOnly() {
      return (tree) => {
        const htmlEl = tree.children.find((n) => isEl(n, 'html'));
        const body = htmlEl && htmlEl.children.find((n) => isEl(n, 'body'));
        if (body) tree.children = body.children;
      };
    }
    // app canonical 的 todo（ul.ws-todo > li[data-checked]）→ 还原成 GFM checkbox 形态，让 to-mdast 认出任务列表。
    // 只认 ws-todo 父级（对抗审计：普通列表里第三方的 data-checked 不能被误改造成待办）；顺手剥掉 ws-todo
    // class——它往返经 GFM contains-task-list 规范化重生，留着会触发下面的属性保真升级、把整个 todo 列表岛化。
    function rehypeFromWsTodo() {
      return (tree) => {
        // 修 MD-3：跳过有「岛」祖先的 ws-todo。岛（details/div/section…）走 rawIsland=toHtml 原样穿透，
        // 其内 canonical 的 ws-todo/data-checked 往返完美、重开仍 conform；若在这里被改造成 GFM <input>，
        // toHtml 会把坏形态写进岛 → 重开 li-content:INPUT 非合规、todo 永久降级。只改「会真走 GFM 管道」的顶层 ws-todo。
        function rec(node, inIsland) {
          const island = inIsland || (isEl(node) && ISLAND_SET.has(node.tagName));
          if (!island && isEl(node, 'ul') && hasClass(node, 'ws-todo')) {
            delete node.properties.className;
            for (const li of node.children) {
              if (!isEl(li, 'li') || !li.properties || li.properties.dataChecked == null) continue;
              const checked = String(li.properties.dataChecked) === 'true';
              delete li.properties.dataChecked;
              li.children.unshift(
                { type: 'element', tagName: 'input', properties: { type: 'checkbox', checked }, children: [] },
                { type: 'text', value: ' ' },
              );
            }
          }
          if (node.children) for (const c of node.children) rec(c, island);
        }
        rec(tree, false);
      };
    }
    // HTML 岛序列化侧：md 没有语法的标签原样吐 outerHTML（to-mdast 默认会把认不得的标签拆壳丢标记）。
    // 岛内含空行会让 CommonMark 的 HTML 块在空行处断裂（对抗审计实证：callout 里带空行的 <pre> 一轮
    // 往返就被劈成两半、<p> 钻进 <pre>）——含空行的岛把所有换行写成 &#10; 实体压成单行：解析回来是
    // 同一个换行字符，语义不变、且幂等（第二轮输出与第一轮相同）。
    const rawIsland = (_state, node) => {
      let v = toHtml(node);
      if (/\n[ \t]*\n/.test(v)) v = v.replace(/\n/g, '&#10;');
      return { type: 'html', value: v };
    };
    const ISLAND_TAGS = [
      // 行内表现层：下划线/高亮/文字色/上下标等
      'u', 'mark', 'span', 'sub', 'sup', 'small', 'big', 'font', 'ins', 'kbd', 'samp', 'var', 'abbr', 'time', 'cite', 'q', 'label',
      // 块级：callout/toggle/图注（md 无语法）+ 野文件常见块（script/iframe/style/媒体/布局容器——非合规
      // 文档基础编辑保存时同样过这条链路，必须保真、不能静默丢）
      'div', 'details', 'figure', 'script', 'style', 'iframe', 'video', 'audio', 'canvas', 'svg', 'object', 'embed',
      'form', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'button', 'select', 'textarea',
      // 修 MD-4：md 无语法、且 hast-util-to-mdast 会「拆壳丢标签 / 整块丢弃」的其余有效 HTML 元素——
      // 不 island 就静默丢内容（dialog/template 整块蒸发、dl 被改成 bullet 列表、picture 丢 source、ruby 注音混进正文）。
      // unknownHandler 对这些不生效（实测），只有显式 handler→rawIsland 才保真。补齐已知会丢的一批。
      'dialog', 'template', 'dl', 'dt', 'dd', 'center', 'ruby', 'rt', 'rp', 'rtc', 'bdi', 'bdo', 'wbr', 'data', 'dfn',
      'picture', 'source', 'track', 'map', 'area', 'fieldset', 'legend', 'noscript', 'marquee', 'output', 'meter',
      'progress', 'datalist', 'optgroup', 'option', 'menu', 'hgroup', 'search', 'slot', 'figcaption', 'summary',
    ];
    const ISLAND_SET = new Set(ISLAND_TAGS);
    const islandHandlers = {};
    for (const t of ISLAND_TAGS) islandHandlers[t] = rawIsland;
    // 硬换行统一序列化成字面 <br>（GFM 合法、往返无损）：默认的 break→「反斜杠+换行」在 GFM 管道表
    // 单元格里会被压成空格（对抗审计实证 | 行1<br>行2 | 丢换行）；段落里字面 <br> 同样合法。
    islandHandlers.br = () => ({ type: 'html', value: '<br>' });
    // 属性保真（对抗审计 P1）：标准标签走 md 语法会把属性剥光（<h1 style> 存一次颜色就没了——而带属性的
    // 块正是被校验器判非合规、送进「保真」基础编辑的那批）。md 语法能表达的属性白名单之外还有任何属性
    // → 该块整体升级 HTML 岛。子树里已注册为岛的标签（span/mark/div…）自己保真，不牵连父块升级。
    const REPRESENTABLE = {
      a: new Set(['href', 'title']),
      img: new Set(['src', 'alt', 'title']),
      td: new Set(['align']), th: new Set(['align']), // GFM 表格对齐（remark 产物）
      ol: new Set(['start']),
      code: new Set(['class']), // 围栏语言标 language-*
      input: new Set(['type', 'checked', 'disabled']), // rehypeFromWsTodo 造的 GFM checkbox
    };
    const EMPTY_SET = new Set();
    function hasUnrepresentableAttrs(node, isRoot) {
      if (isEl(node) && !isRoot && ISLAND_SET.has(node.tagName)) return false;
      if (isEl(node) && node.properties) {
        const allow = REPRESENTABLE[node.tagName] || EMPTY_SET;
        for (const key of Object.keys(node.properties)) {
          const val = node.properties[key];
          if (val == null || val === false || (Array.isArray(val) && val.length === 0)) continue;
          const attr = key === 'className' ? 'class' : key.toLowerCase();
          if (!allow.has(attr)) return true;
        }
      }
      if (node.children) for (const c of node.children) if (hasUnrepresentableAttrs(c, false)) return true;
      return false;
    }
    for (const t of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'pre', 'hr', 'a', 'img']) {
      const dflt = defaultHandlers[t];
      if (!dflt) continue;
      islandHandlers[t] = (state, node) => (hasUnrepresentableAttrs(node, true) ? rawIsland(state, node) : dflt(state, node));
    }
    // 修 MD-5：li 内「子列表之后还有内容」（尾段被 unwrapLiParagraphs 拼成 <br>+文字）→ md 列表语法表达不了，
    // 序列化会让 <br>/尾段每存一轮往子项缩进里漂一格（对抗审计实证 3 轮收敛到错误结构、内容从父项迁到子项）。
    // 该结构整个列表升级 HTML 岛（raw 穿透、往返稳定），fail-closed 保内容不漂。
    function liHasContentAfterSublist(li) {
      let seenSublist = false;
      for (const c of li.children || []) {
        if (isEl(c, 'ul') || isEl(c, 'ol')) { seenSublist = true; continue; }
        if (seenSublist) {
          if (c.type === 'element') return true;
          if (c.type === 'text' && c.value.trim()) return true;
        }
      }
      return false;
    }
    for (const t of ['ul', 'ol']) {
      const prev = islandHandlers[t];
      islandHandlers[t] = (state, node) => {
        let drift = false;
        walk(node, (n) => { if (!drift && isEl(n, 'li') && liHasContentAfterSublist(n)) drift = true; });
        return drift ? rawIsland(state, node) : prev(state, node);
      };
    }
    // 表格升级 HTML 岛的三种情况（否则走 GFM 管道表）：①合并格（管道表表达不了）；②单元格含块级子元素
    // （ul/pre/div…——序列化出带真实换行的非法管道表，重开时整表碎裂，对抗审计实证）；③带不可表达属性。
    islandHandlers.table = (state, node) => {
      let wild = hasUnrepresentableAttrs(node, true);
      walk(node, (n) => {
        if (wild || !isEl(n) || (n.tagName !== 'td' && n.tagName !== 'th')) return;
        if (n.properties && (n.properties.colSpan != null || n.properties.rowSpan != null)) { wild = true; return; }
        for (const c of n.children || []) {
          if (isEl(c) && !PHRASING.has(c.tagName.toUpperCase())) { wild = true; return; }
        }
      });
      return wild ? rawIsland(state, node) : defaultHandlers.table(state, node);
    };

    const md2html = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeWsNormalize)
      .use(rehypeStringify);

    const html2md = unified()
      .use(rehypeParse)
      .use(rehypeBodyOnly)
      .use(rehypeFromWsTodo)
      .use(rehypeRemark, { handlers: islandHandlers })
      .use(remarkGfm)
      // 序列化风格写死（origin 决策 3：规范化可接受、风格固定）：`* 项` 存回 `- 项`
      .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*', fence: '`', rule: '-' });

    return { md2html, html2md };
  })();
  return enginePromise;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 修 MD-2（零依赖 frontmatter 保真）：野生 .md（Obsidian/Jekyll/Hugo）极常见首部 YAML frontmatter（--- 包起来）。
// 不处理的话 md→html 会把首个 --- 当 hr、YAML 体+第二个 --- 当 setext h2 → 判 conform 进块编辑 → 存一次永久损坏。
// 方案：读盘时把整段 frontmatter（含分隔线，字节原样）剥出来 base64 塞进 <head> 的 <meta name="ws-frontmatter">
// （校验器 validateHead 放行 meta[name]，编辑器不碰 head、WS2Serialize/基础编辑序列化都保留 head）——它随文档穿行、
// 不进 md 转换管道、不参与 schema 判定；存盘时从 content 里抠出来解码、原样贴回 md 首部。无外部状态、不受改名影响。
function splitFrontMatter(md) {
  const s = String(md == null ? '' : md);
  const hasBom = s.charCodeAt(0) === 0xFEFF;
  const t = hasBom ? s.slice(1) : s;
  const lines = t.split('\n');
  if (!/^---[ \t]*\r?$/.test(lines[0])) return { frontMatter: null, body: s }; // 首行不是 --- → 没有 frontmatter
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*\r?$/.test(lines[i])) { closeIdx = i; break; } // YAML 闭合 --- 或 ...
  }
  if (closeIdx < 0) return { frontMatter: null, body: s }; // 没闭合 = 不是 frontmatter，绝不乱剥
  const frontMatter = (hasBom ? '﻿' : '') + lines.slice(0, closeIdx + 1).join('\n') + '\n';
  return { frontMatter, body: lines.slice(closeIdx + 1).join('\n') };
}
function encodeFm(fm) { return Buffer.from(fm, 'utf8').toString('base64'); }
function extractFrontMatterMeta(html) {
  const tag = /<meta\b[^>]*\bname=["']ws-frontmatter["'][^>]*>/i.exec(String(html || ''));
  if (!tag) return null;
  const c = /\bcontent=["']([^"']*)["']/i.exec(tag[0]);
  if (!c) return null;
  try { return Buffer.from(c[1], 'base64').toString('utf8'); } catch (e) { return null; }
}

// md 字符串 → 完整 HTML 文档字符串（校验器 validateHead / loadFromHtml 都吃完整文档）。
// title = 文件名去扩展名（调用方传）；head 形态对齐 app 合规文档惯例（charset + schema meta + title）。
async function mdToHtml(md, opts) {
  const { md2html } = await loadEngine();
  const { frontMatter, body: mdBody } = splitFrontMatter(md); // 修 MD-2：先剥 frontmatter，别让 --- 进转换管道
  const body = String(await md2html.process(String(mdBody == null ? '' : mdBody)));
  const title = escapeHtml((opts && opts.title) || i18n.t('common.untitled'));
  const fmMeta = frontMatter ? '<meta name="ws-frontmatter" content="' + encodeFm(frontMatter) + '">\n' : '';
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="wordspace-schema" content="1">\n' + fmMeta + '<title>'
    + title + '</title>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}

// 完整 HTML 文档字符串（编辑器序列化产物）→ md 字符串。只转 body；head 丢弃（载入时再生）。
// 修 MD-2：先从 content 抠出 ws-frontmatter meta 解码，转换后原样贴回 md 首部（frontmatter 字节保真）。
async function htmlToMd(html) {
  const { html2md } = await loadEngine();
  const src = String(html == null ? '' : html);
  const fm = extractFrontMatterMeta(src);
  const body = String(await html2md.process(src));
  return (fm || '') + body;
}

const isMdPath = (p) => typeof p === 'string' && /\.md$/i.test(p);

module.exports = { mdToHtml, htmlToMd, isMdPath, splitFrontMatter, extractFrontMatterMeta };
