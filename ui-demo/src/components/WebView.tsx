import { ExternalLink } from 'lucide-react'
import type { Tab } from '../types'
import { resolve } from '../mock/browser'
import NewTab from './NewTab'
import MockSite from './MockSites'
import './WebView.css'

// The content area for a tab of kind 'web'. Wordspace is also a real browser, so
// the same surface renders three things depending on the address-bar url:
//   - the new-tab start page
//   - one of our polished mock websites (the demo's "open web")
//   - a real <iframe> for a genuine typed URL (best-effort; many sites block it)
// The address bar itself lives in the sidebar omnibox and is wired by the
// integrator; here we only render what's below it.
export default function WebView({ tab }: { tab: Tab }) {
  const r = resolve(tab.url)

  if (r.kind === 'newtab') return <NewTab />
  if (r.kind === 'mock' && r.siteKey)
    return <MockSite siteKey={r.siteKey} query={r.query} />

  // Real external page. Most sites refuse to be framed (X-Frame-Options / CSP),
  // so a slim strip offers opening it in the system browser if it comes up blank.
  return (
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
}
