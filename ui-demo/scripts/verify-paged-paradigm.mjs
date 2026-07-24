// 「分页文档 = Schema 2 新建范式」验证门（跑法：node scripts/verify-paged-paradigm.mjs <url>）。
// 新建弹窗选「分页文档」范式 → 建出的文档即分页态(article.ws-doc-paged) + 顶部排版工具栏(.ws-typo-bar) +
// 默认套国标公文预设。证明分页文档是一个能直接新建的独立 Schema，而非埋在页面设置里的开关。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
page.on('dialog', (d) => d.accept())
let fail = 0
const assert = (c, m) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

await page.goto(URL)
await page.waitForTimeout(700)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForTimeout(1500)

// 开「新建」弹窗（侧栏文件夹的「+ New document」按钮）
await page.locator('.arc-folder-add').first().click()
await page.waitForTimeout(600)
assert((await page.locator('.cm-para').count()) > 0, '新建弹窗打开、有范式轨')

// 选「分页文档」范式（语言无关：匹配 分页/Paged；它非 soon，应显示创建卡）
await page.locator('.cm-para', { hasText: /分页|Paged/ }).first().click()
await page.waitForTimeout(300)
assert((await page.locator('.cm-card-blank').count()) > 0, '分页文档范式显示创建卡（非 coming-soon）')

// 建
await page.locator('.cm-card-blank').first().click()
await page.waitForTimeout(1300)

// 验：建出的文档即分页态 + 排版工具栏 + 默认国标公文预设
assert((await page.locator('article.ws-doc-paged').count()) > 0, '新建分页文档 → 文档即分页视图(ws-doc-paged)')
assert((await page.locator('.ws-typo-bar').count()) > 0, '新建分页文档 → 顶部排版工具栏出现')
const presetVal = await page.$eval('.ws-typo-preset', (el) => el.value).catch(() => null)
assert(presetVal === 'gb9704', `默认套国标公文预设（preset=${presetVal}）`)

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL PASSED')
await browser.close()
process.exit(fail ? 1 : 0)
