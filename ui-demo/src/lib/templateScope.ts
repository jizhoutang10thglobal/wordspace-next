// ============================================================================
// 用户自定义模板 — CSS 作用域化（演示用，框架无关纯逻辑）
// ----------------------------------------------------------------------------
// Canvas 是共享 DOM（不是 iframe），文档区和 app 界面在同一棵树里。模板 CSS 必须强制
// 作用域，否则会漏到侧栏/工具条。做法 = 原生 CSS nesting：把整包 CSS 塞进
//   `.ws-doc.ws-tpl-on { <模板 CSS> }`
// 选择器天然相对化（`p{…}` → `.ws-doc.ws-tpl-on p`）。@media/@supports 是条件组规则、
// 可留在嵌套里；但 @font-face 与 @keyframes 不能嵌套（前者本就全局，后者嵌套会被解析器
// 整条丢弃——动效是设计语言一等公民），必须提到顶层。
//
// demo 级：brace-depth-0 扫描提取。生产级作用域方案移植时另定（origin 已 defer）。
// ============================================================================

export const TPL_SCOPE = '.ws-doc.ws-tpl-on'

// 提取顶层 @font-face / @keyframes（含 -webkit- 前缀）块到 hoisted，其余进 body。
// 只在 brace-depth 0 识别 at-rule（嵌在 @media 里的不误提）。
function splitHoisted(css: string): { hoisted: string[]; body: string } {
  const hoisted: string[] = []
  let body = ''
  let i = 0
  let depth = 0
  const n = css.length
  const HOIST = /^@(?:-webkit-)?(?:font-face|keyframes)\b/i

  while (i < n) {
    const ch = css[i]
    if (depth === 0 && ch === '@' && HOIST.test(css.slice(i, i + 24))) {
      const braceStart = css.indexOf('{', i)
      if (braceStart === -1) break // 残缺，丢弃尾巴
      let d = 0
      let j = braceStart
      for (; j < n; j++) {
        if (css[j] === '{') d++
        else if (css[j] === '}') {
          d--
          if (d === 0) {
            j++
            break
          }
        }
      }
      hoisted.push(css.slice(i, j).trim())
      i = j
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    body += ch
    i++
  }
  return { hoisted, body }
}

/**
 * 把模板 CSS 作用域化：@font-face/@keyframes 提到顶层，其余包进 `.ws-doc.ws-tpl-on { … }`。
 * 传入应是已过 templateCheck 的 CSS。空/纯空白 → 空串。
 */
export function scopeTemplateCss(css: string, scope: string = TPL_SCOPE): string {
  if (!css || !css.trim()) return ''
  const { hoisted, body } = splitHoisted(css)
  const wrapped = body.trim() ? `${scope} {\n${body.trim()}\n}` : ''
  return [...hoisted, wrapped].filter(Boolean).join('\n\n')
}
