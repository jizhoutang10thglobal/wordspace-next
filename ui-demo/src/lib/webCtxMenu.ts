// 网页右键菜单的纯逻辑 builder（对齐真 app 的 src/lib/web-context-menu.js）。
// 六分节按序（链接 / 图片 / 选中 / 编辑框 / 导航 / 页面），节内条目无对应上下文时整节不出现；
// 危险 scheme（javascript:/data:/file:）链接整节不出——只放行 http(s)。
import { t } from '../i18n'

export type CtxItem = { id: string; label: string; enabled?: boolean } | { sep: true }
export type CtxInfo = { linkUrl?: string; imgUrl?: string; selection?: string; editable?: boolean }
export type CtxCtx = { canGoBack: boolean; canGoForward: boolean }

const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u)

// 拷链接前清洗追踪参数（utm_* / fbclid / gclid …），功能参数（?id=）保留。
const TRACKING = /^(utm_.+|fbclid|gclid|dclid|yclid|msclkid|mc_eid|igshid|spm|ref_src)$/i
export function cleanShareUrl(raw: string): string {
  try {
    const u = new URL(raw)
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return raw
  }
}

// 选中文字进搜索菜单 label：折叠空白 + 按码点截断 20 字（不切断 emoji）。
function trunc(text: string): string {
  const cps = Array.from(text.replace(/\s+/g, ' ').trim())
  return cps.length > 20 ? cps.slice(0, 20).join('') + '…' : cps.join('')
}

export function buildWebCtx(info: CtxInfo, ctx: CtxCtx): CtxItem[] {
  const sections: CtxItem[][] = []

  if (info.linkUrl && isHttp(info.linkUrl)) {
    sections.push([
      { id: 'open-link', label: t('browser.ctxOpenLinkNewTab') },
      { id: 'open-link-bg', label: t('browser.ctxOpenLinkBgTab') },
      { id: 'copy-link', label: t('browser.ctxCopyLink') },
      { id: 'save-link', label: t('browser.ctxSaveLink') }, // 下载恢复(Colin 2026-07-17 拍板,标准档);走同一下载管线
    ])
  }

  if (info.imgUrl) {
    const img: CtxItem[] = [{ id: 'copy-image', label: t('browser.ctxCopyImage') }]
    if (isHttp(info.imgUrl)) {
      img.push({ id: 'copy-image-url', label: t('browser.ctxCopyImageUrl') })
      img.push({ id: 'save-image', label: t('browser.ctxSaveImage') }) // 同上:2026-07-17 恢复下载;isHttp 门沿用(危险 scheme 不出)
    }
    sections.push(img)
  }

  if (info.selection && info.selection.trim()) {
    sections.push([
      { id: 'copy-selection', label: t('browser.ctxCopy') },
      { id: 'search-selection', label: t('browser.ctxSearchSelection', { q: trunc(info.selection) }) }, // ui-demo 的搜索引擎是虚构的 Glass（不是 Bing，避免误导成"克隆了 Bing"）
    ])
  }

  if (info.editable) {
    sections.push([
      { id: 'cut', label: t('browser.ctxCut') },
      { id: 'copy', label: t('browser.ctxCopy') },
      { id: 'paste', label: t('browser.ctxPaste') },
      { id: 'select-all', label: t('browser.ctxSelectAll') },
    ])
  }

  sections.push([
    { id: 'nav-back', label: t('common.back'), enabled: ctx.canGoBack },
    { id: 'nav-forward', label: t('browser.ctxForward'), enabled: ctx.canGoForward },
    { id: 'reload', label: t('browser.ctxReload') },
  ])
  sections.push([
    { id: 'copy-page-url', label: t('browser.ctxCopyPageLink') },
    { id: 'export-pdf', label: t('browser.ctxExportPdf') },
  ])

  // 拼成 template：空节丢弃，节间恰一条分隔符。
  const out: CtxItem[] = []
  sections.filter((s) => s.length).forEach((s, i) => {
    if (i > 0) out.push({ sep: true })
    out.push(...s)
  })
  return out
}
