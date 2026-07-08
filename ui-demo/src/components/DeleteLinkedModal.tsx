import { useEffect } from 'react'
import { Unlink } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { computeBacklinks, baseOf } from '../lib/links'
import './CloseConfirmModal.css'

// 删除被引用文档的守卫（互链）：文件有反链时，删除前弹确认列出「谁链接到它」。
// 文件系统删除是即时的（不像 Notion 有 Trash 对象兜底），断链要在删**之前**让用户知道；
// 真删了也还有删除 toast 的「撤销」窗口可救回（撤销恢复文件 → 链接自然复活）。
export default function DeleteLinkedModal() {
  const pending = useUI((s) => s.confirmDeleteFile)
  const cancel = useUI((s) => s.cancelDeleteFile)
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const deleteFileWithUndo = useStore((s) => s.deleteFileWithUndo)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, cancel])

  if (!pending) return null
  const file = files.find((f) => f.rootId === pending.rootId && f.path === pending.path)
  if (!file) return null
  const referrers = computeBacklinks(files, docs, pending.rootId, pending.path)

  const onDelete = () => {
    cancel()
    deleteFileWithUndo(file)
  }

  return (
    <div className="ws-modal-overlay" onMouseDown={cancel}>
      <div
        className="ws-modal cc-modal"
        role="dialog"
        aria-modal="true"
        aria-label="删除被引用的文档"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cc-body">
          <div className="cc-ico"><Unlink size={20} /></div>
          <div>
            <div className="cc-title">「{baseOf(pending.path)}」被 {referrers.length} 篇文档链接</div>
            <div className="cc-desc">
              删除后这些文档里指向它的链接会断开（显示为断链，可在链接上重新指向或撤销删除恢复）：
            </div>
            <ul className="cc-reflist">
              {referrers.slice(0, 5).map((r) => (
                <li key={`${r.file.rootId}:${r.file.path}`} className="ws-truncate">
                  {r.doc.title} <span className="cc-refpath">{r.file.path}</span>
                </li>
              ))}
              {referrers.length > 5 && <li>… 等 {referrers.length} 篇</li>}
            </ul>
          </div>
        </div>
        <div className="ws-modal-foot cc-foot">
          <span className="cc-spacer" />
          <button className="ws-btn" onClick={cancel}>取消</button>
          <button className="ws-btn cc-discard" onClick={onDelete}>仍要删除</button>
        </div>
      </div>
    </div>
  )
}
