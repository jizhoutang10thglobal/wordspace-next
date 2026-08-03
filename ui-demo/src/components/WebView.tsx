import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import type { Tab } from '../types'
import { resolve, useBrowser } from '../mock/browser'
import { useStore } from '../mock/store'
import { useDownloads } from '../mock/downloads'
import { buildWebCtx, cleanShareUrl, type CtxInfo, type CtxItem } from '../lib/webCtxMenu'
import { filenameFromUrl } from '../lib/downloads'
import { useT } from '../i18n'
import NewTab from './NewTab'
import MockSite from './MockSites'
import WebContextMenu from './WebContextMenu'
import './WebView.css'

// The content area for a tab of kind 'web'. Wordspace is also a real browser, so
// the same surface renders three things depending on the address-bar url:
//   - the new-tab start page
//   - one of our polished mock websites (the demo's "open web")
//   - a real <iframe> for a genuine typed URL (best-effort; many sites block it)
// 网页内容直接铺满，无网页头——URL / 安全指示 / 收藏都在左侧栏（地址栏 + 收藏区）。
// 右键网页内容 → 原生风格 DOM 菜单（对齐真 app 的 WebContentsView 右键菜单）。
export default function WebView({ tab }: { tab: Tab }) {
  const t = useT()
  const r = resolve(tab.url)
  const openWebTab = useStore((s) => s.openWebTab)
  const toast = useStore((s) => s.toast)
  const navigate = useNavigate()
  const zoom = useBrowser((s) => s.zoom)
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxItem[]; info: CtxInfo } | null>(null)

  // 网页内查找（Cmd+F）：mock 站是同文档 DOM，用 window.find 定位+高亮+滚动（演示够用）。
  const [findOpen, setFindOpen] = useState(false)
  const [findQ, setFindQ] = useState('')
  const findInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onFind = () => { setFindOpen(true); setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select() }, 0) }
    window.addEventListener('ws-web-find', onFind)
    return () => window.removeEventListener('ws-web-find', onFind)
  }, [])
  const doFind = (backwards = false) => {
    const q = findQ.trim()
    if (!q) return
    ;(window as unknown as { find?: (s: string, cs: boolean, bw: boolean, wrap: boolean) => boolean }).find?.(q, false, backwards, true)
  }
  const closeFind = () => { setFindOpen(false); window.getSelection()?.removeAllRanges() }

  // 右键：真读光标下的 DOM（链接/图片/选中文字/编辑框），据此算菜单分节——和真 app 一样按上下文变。
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
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
      case 'open-link-bg': openWebTab(link, link, true); toast(t('browser.openedInBackground'), 'neutral'); break
      case 'copy-link': navigator.clipboard?.writeText(cleanShareUrl(link)); toast(t('browser.copiedLink'), 'success'); break
      case 'copy-image': toast(t('browser.copiedImage'), 'success'); break
      case 'copy-image-url': navigator.clipboard?.writeText(info.imgUrl || ''); toast(t('browser.copiedImageUrl'), 'success'); break
      // 右键存储走同一条下载管线(R8);文件名从 URL path 派生,无 path 回落 host+扩展名。
      // 尺寸/时长是 mock 定值(演示语义,真 app 移植时换成 DownloadItem 真值)。
      case 'save-image': useDownloads.getState().startDownload({ filename: filenameFromUrl(info.imgUrl || '', '.jpg'), sourceUrl: info.imgUrl || '', sizeBytes: 1_887_437, durationMs: 4000 }); break
      case 'save-link': useDownloads.getState().startDownload({ filename: filenameFromUrl(link, '.html'), sourceUrl: link, sizeBytes: 856_064, durationMs: 4000 }); break
      case 'copy-selection': navigator.clipboard?.writeText(sel); toast(t('browser.copied'), 'success'); break
      case 'search-selection': openWebTab(`glass://search?q=${encodeURIComponent(sel)}`, t('browser.searchTitle', { q: sel.slice(0, 20) })); navigate('/docs'); break
      case 'cut': case 'copy': case 'paste': case 'select-all': toast(t('browser.demoEditAction'), 'neutral'); break
      case 'nav-back': useBrowser.getState().back(); break
      case 'nav-forward': useBrowser.getState().forward(); break
      case 'reload': toast(t('browser.reloadedPage'), 'neutral'); break
      case 'copy-page-url': navigator.clipboard?.writeText(cleanShareUrl(tab.url)); toast(t('browser.copiedPageLink'), 'success'); break
      case 'export-pdf': toast(t('browser.exportingPdf'), 'neutral'); break
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
            {t('browser.iframeBlockedNote')}
          </span>
          <button
            className="webview-strip-open"
            onClick={() => window.open(tab.url, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink size={13} />
            {t('common.open')}
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
      {findOpen && (
        <div className="web-find">
          <Search size={13} className="web-find-ico" />
          <input
            ref={findInputRef}
            className="web-find-input"
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey) }
              else if (e.key === 'Escape') { e.preventDefault(); closeFind() }
            }}
            placeholder={t('browser.findInPage')}
            spellCheck={false}
          />
          <button className="web-find-btn" title={t('browser.findPrev')} onClick={() => doFind(true)}><ChevronUp size={14} /></button>
          <button className="web-find-btn" title={t('browser.findNext')} onClick={() => doFind(false)}><ChevronDown size={14} /></button>
          <button className="web-find-btn" title={t('browser.findClose')} onClick={closeFind}><X size={14} /></button>
        </div>
      )}
      <div className="webpage-zoom" style={zoom !== 1 ? { zoom } : undefined}>{content}</div>
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
