// 互链路径代数的 property 测试（对抗审查定的门）：resolveHref(from, relHref(from, to)) === to
// 对任意合法文件名成立——含 URL 特殊字符（: % # ?）。跑法：node scripts/test-links.mjs（自动 esbuild 转译）。
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'links-test-'))
const out = join(dir, 'links.mjs')
await build({ entryPoints: [new URL('../src/lib/links.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'neutral' })
const { resolveHref, relHref, splitHrefSuffix, normalizePath } = await import(pathToFileURL(out))

let fail = 0
const eq = (a, b, msg) => { if (a !== b) { fail++; console.log(`FAIL ${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`) } }

// 往返对称——含刁钻文件名（冒号撞 scheme、% 撞转义、#? 撞 URL 分隔符）
const froms = ['a.html', 'docs/a.html', 'a/bc/x.html', '深/层/子/目录/x.html']
const tos = ['b.html', 'docs/spec.html', 'a/b/y.html', 'a/bc/z.html', 'draft:v2.html', '规格/涨幅100%.html', 'C# 笔记.html', '去哪?.html', '子目录/100%完成#终版?.html', '深/层/别处/y.md']
for (const f of froms) for (const t of tos) eq(resolveHref(f, relHref(f, t)), t, `roundtrip ${f} → ${t} (href=${relHref(f, t)})`)
// 段边界：'a/bc' 不是 'a/b' 的前缀（逐段比较，不是逐字符）
eq(relHref('a/bc/x.html', 'a/b/y.html'), '../b/y.html', 'seg boundary 1')
eq(relHref('a/b/x.html', 'a/bc/y.html'), '../bc/y.html', 'seg boundary 2')
// 尾缀拆分（写端已转义文件名内 #?，裸 #? 必是真分隔符）
eq(JSON.stringify(splitHrefSuffix('a.html#sec')), '["a.html","#sec"]', 'suffix #')
eq(JSON.stringify(splitHrefSuffix('a.html?q=1#x')), '["a.html","?q=1#x"]', 'suffix ?#')
eq(resolveHref('docs/a.html', 'spec.html#chapter-2'), 'docs/spec.html', 'resolve ignores #')
// 边界拒绝
eq(resolveHref('a.html', '../escape.html'), null, 'escape root')
eq(resolveHref('a.html', 'https://x.com'), null, 'http')
eq(resolveHref('a.html', '#sec'), null, 'pure anchor')
eq(resolveHref('a.html', 'mailto:x@y.com'), null, 'mailto')
if (!relHref('a.html', 'draft:v2.html').startsWith('./')) { fail++; console.log('FAIL ./ 消歧') }
eq(normalizePath('a/./b/../c.html'), 'a/c.html', 'normalize')

console.log(fail === 0 ? `links property test: ALL PASS (${froms.length * tos.length + 10})` : `links property test: ${fail} FAILURES`)
process.exit(fail ? 1 : 0)
