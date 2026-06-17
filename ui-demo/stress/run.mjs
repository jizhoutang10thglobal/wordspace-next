import { mkdirSync, writeFileSync } from 'node:fs'
import { launchHarness } from './setup.mjs'
import { makeRng, randomSeed } from './rng.mjs'
import { step } from './actions.mjs'
import { runInvariants } from './invariants.mjs'
import { runSelfcheck } from './selfcheck.mjs'

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

// --selfcheck：变异自检模式——注入坏状态、断言对应不变量必翻红（证明门有牙）
if (args.selfcheck) {
  const { results, allHaveTeeth, dumb } = await runSelfcheck(page)
  console.log('[selfcheck] 变异自检结果：')
  for (const r of results) console.log(`  ${r.fired ? '✓' : '✗ 哑门!'} ${r.label}`)
  await browser.close()
  if (allHaveTeeth) {
    console.log('[selfcheck] ✓ 全部翻红 —— 门有牙')
    process.exit(0)
  } else {
    console.log(`[selfcheck] ✗ ${dumb.length} 条该红不红（哑门）：#${dumb.map((d) => d.target).join(',#')}`)
    process.exit(1)
  }
}

const ctx = { errors }

// 初态自检：干净种子文档上 9 条不变量应全过（防误报）
const clean = (await runInvariants(page, ctx)).filter((v) => !v.ok)
console.log(`[stress] 初态不变量：${clean.length ? '违反 ' + JSON.stringify(clean.map((v) => v.id)) : '全过 ✓'}`)
if (clean.length) console.log('[stress] 初态违反详情:', JSON.stringify(clean, null, 1))

// fuzz 主循环——加权动作 + settle + 每步后断言不变量；每条不变量只记首次违反（U4 接最短复现/报告）
const log = []
const hist = {}
const violations = []
const seen = new Set()
for (let i = 0; i < args.steps; i++) {
  const desc = await step(page, rng)
  log.push(desc)
  hist[desc.name] = (hist[desc.name] || 0) + 1
  await settle(page)
  const inv = await runInvariants(page, ctx)
  for (const v of inv) {
    if (!v.ok && !seen.has(v.id)) {
      seen.add(v.id)
      violations.push({ step: i + 1, id: v.id, label: v.label, detail: v.detail, action: desc })
    }
  }
}

const blocks = await page.evaluate(() => document.querySelectorAll('.ws-block').length)
writeFileSync(
  `test-results/stress/actions-${seed}.json`,
  JSON.stringify({ seed, steps: args.steps, log, violations }, null, 2),
)
await page.screenshot({ path: `test-results/stress/run-${seed}.png` })

console.log(`[stress] seed=${seed} steps=${args.steps} 末块数=${blocks} JS错=${errors.length}`)
console.log('[stress] 动作分布:', JSON.stringify(hist))
if (violations.length) {
  console.log(`[stress] ⚠ 抓到 ${violations.length} 类不变量违反:`)
  for (const v of violations) console.log(`  - 第${v.step}步 [#${v.id} ${v.label}] 触发动作=${v.action.name} detail=${JSON.stringify(v.detail)}`)
} else {
  console.log('[stress] ✓ 本轮无不变量违反')
}

await browser.close()
process.exit(violations.length ? 1 : 0)
