// 浏览器下载原型（标准档，2026-07-17 恢复拍板）——真浏览器烟测。
// 跑法：node scripts/test-downloads.mjs [url]（默认 http://localhost:5230/，本 feature 的专用 dev 端口）。
// 覆盖 plan U1–U5 全场景：seed/零态/触发/并发进度环/取消/固定失败/重试/刷新中断/清空语义/
// AE1 同名消歧(含清空后 diskNames 仍查重)/CAP/右键存储/危险 scheme 回归/toast 三连/截断。
// 强断言口径（仓规）：量 boundingBox / computedStyle / 真实文本与数值，不查 class 存在性。
//
// 变异自检（两个探针，先 commit 再变异，变异翻红 + 还原翻绿才算门有牙）：
//   ① 打掉 rehydrate 钩子——把 mock/downloads.ts merge 里的
//      `e.state === 'downloading' ? { ...e, state: 'interrupted' as const } : e` 改为直接 `e`
//      → 「AE2 刷新中断」用例必翻红（reload 后还是 downloading = 僵尸进度）。
//   ② 打掉 diskNames 查重——把 startDownload 的 taken 集合里 `...s.diskNames` 删掉
//      → 「AE1 清空后同名仍避开」用例必翻红（清空记录后同名下载退回原名 = 覆盖磁盘文件）。
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://localhost:5230/'
const browser = await chromium.launch()
// locale 锁 zh-CN：chrome 文案跟随语言，断言按中文文本，别让无头环境漂到 en。
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg) } else console.log('ok  ', msg) }
const dl = () => page.evaluate(() => window.__wsDownloads.getState())
const entry = (pred) => page.evaluate((p) => {
  const es = window.__wsDownloads.getState().entries
  return es.find((e) => e.filename.includes(p)) ?? null
}, pred)
const waitSeams = async () => page.waitForFunction(() => !!window.__wsStore && !!window.__wsUI && !!window.__wsDownloads)
const openPopover = async () => {
  if (!(await page.$('.dlp'))) { await page.click('[data-dl-anchor]'); await page.waitForSelector('.dlp') }
}
const closePopover = async () => {
  if (await page.$('.dlp-veil')) { await page.mouse.click(1200, 850); await page.waitForTimeout(150) }
}
// 行内操作按钮集合（title 文案）——逐状态操作集与 HTD 表逐格比对用
const rowActs = (needle) => page.evaluate((n) => {
  const row = [...document.querySelectorAll('.dl-row')].find((r) => r.querySelector('.dl-name')?.title.includes(n))
  return row ? [...row.querySelectorAll('.dl-act')].map((b) => b.title) : null
}, needle)
const clickRowAct = async (needle, title) => {
  await page.evaluate(({ n, t }) => {
    const row = [...document.querySelectorAll('.dl-row')].find((r) => r.querySelector('.dl-name')?.title.includes(n))
    const btn = row && [...row.querySelectorAll('.dl-act')].find((b) => b.title === t)
    if (!btn) throw new Error(`row act not found: ${n} / ${t}`)
    btn.click()
  }, { n: needle, t: title })
}

await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.removeItem('wordspace-demo')
  localStorage.removeItem('wordspace-browser')
  localStorage.removeItem('wordspace-downloads')
  localStorage.removeItem('ws-language')
})
await page.reload({ waitUntil: 'networkidle' })
await waitSeams()

// —— 1. seed：1 completed + 1 fileMissing；diskNames 只含 completed 的名 ——
{
  const s = await dl()
  ok(s.entries.length === 2 && s.entries.some((e) => e.state === 'completed') && s.entries.some((e) => e.state === 'fileMissing'),
    `seed: 1 completed + 1 fileMissing（实际 ${s.entries.map((e) => e.state).join(',')}）`)
  ok(s.diskNames.length === 1 && s.diskNames[0] === s.entries.find((e) => e.state === 'completed')?.filename,
    'seed: diskNames 只含 completed 的名（fileMissing 不占名）')
}

// —— 2. 工具栏入口：零在途 = 纯图标常显、无环无徽标（P1）——
{
  const box = await page.$eval('[data-dl-anchor]', (el) => el.getBoundingClientRect())
  ok(box.width >= 20 && box.height >= 20, `入口: 图标常显（${Math.round(box.width)}x${Math.round(box.height)}）`)
  ok(!(await page.$('.dl-ring')) && !(await page.$('.dl-badge')), '入口: 零在途无进度环无徽标')
}

// —— 3. popover + seed 行的逐状态操作集（HTD 表逐格）——
{
  await openPopover()
  const box = await page.$eval('.dlp', (el) => el.getBoundingClientRect())
  ok(box.width >= 300 && box.height > 80, `popover: 真实渲染（${Math.round(box.width)}x${Math.round(box.height)}）`)
  ok((await rowActs('品牌视觉规范'))?.join('|') === '在访达中显示|从记录中移除', 'HTD: 完成行 = 访达+移除')
  ok((await rowActs('团队合影'))?.join('|') === '从记录中移除', 'HTD: fileMissing 行 = 仅移除')
  const cMiss = await page.$eval('.dl-row.is-missing .dl-name', (el) => getComputedStyle(el).color)
  const cNorm = await page.$eval('.dl-row:not(.is-missing) .dl-name', (el) => getComputedStyle(el).color)
  ok(cMiss !== cNorm, `fileMissing: 置灰（computed ${cMiss} ≠ ${cNorm}）`)
  // 访达 = 演示 toast，绝无打开语义（AE3/R11）
  await clickRowAct('品牌视觉规范', '在访达中显示')
  await page.waitForSelector('.ws-toast')
  const toastTxt = await page.$eval('.ws-toast', (el) => el.textContent)
  ok(toastTxt.includes('演示') && toastTxt.includes('已在访达中定位'), `AE3: 访达=演示 toast（${toastTxt.slice(0, 30)}）`)
}

// —— 4. 清空记录：终态消失；diskNames 刻意不动（R9 + KTD）——
{
  const before = (await dl()).diskNames.join('|')
  await page.click('.dlp-clear')
  await page.waitForTimeout(150)
  const s = await dl()
  ok(s.entries.length === 0, '清空: 终态记录全消失')
  ok(s.diskNames.join('|') === before, '清空: diskNames 不动（磁盘占名账保留）')
  // 零态文案（P1）
  const emptyTxt = await page.$eval('.dlp-empty', (el) => el.textContent)
  ok(emptyTxt.includes('还没有下载记录'), '零态: 空态文案可见')
}

// —— 5. veil 关闭：点内容区（含网页区坐标）即关（KTD veil 层）——
{
  await page.mouse.click(900, 500)
  await page.waitForTimeout(150)
  ok(!(await page.$('.dlp')), 'veil: 点网页区坐标关闭 popover')
}

// —— 6. mock 站触发 + AE1 同名二连下 + 行内取消 ——
{
  await page.evaluate(() => window.__wsStore.getState().openWebTab('https://flowdesk.app', 'FlowDesk'))
  await page.waitForSelector('.fd-dl-btn')
  await page.click('.fd-dl-btn >> nth=0') // macOS 版 ~6s
  await page.waitForTimeout(250)
  const mac1 = await entry('FlowDesk-2.0.1.dmg')
  ok(mac1 && mac1.state === 'downloading' && mac1.sizeBytes === 14_889_780,
    `触发: macOS 版条目正确（${mac1?.filename} ${mac1?.sizeBytes}）`)
  const startToast = await page.$$eval('.ws-toast', (els) => els.map((e) => e.textContent).join(';'))
  ok(startToast.includes('开始下载'), `toast: 开始 neutral（${startToast.slice(0, 40)}）`)
  // AE1：第二条开始那刻就叫 (1)
  await page.click('.fd-dl-btn >> nth=0')
  await page.waitForTimeout(250)
  const s = await dl()
  ok(s.entries[0].filename === 'FlowDesk-2.0.1 (1).dmg',
    `AE1: 同名二连下,第二条开始即 (1)（实际 ${s.entries[0].filename}）`)
  // 行内取消（真点按钮,不走 seam）
  await openPopover()
  ok((await rowActs('(1).dmg'))?.join('|') === '取消', 'HTD: 进行中行 = 仅取消')
  await clickRowAct('(1).dmg', '取消')
  await page.waitForTimeout(150)
  ok((await entry('(1).dmg'))?.state === 'canceled', '取消: 在途转 canceled')
  ok((await rowActs('(1).dmg'))?.join('|') === '重新下载|从记录中移除', 'HTD: 已取消行 = 重试+移除')
  await closePopover()
}

// —— 7. 并发 + 进度环（P2：聚合、徽标、DOM 环与数据一致）——
{
  await page.click('.fd-dl-btn >> nth=2') // 离线安装包 680MB ~30s
  await page.waitForTimeout(400)
  ok(!!(await page.$('.dl-ring')), '进度环: 有在途时出现')
  ok((await page.$eval('.dl-badge', (el) => el.textContent)) === '2', '徽标: 并发计数 = 2')
  const stroke = await page.$eval('.dl-ring-bar', (el) => getComputedStyle(el).stroke)
  ok(stroke !== 'none' && stroke !== '', `进度环: 细线真着色（computed stroke=${stroke}）`)
  const pctOf = async () => {
    const dom = await page.$eval('.dl-ring-bar', (el) => {
      const C = 2 * Math.PI * 8
      return 1 - parseFloat(el.getAttribute('stroke-dashoffset')) / C
    })
    const data = await page.evaluate(() => {
      const s = window.__wsDownloads.getState()
      const batch = s.entries.filter((e) => s.batchIds.includes(e.id))
      const recv = batch.reduce((a, e) => a + e.receivedBytes, 0)
      const tot = batch.reduce((a, e) => a + e.sizeBytes, 0)
      return tot ? recv / tot : 0
    })
    return { dom, data }
  }
  const a = await pctOf()
  await page.waitForTimeout(700)
  const b = await pctOf()
  ok(b.data > a.data, `进度: 聚合百分比单调（${(a.data * 100).toFixed(1)}% → ${(b.data * 100).toFixed(1)}%）`)
  ok(Math.abs(b.dom - b.data) < 0.05, `进度环: DOM 环与数据一致（环 ${(b.dom * 100).toFixed(1)}% vs 数据 ${(b.data * 100).toFixed(1)}%）`)
  // 完成一条,环不复位（批次口径:completed 留在分子分母）
  await page.waitForFunction(() => window.__wsDownloads.getState().entries.some((e) => e.filename === 'FlowDesk-2.0.1.dmg' && e.state === 'completed'), null, { timeout: 10_000 })
  ok(!!(await page.$('.dl-ring')), '进度环: 一条完成另一条在途,环不消失')
  const c = await pctOf()
  ok(c.data >= b.data, `进度环: 完成不回退（${(b.data * 100).toFixed(1)}% → ${(c.data * 100).toFixed(1)}%）`)
}

// —— 8. 完成:success toast + 「显示」打开 popover;diskNames 落账;localStorage 持久 ——
{
  await page.waitForSelector('.ws-toast.ws-toast-success')
  const txt = await page.$eval('.ws-toast.ws-toast-success', (el) => el.textContent)
  ok(txt.includes('已下载') && txt.includes('显示'), `toast: 完成 success+action（${txt.slice(0, 40)}）`)
  await page.click('.ws-toast-action')
  await page.waitForSelector('.dlp')
  ok(true, 'toast:「显示」真打开 popover')
  await closePopover()
  const s = await dl()
  ok(s.diskNames.includes('FlowDesk-2.0.1.dmg'), 'diskNames: 完成落账')
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('wordspace-downloads')).state)
  ok(persisted.entries.some((e) => e.filename === 'FlowDesk-2.0.1.dmg' && e.state === 'completed'),
    '持久化: completed 条目已写 localStorage')
}

// —— 9. 固定失败（40%）+ danger toast + 重试=新条目置顶 ——
{
  await page.click('.fd-dl-btn >> nth=1') // Windows 版 failAt 0.4
  await page.waitForFunction(() => window.__wsDownloads.getState().entries.some((e) => e.filename.includes('Setup') && e.state === 'failed'), null, { timeout: 8000 })
  const win = await entry('Setup')
  const ratio = win.receivedBytes / win.sizeBytes
  ok(ratio > 0.38 && ratio < 0.42, `固定失败: 恰在 ~40% 转 failed（实际 ${(ratio * 100).toFixed(1)}%）`)
  const dtoast = await page.$$eval('.ws-toast', (els) => els.map((e) => e.textContent).join(';'))
  ok(dtoast.includes('下载失败'), `toast: 失败 danger（${dtoast.slice(0, 40)}）`)
  await openPopover()
  ok((await rowActs('Setup'))?.join('|') === '重新下载|从记录中移除', 'HTD: 失败行 = 重试+移除')
  await clickRowAct('Setup', '重新下载')
  await page.waitForTimeout(250)
  const s = await dl()
  ok(s.entries[0].filename === 'FlowDesk-Setup-2.0.1.exe' && s.entries[0].state === 'downloading',
    `重试: 新条目置顶重下（${s.entries[0].filename}）`)
  ok(s.entries.filter((e) => e.filename.includes('Setup')).length === 2, '重试: 原失败条目原地保留')
  await clickRowAct('Setup', '取消') // 收掉重试的在途(它也会 40% 失败,不等)
  await page.waitForTimeout(150)
  await closePopover()
}

// —— 10. AE1 扩展（探针②的靶子）:清空后 diskNames 仍查重,同名不回退原名;在途不被清 ——
{
  await openPopover()
  await page.click('.dlp-clear')
  await page.waitForTimeout(150)
  await closePopover()
  const s1 = await dl()
  ok(s1.entries.length === 1 && s1.entries[0].filename.includes('离线') && s1.entries[0].state === 'downloading',
    '清空: 在途条目不受影响')
  ok(s1.diskNames.includes('FlowDesk-2.0.1.dmg'), '清空: diskNames 仍在')
  await page.click('.fd-dl-btn >> nth=0') // 同名再下
  await page.waitForTimeout(250)
  const s2 = await dl()
  ok(s2.entries[0].filename === 'FlowDesk-2.0.1 (1).dmg',
    `AE1+R9: 清空后同名仍避开 diskNames → (1)（实际 ${s2.entries[0].filename}）`)
  await page.evaluate((id) => window.__wsDownloads.getState().cancelDownload(id), s2.entries[0].id)
}

// —— 11. AE2（探针①的靶子）:在途中刷新 = interrupted,无僵尸进度;中断 toast ——
{
  const big1 = await entry('离线')
  ok(big1.state === 'downloading' && big1.receivedBytes > 0, `刷新前: 大文件在途（${(big1.receivedBytes / big1.sizeBytes * 100).toFixed(1)}%）`)
  await page.reload({ waitUntil: 'networkidle' })
  await waitSeams()
  const big2 = await entry('离线')
  ok(big2.state === 'interrupted', `AE2: 刷新后在途转 interrupted（实际 ${big2.state}）`)
  const r1 = big2.receivedBytes
  await page.waitForTimeout(700)
  const r2 = (await entry('离线')).receivedBytes
  ok(r1 === r2, `AE2: 进度冻结无僵尸定时器（${r1} == ${r2}）`)
  const itoast = await page.$$eval('.ws-toast', (els) => els.map((e) => e.textContent).join(';')).catch(() => '')
  ok(itoast.includes('个下载已中断'), `toast: 启动中断计数条（${itoast.slice(0, 40)}）`)
  // 中断行可重试
  await openPopover()
  ok((await rowActs('离线'))?.join('|') === '重新下载|从记录中移除', 'HTD: 已中断行 = 重试+移除')
  await clickRowAct('离线', '重新下载')
  await page.waitForTimeout(250)
  const s = await dl()
  ok(s.entries[0].filename.includes('离线') && s.entries[0].state === 'downloading', '重试: 中断条目可重下')
  await clickRowAct('离线', '取消')
  await page.waitForTimeout(150)
  await closePopover()
}

// —— 12. 长文件名中段截断:两端保留(扩展名/后缀),title 全名 ——
{
  const longName = '二〇二六年第三季度产品路线图与竞品对比分析报告-最终定稿版本 (1).pdf'
  await page.evaluate((n) => window.__wsDownloads.getState().startDownload({ filename: n, sourceUrl: 'https://x.test/long.pdf', sizeBytes: 100000, durationMs: 600000 }), longName)
  await openPopover()
  const row = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.dl-row')].find((r) => r.querySelector('.dl-name')?.title.includes('二〇二六'))
    const name = el?.querySelector('.dl-name')
    return name ? { text: name.textContent, title: name.title } : null
  })
  ok(row && row.text.includes('…') && row.text.endsWith('(1).pdf') && row.title === longName,
    `截断: 中段省略、扩展名与 (n) 后缀保留、title 全名（${row?.text}）`)
  await clickRowAct('二〇二六', '取消')
  await closePopover()
}

// —— 13. CAP 100:第 101 条挤掉最老终态,在途绝不挤 ——
{
  await page.evaluate(() => {
    const mk = (i) => ({ id: `syn-${i}`, filename: `syn-${i}.bin`, sourceUrl: 'https://x.test/s', sizeBytes: 1000, receivedBytes: 1000, state: 'completed', startedAt: 1000 + i, durationMs: 1000 })
    // 99 终态 + 1 在途(放最老端,证明挤的是终态不是在途)
    const inflight = { id: 'syn-live', filename: 'syn-live.bin', sourceUrl: 'https://x.test/s', sizeBytes: 1e9, receivedBytes: 0, state: 'downloading', startedAt: 1, durationMs: 1e9 }
    const list = [...Array.from({ length: 99 }, (_, i) => mk(99 - i)), inflight]
    window.__wsDownloads.setState({ entries: list, batchIds: [], diskNames: [] })
  })
  await page.evaluate(() => window.__wsDownloads.getState().startDownload({ filename: 'cap-probe.bin', sourceUrl: 'https://x.test/c', sizeBytes: 1e9, durationMs: 1e9 }))
  const s = await dl()
  ok(s.entries.length === 100, `CAP: 总数封在 100（实际 ${s.entries.length}）`)
  ok(s.entries[0].filename === 'cap-probe.bin', 'CAP: 新条目在顶')
  ok(!s.entries.some((e) => e.id === 'syn-1'), 'CAP: 挤掉的是最老终态条目')
  ok(s.entries.some((e) => e.id === 'syn-live'), 'CAP: 最老端的在途条目不被挤')
  await page.evaluate(() => {
    const st = window.__wsDownloads.getState()
    for (const e of st.entries) if (e.state === 'downloading') st.cancelDownload(e.id)
  })
}

// —— 14. 右键「存储图片 / 链接另存为」+ 危险 scheme 回归 ——
{
  await page.evaluate(() => window.__wsStore.getState().openWebTab('https://news.design/today', 'Designer News'))
  await page.waitForSelector('.nw-hero-media')
  await page.click('.nw-hero-media', { button: 'right' })
  await page.waitForSelector('.web-ctx')
  await page.click('.web-ctx-item:has-text("存储图片")')
  await page.waitForTimeout(250)
  const img = await entry('hero.jpg')
  ok(img && img.state === 'downloading', `右键存图: hero.jpg 走下载管线（${img?.filename}）`)
  await page.click('.nw-hero-body h1', { button: 'right' })
  await page.waitForSelector('.web-ctx')
  await page.click('.web-ctx-item:has-text("链接另存为")')
  await page.waitForTimeout(250)
  const lnk = await entry('tenthglobal.com.html')
  ok(lnk && lnk.state === 'downloading', `右键另存: URL 派生文件名（${lnk?.filename}）`)
  // 危险 scheme:链接整节(含另存)不出——既有门回归
  await page.evaluate(() => {
    const a = document.createElement('div')
    a.setAttribute('data-ctx-href', 'javascript:alert(1)')
    a.id = 'evil-probe'
    a.textContent = 'x'
    a.style.cssText = 'position:fixed;left:700px;top:450px;z-index:99;padding:8px'
    document.querySelector('.webpage').appendChild(a)
  })
  await page.click('#evil-probe', { button: 'right' })
  await page.waitForSelector('.web-ctx')
  const items = await page.$$eval('.web-ctx-item', (els) => els.map((e) => e.textContent))
  ok(!items.includes('链接另存为') && !items.some((i) => i.includes('在新标签页打开')),
    'scheme 门: javascript: 链接整节不出（含另存为）')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.getElementById('evil-probe')?.remove())
  await page.evaluate(() => {
    const st = window.__wsDownloads.getState()
    for (const e of st.entries) if (e.state === 'downloading') st.cancelDownload(e.id)
  })
}

// —— 15. 截图存证（亮/暗 popover 开启态,四状态同屏）——非断言,给暗色手查 ——
{
  await page.evaluate(() => localStorage.removeItem('wordspace-downloads'))
  await page.reload({ waitUntil: 'networkidle' })
  await waitSeams()
  await page.evaluate(() => window.__wsStore.getState().openWebTab('https://flowdesk.app', 'FlowDesk'))
  await page.waitForSelector('.fd-dl-btn')
  await page.click('.fd-dl-btn >> nth=1') // Windows → 会失败
  await page.waitForFunction(() => window.__wsDownloads.getState().entries.some((e) => e.state === 'failed'), null, { timeout: 8000 })
  await page.click('.fd-dl-btn >> nth=2') // 大文件 → 在途
  await page.waitForTimeout(1200)
  await openPopover()
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/ws-downloads-light.png' })
  // 暗图走用户真实路径:预设外观偏好 → 整页重载(首帧即暗) → 重建同款场景。
  // ⚠ 别用「中途 setAttribute('data-theme')」再截图:计算样式会变暗,但 headless Chromium 在
  // 网页标签(半透明合成层)场景下光栅化出**陈旧的亮色帧**——实测复现,截出来的"暗图"是白的,
  // 且无断言时静默假绿。下面的亮度强断言就是防这门再哑(读 computed 亮度,不查 class/attr)。
  await page.evaluate(() => localStorage.setItem('ws-appearance', 'dark'))
  await page.reload({ waitUntil: 'networkidle' })
  await waitSeams()
  await page.evaluate(() => window.__wsStore.getState().openWebTab('https://flowdesk.app', 'FlowDesk'))
  await page.waitForSelector('.fd-dl-btn')
  await page.click('.fd-dl-btn >> nth=2') // 大文件 → 在途(fail/interrupted/seed 各态已在记录里)
  await page.waitForTimeout(1200)
  await openPopover()
  await page.waitForTimeout(400)
  const darkLum = await page.evaluate(() => {
    const lum = (el) => {
      const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number)
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255
    }
    return { sidebar: lum(document.querySelector('.arc-sidebar')), popover: lum(document.querySelector('.dlp')) }
  })
  ok(darkLum.sidebar < 0.3, `暗态侧栏亮度 < 0.3(实测 ${darkLum.sidebar.toFixed(2)})`)
  ok(darkLum.popover < 0.3, `暗态 popover 亮度 < 0.3(实测 ${darkLum.popover.toFixed(2)})`)
  await page.screenshot({ path: '/tmp/ws-downloads-dark.png' })
  await page.evaluate(() => localStorage.setItem('ws-appearance', 'system'))
  console.log('shot /tmp/ws-downloads-light.png + /tmp/ws-downloads-dark.png')
}

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
