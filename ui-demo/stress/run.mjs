import { mkdirSync, writeFileSync } from 'node:fs'
import { launchHarness, resetPage } from './setup.mjs'
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
const clean0 = (await runInvariants(page, ctx)).filter((v) => !v.ok)
console.log(`[stress] 初态不变量：${clean0.length ? '违反 ' + JSON.stringify(clean0.map((v) => v.id)) : '全过 ✓'}`)

// fuzz 主循环：--runs 个种子，每个 --steps 步；每步后断言不变量、每条只记首次违反 + 存复现日志。
const findings = [] // { seed, step, id, label, detail, action }
for (let run = 0; run < args.runs; run++) {
  const runSeed = (seed + run) >>> 0
  if (run > 0) { await resetPage(page); errors.length = 0 }
  const rng = makeRng(runSeed)
  const log = []
  const seen = new Set()
  let firstViolStep = null
  for (let i = 0; i < args.steps; i++) {
    const desc = await step(page, rng)
    log.push(desc)
    await settle(page)
    const inv = await runInvariants(page, ctx)
    for (const v of inv) {
      if (!v.ok && !seen.has(v.id)) {
        seen.add(v.id)
        findings.push({ seed: runSeed, step: i + 1, id: v.id, label: v.label, detail: v.detail, action: desc })
        if (firstViolStep === null) firstViolStep = i + 1
      }
    }
  }
  // 存这一 run 的复现日志（种子+完整动作序列）；有违反则截图
  writeFileSync(`test-results/stress/actions-${runSeed}.json`, JSON.stringify({ seed: runSeed, steps: args.steps, log }, null, 2))
  if (firstViolStep !== null) await page.screenshot({ path: `test-results/stress/viol-${runSeed}.png` })
}

await browser.close()

// 人话报告（R5）
const lines = [`# Stress 报告`, ``, `- 种子: ${seed}${args.runs > 1 ? `..${(seed + args.runs - 1) >>> 0}` : ''}（${args.runs} run × ${args.steps} 步）`, `- 初态不变量: ${clean0.length ? '违反 ' + clean0.map((v) => '#' + v.id) : '全过 ✓'}`, `- 抓到不变量违反: ${findings.length}`, ``]
if (findings.length) {
  lines.push(`## Findings`, ``)
  for (const f of findings) {
    lines.push(`### #${f.id} ${f.label}`)
    lines.push(`- 种子 \`${f.seed}\` 第 ${f.step} 步触发；触发动作 \`${f.action.name}\``)
    lines.push(`- 复现: \`npm run stress -- --seed ${f.seed} --steps ${f.step}\``)
    lines.push(`- detail: \`${JSON.stringify(f.detail)}\``)
    lines.push(``)
  }
} else {
  lines.push(`✓ 本次未发现不变量违反。`)
}
writeFileSync('test-results/stress/report.md', lines.join('\n'))

if (findings.length) {
  console.log(`[stress] ⚠ 抓到 ${findings.length} 类不变量违反（报告 test-results/stress/report.md）：`)
  for (const f of findings) console.log(`  - seed=${f.seed} 第${f.step}步 [#${f.id} ${f.label}] 动作=${f.action.name}`)
} else {
  console.log(`[stress] ✓ ${args.runs} run × ${args.steps} 步：无不变量违反`)
}
process.exit(findings.length ? 1 : 0)
