// U2 排版 store 自查（node + localStorage shim）：applyPreset 双写同步 / 脱离保留 lastPresetId /
// 另存重名拒绝 / prune / 持久化落盘（reload 存活）。跑法：node scripts/test-typography-store.mjs
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// --- localStorage shim（store 在 import 时 load()，故必须先装）---
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}

const dir = mkdtempSync(join(tmpdir(), 'typo-store-test-'))
const out = join(dir, 'store.mjs')
await build({ entryPoints: [new URL('../src/mock/typography.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'neutral' })
const S = await import(pathToFileURL(out))
// 注：applyPreset 内部经 usePaged.setConfig 写 localStorage 'ws-paged-docs'，
// 故 page 同步直接读 shim 落盘内容验（不必单独实例化 paged store）。
// paged store（单独 bundle，验 U7 的 prune；与 shim 共享同一份 localStorage）
const pOut = join(dir, 'paged.mjs')
await build({ entryPoints: [new URL('../src/mock/paged.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: pOut, platform: 'neutral' })
const P = await import(pathToFileURL(pOut))

let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.log(`FAIL ${m}`) } }
const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { fail++; console.log(`FAIL ${m}: ${sa} !== ${sb}`) } }
const LSget = (k) => { const v = mem.get(k); return v ? JSON.parse(v) : null }

// --- applyPreset: 双写同步 + lastPresetId ---
S.applyPreset('doc1', 'gb9704')
{
  const d = S.useTypography.getState().getDoc('doc1')
  eq(d.lastPresetId, 'gb9704', 'applyPreset 后 lastPresetId=gb9704')
  eq(d.config.body.sizePt, 16, 'applyPreset 后正文三号 16pt')
  eq(d.config.body.lineHeight, { mode: 'fixedPt', value: 29 }, 'applyPreset 后固定行距 29pt')
  // page 同步：ws-paged-docs 落盘含 doc1 的国标边距
  const paged = LSget('ws-paged-docs')
  eq(paged?.doc1?.margin, { top: 37, right: 26, bottom: 35, left: 28 }, 'applyPreset 同步 page 边距 37/26/35/28')
  // 持久化落盘（reload 存活）
  const docs = LSget('ws-typography-docs')
  eq(docs?.doc1?.lastPresetId, 'gb9704', 'ws-typography-docs 落盘含 lastPresetId')
  ok(docs?.doc1?.config?.body?.sizePt === 16, 'ws-typography-docs 落盘含 config')
}

// --- 改单个控件（脱离）：不传 lastPresetId → 保留 ---
{
  const d = S.useTypography.getState().getDoc('doc1')
  const modified = { ...d.config, body: { ...d.config.body, sizePt: 15 } }
  S.useTypography.getState().setConfig('doc1', modified) // 不传 lastPresetId
  const d2 = S.useTypography.getState().getDoc('doc1')
  eq(d2.lastPresetId, 'gb9704', '脱离后 lastPresetId 仍=gb9704（basedOn 不丢）')
  eq(d2.config.body.sizePt, 15, '脱离后字号=15')
}

// --- 另存自定义预设 + 重名拒绝 + 空名拒绝 ---
{
  const d = S.useTypography.getState().getDoc('doc1')
  const r1 = S.useCustomPresets.getState().saveAs('本公司公文', { size: 'A4' }, d.config)
  eq(r1, { ok: true }, "saveAs('本公司公文') ok")
  ok(S.useCustomPresets.getState().presets.some((p) => p.name === '本公司公文'), '自定义预设列表含之')
  const r2 = S.useCustomPresets.getState().saveAs('本公司公文', { size: 'A4' }, d.config)
  eq(r2, { ok: false, reason: 'duplicate' }, '重名拒绝（不覆盖）')
  const r3 = S.useCustomPresets.getState().saveAs('  ', { size: 'A4' }, d.config)
  eq(r3, { ok: false, reason: 'empty' }, '空名拒绝')
  // 自定义预设落盘
  const presets = LSget('ws-typography-presets')
  ok(Array.isArray(presets) && presets.length === 1, 'ws-typography-presets 落盘 1 个')
}

// --- applyPreset 自定义预设 ---
{
  const custom = S.useCustomPresets.getState().presets[0]
  S.applyPreset('doc2', custom.id)
  const d = S.useTypography.getState().getDoc('doc2')
  eq(d.lastPresetId, custom.id, 'applyPreset 自定义 → lastPresetId=custom id')
  eq(d.config.body.sizePt, custom.type.body.sizePt, 'applyPreset 自定义 → config 应用')
}

// --- prune: 删文档清条目（typography + paged，U7 deleteDoc 接它们）---
{
  S.useTypography.getState().prune('doc1')
  ok(!('doc1' in S.useTypography.getState().docs), 'typography.prune 后 doc1 不在 docs')
  const d = S.useTypography.getState().getDoc('doc1')
  eq(d.lastPresetId, null, 'prune 后 getDoc 回默认（lastPresetId=null）')
  const docs = LSget('ws-typography-docs')
  ok(!(docs && 'doc1' in docs), 'prune 后落盘也无 doc1')
  // paged store 的 prune（P 独立实例，自包含：自己写 dx 再 prune dx）
  ok(typeof P.usePaged.getState().prune === 'function', 'usePaged 有 prune 方法')
  P.usePaged.getState().setConfig('dx', { on: true, size: 'A4', orientation: 'portrait', margin: { top: 1, right: 1, bottom: 1, left: 1 }, pageNumbers: false })
  ok('dx' in (LSget('ws-paged-docs') ?? {}), 'usePaged.setConfig 写入 dx')
  P.usePaged.getState().prune('dx')
  ok(!('dx' in (LSget('ws-paged-docs') ?? {})), 'usePaged.prune 后落盘无 dx（删档清孤儿）')
}

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('typography-store: all passed')
