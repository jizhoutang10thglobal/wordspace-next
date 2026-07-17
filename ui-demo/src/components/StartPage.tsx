import { useMemo, useRef, useState } from 'react'
import { Search, FilePlus2, FolderPlus, FileSearch, CornerDownLeft, Globe } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { useBookmarks, BM_BAR } from '../mock/bookmarks'
import { useT } from '../i18n'
import { relTime } from '../lib/format'
import { groupKey, GROUP_ORDER, folderLabel, type RecencyGroup } from '../lib/recency'
import type { Doc } from '../types'
import './StartPage.css'

// 收藏瓦片的首字彩块(与侧栏 FavChip 同一 hash 公式,视觉一家人)。
function TileChip({ label, seed }: { label: string; seed: string }) {
  const ch = label.trim().charAt(0).toUpperCase() || '·'
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="sp-tile-chip" style={{ background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 42% 40%)` }}>
      {ch}
    </span>
  )
}

// URL 形输入(带点的域名/带协议)→ 交给浏览器管道;别的短词有文件候选就优先文件。
const urlish = (v: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(v)

/**
 * 默认屏导览页(方案 3「时间流」,Wendi 2026-07-17 反馈/Colin 拍板):
 * 一个标签都没开时的编辑区。左栏=问候+统一 omnibox+按 今天/昨天/本周 分组的最近文件;
 * 右栏=收藏瓦片+开始动作。plan: docs/plans/2026-07-17-001-feat-ui-demo-start-page-plan.md
 */
export default function StartPage() {
  const t = useT()
  const docs = useStore((s) => s.docs)
  const openDoc = useStore((s) => s.openDoc)
  const newBrowserTab = useStore((s) => s.newBrowserTab)
  const openCreate = useUI((s) => s.openCreate)
  const openAddFolder = useUI((s) => s.openAddFolder)
  const openFind = useUI((s) => s.openFind)
  const bookmarks = useBookmarks((s) => s.bookmarks)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 最近文件:有落盘路径的按 updatedAt 倒序取前 12(临时未保存文档不进流)。
  const recents = useMemo(
    () => docs.filter((d) => d.localPath && !d.unsaved).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12),
    [docs],
  )
  const groups = useMemo(() => {
    const m = new Map<RecencyGroup, Doc[]>()
    for (const d of recents) {
      const k = groupKey(d.updatedAt)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(d)
    }
    return GROUP_ORDER.filter((k) => m.has(k)).map((k) => ({ key: k, docs: m.get(k)! }))
  }, [recents])

  // omnibox 候选:标题含 query 的文档(≤6);URL 形输入不出文件候选(直接走网页)。
  const query = q.trim()
  const hits = useMemo(() => {
    if (!query || urlish(query)) return []
    const lower = query.toLowerCase()
    return docs.filter((d) => d.title.toLowerCase().includes(lower)).slice(0, 6)
  }, [docs, query])

  const goWeb = (v: string) => {
    newBrowserTab()
    useBrowser.getState().navigate(v)
  }
  const submit = () => {
    if (!query) return
    const pick = hits[sel] ?? hits[0]
    if (pick && !urlish(query)) openDoc(pick.id)
    else goWeb(query) // 浏览器管道自己分 URL / 搜索(与地址栏同一套)
  }

  const hour = new Date().getHours()
  const greet = hour < 6 ? t('start.greetNight') : hour < 12 ? t('start.greetMorning') : hour < 18 ? t('start.greetAfternoon') : t('start.greetEvening')
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  const tiles = bookmarks.filter((b) => b.folderId === BM_BAR).slice(0, 6)
  const groupTitle: Record<RecencyGroup, string> = {
    today: t('start.today'),
    yesterday: t('start.yesterday'),
    week: t('start.thisWeek'),
    earlier: t('start.earlier'),
  }

  return (
    <div className="sp" data-testid="start-page">
      <div className="sp-col">
        <h1 className="sp-greet">{greet}</h1>
        <div className="sp-date">{dateLine}</div>

        <div className="sp-omni">
          <Search size={15} className="sp-omni-ico" />
          <input
            ref={inputRef}
            className="sp-omni-input"
            value={q}
            placeholder={t('start.omniPlaceholder')}
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') setQ('')
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
            }}
          />
          {query && (
            <span className="sp-omni-kbd">
              <CornerDownLeft size={11} /> {hits.length && !urlish(query) ? t('start.openHit') : t('start.goWeb')}
            </span>
          )}
          {hits.length > 0 && (
            <div className="sp-sug">
              {hits.map((d, i) => (
                <button
                  key={d.id}
                  className={'sp-sug-item' + (i === sel ? ' is-sel' : '')}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => { e.preventDefault(); openDoc(d.id) }}
                >
                  <span className="sp-fico" aria-hidden />
                  <span className="sp-sug-name">{d.title}</span>
                  <span className="sp-sug-meta">{folderLabel(d.localPath, t('start.rootFolder'))}</span>
                </button>
              ))}
              <button className="sp-sug-item sp-sug-web" onMouseDown={(e) => { e.preventDefault(); goWeb(query) }}>
                <Globe size={13} />
                <span className="sp-sug-name">{t('start.searchWebFor', { q: query })}</span>
              </button>
            </div>
          )}
        </div>

        <div className="sp-flow">
          {groups.map((g) => (
            <section key={g.key} className="sp-grp">
              <div className="sp-grp-cap">{groupTitle[g.key]}</div>
              {g.docs.map((d) => (
                <button key={d.id} className="sp-row" onClick={() => openDoc(d.id)}>
                  <span className={'sp-fico' + (d.format === 'markdown' ? ' is-md' : '')} aria-hidden />
                  <span className="sp-row-name">{d.title}</span>
                  <span className="sp-row-meta">
                    <span className="sp-chip">{folderLabel(d.localPath, t('start.rootFolder'))}</span>
                    {relTime(d.updatedAt)}
                  </span>
                </button>
              ))}
            </section>
          ))}
          {groups.length === 0 && <div className="sp-empty">{t('start.noRecents')}</div>}
        </div>
      </div>

      <aside className="sp-rail">
        {tiles.length > 0 && (
          <>
            <div className="sp-rail-cap">{t('start.favorites')}</div>
            <div className="sp-tiles">
              {tiles.map((b) => (
                <button key={b.id} className="sp-tile" title={b.url} onClick={() => goWeb(b.url)}>
                  <TileChip label={b.title} seed={b.url} />
                  <span className="sp-tile-name">{b.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sp-rail-cap">{t('start.begin')}</div>
        <div className="sp-acts">
          <button className="sp-act sp-act-ink" onClick={() => openCreate()}>
            <FilePlus2 size={15} /> {t('start.newDoc')}
          </button>
          <button className="sp-act" onClick={() => openFind()}>
            <FileSearch size={15} /> {t('start.openDoc')}
          </button>
          <button className="sp-act" onClick={() => openAddFolder()}>
            <FolderPlus size={15} /> {t('start.openFolder')}
          </button>
        </div>
      </aside>
    </div>
  )
}
