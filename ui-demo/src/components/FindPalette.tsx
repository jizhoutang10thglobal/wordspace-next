import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, FileText } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './FindPalette.css'

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

interface Hit {
  id: string
  name: string
  sub: string
  open: () => void
}

/**
 * 查找文件面板（Cmd+P / 顶栏放大镜）。按文件名搜所有打开文件夹里的文件 + 云盘文档 → 回车/点击打开。
 * 打开后配合 F6 在左侧树里定位高亮。
 */
export default function FindPalette() {
  const navigate = useNavigate()
  const open = useUI((s) => s.findOpen)
  const close = useUI((s) => s.closeFind)

  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const folders = useStore((s) => s.folders)
  const roots = useStore((s) => s.roots)
  const openFileTab = useStore((s) => s.openFileTab)
  const openDoc = useStore((s) => s.openDoc)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 候选：所有打开文件夹里的文件（sub 带根名前缀消歧，id 含 rootId 才唯一）+ 云盘文档。
  const candidates = useMemo<Hit[]>(() => {
    const cloudFolderIds = new Set(folders.map((f) => f.id))
    const rootName = (id: string) => roots.find((r) => r.id === id)?.name ?? ''
    const fromFiles: Hit[] = files.map((f) => ({
      id: `f:${f.rootId}:${f.path}`,
      name: base(f.path),
      sub: `${rootName(f.rootId)} / ${f.path}`,
      open: () => openFileTab(f),
    }))
    const fromDocs: Hit[] = docs
      .filter((d) => cloudFolderIds.has(d.folderId) && !d.unsaved)
      .map((d) => ({
        id: 'd:' + d.id,
        name: d.title,
        sub: (d.localPath ?? '').replace(/^~\/Wordspace\/?/, ''),
        open: () => openDoc(d.id),
      }))
    return [...fromFiles, ...fromDocs]
  }, [files, docs, folders, roots, openFileTab, openDoc])

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = term
      ? candidates.filter(
          (c) => c.name.toLowerCase().includes(term) || c.sub.toLowerCase().includes(term),
        )
      : candidates
    return list.slice(0, 12)
  }, [q, candidates])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [open])

  useEffect(() => {
    setSel(0)
  }, [q])

  if (!open) return null

  const choose = (h: Hit | undefined) => {
    if (!h) return
    h.open()
    close()
    navigate('/docs')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(hits[sel])
    }
  }

  return (
    <div className="ws-modal-overlay fp-overlay" onMouseDown={close}>
      <div
        className="fp"
        role="dialog"
        aria-modal="true"
        aria-label="查找文件"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="fp-bar">
          <Search size={16} className="fp-bar-ico" />
          <input
            ref={inputRef}
            className="fp-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="按文件名查找…"
            spellCheck={false}
          />
          <span className="fp-hint">
            <CornerDownLeft size={12} /> 打开
          </span>
        </div>
        <div className="fp-list">
          {hits.length === 0 ? (
            <div className="fp-empty">没有匹配的文件</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                className={'fp-row' + (i === sel ? ' is-sel' : '')}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(h)}
              >
                <FileText size={15} className="fp-row-ico" />
                <span className="fp-name ws-truncate">{h.name}</span>
                <span className="fp-sub ws-truncate">{h.sub}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
