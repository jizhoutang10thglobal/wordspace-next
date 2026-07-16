// 沉浸收起（Arc 对标，Wendi 2026-07-16）— 真浏览器烟测（跑法：node scripts/test-immersive.mjs [url]）。
// 需要 app 跑在 <url>（默认 preview 5199）。强断言口径：量 boundingBox / computed visibility，
// 不查 class 存在性——老实现（收起留 48px 细轨）跑这套必翻红，断言天然有牙。
// 契约（Colin 拍板）：收起=零可见 chrome（无细轨/无浮钮）、左缘 hover peek + Cmd/Ctrl+\ 重开、
// 文档标签收起时 52px 文档头保留（沉浸范围只砍侧栏侧）。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => { localStorage.removeItem('wordspace-demo'); localStorage.removeItem('wordspace-browser') })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__wsStore && !!window.__wsUI)

// —— 基线：停靠态侧栏在流内，内容区从侧栏右侧开始 ——
const docked = await page.$eval('.ws-body > .arc-sidebar', (el) => el.getBoundingClientRect().width)
ok(docked >= 180, `基线: 停靠侧栏在流内（宽 ${docked}px）`)

// —— 收起 = 沉浸：内容四边贴满，流内零残留 ——
await page.evaluate(() => window.__wsUI.getState().toggleSidebar())
await page.waitForTimeout(120)
const railGone = await page.evaluate(() => !document.querySelector('.ws-body > .arc-sidebar'))
ok(railGone, '收起: 流内不再渲染任何侧栏元素（48px 细轨已删）')
const main = await page.$eval('.ws-main', (el) => el.getBoundingClientRect())
ok(Math.round(main.x) === 0 && Math.round(main.width) === 1400,
  `收起: 内容区贴满全宽（x=${Math.round(main.x)} w=${Math.round(main.width)}，期望 0/1400）`)
// 变异探针同源断言：最左边缘像素下压的是内容/热区，不是任何可见 chrome 条
const leftmost = await page.evaluate(() => {
  const el = document.elementFromPoint(2, 450)
  const bg = el ? getComputedStyle(el).backgroundColor : ''
  return { cls: el?.className ?? '', transparent: bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' }
})
ok(leftmost.transparent || !String(leftmost.cls).includes('arc-'),
  `收起: 左缘无可见条（点到 ${JSON.stringify(leftmost)}）`)

// —— 文档头保留（拍板：网页全隐、文档保留文档头）——
await page.evaluate(() => {
  const s = window.__wsStore.getState()
  const doc = s.docs.find((d) => !d.rawHtml && d.format !== 'markdown')
  s.openDoc(doc.id)
})
await page.waitForSelector('.ws-doc-header', { timeout: 3000 })
const header = await page.$eval('.ws-doc-header', (el) => {
  const r = el.getBoundingClientRect()
  return { h: r.height, vis: getComputedStyle(el).visibility, disp: getComputedStyle(el).display }
})
ok(header.h > 30 && header.vis === 'visible' && header.disp !== 'none',
  `收起(文档): 文档头保留（h=${Math.round(header.h)} ${header.vis}）`)

// —— 左缘 hover → peek 悬浮侧栏滑出（盖内容，不推挤）——
await page.mouse.move(3, 450)
await page.waitForTimeout(550) // 120ms 触发延迟 + 320ms 滑入
const peek = await page.evaluate(() => {
  const p = document.querySelector('.arc-peek.is-on .arc-sidebar')
  if (!p) return null
  const r = p.getBoundingClientRect()
  return { x: Math.round(r.x), w: Math.round(r.width), vis: getComputedStyle(p).visibility }
})
ok(peek && peek.x === 0 && peek.w >= 180 && peek.vis === 'visible',
  `peek: hover 左缘滑出完整悬浮侧栏（${JSON.stringify(peek)}）`)
const mainDuringPeek = await page.$eval('.ws-main', (el) => Math.round(el.getBoundingClientRect().x))
ok(mainDuringPeek === 0, `peek: 悬浮不推挤内容（内容区 x 仍=${mainDuringPeek}）`)

// —— 鼠标离开 → peek 收回（computed visibility 强断言，不查 class）——
await page.mouse.move(900, 450)
await page.waitForTimeout(750) // 240ms 离开缓冲 + 320ms 滑出 + visibility 延迟
const peekHidden = await page.evaluate(() => {
  const p = document.querySelector('.arc-peek .arc-sidebar')
  return p ? getComputedStyle(p).visibility : 'gone'
})
ok(peekHidden === 'hidden' || peekHidden === 'gone', `peek: 移开后收回（visibility=${peekHidden}）`)

// —— peek 里点「收起侧栏」钮 = 真展开回停靠态 ——
await page.mouse.move(3, 450)
await page.waitForTimeout(550)
await page.click('.arc-peek.is-on button[title="收起侧栏"]')
await page.waitForTimeout(150)
const dockedBack = await page.evaluate(() => {
  const el = document.querySelector('.ws-body > .arc-sidebar')
  return el ? Math.round(el.getBoundingClientRect().width) : 0
})
ok(dockedBack >= 180, `peek→展开: 点钮回停靠态（宽 ${dockedBack}px）`)

// —— Cmd/Ctrl+\ 快捷键仍能收/展 ——
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+\\' : 'Control+\\')
await page.waitForTimeout(120)
const collapsedByKey = await page.evaluate(() => window.__wsUI.getState().sidebarCollapsed)
ok(collapsedByKey === true, '快捷键: Cmd/Ctrl+\\ 收起仍工作')

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
