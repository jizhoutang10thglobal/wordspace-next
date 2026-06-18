// ui-demo 验收审计 · 取证层（v2 · U1 + U4 mutate 管道）
// 确定性、无 LLM：逐 scenario resetPage → drive → 截图 + DOM 证据 → 写 evidence.json。
// 判定层（.claude/workflows/ui-demo-audit.js）按需读这份证据 + 人写期望判 make-sense。
//
// 用法：
//   node audit/capture.mjs                     跑全部 MVP scenario
//   node audit/capture.mjs --only insert-list  只跑一个
//   node audit/capture.mjs --mutate insert-list 注入「功能坏掉」证据（变异自检 U4）
//   node audit/capture.mjs --url http://localhost:5180/#/docs --out test-results/audit
//   node audit/capture.mjs --list              列出 scenario id 后退出

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchHarness, resetPage } from '../stress/setup.mjs'
import { SCENARIOS, captureCommon, settle } from './scenarios.mjs'
import { MUTATIONS } from './mutations.mjs'

function arg(name, def = null) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const has = (name) => process.argv.includes(name)

const URL = arg('--url', 'http://localhost:5180/#/docs')
const OUT = arg('--out', 'test-results/audit')
const ONLY = arg('--only')
const MUTATE = arg('--mutate') // scenario id：跑它并注入坏证据
const LIST = has('--list')

if (LIST) {
  for (const s of SCENARIOS) console.log(`${s.id}\t[${s.surface}]\t${s.label}`)
  process.exit(0)
}

let scenarios = SCENARIOS
if (MUTATE) scenarios = SCENARIOS.filter((s) => s.id === MUTATE)
else if (ONLY) scenarios = SCENARIOS.filter((s) => s.id === ONLY)
if (!scenarios.length) {
  console.error(`[audit] 没有匹配的 scenario：${MUTATE || ONLY}`)
  process.exit(2)
}
if (MUTATE && !MUTATIONS[MUTATE]) {
  console.error(
    `[audit] scenario「${MUTATE}」没有定义变异注入（mutations.mjs），无法做变异自检`,
  )
  process.exit(2)
}

const run = async () => {
  // 干净输出目录（仅清本次要写的，保留其它）
  mkdirSync(OUT, { recursive: true })

  const { browser, page, errors } = await launchHarness({ url: URL })
  const evidence = []

  for (const sc of scenarios) {
    errors.length = 0
    await resetPage(page)
    const driveOut = await sc.drive(page).catch((e) => ({ error: String(e) }))
    await settle(page)

    // U4：变异注入 —— drive 之后把「功能效果」破坏掉，产出一份「坏证据」喂判官。
    let mutated = false
    if (MUTATE && MUTATIONS[MUTATE]) {
      await MUTATIONS[MUTATE](page, driveOut).catch(() => {})
      await settle(page)
      mutated = true
    }

    const shot = `${sc.id}${mutated ? '.mutated' : ''}.png`
    await page.screenshot({ path: join(OUT, shot) }).catch(() => {})
    const common = await captureCommon(page).catch((e) => ({
      commonError: String(e),
    }))
    const extra = sc.capture
      ? await sc.capture(page, driveOut).catch((e) => ({ captureError: String(e) }))
      : {}

    evidence.push({
      id: sc.id,
      label: sc.label,
      surface: sc.surface,
      mutated,
      screenshot: shot,
      driveOut,
      dom: { ...common, ...extra },
      jsErrors: errors.slice(0, 5),
      ts: Date.now(),
    })
    console.log(
      `[audit] ${sc.id}${mutated ? ' (mutated)' : ''} ✓  blocks=${
        common.blockCount ?? '?'
      }${driveOut?.reason ? '  drive-skip:' + driveOut.reason : ''}`,
    )
  }

  const evidenceFile = MUTATE
    ? join(OUT, `evidence.mutated.${MUTATE}.json`)
    : join(OUT, 'evidence.json')
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
  await browser.close()
  console.log(
    `\n[audit] 证据已写出：${evidenceFile}（${evidence.length} scenario）` +
      `\n[audit] 截图在 ${OUT}/*.png`,
  )
}

run().catch((e) => {
  console.error('[audit] 取证失败：', e)
  process.exit(1)
})

// rmSync/existsSync 预留给将来「清旧证据」；当前保留历史证据不删。
void rmSync
void existsSync
