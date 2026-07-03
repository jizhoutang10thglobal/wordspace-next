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
    // app canonical 的 todo（li[data-checked]）→ 还原成 GFM checkbox 形态，让 to-mdast 认出任务列表。
    function rehypeFromWsTodo() {
      return (tree) => {
        walk(tree, (node) => {
          if (!isEl(node, 'li') || !node.properties || node.properties.dataChecked == null) return;
          const checked = String(node.properties.dataChecked) === 'true';
          delete node.properties.dataChecked;
          node.children.unshift(
            { type: 'element', tagName: 'input', properties: { type: 'checkbox', checked }, children: [] },
            { type: 'text', value: ' ' },
          );
        });
      };
    }
    // HTML 岛序列化侧：md 没有语法的标签原样吐 outerHTML（to-mdast 默认会把认不得的标签拆壳丢标记）。
    const rawIsland = (_state, node) => ({ type: 'html', value: toHtml(node) });
    const ISLAND_TAGS = [
      // 行内表现层：下划线/高亮/文字色/上下标等
      'u', 'mark', 'span', 'sub', 'sup', 'small', 'big', 'font', 'ins', 'kbd', 'samp', 'var', 'abbr', 'time', 'cite', 'q', 'label',
      // 块级：callout/toggle/图注（md 无语法）+ 野文件常见块（script/iframe/style/媒体/布局容器——非合规
      // 文档基础编辑保存时同样过这条链路，必须保真、不能静默丢）
      'div', 'details', 'figure', 'script', 'style', 'iframe', 'video', 'audio', 'canvas', 'svg', 'object', 'embed',
      'form', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'button', 'select', 'textarea',
    ];
    const islandHandlers = {};
    for (const t of ISLAND_TAGS) islandHandlers[t] = rawIsland;
    // 表格：合规表（矩形、无合并格）走 GFM 管道表；带 colspan/rowspan 的野表 GFM 表达不了 → 整表 HTML 岛保真。
    islandHandlers.table = (state, node) => {
      let merged = false;
      walk(node, (n) => {
        if (isEl(n) && (n.tagName === 'td' || n.tagName === 'th') && n.properties
          && (n.properties.colSpan != null || n.properties.rowSpan != null)) merged = true;
      });
      return merged ? rawIsland(state, node) : defaultHandlers.table(state, node);
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

// md 字符串 → 完整 HTML 文档字符串（校验器 validateHead / loadFromHtml 都吃完整文档）。
// title = 文件名去扩展名（调用方传）；head 形态对齐 app 合规文档惯例（charset + schema meta + title）。
async function mdToHtml(md, opts) {
  const { md2html } = await loadEngine();
  const body = String(await md2html.process(String(md == null ? '' : md)));
  const title = escapeHtml((opts && opts.title) || '未命名');
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="wordspace-schema" content="1">\n<title>'
    + title + '</title>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
}

// 完整 HTML 文档字符串（编辑器序列化产物）→ md 字符串。只转 body；head 丢弃（载入时再生）。
async function htmlToMd(html) {
  const { html2md } = await loadEngine();
  return String(await html2md.process(String(html == null ? '' : html)));
}

const isMdPath = (p) => typeof p === 'string' && /\.md$/i.test(p);

module.exports = { mdToHtml, htmlToMd, isMdPath };
