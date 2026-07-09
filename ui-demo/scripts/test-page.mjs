// 块级分页 paginateBlocks 的边界用例自查（跟 test-links.mjs 同款：esbuild 转译后跑）。
// 跑法：node scripts/test-page.mjs
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'page-test-'))
const out = join(dir, 'page.mjs')
await build({ entryPoints: [new URL('../src/lib/page.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'neutral' })
const { paginateBlocks } = await import(pathToFileURL(out))

let fail = 0
const eq = (a, b, msg) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) { fail++; console.log(`FAIL ${msg}: ${sa} !== ${sb}`) }
}

const P = 800

// 空文档：1 页、整页留白
let r = paginateBlocks([], P, [])
eq([r.pageCount, r.lastFill, r.gapBefore, r.trailingGap], [1, P, [], null], 'empty doc')

// 全部装得下：不切页
r = paginateBlocks([100, 200, 300], P, [false, false, false])
eq([r.pageCount, r.pageOfBlock, r.gapBefore, r.lastFill], [1, [0, 0, 0], [null, null, null], 200], 'fits one page')

// 放不下整块推下页：gap = 上页剩余留白
r = paginateBlocks([500, 400], P)
eq([r.pageCount, r.pageOfBlock, r.gapBefore, r.lastFill], [2, [0, 1], [null, 300], 400], 'push whole block')

// 恰好填满一页：不切，下一块自然新页（gap = 0）
r = paginateBlocks([400, 400, 100], P)
eq([r.pageCount, r.pageOfBlock, r.gapBefore], [2, [0, 0, 1], [null, null, 0]], 'exact fill')

// 单块超页高：起点新页、跨 ceil(h/P) 页，下一块接着它结束处的当前页
r = paginateBlocks([100, 2000, 100], P)
eq([r.pageCount, r.pageOfBlock, r.gapBefore, r.pageStartBlocks], [4, [0, 1, 3], [null, 700, null], [0, 1, 1, 1]], 'oversized block spans pages')

// 显式分页符：其后强制结束当前页
r = paginateBlocks([100, 20, 100], P, [false, true, false])
eq([r.pageCount, r.pageOfBlock, r.gapBefore], [2, [0, 0, 1], [null, null, 680]], 'explicit break')

// 分页符在页首（第一块就是分页符）
r = paginateBlocks([20, 100], P, [true, false])
eq([r.pageCount, r.pageOfBlock, r.gapBefore], [2, [0, 1], [null, 780]], 'break at page start')

// 分页符在页尾（末块）：带出一张空尾页
r = paginateBlocks([100, 20], P, [false, true])
eq([r.pageCount, r.trailingGap, r.lastFill, r.pageStartBlocks], [2, 680, P, [0, 2]], 'trailing break → empty page')

// 页高非法：防御性全落第 1 页
r = paginateBlocks([100, 200], 0)
eq([r.pageCount, r.pageOfBlock], [1, [0, 0]], 'invalid pageContentH')

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1) }
console.log('test-page: all passed')
