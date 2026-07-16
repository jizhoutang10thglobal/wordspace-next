import { useState, type CSSProperties } from 'react'
import { Search, Pin } from 'lucide-react'
import { useBrowser } from '../mock/browser'
import { useStore } from '../mock/store'
import { useT } from '../i18n'
import './NewTab.css'

// The browser start page. App-level UI, so it stays plain like the rest of the
// chrome: near-white, hairline borders, one restrained accent. A big centered
// address/search field, a grid of shortcut tiles, and a thin bookmarks row.

interface Shortcut {
  name?: string
  nameKey?: string
  url: string
  initial: string
  initialKey?: string
  color: string
}

const shortcuts: Shortcut[] = [
  { nameKey: 'browser.careersTile', url: 'https://tenthglobal.com/careers', initial: '招', initialKey: 'browser.careersInitial', color: '#1a73e8' }, // i18n-exempt（演示磁贴 initial 回退，真显示走 initialKey）
  { nameKey: 'browser.companyTile', url: 'https://tenthglobal.com', initial: 'T', color: '#16307a' },
  { name: 'Designer News', url: 'https://news.design/today', initial: 'D', color: '#b8541d' },
  { nameKey: 'browser.glassSearch', url: 'glass://home', initial: 'G', color: '#1e8e3e' },
  { name: 'FlowDesk', url: 'https://flowdesk.app', initial: 'F', color: '#6750c8' },
  { nameKey: 'browser.wikipediaTile', url: 'https://zh.wikipedia.org', initial: 'W', color: '#5a5f66' },
  { name: 'Example', url: 'https://example.com', initial: 'E', color: '#0b8793' },
]

export default function NewTab() {
  const t = useT()
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
            placeholder={t('browser.omniPlaceholder')}
            spellCheck={false}
          />
        </form>

        <div className="nt-tiles">
          {shortcuts.map((s) => (
            <button key={s.url} className="nt-tile" onClick={() => go(s.url)}>
              <span className="nt-chip" style={{ '--chip': s.color } as CSSProperties}>
                {s.initialKey ? t(s.initialKey) : s.initial}
              </span>
              <span className="nt-tile-name">{s.nameKey ? t(s.nameKey) : s.name}</span>
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
        <div className="nt-safe-note">{t('browser.safeNote')}</div>
      </div>
    </div>
  )
}
