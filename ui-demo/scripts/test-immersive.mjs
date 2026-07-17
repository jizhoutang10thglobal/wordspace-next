// 沉浸收起（Arc 对标，Wendi 2026-07-16）— 真浏览器烟测（跑法：node scripts/test-immersive.mjs [url]）。
// 需要 app 跑在 <url>（默认 preview 5199）。强断言口径：量 boundingBox / computed visibility，
// 不查 class 存在性——老实现（收起留 48px 细轨）跑这套必翻红，断言天然有牙。
// 契约（Colin 拍板）：收起=零可见 chrome（无细轨/无浮钮）、左缘 hover peek + Cmd/Ctrl+\ 重开、
// 文档标签收起时 52px 文档头保留（沉浸范围只砍侧栏侧）。
// 2026-07-17 追加（Wendi）：收起态内容四周 10px 窗框带（真 app=窗口拖动区）、peek 触发区=
// 整条左边框且 hover 有可见反馈、peek 贴左边框内侧滑出（x=10）。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch()
// locale 锁 zh-CN:i18n(#223)后 chrome 文案跟随系统语言,断言按中文 title 选钮,别让 CI/无头环境漂到 en
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN' })
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

// —— 展开态窗框（Colin 2026-07-18 扩「非全屏恒有」）：停靠态也有框——侧栏贴左缘,.ws-main 四周 10px + 细边圆角 ——
const dockedSbLeft = await page.$eval('.ws-body > .arc-sidebar', (el) => Math.round(el.getBoundingClientRect().left))
ok(dockedSbLeft === 0, `展开: 侧栏贴左缘（left=${dockedSbLeft}，期望 0）`)
const sbW = Math.round(docked)
const dm = await page.$eval('.ws-main', (el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
  return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.x + r.width), bottom: Math.round(r.y + r.height), bw: cs.borderTopWidth, br: parseFloat(cs.borderTopLeftRadius) }
})
ok(dm.x === sbW + 10 && dm.y === 10 && dm.right === 1390 && dm.bottom === 890,
  `展开: .ws-main 四周 10px 框（x=${dm.x} y=${dm.y} right=${dm.right} bottom=${dm.bottom}，期望 ${sbW + 10}/10/1390/890）`)
ok(dm.bw === '1px' && dm.br > 0, `展开: 内容纸细边+圆角（边 ${dm.bw} 圆角 ${dm.br}）`)
const bodyBgDocked = await page.$eval('.ws-body', (el) => getComputedStyle(el).backgroundColor)
ok(bodyBgDocked !== 'rgba(0, 0, 0, 0)' && bodyBgDocked !== 'transparent', `展开: 窗框缝有 chrome 底色（bg=${bodyBgDocked}）`)

// —— 收起 = 沉浸：流内零残留，内容四周均匀内缩 10px 窗框带 ——
await page.evaluate(() => window.__wsUI.getState().toggleSidebar())
await page.waitForTimeout(120)
const railGone = await page.evaluate(() => !document.querySelector('.ws-body > .arc-sidebar'))
ok(railGone, '收起: 流内不再渲染任何侧栏元素（48px 细轨已删）')
const main = await page.$eval('.ws-main', (el) => el.getBoundingClientRect())
ok(
  Math.round(main.x) === 10 && Math.round(main.y) === 10 &&
    Math.round(main.width) === 1380 && Math.round(main.height) === 880,
  `收起: 内容区四周内缩 10px（x=${Math.round(main.x)} y=${Math.round(main.y)} w=${Math.round(main.width)} h=${Math.round(main.height)}，期望 10/10/1380/880）`)
// 窗框带可见（Wendi 2026-07-17：原隐形热区「不知道鼠标挪哪」）——读 computed 背景，不查 class
const frameBg = await page.$eval('.ws-body', (el) => getComputedStyle(el).backgroundColor)
ok(frameBg !== 'rgba(0, 0, 0, 0)' && frameBg !== 'transparent', `收起: 窗框带有可见底色（bg=${frameBg}）`)
// hover 左边框 → 背景加深一档的可见反馈
const edgeIdle = await page.$eval('.arc-edge-hot', (el) => getComputedStyle(el).backgroundColor)
await page.mouse.move(5, 700)
await page.waitForTimeout(200)
const edgeHover = await page.$eval('.arc-edge-hot', (el) => getComputedStyle(el).backgroundColor)
ok(edgeHover !== edgeIdle, `收起: hover 左边框有可见反馈（${edgeIdle} → ${edgeHover}）`)
await page.mouse.move(900, 450)
await page.waitForTimeout(750) // 等 hover 顺带触发的 peek 收干净，别污染后面的断言

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
ok(peek && peek.x === 10 && peek.w >= 180 && peek.vis === 'visible',
  `peek: hover 左边框滑出悬浮侧栏、贴边框内侧（${JSON.stringify(peek)}，期望 x=10）`)
const mainDuringPeek = await page.$eval('.ws-main', (el) => Math.round(el.getBoundingClientRect().x))
ok(mainDuringPeek === 10, `peek: 悬浮不推挤内容（内容区 x 仍=${mainDuringPeek}）`)

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
await page.click('.arc-peek.is-on button[title^="收起侧栏"]') // 前缀匹配:#227 起 title 带快捷键后缀（如「收起侧栏 ⌘\」）
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
