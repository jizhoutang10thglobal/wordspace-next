// ============================================================================
// Wordspace Schema #1 — 确定性校验器（演示用，框架无关纯逻辑）
// ----------------------------------------------------------------------------
// 这是「校验器 = 脊梁」架构在 ui-demo 里的确定性 stand-in：输入任意 HTML 字符串 →
// 输出「是否符合 Schema #1 + 哪里不符合」。规则照 docs/schema-1-draft-v0.md（§0 决策冻结、
// §2 块表、§3 行内、§4 骨架）的可机判子集；真 app 的 src/lib/schema-validate.js (U4) 是
// 各自实现、规则对齐。纯函数、无 React、用浏览器原生 DOMParser，可被两个演示共用：
//   ① 非合规基础编辑（BasicEditor）的「为什么降级」违规清单；② Schema 可视化页的实时校验 widget。
//
// 立场（schema 草案 §4.3 三铁律的演示体现）：判的是「磁盘字节」reparse 出的 DOM，不信文件里
// 的 <meta wordspace-schema> 自称，不跑文档 JS。conform = 没有 block 级违规（warn 不破坏合规）。
// ============================================================================

export type Severity = 'block' | 'warn'

export interface Violation {
  rule: string // 短码，如 'no-script'
  severity: Severity
  title: string // 一句话标题（中文）
  detail: string // 为什么不符合 + 对应 schema 条款
  count: number // 命中次数（聚合，避免刷屏）
  sample?: string // 一个犯规片段（截断）
}

export interface SchemaResult {
  conform: boolean
  violations: Violation[] // block 在前、warn 在后
}

// ---- 允许集合（Schema #1，照草案 §2/§3）---------------------------------------
// 块级 / 结构允许标签（body 内）。
const ALLOWED_BLOCK = new Set([
  'p', 'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'div', // 仅作 callout 容器 class="ws-callout"，其它裸 div 视为退化结构（单独判）
  'details', 'summary',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img',
  'pre', 'code',
])
// 行内允许标签（§3）。
const ALLOWED_INLINE = new Set(['b', 'i', 'u', 's', 'a', 'code', 'mark', 'br', 'span', 'strong', 'em'])
// 块上不该出现的 style 属性所在的「块级」标签。
const BLOCK_TAGS_NO_STYLE = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'table', 'tr', 'th', 'td', 'div', 'section', 'article',
])
// body 直接子里若是这些「布局容器」且内部还套块 → 退化结构（非扁平挂块，草案 S10）。
const LAYOUT_CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside'])

const truncate = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

export function checkSchema(html: string): SchemaResult {
  const acc = new Map<string, Violation>()
  const bump = (rule: string, severity: Severity, title: string, detail: string, sampleEl?: Element) => {
    const ex = acc.get(rule)
    if (ex) {
      ex.count += 1
      return
    }
    acc.set(rule, {
      rule,
      severity,
      title,
      detail,
      count: 1,
      sample: sampleEl ? truncate(sampleEl.outerHTML) : undefined,
    })
  }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return { conform: false, violations: [{ rule: 'parse', severity: 'block', title: '无法解析为 HTML', detail: '输入不是可解析的 HTML 文档。', count: 1 }] }
  }

  const all = Array.from(doc.querySelectorAll('*'))
  for (const el of all) {
    const tag = el.tagName.toLowerCase()

    // 1) 脚本 / 嵌入 / 外链样式 / base —— 草案 §4.1 head 禁止项 + 「不跑文档 JS」
    if (tag === 'script') bump('no-script', 'block', '含 <script> 脚本', 'Schema 文档不跑文档 JS（iframe 无 allow-scripts），任何 <script> 都不符合。', el)
    if (tag === 'iframe' || tag === 'object' || tag === 'embed')
      bump('no-embed', 'block', `含 <${tag}> 嵌入`, '受限范式不允许 iframe/object/embed 这类活嵌入元素。', el)
    if (tag === 'base') bump('no-base', 'block', '含 <base>', '骨架禁止 <base>（会改写所有相对链接的解析）。', el)
    if (tag === 'link' && (el.getAttribute('rel') || '').toLowerCase().includes('stylesheet'))
      bump('no-external-css', 'block', '含外链样式表 <link>', '装饰样式属于 Template，不进 Schema 文档；外链 CSS 不允许。', el)

    // 2) 作者排版 <style> —— 只允许编辑器托管的语义 CSS（data-ws-schema-css），其余装饰样式不符合（§0/§4.1）
    if (tag === 'style' && !el.hasAttribute('data-ws-schema-css'))
      bump('author-style', 'block', '含作者排版 <style>', '显示按 .html 原生、装饰=Template；除编辑器托管的语义 CSS（data-ws-schema-css）外，作者 <style> 不在 Schema 内。', el)

    // 3) 表单元素 —— 不在块集合（Notion Basic blocks 去掉表单）
    if (tag === 'form' || tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea')
      bump('no-form', 'block', '含表单元素', '<form>/<input>/<button> 等表单控件不在 Schema #1 的块集合里。', el)

    // 4) heading 封顶 h4（§0 决策 5：h5/h6 = 不符合）
    if (tag === 'h5' || tag === 'h6')
      bump('heading-max-h4', 'block', `含 <${tag}> 标题`, 'Heading 封顶 h4；h5/h6 不符合 Schema（不静默压成 h4，走基础编辑）。', el)

    // 5) 行内 style 属性 / 绝对定位（§2.1 块上无 style；原则 3 绝不绝对定位）
    const style = el.getAttribute('style')
    if (style) {
      if (/position\s*:\s*(absolute|fixed)/i.test(style))
        bump('no-positioning', 'block', '用了绝对定位', '所有块留在文档流、能 reflow；绝不写 position:absolute/fixed。', el)
      if (BLOCK_TAGS_NO_STYLE.has(tag))
        bump('block-inline-style', 'block', '块上写了 style 属性', '块级元素不写 style（颜色等走固定 class 调色板 + data-ws-schema-css）；内联 style 不符合。', el)
    }

    // 6) on* 事件处理器 —— 不跑文档 JS
    for (const at of Array.from(el.attributes)) {
      if (/^on/i.test(at.name)) {
        bump('no-inline-handler', 'block', '含 on* 事件处理器', '不跑文档 JS：on click/onload 等内联事件属性不允许。', el)
        break
      }
    }

    // 7) 表格：禁合并格（§0 决策 6）+ 不嵌套表 + 单元格 phrasing-only
    if (tag === 'th' || tag === 'td') {
      if (el.hasAttribute('colspan') || el.hasAttribute('rowspan'))
        bump('no-merged-cells', 'block', '表格有合并单元格', '禁 colspan/rowspan（像 Notion，保持矩形表）。', el)
      if (el.querySelector('table'))
        bump('no-nested-table', 'block', '表格里嵌套了表格', '单元格不可嵌块/表，更不能嵌套表格。', el)
      if (el.querySelector('p,ul,ol,blockquote,div,h1,h2,h3,h4,table'))
        bump('cell-block-content', 'block', '单元格里塞了块级内容', '表格单元格 = phrasing-only（纯文字 + 行内标记）。', el)
    }

    // 8) ul/ol 直接子只能是 li（§2 不变式 I2）
    if (tag === 'ul' || tag === 'ol') {
      const bad = Array.from(el.children).find((c) => c.tagName.toLowerCase() !== 'li')
      if (bad) bump('list-direct-li', 'block', '列表直接子不是 <li>', 'ul/ol 的直接子只能是 <li>；裸文本/其它标签直挂列表不符合。', bad)
    }

    // 9) 行内里裹了块级 —— 透明 <a>/<span> 包块级（§3 硬约束 + 草案 S1）
    if (tag === 'a' || tag === 'span') {
      if (el.querySelector('p,h1,h2,h3,h4,ul,ol,blockquote,div,table'))
        bump('inline-wraps-block', 'block', '行内元素包了块级内容', '行内标记里不能放块级元素（如 <a> 包 <h2>）。', el)
    }
  }

  // 10) body 顶层应扁平挂块：直接子里出现「布局容器且内部还套块」= 退化结构（草案 S10，非扁平）
  const body = doc.body
  if (body) {
    for (const child of Array.from(body.children)) {
      const tag = child.tagName.toLowerCase()
      if (LAYOUT_CONTAINERS.has(tag) && !child.classList.contains('ws-callout')) {
        const nestsBlock = child.querySelector('p,h1,h2,h3,h4,ul,ol,blockquote,table,div,section')
        if (nestsBlock) {
          bump('degenerate-structure', 'block', 'body 不是扁平挂块', `顶层用 <${tag}> 等布局容器包了多层结构（canonical = 扁平直接挂块、blockRoot 唯一）；多容器嵌套不符合。`, child)
          break
        }
      }
    }
  }

  // 11) 缺 wordspace-schema marker —— 仅 warn（marker 是提示、非权威；缺它不破坏合规）
  if (!doc.querySelector('meta[name="wordspace-schema"]'))
    bump('no-marker', 'warn', '缺 wordspace-schema 标记', 'marker 只是快速线索（非权威）。手写的合法文档也可以没有它，不影响合规判定。')

  const violations = Array.from(acc.values()).sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1,
  )
  const conform = violations.every((v) => v.severity !== 'block')
  return { conform, violations }
}
