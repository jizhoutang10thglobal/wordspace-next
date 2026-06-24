// 真 app 验收审计 · 期望接入
// 消费**同一份**产品层契约 specs/acceptance/editor.expect.md（人写、CODEOWNERS 锁）——与
// ui-demo 的 ui-demo/audit/ 共享这张「做对了长什么样」的地图，不另维护一份会分叉的期望。
// 本模块按 surface 筛出真 app 适用项（surface ∈ {app, both}），把证据（evidence.json）与期望
// join 成判定层的单一输入 judge-input.json；status=planned 的期望判 pending（功能未做、不判 fail）。
//
// 裁判≠运动员：本模块只读 expect.md，不写、不改其判定内容（解析器是运动员、契约是裁判）。
//
// 用法：
//   node scripts/acceptance-audit/expectations.mjs                列出 app 适用期望
//   node scripts/acceptance-audit/expectations.mjs --pair --stage /tmp/acceptance-audit
//       join evidence.json → judge-input + index.json + rec/<id>.json（同 ui-demo 的 stage 套路）

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, basename } from 'node:path'

const DEFAULT_EXPECT = fileURLToPath(
  new URL('../../specs/acceptance/editor.expect.md', import.meta.url),
)

// 把 expect.md 解析成 { <id>: {id, title, surface, severity, status, expect, failIf} }。
// 与 ui-demo/audit/expectations.mjs 同构（同一份契约的两个 consumer），额外解析 status。
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
      status: (field('status') || 'built').toLowerCase(), // 缺省 built（契约约定）
      expect: field('expect'),
      failIf: field('fail-if'),
    }
  }
  return out
}

export function loadExpectations(path = DEFAULT_EXPECT) {
  return parseExpectations(readFileSync(path, 'utf8'))
}

// 在运行面 surface（真 app = 'app'）上适用的期望：entry.surface === surface 或 'both'。
export function forSurface(map, surface = 'app') {
  const r = {}
  for (const [id, e] of Object.entries(map))
    if (e.surface === surface || e.surface === 'both') r[id] = e
  return r
}

// status=planned 的适用期望（功能未做）→ 审计判 pending、不判 fail，也不需要证据/截图。
export function pendingFor(map, surface = 'app') {
  return Object.values(forSurface(map, surface)).filter((e) => e.status === 'planned')
}

// evidence.json + 期望 → judge-input 记录：每个 scenario 一条自包含记录。
// 只 join surface∈{app,both} 的已跑场景；planned 期望不在证据里（功能没做、没场景跑），单列 pending。
export function pair(map, evidence, { surface = 'app', shotDir } = {}) {
  return evidence
    .filter((ev) => ev.surface === surface || ev.surface === 'both')
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
        expectation: applicable, // null = 无硬期望，判定层走 AI 推断
        hasExpectation: !!applicable,
        evidence: { driveOut: ev.driveOut, dom: ev.dom, jsErrors: ev.jsErrors },
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
  const surface = arg('--surface', 'app')
  const map = loadExpectations(arg('--expect', DEFAULT_EXPECT))
  const pending = pendingFor(map, surface)

  if (has('--pair')) {
    const shotDir = arg('--shotdir', 'test-results/acceptance-audit')
    const evPath = arg('--evidence', resolve(shotDir, 'evidence.json'))
    // --stage <中性绝对目录>：把截图拷过去 + judge-input 的 screenshot 指向它。判定 Workflow 的
    // agent cwd 是共享 worktree，会把含 worktree 名的绝对路径"规整"成 sibling、读不到文件 → 假
    // unsure。stage 到 /tmp 这种无 sibling 的中性路径就没法被规整（同 ui-demo 的实测教训）。
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
      // 省 token：每条记录拆独立小文件 rec/<id>.json + 轻量 index.json（同 ui-demo）。
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
      // pending（planned 功能）单独落一份，判定层报告里列出，不进判定循环。
      writeFileSync(
        resolve(stageDir, 'pending.json'),
        JSON.stringify(
          pending.map((e) => ({ id: e.id, title: e.title, surface: e.surface, severity: e.severity })),
          null,
          2,
        ),
      )
      if (!outPath) outPath = resolve(stageDir, 'judge-input.json')
    }
    if (!outPath) outPath = resolve(shotDir, 'judge-input.json')
    writeFileSync(outPath, JSON.stringify(records, null, 2))
    console.log(
      `[expect] judge-input → ${outPath}（${records.length} 场景，surface=${surface}${
        stageDir ? '，已 stage 到 ' + stageDir + '（含 index.json + rec/ + pending.json）' : ''
      }）`,
    )
    for (const r of records)
      console.log(
        `  ${r.id}\t${r.hasExpectation ? '有期望[' + r.expectation.severity + ']' : '无硬期望(AI 推断)'}`,
      )
    if (pending.length)
      console.log(
        `[expect] pending（planned 功能未做、判 pending 不判 fail）${pending.length} 条：${pending
          .map((e) => e.id)
          .join(', ')}`,
      )
  } else {
    const f = forSurface(map, surface)
    console.log(
      `[expect] 共 ${Object.keys(map).length} 条；surface∈{${surface},both} 适用 ${Object.keys(f).length} 条：`,
    )
    for (const e of Object.values(f))
      console.log(
        `  E:${e.id}\t[${e.surface}/${e.severity}${e.status === 'planned' ? '/planned' : ''}]\t${e.title}`,
      )
    const skip = Object.values(map).filter((e) => e.surface === 'ui-demo')
    console.log(
      `[expect] surface=ui-demo（app 不判）${skip.length} 条：${skip.map((e) => e.id).join(', ')}`,
    )
    if (pending.length)
      console.log(
        `[expect] 其中 planned（判 pending）${pending.length} 条：${pending.map((e) => e.id).join(', ')}`,
      )
  }
}
