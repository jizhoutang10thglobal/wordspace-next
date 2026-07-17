// i18n 调用点 key 存在性门（第三道门，补 scan/parity 够不着的失效模式）。
// scan 只查「硬编码中文」，parity 只比「zh vs en 的 key 集」——两者都不会发现
// **调用点把 key 打错**：`t('templates.saveTheme')`（真 key 是 saveThemeHint）能过编译
// （TFunc 签名是 key: string）、过 scan（不是中文）、过 parity（不比调用点），然后
// makeT 找不到 key → 把裸 'templates.saveTheme' 显示给用户。这道门就守这个。
//
// 做法：TS AST 找所有 t()/tt()/tImperative()/coreT() 调用，第一个实参是字符串字面量、
// 且长得像 `ns.key` 的，检查它在合并后的 zh 字典里存在。不存在 = 报红（阻断）。
// 第一个实参不是字面量（动态 key，如 t(item.label)）→ 静态查不了，列出来供人工核（不阻断）。
//
// 变异自检：把任一 t('x.y') 改成不存在的 key → 必报红；改回 → 绿。
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const ZH = join(SRC, 'i18n', 'zh')

const CALLEES = new Set(['t', 'tt', 'tImperative', 'coreT'])
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9_]+$/

// 合并后 zh 已知 key 集（ns 前缀 + 文件顶层 key）。复用 i18n-parity 的顶层 key 读法（含 getter）。
function keysOf(file, ns) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const keys = new Set()
  const visit = (node) => {
    if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
      for (const p of node.expression.properties) {
        if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name)
          keys.add(ns + '.' + (ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf)))
        if (ts.isGetAccessorDeclaration(p) && p.name) keys.add(ns + '.' + p.name.getText(sf))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return keys
}

const known = new Set()
for (const f of readdirSync(ZH).filter((n) => n.endsWith('.ts')))
  for (const k of keysOf(join(ZH, f), f.replace(/\.ts$/, ''))) known.add(k)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (relative(SRC, p).split('\\').join('/') === 'i18n') continue // 字典本体不算调用点
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const missing = []
const dynamic = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/')
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CALLEES.has(node.expression.text) && node.arguments.length) {
      const arg0 = node.arguments[0]
      const { line } = sf.getLineAndCharacterOfPosition(arg0.getStart(sf))
      if (ts.isStringLiteral(arg0) || (ts.isNoSubstitutionTemplateLiteral && ts.isNoSubstitutionTemplateLiteral(arg0))) {
        const key = arg0.text
        if (KEY_SHAPE.test(key) && !known.has(key)) missing.push(`${rel}:${line + 1}  ${key}`)
      } else if (!ts.isStringLiteral(arg0)) {
        // 动态 key（变量 / 模板串 / 成员访问）——静态查不了
        dynamic.push(`${rel}:${line + 1}  ${arg0.getText(sf).slice(0, 50)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (missing.length) {
  console.error(`✗ i18n-usage: ${missing.length} 处调用了字典里不存在的 key（会把裸 key 名显示给用户，阻断）：`)
  for (const m of missing) console.error('  ' + m)
  console.error('')
}
if (dynamic.length)
  console.log(`ℹ i18n-usage: ${dynamic.length} 处动态 key（静态查不了，键值存在数据结构里，改数据表时自查）`)

if (missing.length) process.exit(1)
console.log(`✓ i18n-usage: 所有静态 t()/tt() 调用的 key 都存在于字典`)
