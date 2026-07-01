import { useEffect, useMemo, useState } from 'react'
import { X, FolderClosed, FolderRoot, Check } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { isCloudStorage } from '../types'
import './SaveModal.css'

// 「保存到哪里」——临时文档（从「标签页 +」新建、unsaved）手动保存时弹出，选文件夹（默认当前空间根目录）。
// 也用于「未保存关闭确认」的「保存并关闭」：saveCloseAfterTab 有值时，保存后顺手关掉那个标签页。
export default function SaveModal() {
  const docId = useUI((s) => s.saveDocId)
  const closeAfterTab = useUI((s) => s.saveCloseAfterTab)
  const closeSave = useUI((s) => s.closeSave)

  const getDoc = useStore((s) => s.getDoc)
  const spaces = useStore((s) => s.spaces)
  const activeSpaceId = useStore((s) => s.activeSpaceId)
  const dirs = useStore((s) => s.dirs)
  const saveDocTo = useStore((s) => s.saveDocTo)
  const closeTab = useStore((s) => s.closeTab)

  const space = spaces.find((sp) => sp.id === activeSpaceId)
  const options = useMemo(() => {
    const rootLabel = (space?.mountPath ?? space?.name ?? '当前空间') + '（根目录）'
    const opts = [{ dir: '', label: rootLabel, root: true }]
    if (space && !isCloudStorage(space.storage)) {
      dirs
        .filter((d) => d.spaceId === space.id)
        .sort((a, b) => a.path.localeCompare(b.path, 'zh'))
        .forEach((d) => opts.push({ dir: d.path, label: d.path, root: false }))
    }
    return opts
  }, [space, dirs])

  const [dir, setDir] = useState('')
  useEffect(() => {
    if (docId) setDir('') // 每次打开默认根目录（当前文件夹）
  }, [docId])

  useEffect(() => {
    if (!docId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSave()
      if (e.key === 'Enter') doSave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, dir, closeAfterTab])

  if (!docId) return null
  const doc = getDoc(docId)
  if (!doc) return null

  const doSave = () => {
    saveDocTo(docId, dir)
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
            <div className="ws-modal-sub">「{doc.title}」· 默认存到当前空间根目录，也可以选别的文件夹</div>
          </div>
          <button className="ws-modal-x" onClick={closeSave} aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="sm-list">
          {options.map((o) => (
            <button
              key={o.dir || '__root__'}
              className={'sm-row' + (dir === o.dir ? ' is-on' : '')}
              onClick={() => setDir(o.dir)}
            >
              <span className="sm-ico">{o.root ? <FolderRoot size={16} /> : <FolderClosed size={16} />}</span>
              <span className="sm-label ws-truncate">{o.label}</span>
              {dir === o.dir && <Check size={15} className="sm-check" />}
            </button>
          ))}
        </div>

        <div className="ws-modal-foot">
          <button className="ws-btn" onClick={closeSave}>取消</button>
          <button className="ws-btn ws-btn-primary" onClick={doSave}>保存到这里</button>
        </div>
      </div>
    </div>
  )
}
