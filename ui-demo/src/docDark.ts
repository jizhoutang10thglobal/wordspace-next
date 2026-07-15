// 文档反色滤镜配方 — ui-demo 侧镜像。**canonical 正本 = 真 app 的 src/lib/doc-dark-recipe.js**
// (CI node:test 覆盖,U6 直接 require)。因 ui-demo 是独立 Vite 包、无法干净跨 CJS/ESM 边界 import 那个
// CJS 模块,这里镜像一份 —— 改配方两处一起改(值必须逐字一致,U6 就是搬这份)。
import { relativeLuminance } from './luminanceMirror'

export const FILTER = 'invert(1) hue-rotate(180deg)'
const MEDIA_SELECTORS = 'img, video, canvas, svg image, picture, [style*="background-image"]'

// rootSelector: iframe 内注入用 'html'(=documentElement)。bg 强制白 → invert 翻近黑,保证无背景声明的浅色文档也有暗画布。
export function recipeCss(rootSelector = 'html'): string {
  return (
    `${rootSelector}{filter:${FILTER} !important;background-color:#ffffff !important;}` +
    `${rootSelector} :is(${MEDIA_SELECTORS}){filter:${FILTER};}`
  )
}

// 「已暗文档」判定:采样有效画布色(html→body),半透明/透明视为浅色,低于阈值=已暗→跳过滤镜。
export function isAlreadyDark(samples: Array<string | null | undefined>, threshold = 0.35): boolean {
  for (const s of samples) {
    if (!s) continue
    const str = String(s).trim().toLowerCase()
    if (!str || str === 'transparent') continue
    if (/[,/]\s*0(\.0+)?\s*\)$/.test(str)) continue // alpha 0 = 浅色,顺延
    const lum = relativeLuminance(str)
    if (lum == null) continue
    return lum < threshold
  }
  return false
}
