// ============================================================================
// 用户自定义模板 — CSS 安全门（演示用，框架无关纯逻辑）
// ----------------------------------------------------------------------------
// 模板是用户可控输入（存为 / 导入 / AI 生成 / 公共池）。这道门是「一切进入 Doc 或
// 模板库的 CSS 都先过它」的唯一守卫。形状对齐 lib/schemaCheck.ts：纯函数、无 React、
// 输出人话违规清单，可被 UI 与 node 门脚本（scripts/test-template-gate.mjs）双消费。
//
// ⚠ demo 级：用正则 + 剥注释的受限解析。生产级需真 CSS 解析（防 `\75 rl(`、`url(/**/…)`
//   这类转义/注释绕过）——记在 docs/features/user-template.md 欠账区，真 app 移植时做。
//
// fail-closed：命中任一 block 违规 → ok:false，调用方整份拒绝、不做「部分应用」。
// ============================================================================

export interface TemplateViolation {
  rule: string // 短码，如 'no-external-url'
  msg: string // 一句话人话原因（中文）
  sample?: string // 一个犯规片段（截断）
}

export interface TemplateCheckResult {
  ok: boolean // 没有 block 违规
  violations: TemplateViolation[]
  bytes: number // CSS 字节数（UTF-8）
  overSoftBudget: boolean // 超软预算（可存但给提示）
}

export interface TemplateCheckOpts {
  softBytes?: number
  hardBytes?: number
}

// demo 值：按 localStorage 现实缩放（zustand persist 把 docs+templates 全量写单源 localStorage，
// 配额 ~5MB）。真 app 磁盘语义原值是软 5MB / 硬 20MB（记 spec 欠账）。测试注入小预算跑边界。
export const DEMO_SOFT_BYTES = 256 * 1024
export const DEMO_HARD_BYTES = 1024 * 1024

// 作用域化后允许提到顶层的 at-rule（templateScope 提 @font-face/@keyframes；条件组规则可留嵌套）。
// 其余未知顶层 at-rule（@page/@charset/@namespace/@document…）一律拒——白名单外即非法。
const ALLOWED_AT_RULES = new Set(['font-face', 'keyframes', 'media', 'supports', '-webkit-keyframes'])

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length
const truncate = (s: string, n = 80) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

// 剥 /* … */ 注释（最基础的绕过面；真 CSS 解析在生产门做）。
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, ' ')

export function templateCheck(rawCss: string, opts: TemplateCheckOpts = {}): TemplateCheckResult {
  const softBytes = opts.softBytes ?? DEMO_SOFT_BYTES
  const hardBytes = opts.hardBytes ?? DEMO_HARD_BYTES
  const bytes = utf8Bytes(rawCss)

  const acc = new Map<string, TemplateViolation>()
  const bump = (rule: string, msg: string, sample?: string) => {
    if (acc.has(rule)) return
    acc.set(rule, { rule, msg, sample: sample ? truncate(sample) : undefined })
  }

  const css = stripComments(rawCss)

  // 1) 外链 / 危险 url() —— 只放行零外呼的内嵌 data:font/* 与 data:image/*（拒 svg，SVG 能内嵌脚本/外链）。
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    const val = (m[2] || '').trim().toLowerCase()
    const okFont = val.startsWith('data:font/')
    const okImage = val.startsWith('data:image/') && !val.startsWith('data:image/svg')
    if (!okFont && !okImage) {
      bump('no-external-url', '模板 CSS 只允许内嵌资源 url(data:font/*) / url(data:image/*)（拒 svg），禁外链请求（追踪信标 / 外部依赖）。', m[0])
    }
  }

  // 2) @import —— 外部样式表拉取，禁。
  if (/@import\b/i.test(css)) bump('no-import', '禁 @import（会拉取外部样式表，是外链通道）。', '@import')

  // 3) 老式执行向量 —— IE expression() / Firefox -moz-binding。
  if (/\bexpression\s*\(/i.test(css)) bump('no-expression', '禁 CSS expression()（旧 IE 里可执行 JS）。', 'expression(')
  if (/-moz-binding\b/i.test(css)) bump('no-binding', '禁 -moz-binding（可绑定可执行 XBL/XML）。', '-moz-binding')
  // behavior: 是 IE 的 HTC 行为绑定；但 scroll-behavior / overscroll-behavior 合法，前有连字符/字母的排除。
  if (/(?<![-\w])behavior\s*:/i.test(css)) bump('no-behavior', '禁 behavior: 属性（IE HTC 行为绑定，可执行）。', 'behavior:')

  // 4) 覆盖劫持 —— 共享 DOM 下绝对/固定/粘性定位能把「只该上色」的样式变成盖住 app chrome 的覆盖层。
  if (/position\s*:\s*(fixed|sticky|absolute)/i.test(css))
    bump('no-positioning', '禁 position:fixed/sticky/absolute（文档区与 app 界面同一 DOM，绝对定位能盖住界面 / 点击劫持）。', 'position:absolute')

  // 5) 层叠纪律 —— !important 会压过用户行内手调（换装后「手动标红仍是红」的不变式靠禁它成立）。
  if (/!\s*important\b/i.test(css)) bump('no-important', '禁 !important（会覆盖用户的行内手调，破坏「换装保留手调」）。', '!important')

  // 6) 视觉完整性（最简版）—— 禁隐藏正文内容（藏 / 伪造合同条款一类）。content 注入 / 同色检测需真解析，随生产门。
  if (/display\s*:\s*none\b/i.test(css)) bump('no-hide-content', '禁 display:none（模板不得隐藏正文内容——藏条款一类的视觉欺骗）。', 'display:none')
  if (/visibility\s*:\s*hidden\b/i.test(css)) bump('no-hide-content', '禁 visibility:hidden（模板不得隐藏正文内容）。', 'visibility:hidden')

  // 7) at-rule 白名单 —— 未知顶层 at-rule 一律拒（作用域化只认得住 font-face/keyframes/条件组）。
  for (const m of css.matchAll(/@([a-z-]+)\b/gi)) {
    const name = (m[1] || '').toLowerCase()
    if (name === 'import') continue // 已由 no-import 专项报
    if (!ALLOWED_AT_RULES.has(name)) bump('bad-at-rule', `禁 @${name}（模板只允许 @font-face / @keyframes / @media / @supports）。`, m[0])
  }

  // 8) 体积预算 —— 硬上限拒，软上限标记（可存但提示）。
  const overSoftBudget = bytes > softBytes
  if (bytes > hardBytes)
    bump('over-budget', `模板体积 ${(bytes / 1024).toFixed(0)}KB 超过上限 ${(hardBytes / 1024).toFixed(0)}KB（demo 受 localStorage 配额约束）。`)

  const violations = Array.from(acc.values())
  return { ok: violations.length === 0, violations, bytes, overSoftBudget }
}
