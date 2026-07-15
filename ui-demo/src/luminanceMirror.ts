// WCAG 相对亮度 — ui-demo 侧镜像。**canonical 正本 = 真 app 的 src/lib/luminance.js**(CI 覆盖)。
// 只镜像 docDark 需要的 relativeLuminance(解析 hex/rgb + 亮度)。改逻辑两处一起改。
function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(color: string): number | null {
  const s = String(color).trim()
  let r: number, g: number, b: number
  if (s[0] === '#') {
    let hex = s.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length === 8) hex = hex.slice(0, 6)
    if (hex.length !== 6) return null
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
    if (!m) return null
    r = +m[1]; g = +m[2]; b = +m[3]
  }
  if (![r, g, b].every((v) => Number.isFinite(v))) return null
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
