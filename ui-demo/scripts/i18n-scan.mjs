// CJK 硬编码扫描门（i18n 防漂移的核心）。
// 用 TS AST（不是裸 grep）只报「用户可见文案」节点里的中日韩字符：字符串字面量 / 模板串 / JSX 文本 /
// JSX 属性字符串。**代码注释天然不进 AST → 仓库的中文注释惯例不受影响**（这正是必须用 AST 的原因）。
//
// 报红 = 门失败（有没提取的硬编码中文）。豁免两条：① 文件级白名单（mock/演示数据、字典本体）；
// ② 行内 `i18n-exempt` 注释（那一行的节点跳过——给「确实不该翻」的个别常量）。
//
// 变异自检：往任一组件塞一句硬编码中文 → 必报红；往白名单文件塞 → 不报（不误伤）。
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')

// CJK：汉字（含扩展A）+ 中日韩标点 + 全角标点。捕获纯标点串（如「，。！」）也算。
const CJK = /[㐀-鿿　-〿！-｠￠-￮]/

// 文件级白名单（相对 ui-demo/src）——mock/演示数据 + 字典本体，它们含中文是本分。
// 改这里要在 PR 说明为什么某文件豁免（别把真该翻的 chrome 藏进白名单）。
const FILE_WHITELIST = [
  'i18n/',                       // 字典本体
  'mock/seed.ts',                // 种子文档/成员演示数据
  'mock/pagedSamples.ts',        // 分页样例内容
  'lib/nonConformSamples.ts',    // 非合规文档样例
  'components/MockSites.tsx',    // 内置假网站的网页内容
]

function isWhitelisted(relPath) {
  return FILE_WHITELIST.some((w) => (w.endsWith('/') ? relPath.startsWith(w) : relPath === w))
}

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkFiles(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const violations = []

for (const file of walkFiles(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/')
  if (isWhitelisted(rel)) continue
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = text.split('\n')

  const report = (node, raw) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    if ((lines[line] || '').includes('i18n-exempt')) return // 行内豁免
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 50)
    violations.push({ rel, line: line + 1, col: character + 1, snippet })
  }

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) report(node, node.text)
    } else if (ts.isJsxText(node)) {
      if (CJK.test(node.text)) report(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('')
      if (CJK.test(parts)) report(node, parts)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (violations.length === 0) {
  console.log('✓ i18n-scan: 0 处硬编码 CJK（UI 文案已全部提取）')
  process.exit(0)
}

violations.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)
console.error(`✗ i18n-scan: ${violations.length} 处硬编码 CJK 未提取（报红 = 门失败）\n`)
let curFile = ''
for (const v of violations) {
  if (v.rel !== curFile) {
    curFile = v.rel
    const n = violations.filter((x) => x.rel === curFile).length
    console.error(`  ${curFile}  (${n})`)
  }
  console.error(`    ${v.line}:${v.col}  ${v.snippet}`)
}
console.error(`\n提取到 src/i18n/<ns>/*.ts + 用 t()/useT() 替换；确不该翻的加 // i18n-exempt。`)
process.exit(1)
