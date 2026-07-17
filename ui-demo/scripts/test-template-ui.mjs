// 用户自定义模板 — 真浏览器烟测（跑法：node scripts/test-template-ui.mjs [url]）。
// 需要 app 跑在 <url>（默认 preview 5199）。用 __wsStore 测试 seam 驱动真 store + 真 Canvas 渲染，
// 断言 computed style（强断言：不查 class 查真样式）。管理页/存为等 UI 打磨靠目验。
// 范围（Colin 2026-07-15 收窄）：核心 = 从模板新建 + 存为模板 + 管理页；无换装/CSS/AI/导入。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const NAVY = 'rgb(20, 33, 61)' // 商务标书 h1 color #14213d
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => { localStorage.removeItem('wordspace-demo'); localStorage.removeItem('wordspace-browser') })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__wsStore)

// —— 从商务标书模板新建 → 带主题（AE5/R1，computed 强断言）——
await page.evaluate(() => window.__wsStore.getState().createFromTemplate('t-proposal-formal', ''))
await page.waitForSelector('.ws-doc.ws-tpl-on .ws-blocks h1')
await page.waitForTimeout(150)
const h1 = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks h1', (el) => ({ color: getComputedStyle(el).color, text: el.textContent }))
ok(h1.color === NAVY && h1.text.includes('商务标书'), `AE5: 从标书新建带主题+骨架（h1=${h1.text} ${h1.color}）`)
const stamped = await page.evaluate(() => {
  const d = window.__wsStore.getState().docs.find((x) => x.templateId === 't-proposal-formal')
  return !!d && !!d.templateCss
})
ok(stamped, '新建盖章：templateId/templateCss 已写入文档')

// —— 防泄漏：模板 CSS 作用域化，不漏到 app chrome（body 字体不变 serif）——
const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
ok(!/georgia/i.test(bodyFont), `防泄漏: body 字体未被模板 serif 污染（got ${bodyFont.slice(0, 40)}）`)

// —— 手调保留：行内标红不被模板 CSS 覆盖（禁 !important 保障）——
const did = await page.evaluate(() => window.__wsStore.getState().docs.find((x) => x.templateId === 't-proposal-formal').id)
await page.evaluate((id) => {
  const s = window.__wsStore.getState()
  const d = s.docs.find((x) => x.id === id)
  s.updateBlockHtml(id, d.blocks[3].id, '正文 <span style="color: rgb(220, 20, 60)">手调红字</span>。')
}, did)
await page.waitForTimeout(120)
const red = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks span[style]', (el) => getComputedStyle(el).color)
ok(red === 'rgb(220, 20, 60)', `手调保留: 行内标红不被模板覆盖（got ${red}）`)

// —— 纯骨架模板（无 css）新建 → 有骨架无主题 ——
await page.evaluate(() => window.__wsStore.getState().createFromTemplate('t-blog', ''))
await page.waitForTimeout(150)
ok(await page.$('.ws-doc.ws-tpl-on') === null, '纯骨架模板新建 → 无 ws-tpl-on（有骨架无主题）')

// —— 存为模板（含版式+骨架）：从有主题的文档存出用户模板 ——
const savedOk = await page.evaluate((id) => {
  const s = window.__wsStore.getState()
  s.saveDocAsTemplate(id, '我的标书', true)
  const t = window.__wsStore.getState().templates.find((x) => x.origin === 'user' && x.name === '我的标书')
  return !!t && !!t.css && t.blocks.length > 1
}, did)
ok(savedOk, '存为模板：用户模板含版式（继承官方模板的样子）+ 骨架')

// —— 用它新建 → 复现同款主题（存为→用 闭环）——
await page.evaluate(() => {
  const t = window.__wsStore.getState().templates.find((x) => x.name === '我的标书')
  window.__wsStore.getState().createFromTemplate(t.id, '')
})
await page.waitForTimeout(150)
const reColor = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks h1', (el) => getComputedStyle(el).color)
ok(reColor === NAVY, `闭环: 用「我的标书」新建复现同款主题（got ${reColor}）`)

// —— 删除 + 撤销（用户模板）——
const delUndo = await page.evaluate(() => {
  const s = window.__wsStore.getState()
  const t = s.templates.find((x) => x.origin === 'user' && x.name === '我的标书')
  const before = s.templates.length
  window.__wsStore.setState({ toasts: [] })
  s.deleteTemplateWithUndo(t.id)
  const afterDel = window.__wsStore.getState().templates.length
  window.__wsStore.getState().toasts.filter((z) => z.action).pop().action.run()
  return { before, afterDel, afterUndo: window.__wsStore.getState().templates.length }
})
ok(delUndo.afterDel === delUndo.before - 1 && delUndo.afterUndo === delUndo.before, `删除+撤销（${JSON.stringify(delUndo)}）`)

// —— /templates 管理页：缩略图预览卡片（不是 CSS）——
await page.goto(URL + '#/templates', { waitUntil: 'networkidle' })
await page.waitForSelector('.tplp-page')
ok((await page.$$('.tplp-card')).length >= 4, '管理页: 官方模板卡片网格渲染')
ok(await page.$('.tplp-prev') !== null, '管理页: 卡片是缩略图预览（.tplp-prev 存在）')
ok(await page.$('textarea') === null, '管理页: 不暴露 CSS（无 textarea）')
// 缩略图真渲染了主题：标书卡片的 h1 是 navy
const prevColor = await page.$$eval('.tplp-prev h1', (els) => els.map((e) => getComputedStyle(e).color))
ok(prevColor.includes(NAVY), `管理页: 缩略图真渲染主题（标书 h1 navy，got ${JSON.stringify(prevColor.slice(0, 6))}）`)

await browser.close()
console.log(fail === 0 ? '\ntemplate UI smoke: ALL PASS' : `\ntemplate UI smoke: ${fail} FAILURES`)
process.exit(fail ? 1 : 0)
