// ============================================================================
// 分页文档的纯逻辑：纸张尺寸表、mm→px、分页点计算、打印 CSS 生成。
// 与 React/DOM 无关，语义对齐真 app 设计（docs/brainstorms/2026-07-08-schema-2-paged-doc.md）。
// ============================================================================

export type PaperSize = 'A4' | 'A3' | 'Letter' | 'Legal'
export type Orientation = 'portrait' | 'landscape'

export interface PageMargin {
  top: number
  right: number
  bottom: number
  left: number
}

/** 每文档的「分页文档」配置（存 localStorage，按 doc id）。 */
export interface PageConfig {
  on: boolean
  size: PaperSize
  orientation: Orientation
  margin: PageMargin // mm
  pageNumbers: boolean // 导出 PDF 页脚页码
}

/** 纸张 mm 尺寸（竖向：宽 × 高）。 */
export const PAPERS: Record<PaperSize, { label: string; w: number; h: number }> = {
  A4: { label: 'A4', w: 210, h: 297 },
  A3: { label: 'A3', w: 297, h: 420 },
  Letter: { label: 'Letter', w: 215.9, h: 279.4 },
  Legal: { label: 'Legal', w: 215.9, h: 355.6 },
}

/** 边距预设（mm）。宽 = 上下普通、左右加宽（Word 同款语义）。 */
export const MARGIN_PRESETS: { key: string; label: string; margin: PageMargin }[] = [
  { key: 'normal', label: '普通', margin: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  { key: 'narrow', label: '窄', margin: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
  { key: 'wide', label: '宽', margin: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } },
]

export const DEFAULT_PAGE_CONFIG: PageConfig = {
  on: false,
  size: 'A4',
  orientation: 'portrait',
  margin: MARGIN_PRESETS[0].margin,
  pageNumbers: false,
}

/** mm → CSS px（96dpi）。A4 竖宽 210mm ≈ 794px，与现有导出常量一致。 */
export const mmToPx = (mm: number): number => (mm * 96) / 25.4

/** 页面盒 px 尺寸：纸宽高（按方向翻转）+ 边距 + 内容区宽高。 */
export function pageBoxPx(cfg: PageConfig): {
  paperW: number
  paperH: number
  margin: { top: number; right: number; bottom: number; left: number }
  contentW: number
  contentH: number
} {
  const p = PAPERS[cfg.size]
  const landscape = cfg.orientation === 'landscape'
  const paperW = mmToPx(landscape ? p.h : p.w)
  const paperH = mmToPx(landscape ? p.w : p.h)
  const margin = {
    top: mmToPx(cfg.margin.top),
    right: mmToPx(cfg.margin.right),
    bottom: mmToPx(cfg.margin.bottom),
    left: mmToPx(cfg.margin.left),
  }
  return {
    paperW,
    paperH,
    margin,
    contentW: paperW - margin.left - margin.right,
    contentH: paperH - margin.top - margin.bottom,
  }
}

/**
 * 分页点计算：内容总高 totalH、页内高 pageH、显式分页符的 top 位置 breakTops，
 * 返回各分页点的 y（相对内容顶部，升序）。
 * - 自然分页：每 pageH 一切；
 * - 分页符：在该位置强制切页，并从该位置重新累计页高；
 * - 0 / totalH 两端不出线；分页符乱序会排序、同位置合并、越界忽略。
 */
export function computeBoundaries(
  totalH: number,
  pageH: number,
  breakTops: number[] = [],
): number[] {
  if (!(pageH > 0) || !(totalH > 0)) return []
  const breaks = [...new Set(breakTops.filter((t) => t > 0 && t < totalH))].sort(
    (a, b) => a - b,
  )
  const out: number[] = []
  let start = 0
  for (const b of breaks) {
    for (let y = start + pageH; y < b; y += pageH) out.push(y)
    out.push(b)
    start = b
  }
  for (let y = start + pageH; y < totalH; y += pageH) out.push(y)
  return out
}

/** @page 的 size 值（'A4 portrait' / 'Letter landscape'…）。Letter/Legal 是合法关键字。 */
export const pageSizeCss = (cfg: PageConfig): string =>
  `${cfg.size} ${cfg.orientation}`

/**
 * 打印样式（导出 PDF = 浏览器打印预览做真验证）：@page 纸张/边距 + 分页符 break-after。
 * 页码用 CSS @page margin box（Chromium 131+ 支持；老浏览器忽略、只是没页码）。
 */
export function buildPrintCss(cfg: PageConfig): string {
  const m = cfg.margin
  const footer = cfg.pageNumbers
    ? `@bottom-center{content:counter(page) " / " counter(pages);font-size:9pt;color:#78716c;font-family:-apple-system,system-ui,sans-serif}`
    : ''
  return [
    `@page{size:${pageSizeCss(cfg)};margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${footer}}`,
    `.ws-page-break{break-after:page;visibility:hidden;height:0;margin:0;border:none;padding:0}`,
  ].join('\n')
}
