import { mkdirSync, writeFileSync } from 'node:fs'
import { launchHarness } from './setup.mjs'
import { makeRng, randomSeed } from './rng.mjs'
import { step } from './actions.mjs'

// 等 React 提交 + 一帧绘制落定（比固定 ms 更稳，压低时序发散）
async function settle(page) {
  await page
    .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
    .catch(() => {})
}

// CLI：--seed --steps --url --headed --selfcheck --runs（U6 收口）
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
const seed = args.seed ?? randomSeed()
mkdirSync('test-results/stress', { recursive: true })

const { browser, page, errors } = await launchHarness({ url: args.url, headed: args.headed })
const rng = makeRng(seed)

// U2：fuzz 主循环——加权动作 + settle。U3 会在每步后接不变量断言，U4 接取证/最短复现。
const log = []
const hist = {}
for (let i = 0; i < args.steps; i++) {
  const desc = await step(page, rng)
  log.push(desc)
  hist[desc.name] = (hist[desc.name] || 0) + 1
  await settle(page) // 等 React/contentEditable rAF 落定（不变量检查也靠这一拍）
}

const blocks = await page.evaluate(() => document.querySelectorAll('.ws-block').length)
writeFileSync(
  `test-results/stress/actions-${seed}.json`,
  JSON.stringify({ seed, steps: args.steps, log }, null, 2),
)
await page.screenshot({ path: `test-results/stress/run-${seed}.png` })

console.log(`[stress] seed=${seed} steps=${args.steps} 末块数=${blocks} JS错=${errors.length}`)
console.log('[stress] 动作分布:', JSON.stringify(hist))
if (errors.length) console.log('[stress] JS 错(前3):', errors.slice(0, 3))

await browser.close()
