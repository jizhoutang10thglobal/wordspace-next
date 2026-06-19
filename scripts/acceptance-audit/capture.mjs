// 真 app 验收审计 · 取证层（驱动真 Electron app）
// 确定性、无 LLM：逐 scenario 打开样张 → drive（真鼠标/键盘）→ 截图 + DOM 证据 → 写 evidence.json。
// 判定层（.claude/workflows/acceptance-audit.js）按需读这份证据 + 同一份人写期望判 make-sense。
//
// 用法：
//   node scripts/acceptance-audit/capture.mjs                  跑全部场景
//   node scripts/acceptance-audit/capture.mjs --only insert-list
//   node scripts/acceptance-audit/capture.mjs --mutate insert-list   注入「功能坏掉」证据（变异自检）
//   node scripts/acceptance-audit/capture.mjs --mutate all
//   node scripts/acceptance-audit/capture.mjs --list
//
// 真 Electron e2e 只能在有显示器的环境跑（宿主 macOS / CI 的 xvfb job）——同 e2e/app.spec.js 的约束。

import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { _electron as electron } from '@playwright/test'
import { SCENARIOS, captureCommon, settle, DOC } from './scenarios.mjs'
import { MUTATIONS } from './mutations.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const has = (n) => process.argv.includes(n)

const OUT = arg('--out', resolve(ROOT, 'test-results/acceptance-audit'))
const ONLY = arg('--only')
const MUTATE = arg('--mutate') // scenario id | 'all'
const MUTATE_ALL = MUTATE === 'all'

if (has('--list')) {
  for (const s of SCENARIOS) console.log(`${s.id}\t[${s.surface}]\t${s.label}`)
  process.exit(0)
}

let scenarios = SCENARIOS
if (MUTATE_ALL) scenarios = SCENARIOS.filter((s) => MUTATIONS[s.id])
else if (MUTATE) scenarios = SCENARIOS.filter((s) => s.id === MUTATE)
else if (ONLY) scenarios = SCENARIOS.filter((s) => s.id === ONLY)
if (!scenarios.length) {
  console.error(`[audit] 没有匹配的 scenario：${MUTATE || ONLY}`)
  process.exit(2)
}
if (MUTATE && !MUTATE_ALL && !MUTATIONS[MUTATE]) {
  console.error(`[audit] scenario「${MUTATE}」没有定义变异注入（mutations.mjs），无法做变异自检`)
  process.exit(2)
}

async function launch() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wsaudit-'))
  const app = await electron.launch({
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, WS2_USERDATA: join(tmpDir, 'userdata'), WS2_NO_CLOSE_DIALOG: '1' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1280, height: 900 })
  // iframe sandbox 无 allow-modals：openDoc 用 confirm（换文档丢弃确认）、addLink 用 prompt（父窗口）。
  // 默认 stub：confirm=true、alert 吞掉；prompt 由各 scenario 自己按需覆盖。
  await page.evaluate(() => { window.confirm = () => true; window.alert = () => {} })
  return { app, page, tmpDir }
}

async function openDoc(ctx, html) {
  const docPath = join(ctx.tmpDir, 'audit-doc.html')
  await writeFile(docPath, html, 'utf8')
  await ctx.app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', p)
  }, docPath)
  ctx.frame = ctx.page.frameLocator('#doc-frame')
  await ctx.frame.locator('body').waitFor({ state: 'visible', timeout: 5000 })
  await ctx.page.waitForTimeout(400)
  return ctx.frame
}

const run = async () => {
  mkdirSync(OUT, { recursive: true })
  const ctx = await launch()
  const errors = []
  ctx.page.on('console', (m) => {
    // 排除 sandbox iframe 挡脚本的良性提示（那正是沙箱安全在生效）
    if (m.type() === 'error' && !/sandboxed|allow-scripts|blocked script|content security policy/i.test(m.text()))
      errors.push(m.text())
  })

  const evidence = []
  for (const sc of scenarios) {
    errors.length = 0
    await openDoc(ctx, sc.fixture || DOC) // 每场景重开干净样张，隔离
    const driveOut = await sc.drive(ctx).catch((e) => ({ error: String(e) }))
    await settle(ctx.page)

    // 变异注入：drive 之后把「功能效果」破坏掉，产出一份「坏证据」喂判官（门有没有牙）。
    let mutated = false
    const mut = MUTATE ? MUTATIONS[sc.id] : null
    if (mut) {
      await mut(ctx, driveOut).catch(() => {})
      await settle(ctx.page)
      mutated = true
    }

    const shot = `${sc.id}${mutated ? '.mutated' : ''}.png`
    await ctx.page.screenshot({ path: join(OUT, shot) }).catch(() => {})
    const common = await captureCommon(ctx).catch((e) => ({ commonError: String(e) }))
    const extra = sc.capture ? await sc.capture(ctx, driveOut).catch((e) => ({ captureError: String(e) })) : {}

    evidence.push({
      id: sc.id,
      label: sc.label,
      surface: sc.surface,
      mutated,
      screenshot: shot,
      driveOut,
      dom: { ...common, ...extra },
      jsErrors: errors.slice(0, 5),
    })
    console.log(
      `[audit] ${sc.id}${mutated ? ' (mutated)' : ''} ✓  blocks=${common.blockCount ?? '?'}` +
        `${driveOut?.reason ? '  drive-skip:' + driveOut.reason : ''}`,
    )
  }

  const evidenceFile = MUTATE_ALL
    ? join(OUT, 'evidence.mutated.json')
    : MUTATE
      ? join(OUT, `evidence.mutated.${MUTATE}.json`)
      : join(OUT, 'evidence.json')
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {})
  await ctx.app.close().catch(() => {})
  console.log(`\n[audit] 证据 → ${evidenceFile}（${evidence.length} 场景）\n[audit] 截图 → ${OUT}/*.png`)
}

run().catch((e) => {
  console.error('[audit] 取证失败：', e)
  process.exit(1)
})
