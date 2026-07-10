import { useState, type CSSProperties } from 'react'
import { Search, Pin } from 'lucide-react'
import { useBrowser } from '../mock/browser'
import { useStore } from '../mock/store'
import './NewTab.css'

// The browser start page. App-level UI, so it stays plain like the rest of the
// chrome: near-white, hairline borders, one restrained accent. A big centered
// address/search field, a grid of shortcut tiles, and a thin bookmarks row.

interface Shortcut {
  name: string
  url: string
  initial: string
  color: string
}

const shortcuts: Shortcut[] = [
  { name: '招聘页', url: 'https://tenthglobal.com/careers', initial: '招', color: '#1a73e8' },
  { name: '公司官网', url: 'https://tenthglobal.com', initial: 'T', color: '#16307a' },
  { name: 'Designer News', url: 'https://news.design/today', initial: 'D', color: '#b8541d' },
  { name: 'Glass 搜索', url: 'glass://home', initial: 'G', color: '#1e8e3e' },
  { name: 'FlowDesk', url: 'https://flowdesk.app', initial: 'F', color: '#6750c8' },
  { name: '维基百科', url: 'https://zh.wikipedia.org', initial: 'W', color: '#5a5f66' },
  { name: 'Example', url: 'https://example.com', initial: 'E', color: '#0b8793' },
]

export default function NewTab() {
  const [value, setValue] = useState('')
  const pins = useStore((s) => s.tabs.filter((t) => t.pinned))
  const setActiveTab = useStore((s) => s.setActiveTab)
  const go = (url: string) => useBrowser.getState().navigate(url)

  return (
    <div className="nt">
      <div className="nt-inner">
        <div className="nt-mark">Wordspace</div>

        <form
          className="nt-omni"
          onSubmit={(e) => {
            e.preventDefault()
            const v = value.trim()
            if (v) go(v)
          }}
        >
          <Search size={18} className="nt-omni-ico" />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="搜索,或输入网址"
            spellCheck={false}
          />
        </form>

        <div className="nt-tiles">
          {shortcuts.map((s) => (
            <button key={s.name} className="nt-tile" onClick={() => go(s.url)}>
              <span className="nt-chip" style={{ '--chip': s.color } as CSSProperties}>
                {s.initial}
              </span>
              <span className="nt-tile-name">{s.name}</span>
            </button>
          ))}
        </div>

        {pins.length > 0 && (
          <div className="nt-marks">
            <Pin size={13} className="nt-marks-ico" />
            {pins.map((p) => (
              <button key={p.id} className="nt-mark-link" onClick={() => setActiveTab(p.id)}>
                {p.title}
              </button>
            ))}
          </div>
        )}

        {/* 安全口径提示（对齐真 app）：内置浏览器无恶意网站防护 */}
        <div className="nt-safe-note">内置浏览器没有恶意网站防护，访问陌生网站请自行留意</div>
      </div>
    </div>
  )
}
