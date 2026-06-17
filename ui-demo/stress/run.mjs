import { mkdirSync } from 'node:fs'
import { launchHarness } from './setup.mjs'

// CLI（U6 收口；U1 先够用）：--seed --steps --url --headed --selfcheck --runs
function parseArgs(argv) {
  const a = { seed: null, steps: 300, url: undefined, headed: false, selfcheck: false, runs: 1 }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--headed') a.headed = true
    else if (t === '--selfcheck') a.selfcheck = true
    else if (t === '--seed') a.seed = parseInt(argv[++i], 10)
    else if (t === '--steps') a.steps = parseInt(argv[++i], 10)
    else if (t === '--url') a.url = argv[++i]
    else if (t === '--runs') a.runs = parseInt(argv[++i], 10)
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
mkdirSync('test-results/stress', { recursive: true })

// U1 骨架：连上 → 重置 → 数块 → 截图。fuzz 主循环 / 不变量 / 报告 / 自检在 U2–U5 接上。
const { browser, page, errors } = await launchHarness({ url: args.url, headed: args.headed })
const blocks = await page.evaluate(() => document.querySelectorAll('.ws-block').length)
await page.screenshot({ path: 'test-results/stress/u1-initial.png' })
console.log(
  `[stress] U1 骨架 OK：已连 dev server、重置到种子文档、初始块数=${blocks}、JS 错=${errors.length}`,
)
await browser.close()
