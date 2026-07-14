// 用户自定义模板 — 换装/预览/撤销/新建 的真浏览器烟测（跑法：node scripts/test-template-ui.mjs [url]）。
// 需要 app 跑在 <url>（默认 preview 5199）。用 __wsStore/__wsUI 测试 seam 驱动真 store + 真 Canvas 渲染
// + 真作用域化，断言 computed style（强断言：不查 class 查真样式）。UI 打磨（画廊动效/纸方墨圆）靠目验。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const NAVY = 'rgb(20, 33, 61)' // 黄金标书 h1 color #14213d
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

await page.goto(URL, { waitUntil: 'networkidle' })
// 清一遍 localStorage 重新种子（SEED_VERSION 27），保证起点干净
await page.evaluate(() => { localStorage.removeItem('wordspace-demo'); localStorage.removeItem('wordspace-browser') })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__wsStore && !!window.__wsUI)

// 打开一份合规文档（员工手册，块编辑）
await page.evaluate(() => window.__wsStore.getState().openDoc('d-handbook'))
await page.waitForSelector('.ws-doc .ws-blocks h1')

// —— 换装：apply 黄金标书 → ws-tpl-on + h1 主题色（R1，computed 强断言）——
await page.evaluate(() => window.__wsStore.getState().applyTemplate('d-handbook', 't-proposal-formal'))
await page.waitForTimeout(120)
ok(await page.$('.ws-doc.ws-tpl-on') !== null, 'apply: article 带 ws-tpl-on')
const h1Color = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks h1', (el) => getComputedStyle(el).color)
ok(h1Color === NAVY, `apply: h1 主题色命中（got ${h1Color}）`)
const stamped = await page.evaluate(() => {
  const d = window.__wsStore.getState().docs.find((x) => x.id === 'd-handbook')
  return { id: d.templateId, hasCss: !!d.templateCss }
})
ok(stamped.id === 't-proposal-formal' && stamped.hasCss, 'apply: templateId/templateCss 盖章')

// —— 防泄漏：模板 CSS 作用域化，不漏到 app chrome（body 字体不变 serif）——
const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
ok(!/georgia/i.test(bodyFont), `防泄漏: body 字体未被模板 serif 污染（got ${bodyFont.slice(0, 40)}）`)

// —— AE3：行内手调（标红）换装后仍红 ——
await page.evaluate(() => {
  const s = window.__wsStore.getState()
  const d = s.docs.find((x) => x.id === 'd-handbook')
  s.updateBlockHtml('d-handbook', d.blocks[1].id, '这里有 <span style="color: rgb(220, 20, 60)">手调红字</span>。')
})
await page.evaluate(() => window.__wsStore.getState().applyTemplate('d-handbook', 't-minutes')) // 换到另一主题
await page.waitForTimeout(120)
const redColor = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks span[style]', (el) => getComputedStyle(el).color)
ok(redColor === 'rgb(220, 20, 60)', `AE3: 行内标红换装后仍红（got ${redColor}）`)

// —— 撤销：点 toast 的「撤销」→ 恢复上一模板。清空既有 toast 保证只剩本次那条（避免点错旧 toast）。——
await page.evaluate(() => {
  window.__wsStore.getState().applyTemplate('d-handbook', 't-proposal-formal') // 基线 = tpf
  window.__wsStore.setState({ toasts: [] })
  window.__wsStore.getState().applyTemplate('d-handbook', 't-minutes') // 换到 t-minutes → 单条撤销 toast（prev=tpf）
})
await page.waitForSelector('.ws-toast-action')
await page.click('.ws-toast-action')
await page.waitForTimeout(120)
const afterUndo = await page.evaluate(() => window.__wsStore.getState().docs.find((x) => x.id === 'd-handbook').templateId)
ok(afterUndo === 't-proposal-formal', `撤销: 恢复到换装前的模板（got ${afterUndo}）`)

// —— 卸装：applyTemplate(null) → 回素颜（无 ws-tpl-on）——
await page.evaluate(() => window.__wsStore.getState().applyTemplate('d-handbook', null))
await page.waitForTimeout(120)
ok(await page.$('.ws-doc.ws-tpl-on') === null, '卸装: 移除模板后 article 无 ws-tpl-on')

// —— 预览：setPreviewCss（未落章）→ 实时套 → 清除 → 复原 ——
await page.evaluate(() => {
  const css = window.__wsStore.getState().templates.find((t) => t.id === 't-proposal-formal').css
  window.__wsUI.getState().setPreviewCss(css)
})
await page.waitForTimeout(120)
ok(await page.$('.ws-doc.ws-tpl-on') !== null, '预览: previewCss 实时套（未落章也 ws-tpl-on）')
const previewStamped = await page.evaluate(() => !!window.__wsStore.getState().docs.find((x) => x.id === 'd-handbook').templateCss)
ok(!previewStamped, '预览: 未污染文档数据（templateCss 仍空）')
await page.evaluate(() => window.__wsUI.getState().setPreviewCss(null))
await page.waitForTimeout(120)
ok(await page.$('.ws-doc.ws-tpl-on') === null, '预览: 清除后复原素颜')

// —— U4/AE5：从黄金标书模板新建 → 新文档带主题 + 骨架 ——
await page.evaluate(() => window.__wsStore.getState().createFromTemplate('t-proposal-formal', '')) // 自动 openDoc
await page.waitForTimeout(150)
ok(await page.$('.ws-doc.ws-tpl-on') !== null, 'AE5: 从标书模板新建 → ws-tpl-on')
const newH1 = await page.$eval('.ws-doc.ws-tpl-on .ws-blocks h1', (el) => ({ color: getComputedStyle(el).color, text: el.textContent }))
ok(newH1.color === NAVY && newH1.text.includes('商务标书'), `AE5: 新文档带主题+骨架（h1=${newH1.text} ${newH1.color}）`)

// —— U4：从纯骨架模板（无 css）新建 → 有骨架无主题 ——
await page.evaluate(() => window.__wsStore.getState().createFromTemplate('t-blog', ''))
await page.waitForTimeout(150)
ok(await page.$('.ws-doc.ws-tpl-on') === null, 'U4: 纯骨架模板新建 → 无 ws-tpl-on（有骨架无主题）')

// —— U5：存为模板（含版式+骨架）——
const savedOk = await page.evaluate(() => {
  const s = window.__wsStore.getState()
  s.applyTemplate('d-handbook', 't-proposal-formal')
  s.saveDocAsTemplate('d-handbook', '我的标书', true)
  const t = window.__wsStore.getState().templates.find((x) => x.origin === 'user' && x.name === '我的标书')
  return !!t && !!t.css && t.blocks.length > 1
})
ok(savedOk, 'U5 存为模板：用户模板含版式 + 骨架')

// —— U5/AE2：导入合规加、违规（!important / 外链）整份拒 ——
const imp = await page.evaluate(() => {
  const s = window.__wsStore.getState()
  return {
    good: s.importTemplate({ name: '导入测试', css: 'h1{color:teal}' }).ok,
    badImp: s.importTemplate({ name: '坏!important', css: 'p{color:red !important}' }).ok,
    badUrl: s.importTemplate({ name: '外链', css: 'h1{background:url(http://x.com/a.png)}' }).ok,
    noName: s.importTemplate({ css: 'h1{color:red}' }).ok,
  }
})
ok(imp.good && !imp.badImp && !imp.badUrl && !imp.noName, `AE2 导入过门：合规加 / 违规+缺名拒（${JSON.stringify(imp)}）`)

// —— U5：编辑模板 CSS 引入 !important → 保存被拒 ——
const editRej = await page.evaluate(() => {
  const s = window.__wsStore.getState()
  const t = s.templates.find((x) => x.origin === 'user')
  return s.updateTemplateCss(t.id, 'h1{color:red !important}').ok
})
ok(!editRej, 'U5 编辑 CSS：!important 保存被拒')

// —— U5：删除 + 撤销（清空 toast 保证点对撤销）——
const delUndo = await page.evaluate(() => {
  const s = window.__wsStore.getState()
  const t = s.templates.find((x) => x.origin === 'user' && x.name === '导入测试')
  const before = s.templates.length
  window.__wsStore.setState({ toasts: [] })
  s.deleteTemplateWithUndo(t.id)
  const afterDel = window.__wsStore.getState().templates.length
  const toast = window.__wsStore.getState().toasts.filter((z) => z.action).pop()
  toast.action.run()
  return { before, afterDel, afterUndo: window.__wsStore.getState().templates.length }
})
ok(delUndo.afterDel === delUndo.before - 1 && delUndo.afterUndo === delUndo.before, `U5 删除+撤销（${JSON.stringify(delUndo)}）`)

// —— U5：/templates 管理页渲染（HashRouter）——
await page.goto(URL + '#/templates', { waitUntil: 'networkidle' })
await page.waitForSelector('.tplp-page')
ok((await page.$$('.tplp-group-label')).length >= 2, 'U5 /templates 页渲染（官方/我的分组）')
ok(await page.$('.tplp-card') !== null, 'U5 /templates 页有模板卡片')

await browser.close()
console.log(fail === 0 ? '\ntemplate UI smoke: ALL PASS' : `\ntemplate UI smoke: ${fail} FAILURES`)
process.exit(fail ? 1 : 0)
