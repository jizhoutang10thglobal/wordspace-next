// 用户自定义模板 — CSS 安全门 + 作用域化的门测试（对抗审查定的验证门）。
// 跑法：node scripts/test-template-gate.mjs（自动 esbuild 转译 TS）。
// 变异自检纪律：先 commit 再变异；注释掉 templateCheck 里任一规则 → 本脚本必须翻红。
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'tpl-gate-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `export { templateCheck } from ${JSON.stringify(new URL('../src/lib/templateCheck.ts', import.meta.url).pathname)}
export { scopeTemplateCss, TPL_SCOPE } from ${JSON.stringify(new URL('../src/lib/templateScope.ts', import.meta.url).pathname)}
export { CSS_PROPOSAL_FORMAL, CSS_MINUTES } from ${JSON.stringify(new URL('../src/lib/builtinTemplateCss.ts', import.meta.url).pathname)}
`,
)
const out = join(dir, 'bundle.mjs')
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: out, platform: 'node' })
const { templateCheck, scopeTemplateCss, TPL_SCOPE, CSS_PROPOSAL_FORMAL, CSS_MINUTES } = await import(pathToFileURL(out))

let fail = 0
const rulesOf = (css, opts) => templateCheck(css, opts).violations.map((v) => v.rule).sort()
// 断言这段 CSS 恰好触发 rule（且没别的意外规则）
const rejects = (css, rule, msg, opts) => {
  const r = templateCheck(css, opts)
  if (r.ok) { fail++; console.log(`FAIL ${msg}: 应拒但过了 — ${css}`) }
  else if (!r.violations.some((v) => v.rule === rule)) { fail++; console.log(`FAIL ${msg}: 拒了但不是 ${rule}，是 [${rulesOf(css, opts)}]`) }
}
const passes = (css, msg, opts) => {
  const r = templateCheck(css, opts)
  if (!r.ok) { fail++; console.log(`FAIL ${msg}: 应过但拒了 — [${r.violations.map((v) => v.rule + ':' + v.msg).join(' | ')}]`) }
}
const eq = (a, b, msg) => { if (a !== b) { fail++; console.log(`FAIL ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`) } }
const truthy = (a, msg) => { if (!a) { fail++; console.log(`FAIL ${msg}`) } }

// ---- 外链 / url() ----
rejects('h1 { background: url(http://evil.com/beacon.png) }', 'no-external-url', '外链 http url()')
rejects('h1 { background: url(https://cdn.example.com/x.png) }', 'no-external-url', '外链 https url()')
passes('@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) }', '内嵌 data:font 放行')
passes('h1 { background-image: url(data:image/png;base64,AAAA) }', '内嵌 data:image/png 放行')
rejects('h1 { background: url(data:image/svg+xml;base64,AAAA) }', 'no-external-url', 'data:image/svg 拒（能内嵌脚本）')

// ---- 执行 / 外部拉取向量 ----
rejects('@import url(x.css); h1 { color: red }', 'no-import', '@import 拒')
rejects('h1 { width: expression(alert(1)) }', 'no-expression', 'expression() 拒')
rejects('h1 { -moz-binding: url(x.xml) }', 'no-binding', '-moz-binding 拒')
rejects('h1 { behavior: url(x.htc) }', 'no-behavior', 'behavior: 拒')
passes('html { scroll-behavior: smooth } .ws-callout { overscroll-behavior: contain }', 'scroll-behavior/overscroll-behavior 放行（非 IE behavior）')

// ---- 覆盖劫持 ----
rejects('h1 { position: absolute }', 'no-positioning', 'position:absolute 拒')
rejects('h1 { position: fixed }', 'no-positioning', 'position:fixed 拒')
rejects('h1 { position: sticky }', 'no-positioning', 'position:sticky 拒')
passes('h1 { position: relative }', 'position:relative 放行')

// ---- 层叠纪律 ----
rejects('p { color: blue !important }', 'no-important', '!important 拒（会覆盖手调）')

// ---- 视觉完整性（最简） ----
rejects('p { display: none }', 'no-hide-content', 'display:none 拒（藏正文）')
rejects('p { visibility: hidden }', 'no-hide-content', 'visibility:hidden 拒')

// ---- at-rule 白名单 ----
rejects('@page { margin: 0 }', 'bad-at-rule', '@page 拒（分页是 Schema 事、不归模板）')
passes('@media (max-width: 600px) { h1 { font-size: 1.2em } }', '@media 放行')
passes('@supports (display: grid) { .ws-callout { display: grid } }', '@supports 放行')
passes('@keyframes fade { from { opacity: 0 } to { opacity: 1 } }', '@keyframes 放行')

// ---- 体积预算（注入小预算跑边界）----
const big = 'h1 { color: red }\n'.repeat(1200) // ~22KB
rejects(big, 'over-budget', '超硬预算拒', { softBytes: 1024, hardBytes: 8 * 1024 })
truthy(templateCheck(big, { softBytes: 1024, hardBytes: 999999 }).overSoftBudget, '超软预算标记 overSoftBudget')
truthy(!templateCheck('h1{color:red}', { softBytes: 1024, hardBytes: 999999 }).overSoftBudget, '小 CSS 不超软预算')

// ---- 注释绕过（demo 门剥注释）----
rejects('h1 { background: url(/* x */http://evil.com/y) }', 'no-external-url', '注释夹在 url() 里也剥掉后抓')

// ---- AE8：黄金标书模板整份通过 ----
passes(CSS_PROPOSAL_FORMAL, 'AE8 黄金标书模板过门（内嵌 data:font + data:image）')
passes(CSS_MINUTES, '会议纪要主题过门')

// ---- 作用域化：包裹 + @font-face/@keyframes 提层 ----
{
  const scoped = scopeTemplateCss('h1 { color: red }\n@font-face { font-family: X; src: url(data:font/woff2;base64,AA) }\n@keyframes k { from { opacity: 0 } }')
  truthy(scoped.includes(TPL_SCOPE + ' {'), 'scope: 普通规则被包进 .ws-doc.ws-tpl-on')
  truthy(scoped.startsWith('@font-face') || scoped.includes('\n@font-face'), 'scope: @font-face 提到顶层')
  truthy(/@keyframes k/.test(scoped) && scoped.indexOf('@keyframes') < scoped.indexOf(TPL_SCOPE + ' {'), 'scope: @keyframes 在 wrapped 块之前（顶层）')
  // 包裹后不应有裸的顶层 h1（除 hoisted at-rule 外，body 都在 scope 里）
  const afterWrap = scoped.slice(scoped.indexOf(TPL_SCOPE))
  truthy(afterWrap.includes('h1'), 'scope: h1 在 wrapped 块内')
  eq(scopeTemplateCss('   '), '', 'scope: 空 CSS → 空串')
}
// @media 留在嵌套里（不误提层）
{
  const scoped = scopeTemplateCss('@media (max-width: 600px) { h1 { color: red } }')
  truthy(scoped.startsWith(TPL_SCOPE + ' {'), 'scope: @media 留在 wrapped 块内（原生 nesting 合法）')
}

console.log(fail === 0 ? 'template gate test: ALL PASS' : `template gate test: ${fail} FAILURES`)
process.exit(fail ? 1 : 0)
