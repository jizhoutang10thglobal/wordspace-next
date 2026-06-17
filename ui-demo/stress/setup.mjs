import { chromium } from 'playwright'

export const DEFAULT_URL = 'http://localhost:5180/#/docs'

// 启动 Chromium、连 dev server、确定性重置到固定种子文档（KTD-4）、挂 JS 错监听（不变量①）。
// 返回 { browser, page, errors }。errors 是实时累积的数组，不变量① 读它。
export async function launchHarness({ url = DEFAULT_URL, headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  const errors = []
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: String(e) }))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ kind: 'console.error', text: m.text() })
  })

  await page.goto(url, { waitUntil: 'load' })
  await resetPage(page)
  return { browser, page, errors }
}

// 清 persist（store name + browser）再 reload → 自动 reseed 到静态 seedDocs（确定性初态）。
// 变异自检每个用例之间也用它复位（KTD-4 + parallel session 的「每用例干净实例」教训）。
export async function resetPage(page) {
  await page.evaluate(() => {
    localStorage.removeItem('wordspace-demo')
    localStorage.removeItem('wordspace-browser')
  })
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.ws-block', { timeout: 10000 })
  await page.waitForTimeout(50) // settle 一拍，等 React/contentEditable 初始 effect 落定
}
