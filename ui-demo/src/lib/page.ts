// ============================================================================
// 分页文档的纯逻辑：纸张尺寸表、mm→px、分页点计算、打印 CSS 生成。
// 与 React/DOM 无关。产品口径（Colin 2026-07-08 拍板）：分页不是独立 Schema，是 Schema 1 文档的
// 可选版式设置——真 app 入盘 = head 的 <style data-ws-schema-css="page"> 装标准 @page（本就在 Schema 1
// head 白名单内），带且可解析 → 编辑器开分页视图/导出走分页；写坏了只是分页不生效，不降级不换 schema。
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

/** 页间灰缝高度（屏显视觉，打印不存在）。 */
export const PAGE_GAP_PX = 24

export interface BlockPagination {
  /** 每块起始页号（0-based）。 */
  pageOfBlock: number[]
  /**
   * 每块前的切页信息：块 i 开新页时 = 上一页收在块 i-1 后剩下的留白 px（≥0）；
   * 不切页（含首块落在第 1 页顶）= null。
   */
  gapBefore: (number | null)[]
  /** 总页数（≥1；末块后跟显式分页符会带出一张空尾页）。 */
  pageCount: number
  /** 每页顶部所在块的索引（跨页大块占的页也记它自己；空尾页记 blockHeights.length）。 */
  pageStartBlocks: number[]
  /** 最后一页尾部剩余留白 px（撑满末页用；空文档 = 整页内容高）。 */
  lastFill: number
  /** 末块后跟显式分页符时：末块所在页收尾的剩余留白 px（其后是空尾页）；否则 null。 */
  trailingGap: number | null
}

/**
 * 块级分页：从页顶累计块高（含块间距，由调用方计入 blockHeights），
 * 下一块放不下（累计 + 块高 > pageContentH）→ 整块推到下一页，块永不被劈开。
 * - 超页高的单块（巨图/长代码）例外：起点仍从新页开始，允许跨 ceil(h/页高) 页，
 *   下一块从它结束处所在页继续累计；
 * - breakAfter[i] = true（显式分页符）→ 块 i 之后强制结束当前页；
 * - 恰好填满一页（累计 == 页高）不切，下一块自然落到新页（gap = 0）。
 */
export function paginateBlocks(
  blockHeights: number[],
  pageContentH: number,
  breakAfter: boolean[] = [],
): BlockPagination {
  const n = blockHeights.length
  const pageOfBlock: number[] = new Array(n).fill(0)
  const gapBefore: (number | null)[] = new Array(n).fill(null)
  if (!(pageContentH > 0)) {
    // 防御：页高非法 → 全落第 1 页
    return {
      pageOfBlock,
      gapBefore,
      pageCount: 1,
      pageStartBlocks: [0],
      lastFill: 0,
      trailingGap: null,
    }
  }
  const pageStartBlocks: number[] = [0]
  let page = 0
  let y = 0
  let pendingBreak = false
  for (let i = 0; i < n; i++) {
    const h = Math.max(0, blockHeights[i])
    if (pendingBreak || (y > 0 && y + h > pageContentH)) {
      gapBefore[i] = Math.max(0, pageContentH - y)
      page++
      y = 0
      pageStartBlocks.push(i)
      pendingBreak = false
    }
    pageOfBlock[i] = page
    if (h > pageContentH) {
      // 跨页大块：占 ceil(h/页高) 页，占的后续页顶仍是它自己
      const span = Math.ceil(h / pageContentH)
      for (let s = 1; s < span; s++) pageStartBlocks.push(i)
      page += span - 1
      y = h - (span - 1) * pageContentH
    } else {
      y += h
    }
    if (breakAfter[i]) pendingBreak = true
  }
  let pageCount = page + 1
  let lastFill = Math.max(0, pageContentH - y)
  let trailingGap: number | null = null
  if (pendingBreak) {
    // 末块后的分页符：带出一张空尾页
    trailingGap = lastFill
    pageCount++
    pageStartBlocks.push(n)
    lastFill = pageContentH
  }
  return { pageOfBlock, gapBefore, pageCount, pageStartBlocks, lastFill, trailingGap }
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
    // 顶层块整块换页（与屏显块级分页同一决策口径）；超页高的块浏览器会自动放行跨页
    `body>:not(.ws-page-break){break-inside:avoid}`,
    // 与屏显同口径的横向约束：无空格长串必须在纸内折行（pre 同理），不许把打印页横向顶破
    `body{overflow-wrap:anywhere}`,
    `pre{white-space:pre-wrap;overflow-wrap:anywhere}`,
  ].join('\n')
}
