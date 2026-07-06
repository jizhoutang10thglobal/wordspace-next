import { ExternalLink, Lock, Globe } from 'lucide-react'
import type { Tab } from '../types'
import { resolve, type Resolved } from '../mock/browser'
import { clipPage } from '../mock/clip'
import { useStore } from '../mock/store'
import NewTab from './NewTab'
import MockSite from './MockSites'
import './WebView.css'

// The content area for a tab of kind 'web'. Wordspace is also a real browser, so
// the same surface renders three things depending on the address-bar url:
//   - the new-tab start page
//   - one of our polished mock websites (the demo's "open web")
//   - a real <iframe> for a genuine typed URL (best-effort; many sites block it)
// Above the page sits a slim Wordspace chrome header (security + title + host +
// 「存为文档」) — the same header the real app shows over a WebContentsView.
export default function WebView({ tab }: { tab: Tab }) {
  const r = resolve(tab.url)

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
    <div className="webpage">
      <WebChrome tab={tab} resolved={r} />
      {content}
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
