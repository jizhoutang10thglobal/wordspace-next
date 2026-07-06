import { useEffect, useMemo, useState } from 'react'
import { X, FolderClosed, FolderRoot, Check, Cloud } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import './SaveModal.css'

// 「保存到哪里」——临时文档（从「标签页 +」新建、unsaved）手动保存时弹出，选文件夹（默认当前空间根目录）。
// 也用于「未保存关闭确认」的「保存并关闭」：saveCloseAfterTab 有值时，保存后顺手关掉那个标签页。
export default function SaveModal() {
  const docId = useUI((s) => s.saveDocId)
  const closeAfterTab = useUI((s) => s.saveCloseAfterTab)
  const closeSave = useUI((s) => s.closeSave)

  const getDoc = useStore((s) => s.getDoc)
  const roots = useStore((s) => s.roots)
  const dirs = useStore((s) => s.dirs)
  const saveDocTo = useStore((s) => s.saveDocTo)
  const closeTab = useStore((s) => s.closeTab)

  // 目标列表：每个打开的文件夹（根目录 + 子文件夹）+ 一条云盘「我的草稿」。默认第一个根。
  const options = useMemo(() => {
    const opts: { rootId: string | null; dir: string; label: string; root: boolean; cloud?: boolean }[] = []
    for (const r of roots.filter((r) => !r.missing)) {
      opts.push({ rootId: r.id, dir: '', label: `${r.name}（根目录）`, root: true })
      dirs
        .filter((d) => d.rootId === r.id)
        .sort((a, b) => a.path.localeCompare(b.path, 'zh'))
        .forEach((d) => opts.push({ rootId: r.id, dir: d.path, label: `${r.name} / ${d.path}`, root: false }))
    }
    opts.push({ rootId: null, dir: '', label: 'Wordspace 云盘 / 我的草稿', root: true, cloud: true })
    return opts
  }, [roots, dirs])

  const [sel, setSel] = useState<{ rootId: string | null; dir: string }>({ rootId: null, dir: '' })
  useEffect(() => {
    // 每次打开默认第一个根的根目录（当前文件夹）
    if (docId) setSel({ rootId: options[0]?.rootId ?? null, dir: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  useEffect(() => {
    if (!docId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSave()
      // Enter 确认——但焦点在按钮上（比如 Tab 到了「取消」）时交还原生按钮激活，
      // 不无脑保存（shortcuts.html §6 边界修复 2）。
      if (e.key === 'Enter') {
        if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') return
        doSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, sel, closeAfterTab])

  if (!docId) return null
  const doc = getDoc(docId)
  if (!doc) return null

  const doSave = () => {
    saveDocTo(docId, sel.rootId, sel.dir)
    if (closeAfterTab) closeTab(closeAfterTab)
    closeSave()
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={closeSave}>
      <div
        className="ws-modal sm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="保存到哪里"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ws-modal-head">
          <div className="ws-modal-head-text">
            <div className="ws-modal-title">保存到哪里</div>
            <div className="ws-modal-sub">「{doc.title}」· 默认存到第一个打开的文件夹，也可以选别的位置</div>
          </div>
          <button className="ws-modal-x" onClick={closeSave} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="sm-list">
          {options.map((o) => {
            const on = sel.rootId === o.rootId && sel.dir === o.dir
            return (
              <button
                key={`${o.rootId ?? '__space__'}:${o.dir || '__root__'}`}
                className={'sm-row' + (on ? ' is-on' : '') + (o.root ? ' sm-row-root' : '')}
                onClick={() => setSel({ rootId: o.rootId, dir: o.dir })}
              >
                <span className="sm-ico">{o.cloud ? <Cloud size={16} /> : o.root ? <FolderRoot size={16} /> : <FolderClosed size={16} />}</span>
                <span className="sm-label ws-truncate">{o.label}</span>
                {on && <Check size={15} className="sm-check" />}
              </button>
            )
          })}
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={closeSave}>取消</button>
          <button className="ws-btn ws-btn-primary" onClick={doSave}>保存到这里</button>
        </div>
      </div>
    </div>
  )
}
