// ============================================================================
// 图片摄入管线（doc-images spec Phase 1：data: 内联 + 降采样护栏）。
// 决策逻辑（类型白名单 / 缩放规划 / 体积预算）是纯函数，canvas 编码只在 ingestImage 里。
// 护栏来源 docs/schema-1-draft-v0.md §5：长边 ≤1600、单图 base64 ≤1.5MB（data: URI
// 实测 ~2MB 起卡 DOM，留余量）；拒 SVG（能内嵌脚本，与校验器同口径）。
// ============================================================================

export const MAX_EDGE = 1600
export const MAX_BASE64_BYTES = 1.5 * 1024 * 1024

// 位图白名单。svg 显式排除；其余罕见类型（bmp/tiff…）走解码失败兜底。
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']

export function acceptsImageType(mime: string): boolean {
  return ACCEPTED.includes(mime.toLowerCase())
}

/** 长边超限则等比缩到 maxEdge，否则原尺寸。 */
export function planResize(
  w: number,
  h: number,
  maxEdge = MAX_EDGE,
): { w: number; h: number; scaled: boolean } {
  const edge = Math.max(w, h)
  if (edge <= maxEdge || edge <= 0) return { w, h, scaled: false }
  const k = maxEdge / edge
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true }
}

/** base64 体积预算：data URL 的逗号后长度即 base64 字节数。 */
export function fitsBudget(dataUrl: string, maxBytes = MAX_BASE64_BYTES): boolean {
  const i = dataUrl.indexOf(',')
  return i >= 0 && dataUrl.length - i - 1 <= maxBytes
}

// ---- 块 HTML 的 canonical 构造/解析（图片块 block.html 的唯一来源，勿手拼）----
// 两形态都是 Schema 合法顶层块：裸 <img>；有说明时 <figure><img><figcaption>。

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function imageBlockHtml(src: string, alt: string, caption?: string): string {
  const img = `<img src="${src}" alt="${esc(alt)}">`
  const cap = (caption ?? '').trim()
  return cap ? `<figure>${img}<figcaption>${esc(cap)}</figcaption></figure>` : img
}

export function parseImageBlockHtml(
  html: string,
): { src: string; alt: string; caption: string } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const img = doc.querySelector('img')
  if (!img) return null
  return {
    src: img.getAttribute('src') ?? '',
    alt: img.getAttribute('alt') ?? '',
    caption: doc.querySelector('figcaption')?.textContent ?? '',
  }
}

// ---- 摄入：File/Blob → 降采样 → data: URL ----

export type IngestResult =
  | { ok: true; src: string; width: number; height: number }
  | { ok: false; reason: 'type' | 'budget' | 'decode' }

export async function ingestImage(file: File | Blob): Promise<IngestResult> {
  if (!acceptsImageType(file.type)) return { ok: false, reason: 'type' }
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file) // EXIF 方向在解码时归正
  } catch {
    return { ok: false, reason: 'decode' }
  }
  try {
    const { w, h, scaled } = planResize(bmp.width, bmp.height)
    // gif 不重编码（重编码会杀动图）；未缩放的 png/webp 也原样内联，避免无谓质量损失
    if (!scaled && (file.type === 'image/gif' || file.size <= MAX_BASE64_BYTES * 0.75)) {
      const raw = await blobToDataUrl(file)
      if (fitsBudget(raw)) return { ok: true, src: raw, width: w, height: h }
      if (file.type === 'image/gif') return { ok: false, reason: 'budget' } // gif 不能有损压，直接拒
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'decode' }
    ctx.drawImage(bmp, 0, 0, w, h)
    let url = canvas.toDataURL('image/webp', 0.8)
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.8)
    if (!fitsBudget(url)) return { ok: false, reason: 'budget' }
    return { ok: true, src: url, width: w, height: h }
  } finally {
    bmp.close()
  }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

/** 剪贴板/拖放里挑出可摄入的图片文件（文本优先的判定由调用方做）。 */
export function pickImageFiles(list: DataTransfer | null): File[] {
  if (!list) return []
  return Array.from(list.files).filter((f) => acceptsImageType(f.type))
}
