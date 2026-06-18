// ui-demo 验收审计 · 期望接入（v2 · U2）
// 解析产品层契约 specs/acceptance/editor.expect.md（人写、CODEOWNERS 锁），按 surface 筛出
// ui-demo 适用项，并把证据（evidence.json）与期望 join 成判定层的单一输入 judge-input.json。
//
// 用法：
//   node audit/expectations.mjs                 列出解析到的期望（surface=ui-demo 视角）
//   node audit/expectations.mjs --pair          join evidence.json → judge-input.json
//   node audit/expectations.mjs --pair --surface ui-demo --evidence test-results/audit/evidence.json
//
// 裁判≠运动员：本模块只读 expect.md，不写、不改其判定内容。

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, basename } from 'node:path'

const DEFAULT_EXPECT = fileURLToPath(
  new URL('../../specs/acceptance/editor.expect.md', import.meta.url),
)

// 把 expect.md 解析成 { <id>: {id, title, surface, severity, expect, failIf} }
export function parseExpectations(text) {
  const out = {}
  const blocks = text.split(/^###\s+E:/m).slice(1) // 按 `### E:` 切块
  for (const blk of blocks) {
    const nl = blk.indexOf('\n')
    const head = (nl < 0 ? blk : blk.slice(0, nl)).trim()
    const m = head.match(/^([A-Za-z0-9:_-]+)\s*·\s*(.+)$/) // <id> · <title>
    if (!m) continue
    const id = m[1].trim()
    const body = nl < 0 ? '' : blk.slice(nl + 1)
    const field = (key) => {
      const fm = body.match(new RegExp(`^-\\s*\\*\\*${key}:\\*\\*\\s*(.+)$`, 'm'))
      return fm ? fm[1].trim() : null
    }
    out[id] = {
      id,
      title: m[2].trim(),
      surface: (field('surface') || 'both').toLowerCase(),
      severity: (field('severity') || 'medium').toLowerCase(),
      expect: field('expect'),
      failIf: field('fail-if'),
    }
  }
  return out
}

export function loadExpectations(path = DEFAULT_EXPECT) {
  return parseExpectations(readFileSync(path, 'utf8'))
}

// 在运行面 surface（如 'ui-demo'）上适用的期望：entry.surface === surface 或 'both'。
export function forSurface(map, surface = 'ui-demo') {
  const r = {}
  for (const [id, e] of Object.entries(map))
    if (e.surface === surface || e.surface === 'both') r[id] = e
  return r
}

export function expectationFor(map, scenarioId) {
  return map[scenarioId] || null
}

// evidence.json + 期望 → judge-input.json：每个 scenario 一条自包含记录（截图绝对路径 +
// 内联期望 + 证据摘要），判定层读这一份。surface=app 的期望不会被任何 ui-demo scenario 取到。
export function pair(map, evidence, { surface = 'ui-demo', shotDir } = {}) {
  return evidence
    .filter((ev) => ev.surface === surface || ev.surface === 'both') // app-only scenario 不判
    .map((ev) => {
      const exp = map[ev.id]
      const applicable =
        exp && (exp.surface === surface || exp.surface === 'both') ? exp : null
      return {
        id: ev.id,
        label: ev.label,
        surface: ev.surface,
        mutated: !!ev.mutated,
        screenshot: shotDir ? resolve(shotDir, ev.screenshot) : ev.screenshot,
        expectation: applicable, // null = 无硬期望，判定层走 AI 推断（不崩）
        hasExpectation: !!applicable,
        evidence: {
          driveOut: ev.driveOut,
          dom: ev.dom,
          jsErrors: ev.jsErrors,
        },
      }
    })
}

// ---- CLI ----
const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const arg = (n, d = null) => {
    const i = process.argv.indexOf(n)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
  }
  const has = (n) => process.argv.includes(n)
  const surface = arg('--surface', 'ui-demo')
  const map = loadExpectations(arg('--expect', DEFAULT_EXPECT))

  if (has('--pair')) {
    const shotDir = arg('--shotdir', 'test-results/audit')
    const evPath = arg('--evidence', resolve(shotDir, 'evidence.json'))
    // --stage <中性绝对目录>：把截图拷过去 + judge-input 的 screenshot 指向它。判定 Workflow 的
    // agent cwd 是共享 worktree，会把含 'wordspace-next-ui-demo' 的绝对路径"规整"成 sibling 的
    // 'wordspace-next-demo'、读不到文件 → 假 unsure。stage 到 /tmp 这种无 sibling worktree 的中性
    // 路径就没法被规整。判定层请用 stage 后的 judge-input.json。
    const stageDir = arg('--stage')
    const evidence = JSON.parse(readFileSync(evPath, 'utf8'))
    let records = pair(map, evidence, { surface, shotDir })
    let outPath = arg('--out')
    if (stageDir) {
      mkdirSync(stageDir, { recursive: true })
      records = records.map((r) => {
        const dest = resolve(stageDir, basename(r.screenshot))
        try {
          copyFileSync(r.screenshot, dest)
        } catch {
          /* 截图缺失不致命，judge 退化为读 DOM 证据 */
        }
        return { ...r, screenshot: dest }
      })
      // 省 token（lever A）：把每条记录拆成独立小文件 rec/<id>.json + 一个轻量 index.json。
      // 判定层让每个判官只读自己那条 rec（~3KB），不再 18 个 agent 各把整份 judge-input(~30KB)
      // 重读一遍。index 只放定位字段，judge 据此找到自己的 rec/screenshot。
      const recDir = resolve(stageDir, 'rec')
      mkdirSync(recDir, { recursive: true })
      const index = records.map((r) => {
        const recPath = resolve(recDir, `${r.id}.json`)
        writeFileSync(recPath, JSON.stringify(r, null, 2))
        return {
          id: r.id,
          label: r.label,
          surface: r.surface,
          mutated: !!r.mutated,
          severity: r.expectation?.severity ?? null,
          hasExpectation: r.hasExpectation,
          screenshot: r.screenshot,
          recPath,
        }
      })
      writeFileSync(resolve(stageDir, 'index.json'), JSON.stringify(index, null, 2))
      if (!outPath) outPath = resolve(stageDir, 'judge-input.json')
    }
    if (!outPath) outPath = resolve(shotDir, 'judge-input.json')
    writeFileSync(outPath, JSON.stringify(records, null, 2))
    console.log(
      `[expect] judge-input → ${outPath}（${records.length} scenario，surface=${surface}${
        stageDir ? '，已 stage 到 ' + stageDir + '（含 index.json + rec/）' : ''
      }）`,
    )
    for (const r of records)
      console.log(
        `  ${r.id}\t${r.hasExpectation ? '有期望[' + r.expectation.severity + ']' : '无硬期望(AI 推断)'}`,
      )
  } else {
    const f = forSurface(map, surface)
    console.log(
      `[expect] 共 ${Object.keys(map).length} 条；surface∈{${surface},both} 适用 ${Object.keys(f).length} 条：`,
    )
    for (const e of Object.values(f))
      console.log(`  E:${e.id}\t[${e.surface}/${e.severity}]\t${e.title}`)
    const appOnly = Object.values(map).filter((e) => e.surface === 'app')
    console.log(
      `[expect] surface=app（ui-demo 不判）${appOnly.length} 条：${appOnly
        .map((e) => e.id)
        .join(', ')}`,
    )
  }
}
