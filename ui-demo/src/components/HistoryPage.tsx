import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Trash2, Globe2, ChevronLeft } from 'lucide-react'
import { useHistory, type HistEntry } from '../mock/history'
import { useStore } from '../mock/store'
import { useT, type TFunc } from '../i18n'
import './HistoryPage.css'

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayLabel(ms: number, t: TFunc): string {
  const now = new Date()
  const d = new Date(ms)
  const oneDay = 86400_000
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= startToday) return t('browser.today')
  if (ms >= startToday - oneDay) return t('browser.yesterday')
  return t('browser.dateMonthDay', { m: d.getMonth() + 1, d: d.getDate() })
}
const timeStr = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function HistoryPage() {
  const t = useT()
  const navigate = useNavigate()
  const entries = useHistory((s) => s.entries)
  const removeOne = useHistory((s) => s.removeOne)
  const clear = useHistory((s) => s.clear)
  const openWebTab = useStore((s) => s.openWebTab)
  const [q, setQ] = useState('')
  const [clearOpen, setClearOpen] = useState(false)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? entries.filter((e) => e.title.toLowerCase().includes(needle) || e.url.toLowerCase().includes(needle))
      : entries
    const map = new Map<string, { label: string; items: HistEntry[] }>()
    for (const e of filtered) {
      const k = dayKey(e.visitedAt)
      if (!map.has(k)) map.set(k, { label: dayLabel(e.visitedAt, t), items: [] })
      map.get(k)!.items.push(e)
    }
    return Array.from(map.values())
  }, [entries, q, t])

  const open = (e: HistEntry) => { openWebTab(e.url, e.title); navigate('/docs') }
  const doClear = (range: 'hour' | 'day' | 'week' | 'all') => { clear(range); setClearOpen(false) }

  return (
    <div className="hist-page">
      <header className="hist-top">
        <button className="hist-back" onClick={() => navigate('/docs')} title={t('common.back')}><ChevronLeft size={18} /></button>
        <h1>{t('browser.historyTitle')}</h1>
        <div className="hist-search">
          <Search size={14} className="hist-search-ico" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('browser.searchHistory')} spellCheck={false} />
          {q && <button className="hist-search-clear" onClick={() => setQ('')}><X size={13} /></button>}
        </div>
        <div className="hist-clear-wrap">
          <button className="hist-clear-btn" onClick={() => setClearOpen((v) => !v)}>
            <Trash2 size={14} /> {t('browser.clearBrowsingData')}
          </button>
          {clearOpen && (
            <>
              <div className="hist-clear-veil" onClick={() => setClearOpen(false)} />
              <div className="hist-clear-menu">
                <button onClick={() => doClear('hour')}>{t('browser.clearLastHour')}</button>
                <button onClick={() => doClear('day')}>{t('browser.clearLast24h')}</button>
                <button onClick={() => doClear('week')}>{t('browser.clearLast7d')}</button>
                <div className="hist-clear-sep" />
                <button className="is-danger" onClick={() => doClear('all')}>{t('browser.clearAll')}</button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="hist-body">
        {groups.length === 0 && <div className="hist-empty">{q ? t('browser.noMatch') : t('browser.emptyHistory')}</div>}
        {groups.map((g, i) => (
          <section key={i} className="hist-group">
            <div className="hist-day">{g.label}</div>
            {g.items.map((e) => (
              <div key={e.id} className="hist-row">
                <button className="hist-row-main" onClick={() => open(e)} title={e.url}>
                  <span className="hist-time">{timeStr(e.visitedAt)}</span>
                  <Globe2 size={13} className="hist-ico" />
                  <span className="hist-title">{e.title}</span>
                  <span className="hist-url">{e.url.replace(/^https?:\/\//, '')}</span>
                </button>
                <button className="hist-del" title={t('browser.removeFromHistory')} onClick={() => removeOne(e.id)}><X size={13} /></button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
