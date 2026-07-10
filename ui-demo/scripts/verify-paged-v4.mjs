// 分页 V4「超高块带留白分页 + 编辑稳定」验证门（跑法：node scripts/verify-paged-v4.mjs <url>）。
// 写在实现之前（TDD）：Option A 状态下 margin 断言必须红——超高块页界处没有真实留白。
// 核心断言：
//  A) 每条块内页界（.ws-inner-gutter）上下必须是「内容真空带」：上方内容底 → 下方内容顶
//     的空隙 ≥ 页底边距+灰缝+页顶边距 − 容差（normal 边距 = 96+24+96 = 216px）。
//  B) 全部页界（块级+块内）纵向间距统一 ≈ paperH+GAP。
//  C) Colin 复现：点进被推挤元素([data-ws-pushed])正文，连按 5 次回车——推挤不得累积
//     （带大 paddingTop 的元素数 == 页界数）、空行高 < 60、A/B 仍全过。
//  D) 代码块同 C；表格：spacer 行数 == 表内页界数、持久化数据无 spacer/pushed 痕迹。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const MB = 96, MT = 96, GAP = 24 // normal 边距 25.4mm=96px + 灰缝
const VOID_MIN = MB + GAP + MT - 12 // 内容真空带下限（容差 12px：行距/边框）
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

await page.goto(URL)
await page.waitForTimeout(900)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForTimeout(1500)

const openDocPaged = async (name) => {
  await page.getByText(name, { exact: false }).first().click()
  await page.waitForTimeout(900)
  if (await page.locator('article.ws-doc-paged').count()) return
  await page.getByRole('button', { name: '更多' }).click()
  await page.waitForTimeout(250)
  await page.locator('text=页面设置…').click()
  await page.waitForTimeout(300)
  const sw = page.locator('.pg-switch').first()
  if (!(await sw.evaluate((e) => e.classList.contains('is-on')).catch(() => false))) await sw.click()
  await page.locator('.ws-modal-x').click().catch(async () => { await page.keyboard.press('Escape') })
  await page.waitForTimeout(700)
}

// 页界处内容真空带 + 页高统一（content 元素选择器按文档类型传入）
const geometry = (contentSel) => page.evaluate((sel) => {
  const paper = document.querySelector('article.ws-doc-paged')
  if (!paper) return { err: 'no paper' }
  const pr = paper.getBoundingClientRect()
  const rel = (v) => +(v - pr.top).toFixed(1)
  const contents = [...paper.querySelectorAll(sel)]
    .filter((e) => !e.closest('.ws-page-spacer') && !e.querySelector(sel)) // 只取叶子内容元素
    .map((e) => {
      const r = e.getBoundingClientRect()
      // content-box 顶：被推挤元素的 paddingTop 是留白不是内容，从内容起点算
      const pad = parseFloat(getComputedStyle(e).paddingTop) || 0
      return { top: rel(r.top + pad), bottom: rel(r.bottom) }
    })
  const bands = [...paper.querySelectorAll('.ws-inner-gutter')].map((g) => {
    const r = g.getBoundingClientRect()
    return { top: rel(r.top), bottom: rel(r.bottom) }
  })
  const voids = bands.map((b) => {
    const above = Math.max(0, ...contents.filter((c) => c.bottom <= b.top + 2).map((c) => c.bottom))
    const belows = contents.filter((c) => c.top >= b.bottom - 2).map((c) => c.top)
    const below = belows.length ? Math.min(...belows) : Infinity
    const crossed = contents.filter((c) => c.top < b.top - 2 && c.bottom > b.bottom + 2).length
    return { void: +(below - above).toFixed(1), crossed }
  })
  const allB = [
    ...paper.querySelectorAll('.ws-page-gutter'),
  ].map((g) => rel(g.getBoundingClientRect().top)).sort((a, b) => a - b)
  const spans = []
  let prev = 0
  for (const y of allB) { spans.push(+(y - prev).toFixed(1)); prev = y + 24 }
  return { bandCount: bands.length, voids, spans, paperH: +pr.height.toFixed(1) }
}, contentSel)

const pushedStats = () => page.evaluate(() => {
  const paper = document.querySelector('article.ws-doc-paged')
  const pushed = [...paper.querySelectorAll('li, .ws-code-line')].filter(
    (e) => parseFloat(getComputedStyle(e).paddingTop) > 50,
  )
  const marked = paper.querySelectorAll('[data-ws-pushed]').length
  const emptyBig = [...paper.querySelectorAll('li, .ws-code-line')].filter(
    (e) => !(e.textContent || '').trim() && e.getBoundingClientRect().height > 60
      && parseFloat(getComputedStyle(e).paddingTop) < 50, // 被推挤的空行允许高（padding 即留白）
  ).length
  return { pushedCount: pushed.length, marked, emptyBig }
})

// ---- 深嵌套列表 ----
await openDocPaged('深嵌套列表')
let g = await geometry('li')
assert(g.bandCount > 0, `nested: 有块内页界（got ${g.bandCount}）`)
assert(g.voids.every((v) => v.void >= VOID_MIN), `nested: 页界真空带 ≥${VOID_MIN}px（got ${JSON.stringify(g.voids)}）`)
assert(g.voids.every((v) => v.crossed === 0), 'nested: 无 li 被页界横穿')
// spans 计算已把 24px 缝宽扣掉（prev = y+24）→ 每段都应 ≈ 纸高 1122.5
assert(g.spans.length > 1 && g.spans.every((s) => Math.abs(s - 1122.5) < 4),
  `nested: 页高统一（spans=${JSON.stringify(g.spans)}）`)

// C) Colin 复现：点进被推挤 li 正文连按 5 次回车
const target = await page.evaluate(() => {
  const el = document.querySelector('[data-ws-pushed]')
  if (!el) return null
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + 60), y: Math.round(r.top + pad + 10) }
})
assert(!!target, 'nested: 存在被推挤的 li（V4 推挤已应用）')
if (target) {
  await page.mouse.click(target.x, target.y)
  await page.waitForTimeout(250)
  await page.keyboard.press('End')
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(320) }
  await page.waitForTimeout(700)
  g = await geometry('li')
  const st = await pushedStats()
  assert(st.pushedCount === g.bandCount, `nested-edit: 推挤不累积（pushed=${st.pushedCount} == bands=${g.bandCount}）`)
  assert(st.emptyBig === 0, `nested-edit: 无「贼大」空行（emptyBig=${st.emptyBig}）`)
  assert(g.voids.every((v) => v.void >= VOID_MIN && v.crossed === 0), `nested-edit: 真空带仍成立（${JSON.stringify(g.voids)}）`)
  assert(g.spans.every((s) => Math.abs(s - 1122.5) < 4), `nested-edit: 页高仍统一（${JSON.stringify(g.spans)}）`)
}

// ---- 代码瀑布 ----
await openDocPaged('代码瀑布')
g = await geometry('.ws-code-line')
assert(g.bandCount > 0, `code: 有块内页界（got ${g.bandCount}）`)
assert(g.voids.every((v) => v.void >= VOID_MIN && v.crossed === 0), `code: 页界真空带（${JSON.stringify(g.voids)}）`)
const ct = await page.evaluate(() => {
  const el = document.querySelector('.ws-code-line[data-ws-pushed]')
  if (!el) return null
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + 60), y: Math.round(r.top + pad + 8) }
})
assert(!!ct, 'code: 存在被推挤的代码行')
if (ct) {
  await page.mouse.click(ct.x, ct.y)
  await page.waitForTimeout(250)
  await page.keyboard.press('End')
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(320) }
  await page.waitForTimeout(700)
  g = await geometry('.ws-code-line')
  const st = await pushedStats()
  assert(st.pushedCount === g.bandCount, `code-edit: 推挤不累积（pushed=${st.pushedCount} == bands=${g.bandCount}）`)
  assert(st.emptyBig === 0, `code-edit: 无「贼大」空行（emptyBig=${st.emptyBig}）`)
  assert(g.voids.every((v) => v.void >= VOID_MIN && v.crossed === 0), `code-edit: 真空带仍成立（${JSON.stringify(g.voids)}）`)
}

// ---- 长表格 ----
await openDocPaged('长表格')
g = await geometry('tr:not(.ws-page-spacer)')
assert(g.bandCount > 0, `table: 有块内页界（got ${g.bandCount}）`)
assert(g.voids.every((v) => v.void >= VOID_MIN && v.crossed === 0), `table: 页界真空带（${JSON.stringify(g.voids)}）`)
const tstats = await page.evaluate(() => ({
  spacers: document.querySelectorAll('article.ws-doc-paged tr.ws-page-spacer').length,
}))
assert(tstats.spacers === g.bandCount, `table: spacer 数 == 页界数（${tstats.spacers}==${g.bandCount}）`)
// 编辑一个单元格触发 persist，查数据无痕
const td = page.locator('.ws-table td').nth(6)
await td.click(); await page.waitForTimeout(200)
await page.keyboard.type('_V4')
await page.waitForTimeout(300)
await page.locator('.ws-doc-header').click(); await page.waitForTimeout(700) // blur → persist
const raw = await page.evaluate(() => JSON.stringify(localStorage))
assert(!raw.includes('ws-page-spacer'), 'table-persist: 数据无 ws-page-spacer')
assert(!raw.includes('data-ws-pushed'), 'persist: 数据无 data-ws-pushed')

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASSED')
await browser.close()
process.exit(fail ? 1 : 0)
