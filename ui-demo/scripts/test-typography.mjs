// 排版数据模型 + 预设 + 字体拼接 + 单位换算 + 预设身份反推 的纯逻辑自查
//（跟 test-page.mjs 同款：esbuild 转译 typography.ts 后跑）。跑法：node scripts/test-typography.mjs
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'typo-test-'))
const out = join(dir, 'typography.mjs')
await build({ entryPoints: [new URL('../src/lib/typography.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, platform: 'neutral' })
const T = await import(pathToFileURL(out))

let fail = 0
const ok = (cond, msg) => {
  if (!cond) { fail++; console.log(`FAIL ${msg}`) }
}
const eq = (a, b, msg) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b)
  if (sa !== sb) { fail++; console.log(`FAIL ${msg}: ${sa} !== ${sb}`) }
}

// --- 预设往返自洽：每个预设反推回它自己 ---
for (const p of T.PRESETS) {
  const r = T.deriveActivePreset(p.page, p.type, null)
  eq(r.presetId, p.id, `预设 ${p.id} 反推回自己`)
  ok(r.isCustom === false, `预设 ${p.id} 非自定义`)
}

// --- 内置预设两两全值不同（防「选 MLA 显示 APA」KTD5①）---
for (let i = 0; i < T.PRESETS.length; i++) {
  for (let j = i + 1; j < T.PRESETS.length; j++) {
    const a = T.PRESETS[i], b = T.PRESETS[j]
    const samePage = JSON.stringify(a.page) === JSON.stringify(b.page)
    const sameType = JSON.stringify(a.type) === JSON.stringify(b.type)
    ok(!(samePage && sameType), `预设 ${a.id} 与 ${b.id} 全值撞车`)
  }
}

// --- 改字号一档 → 脱离预设（自定义·基于原预设）---
{
  const gb = T.getPreset('gb9704')
  const modified = { ...gb.type, body: { ...gb.type.body, sizePt: 15 } }
  const r = T.deriveActivePreset(gb.page, modified, 'gb9704')
  ok(r.isCustom === true, '改字号后 isCustom')
  eq(r.basedOn, 'gb9704', '改字号后 basedOn=原预设')
  eq(r.presetId, null, '改字号后 presetId=null')
}

// --- composeFontFamily：泛型族只出现一次且在最末位（KTD2 correctness 门）---
{
  const s = T.composeFontFamily('times', 'fangsong')
  const parts = s.split(', ')
  const generics = parts.filter((p) => p === 'serif' || p === 'sans-serif')
  eq(generics.length, 1, `serif 组合 泛型唯一 (${s})`)
  ok(parts[parts.length - 1] === 'serif', `serif 组合 泛型在末位 (${s})`)
  ok(parts[0] === '"Times New Roman"', `西文在前 (${s})`)
  ok(parts.includes('FangSong'), `含仿宋栈 (${s})`)
}
{
  const s = T.composeFontFamily('calibri', 'heiti')
  const parts = s.split(', ')
  const generics = parts.filter((p) => p === 'serif' || p === 'sans-serif')
  eq(generics.length, 1, `sans 组合 泛型唯一 (${s})`)
  ok(parts[parts.length - 1] === 'sans-serif', `黑体→sans-serif 末位 (${s})`)
}

// --- 单位换算：恒 mm 往返无损（KTD3）---
ok(Math.abs(T.mmToInch(37) - 1.4566929) < 1e-4, 'mmToInch(37)≈1.4567')
ok(Math.abs(T.inchToMm(T.mmToInch(37)) - 37) < 1e-9, 'mm→inch→mm 往返回 37')

// --- 字号 id↔pt ---
eq(T.zihaoIdToPt('sanhao'), 16, "zihaoIdToPt('sanhao')=16")
eq(T.ptToZihaoId(10.5), 'wuhao', 'ptToZihaoId(10.5)=wuhao')
eq(T.ptToZihaoId(13), null, 'ptToZihaoId(13)=null（非表内不崩）')
eq(T.zihaoIdToPt('nope'), null, 'zihaoIdToPt(未知)=null')

// --- 国标公文硬值钉死（防漂）---
{
  const gb = T.getPreset('gb9704')
  eq(gb.page.margin, { top: 37, right: 26, bottom: 35, left: 28 }, '国标边距 37/26/35/28')
  eq(gb.type.body.lineHeight, { mode: 'fixedPt', value: 29 }, '国标固定行距 29pt')
  eq(gb.type.body.sizePt, 16, '国标正文三号 16pt')
}

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('typography: all passed')
