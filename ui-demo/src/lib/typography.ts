// ============================================================================
// 分页文档「标准化排版层」纯逻辑：排版配置模型、五个具名标准预设、字号↔pt、
// 中西文字体回退栈、单位换算、预设身份反推。与 React/DOM 无关（node 可单测）。
//
// 分层数据模型（Colin 2026-07-24 KTD1）：PageConfig（纯 @page 几何）不动，本文件的
// TypographyConfig（正文 + 标题各级）与之并列；一个 Preset = { page: Partial<PageConfig>, type }。
//
// i18n：字体/字号在本文件里一律用 **ASCII id**（fangsong / sanhao），不放中文——中文是
// 用户可见标签，属该翻的 chrome，显示时走 i18n（zh='仿宋'、en='FangSong'，在 U5 的 editor 字典落）。
// 见 docs/plans/2026-07-24-002-feat-schema-2-paged-typography-plan.md。
// ============================================================================

import type { PageConfig } from './page'

// ---- 排版配置类型 ----------------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/** 行距：倍数（1.0/1.5/2.0）或固定值 N 磅（国标是固定值）。 */
export interface LineHeight {
  mode: 'multiple' | 'fixedPt'
  value: number
}

/** 正文排版。cnFont/latinFont = 字体 id（见 FONT_STACKS）。firstIndentEm = 首行缩进（em；
 *  CJK 2字符=2em；西文 0.5in≈3em @12pt——em 跟随字号，去掉随字号 JS 重算）。 */
export interface BodyStyle {
  cnFont: string // 字体 id
  latinFont: string // 字体 id
  sizePt: number
  lineHeight: LineHeight
  firstIndentEm: number
  align: TextAlign
  spaceBeforePt: number
  spaceAfterPt: number
}

/** 单级标题样式。国标靠字体区分层级、APA 靠对齐/粗细/斜体，故每级独立一组。 */
export interface HeadingStyle {
  cnFont: string
  latinFont: string
  sizePt: number
  bold: boolean
  italic?: boolean
  align?: TextAlign // 缺省 = 左（H1 可居中）
}

/** 每文档排版配置。headings 含 h1–h4（H4 = 本期给 ui-demo 加第 4 级标题块，KTD8）。 */
export interface TypographyConfig {
  body: BodyStyle
  headings: { h1: HeadingStyle; h2: HeadingStyle; h3: HeadingStyle; h4: HeadingStyle }
}

/** 具名标准预设 = 纸设置（Partial）+ 字设置。 */
export interface Preset {
  id: string
  nameKey?: string // 内置预设：i18n key，渲染处 t(nameKey)
  name?: string // 用户自定义预设：字面名（另存时输入），显示优先于 nameKey
  page: Partial<Pick<PageConfig, 'size' | 'orientation' | 'margin'>>
  type: TypographyConfig
}

// ---- 字体（KTD4：id → web-safe 具体字体名回退栈，均不含泛型族）----------------

/** 字体 id → web-safe 具体字体名回退栈（**不含** serif/sans-serif；泛型由 composeFontFamily
 *  末尾统一加一个，KTD2）。CJK 意图字体是系统替身（RISK-B：无仿宋_GB2312 等，视觉≈）。 */
export const FONT_STACKS: Record<string, string[]> = {
  fangsong: ['FangSong', 'STFangsong', 'FangSong_GB2312', 'SimSun'],
  songti: ['SimSun', 'Songti SC', 'Noto Serif CJK SC'],
  xiaobiaosong: ['SimSun', 'Songti SC'], // 小标宋特殊字体，用宋体替身
  heiti: ['SimHei', 'Heiti SC', 'PingFang SC', 'Noto Sans CJK SC'],
  kaiti: ['KaiTi', 'STKaiti', 'Kaiti SC'],
  yahei: ['Microsoft YaHei', 'PingFang SC', 'Heiti SC'],
  times: ['Times New Roman', 'Times'],
  calibri: ['Calibri', 'Carlito'],
  arial: ['Arial', 'Helvetica'],
}

/** 中文字体下拉可选 id（U5 用；标签走 i18n）。 */
export const CN_FONT_IDS = ['fangsong', 'songti', 'xiaobiaosong', 'heiti', 'kaiti', 'yahei']
/** 西文字体下拉可选 id。 */
export const LATIN_FONT_IDS = ['times', 'calibri', 'arial']

/** 中文字体 id 的泛型族——决定 composeFontFamily 末尾那个唯一泛型。 */
const SANS_CN = new Set(['heiti', 'yahei'])
export const genericOf = (cnFontId: string): 'serif' | 'sans-serif' =>
  SANS_CN.has(cnFontId) ? 'sans-serif' : 'serif'

const needsQuote = (name: string): boolean => !/^[A-Za-z0-9-]+$/.test(name)
const q = (name: string): string => (needsQuote(name) ? `"${name}"` : name)

/**
 * 中西文分设 → 一个 font-family 串（KTD2）：西文名在前、中文名在后、**末尾唯一泛型**。
 * 关键：栈内绝不含泛型（否则中间的泛型会把 CJK 字符截胡到系统衬线、仿宋永远够不着——
 * 评审实证的假字体 bug）。终末泛型由中文字体性质决定（仿宋/宋=serif、黑体=sans-serif）。
 * 注意：computed fontFamily 读的是这个声明串，不是真 per-glyph 渲染字体——它验不了分派对错。
 */
export function composeFontFamily(latinFontId: string, cnFontId: string): string {
  const latin = FONT_STACKS[latinFontId] ?? [latinFontId]
  const cn = FONT_STACKS[cnFontId] ?? [cnFontId]
  const names = [...latin, ...cn].map(q)
  return [...names, genericOf(cnFontId)].join(', ')
}

// ---- 中文字号 ↔ pt（附录 B，Word 通行值；id ASCII，标签走 i18n）-------------

/** 字号 id → pt。顺序 = 下拉展示顺序（大→小）。 */
export const ZIHAO_PT: { id: string; pt: number }[] = [
  { id: 'chuhao', pt: 42 },
  { id: 'xiaochu', pt: 36 },
  { id: 'yihao', pt: 26 },
  { id: 'xiaoyi', pt: 24 },
  { id: 'erhao', pt: 22 },
  { id: 'xiaoer', pt: 18 },
  { id: 'sanhao', pt: 16 },
  { id: 'xiaosan', pt: 15 },
  { id: 'sihao', pt: 14 },
  { id: 'xiaosi', pt: 12 },
  { id: 'wuhao', pt: 10.5 },
  { id: 'xiaowu', pt: 9 },
  { id: 'liuhao', pt: 7.5 },
  { id: 'xiaoliu', pt: 6.5 },
  { id: 'qihao', pt: 5.5 },
  { id: 'bahao', pt: 5 },
]

/** pt → 字号 id（无对应返回 null，如 13pt）。 */
export const ptToZihaoId = (pt: number): string | null =>
  ZIHAO_PT.find((z) => z.pt === pt)?.id ?? null

/** 字号 id → pt（无对应返回 null）。 */
export const zihaoIdToPt = (id: string): number | null =>
  ZIHAO_PT.find((z) => z.id === id)?.pt ?? null

// ---- 单位换算（KTD3：存储恒 mm，只换显示）-----------------------------------

export const mmToInch = (mm: number): number => mm / 25.4
export const inchToMm = (inch: number): number => inch * 25.4

/** pt → CSS px（96dpi）：1pt = 1/72in、1px = 1/96in → px = pt·96/72。 */
export const ptToPx = (pt: number): number => (pt * 96) / 72

// ---- 排版 → scoped CSS 文本（U3；正文。标题 U4 追加）------------------------

/**
 * 生成注入分页文档 article 的 scoped 排版 CSS（KTD6）。用 `.ws-doc-paged .ws-p` / `.ws-h*`
 * 类级特异性盖过 base（低层显式声明 font-size 等，祖先 inline 继承压不过——评审 correctness）。
 * 纯函数，可 node 单测；真渲染由 U3/U4 的 Playwright computed-style 门验。正文 U3、标题各级 U4。
 */
export function buildTypographyCss(t: TypographyConfig): string {
  const b = t.body
  const ff = composeFontFamily(b.latinFont, b.cnFont)
  const size = ptToPx(b.sizePt)
  const lh = b.lineHeight.mode === 'fixedPt' ? `${ptToPx(b.lineHeight.value)}px` : `${b.lineHeight.value}`
  const mt = ptToPx(b.spaceBeforePt)
  const mb = ptToPx(b.spaceAfterPt)
  const rules = [
    // 正文 + 列表项：字体/字号/行距（列表项硬编 line-height:1.7 也要盖）
    `.ws-doc-paged .ws-p,.ws-doc-paged .ws-ul li,.ws-doc-paged .ws-ol li{font-family:${ff};font-size:${size}px;line-height:${lh}}`,
    // 段落：首行缩进(em 跟字号)/对齐/段前段后
    `.ws-doc-paged .ws-p{text-indent:${b.firstIndentEm}em;text-align:${b.align};margin-top:${mt}px;margin-bottom:${mb}px}`,
  ]
  // 标题各级 H1–H4（U4）：国标靠字体区分层级、APA 靠对齐/粗细/斜体
  for (const lv of [1, 2, 3, 4] as const) {
    const h = t.headings[`h${lv}` as 'h1' | 'h2' | 'h3' | 'h4']
    const parts = [`font-family:${composeFontFamily(h.latinFont, h.cnFont)}`, `font-size:${ptToPx(h.sizePt)}px`, `font-weight:${h.bold ? 700 : 400}`]
    if (h.italic) parts.push('font-style:italic')
    if (h.align) parts.push(`text-align:${h.align}`)
    rules.push(`.ws-doc-paged .ws-h${lv}{${parts.join(';')}}`)
  }
  return rules.join('')
}

// ---- 五个具名标准预设（值来自 origin 附录 A；权威值硬编、通用默认可调）-------
// 边距 margin = {top,right,bottom,left}，单位 mm（恒 mm，KTD3）。

const TNR = 'times'

/** 国标公文 GB/T 9704-2012（硬值，权威）。固定行距 29pt = 版心225mm÷22行导出（U1 冻结，AE2 断言）。 */
const GB_OFFICIAL: Preset = {
  id: 'gb9704',
  nameKey: 'template.presetGbOfficial',
  page: { size: 'A4', orientation: 'portrait', margin: { top: 37, right: 26, bottom: 35, left: 28 } },
  type: {
    body: { cnFont: 'fangsong', latinFont: TNR, sizePt: 16, lineHeight: { mode: 'fixedPt', value: 29 }, firstIndentEm: 2, align: 'justify', spaceBeforePt: 0, spaceAfterPt: 0 },
    headings: {
      h1: { cnFont: 'xiaobiaosong', latinFont: TNR, sizePt: 22, bold: false, align: 'center' },
      h2: { cnFont: 'heiti', latinFont: TNR, sizePt: 16, bold: false },
      h3: { cnFont: 'kaiti', latinFont: TNR, sizePt: 16, bold: false },
      h4: { cnFont: 'fangsong', latinFont: TNR, sizePt: 16, bold: true },
    },
  },
}

/** 中文学术论文（通用默认，各校可调）。 */
const CN_THESIS: Preset = {
  id: 'cn-thesis',
  nameKey: 'template.presetThesis',
  page: { size: 'A4', orientation: 'portrait', margin: { top: 25.4, right: 31.8, bottom: 25.4, left: 31.8 } },
  type: {
    body: { cnFont: 'songti', latinFont: TNR, sizePt: 12, lineHeight: { mode: 'multiple', value: 1.5 }, firstIndentEm: 2, align: 'justify', spaceBeforePt: 0, spaceAfterPt: 0 },
    headings: {
      h1: { cnFont: 'heiti', latinFont: TNR, sizePt: 16, bold: true, align: 'center' },
      h2: { cnFont: 'heiti', latinFont: TNR, sizePt: 15, bold: true },
      h3: { cnFont: 'heiti', latinFont: TNR, sizePt: 14, bold: true },
      h4: { cnFont: 'heiti', latinFont: TNR, sizePt: 12, bold: true },
    },
  },
}

/** 中文商务（通用默认）。 */
const CN_BUSINESS: Preset = {
  id: 'cn-business',
  nameKey: 'template.presetBusiness',
  page: { size: 'A4', orientation: 'portrait', margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  type: {
    body: { cnFont: 'yahei', latinFont: 'calibri', sizePt: 12, lineHeight: { mode: 'multiple', value: 1.5 }, firstIndentEm: 0, align: 'left', spaceBeforePt: 0, spaceAfterPt: 6 },
    headings: {
      h1: { cnFont: 'yahei', latinFont: 'calibri', sizePt: 20, bold: true },
      h2: { cnFont: 'yahei', latinFont: 'calibri', sizePt: 16, bold: true },
      h3: { cnFont: 'yahei', latinFont: 'calibri', sizePt: 14, bold: true },
      h4: { cnFont: 'yahei', latinFont: 'calibri', sizePt: 12, bold: true },
    },
  },
}

/** APA（第7版，权威）。Letter/1in 边距/Times 12pt/双倍/首行缩进 0.5in≈3em/左对齐。 */
const APA: Preset = {
  id: 'apa',
  nameKey: 'template.presetApa',
  page: { size: 'Letter', orientation: 'portrait', margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  type: {
    body: { cnFont: 'songti', latinFont: TNR, sizePt: 12, lineHeight: { mode: 'multiple', value: 2.0 }, firstIndentEm: 3, align: 'left', spaceBeforePt: 0, spaceAfterPt: 0 },
    headings: {
      h1: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, align: 'center' },
      h2: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, align: 'left' },
      h3: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, italic: true, align: 'left' },
      h4: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, align: 'left' },
    },
  },
}

/** MLA（第9版，权威）。与 APA 同 Letter/Times/双倍，靠标题对齐（H1 左非居中）区分。 */
const MLA: Preset = {
  id: 'mla',
  nameKey: 'template.presetMla',
  page: { size: 'Letter', orientation: 'portrait', margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  type: {
    body: { cnFont: 'songti', latinFont: TNR, sizePt: 12, lineHeight: { mode: 'multiple', value: 2.0 }, firstIndentEm: 3, align: 'left', spaceBeforePt: 0, spaceAfterPt: 0 },
    headings: {
      h1: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, align: 'left' },
      h2: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: true, align: 'left' },
      h3: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: false, italic: true, align: 'left' },
      h4: { cnFont: 'songti', latinFont: TNR, sizePt: 12, bold: false, align: 'left' },
    },
  },
}

/** 内置预设库（下拉顺序）。两两全值必须不同（KTD5 断言，test-typography 守）。 */
export const PRESETS: Preset[] = [GB_OFFICIAL, CN_THESIS, CN_BUSINESS, APA, MLA]

/** 默认排版（未套预设的分页文档起点）= 国标公文（中文主力）。 */
export const DEFAULT_TYPOGRAPHY: TypographyConfig = GB_OFFICIAL.type

export const getPreset = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)

// ---- 预设身份反推（KTD5：只比声明键 + 撞车 tie-break）------------------------

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** 当前 page 是否匹配某预设声明过的 page 键（只比预设 Partial 里有的键）。 */
function pageMatches(partial: Preset['page'], full: Pick<PageConfig, 'size' | 'orientation' | 'margin'>): boolean {
  if (partial.size !== undefined && partial.size !== full.size) return false
  if (partial.orientation !== undefined && partial.orientation !== full.orientation) return false
  if (partial.margin !== undefined && !deepEq(partial.margin, full.margin)) return false
  return true
}

export interface ActivePreset {
  presetId: string | null // 命中的预设 id；null = 自定义
  isCustom: boolean
  basedOn: string | null // 自定义时 = 最近一次选的预设 id
}

/**
 * 反推当前配置属于哪个具名预设（KTD5）。全值匹配→预设名；否则「自定义·基于 lastPresetId」。
 * 只比预设声明过的 page 键 + 全部 type。多个匹配时用 lastPresetId tie-break，
 * 保证「选 MLA 显示 MLA」不误显示成 APA。
 */
export function deriveActivePreset(
  page: Pick<PageConfig, 'size' | 'orientation' | 'margin'>,
  type: TypographyConfig,
  lastPresetId: string | null,
): ActivePreset {
  const matches = PRESETS.filter((p) => pageMatches(p.page, page) && deepEq(p.type, type))
  if (matches.length === 0) return { presetId: null, isCustom: true, basedOn: lastPresetId }
  const chosen = (lastPresetId && matches.find((m) => m.id === lastPresetId)) || matches[0]
  return { presetId: chosen.id, isCustom: false, basedOn: chosen.id }
}
