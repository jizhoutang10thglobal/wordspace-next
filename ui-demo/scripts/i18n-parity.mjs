// 字典中英一致性检查（配合 i18n-scan.mjs 的第二道门）。
// AST 解析每个命名空间的 zh/en 字典，比对 key：
//   - zh 有、en 无 → **en 缺翻译**（警告，不阻断：运行时 fallback 到 zh，界面能用；但该补，PR 列出来）。
//   - en 有、zh 无 → **en 多余 key**（阻断：zh 是源语言，en 冒出 zh 没有的 key = 拼错/死键，会永远取不到）。
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const I18N = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'i18n')

// 取一个字典文件 `export default { a: '..', b: '..' }` 的顶层 key。
function keysOf(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const keys = new Set()
  const visit = (node) => {
    if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
      for (const p of node.expression.properties) {
        if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) {
          keys.add(ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf))
        }
        if (ts.isGetAccessorDeclaration(p) && p.name) keys.add(p.name.getText(sf)) // getter（types 的响应式标签）
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return keys
}

const namespaces = readdirSync(join(I18N, 'zh')).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, ''))
let missing = 0
let extra = 0
const missingList = []
const extraList = []

for (const ns of namespaces) {
  const zh = keysOf(join(I18N, 'zh', ns + '.ts'))
  const en = keysOf(join(I18N, 'en', ns + '.ts'))
  for (const k of zh) if (!en.has(k)) { missing++; missingList.push(`${ns}.${k}`) }
  for (const k of en) if (!zh.has(k)) { extra++; extraList.push(`${ns}.${k}`) }
}

if (missing) console.warn(`⚠ en 缺 ${missing} 个翻译（fallback 到中文，不阻断；建议补齐）：\n  ${missingList.join('\n  ')}\n`)
if (extra) console.error(`✗ en 有 ${extra} 个 zh 没有的多余 key（拼错/死键，阻断）：\n  ${extraList.join('\n  ')}\n`)

if (extra) process.exit(1)
console.log(`✓ i18n-parity: zh/en key 对齐${missing ? `（en 缺 ${missing} 个，走 fallback）` : ''}`)
