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
const { paginateBlocks, computeInnerSplits } = await import(pathToFileURL(out))

let fail = 0
const eq = (a, b, msg) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) { fail++; console.log(`FAIL ${msg}: ${sa} !== ${sb}`) }
}

const P = 800

// 空文档：1 页、整页留白
let r = paginateBlocks([], P)
eq([r.pageCount, r.lastFill, r.gapBefore], [1, P, []], 'empty doc')

// 全部装得下：不切页
r = paginateBlocks([100, 200, 300], P)
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

// 超高块给了块内切分点：每个切点占一页、块尾从最后切点起算（innerCutTops 第 3 参）
// 块 2000、切点 [600,1300] → 占 3 页（1,2,3），尾段 700 高，下一块接着第 3 页排
r = paginateBlocks([100, 2000, 100], P, [null, [600, 1300], null])
eq([r.pageCount, r.pageOfBlock, r.gapBefore], [4, [0, 1, 3], [null, 700, null]], 'oversized block with inner cuts → page numbering')

// 页高非法：防御性全落第 1 页
r = paginateBlocks([100, 200], 0)
eq([r.pageCount, r.pageOfBlock], [1, [0, 0]], 'invalid pageContentH')

// ---- computeInnerSplits：超高块沿块内边界切成多页 ----
// 每页取「最后一个还装得下的边界」（Word 语义）；atom=切分后代下标、top=其原始坐标、fill=切点上方剩余留白。

// 列表/表格式：块 2000 高，边界每 300px 一个 [0,300,600,900,1200,1500,1800]，P=800
// → 第 1 页装到 600（超 800 的 900 装不下）、第 2 页从 600 起装到 1200，共 2 切
let c = computeInnerSplits([0, 300, 600, 900, 1200, 1500, 1800], 2000, P)
eq(c, [{ atom: 2, top: 600, fill: 200 }, { atom: 4, top: 1200, fill: 200 }], 'inner: 均匀边界多切分')

// 边界恰落页界（每 100px）：块 1700、P=800 → 切在 800、1600
c = computeInnerSplits([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600], 1700, P)
eq([c.map((x) => x.top)], [[800, 1600]], 'inner: 边界恰落页界 fill=0')

// 不可切：唯一边界在块顶（top=0，不 >1），如单张超页高图 → 空（回退拉长纸面）
eq(computeInnerSplits([0], 2000, P), [], 'inner: 无可切边界 → 空')

// 首个可切边界已超一页（巨型首项）：第 1 页切不动 → 空，交回拉长兜底
eq(computeInnerSplits([0, 850, 1600], 2400, P), [], 'inner: 首边界超页 → 空')

// startOffset：块顶在起始页已用 200 → 首页只剩 600，边界含端点（<=）故切在 600（恰装满）
c = computeInnerSplits([0, 300, 600, 900], 1000, P, 200)
eq(c, [{ atom: 2, top: 600, fill: 0 }], 'inner: startOffset 缩短首页')

// 乱序输入自排序：[600,0,1200,300] 排成 [0,300,600,1200]，块 1400/P800 → 首页切在 600（1200 落第 2 页尾内）
eq(computeInnerSplits([600, 0, 1200, 300], 1400, P).map((x) => x.top), [600], 'inner: 乱序自排序')
// 页高非法防御 → 空
eq(computeInnerSplits([0, 300], 1000, 0), [], 'inner: 页高非法 → 空')

if (fail) { console.log(`\n${fail} failure(s)`); process.exit(1) }
console.log('test-page: all passed')
