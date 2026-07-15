// 图片块（doc-images spec Phase 1）验证门。跑法：node scripts/verify-images.mjs <url>
// 强断言纪律（S4）：判「图真的渲染出来」用 naturalWidth>0 + boundingBox 非零 + data: 协议，
// 不查 DOM 存在性（存在 ≠ 显示出来）。采集/判定分离：checkImg 谓词同时用于正门与变异探针——
// 探针把 src 打坏后同一谓词必须翻红，否则整个门算哑门（FAIL）。
// 覆盖：斜杠插入（filechooser）/ 降采样(≤1600) / 空段落原地替换(已拍板②) /
//       粘贴文本优先(已拍板①) / 纯图粘贴 / 说明 figcaption canonical / 刷新持久化 / 变异自检。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5173/'
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

// ---- 判定谓词（采集/判定分离：正门与变异探针共用） ----
const checkImg = (sel) =>
  page.evaluate((s) => {
    const img = document.querySelector(s)
    if (!img) return { pass: false, why: 'no <img>' }
    const r = img.getBoundingClientRect()
    const pass =
      img.naturalWidth > 0 &&
      img.naturalHeight > 0 &&
      r.width > 40 &&
      r.height > 40 &&
      img.src.startsWith('data:image/')
    return { pass, why: pass ? '' : `nw=${img.naturalWidth} box=${r.width}x${r.height} src=${img.src.slice(0, 24)}` }
  }, sel)

// ---- 测试图片：页内 canvas 生成 2400×1500 渐变 PNG（超 1600，逼出降采样） ----
const bigPngB64 = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 2400
  c.height = 1500
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 2400, 1500)
  grad.addColorStop(0, '#1a73e8')
  grad.addColorStop(1, '#b3261e')
  g.fillStyle = grad
  g.fillRect(0, 0, 2400, 1500)
  g.fillStyle = '#fff'
  g.font = 'bold 160px sans-serif'
  g.fillText('WS', 980, 820)
  return c.toDataURL('image/png').split(',')[1]
})
const { writeFileSync, mkdtempSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const dir = mkdtempSync(join(tmpdir(), 'ws-img-'))
const bigPng = join(dir, 'big-photo.png')
writeFileSync(bigPng, Buffer.from(bigPngB64, 'base64'))

const blockCount = () => page.locator('.ws-blocks > .ws-block').count()

// ---- 1. 斜杠插入 + 空段落原地替换（已拍板②） ----
// 锚用首块（标题/正文）：块尾 Enter 走「插新正文块」路径，保证得到真·空段落块
// （末块可能是列表——列表里 Enter 是原生新 <li>，不产块，会让替换断言前提失效）。
const firstBlock = page.locator('.ws-blocks > .ws-block').first()
await firstBlock.click()
await page.keyboard.press('End')
await page.keyboard.press('Enter') // 新空段落，编辑态
await page.waitForTimeout(300)
const nBefore = await blockCount()
await page.keyboard.type('/')
await page.waitForTimeout(400)
const fcPromise = page.waitForEvent('filechooser')
await page.locator('.ws-slashmenu-item', { hasText: '图片' }).first().click()
const fc = await fcPromise
await fc.setFiles(bigPng)
await page.waitForTimeout(1200)

const nAfter = await blockCount()
assert(nAfter === nBefore, `空段落原地替换：块数不变（${nBefore} → ${nAfter}）`)
let r = await checkImg('.ws-image img')
assert(r.pass, `插入后图真渲染（naturalWidth+bbox+data:）${r.why}`)

// 降采样：存进块里的 src 解码后长边 ≤1600
const dims = await page.evaluate(async () => {
  const img = document.querySelector('.ws-image img')
  const probe = new Image()
  probe.src = img.src
  await new Promise((res, rej) => { probe.onload = res; probe.onerror = rej })
  return { w: probe.naturalWidth, h: probe.naturalHeight }
})
assert(Math.max(dims.w, dims.h) <= 1600, `降采样护栏：2400×1500 → ${dims.w}×${dims.h}（长边≤1600）`)

// ---- 2. 粘贴：文本优先（已拍板①）——同时带文本与图，不得插图 ----
const pasteWith = (withText) =>
  page.evaluate(async (hasText) => {
    const res = await fetch(document.querySelector('.ws-image img').src)
    const blob = await res.blob()
    const dt = new DataTransfer()
    if (hasText) dt.setData('text/plain', 'hello text wins')
    dt.items.add(new File([blob], 'pasted.webp', { type: blob.type }))
    const target = document.querySelector('.ws-blocks [contenteditable="true"]') ?? document.querySelector('.ws-blocks')
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, withText)

const firstEditable = page.locator('.ws-blocks > .ws-block').first()
await firstEditable.click()
await page.waitForTimeout(200)
const imgsBeforePaste = await page.locator('.ws-image img').count()
await pasteWith(true)
await page.waitForTimeout(800)
assert(
  (await page.locator('.ws-image img').count()) === imgsBeforePaste,
  '粘贴文本优先：文本+图并存时不插图片块',
)
await pasteWith(false)
await page.waitForTimeout(1000)
assert(
  (await page.locator('.ws-image img').count()) === imgsBeforePaste + 1,
  '纯图粘贴：插入一个图片块',
)

// ---- 3. 说明（figcaption）canonical：加说明 → figure 包裹；清空 → 降回裸 img ----
const img0 = page.locator('.ws-image img').first()
await img0.click() // 整块灰选
await page.waitForTimeout(300)
assert(
  await page.locator('.ws-block-selected .ws-image').count() > 0,
  '点击图片 = 整块灰选（ws-block-selected）',
)
await page.locator('.ws-image-addcap').click()
await page.waitForTimeout(200)
await page.keyboard.type('这是图片说明')
await page.locator('.ws-blocks > .ws-block').first().click() // blur → persist
await page.waitForTimeout(500)
const capOk = await page.evaluate(() => {
  const fig = document.querySelector('.ws-image')
  const cap = fig?.querySelector('figcaption')
  return !!cap && cap.textContent === '这是图片说明' && !!fig.querySelector('img')
})
assert(capOk, '加说明 → figure/figcaption canonical 落库并渲染')

// ---- 4. 刷新持久化：localStorage 里的 data: 内联图冷启动仍渲染 ----
await page.reload()
await page.waitForTimeout(1500)
r = await checkImg('.ws-image img')
assert(r.pass, `刷新后图仍真渲染（data: 内联持久化）${r.why}`)

// ---- 5. 变异探针（门有牙）：src 打坏后同一谓词必须翻红 ----
await page.evaluate(() => {
  document.querySelectorAll('.ws-image img').forEach((i) => {
    i.src = 'data:image/png;base64,AAAA'
  })
})
await page.waitForTimeout(600)
r = await checkImg('.ws-image img')
assert(!r.pass, '变异自检：坏 src 下判定翻红（否则本门是哑门）')

await browser.close()
console.log(fail === 0 ? '\nVERIFY-IMAGES: ALL PASS' : `\nVERIFY-IMAGES: ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
