// 标准化排版层「真渲染」验证门（跑法：node scripts/verify-typography.mjs <url>）。
// 照 verify-paged-v4.mjs 的 Playwright computed-style 真像素范式——不查 class（S4 假绿教训）。
// 核心断言：
//  A) 套国标公文预设 → 正文 .ws-p computed 字号 16pt→21.33px、固定行距 29pt→38.67px、两端对齐、
//     font-family 含 FangSong 且泛型唯一在末位、首行缩进≈2em（AE2）。
//  B) 改字号后每页仍严格=一张纸（页界间距≈1122.5，AE3 最高风险联动点——测的是重排真发生）。
//  C) 套 APA → Times/12pt/双倍行距/左对齐（AE6，同一套控件承载两标准）。
// 注：computed fontFamily 读的是声明串不是真 per-glyph 字体，只验声明结构（KTD7 告警）。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const ptToPx = (pt) => (pt * 96) / 72
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

// 稳法：seed ws-paged-docs 让样例文档 d-pg-longflow 开局即分页态（省掉 ⋯ 菜单导航，v4 harness 已 stale）
const DOC_ID = 'd-pg-longflow'
await page.goto(URL)
await page.waitForTimeout(600)
await page.evaluate((id) => {
  localStorage.clear()
  localStorage.setItem('ws-paged-docs', JSON.stringify({ [id]: { on: true, size: 'A4', orientation: 'portrait', margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 }, pageNumbers: false } }))
}, DOC_ID)
await page.reload()
await page.waitForTimeout(1500)

async function openDocPaged(name) {
  await page.getByText(name, { exact: false }).first().click()
  await page.waitForTimeout(1000)
  await page.waitForSelector('article.ws-doc-paged', { timeout: 8000 })
}

const applyPreset = async (pid) => {
  await page.evaluate((p) => window.__ws2Typo?.applyPreset(p), pid)
  await page.waitForTimeout(900) // 等 store→重渲染→scoped style→recalc rAF
}
const setSizePt = async (pt) => {
  await page.evaluate((p) => window.__ws2Typo?.setSizePt(p), pt)
  await page.waitForTimeout(900)
}

// 正文 computed 排版
const bodyStyle = () => page.evaluate(() => {
  const p = document.querySelector('article.ws-doc-paged .ws-p')
  if (!p) return null
  const s = getComputedStyle(p)
  return { fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight), fontFamily: s.fontFamily, textAlign: s.textAlign, textIndent: parseFloat(s.textIndent) }
})

// 页界间距（照 v4：.ws-page-gutter tops，扣掉 24px 缝宽 → 每段≈纸高 1122.5）
const pageSpans = () => page.evaluate(() => {
  const paper = document.querySelector('article.ws-doc-paged')
  if (!paper) return []
  const pr = paper.getBoundingClientRect()
  const ys = [...paper.querySelectorAll('.ws-page-gutter')].map((g) => +(g.getBoundingClientRect().top - pr.top).toFixed(1)).sort((a, b) => a - b)
  const spans = []; let prev = 0
  for (const y of ys) { spans.push(+(y - prev).toFixed(1)); prev = y + 24 }
  return spans
})

// ==== A) 国标公文（AE2）====
await openDocPaged('长文流水')
assert(await page.evaluate(() => !!window.__ws2Typo), 'test seam __ws2Typo 就位')
await applyPreset('gb9704')
{
  const b = await bodyStyle()
  assert(!!b, '取到 .ws-p computed')
  assert(near(b.fontSize, ptToPx(16)), `国标正文字号 16pt→${ptToPx(16).toFixed(1)}px（got ${b?.fontSize}）`)
  assert(near(b.lineHeight, ptToPx(29), 2), `国标固定行距 29pt→${ptToPx(29).toFixed(1)}px（got ${b?.lineHeight}）`)
  assert(b.textAlign === 'justify', `国标两端对齐（got ${b?.textAlign}）`)
  assert(/FangSong/i.test(b.fontFamily), `font-family 含 FangSong（got ${b?.fontFamily}）`)
  assert(/(serif|sans-serif)$/.test(b.fontFamily.trim()), `泛型在末位（got ${b?.fontFamily}）`)
  assert(near(b.textIndent, 2 * b.fontSize, 2), `首行缩进≈2em（got ${b?.textIndent} vs ${(2 * b.fontSize).toFixed(1)}）`)
}
const spans0 = await pageSpans()
assert(spans0.length >= 1, `分页多页（gutters=${spans0.length}）`)
assert(spans0.every((s) => near(s, 1122.5, 5)), `国标下每页=一张纸（spans=${JSON.stringify(spans0)}）`)

// ==== B) 改字号 → 每页仍=一张纸（AE3，重排真发生）====
await setSizePt(24)
{
  const b = await bodyStyle()
  assert(near(b.fontSize, ptToPx(24)), `改字号生效 24pt→${ptToPx(24).toFixed(1)}px（got ${b?.fontSize}）`)
  const spans = await pageSpans()
  assert(spans.length >= 1, `改字号后仍多页（gutters=${spans.length}）`)
  assert(spans.every((s) => near(s, 1122.5, 5)), `改字号后每页仍=一张纸（spans=${JSON.stringify(spans)}）`)
}

// ==== C) APA（AE6）====
await applyPreset('apa')
{
  const b = await bodyStyle()
  assert(near(b.fontSize, ptToPx(12)), `APA 12pt→${ptToPx(12).toFixed(1)}px（got ${b?.fontSize}）`)
  assert(near(b.lineHeight, 2 * b.fontSize, 3), `APA 双倍行距（got ${b?.lineHeight} vs ${(2 * b.fontSize).toFixed(1)}）`)
  assert(b.textAlign === 'left', `APA 左对齐（got ${b?.textAlign}）`)
  assert(/Times New Roman/i.test(b.fontFamily), `APA font-family 含 Times（got ${b?.fontFamily}）`)
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASSED')
await browser.close()
process.exit(fail ? 1 : 0)
