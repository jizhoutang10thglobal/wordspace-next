import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Lock, Globe } from 'lucide-react'
import type { Tab } from '../types'
import { resolve, useBrowser, type Resolved } from '../mock/browser'
import { clipPage } from '../mock/clip'
import { useStore } from '../mock/store'
import { buildWebCtx, cleanShareUrl, type CtxInfo, type CtxItem } from '../lib/webCtxMenu'
import NewTab from './NewTab'
import MockSite from './MockSites'
import WebContextMenu from './WebContextMenu'
import './WebView.css'

// The content area for a tab of kind 'web'. Wordspace is also a real browser, so
// the same surface renders three things depending on the address-bar url:
//   - the new-tab start page
//   - one of our polished mock websites (the demo's "open web")
//   - a real <iframe> for a genuine typed URL (best-effort; many sites block it)
// Above the page sits a slim Wordspace chrome header (security + title + host +
// 「存为文档」) — the same header the real app shows over a WebContentsView.
// 右键网页内容 → 原生风格 DOM 菜单（对齐真 app 的 WebContentsView 右键菜单）。
export default function WebView({ tab }: { tab: Tab }) {
  const r = resolve(tab.url)
  const openWebTab = useStore((s) => s.openWebTab)
  const clipToDoc = useStore((s) => s.clipToDoc)
  const toast = useStore((s) => s.toast)
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[]; info: CtxInfo } | null>(null)

  // 右键：真读光标下的 DOM（链接/图片/选中文字/编辑框），据此算菜单分节——和真 app 一样按上下文变。
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.web-chrome')) return // 网页头是 Wordspace UI，右键不接管
    e.preventDefault()
    const el = e.target as HTMLElement
    const linkEl = el.closest('a[href], [data-ctx-href]')
    const imgEl = el.closest('img, [data-ctx-img]')
    const editEl = el.closest('input, textarea, [contenteditable="true"]')
    const info: CtxInfo = {
      linkUrl: linkEl ? linkEl.getAttribute('href') || linkEl.getAttribute('data-ctx-href') || undefined : undefined,
      imgUrl: imgEl ? (imgEl as HTMLImageElement).src || imgEl.getAttribute('data-ctx-img') || undefined : undefined,
      selection: window.getSelection()?.toString() || undefined,
      editable: !!editEl,
    }
    const items = buildWebCtx(info, {
      canGoBack: useBrowser.getState().canGoBack(),
      canGoForward: useBrowser.getState().canGoForward(),
    })
    setMenu({ x: e.clientX, y: e.clientY, items, info })
  }

  const run = (id: string, info: CtxInfo) => {
    const link = info.linkUrl || ''
    const sel = (info.selection || '').trim()
    switch (id) {
      case 'open-link': openWebTab(link, link); navigate('/docs'); break
      case 'open-link-bg': openWebTab(link, link, true); toast('已在后台标签页打开', 'neutral'); break
      case 'copy-link': navigator.clipboard?.writeText(cleanShareUrl(link)); toast('已拷贝链接', 'success'); break
      case 'copy-image': toast('已拷贝图片', 'success'); break
      case 'copy-image-url': navigator.clipboard?.writeText(info.imgUrl || ''); toast('已拷贝图片地址', 'success'); break
      case 'save-image': toast('图片已存到下载', 'success'); break
      case 'copy-selection': navigator.clipboard?.writeText(sel); toast('已拷贝', 'success'); break
      case 'search-selection': openWebTab(`glass://search?q=${encodeURIComponent(sel)}`, `搜索:${sel.slice(0, 20)}`); navigate('/docs'); break
      case 'cut': case 'copy': case 'paste': case 'select-all': toast('（演示）编辑操作', 'neutral'); break
      case 'nav-back': useBrowser.getState().back(); break
      case 'nav-forward': useBrowser.getState().forward(); break
      case 'reload': toast('已刷新页面', 'neutral'); break
      case 'copy-page-url': navigator.clipboard?.writeText(cleanShareUrl(tab.url)); toast('已拷贝页面链接', 'success'); break
      case 'clip-page': { const res = clipPage(tab.url); clipToDoc(res.title, res.blocks, res.note); break }
      case 'export-pdf': toast('正在导出 PDF…', 'neutral'); break
    }
  }

  // 新标签页没有网页头（对齐真 app：newtab 态不显示 #web-header）。
  if (r.kind === 'newtab') return <NewTab />

  const content =
    r.kind === 'mock' && r.siteKey ? (
      <MockSite siteKey={r.siteKey} query={r.query} />
    ) : (
      // Real external page. Most sites refuse to be framed (X-Frame-Options / CSP),
      // so a slim strip offers opening it in the system browser if it comes up blank.
      <div className="webview">
        <div className="webview-strip">
          <span className="webview-strip-text">
            某些网站不允许内嵌预览,若空白可在系统浏览器打开
          </span>
          <button
            className="webview-strip-open"
            onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink size={13} />
            打开
          </button>
        </div>
        <iframe
          className="webview-frame"
          src={tab.url}
          title={tab.title || tab.url}
          sandbox="allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
        />
      </div>
    )

  return (
    <div className="webpage" onContextMenu={onContextMenu}>
      <WebChrome tab={tab} resolved={r} />
      {content}
      {menu && (
        <WebContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onAction={(id) => run(id, menu.info)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// 网页头：安全指示（锁 / 非安全）+ 标题 + 域名 + 「存为文档」。与文档面包屑同壳。
function WebChrome({ tab, resolved }: { tab: Tab; resolved: Resolved }) {
  const clipToDoc = useStore((s) => s.clipToDoc)
  const url = tab.url
  const secure = /^https:/i.test(url) || url.startsWith('glass://') || url.startsWith('wordspace://')
  let host = ''
  try {
    if (!url.startsWith('glass://') && !url.startsWith('wordspace://')) host = new URL(url).host
  } catch {
    host = ''
  }

  const clip = () => {
    const res = clipPage(url)
    clipToDoc(res.title, res.blocks, res.note)
  }

  return (
    <div className="web-chrome">
      <div className="web-chrome-info">
        <span className={`web-sec ${secure ? 'is-secure' : 'is-insecure'}`}>
          {secure ? <Lock size={12} /> : <Globe size={12} />}
        </span>
        <span className="web-chrome-title">{resolved.title}</span>
        {host && <span className="web-chrome-host">{host}</span>}
      </div>
      <button className="web-clip-btn" onClick={clip} title="把这个网页存成一个可编辑的本地文档">
        ＋ 存为文档
      </button>
    </div>
  )
}
