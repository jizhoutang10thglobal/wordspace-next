// 默认屏导览页(方案 3 时间流)— 门(跑法:node scripts/test-start-page.mjs [url])。
// ① recency 纯函数(esbuild 直载,零 DOM);② 真浏览器烟测(需 app 跑在 <url>,默认 5199)。
// 强断言口径:量渲染结果/真状态,不查 class 存在性。变异口径:把 App.tsx 的 !tab 分支撤掉
// (回落空 Canvas)→ 烟测第 1 条翻红。
import { build } from 'esbuild'
import { chromium } from 'playwright'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }

// ---------- ① recency 纯函数 ----------
const bundle = await build({
  entryPoints: ['src/lib/recency.ts'], bundle: true, format: 'esm', write: false,
})
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const { groupKey, folderLabel } = mod
// 固定「现在」:2026-07-17 15:00 本地
const now = new Date(2026, 6, 17, 15, 0).getTime()
const at = (y, mo, d, h = 12) => new Date(y, mo, d, h).getTime()
ok(groupKey(at(2026, 6, 17, 0, 1), now) === 'today', 'recency: 今天 00:01 → today')
ok(groupKey(at(2026, 6, 16, 23), now) === 'yesterday', 'recency: 昨天 23:00 → yesterday')
ok(groupKey(at(2026, 6, 15, 9), now) === 'week', 'recency: 前天 → week')
ok(groupKey(at(2026, 6, 11, 9), now) === 'week', 'recency: 6 天前 → week')
ok(groupKey(at(2026, 6, 9, 9), now) === 'earlier', 'recency: 8 天前 → earlier')
ok(groupKey(now + 3600e3, now) === 'today', 'recency: 未来时间容错 → today')
ok(folderLabel('~/Wordspace/团队/人事/员工手册.html') === '人事', 'folderLabel: 倒数第二段')
ok(folderLabel('文档.html', '文件') === '文件', 'folderLabel: 根下给 fallback')

// ---------- ② 浏览器烟测 ----------
const URL = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => { localStorage.removeItem('wordspace-demo'); localStorage.removeItem('wordspace-browser') })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.__wsStore && !!window.__wsUI)

// 关掉全部标签 → 导览页上屏(变异探针:!tab 分支撤掉时这里翻红)
await page.evaluate(() => {
  const s = window.__wsStore.getState()
  window.__wsStore.setState({ tabs: [], activeTabId: null }, false)
  void s
})
await page.waitForSelector('[data-testid="start-page"]', { timeout: 4000 })
ok(true, '空态: 导览页上屏(start-page 渲染)')
const greet = await page.$eval('.sp-greet', (el) => ({ txt: el.textContent, size: parseFloat(getComputedStyle(el).fontSize) }))
ok(greet.txt.length > 0 && greet.size >= 30, `问候刊头真渲染(「${greet.txt}」 ${greet.size}px)`)
// 分组标题按数据出现(种子 docs 的 updatedAt 落在哪组都行,至少一组 + 行可点)
const caps = await page.$$eval('.sp-grp-cap', (els) => els.map((e) => e.textContent))
ok(caps.length >= 1, `时间分组渲染(${JSON.stringify(caps)})`)
// 最近行不含绝对路径(裸路径是 Wendi 吐槽的原罪)
const rowMeta = await page.$$eval('.sp-row-meta', (els) => els.map((e) => e.textContent).join('|'))
ok(!rowMeta.includes('/Users/') && !rowMeta.includes('~/'), '最近行无裸绝对路径')

// 最近行点击 → 打开文档
await page.click('.sp-row')
await page.waitForSelector('.ws-doc', { timeout: 4000 })
ok(await page.evaluate(() => window.__wsStore.getState().tabs.length > 0), '点最近行: 真开文档(标签建立)')

// 回空态,omnibox:打字出候选 → 回车开文档
await page.evaluate(() => window.__wsStore.setState({ tabs: [], activeTabId: null }, false))
await page.waitForSelector('[data-testid="start-page"]')
const firstTitle = await page.evaluate(() => window.__wsStore.getState().docs.find((d) => d.localPath && !d.unsaved).title)
await page.fill('.sp-omni-input', firstTitle.slice(0, 2))
await page.waitForSelector('.sp-sug-item', { timeout: 3000 })
await page.press('.sp-omni-input', 'Enter')
await page.waitForFunction(() => window.__wsStore.getState().tabs.length > 0, undefined, { timeout: 4000 })
ok(true, 'omnibox: 打字过滤本地文件 + 回车打开')

// 回空态,omnibox 输网址回车 → 开网页标签
await page.evaluate(() => window.__wsStore.setState({ tabs: [], activeTabId: null }, false))
await page.waitForSelector('[data-testid="start-page"]')
await page.fill('.sp-omni-input', 'example.com')
await page.press('.sp-omni-input', 'Enter')
const webTab = await page.waitForFunction(() => {
  const s = window.__wsStore.getState()
  const t = s.tabs.find((x) => x.kind === 'web')
  return t ? t.kind : null
}, undefined, { timeout: 4000 })
ok(!!webTab, 'omnibox: 网址回车 → 开网页标签(统一 omnibox 语义)')

// 回空态,三动作按钮:新建文档 → CreateModal 开
await page.evaluate(() => { window.__wsStore.setState({ tabs: [], activeTabId: null }, false); window.__wsUI.setState({ createOpen: false }) })
await page.waitForSelector('[data-testid="start-page"]')
await page.click('.sp-act-ink')
ok(await page.evaluate(() => window.__wsUI.getState().createOpen), '动作: 新建文档 → CreateModal 开')

// ---------- ③ UX4v3 对齐:切标签展开+高亮,但绝不滚动侧栏树(真 app 2026-07-14 拍板;探针口径同 e2e/tabs.spec) ----------
// 必须走真实树路径(点 .arc-file 行建的标签才带 fileName/rootId 树联结;openDoc 的标签不触发 F6)。
await page.evaluate(() => window.__wsUI.setState({ createOpen: false })) // 上一断言留下的 modal 罩着侧栏,先收
await page.evaluate(() => window.__wsStore.setState({ tabs: [], activeTabId: null }, false))
await page.waitForSelector('[data-testid="start-page"]')
await page.waitForSelector('.arc-file')
const fileCount = await page.locator('.arc-file').count()
ok(fileCount >= 2, `树里可见文件 ≥2(${fileCount})`)
await page.locator('.arc-file').nth(0).click()
await page.waitForTimeout(120)
await page.locator('.arc-file').nth(1).click()
await page.waitForTimeout(120)
await page.evaluate(() => {
  window.__fileScrolled = false
  const orig = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (...args) {
    if (this.classList && this.classList.contains('arc-file')) window.__fileScrolled = true
    return orig.apply(this, args)
  }
})
await page.evaluate(() => {
  // 切回第一个标签(触发 F6 展开效果——老实现会在 40ms 后 scrollIntoView)
  const s = window.__wsStore.getState()
  s.setActiveTab(s.tabs[0].id)
})
await page.waitForTimeout(300)
const scrolled = await page.evaluate(() => window.__fileScrolled)
ok(scrolled === false, 'UX4v3: 切标签树展开+高亮但不滚动(scrollIntoView 探针未触发)')
const hasActive = await page.evaluate(() => !!document.querySelector('.arc-file.is-active'))
ok(hasActive, 'UX4v3: 高亮仍在(is-active 行存在)')

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
