// 分页视图「页间隙不遮字」冒烟门（需先起 dev server，跑法：node scripts/smoke-paged.mjs <url>）。
// 教训（2026-07-09）：用 keyboard.type+Enter 连发造长文档会被输入竞态打碎段落文本，
// 看起来像「gap 把行首遮掉了」，其实 DOM 里文本本来就残缺——造数据必须逐段 insertText+校验全等。
// 断言：
// 1) 全新 context（干净 localStorage）打开 app，开分页；
// 2) 逐段慢速输入 36 段编号段落，每段输入后核对块 textContent 与期望全等（排除打字竞态伪影）；
// 3) 对每个 .ws-page-gap：boundingBox 与前一个/后一个 .ws-block 零重叠（1px 容差）；
// 4) 页首块首字符 elementFromPoint 可见性 + DocHeader / 分页符块与 gap 相邻同样零重叠。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5200/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const assert = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

await page.goto(URL)
await page.waitForTimeout(1200)

// 开分页
await page.getByRole('button', { name: '更多' }).click()
await page.locator('text=页面设置…').click()
await page.waitForTimeout(300)
await page.locator('.pg-switch').first().click()
await page.locator('.ws-modal-x').click()
await page.waitForTimeout(500)
assert(await page.locator('article.ws-doc-paged').count() === 1, 'paged view on')

// 确定性输入：36 段，每段独立聚焦末尾新块、整段 insertText、逐段校验
const paras = []
for (let i = 1; i <= 36; i++) paras.push(`第 ${i} 段：确定性造数据的段落文本，用来把文档撑过三页，验证页间隙不遮字。`)

await page.locator('.ws-canvas-tail').click()
await page.waitForTimeout(200)
for (const [i, text] of paras.entries()) {
  await page.keyboard.insertText(text)
  await page.waitForTimeout(30)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(60)
}
await page.waitForTimeout(1000)

// 校验文本无损（打字竞态伪影在这一步就会现形）
const blockTexts = await page.evaluate(() =>
  [...document.querySelectorAll('.ws-block')].map((b) => b.textContent?.trim() ?? ''),
)
for (const text of paras) {
  assert(blockTexts.some((t) => t === text), `block text intact: ${text.slice(0, 12)}…`)
}

// 零重叠断言：每个 gap vs 相邻块（前一个/后一个非 gap 兄弟）
const geo = await page.evaluate(() => {
  const out = []
  const gaps = [...document.querySelectorAll('.ws-page-gap')]
  for (const g of gaps) {
    const gr = g.getBoundingClientRect()
    let prev = g.previousElementSibling
    while (prev && !prev.classList.contains('ws-block')) prev = prev.previousElementSibling
    let next = g.nextElementSibling
    while (next && !next.classList.contains('ws-block')) next = next.nextElementSibling
    out.push({
      gapTop: gr.top + scrollY, gapBottom: gr.bottom + scrollY,
      prevBottom: prev ? prev.getBoundingClientRect().bottom + scrollY : null,
      prevText: prev?.textContent?.slice(0, 14) ?? null,
      prevIsPagebreak: !!prev?.querySelector('.ws-pagebreak'),
      nextTop: next ? next.getBoundingClientRect().top + scrollY : null,
      nextText: next?.textContent?.slice(0, 14) ?? null,
    })
  }
  const header = document.querySelector('.ws-doc-header')?.getBoundingClientRect()
  return { gaps: out, headerBottom: header ? header.bottom + scrollY : null }
})
assert(geo.gaps.length >= 2, `>=2 gaps for 3+ pages (got ${geo.gaps.length})`)
for (const [i, g] of geo.gaps.entries()) {
  if (g.prevBottom !== null)
    assert(g.gapTop >= g.prevBottom - 1, `gap#${i} top(${g.gapTop.toFixed(1)}) >= prev block bottom(${g.prevBottom.toFixed(1)}) [prev="${g.prevText}"]`)
  if (g.nextTop !== null)
    assert(g.gapBottom <= g.nextTop + 1, `gap#${i} bottom(${g.gapBottom.toFixed(1)}) <= next block top(${g.nextTop.toFixed(1)}) [next="${g.nextText}"]`)
}
if (geo.headerBottom !== null && geo.gaps.length)
  assert(geo.gaps[0].gapTop >= geo.headerBottom - 1, 'DocHeader above first gap, no overlap')

// 页首块首字符可见性：对每个 gap 的 next block，取其内容首行左上点 elementFromPoint 必须命中块自身
for (let i = 0; i < geo.gaps.length; i++) {
  const hit = await page.evaluate((idx) => {
    const gaps = [...document.querySelectorAll('.ws-page-gap')]
    let next = gaps[idx].nextElementSibling
    while (next && !next.classList.contains('ws-block')) next = next.nextElementSibling
    if (!next) return 'no-next'
    next.scrollIntoView({ block: 'center' })
    const r = next.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + 40, r.top + 12) // 首行文字处
    return next.contains(el) ? 'inside' : `covered-by:${el?.className || el?.tagName}`
  }, i)
  assert(hit === 'inside' || hit === 'no-next', `page-top block first line visible after gap#${i} (${hit})`)
}

// 分页符相邻：插一个分页符再验一遍其后 gap 零重叠
await page.locator('.ws-block').nth(2).click()
await page.keyboard.press('End')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.keyboard.type('/fenye', { delay: 40 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
const pbGeo = await page.evaluate(() => {
  const pb = document.querySelector('.ws-pagebreak')?.closest('.ws-block')
  if (!pb) return null
  let next = pb.nextElementSibling
  while (next && !next.classList.contains('ws-page-gap') && !next.classList.contains('ws-block')) next = next.nextElementSibling
  if (!next?.classList.contains('ws-page-gap')) return { hasGapAfter: false }
  return {
    hasGapAfter: true,
    pbBottom: pb.getBoundingClientRect().bottom + scrollY,
    gapTop: next.getBoundingClientRect().top + scrollY,
  }
})
assert(!!pbGeo?.hasGapAfter, 'pagebreak block immediately followed by gap')
if (pbGeo?.hasGapAfter) assert(pbGeo.gapTop >= pbGeo.pbBottom - 1, `pagebreak bottom(${pbGeo.pbBottom.toFixed(1)}) above gap top(${pbGeo.gapTop.toFixed(1)})`)

// 截第 2 页页首区域存证
const shot = process.env.SHOT
if (shot) {
  await page.locator('.ws-page-gutter').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: shot })
}

await browser.close()
if (fail) { console.log(`\n${fail} FAILURE(S)`); process.exit(1) }
console.log('\nALL PASSED')
